/** Safaricom Daraja STK Push helpers (sandbox / production via env). */

const SHORTCODE = () => process.env["MPESA_SHORTCODE"] || "174379";
const PASSKEY = () =>
  process.env["MPESA_PASSKEY"] ||
  "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919";
const CONSUMER_KEY = () => process.env["MPESA_CONSUMER_KEY"] || "";
const CONSUMER_SECRET = () => process.env["MPESA_CONSUMER_SECRET"] || "";
const ENV = () => (process.env["MPESA_ENV"] === "production" ? "production" : "sandbox");

function baseUrl() {
  return ENV() === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}

export function getTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export function getPassword(timestamp: string): string {
  return Buffer.from(`${SHORTCODE()}${PASSKEY()}${timestamp}`).toString("base64");
}

/** Normalize KE mobiles to 2547XXXXXXXX / 2541XXXXXXXX */
export function normalizeMpesaPhone(raw: string): string {
  let phone = (raw || "").replace(/[^0-9]/g, "");
  if (phone.startsWith("0") && phone.length === 10) phone = `254${phone.slice(1)}`;
  if (phone.startsWith("7") && phone.length === 9) phone = `254${phone}`;
  if (phone.startsWith("1") && phone.length === 9) phone = `254${phone}`;
  if (phone.startsWith("+")) phone = phone.slice(1);
  if (!/^254[17]\d{8}$/.test(phone)) {
    throw new Error("Phone must be 2547xxxxxxxx or 2541xxxxxxxx");
  }
  return phone;
}

export async function getAccessToken(): Promise<string> {
  const key = CONSUMER_KEY();
  const secret = CONSUMER_SECRET();
  if (!key || !secret || key.includes("YOUR_CONSUMER")) {
    throw new Error("Set MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET in .env (Daraja App Keys tab)");
  }
  const auth = Buffer.from(`${key}:${secret}`).toString("base64");
  const res = await fetch(`${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  const data = (await res.json()) as { access_token?: string; errorMessage?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(data.errorMessage || "Failed to generate Daraja access token");
  }
  return data.access_token;
}

export type StkPushResult = {
  MerchantRequestID?: string;
  CheckoutRequestID?: string;
  ResponseCode?: string;
  ResponseDescription?: string;
  CustomerMessage?: string;
  errorCode?: string;
  errorMessage?: string;
  requestId?: string;
};

export function callbackSecret(): string {
  return (process.env["MPESA_CALLBACK_SECRET"] || "").trim();
}

/** Safaricom calls back whatever URL we registered; carry a shared secret in it. */
export function withCallbackToken(url: string): string {
  const secret = callbackSecret();
  if (!secret) return url;
  return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(secret)}`;
}

export async function stkPush(opts: {
  phone: string;
  amount: number;
  accountRef?: string;
  description?: string;
  callbackUrl?: string;
}): Promise<StkPushResult> {
  const phone = normalizeMpesaPhone(opts.phone);
  const amount = Math.max(1, Math.round(Number(opts.amount)));
  const timestamp = getTimestamp();
  const password = getPassword(timestamp);
  const callbackUrl =
    opts.callbackUrl ||
    process.env["MPESA_CALLBACK_URL"] ||
    process.env["CALLBACK_URL"] ||
    "";
  if (!callbackUrl.startsWith("https://")) {
    throw new Error("MPESA_CALLBACK_URL must be a public https URL ending in /api/mpesa/callback");
  }

  const token = await getAccessToken();
  const payload = {
    BusinessShortCode: SHORTCODE(),
    Password: password,
    Timestamp: timestamp,
    TransactionType: "CustomerPayBillOnline",
    Amount: amount,
    PartyA: phone,
    PartyB: SHORTCODE(),
    PhoneNumber: phone,
    CallBackURL: withCallbackToken(callbackUrl),
    AccountReference: (opts.accountRef || "Kijabe Hosp").slice(0, 12),
    TransactionDesc: (opts.description || "Medical fees").slice(0, 13),
  };

  const res = await fetch(`${baseUrl()}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as StkPushResult;
  if (!res.ok) {
    throw new Error(data.errorMessage || data.ResponseDescription || "STK push failed");
  }
  return data;
}

/** Ask Daraja for the authoritative result of a STK request (used to verify callbacks). */
export async function stkQuery(checkoutRequestId: string): Promise<{
  ResultCode?: number | string;
  ResultDesc?: string;
  errorMessage?: string;
}> {
  const timestamp = getTimestamp();
  const password = getPassword(timestamp);
  const token = await getAccessToken();
  const res = await fetch(`${baseUrl()}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      BusinessShortCode: SHORTCODE(),
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    }),
  });
  const data = (await res.json()) as {
    ResultCode?: number | string;
    ResultDesc?: string;
    errorMessage?: string;
  };
  if (!res.ok) throw new Error(data.errorMessage || "Daraja status query failed");
  return data;
}

export function mpesaConfigPublic() {
  return {
    shortcode: SHORTCODE(),
    env: ENV(),
    sandboxTestPhone: "254708374149",
    hasKeys: Boolean(CONSUMER_KEY() && CONSUMER_SECRET() && !CONSUMER_KEY().includes("YOUR_")),
  };
}
