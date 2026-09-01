import type { McpServer } from "@modelcontextprotocol/server";

import { registerApplicationTools } from "./applications";
import { registerDestructiveTools } from "./destructive";
import { registerFollowUpTools } from "./follow-ups";
import { registerNoteTools } from "./notes";
import { registerOpportunityTools } from "./opportunities";
import { registerProfileTools } from "./profile";
import type { ToolContext } from "./types";

/** Registers all 14 goal-oriented MCP tools against a fresh per-request `McpServer`. */
export function registerAllTools(server: McpServer, ctx: ToolContext): void {
  registerProfileTools(server, ctx);
  registerOpportunityTools(server, ctx);
  registerApplicationTools(server, ctx);
  registerFollowUpTools(server, ctx);
  registerNoteTools(server, ctx);
  registerDestructiveTools(server, ctx);
}
