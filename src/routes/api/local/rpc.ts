import { createFileRoute } from "@tanstack/react-router";
import { withUser } from "@/lib/db.server";
import { bearerUser } from "@/lib/local-auth.server";
import { corsHeaders } from "@/lib/http-security";

const ARG_NAME = /^[a-z_][a-z0-9_]*$/i;

const ALLOWED = new Set([
  "lookup_patient",
  "register_patient",
  "staff_register_patient",
  "staff_set_hospital_number",
  "issue_visit",
  "issue_ticket",
  "call_next",
  "call_ticket",
  "staff_action",
  "close_day",
  "get_ticket_status",
  "mark_ticket_opened",
  "ticket_was_opened",
  "get_patient_track",
  "queue_at_registration",
  "queue_at_triage",
  "list_insurance_providers",
  "staff_list_insurers_all",
  "staff_upsert_insurer",
  "get_display_board",
  "get_counter_queue",
  "ensure_staff_access",
  "get_fee_for_ticket",
  "get_payment_status",
  "record_payment_push",
  "confirm_cash_or_cover",
  "submit_feedback",
  "run_queue_automation",
  "claim_first_admin",
  "grant_staff_role",
  "is_staff",
  "is_superadmin",
  "get_my_access",
  "admin_list_staff",
  "admin_create_staff",
  "admin_delete_staff",
  "admin_set_staff_status",
  "admin_assign_room",
  "admin_summon_staff",
  "staff_ack_summon",
  "staff_my_notifications",
  "admin_create_room",
  "admin_create_service",
  "admin_set_room_active",
  "admin_observe_queue",
  "staff_check_in",
  "staff_check_out",
  "staff_session_ping",
  "staff_close_open_sessions",
  "admin_ops_board",
  "admin_daily_stats",
  "admin_staff_timesheet",
  "admin_run_nightly_archive",
  "admin_list_data_exports",
  "admin_get_data_export",
]);

export const Route = createFileRoute("/api/local/rpc")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => new Response(null, { status: 204, headers: corsHeaders(request) }),
      POST: async ({ request }) => {
        const cors = corsHeaders(request);
        try {
          const body = (await request.json()) as { fn?: string; args?: Record<string, unknown> };
          const fn = body.fn || "";
          if (!ALLOWED.has(fn)) {
            return Response.json({ error: `RPC not allowed: ${fn}` }, { status: 400, headers: cors });
          }
          const user = bearerUser(request);
          const args = body.args || {};
          const keys = Object.keys(args);
          // Argument names become SQL identifiers: reject anything that is not
          // a plain lowercase name before it can reach the interpreter.
          const badKey = keys.find((k) => !ARG_NAME.test(k));
          if (badKey) {
            return Response.json({ error: `Invalid argument name: ${badKey}` }, { status: 400, headers: cors });
          }
          const data = await withUser(user?.id || null, user?.email || null, async (tx) => {
            if (keys.length === 0) {
              const rows = await tx.unsafe(`select public.${fn}() as result`);
              return rows[0]?.result ?? null;
            }
            // Named args via => syntax: select public.fn(a => $1, b => $2)
            const named = keys.map((k, i) => `${k} => $${i + 1}`).join(", ");
            const values = keys.map((k) => args[k]);
            const rows = await tx.unsafe(`select public.${fn}(${named}) as result`, values);
            return rows[0]?.result ?? null;
          });
          return Response.json({ data, error: null }, { headers: cors });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "RPC failed";
          return Response.json({ data: null, error: { message: msg } }, { status: 400, headers: cors });
        }
      },
    },
  },
});
