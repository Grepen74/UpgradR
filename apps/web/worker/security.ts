const mutatingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isAllowedOrigin(request: Request, appOrigin: string): boolean {
  if (!mutatingMethods.has(request.method.toUpperCase())) {
    return true;
  }

  const origin = request.headers.get("Origin");
  return origin === appOrigin;
}

export function securityHeaders(): Record<string, string> {
  return {
    "Content-Security-Policy":
      "default-src 'self'; connect-src 'self' https://*.supabase.co; img-src 'self' data: https:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

// Turns a normalized email into a stable, non-reversible rate-limit key
// (see OTP_VERIFY_RATE_LIMITER in worker/env.ts) so raw addresses never sit
// in Cloudflare's rate-limiter key namespace.
export async function hashRateLimitKey(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

