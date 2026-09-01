import { McpServer, type AuthInfo, type McpServerFactory } from "@modelcontextprotocol/server";

import type { VerifiedAuthInfo } from "./auth/claims";
import type { ResolvedMcpConfig } from "./env";
import { createSupabaseRestClient } from "./supabase/rest-client";
import { registerAllTools } from "./tools/register";

/**
 * Builds the per-request `McpServer` factory `createMcpHandler` expects.
 * A fresh server instance is created for every HTTP request (no shared
 * mutable state between callers), bound to the verified caller's own
 * Supabase access token so every downstream REST/RPC call runs under that
 * user's row-level security policies.
 */
export function createServerFactory(config: ResolvedMcpConfig): McpServerFactory {
  return ({ authInfo }): McpServer => {
    if (!authInfo) {
      // requireBearerAuth always resolves an AuthInfo or a challenge Response
      // before the factory runs; this only guards against a future wiring
      // mistake rather than an expected runtime path.
      throw new Error("MCP server factory invoked without verified auth info");
    }

    const verifiedAuth = asVerifiedAuthInfo(authInfo);
    const server = new McpServer({ name: "upgradr-mcp-worker", version: "0.1.0" });
    const supabase = createSupabaseRestClient({
      baseUrl: config.supabaseUrl,
      anonKey: config.supabaseAnonKey,
      accessToken: verifiedAuth.token,
    });

    registerAllTools(server, { auth: verifiedAuth, supabase });
    return server;
  };
}

function asVerifiedAuthInfo(authInfo: AuthInfo): VerifiedAuthInfo {
  const userId = authInfo.extra?.["userId"];
  if (authInfo.expiresAt === undefined || typeof userId !== "string" || userId.length === 0) {
    throw new Error("MCP server factory received incomplete auth info");
  }

  return {
    token: authInfo.token,
    clientId: authInfo.clientId,
    scopes: authInfo.scopes,
    expiresAt: authInfo.expiresAt,
    extra: { userId },
  };
}
