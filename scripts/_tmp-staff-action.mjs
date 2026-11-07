import postgres from "postgres";
const sql = postgres("postgres://postgres:6285@localhost:5432/kijabe_care_flow");
const rows = await sql`
  select pg_get_function_identity_arguments(p.oid) as args,
         pg_get_functiondef(p.oid) as def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'staff_action'
`;
for (const r of rows) {
  console.log("ARGS:", r.args);
  console.log(String(r.def).slice(0, 3500));
  console.log("---");
}
await sql.end();
