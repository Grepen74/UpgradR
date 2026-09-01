import { ToolProgrammingError, UpstreamError } from "../http/errors";
import { buildRestUrl, clampLimit, clampOffset } from "./query";

/**
 * Minimal PostgREST client used by every tool. Per the architecture, the MCP
 * Worker never uses the Supabase service-role key — it forwards the caller's
 * already-verified user access token as the PostgREST `Authorization` bearer
 * so Postgres row-level security remains the authorization boundary for all
 * data access, exactly as it does for the web app.
 */
export interface SupabaseRestClientConfig {
  baseUrl: string;
  anonKey: string;
  /** The user's Supabase access token — the same token verified for MCP auth. */
  accessToken: string;
}

export interface RestGetOptions {
  select?: string;
  /** Column -> PostgREST filter value, e.g. `{ id: eqFilter(id) }`. */
  filters?: Record<string, string>;
  order?: string;
  limit?: number;
  offset?: number;
  /** Request a single JSON object instead of an array (PostgREST "single" mode). */
  single?: boolean;
}

export interface RestWriteOptions {
  /** Return the written row(s) instead of an empty response body. Defaults to true. */
  returning?: boolean;
  /** Expect exactly one row back (PostgREST "single" object mode). */
  single?: boolean;
}

export interface SupabaseRestClient {
  get<T>(path: string, options?: RestGetOptions): Promise<T>;
  /** Bulk or single-row insert. `body` may be one object or an array of objects. */
  insert<T>(
    path: string,
    body: Record<string, unknown> | Record<string, unknown>[],
    options?: RestWriteOptions,
  ): Promise<T>;
  /** Updates rows matching `filters`. */
  update<T>(
    path: string,
    filters: Record<string, string>,
    body: Record<string, unknown>,
    options?: RestWriteOptions,
  ): Promise<T>;
  /** Deletes rows matching `filters`. Always requires at least one filter. */
  remove(path: string, filters: Record<string, string>): Promise<void>;
  /** Exact row count for `path` matching `filters`, without transferring row data. */
  count(path: string, filters?: Record<string, string>): Promise<number>;
  rpc<T>(name: string, body: Record<string, unknown>): Promise<T>;
}

function buildHeaders(config: SupabaseRestClientConfig, extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: config.anonKey,
    Authorization: `Bearer ${config.accessToken}`,
    ...extra,
  };
}

/**
 * Extracts only the machine-readable `code` from a PostgREST/PostgreSQL
 * error body (e.g. `{"code":"23505","message":"...","details":"Key
 * (email)=(user@example.com) already exists.","hint":null}`). The raw body
 * is never logged: `details`/`message` on constraint violations can embed
 * literal row values, which would otherwise leak user data into Worker
 * logs. See docs/operations.md's logging guidance.
 */
function safeErrorCode(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { code?: unknown };
    return typeof parsed.code === "string" ? parsed.code : undefined;
  } catch {
    return undefined;
  }
}

async function readError(res: Response, context: string): Promise<never> {
  const body = await res.text().catch(() => "");
  console.error("Supabase request failed", {
    context,
    status: res.status,
    code: safeErrorCode(body) ?? "unknown",
  });
  throw new UpstreamError(res.status);
}

function writePreferHeader(options: RestWriteOptions): string {
  // return=minimal skips echoing the row back for callers that don't need it
  // (a marginal cost saving); every current call site sets returning=true.
  return options.returning === false ? "return=minimal" : "return=representation";
}

export function createSupabaseRestClient(config: SupabaseRestClientConfig): SupabaseRestClient {
  return {
    async get<T>(path: string, options: RestGetOptions = {}): Promise<T> {
      const url = buildRestUrl(config.baseUrl, path, {
        select: options.select,
        order: options.order,
        limit: options.limit === undefined ? undefined : String(clampLimit(options.limit)),
        offset: options.offset === undefined ? undefined : String(clampOffset(options.offset)),
        ...options.filters,
      });

      const res = await fetch(url, {
        headers: buildHeaders(config, options.single ? { Accept: "application/vnd.pgrst.object+json" } : undefined),
      });

      if (!res.ok) {
        return readError(res, `GET ${path}`);
      }
      return (await res.json()) as T;
    },

    async insert<T>(
      path: string,
      body: Record<string, unknown> | Record<string, unknown>[],
      options: RestWriteOptions = {},
    ): Promise<T> {
      const url = buildRestUrl(config.baseUrl, path, {});
      const res = await fetch(url, {
        method: "POST",
        headers: buildHeaders(config, {
          "Content-Type": "application/json",
          Prefer: writePreferHeader(options),
          ...(options.single ? { Accept: "application/vnd.pgrst.object+json" } : {}),
        }),
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        return readError(res, `POST ${path}`);
      }
      if (options.returning === false) {
        return undefined as T;
      }
      return (await res.json()) as T;
    },

    async update<T>(
      path: string,
      filters: Record<string, string>,
      body: Record<string, unknown>,
      options: RestWriteOptions = {},
    ): Promise<T> {
      const url = buildRestUrl(config.baseUrl, path, { ...filters });
      const res = await fetch(url, {
        method: "PATCH",
        headers: buildHeaders(config, {
          "Content-Type": "application/json",
          Prefer: writePreferHeader(options),
          ...(options.single ? { Accept: "application/vnd.pgrst.object+json" } : {}),
        }),
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        return readError(res, `PATCH ${path}`);
      }
      if (options.returning === false) {
        return undefined as T;
      }
      return (await res.json()) as T;
    },

    async remove(path: string, filters: Record<string, string>): Promise<void> {
      if (Object.keys(filters).length === 0) {
        // A filter-less DELETE would target every row visible to this
        // caller's RLS policy; refuse it rather than risk a bulk delete
        // triggered by a coding mistake upstream.
        throw new ToolProgrammingError(`remove(${path}) requires at least one filter`);
      }

      const url = buildRestUrl(config.baseUrl, path, { ...filters });
      const res = await fetch(url, {
        method: "DELETE",
        headers: buildHeaders(config, { Prefer: "return=minimal" }),
      });

      if (!res.ok) {
        return readError(res, `DELETE ${path}`);
      }
    },

    async count(path: string, filters: Record<string, string> = {}): Promise<number> {
      const url = buildRestUrl(config.baseUrl, path, { select: "id", limit: "1", ...filters });
      const res = await fetch(url, {
        method: "HEAD",
        headers: buildHeaders(config, { Prefer: "count=exact" }),
      });

      if (!res.ok) {
        return readError(res, `HEAD ${path}`);
      }

      const contentRange = res.headers.get("content-range");
      const total = contentRange?.split("/")[1];
      const parsed = total === undefined ? NaN : Number.parseInt(total, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    },

    async rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
      const url = new URL(`${config.baseUrl}/rest/v1/rpc/${name}`);
      const res = await fetch(url, {
        method: "POST",
        headers: buildHeaders(config, { "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        return readError(res, `RPC ${name}`);
      }
      return (await res.json()) as T;
    },
  };
}
