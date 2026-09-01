import { describe, expect, it } from "vitest";

import { ALL_SCOPES, requiredScopesFor, SCOPES, TOOL_NAMES, TOOL_SCOPES } from "./scope-catalog";

describe("tool scope catalog", () => {
  it("declares a scope requirement for every known tool", () => {
    for (const tool of TOOL_NAMES) {
      expect(TOOL_SCOPES[tool].length).toBeGreaterThan(0);
    }
  });

  it("only references scopes present in the catalog", () => {
    for (const tool of TOOL_NAMES) {
      for (const scope of TOOL_SCOPES[tool]) {
        expect(ALL_SCOPES).toContain(scope);
      }
    }
  });

  it("gates destructive tools behind the delete scope", () => {
    expect(requiredScopesFor("prepare_destructive_operation")).toEqual([SCOPES.applicationsDelete]);
    expect(requiredScopesFor("confirm_operation")).toEqual([SCOPES.applicationsDelete]);
  });

  it("gates mutating tools behind the write scope", () => {
    expect(requiredScopesFor("create_job_proposals")).toEqual([SCOPES.applicationsWrite]);
    expect(requiredScopesFor("move_application_status")).toEqual([SCOPES.applicationsWrite]);
    expect(requiredScopesFor("create_follow_up")).toEqual([SCOPES.applicationsWrite]);
    expect(requiredScopesFor("complete_follow_up")).toEqual([SCOPES.applicationsWrite]);
    expect(requiredScopesFor("add_note")).toEqual([SCOPES.applicationsWrite]);
  });

  it("gates profile tools behind the profile read scope", () => {
    expect(requiredScopesFor("get_candidate_profile")).toEqual([SCOPES.profileRead]);
    expect(requiredScopesFor("get_job_search_preferences")).toEqual([SCOPES.profileRead]);
  });
});
