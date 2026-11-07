import { createFileRoute } from "@tanstack/react-router";
import { normalizeMpesaPhone, stkPush } from "@/lib/mpesa";
import { withUser } from "@/lib/db.server";
import { bearerUser } from "@/lib/local-auth.server";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/mpesa/stkpush")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      POST: async ({ request }) => {
        try {
          const user = bearerUser(request);
          if (!user) return Response.json({ error: "Not signed in" }, { status: 401, headers: cors });

          const body = (await request.json()) as {
            ticketId?: string;
            phone?: string;
            amount?: number;
            accountRef?: string;
          };
          if (!body.ticketId || !body.phone || body.amount == null) {
            return Response.json(
              { error: "ticketId, phone (2547xxxxxxxx) and amount are required" },
              { status: 400, headers: cors },
            );
          }

          const phone = normalizeMpesaPhone(body.phone);
          const amount = Math.max(1, Math.round(Number(body.amount)));

          const daraja = await stkPush({
            phone,
            amount,
            accountRef: body.accountRef || body.ticketId.slice(0, 8),
            description: "Kijabe fees",
          });

          if (daraja.ResponseCode !== "0" && daraja.ResponseCode !== undefined) {
            return Response.json(
              { error: daraja.ResponseDescription || "STK rejected", details: daraja },
              { status: 502, headers: cors },
            );
          }

          const payment = await withUser(user.id, user.email, async (tx) => {
            const rows = await tx.unsafe(
              `select public.record_payment_push($1::uuid, $2::int, $3::text, $4::text, $5::text) as result`,
              [
                body.ticketId,
                amount,
                phone,
                daraja.MerchantRequestID || "",
                daraja.CheckoutRequestID || "",
              ],
            );
            return rows[0]?.result ?? null;
          });

          return Response.json(
            {
              ...daraja,
              payment,
              CustomerMessage: daraja.CustomerMessage || "Success. Request accepted for processing",
            },
            { headers: cors },
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : "STK push failed";
          const status = /signed|authorized/i.test(msg) ? 401 : 500;
          return Response.json({ error: msg }, { status, headers: cors });
        }
      },
    },
  },
});
