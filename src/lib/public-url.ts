/** Base URL phones can open when scanning ticket QR codes. */
export function ticketTrackUrl(ticketId: string): string {
  const base = publicAppOrigin();
  return `${base}/ticket/${ticketId}`;
}

export function publicAppOrigin(): string {
  const fromEnv = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

export function isLocalHostOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}
