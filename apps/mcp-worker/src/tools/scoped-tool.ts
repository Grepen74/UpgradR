import type { CallToolResult, McpServer, ToolAnnotations } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { McpToolName } from "../auth/scope-catalog";
import { hasAllScopes, missingScopes } from "../auth/scopes";
import { requiredScopesFor } from "../auth/scope-catalog";
import { toToolErrorResult } from "../http/errors";
import type { ToolContext } from "./types";

interface ScopedToolConfig<Input, Output = unknown> {
  title?: string;
  description: string;
  inputSchema: z.ZodType<Input>;
  /**
   * Declaring this is what makes the `.describe()` calls on the response
   * contract reach clients at all: without it they are dead weight, visible
   * only in the repository. Tools that declare it must also return
   * `structuredContent`, which the SDK validates against this schema.
   */
  outputSchema?: z.ZodType<Output>;
  annotations?: ToolAnnotations;
}

/**
 * Registers a tool that enforces its `TOOL_SCOPES` requirement before the
 * handler runs, and converts any thrown error into a safe `isError` tool
 * result rather than letting it propagate as a raw protocol failure.
 *
 * A caller missing a required scope gets an ordinary tool result with
 * `isError: true` (not an HTTP-level 403) — per the SDK's guidance, this
 * lets the model read the refusal and move on instead of the whole
 * connection failing. Endpoint-wide access is separately gated by
 * `MCP_REQUIRED_SCOPE` in `requireBearerAuth` (see `index.ts`).
 */
export function registerScopedTool<Input, Output = unknown>(
  server: McpServer,
  ctx: ToolContext,
  name: McpToolName,
  config: ScopedToolConfig<Input, Output>,
  handler: (input: Input, ctx: ToolContext) => Promise<CallToolResult>,
): void {
  server.registerTool(
    name,
    {
      description: config.description,
      inputSchema: config.inputSchema,
      ...(config.outputSchema ? { outputSchema: config.outputSchema } : {}),
      ...(config.title ? { title: config.title } : {}),
      ...(config.annotations ? { annotations: config.annotations } : {}),
    },
    async (input: Input) => {
      const required = requiredScopesFor(name);
      if (!hasAllScopes(ctx.auth.scopes, required)) {
        const missing = missingScopes(ctx.auth.scopes, required).join(", ");
        return {
          content: [{ type: "text", text: `insufficient_scope: ${name} requires ${missing}` }],
          isError: true,
        };
      }

      try {
        return await handler(input, ctx);
      } catch (error) {
        return toToolErrorResult(error);
      }
    },
  );
}
