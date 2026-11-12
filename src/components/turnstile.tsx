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

export function turnstileSiteKey(): string {
  const direct =
    import.meta.env.VITE_TURNSTILE_SITE_KEY ||
    import.meta.env.TURNSTILE_SITE_KEY ||
    (typeof window !== "undefined" && (window as unknown as { __TURNSTILE_SITE_KEY__?: string }).__TURNSTILE_SITE_KEY__) ||
    "0x4AAAAAAF4r5nEqbl8uWZzb";
  return (direct || "").trim();
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

    let resolved = false;
    const onDone = () => {
      if (resolved) return;
      if (window.turnstile) {
        resolved = true;
        resolve(window.turnstile);
      }
    };

    let script = document.querySelector<HTMLScriptElement>("script[data-kh-turnstile]");
    if (!script) {
      script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.dataset["khTurnstile"] = "1";
      script.onload = () => setTimeout(onDone, 50);
      script.onerror = () => reject(new Error("turnstile script failed"));
      document.head.appendChild(script);
    } else {
      script.addEventListener("load", () => setTimeout(onDone, 50));
    }

    const started = Date.now();
    const poll = window.setInterval(() => {
      if (window.turnstile) {
        window.clearInterval(poll);
        resolved = true;
        resolve(window.turnstile);
      } else if (Date.now() - started > 10000) {
        window.clearInterval(poll);
        if (!resolved) reject(new Error("turnstile timeout"));
      }
    }, 100);
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
        hostRef.current.innerHTML = "";
        widgetId = api.render(hostRef.current, {
          sitekey: key,
          theme: "light",
          size: "flexible",
          callback: (token: string) => onToken(token),
          "expired-callback": () => onToken(""),
          "error-callback": () => onToken(""),
        });
      })
      .catch((err) => {
        console.error("Turnstile failed to load:", err);
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
