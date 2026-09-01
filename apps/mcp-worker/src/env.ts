/**
 * Cloudflare Worker bindings for the MCP resource server.
 *
 * All values are configured per environment via `.dev.vars` locally or
 * `wrangler secret put` / `vars` in production. Nothing here is a secret
 * committed to source control.
 */
export interface McpWorkerEnv {
  /** Base URL of the Supabase project, e.g. https://<project>.supabase.co */
  SUPABASE_URL: string;
  /** Supabase anon/publishable key sent as the PostgREST `apikey` header. */
  SUPABASE_ANON_KEY: string;
  /**
   * Expected `iss` claim on Supabase-issued access tokens. Defaults to
   * `${SUPABASE_URL}/auth/v1` when unset.
   */
  SUPABASE_JWT_ISSUER?: string;
  /** Expected `aud` claim on Supabase-issued access tokens. */
  SUPABASE_JWT_AUDIENCE: string;
  /** Public URL this Worker is deployed at, used for OAuth resource metadata. */
  MCP_RESOURCE_URL: string;
  /** Comma-separated hostnames allowed in the `Host` header (DNS-rebinding guard). */
  MCP_ALLOWED_HOSTNAMES: string;
  /** Scope required to use the MCP endpoint at all. Defaults to `mcp`. */
  MCP_REQUIRED_SCOPE?: string;
}

export interface ResolvedMcpConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  jwtIssuer: string;
  jwtAudience: string;
  resourceUrl: string;
  allowedHostnames: string[];
  requiredScope: string;
}

const DEFAULT_REQUIRED_SCOPE = "mcp";

/**
 * Normalizes and validates the raw Worker environment into a config object
 * the rest of the app can use without re-parsing strings everywhere.
 * Throws a descriptive error at startup if required bindings are missing,
 * rather than failing confusingly deep inside a request handler.
 */
export function resolveConfig(env: McpWorkerEnv): ResolvedMcpConfig {
  const missing = (
    [
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_JWT_AUDIENCE",
      "MCP_RESOURCE_URL",
      "MCP_ALLOWED_HOSTNAMES",
    ] as const
  ).filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required MCP Worker configuration: ${missing.join(", ")}`);
  }

  const supabaseUrl = env.SUPABASE_URL.replace(/\/+$/, "");
  const allowedHostnames = (env.MCP_ALLOWED_HOSTNAMES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    supabaseUrl,
    supabaseAnonKey: env.SUPABASE_ANON_KEY,
    jwtIssuer: env.SUPABASE_JWT_ISSUER?.replace(/\/+$/, "") ?? `${supabaseUrl}/auth/v1`,
    jwtAudience: env.SUPABASE_JWT_AUDIENCE,
    resourceUrl: env.MCP_RESOURCE_URL.replace(/\/+$/, ""),
    allowedHostnames,
    requiredScope: env.MCP_REQUIRED_SCOPE?.trim() || DEFAULT_REQUIRED_SCOPE,
  };
}
