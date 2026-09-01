import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { recordActivity } from "./activity";
import { registerScopedTool } from "./scoped-tool";
import type { ToolContext } from "./types";

const addNoteSchema = z.object({
  applicationId: z.uuid(),
  body: z.string().trim().min(1).max(8_000),
});

/**
 * Schema per `supabase/migrations/20250115120700_tasks_notes.sql`: `notes`
 * grants direct `insert` to `authenticated` with RLS enforcing
 * `owner_id = auth.uid()` — there is no `add_note` RPC and no
 * `mcp_client_id` column on the table itself. Provenance ("agent-authored,
 * from this MCP client") is instead recorded as a separate
 * `activity_events` row (see `activity.ts`), per docs/architecture.md's
 * "Agent writes record client identity and provenance".
 */
export function registerNoteTools(server: McpServer, ctx: ToolContext): void {
  registerScopedTool(
    server,
    ctx,
    "add_note",
    {
      title: "Add note",
      description: "Add a note to a job application, recorded as agent-authored with source provenance.",
      inputSchema: addNoteSchema,
    },
    async ({ applicationId, body }, { supabase, auth }) => {
      const row = await supabase.insert<Record<string, unknown>>(
        "notes",
        {
          owner_id: auth.extra.userId,
          application_id: applicationId,
          body,
        },
        { single: true },
      );

      await recordActivity(supabase, auth, {
        entityType: "note",
        entityId: String(row["id"]),
        eventType: "note.created",
        payload: { applicationId },
      });

      return {
        content: [{ type: "text", text: JSON.stringify(row, null, 2) }],
        structuredContent: row,
      };
    },
  );
}

