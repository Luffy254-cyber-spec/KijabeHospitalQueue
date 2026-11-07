import { createFileRoute } from "@tanstack/react-router";
import { sql } from "@/lib/db.server";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/public/queue-status")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      GET: async () => {
        try {
          const rows = await sql`select public.get_display_board() as board`;
          const data = rows[0]?.board ?? {};
          try {
            await sql`select public.run_queue_automation(false)`;
          } catch {
            /* automation optional locally */
          }
          return Response.json(
            { hospital: "AIC Kijabe Hospital", updated_at: new Date().toISOString(), ...(data as object) },
            { headers: { ...cors, "Cache-Control": "public, max-age=5" } },
          );
        } catch (e) {
          console.error(e);
          return Response.json({ error: "Unavailable" }, { status: 503, headers: cors });
        }
      },
    },
  },
});
