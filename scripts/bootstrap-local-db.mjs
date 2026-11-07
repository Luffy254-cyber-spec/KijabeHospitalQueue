/**
 * Bootstrap local Postgres (kijabe_care_flow) — no Supabase.
 * Usage: node scripts/bootstrap-local-db.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://postgres:6285@localhost:5432/kijabe_care_flow";

// prepare:false keeps this working through Neon's transaction-mode pooler.
const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {}, prepare: false });

const AUTH_STUB = `
create extension if not exists "pgcrypto";

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  encrypted_password text not null,
  email_confirmed_at timestamptz default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  raw_user_meta_data jsonb default '{}'::jsonb
);

-- Session variable set by the app API before each request
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('app.current_user_id', true), '')::uuid;
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('app.current_jwt', true), ''), '{}')::jsonb;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('app.role', true), ''), 'authenticated');
$$;

do $$ begin
  create role anon nologin;
exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role nologin bypassrls;
exception when duplicate_object then null; end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
`;

async function runFile(filePath) {
  let text = fs.readFileSync(filePath, "utf8");
  // Skip Supabase-only bits that break on stock Postgres
  if (filePath.includes("0003_enable_pg_cron")) {
    console.log("skip", path.basename(filePath), "(pg_cron)");
    return;
  }
  text = text
    .replace(/do\s+\$\$\s+begin[\s\S]*?supabase_realtime[\s\S]*?end\s+\$\$\s*;/gi, "-- skipped realtime publication block")
    .replace(/alter publication supabase_realtime[\s\S]*?;/gi, "-- skipped realtime publication")
    .replace(/select\s+cron\.[^;]+;/gi, "-- skipped cron schedule")
    .replace(/perform\s+cron\.[^;]+;/gi, "-- skipped cron")
    .replace(/do\s+\$\$\s+begin[\s\S]*?cron\.[\s\S]*?end\s+\$\$\s*;/gi, "-- skipped cron block");
  if (filePath.includes("0007_stop_midnight_close")) {
    text = "-- skipped 0007 (cron.unschedule only)\nselect 1;";
  }
  console.log("apply", path.basename(filePath));
  try {
    await sql.unsafe(text);
  } catch (e) {
    // Allow re-runs: ignore already-exists style errors for idempotent objects
    const msg = String(e?.message || e);
    if (/already exists|duplicate/i.test(msg)) {
      console.warn("  warn:", msg.split("\n")[0]);
      return;
    }
    throw e;
  }
}

async function main() {
  console.log("Connecting", DATABASE_URL.replace(/:([^:@/]+)@/, ":****@"));
  await sql`select current_database() as db, current_user as usr`;
  console.log("auth stub…");
  await sql.unsafe(AUTH_STUB);

  const dir = path.join(root, "drizzle", "migrations");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    await runFile(path.join(dir, f));
  }

  // Newer migrations that only exist under supabase/migrations.
  const extra = [
    "20261107040000_confirm_staff_emails.sql",
    "20261107043000_return_common_priority_reasons.sql",
    "20261107050000_staff_work_sessions.sql",
    "20261107060000_staff_webauthn.sql",
  ];
  for (const f of extra) {
    const filePath = path.join(root, "supabase", "migrations", f);
    if (fs.existsSync(filePath)) await runFile(filePath);
  }

  // Seed a default staff user: admin@kijabe.local / admin1234
  const email = "admin@kijabe.local";
  const pass = "admin1234";
  const hash = await sql`select crypt(${pass}, gen_salt('bf')) as h`;
  await sql`
    insert into auth.users (email, encrypted_password, email_confirmed_at)
    values (${email}, ${hash[0].h}, now())
    on conflict (email) do update set encrypted_password = excluded.encrypted_password
  `;
  const u = await sql`select id from auth.users where email = ${email}`;
  // user_roles may require app_role enum from migrations
  await sql.unsafe(`
    insert into public.user_roles(user_id, role)
    values ('${u[0].id}'::uuid, 'admin')
    on conflict (user_id, role) do nothing;
    insert into public.user_roles(user_id, role)
    values ('${u[0].id}'::uuid, 'superadmin')
    on conflict (user_id, role) do nothing;
    insert into public.staff_profiles(user_id, full_name, status, approved_at)
    values ('${u[0].id}'::uuid, 'Kijabe Superadmin', 'approved', now())
    on conflict (user_id) do update set status = 'approved';
  `);

  console.log("Done. Superadmin login:", email, "/", pass);
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await sql.end();
  } catch {}
  process.exit(1);
});
