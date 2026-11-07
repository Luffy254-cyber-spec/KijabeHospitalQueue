import postgres from "postgres";
import fs from "fs";

const url = process.env.DATABASE_URL || "postgres://postgres:6285@localhost:5432/kijabe_care_flow";
const sql = postgres(url, { max: 1, onnotice: () => {} });

const uid = await sql`
  select pg_get_functiondef(p.oid) as def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'uid'
`;
const authUid = await sql`
  select n.nspname, p.proname, pg_get_functiondef(p.oid) as def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.proname in ('uid','jwt','role','email') and n.nspname in ('auth','public')
`;
for (const r of authUid) {
  console.log("---", r.nspname + "." + r.proname, "---");
  console.log((r.def || "").slice(0, 500));
}

const staff = await sql`
  select u.email, sp.status, array_agg(ur.role::text) as roles
  from auth.users u
  left join staff_profiles sp on sp.user_id = u.id
  left join user_roles ur on ur.user_id = u.id
  group by u.email, sp.status
`;
console.log("staff", staff);

await sql.end({ timeout: 5 });
