import postgres from "postgres";

const DATABASE_URL =
  process.env["DATABASE_URL"] || "postgres://postgres:6285@localhost:5432/kijabe_care_flow";

/** Shared server-only Postgres pool (local kijabe_care_flow — no Supabase). */
export const sql = postgres(DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  // Neon's pooled endpoint runs PgBouncer in transaction mode, which cannot
  // carry protocol-level prepared statements between connections.
  prepare: false,
});

export async function withUser<T>(
  userId: string | null,
  email: string | null,
  fn: (tx: postgres.Sql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    if (userId) {
      await tx`select set_config('app.current_user_id', ${userId}, true)`;
      await tx`select set_config('app.role', 'authenticated', true)`;
      const jwt = JSON.stringify({ sub: userId, email: email || "", role: "authenticated" });
      await tx`select set_config('app.current_jwt', ${jwt}, true)`;
    } else {
      await tx`select set_config('app.current_user_id', '', true)`;
      await tx`select set_config('app.role', 'anon', true)`;
      await tx`select set_config('app.current_jwt', '{}', true)`;
    }
    return fn(tx as unknown as postgres.Sql);
  }) as Promise<T>;
}
