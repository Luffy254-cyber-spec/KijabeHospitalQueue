import nodemailer, { type Transporter } from "nodemailer";

/**
 * Staff mail (login codes, signup confirmations) goes through the hospital's own
 * SMTP relay when one is configured. Firebase's default sender
 * (noreply@<project>.firebaseapp.com) is frequently spam-filtered and cannot be
 * used once a recipient's mailbox starts rejecting it, so SMTP is the reliable
 * path; Firebase remains the fallback for deployments without SMTP.
 */

function env(key: string) {
  return (process.env[key] || "").trim();
}

export function smtpConfigured(): boolean {
  return Boolean(env("SMTP_HOST") && env("MAIL_FROM"));
}

let cached: Transporter | null = null;

function mailer(): Transporter {
  if (cached) return cached;
  const port = Number(env("SMTP_PORT") || 587);
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASS");
  cached = nodemailer.createTransport({
    host: env("SMTP_HOST"),
    port,
    secure: port === 465,
    auth: user ? { user, pass } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  });
  return cached;
}

export type BrandMail = {
  to: string;
  subject: string;
  heading: string;
  lines: string[];
  code?: string;
  cta?: { href: string; label: string };
  footnote?: string;
};

function esc(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml(mail: BrandMail): string {
  const lines = mail.lines
    .map(
      (l) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#dcecf7;">${esc(l)}</p>`,
    )
    .join("");
  const code = mail.code
    ? `<div style="margin:22px 0;padding:16px 20px;border-radius:14px;border:1px solid rgba(151,195,219,0.45);background:rgba(255,255,255,0.08);text-align:center;font-size:30px;letter-spacing:10px;font-weight:700;color:#ffffff;">${esc(mail.code)}</div>`
    : "";
  const cta = mail.cta
    ? `<a href="${esc(mail.cta.href)}" style="display:inline-block;margin:10px 0 4px;padding:13px 26px;border-radius:999px;background:linear-gradient(135deg,#159ed5,#2dd4bf);color:#04202f;font-size:15px;font-weight:700;text-decoration:none;">${esc(mail.cta.label)}</a>`
    : "";
  const footnote = mail.footnote
    ? `<p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#9fc3d8;">${esc(mail.footnote)}</p>`
    : "";
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#071a28;">
<div style="background:linear-gradient(160deg,#102a43 0%,#0c3f5e 45%,#062a44 100%);padding:32px 18px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;">
    <tr><td style="padding:0 0 18px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#9fc3d8;">AIC Kijabe Hospital</td></tr>
    <tr><td style="padding:26px 26px 22px;border-radius:18px;border:1px solid rgba(151,195,219,0.35);background:rgba(255,255,255,0.06);">
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#ffffff;">${esc(mail.heading)}</h1>
      ${lines}
      ${code}
      ${cta}
      ${footnote}
    </td></tr>
    <tr><td style="padding:20px 0 0;font-size:12px;line-height:1.6;color:#7fa6bd;">Kijabe Care Flow · Health Care to God&rsquo;s Glory.</td></tr>
  </table>
</div>
</body></html>`;
}

export async function sendBrandMail(mail: BrandMail): Promise<void> {
  const fromName = env("MAIL_FROM_NAME") || "Kijabe Care Flow";
  const text = [
    mail.heading,
    "",
    ...mail.lines,
    mail.code ? `Code: ${mail.code}` : "",
    mail.cta ? `${mail.cta.label}: ${mail.cta.href}` : "",
    mail.footnote || "",
  ]
    .filter(Boolean)
    .join("\n");
  await mailer().sendMail({
    from: `"${fromName}" <${env("MAIL_FROM")}>`,
    to: mail.to,
    subject: mail.subject,
    text,
    html: renderHtml(mail),
  });
}
