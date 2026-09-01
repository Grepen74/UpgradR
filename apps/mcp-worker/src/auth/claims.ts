import { parseScopes } from "./scopes";

/**
 * Shape produced once a JWT's signature, issuer, audience, and expiry have
 * already been verified (see `jwt-verifier.ts`). Kept separate from the
 * `jose` verification call so the claims-to-AuthInfo mapping — including all
 * of its failure modes — can be unit tested without a real JWKS endpoint.
 */
export interface VerifiedAuthInfo {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt: number;
  extra: {
    userId: string;
  };
}

export class ClaimsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaimsError";
  }
}

/**
 * Maps a verified JWT payload to the fields the MCP authorization gate and
 * tool handlers need. Throws `ClaimsError` (mapped to a generic
 * `invalid_token` response upstream — see `http/errors.ts`) for any claim
 * that is missing or the wrong shape, so malformed tokens never reach a
 * tool handler with partially-populated identity data.
 */
export function mapClaimsToAuthInfo(token: string, payload: Record<string, unknown>): VerifiedAuthInfo {
  const sub = payload["sub"];
  if (typeof sub !== "string" || sub.length === 0) {
    throw new ClaimsError("Token is missing a valid subject claim");
  }

  const exp = payload["exp"];
  if (typeof exp !== "number" || !Number.isFinite(exp)) {
    throw new ClaimsError("Token is missing a valid expiry claim");
  }

  const clientIdClaim = payload["client_id"] ?? payload["azp"] ?? sub;
  const clientId = typeof clientIdClaim === "string" && clientIdClaim.length > 0 ? clientIdClaim : sub;

  return {
    token,
    clientId,
    scopes: parseScopes(payload["scope"]),
    expiresAt: exp,
    extra: { userId: sub },
  };
}
