import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { clampLimit, clampOffset, eqFilter } from "../supabase/query";
import { recordActivity } from "./activity";
import { registerScopedTool } from "./scoped-tool";
import type { ToolContext } from "./types";

const listFollowUpsSchema = z.object({
  applicationId: z.uuid().optional(),
  includeCompleted: z.boolean().optional(),
  limit: z.number().int().min(1).max(50).optional(),
  offset: z.number().int().min(0).max(10_000).optional(),
});

const createFollowUpSchema = z.object({
  applicationId: z.uuid(),
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(4_000).optional(),
  dueAt: z.iso.datetime().optional(),
});

const completeFollowUpSchema = z.object({
  followUpId: z.uuid(),
});

const FOLLOW_UP_SELECT = "id,application_id,title,description,due_at,is_completed,completed_at";

/**
 * Schema per `supabase/migrations/20250115120700_tasks_notes.sql`: follow-up
 * items live in the `tasks` table (no dedicated `follow_ups` table, no RPC
 * layer, no `mcp_client_id` column). `tasks` grants `select, insert,
 * update, delete` directly to `authenticated`, with RLS enforcing
 * `owner_id = auth.uid()` — so this Worker performs plain REST
 * insert/update calls and records provenance separately via
 * `activity_events` (see `activity.ts`). `completed_at` is synced
 * automatically by the `app.sync_task_completion()` trigger whenever
 * `is_completed` changes.
 */
export function registerFollowUpTools(server: McpServer, ctx: ToolContext): void {
  registerScopedTool(
    server,
    ctx,
    "list_follow_ups",
    {
      title: "List follow-ups",
      description: "List the user's follow-up tasks, optionally scoped to one application, ordered by due date.",
      inputSchema: listFollowUpsSchema,
    },
    async ({ applicationId, includeCompleted, limit, offset }, { supabase }) => {
      const filters: Record<string, string> = {};
      if (applicationId) {
        filters.application_id = eqFilter(applicationId);
      }
      if (!includeCompleted) {
        filters.is_completed = eqFilter("false");
      }

      const rows = await supabase.get<Array<Record<string, unknown>>>("tasks", {
        select: FOLLOW_UP_SELECT,
        filters,
        order: "due_at.asc",
        limit: clampLimit(limit),
        offset: clampOffset(offset),
      });

      return {
        content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
        structuredContent: rows,
      };
    },
  );

  registerScopedTool(
    server,
    ctx,
    "create_follow_up",
    {
      title: "Create follow-up",
      description: "Create a follow-up task for a job application.",
      inputSchema: createFollowUpSchema,
    },
    async ({ applicationId, title, notes, dueAt }, { supabase, auth }) => {
      const row = await supabase.insert<Record<string, unknown>>(
        "tasks",
        {
          owner_id: auth.extra.userId,
          application_id: applicationId,
          title,
          description: notes ?? null,
          due_at: dueAt ?? null,
        },
        { single: true },
      );

      await recordActivity(supabase, auth, {
        entityType: "task",
        entityId: String(row["id"]),
        eventType: "task.created",
        payload: { applicationId },
      });

      return {
        content: [{ type: "text", text: JSON.stringify(row, null, 2) }],
        structuredContent: row,
      };
    },
  );

  registerScopedTool(
    server,
    ctx,
    "complete_follow_up",
    {
      title: "Complete follow-up",
      description: "Mark a follow-up task as complete.",
      inputSchema: completeFollowUpSchema,
    },
    async ({ followUpId }, { supabase, auth }) => {
      const row = await supabase.update<Record<string, unknown>>(
        "tasks",
        { id: eqFilter(followUpId) },
        { is_completed: true },
        { single: true },
      );

      await recordActivity(supabase, auth, {
        entityType: "task",
        entityId: followUpId,
        eventType: "task.completed",
      });

      return {
        content: [{ type: "text", text: JSON.stringify(row, null, 2) }],
        structuredContent: row,
      };
    },
  );
}

