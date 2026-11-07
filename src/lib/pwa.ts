/** Cross-device PWA install + always-fresh updates. */

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let registration: ServiceWorkerRegistration | null = null;
type Listener = (canInstall: boolean) => void;
const listeners = new Set<Listener>();

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallPlatform = "ios" | "android" | "desktop" | "other";

function notify() {
  listeners.forEach((l) => l(Boolean(deferredPrompt)));
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
  );
}

export function getInstallPlatform(): InstallPlatform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
    return "ios";
  }
  if (/android/i.test(ua)) return "android";
  if (/windows|macintosh|linux/i.test(ua) && !/mobile/i.test(ua)) return "desktop";
  return "other";
}

export function installSteps(platform: InstallPlatform = getInstallPlatform()): string[] {
  switch (platform) {
    case "ios":
      return [
        "Open this site in Safari (required on iPhone / iPad).",
        "Tap the Share button.",
        "Scroll and tap “Add to Home Screen”, then Add.",
        "Open “Kijabe Queue” from your Home Screen — it launches like an app.",
      ];
    case "android":
      return [
        "Tap Install app below (or the browser menu → Install app / Add to Home screen).",
        "Confirm Install — an icon is added to your Home Screen / app drawer.",
        "Open it anytime; it runs full-screen like a normal app.",
        "When online, it refreshes itself to the latest version automatically.",
      ];
    case "desktop":
      return [
        "Tap Install app (or the install icon in the address bar).",
        "Confirm — it installs as a desktop web app.",
        "Launch from the Start menu / Dock / apps list.",
        "Each launch pulls the latest version when you are online.",
      ];
    default:
      return [
        "Open this page in Chrome, Edge, Safari, Firefox or Samsung Internet.",
        "Use the browser menu → Install app / Add to Home screen.",
        "Open the new icon — it launches as an app.",
        "Online visits always load the newest version.",
      ];
  }
}

export function onInstallAvailable(cb: Listener): () => void {
  listeners.add(cb);
  cb(Boolean(deferredPrompt));
  return () => listeners.delete(cb);
}

async function activateWaitingWorker(reg: ServiceWorkerRegistration) {
  const waiting = reg.waiting;
  if (!waiting) return;
  waiting.postMessage({ type: "SKIP_WAITING" });
}

function watchForUpdates(reg: ServiceWorkerRegistration) {
  reg.addEventListener("updatefound", () => {
    const sw = reg.installing;
    if (!sw) return;
    sw.addEventListener("statechange", () => {
      if (sw.state === "installed" && navigator.serviceWorker.controller) {
        // New version ready — take it immediately so devices stay current
        activateWaitingWorker(reg);
      }
    });
  });
}

export function registerPwa() {
  if (typeof window === "undefined") return;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
  });

  // Reload once when a new SW takes control (fresh app shell)
  let refreshing = false;
  navigator.serviceWorker?.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker
    .register("/sw.js", { scope: "/", updateViaCache: "none" })
    .then((reg) => {
      registration = reg;
      watchForUpdates(reg);
      // Check for a newer build whenever the app opens or comes back online
      reg.update().catch(() => undefined);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => undefined);
      });
      window.addEventListener("online", () => reg.update().catch(() => undefined));
      // Periodic check while the app stays open (kiosk / TV)
      setInterval(() => reg.update().catch(() => undefined), 5 * 60 * 1000);
    })
    .catch((err) => console.warn("SW register failed", err));
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferredPrompt) return "unavailable";
  await deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  notify();
  return outcome;
}

export function canPromptInstall(): boolean {
  return Boolean(deferredPrompt);
}

export async function checkForAppUpdate(): Promise<void> {
  await registration?.update();
}
