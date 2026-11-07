/** Base URL phones can open when scanning ticket QR codes. */
export function ticketTrackUrl(ticketId: string): string {
  const base = publicAppOrigin();
  return `${base}/ticket/${ticketId}`;
}

function isPrivateOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") return true;
    return (
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /\.local$/i.test(host)
    );
  } catch {
    return true;
  }
}

export function publicAppOrigin(): string {
  const fromEnv = (import.meta.env["VITE_PUBLIC_APP_URL"] as string | undefined)?.trim();
  const envOrigin = fromEnv ? fromEnv.replace(/\/$/, "") : "";
  if (typeof window !== "undefined") {
    const pageOrigin = window.location.origin;
    // A deployed page must never emit a LAN address: phones on mobile data
    // cannot resolve it, so the public deployment origin wins.
    if (!isPrivateOrigin(pageOrigin)) {
      return envOrigin && !isPrivateOrigin(envOrigin) ? envOrigin : pageOrigin;
    }
    return envOrigin || pageOrigin;
  }
  return envOrigin;
}

export function isLocalHostOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}
