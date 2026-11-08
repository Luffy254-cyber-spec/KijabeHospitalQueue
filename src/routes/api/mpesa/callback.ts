import { createFileRoute } from "@tanstack/react-router";
import { sql } from "@/lib/db.server";
import { callbackSecret, stkQuery } from "@/lib/mpesa";
import { secretMatches } from "@/lib/security.server";

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

function hasDarajaKeys() {
  const key = process.env["MPESA_CONSUMER_KEY"] || "";
  const secret = process.env["MPESA_CONSUMER_SECRET"] || "";
  return Boolean(key && secret && !key.includes("YOUR_"));
}

export const Route = createFileRoute("/api/mpesa/callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          // 1. Shared secret carried in the registered callback URL.
          const secret = callbackSecret();
          if (secret) {
            const token = new URL(request.url).searchParams.get("token");
            if (!secretMatches(secret, token)) {
              return new Response("Forbidden", { status: 403 });
            }
          }

          const body = (await request.json()) as { Body?: { stkCallback?: StkCallback } };
          const cb = body?.Body?.stkCallback;
          if (!cb?.CheckoutRequestID) {
            return Response.json({ ResultCode: 0, ResultDesc: "Accepted (no callback body)" });
          }

          // 2. A success must be confirmed with Safaricom, not trusted from the
          // request body. Definitive non-success from Daraja wins over the claim.
          if (Number(cb.ResultCode) === 0 && hasDarajaKeys() && process.env["MPESA_VERIFY_CALLBACK"] !== "0") {
            try {
              const verified = await stkQuery(cb.CheckoutRequestID);
              const code = Number(verified.ResultCode);
              if (Number.isFinite(code) && code !== 0) {
                console.warn(
                  "M-Pesa callback contradicted by Daraja status",
                  cb.CheckoutRequestID,
                  verified.ResultCode,
                  verified.ResultDesc,
                );
                return Response.json({ ResultCode: 0, ResultDesc: "Ignored: unverified callback" });
              }
            } catch (e) {
              // Network/credential failure: keep the callback (the patient paid)
              // but leave a trail for the superadmin ops log.
              console.warn("M-Pesa callback could not be verified", e);
            }
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
