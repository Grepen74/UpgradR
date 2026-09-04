import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { assessJobMatchSchema } from "@upgradr/contracts";
import { describe, expect, it, vi } from "vitest";

import type { VerifiedAuthInfo } from "../auth/claims";
import { requiredScopesFor } from "../auth/scope-catalog";
import type { SupabaseRestClient } from "../supabase/rest-client";
import { registerApplicationTools } from "./applications";
import type { ToolContext } from "./types";

type ToolHandler = (input: unknown) => Promise<CallToolResult>;

const APPLICATION_ID = "22222222-2222-4222-8222-222222222222";

function fakeSupabase(overrides: Partial<SupabaseRestClient> = {}): SupabaseRestClient {
  return {
    get: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    count: vi.fn(),
    rpc: vi.fn(),
    ...overrides,
  };
}

function authWith(scopes: string[]): VerifiedAuthInfo {
  return {
    token: "token",
    clientId: "test-mcp-client",
    scopes,
    expiresAt: 0,
    extra: { userId: "11111111-1111-4111-8111-111111111111" },
  };
}

function registerTools(ctx: ToolContext): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;

  registerApplicationTools(server, ctx);
  return handlers;
}

function textOf(result: CallToolResult): string {
  return result.content.map((part) => ("text" in part ? part.text : "")).join("");
}

describe("assess_job_match", () => {
  const fullScopes = ["applications:read", "applications:write"];

  function input(overrides: Record<string, unknown> = {}) {
    return assessJobMatchSchema.parse({
      applicationId: APPLICATION_ID,
      matchScore: 91,
      matchRationale: "Recruiter confirmed the team is iOS-only.",
      strengths: ["Swift"],
      gaps: [],
      confidence: 0.95,
      ...overrides,
    });
  }

  it("delegates the whole assessment to one transaction", async () => {
    const rpc = vi.fn(async () => ({ id: APPLICATION_ID, match_score: 91 }));
    const supabase = fakeSupabase({ rpc: rpc as unknown as SupabaseRestClient["rpc"] });
    const handlers = registerTools({ auth: authWith(fullScopes), supabase });

    const result = await handlers.get("assess_job_match")!(input());

    expect(result.isError).toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, body] = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(name).toBe("record_job_match_assessment");
    expect(body).toMatchObject({
      p_application_id: APPLICATION_ID,
      p_score: 91,
      p_rationale: "Recruiter confirmed the team is iOS-only.",
      p_strengths: ["Swift"],
      p_gaps: [],
      p_confidence: 0.95,
    });
  });

  it("attributes the assessment to the calling client", async () => {
    const rpc = vi.fn(async () => ({}));
    const supabase = fakeSupabase({ rpc: rpc as unknown as SupabaseRestClient["rpc"] });
    const handlers = registerTools({ auth: authWith(fullScopes), supabase });

    await handlers.get("assess_job_match")!(input());

    const [, body] = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(body.p_mcp_client_id).toBe("test-mcp-client");
  });

  // An assessment carrying neither figure would blank the score already on the
  // opportunity, so it is refused rather than applied.
  it("refuses an assessment with neither a score nor a rationale", async () => {
    const rpc = vi.fn(async () => ({}));
    const supabase = fakeSupabase({ rpc: rpc as unknown as SupabaseRestClient["rpc"] });
    const handlers = registerTools({ auth: authWith(fullScopes), supabase });

    const result = await handlers.get("assess_job_match")!(
      input({ matchScore: undefined, matchRationale: undefined }),
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("invalid_request");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("accepts a rationale-only assessment", async () => {
    const rpc = vi.fn(async () => ({}));
    const supabase = fakeSupabase({ rpc: rpc as unknown as SupabaseRestClient["rpc"] });
    const handlers = registerTools({ auth: authWith(fullScopes), supabase });

    const result = await handlers.get("assess_job_match")!(
      input({ matchScore: undefined, matchRationale: "Team disbanded; no longer a fit." }),
    );

    expect(result.isError).toBeUndefined();
    const [, body] = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(body.p_score).toBeNull();
  });

  // Re-scoring reads the opportunity before writing it, so a write-only grant
  // could never complete the operation. Declaring both scopes turns that into
  // an explicit refusal instead of an opaque "not found" from RLS.
  it("requires read as well as write", async () => {
    expect(requiredScopesFor("assess_job_match")).toEqual([
      "applications:read",
      "applications:write",
    ]);
  });

  it("refuses a caller holding only applications:write", async () => {
    const rpc = vi.fn(async () => ({}));
    const supabase = fakeSupabase({ rpc: rpc as unknown as SupabaseRestClient["rpc"] });
    const handlers = registerTools({ auth: authWith(["applications:write"]), supabase });

    const result = await handlers.get("assess_job_match")!(input());

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("insufficient_scope");
    expect(textOf(result)).toContain("applications:read");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never creates an opportunity", async () => {
    const insert = vi.fn();
    const supabase = fakeSupabase({
      rpc: vi.fn(async () => ({})) as unknown as SupabaseRestClient["rpc"],
      insert: insert as unknown as SupabaseRestClient["insert"],
    });
    const handlers = registerTools({ auth: authWith(fullScopes), supabase });

    await handlers.get("assess_job_match")!(input());

    expect(insert).not.toHaveBeenCalled();
  });
});

describe("assessJobMatchSchema", () => {
  it("does not accept facts the user may have corrected by hand", () => {
    const parsed = assessJobMatchSchema.parse({
      applicationId: APPLICATION_ID,
      matchScore: 50,
      title: "Renamed by an agent",
      companyName: "Renamed",
      compensationMin: 1,
    }) as Record<string, unknown>;

    expect(parsed.title).toBeUndefined();
    expect(parsed.companyName).toBeUndefined();
    expect(parsed.compensationMin).toBeUndefined();
  });

  it("defaults strengths and gaps to empty lists so they always replace cleanly", () => {
    const parsed = assessJobMatchSchema.parse({
      applicationId: APPLICATION_ID,
      matchScore: 50,
    });

    expect(parsed.strengths).toEqual([]);
    expect(parsed.gaps).toEqual([]);
  });

  it("rejects a score outside 0-100", () => {
    expect(() =>
      assessJobMatchSchema.parse({ applicationId: APPLICATION_ID, matchScore: 101 }),
    ).toThrow();
  });
});
