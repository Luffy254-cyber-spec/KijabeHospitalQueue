import { createFileRoute } from "@tanstack/react-router";
import os from "node:os";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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
        const env = process.env.VITE_PUBLIC_APP_URL?.trim() || process.env.PUBLIC_APP_URL?.trim();
        if (env) {
          return Response.json({ origin: env.replace(/\/$/, ""), source: "env" }, { headers: cors });
        }
        const url = new URL(request.url);
        const lan = lanIPv4();
        const origin = lan ? `${url.protocol}//${lan}:${url.port || "8080"}` : url.origin;
        return Response.json({ origin, source: lan ? "lan" : "request" }, { headers: cors });
      },
    },
  },
});
