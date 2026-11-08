import { createFileRoute } from "@tanstack/react-router";
import { mpesaConfigPublic } from "@/lib/mpesa";
import { sql } from "@/lib/db.server";
import { corsHeaders } from "@/lib/http-security";

export const Route = createFileRoute("/api/mpesa/status")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => new Response(null, { status: 204, headers: corsHeaders(request) }),
      GET: async ({ request }) => {
        const cors = corsHeaders(request);
        try {
          const url = new URL(request.url);
          const ticketId = url.searchParams.get("ticketId");
          if (!ticketId) {
            return Response.json(
              { config: mpesaConfigPublic(), error: "ticketId required" },
              { status: 400, headers: cors },
            );
          }
          const rows = await sql.unsafe(`select public.get_payment_status($1::uuid) as result`, [ticketId]);
          return Response.json({ ...((rows[0]?.result as object) || {}), config: mpesaConfigPublic() }, { headers: cors });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Status failed";
          return Response.json({ error: msg }, { status: 500, headers: cors });
        }
      },
    },
  },
});
