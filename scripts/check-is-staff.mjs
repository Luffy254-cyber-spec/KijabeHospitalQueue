import postgres from "postgres";

const url = process.env.DATABASE_URL || "postgres://postgres:6285@localhost:5432/kijabe_care_flow";
const sql = postgres(url, { max: 1, onnotice: () => {} });

const defs = await sql`
  select p.proname, pg_get_functiondef(p.oid) as def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('is_staff','ensure_staff_access','has_role')
`;
for (const d of defs) {
  console.log("====", d.proname, "====");
  console.log(d.def);
  console.log("");
}

const users = await sql`select id, email from auth.users`;
for (const u of users) {
  const r = await sql`select public.is_staff(${u.id}::uuid) as ok, public.is_superadmin(${u.id}::uuid) as sa`;
  console.log(u.email, "is_staff=", r[0].ok, "superadmin=", r[0].sa);
}

const profiles = await sql`select * from staff_profiles`;
console.log("profiles", profiles);

await sql.end({ timeout: 5 });
