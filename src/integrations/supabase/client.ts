/**
 * Local Postgres client (kijabe_care_flow) — Supabase-compatible surface for the app.
 * Talks to /api/local/* which uses your own PostgreSQL (no Supabase cloud).
 */

type Session = {
  access_token: string;
  user: { id: string; email: string };
};

type AuthChangeCallback = (event: string, session: Session | null) => void;

const TOKEN_KEY = "kijabe-local-token";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

const authListeners = new Set<AuthChangeCallback>();

function notifyAuth(event: string, session: Session | null) {
  authListeners.forEach((cb) => cb(event, session));
}

async function authFetch(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(path, { ...init, headers });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

class FilterBuilder {
  private filters: { type: string; col: string; val: unknown }[] = [];
  private orderBy: { col: string; ascending?: boolean } | undefined;
  private limitN: number | undefined;
  private wantSingle = false;
  private selectCols = "*";

  constructor(private table: string) {}

  select(cols = "*") {
    this.selectCols = cols;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push({ type: "eq", col, val });
    return this;
  }
  neq(col: string, val: unknown) {
    this.filters.push({ type: "neq", col, val });
    return this;
  }
  in(col: string, val: unknown[]) {
    this.filters.push({ type: "in", col, val });
    return this;
  }
  ilike(col: string, val: string) {
    this.filters.push({ type: "ilike", col, val });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, ascending: opts?.ascending };
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  single() {
    this.wantSingle = true;
    return this;
  }
  or(_expr: string) {
    // Not fully supported locally — callers should avoid; kept for API compat
    console.warn("local client: .or() is ignored — prefer eq filters");
    return this;
  }

  then<TResult1 = { data: unknown; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute() {
    const { json } = await authFetch("/api/local/query", {
      method: "POST",
      body: JSON.stringify({
        table: this.table,
        select: this.selectCols,
        filters: this.filters,
        order: this.orderBy,
        limit: this.limitN,
        single: this.wantSingle,
      }),
    });
    return { data: json.data ?? null, error: json.error ?? null };
  }
}

export const supabase = {
  auth: {
    async getSession() {
      const token = getToken();
      if (!token) return { data: { session: null } };
      const { json } = await authFetch("/api/local/auth", {
        method: "POST",
        body: JSON.stringify({ action: "verify", token }),
      });
      if (!json.user) {
        setToken(null);
        return { data: { session: null } };
      }
      return {
        data: {
          session: { access_token: token, user: json.user } as Session,
        },
      };
    },
    onAuthStateChange(cb: AuthChangeCallback) {
      authListeners.add(cb);
      void this.getSession().then(({ data }) => cb("INITIAL_SESSION", data.session));
      return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } };
    },
    async signInWithPassword({ email, password, turnstileToken }: { email: string; password: string; turnstileToken?: string }) {
      const { res, json } = await authFetch("/api/local/auth", {
        method: "POST",
        body: JSON.stringify({ action: "signin", email, password, turnstileToken }),
      });
      if (!res.ok) return { data: { session: null, user: null }, error: { message: json.error || "Sign in failed" } };
      // Superadmin/admin skip verification and receive a session immediately
      if (json.session?.access_token) {
        setToken(json.session.access_token);
        notifyAuth("SIGNED_IN", json.session);
        return { data: { session: json.session, user: json.session.user }, error: null, needsCode: false as const };
      }
      if (json.needsCode) {
        return {
          data: { session: null, user: null },
          error: null,
          needsCode: true as const,
          email: json.email as string,
          pending: json.pending as string | undefined,
          code: json.code as string | undefined,
          mailFailed: !!json.mailFailed,
        };
      }
      return { data: { session: null, user: null }, error: { message: "Sign in failed" } };
    },
    async verifyLoginCode({ email, code }: { email: string; code: string }) {
      const { res, json } = await authFetch("/api/local/auth", {
        method: "POST",
        body: JSON.stringify({ action: "verify-login-code", email, code }),
      });
      if (!res.ok) return { data: { session: null, user: null }, error: { message: json.error || "Invalid code" } };
      setToken(json.session.access_token);
      notifyAuth("SIGNED_IN", json.session);
      return { data: { session: json.session, user: json.session.user }, error: null };
    },
    /** Step 1 of a password reset: mail a 6-digit code (Firebase). */
    async requestPasswordReset(email: string, turnstileToken?: string) {
      const { res, json } = await authFetch("/api/local/auth", {
        method: "POST",
        body: JSON.stringify({ action: "reset-request", email, turnstileToken }),
      });
      if (!res.ok) return { data: null, error: { message: json.error || "Could not send the reset code" } };
      return { data: json as { email: string; code?: string; mailFailed?: boolean }, error: null };
    },
    /** Step 2 of a password reset: code → single-use ticket. */
    async verifyResetCode({ email, code }: { email: string; code: string }) {
      const { res, json } = await authFetch("/api/local/auth", {
        method: "POST",
        body: JSON.stringify({ action: "reset-verify", email, code }),
      });
      if (!res.ok) return { data: null, error: { message: json.error || "Invalid code" } };
      return { data: json as { email: string; ticket: string }, error: null };
    },
    async completePasswordReset({ email, ticket, password }: { email: string; ticket: string; password: string }) {
      const { res, json } = await authFetch("/api/local/auth", {
        method: "POST",
        body: JSON.stringify({ action: "reset-complete", email, ticket, password }),
      });
      if (!res.ok) return { data: null, error: { message: json.error || "Could not change the password" } };
      return { data: json as { ok: boolean; email: string }, error: null };
    },
    /** Step 1 of an email change: mail a 6-digit code (Firebase). */
    async requestEmailChangeCode(email: string, turnstileToken?: string) {
      const { res, json } = await authFetch("/api/local/auth", {
        method: "POST",
        body: JSON.stringify({ action: "change-email-request", email, turnstileToken }),
      });
      if (!res.ok) return { data: null, error: { message: json.error || "Could not send the code" } };
      return { data: json as { email: string; code?: string; mailFailed?: boolean }, error: null };
    },
    /** Step 2 of an email change: code → single-use ticket. */
    async verifyEmailChangeCode({ email, code }: { email: string; code: string }) {
      const { res, json } = await authFetch("/api/local/auth", {
        method: "POST",
        body: JSON.stringify({ action: "change-email-verify", email, code }),
      });
      if (!res.ok) return { data: null, error: { message: json.error || "Invalid code" } };
      return { data: json as { email: string; ticket: string }, error: null };
    },
    /** Step 3: new address → confirmation mail to that address. */
    async beginEmailChange({ email, ticket, newEmail }: { email: string; ticket: string; newEmail: string }) {
      const { res, json } = await authFetch("/api/local/auth", {
        method: "POST",
        body: JSON.stringify({ action: "change-email-begin", email, ticket, newEmail }),
      });
      if (!res.ok) return { data: null, error: { message: json.error || "Could not send the verification mail" } };
      return { data: json as { email: string; mailFailed?: boolean }, error: null };
    },
    async acceptSession(session: Session) {
      setToken(session.access_token);
      notifyAuth("SIGNED_IN", session);
    },
    /** Superadmin only — assign/replace a staff work ID (stored as a keyed hash server-side). */
    async setWorkId(userId: string, workId: string) {
      const { res, json } = await authFetch("/api/local/auth", {
        method: "POST",
        body: JSON.stringify({ action: "work-id-set", userId, workId }),
      });
      if (!res.ok) {
        return { data: null, error: { message: json.error || "Could not assign work ID" } };
      }
      return { data: json as { workId: string; last4: string }, error: null };
    },
    async signUp({
      email, password, firstName, lastName, surname, phone, options: _options, turnstileToken,
    }: {
      email: string; password: string; options?: unknown;
      firstName?: string; lastName?: string; surname?: string; phone?: string;
      turnstileToken?: string;
    }) {
      const { res, json } = await authFetch("/api/local/auth", {
        method: "POST",
        body: JSON.stringify({
          action: "signup", email, password,
          firstName, lastName, surname, phone, turnstileToken,
        }),
      });
      if (!res.ok) return { data: { session: null, user: null }, error: { message: json.error || "Sign up failed" } };
      if (!json.session) {
        return {
          data: { session: null, user: null },
          error: null,
          needsConfirmation: !!json.needsConfirmation,
          awaitingApproval: !!json.awaitingApproval,
          mailFailed: !!json.mailFailed,
          email: json.email as string,
        };
      }
      setToken(json.session.access_token);
      notifyAuth("SIGNED_IN", json.session);
      return { data: { session: json.session, user: json.session.user }, error: null };
    },
    async signOut() {
      setToken(null);
      notifyAuth("SIGNED_OUT", null);
      return { error: null };
    },
    async getUser() {
      const { data } = await this.getSession();
      return { data: { user: data.session?.user ?? null }, error: null };
    },
  },
  from(table: string) {
    return new FilterBuilder(table);
  },
  async rpc(fn: string, args: Record<string, unknown> = {}) {
    const { json } = await authFetch("/api/local/rpc", {
      method: "POST",
      body: JSON.stringify({ fn, args }),
    });
    return { data: json.data ?? null, error: json.error ?? null };
  },
  channel(_name: string) {
    const noop = {
      on() {
        return noop;
      },
      subscribe(cb?: (s: string) => void) {
        cb?.("SUBSCRIBED");
        return noop;
      },
    };
    return noop;
  },
  removeChannel(_ch: unknown) {
    /* realtime replaced by polling on local Postgres */
  },
};

export type { Session };
