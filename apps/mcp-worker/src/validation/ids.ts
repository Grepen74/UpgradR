import { z } from "zod";

/** Postgres `uuid` primary/foreign keys accepted from tool input. */
export const uuidSchema = z.uuid();

/** Free-text search query, bounded to a sane length to avoid abusive scans. */
export const searchQuerySchema = z.string().trim().min(1).max(200);

export const paginationSchema = z.object({
  limit: z.number().int().min(1).max(50).optional(),
  offset: z.number().int().min(0).max(10_000).optional(),
});
