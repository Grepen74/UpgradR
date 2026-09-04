/**
 * Maps each MCP tool to the scope(s) it requires beyond the baseline
 * `MCP_REQUIRED_SCOPE` gate enforced on the whole `/mcp` endpoint.
 *
 * Kept as a plain data table (rather than scattering scope checks across
 * tool handlers) so the full authorization surface can be read and tested
 * in one place. The scope strings themselves come from `@upgradr/contracts`
 * so the Worker, the consent screen, and the database check constraint can
 * never drift apart.
 */
import type { McpScope as ContractMcpScope } from "@upgradr/contracts";

export const SCOPES = {
  profileRead: "profile:read",
  opportunitiesRead: "opportunities:read",
  applicationsRead: "applications:read",
  applicationsWrite: "applications:write",
  applicationsDelete: "applications:delete",
} as const satisfies Record<string, ContractMcpScope>;


export type McpScope = (typeof SCOPES)[keyof typeof SCOPES];

export const ALL_SCOPES: McpScope[] = Object.values(SCOPES);

export const TOOL_NAMES = [
  "get_candidate_profile",
  "get_job_search_preferences",
  "search_existing_opportunities",
  "list_known_opportunity_keys",
  "get_job_search_dashboard",
  "search_applications",
  "get_application",
  "create_job_proposals",
  "assess_job_match",
  "move_application_status",
  "list_follow_ups",
  "create_follow_up",
  "complete_follow_up",
  "add_note",
  "prepare_destructive_operation",
  "confirm_operation",
] as const;

export type McpToolName = (typeof TOOL_NAMES)[number];

export const TOOL_SCOPES: Record<McpToolName, McpScope[]> = {
  get_candidate_profile: [SCOPES.profileRead],
  get_job_search_preferences: [SCOPES.profileRead],
  search_existing_opportunities: [SCOPES.opportunitiesRead],
  list_known_opportunity_keys: [SCOPES.opportunitiesRead],
  get_job_search_dashboard: [SCOPES.applicationsRead],
  search_applications: [SCOPES.applicationsRead],
  get_application: [SCOPES.applicationsRead],
  create_job_proposals: [SCOPES.applicationsWrite],
  // Both, and not as a formality: record_job_match_assessment reads the
  // opportunity before it writes, and re-scoring a job an agent is not allowed
  // to look at is not a coherent operation.
  assess_job_match: [SCOPES.applicationsRead, SCOPES.applicationsWrite],
  move_application_status: [SCOPES.applicationsWrite],
  list_follow_ups: [SCOPES.applicationsRead],
  create_follow_up: [SCOPES.applicationsWrite],
  complete_follow_up: [SCOPES.applicationsWrite],
  add_note: [SCOPES.applicationsWrite],
  prepare_destructive_operation: [SCOPES.applicationsDelete],
  confirm_operation: [SCOPES.applicationsDelete],
};

export function requiredScopesFor(tool: McpToolName): McpScope[] {
  return TOOL_SCOPES[tool];
}
