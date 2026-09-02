import { describe, expect, it } from "vitest";

import {
  MCP_GATE_SCOPE,
  MCP_SCOPES,
  MCP_SCOPE_CATALOG,
  defaultMcpScopes,
  mcpScopeSelectionSchema,
  normalizeMcpScopes,
} from "./mcpScopes";

describe("MCP_SCOPE_CATALOG", () => {
  it("describes every scope exactly once", () => {
    expect(MCP_SCOPE_CATALOG.map((entry) => entry.scope)).toEqual([...MCP_SCOPES]);
  });

  it("marks only the gate scope as required, so the user can decline everything else", () => {
    const required = MCP_SCOPE_CATALOG.filter((entry) => entry.required);
    expect(required.map((entry) => entry.scope)).toEqual([MCP_GATE_SCOPE]);
  });

  it("never pre-selects a sensitive scope", () => {
    const preselectedSensitive = MCP_SCOPE_CATALOG.filter(
      (entry) => entry.sensitive && entry.recommended,
    );
    expect(preselectedSensitive).toEqual([]);
  });

  it("recommends read access but not writes, so consent starts least-privilege", () => {
    expect(defaultMcpScopes()).toEqual([
      "mcp",
      "profile:read",
      "opportunities:read",
      "applications:read",
    ]);
  });
});

describe("normalizeMcpScopes", () => {
  it("forces the gate scope on so a stale client cannot lock the user out", () => {
    expect(normalizeMcpScopes(["profile:read"])).toEqual(["mcp", "profile:read"]);
    expect(normalizeMcpScopes([])).toEqual(["mcp"]);
  });

  it("deduplicates", () => {
    expect(normalizeMcpScopes(["mcp", "mcp", "profile:read", "profile:read"])).toEqual([
      "mcp",
      "profile:read",
    ]);
  });

  it("orders by the catalogue rather than by submission order", () => {
    expect(normalizeMcpScopes(["applications:write", "profile:read", "mcp"])).toEqual([
      "mcp",
      "profile:read",
      "applications:write",
    ]);
  });

  it("drops values that are not real scopes", () => {
    expect(normalizeMcpScopes(["profile:read", "applications:superuser", ""])).toEqual([
      "mcp",
      "profile:read",
    ]);
  });
});

describe("mcpScopeSelectionSchema", () => {
  it("normalizes an accepted selection", () => {
    expect(mcpScopeSelectionSchema.parse(["applications:read", "mcp", "mcp"])).toEqual([
      "mcp",
      "applications:read",
    ]);
  });

  it("adds the gate scope to an empty selection", () => {
    expect(mcpScopeSelectionSchema.parse([])).toEqual(["mcp"]);
  });

  // Unlike normalizeMcpScopes, the schema is the trust boundary: an unknown
  // scope here means the caller and this build disagree about the catalogue,
  // which should surface as an error rather than be silently narrowed.
  it("rejects an unknown scope instead of ignoring it", () => {
    expect(mcpScopeSelectionSchema.safeParse(["applications:superuser"]).success).toBe(false);
  });

  it("rejects a non-array payload", () => {
    expect(mcpScopeSelectionSchema.safeParse("mcp").success).toBe(false);
    expect(mcpScopeSelectionSchema.safeParse(null).success).toBe(false);
  });

  it("rejects a selection longer than the catalogue", () => {
    const padded = Array.from({ length: MCP_SCOPES.length + 1 }, () => "mcp");
    expect(mcpScopeSelectionSchema.safeParse(padded).success).toBe(false);
  });
});
