/**
 * Maps each MCP tool to the scope(s) it requires beyond the baseline
 * `MCP_REQUIRED_SCOPE` gate enforced on the whole `/mcp` endpoint.
 *
 * Kept as a plain data table (rather than scattering scope checks across
 * tool handlers) so the full authorization surface can be read and tested
 * in one place.
 */
export const SCOPES = {
  profileRead: "profile:read",
  opportunitiesRead: "opportunities:read",
  applicationsRead: "applications:read",
  applicationsWrite: "applications:write",
  applicationsDelete: "applications:delete",
} as const;

export type McpScope = (typeof SCOPES)[keyof typeof SCOPES];

export const ALL_SCOPES: McpScope[] = Object.values(SCOPES);

export const TOOL_NAMES = [
  "get_candidate_profile",
  "get_job_search_preferences",
  "search_existing_opportunities",
  "get_job_search_dashboard",
  "search_applications",
  "get_application",
  "create_job_proposals",
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
  get_job_search_dashboard: [SCOPES.applicationsRead],
  search_applications: [SCOPES.applicationsRead],
  get_application: [SCOPES.applicationsRead],
  create_job_proposals: [SCOPES.applicationsWrite],
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
