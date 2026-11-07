import { createFileRoute } from "@tanstack/react-router";
import os from "node:os";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "");
  if (!h) return true;
  if (h === "localhost" || h === "::1" || h === "0.0.0.0") return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return /\.local$/i.test(h);
}

function lanIPv4(): string | null {
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const n of list ?? []) {
      if (n.family === "IPv4" && !n.internal) return n.address;
    }
  }
  return null;
}

export const Route = createFileRoute("/api/public/app-origin")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const requestIsPrivate = isPrivateHost(url.hostname);
        const env = process.env["VITE_PUBLIC_APP_URL"]?.trim() || process.env["PUBLIC_APP_URL"]?.trim();

        if (env) {
          let envHost = "";
          try {
            envHost = new URL(env).hostname;
          } catch {
            envHost = "";
          }
          // A phone on mobile data cannot open a LAN address, so a public
          // deployment never serves a private origin to ticket QRs.
          if (envHost && (requestIsPrivate || !isPrivateHost(envHost))) {
            return Response.json({ origin: env.replace(/\/$/, ""), source: "env" }, { headers: cors });
          }
        }

        if (!requestIsPrivate) {
          return Response.json({ origin: url.origin, source: "request" }, { headers: cors });
        }

        const lan = lanIPv4();
        const origin = lan ? `${url.protocol}//${lan}:${url.port || "8080"}` : url.origin;
        return Response.json({ origin, source: lan ? "lan" : "request" }, { headers: cors });
      },
    },
  },
});
