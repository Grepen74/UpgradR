/**
 * Central "safe error" boundary for tool handlers.
 *
 * Tool handlers can fail for many reasons: bad input, an RLS-denied Supabase
 * request, a network blip, a bug. None of the underlying detail (SQL error
 * text, stack traces, upstream response bodies) is safe to hand back to an
 * MCP client, since it can leak schema/internal structure to a model acting
 * on a user's behalf. Every failure is logged server-side and converted to
 * one of a small set of generic, non-identifying messages.
 */

export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

export class UpstreamError extends Error {
  readonly status: number;

  constructor(status: number, message = "The upstream request failed") {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}

/**
 * Thrown for internal invariant violations (e.g. a filter-less DELETE call)
 * that indicate a bug in this Worker rather than bad caller input or an
 * upstream failure. Always logged and always mapped to the generic
 * message — never echoed to the caller.
 */
export class ToolProgrammingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolProgrammingError";
  }
}

export interface ToolErrorContent extends CallToolResult {
  content: [{ type: "text"; text: string }];
  isError: true;
}

const GENERIC_MESSAGE = "The request could not be completed. Please try again.";

/**
 * Classifies a PostgREST/RPC response status into a safe, generic message.
 * The raw body is never included — call sites should log it separately.
 */
export function safeSupabaseMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "You do not have access to that resource.";
  }
  if (status === 404) {
    return "The requested record was not found.";
  }
  if (status === 409) {
    return "The request conflicts with the current state of the record.";
  }
  if (status === 422 || status === 400) {
    return "The request was rejected as invalid.";
  }
  if (status === 429) {
    return "Too many requests. Please slow down and try again.";
  }
  return GENERIC_MESSAGE;
}

/**
 * Converts any thrown error into an MCP tool "isError" result with a safe
 * message, logging the original error for operators.
 */
export function toToolErrorResult(error: unknown): ToolErrorContent {
  let message = GENERIC_MESSAGE;

  if (error instanceof ToolInputError) {
    message = error.message;
  } else if (error instanceof UpstreamError) {
    message = safeSupabaseMessage(error.status);
  }

  if (!(error instanceof ToolInputError)) {
    console.error("MCP tool error", error);
  }

  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}
import type { CallToolResult } from "@modelcontextprotocol/server";
