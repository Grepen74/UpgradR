import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { createJobProposalsSchema } from "@upgradr/contracts";
import { describe, expect, it, vi } from "vitest";

import type { VerifiedAuthInfo } from "../auth/claims";
import type { SupabaseRestClient } from "../supabase/rest-client";
import { registerApplicationTools } from "./applications";
import { registerOpportunityTools } from "./opportunities";
import type { ToolContext } from "./types";

type ToolHandler = (input: unknown) => Promise<CallToolResult>;

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
    extra: { userId: "11111111-1111-1111-1111-111111111111" },
  };
}

/** Captures tool registrations so a handler can be invoked directly. */
function registerTools(ctx: ToolContext): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;

  registerApplicationTools(server, ctx);
  registerOpportunityTools(server, ctx);
  return handlers;
}

function structured(result: CallToolResult): unknown {
  return result.structuredContent;
}

describe("create_job_proposals", () => {
  const proposals = createJobProposalsSchema.parse({
    proposals: [
      {
        title: "Senior iOS Engineer",
        companyName: "Acme, Inc.",
        location: "Stockholm",
        sourceUrl: "acme.example/jobs/1",
        sourceProvider: "acme.example",
        externalId: "JOB-1",
        matchScore: 82,
        strengths: ["Swift"],
      },
      {
        title: "Senior iOS Engineer",
        companyName: "Acme, Inc.",
        location: "Stockholm",
        sourceUrl: "https://acme.example/jobs/1?utm_source=second-pass",
        sourceProvider: "acme.example",
        allowSimilar: true,
      },
    ],
  });

  it("delegates every duplicate rule to the create_job_proposals transaction", async () => {
    const rpc = vi.fn(async () => ({ created: 1, duplicates: 1, possibleDuplicates: 0, results: [] }));
    const insert = vi.fn();
    const supabase = fakeSupabase({
      rpc: rpc as unknown as SupabaseRestClient["rpc"],
      insert: insert as unknown as SupabaseRestClient["insert"],
    });
    const handlers = registerTools({ auth: authWith(["applications:write"]), supabase });

    const result = await handlers.get("create_job_proposals")!(proposals);

    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, body] = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(name).toBe("create_job_proposals");
    expect(body["p_mcp_client_id"]).toBe("test-mcp-client");
    expect(body["p_proposals"]).toEqual([
      {
        title: "Senior iOS Engineer",
        company_name: "Acme, Inc.",
        location: "Stockholm",
        // The bare hostname is normalized to an absolute https URL by the
        // shared contract before it ever reaches the database.
        source_url: "https://acme.example/jobs/1",
        source_provider: "acme.example",
        external_id: "JOB-1",
        description: null,
        compensation_min: null,
        compensation_max: null,
        compensation_currency: null,
        match_score: 82,
        match_rationale: null,
        strengths: ["Swift"],
        gaps: [],
        confidence: null,
        allow_similar: false,
      },
      {
        title: "Senior iOS Engineer",
        company_name: "Acme, Inc.",
        location: "Stockholm",
        source_url: "https://acme.example/jobs/1?utm_source=second-pass",
        source_provider: "acme.example",
        external_id: null,
        description: null,
        compensation_min: null,
        compensation_max: null,
        compensation_currency: null,
        match_score: null,
        match_rationale: null,
        strengths: [],
        gaps: [],
        confidence: null,
        allow_similar: true,
      },
    ]);

    // Provenance is written inside the same transaction, so the tool must not
    // insert a second, non-atomic activity_events row of its own.
    expect(insert).not.toHaveBeenCalled();
    expect(structured(result)).toEqual({
      created: 1,
      duplicates: 1,
      possibleDuplicates: 0,
      results: [],
    });
  });

  it("passes an in-batch repeat through instead of rejecting the whole batch", async () => {
    const rpc = vi.fn(async () => ({ created: 1, duplicates: 1, possibleDuplicates: 0, results: [] }));
    const supabase = fakeSupabase({ rpc: rpc as unknown as SupabaseRestClient["rpc"] });
    const handlers = registerTools({ auth: authWith(["applications:write"]), supabase });

    const repeated = createJobProposalsSchema.parse({
      proposals: [
        {
          title: "Data Engineer",
          companyName: "Initech",
          sourceUrl: "https://initech.example/jobs/7",
          sourceProvider: "initech.example",
        },
        {
          title: "Data Engineer",
          companyName: "Initech",
          sourceUrl: "https://initech.example/jobs/7?utm_source=agent",
          sourceProvider: "initech.example",
        },
      ],
    });

    const result = await handlers.get("create_job_proposals")!(repeated);

    expect(result.isError).toBeUndefined();
    const [, body] = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect((body["p_proposals"] as unknown[]).length).toBe(2);
  });

  it("refuses without the applications:write scope", async () => {
    const rpc = vi.fn();
    const supabase = fakeSupabase({ rpc: rpc as unknown as SupabaseRestClient["rpc"] });
    const handlers = registerTools({ auth: authWith(["applications:read"]), supabase });

    const result = await handlers.get("create_job_proposals")!(proposals);

    expect(result.isError).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("list_known_opportunity_keys", () => {
  const rows = [
    {
      id: "app-1",
      canonical_source_url: "https://acme.example/jobs/1",
      source_provider: "acme.example",
      external_id: "JOB-1",
      dedup_fingerprint: "acme inc|senior ios engineer|stockholm",
      current_status: "dismissed",
      updated_at: "2026-03-01T00:00:00.000Z",
    },
    {
      id: "app-2",
      canonical_source_url: "https://globex.example/careers/42",
      source_provider: "globex.example",
      external_id: null,
      dedup_fingerprint: "globex|backend engineer|",
      current_status: "applied",
      updated_at: "2026-02-01T00:00:00.000Z",
    },
  ];

  it("returns compact dedup keys and flags closed opportunities", async () => {
    const get = vi.fn(async () => rows);
    const supabase = fakeSupabase({ get: get as unknown as SupabaseRestClient["get"] });
    const handlers = registerTools({ auth: authWith(["opportunities:read"]), supabase });

    const result = await handlers.get("list_known_opportunity_keys")!({ limit: 2 });

    expect(structured(result)).toEqual({
      keys: [
        {
          id: "app-1",
          canonicalSourceUrl: "https://acme.example/jobs/1",
          sourceProvider: "acme.example",
          externalId: "JOB-1",
          fingerprint: "acme inc|senior ios engineer|stockholm",
          currentStatus: "dismissed",
          isClosed: true,
          updatedAt: "2026-03-01T00:00:00.000Z",
        },
        {
          id: "app-2",
          canonicalSourceUrl: "https://globex.example/careers/42",
          sourceProvider: "globex.example",
          externalId: null,
          fingerprint: "globex|backend engineer|",
          currentStatus: "applied",
          isClosed: false,
          updatedAt: "2026-02-01T00:00:00.000Z",
        },
      ],
      limit: 2,
      offset: 0,
      hasMore: true,
    });
  });

  it("passes an updatedSince cursor through as a bounded PostgREST filter", async () => {
    const get = vi.fn(async () => []);
    const supabase = fakeSupabase({ get: get as unknown as SupabaseRestClient["get"] });
    const handlers = registerTools({ auth: authWith(["opportunities:read"]), supabase });

    const result = await handlers.get("list_known_opportunity_keys")!({
      updatedSince: "2026-01-01T00:00:00.000Z",
      limit: 500,
      offset: 10,
    });

    const [path, options] = get.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(path).toBe("applications");
    expect(options["filters"]).toEqual({ updated_at: "gte.2026-01-01T00:00:00.000Z" });
    // Clamped to the tool's own 200-key ceiling rather than trusting the input.
    expect(options["limit"]).toBe(200);
    expect(options["offset"]).toBe(10);
    expect(structured(result)).toMatchObject({ keys: [], hasMore: false });
  });

  it("refuses without the opportunities:read scope", async () => {
    const get = vi.fn();
    const supabase = fakeSupabase({ get: get as unknown as SupabaseRestClient["get"] });
    const handlers = registerTools({ auth: authWith(["applications:read"]), supabase });

    const result = await handlers.get("list_known_opportunity_keys")!({});

    expect(result.isError).toBe(true);
    expect(get).not.toHaveBeenCalled();
  });
});
