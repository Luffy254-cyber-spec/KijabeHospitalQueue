import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.DATABASE_URL || "postgres://postgres:6285@localhost:5432/kijabe_care_flow";

// 1) Commit new enum value alone (Postgres requires this before use)
{
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe(`
    do $$ begin
      alter type public.app_role add value if not exists 'superadmin';
    exception when duplicate_object then null;
    end $$;
  `);
  await sql.end({ timeout: 5 });
  console.log("enum superadmin committed");
}

// 2) Rest of migration (strip the enum alter — already done)
{
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  let text = fs.readFileSync(path.join(root, "drizzle", "migrations", "0020_superadmin_staff_ops.sql"), "utf8");
  text = text.replace(/do \$\$ begin[\s\S]*?alter type public\.app_role[\s\S]*?end \$\$;/i, "-- enum added in prior transaction");
  await sql.unsafe(text);

  const email = "admin@kijabe.local";
  const pass = "admin1234";
  const hash = await sql`select crypt(${pass}, gen_salt('bf')) as h`;
  await sql`
    insert into auth.users (email, encrypted_password, email_confirmed_at)
    values (${email}, ${hash[0].h}, now())
    on conflict (email) do update
      set encrypted_password = excluded.encrypted_password,
          email_confirmed_at = coalesce(auth.users.email_confirmed_at, now())
  `;
  const u = await sql`select id from auth.users where email = ${email}`;
  const id = u[0].id;
  await sql`insert into public.user_roles(user_id, role) values (${id}::uuid, 'admin') on conflict do nothing`;
  await sql`insert into public.user_roles(user_id, role) values (${id}::uuid, 'superadmin') on conflict do nothing`;
  await sql`
    insert into public.staff_profiles(user_id, full_name, status, approved_at)
    values (${id}::uuid, 'Kijabe Superadmin', 'approved', now())
    on conflict (user_id) do update set status = 'approved',
      full_name = coalesce(public.staff_profiles.full_name, 'Kijabe Superadmin')
  `;
  console.log("0020 applied · superadmin", email, "/", pass);
  await sql.end({ timeout: 5 });
}
