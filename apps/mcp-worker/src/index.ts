import {
  OAuthError,
  OAuthErrorCode,
  bearerAuthChallengeResponse,
  createMcpHandler,
  hostHeaderValidationResponse,
  originValidationResponse,
  requireBearerAuth,
} from "@modelcontextprotocol/server";
import { Hono } from "hono";

import { verifyAccessToken } from "./auth/jwt-verifier";
import { resolveConfig, type McpWorkerEnv, type ResolvedMcpConfig } from "./env";
import { buildProtectedResourceMetadata, protectedResourceMetadataPath } from "./metadata";
import { createServerFactory } from "./server";

const app = new Hono<{ Bindings: McpWorkerEnv }>();

// DNS-rebinding / cross-origin protection for every route, mirroring the
// guidance for bare fetch-native runtimes in the SDK's web-standard hosting
// docs (createMcpHonoApp's equivalent, without taking on that extra
// dependency). Resolving config here first also means a missing/misspelled
// secret or var now fails *every* route -- including /health -- with a
// clear, uniform 503 "misconfigured" response instead of the generic 500
// `onError` would otherwise produce, so uptime monitors and deploy gates
// (see docs/operations.md) can tell "not configured" apart from "internal
// bug" without depending on log access.
app.use("*", async (context, next) => {
  let config: ResolvedMcpConfig;
  try {
    config = resolveConfig(context.env);
  } catch (error) {
    // The underlying error names which binding is missing; useful for an
    // operator reading Worker logs but not for an unauthenticated caller.
    console.error("MCP Worker misconfigured", error);
    return context.json({ error: "Service unavailable: invalid configuration" }, 503);
  }
  // Both helpers take bare, port-agnostic hostnames (not full origin URLs);
  // a request with no Origin header always passes originValidationResponse.
  const rejected =
    hostHeaderValidationResponse(context.req.raw, config.allowedHostnames) ??
    originValidationResponse(context.req.raw, config.allowedHostnames);
  if (rejected) {
    return rejected;
  }
  await next();
});

app.get("/health", (context) =>
  context.json({ service: "upgradr-mcp-worker", status: "ok", time: new Date().toISOString() }),
);

app.get(protectedResourceMetadataPath(), (context) => {
  const config = resolveConfig(context.env);
  return context.json(buildProtectedResourceMetadata(config), 200, {
    "Cache-Control": "public, max-age=300",
  });
});

app.all("/mcp", async (context) => {
  const config = resolveConfig(context.env);
  const resourceMetadataUrl = new URL(protectedResourceMetadataPath(), config.resourceUrl).toString();

  // Deliberately NOT `requiredScopes: [config.requiredScope]` here. The SDK's
  // `requireBearerAuth` folds its `requiredScopes` into the `WWW-Authenticate`
  // `scope="..."` challenge parameter on every 401/403 response (see
  // `buildWwwAuthenticateHeader` in the SDK) -- confirmed live against this
  // Worker (`curl -D- .../mcp`) before this fix returned
  // `scope="mcp"`. MCP clients read that RFC 6750 hint to build the `scope=`
  // parameter of their `/authorize` request, but Supabase's OAuth server has
  // no concept of an app-defined "mcp" scope (it only supports its five
  // built-in OIDC/offline scopes) and rejects the request before the user
  // ever reaches our own `/oauth/consent` screen, where the real "mcp" grant
  // is recorded (`supabase/migrations/20250115122000_mcp_grant_scopes.sql`).
  // The requirement itself is still enforced below, just after verification,
  // so it never leaks into the OAuth-facing challenge.
  const gate = requireBearerAuth({
    verifier: {
      async verifyAccessToken(token: string) {
        try {
          return await verifyAccessToken(token, { issuer: config.jwtIssuer, audience: config.jwtAudience });
        } catch {
          throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid or expired access token");
        }
      },
    },
    resourceMetadataUrl,
  });

  const authResult = await gate(context.req.raw);
  if (authResult instanceof Response) {
    return authResult;
  }

  if (!authResult.scopes.includes(config.requiredScope)) {
    return bearerAuthChallengeResponse(new OAuthError(OAuthErrorCode.InsufficientScope, "Insufficient scope"), {
      resourceMetadataUrl,
    });
  }

  // A fresh handler (and fresh McpServer via the factory) per request keeps
  // the endpoint stateless: no session or tool registration is shared
  // between callers or requests.
  const handler = createMcpHandler(createServerFactory(config));
  return handler.fetch(context.req.raw, { authInfo: authResult });
});

app.notFound((context) => context.json({ error: "Not found" }, 404));

app.onError((error, context) => {
  console.error("Unhandled MCP Worker error", error);
  return context.json({ error: "Internal server error" }, 500);
});

export default app;
