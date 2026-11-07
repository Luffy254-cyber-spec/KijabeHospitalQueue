/**
 * Origin used in Firebase continueUrl for staff verification emails.
 * Prefer PUBLIC / VITE public URL so LAN IP origins don't break Firebase Authorized domains.
 */
export function mailContinueOrigin(request: Request): string {
  const fromEnv = (
    process.env["PUBLIC_APP_URL"] ||
    process.env["VITE_PUBLIC_APP_URL"] ||
    ""
  )
    .trim()
    .replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  try {
    return new URL(request.url).origin;
  } catch {
    return "http://localhost:8081";
  }
}
