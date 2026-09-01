import { createRemoteJWKSet, jwtVerify } from "jose";

import { ClaimsError, mapClaimsToAuthInfo, type VerifiedAuthInfo } from "./claims";

/**
 * Verifies Supabase-issued Streamable HTTP MCP access tokens against the
 * project's published JWKS. Supabase Auth exposes asymmetric signing keys at
 * `${issuer}/.well-known/jwks.json`; this avoids ever holding a shared HMAC
 * secret in the Worker.
 *
 * `jose` is used instead of a hand-rolled verifier because it is Web Crypto
 * based and runs unmodified on Cloudflare Workers, Deno, and Node.
 */

const ALLOWED_ALGORITHMS = ["RS256", "ES256"];
const MAX_TOKEN_LENGTH = 8_192;
const CLOCK_TOLERANCE_SECONDS = 5;

// `createRemoteJWKSet` keeps its own in-memory key cache and de-duplicates
// concurrent fetches; caching the instance per issuer lets that cache
// survive across requests within the same Worker isolate.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(issuer: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    jwksCache.set(issuer, jwks);
  }
  return jwks;
}

export class InvalidTokenError extends Error {
  constructor(message = "Invalid or expired access token") {
    super(message);
    this.name = "InvalidTokenError";
  }
}

export interface JwtVerifierConfig {
  issuer: string;
  audience: string;
}

/**
 * Verifies signature, issuer, audience, expiry, and claim shape. Every
 * failure path collapses to `InvalidTokenError` with a generic message —
 * signature/library internals are logged (`console.error`) but never
 * returned to the caller, per the "safe errors" requirement.
 */
export async function verifyAccessToken(token: string, config: JwtVerifierConfig): Promise<VerifiedAuthInfo> {
  if (!token || token.length > MAX_TOKEN_LENGTH) {
    throw new InvalidTokenError();
  }

  try {
    const jwks = getJwks(config.issuer);
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ALLOWED_ALGORITHMS,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    });
    return mapClaimsToAuthInfo(token, payload as Record<string, unknown>);
  } catch (error) {
    if (error instanceof ClaimsError) {
      throw new InvalidTokenError(error.message);
    }
    console.error("MCP access token verification failed", error);
    throw new InvalidTokenError();
  }
}
