import type { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

import type { VerifiedAuthInfo } from "../auth/claims";
import type { SupabaseRestClient } from "../supabase/rest-client";
import type { ToolContext } from "../tools/types";
import { registerAllPrompts } from "./register";

type PromptHandler = (args: Record<string, string | undefined>) => {
  messages: { role: string; content: { type: string; text: string } }[];
};

interface Registered {
  config: { title?: string; description?: string };
  handler: PromptHandler;
}

function contextWith(scopes: string[]): ToolContext {
  const auth: VerifiedAuthInfo = {
    token: "token",
    clientId: "test-mcp-client",
    scopes,
    expiresAt: 0,
    extra: { userId: "11111111-1111-1111-1111-111111111111" },
  };
  const supabase = {
    get: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    count: vi.fn(),
    rpc: vi.fn(),
  } as unknown as SupabaseRestClient;
  return { auth, supabase };
}

/** Captures prompt registrations so a handler can be rendered directly. */
function registerPrompts(scopes: string[]): Map<string, Registered> {
  const prompts = new Map<string, Registered>();
  const server = {
    registerPrompt: (name: string, config: Registered["config"], handler: PromptHandler) => {
      prompts.set(name, { config, handler });
    },
  } as unknown as McpServer;

  registerAllPrompts(server, contextWith(scopes));
  return prompts;
}

function render(
  scopes: string[],
  name: string,
  args: Record<string, string | undefined> = {},
): string {
  const prompt = registerPrompts(scopes).get(name);
  if (!prompt) throw new Error(`prompt ${name} was not registered`);
  return prompt.handler(args).messages[0]!.content.text;
}

const FULL = [
  "mcp",
  "profile:read",
  "opportunities:read",
  "applications:read",
  "applications:write",
];

describe("MCP prompts", () => {
  it("registers the three repeatable workflows", () => {
    const prompts = registerPrompts(FULL);
    expect([...prompts.keys()]).toEqual([
      "weekly_job_search",
      "review_pipeline",
      "triage_proposals",
    ]);
  });

  it("gives every prompt a human-readable title and description", () => {
    for (const [, prompt] of registerPrompts(FULL)) {
      expect(prompt.config.title).toBeTruthy();
      expect(prompt.config.description).toBeTruthy();
    }
  });

  describe("weekly_job_search", () => {
    it("orders de-duplication before proposing", () => {
      const text = render(FULL, "weekly_job_search");
      expect(text.indexOf("list_known_opportunity_keys")).toBeGreaterThan(-1);
      expect(text.indexOf("list_known_opportunity_keys")).toBeLessThan(
        text.indexOf("create_job_proposals"),
      );
    });

    it("warns against re-proposing closed opportunities", () => {
      const text = render(FULL, "weekly_job_search");
      expect(text).toContain("isClosed");
      expect(text.toLowerCase()).toContain("already rejected, dismissed, or withdrew");
    });

    it("tells the agent the server does not search the web itself", () => {
      expect(render(FULL, "weekly_job_search")).toContain("does not search the internet");
    });

    it("discourages routine use of allowSimilar", () => {
      const text = render(FULL, "weekly_job_search");
      expect(text).toContain("allowSimilar");
      expect(text).toContain("cannot be overridden");
    });

    it("applies an optional focus without replacing saved preferences", () => {
      const text = render(FULL, "weekly_job_search", { focus: "remote only" });
      expect(text).toContain("remote only");
      expect(text).toContain("narrows the search rather than replacing it");
    });

    it("omits the focus section when no focus is given", () => {
      expect(render(FULL, "weekly_job_search")).not.toContain("Focus for this run");
    });

    it("honours a caller-supplied proposal cap", () => {
      expect(render(FULL, "weekly_job_search", { maxProposals: "3" })).toContain("up to 3");
    });

    it("defaults the cap when the argument is blank", () => {
      expect(render(FULL, "weekly_job_search", { maxProposals: "  " })).toContain("up to 10");
    });

    // The point of building prompts from granted scopes: an agent should never
    // be told to call a tool this grant will refuse.
    it("does not instruct a read-only client to create proposals", () => {
      const text = render(["mcp", "applications:read"], "weekly_job_search");
      expect(text).toContain("was not granted `applications:write`");
      expect(text).toContain("nothing was written");
      expect(text).not.toContain("Call `create_job_proposals`");
    });

    it("explains the loss of local de-duplication without opportunities:read", () => {
      const text = render(
        ["mcp", "profile:read", "applications:read", "applications:write"],
        "weekly_job_search",
      );
      expect(text).toContain("was not granted `opportunities:read`");
      expect(text).toContain("cannot filter locally");
    });

    it("falls back to asking the user when the profile is unreadable", () => {
      const text = render(["mcp", "applications:read"], "weekly_job_search");
      expect(text).toContain("was not granted `profile:read`");
      expect(text).toContain("describe what they are looking for");
    });
  });

  describe("review_pipeline", () => {
    it("refuses usefully when the pipeline cannot be read at all", () => {
      const text = render(["mcp"], "review_pipeline");
      expect(text).toContain("was not granted `applications:read`");
      expect(text).not.toContain("get_job_search_dashboard");
    });

    it("uses the caller's horizon and defaults when absent", () => {
      expect(render(FULL, "review_pipeline", { horizon: "next 3 days" })).toContain("next 3 days");
      expect(render(FULL, "review_pipeline")).toContain("this week");
    });

    it("asks before creating follow-ups when it may write", () => {
      const text = render(FULL, "review_pipeline");
      expect(text).toContain("create_follow_up");
      expect(text).toContain("Ask first");
    });

    it("only suggests actions when it may not write", () => {
      const text = render(["mcp", "applications:read"], "review_pipeline");
      expect(text).toContain("was not granted `applications:write`");
      expect(text).toContain("add themselves");
    });
  });

  describe("triage_proposals", () => {
    it("reads the inbox by proposed status", () => {
      expect(render(FULL, "triage_proposals")).toContain('status: "proposed"');
    });

    // Deleting would drop the row out of the de-duplication key set, so a
    // future run would happily propose the same job again.
    it("forbids deleting and explains why closing is different", () => {
      const text = render(FULL, "triage_proposals");
      expect(text).toContain("Never delete");
      expect(text).toContain("de-duplication set");
    });

    it("keeps the user as the decision-maker", () => {
      expect(render(FULL, "triage_proposals")).toContain("Move only what they explicitly approved");
    });

    it("degrades to recommendations without write scope", () => {
      const text = render(["mcp", "applications:read"], "triage_proposals");
      expect(text).toContain("was not granted `applications:write`");
      expect(text).not.toContain("Once the user confirms");
    });
  });
});
