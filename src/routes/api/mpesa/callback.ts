import { createFileRoute } from "@tanstack/react-router";
import { sql } from "@/lib/db.server";

type CallbackItem = { Name: string; Value?: string | number };
type StkCallback = {
  MerchantRequestID?: string;
  CheckoutRequestID?: string;
  ResultCode: number;
  ResultDesc?: string;
  CallbackMetadata?: { Item?: CallbackItem[] };
};

function metaValue(items: CallbackItem[] | undefined, name: string): string | number | undefined {
  return items?.find((i) => i.Name === name)?.Value;
}

export const Route = createFileRoute("/api/mpesa/callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as { Body?: { stkCallback?: StkCallback } };
          const cb = body?.Body?.stkCallback;
          if (!cb?.CheckoutRequestID) {
            return Response.json({ ResultCode: 0, ResultDesc: "Accepted (no callback body)" });
          }

          const items = cb.CallbackMetadata?.Item;
          const receipt = String(metaValue(items, "MpesaReceiptNumber") ?? "");
          const amountRaw = metaValue(items, "Amount");
          const amount = typeof amountRaw === "number" ? amountRaw : Number(amountRaw) || 0;

          await sql.unsafe(
            `select public.finalize_payment_callback($1::text, $2::int, $3::text, $4::text, $5::int)`,
            [cb.CheckoutRequestID, cb.ResultCode, cb.ResultDesc || "", receipt, amount],
          );

          return Response.json({ ResultCode: 0, ResultDesc: "Success processed callback notification" });
        } catch (e) {
          console.error("M-Pesa callback error", e);
          return Response.json({ ResultCode: 0, ResultDesc: "Accepted with internal error" });
        }
      },
    },
  },
});
