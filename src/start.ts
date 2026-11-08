import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { securityHeaders } from "./lib/http-security";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

/** Adds CSP/HSTS/frame/referrer hardening to every HTML, API and asset response. */
const securityMiddleware = createMiddleware().server(async ({ next }) => {
  const result = await next();
  const response = result.response;
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(securityHeaders())) headers.set(key, value);
  return {
    ...result,
    response: new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
  };
});

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [securityMiddleware, errorMiddleware, csrfMiddleware],
}));
