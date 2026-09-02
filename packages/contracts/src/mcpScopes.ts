import { z } from "zod";

/**
 * The MCP authorization catalogue, shared by the MCP Worker (which enforces
 * scopes per tool), the web consent screen (which asks the user to choose
 * them), and the web Worker (which validates and persists the choice).
 *
 * Supabase's OAuth server only issues the five standard OIDC scopes and
 * rejects anything else at `/authorize`, so an MCP client cannot declare the
 * access it wants through the usual `scope` parameter. These scopes are
 * therefore granted by the user on the consent screen, recorded in
 * `public.mcp_grant_scopes`, and injected into the access token by the
 * `app.mcp_access_token_hook` auth hook. See docs/mcp.md.
 */
export const MCP_GATE_SCOPE = "mcp";

export const MCP_SCOPES = [
  "mcp",
  "profile:read",
  "opportunities:read",
  "applications:read",
  "applications:write",
  "applications:delete",
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

export interface McpScopeDescriptor {
  scope: McpScope;
  label: string;
  description: string;
  /** Pre-selected on the consent screen. */
  recommended: boolean;
  /**
   * Requires a deliberate extra action to enable, and is never pre-selected.
   * Deletion is additionally protected by the two-step
   * prepare/confirm flow, but granting it at all should be a conscious choice.
   */
  sensitive: boolean;
  /** Cannot be deselected: without it the MCP endpoint rejects every request. */
  required: boolean;
}

export const MCP_SCOPE_CATALOG: McpScopeDescriptor[] = [
  {
    scope: "mcp",
    label: "Connect as an agent",
    description: "Allows this client to reach your workspace at all. Required.",
    recommended: true,
    sensitive: false,
    required: true,
  },
  {
    scope: "profile:read",
    label: "Read your career profile",
    description:
      "Your confirmed experience, education, skills, and job search preferences. Unreviewed imports are never shared.",
    recommended: true,
    sensitive: false,
    required: false,
  },
  {
    scope: "opportunities:read",
    label: "Check for duplicates",
    description:
      "Lets the agent see which opportunities you already track so it does not propose the same job twice.",
    recommended: true,
    sensitive: false,
    required: false,
  },
  {
    scope: "applications:read",
    label: "Read your pipeline",
    description:
      "Your opportunities, statuses, follow-ups, notes, and document titles.",
    recommended: true,
    sensitive: false,
    required: false,
  },
  {
    scope: "applications:write",
    label: "Add and update opportunities",
    description:
      "Create job proposals in your Inbox, move cards between columns, and add follow-ups and notes.",
    recommended: false,
    sensitive: false,
    required: false,
  },
  {
    scope: "applications:delete",
    label: "Delete opportunities and notes",
    description:
      "Permanently remove items. Every deletion still requires a separate confirmation step.",
    recommended: false,
    sensitive: true,
    required: false,
  },
];

export const mcpScopeSchema = z.enum(MCP_SCOPES);

/**
 * Consent and grant-editing payloads. `mcp` is forced on rather than rejected
 * when missing, so a client that stores a stale scope list cannot lock a user
 * out of their own grant.
 */
export const mcpScopeSelectionSchema = z
  .array(mcpScopeSchema)
  .max(MCP_SCOPES.length)
  .transform((scopes) => normalizeMcpScopes(scopes));

/** Deduplicates, forces the gate scope on, and orders by the catalogue. */
export function normalizeMcpScopes(scopes: readonly string[]): McpScope[] {
  const selected = new Set<string>(scopes);
  selected.add(MCP_GATE_SCOPE);
  return MCP_SCOPES.filter((scope) => selected.has(scope));
}

export function defaultMcpScopes(): McpScope[] {
  return MCP_SCOPE_CATALOG.filter((entry) => entry.recommended).map((entry) => entry.scope);
}
