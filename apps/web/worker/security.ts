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

