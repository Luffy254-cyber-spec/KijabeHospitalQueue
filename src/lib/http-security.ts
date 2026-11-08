/**
 * Response hardening shared by the API routes and the SSR request middleware.
 */

/** Same-origin CORS: any other site's JS cannot read these endpoints. */
export function corsHeaders(request: Request): Record<string, string> {
  const base: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "600",
  };
  const origin = request.headers.get("origin");
  let self = "";
  try {
    self = new URL(request.url).origin;
  } catch {
    /* ignore */
  }
  if (origin && origin === self) {
    base["Access-Control-Allow-Origin"] = origin;
    base["Vary"] = "Origin";
  }
  return base;
}

const YOUTUBE = "https://www.youtube.com https://www.youtube-nocookie.com";
const TURNSTILE = "https://challenges.cloudflare.com";

const CSP = [
  "default-src 'self'",
  // TanStack Start hydrates through inline bootstrap scripts, so inline is required.
  `script-src 'self' 'unsafe-inline' ${YOUTUBE} https://s.ytimg.com ${TURNSTILE}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  `frame-src 'self' ${YOUTUBE} ${TURNSTILE}`,
  "connect-src 'self' https:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

export function securityHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "SAMEORIGIN",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
  if (process.env["NODE_ENV"] === "production" || process.env["HSTS"] === "1") {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }
  return headers;
}

export function withSecurityHeaders(response: Response): Response {
  const merged = new Headers(response.headers);
  for (const [key, value] of Object.entries(securityHeaders())) {
    merged.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}
