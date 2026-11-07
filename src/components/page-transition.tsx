import { useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

/** Soft enter animation on route changes (CSS-only — stays fast). */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div key={pathname} className="page-shell page-enter">
      <span className="route-sheen" aria-hidden />
      {children}
    </div>
  );
}

/** Thin top bar while TanStack navigates / preloads. */
export function NavProgress() {
  const busy = useRouterState({ select: (s) => s.isLoading });
  return (
    <div
      className={`nav-progress${busy ? " is-on" : ""}`}
      role="progressbar"
      aria-hidden={!busy}
      aria-valuetext={busy ? "Loading" : undefined}
    />
  );
}
