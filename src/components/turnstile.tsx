import { useEffect, useRef, useState } from "react";

/**
 * Cloudflare Turnstile widget. Renders nothing (and every form keeps working)
 * until TURNSTILE_SITE_KEY is configured on the host.
 */

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

function envValue(key: string): string {
  const env = import.meta.env as unknown as Record<string, string | undefined>;
  return (env[key] || "").trim();
}

export function turnstileSiteKey(): string {
  return envValue("TURNSTILE_SITE_KEY") || envValue("VITE_TURNSTILE_SITE_KEY");
}

export function turnstileConfigured() {
  return Boolean(turnstileSiteKey());
}

function loadTurnstile(): Promise<TurnstileApi> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("no window"));
      return;
    }
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }
    if (!document.querySelector("script[data-kh-turnstile]")) {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.dataset["khTurnstile"] = "1";
      script.onerror = () => reject(new Error("turnstile script failed"));
      document.head.appendChild(script);
    }
    const started = Date.now();
    const poll = window.setInterval(() => {
      if (window.turnstile) {
        window.clearInterval(poll);
        resolve(window.turnstile);
      } else if (Date.now() - started > 10000) {
        window.clearInterval(poll);
        reject(new Error("turnstile timeout"));
      }
    }, 150);
  });
}

type Props = { onToken: (token: string) => void; className?: string };

export function Turnstile({ onToken, className }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const key = turnstileSiteKey();
    if (!key || !hostRef.current) return;
    let widgetId: string | null = null;
    let gone = false;

    void loadTurnstile()
      .then((api) => {
        if (gone || !hostRef.current) return;
        widgetId = api.render(hostRef.current, {
          sitekey: key,
          theme: "light",
          size: "flexible",
          callback: (token: string) => onToken(token),
          "expired-callback": () => onToken(""),
          "error-callback": () => onToken(""),
        });
      })
      .catch(() => {
        if (!gone) setFailed(true);
      });

    return () => {
      gone = true;
      if (widgetId && window.turnstile) {
        try {
          window.turnstile.remove(widgetId);
        } catch {
          /* ignore */
        }
      }
    };
  }, [onToken]);

  if (!turnstileSiteKey()) return null;

  return (
    <div className={className}>
      <div ref={hostRef} />
      {failed && (
        <p className="mt-1 text-xs text-muted-foreground">
          Security check could not load — refresh the page to try again.
        </p>
      )}
    </div>
  );
}
