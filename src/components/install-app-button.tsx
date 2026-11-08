import { useEffect, useState } from "react";
import { Check, MonitorDown, Share, Smartphone, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  canPromptInstall,
  getInstallPlatform,
  installSteps,
  isStandalone,
  onInstallAvailable,
  promptInstall,
  type InstallPlatform,
} from "@/lib/pwa";

/** Install as a real home-screen / desktop web app on any phone or OS. */
export function InstallAppButton({ className, variant = "icon" }: { className?: string; variant?: "icon" | "banner" }) {
  const [canInstall, setCanInstall] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<InstallPlatform>("other");

  useEffect(() => {
    setInstalled(isStandalone());
    setPlatform(getInstallPlatform());
    return onInstallAvailable(setCanInstall);
  }, []);

  const runNativeInstall = async () => {
    const outcome = await promptInstall();
    if (outcome === "accepted") {
      toast.success("Installed — open Kijabe Care Flow from your apps / Home Screen");
      setInstalled(true);
      setOpen(false);
      return true;
    }
    return outcome === "dismissed";
  };

  const onClickInstall = async () => {
    if (installed) return;
    // Prefer the browser’s native install sheet when available (Chrome / Edge / Android)
    if (canInstall || canPromptInstall()) {
      const handled = await runNativeInstall();
      if (handled) return;
    }
    setOpen(true);
  };

  if (installed) {
    if (variant === "banner") {
      return (
        <div className={cn("inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary", className)}>
          <Check className="h-4 w-4" /> App installed — launches as a standalone app
        </div>
      );
    }
    return (
      <span
        className={cn("inline-flex h-10 w-10 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary", className)}
        title="App installed"
        aria-label="App installed"
      >
        <Check className="h-5 w-5" strokeWidth={2.25} />
      </span>
    );
  }

  const trigger =
    variant === "banner" ? (
      <button
        type="button"
        onClick={onClickInstall}
        className={cn(
          "group inline-flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary px-5 py-3 text-left text-primary-foreground shadow-md transition hover:-translate-y-0.5 hover:shadow-lg",
          className,
        )}
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15">
          <MonitorDown className="h-6 w-6" />
        </span>
        <span>
          <span className="block text-base font-bold">Install Kijabe Care Flow</span>
          <span className="block text-xs text-primary-foreground/85">
            Works on any phone or computer · always updates online
          </span>
        </span>
      </button>
    ) : (
      <button
        type="button"
        onClick={onClickInstall}
        title="Install app"
        aria-label="Install app"
        className={cn(
          "group relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm",
          "transition duration-300 hover:-translate-y-0.5 hover:border-primary hover:bg-primary hover:text-primary-foreground hover:shadow-md",
          "active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        <MonitorDown className="h-5 w-5 transition group-hover:scale-110" strokeWidth={2} />
      </button>
    );

  return (
    <>
      {trigger}
      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="install-title">
          <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="relative z-10 w-full max-w-md rounded-3xl border bg-card p-6 shadow-2xl anim-fade-up">
            <button type="button" onClick={() => setOpen(false)} className="absolute right-4 top-4 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-3">
              <img src="/icons/icon-192.png" alt="" className="h-14 w-14 rounded-2xl border object-cover" />
              <div>
                <h2 id="install-title" className="font-display text-xl font-bold">Install Kijabe Care Flow</h2>
                <p className="text-sm text-muted-foreground">Add to this device · opens as an app · stays up to date</p>
              </div>
            </div>

            {(canInstall || canPromptInstall()) && (
              <button
                type="button"
                onClick={runNativeInstall}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 text-base font-bold text-primary-foreground transition hover:brightness-110"
              >
                <MonitorDown className="h-5 w-5" /> Install app now
              </button>
            )}

            <ol className="mt-5 space-y-3">
              {installSteps(platform).map((step, i) => (
                <li key={step} className="flex gap-3 text-sm leading-snug">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>

            <div className="mt-5 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <p className="flex items-center gap-1.5 rounded-xl bg-muted/70 px-3 py-2">
                <Smartphone className="h-3.5 w-3.5 text-primary" /> Android · iPhone · tablets
              </p>
              <p className="flex items-center gap-1.5 rounded-xl bg-muted/70 px-3 py-2">
                <Share className="h-3.5 w-3.5 text-primary" /> Any network / SIM
              </p>
            </div>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              No app store needed. When this device is online, the installed app fetches the latest version automatically.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
