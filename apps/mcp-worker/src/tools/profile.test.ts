import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import {
  candidateProfileResponseSchema,
  jobSearchPreferencesResponseSchema,
} from "@upgradr/contracts";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { VerifiedAuthInfo } from "../auth/claims";
import type { SupabaseRestClient } from "../supabase/rest-client";
import { registerProfileTools } from "./profile";
import type { ToolContext } from "./types";

type ToolHandler = (input: unknown) => Promise<CallToolResult>;

interface Registration {
  config: { outputSchema?: unknown; description: string };
  handler: ToolHandler;
}

const seededRow = {
  target_roles: [],
  locations: [],
  remote_policy: "flexible",
  minimum_compensation: null,
  minimum_compensation_period: "month",
  compensation_currency: null,
  industries: [],
  excluded_companies: [],
  notes: null,
  minimum_match_score: null,
  updated_at: "2026-09-01T10:00:00+00:00",
};

function register(rows: Array<Record<string, unknown>>, scopes = ["profile:read"]) {
  const registrations = new Map<string, Registration>();
  const server = {
    registerTool: (name: string, config: Registration["config"], handler: ToolHandler) => {
      registrations.set(name, { config, handler });
    },
  } as unknown as McpServer;

  const auth: VerifiedAuthInfo = {
    token: "token",
    clientId: "test-mcp-client",
    scopes,
    expiresAt: 0,
    extra: { userId: "11111111-1111-1111-1111-111111111111" },
  };

  const supabase: SupabaseRestClient = {
    get: vi.fn(async (table: string) => (table === "job_search_preferences" ? rows : [])),
    insert: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    count: vi.fn(),
    rpc: vi.fn(),
  } as unknown as SupabaseRestClient;

  registerProfileTools(server, { auth, supabase } as unknown as ToolContext);
  return registrations;
}

async function readPreferences(rows: Array<Record<string, unknown>>) {
  const entry = register(rows).get("get_job_search_preferences");
  const result = await entry!.handler({});
  return result.structuredContent as Record<string, unknown>;
}

describe("get_job_search_preferences", () => {
  it("reports the signup-seeded row as unconfigured", async () => {
    // The distinction this whole flag exists for: without it, this row is
    // byte-for-byte identical to a deliberately wide-open search.
    const preferences = await readPreferences([seededRow]);
    expect(preferences["isConfigured"]).toBe(false);
  });

  it("reports a row the user has actually filled in as configured", async () => {
    const preferences = await readPreferences([
      { ...seededRow, target_roles: ["Engineering Manager"], minimum_compensation: 65_000 },
    ]);
    expect(preferences["isConfigured"]).toBe(true);
  });

  it("returns the period alongside the floor so a comparison cannot guess", async () => {
    const preferences = await readPreferences([
      { ...seededRow, minimum_compensation: 660_000, minimum_compensation_period: "year" },
    ]);
    expect(preferences["minimumCompensation"]).toBe(660_000);
    expect(preferences["minimumCompensationPeriod"]).toBe("year");
  });

  it("defaults a missing period to month rather than omitting it", async () => {
    const { minimum_compensation_period: _omitted, ...withoutPeriod } = seededRow;
    const preferences = await readPreferences([withoutPeriod]);
    expect(preferences["minimumCompensationPeriod"]).toBe("month");
  });

  it("surfaces when the brief was last saved", async () => {
    const preferences = await readPreferences([seededRow]);
    expect(preferences["updatedAt"]).toBe("2026-09-01T10:00:00+00:00");
  });

  it("handles an account with no preferences row at all", async () => {
    const preferences = await readPreferences([]);
    expect(preferences["isConfigured"]).toBe(false);
    expect(preferences["updatedAt"]).toBeNull();
  });

  it("returns null minimumMatchScore for the signup-seeded row (no floor)", async () => {
    const preferences = await readPreferences([seededRow]);
    expect(preferences["minimumMatchScore"]).toBeNull();
    // A score floor alone is not a search brief -- see
    // packages/domain/src/preferences.ts#isPreferencesConfigured.
    expect(preferences["isConfigured"]).toBe(false);
  });

  it("returns a stored minimumMatchScore and keeps isConfigured false when it is the only thing set", async () => {
    const preferences = await readPreferences([{ ...seededRow, minimum_match_score: 70 }]);
    expect(preferences["minimumMatchScore"]).toBe(70);
    expect(preferences["isConfigured"]).toBe(false);
  });

  it("declares an output schema, without which the field descriptions reach nobody", async () => {
    const entry = register([seededRow]).get("get_job_search_preferences");
    expect(entry!.config.outputSchema).toBeDefined();
  });

  it("refuses without the profile:read scope", async () => {
    const entry = register([seededRow], []).get("get_job_search_preferences");
    const result = await entry!.handler({});
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("insufficient_scope");
  });
});

describe("get_candidate_profile", () => {
  it("declares an output schema", () => {
    const entry = register([]).get("get_candidate_profile");
    expect(entry!.config.outputSchema).toBeDefined();
  });
});

describe("output schemas are expressible as JSON Schema", () => {
  // Regression guard. The first version of these declarations reused the write
  // schemas, whose `.trim()` and `.transform()` calls have no JSON Schema
  // representation. The SDK throws while building tools/list, and because that
  // is one response for the whole catalogue, the failure is not scoped to these
  // two tools -- every tool disappears and clients see an empty server.
  it.each([
    ["jobSearchPreferencesResponseSchema", jobSearchPreferencesResponseSchema],
    ["candidateProfileResponseSchema", candidateProfileResponseSchema],
  ])("%s converts without throwing", (_name, schema) => {
    expect(() => z.toJSONSchema(schema, { io: "output" })).not.toThrow();
  });

  it("carries the field descriptions through the conversion", () => {
    // The point of declaring an outputSchema at all: without it these
    // descriptions exist only in the repository and reach no client.
    const json = JSON.stringify(z.toJSONSchema(jobSearchPreferencesResponseSchema));
    expect(json).toContain("factor of 12");
    expect(json).toContain("wide-open search");
    expect(json).toContain("POST-score");
  });

  it("publishes what relevantExperience is for", () => {
    // Most users will leave the structured lists empty now that they are
    // optional, so this field is usually the only background an agent gets.
    // If its description does not reach clients, an agent has no way to know
    // it is evidence for scoring rather than another search filter.
    const json = JSON.stringify(z.toJSONSchema(candidateProfileResponseSchema, { io: "output" }));
    expect(json).toContain("relevantExperience");
    expect(json).toContain("never a search filter");
  });
});
