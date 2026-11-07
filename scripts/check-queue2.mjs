import postgres from "postgres";
import fs from "fs";

const url = process.env.DATABASE_URL || "postgres://postgres:6285@localhost:5432/kijabe_care_flow";
const sql = postgres(url, { max: 1, onnotice: () => {} });

const ev = await sql`select action, count(*)::int as n from ticket_events group by action order by n desc`;
console.log("events", ev);

const recent = await sql`
  select te.action, te.created_at, t.token, t.status
  from ticket_events te left join tickets t on t.id = te.ticket_id
  order by te.created_at desc limit 20
`;
console.log("recent events:");
for (const r of recent) console.log(r.created_at, r.action, r.token, r.status);

const allTickets = await sql`
  select token, status, created_at, completed_at, care_path, path_step
  from tickets order by created_at desc
`;
console.log("all tickets", allTickets);

const def = await sql`
  select pg_get_functiondef(p.oid) as def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'issue_visit'
`;
fs.writeFileSync("scripts/_issue_visit.txt", def.map((d) => d.def).join("\n\n----\n\n"));

const auto = await sql`
  select pg_get_functiondef(p.oid) as def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'run_queue_automation'
`;
fs.writeFileSync("scripts/_automation.txt", auto[0]?.def || "");

const close = await sql`
  select pg_get_functiondef(p.oid) as def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'close_day'
`;
fs.writeFileSync("scripts/_close_day.txt", close.map((d) => d.def).join("\n\n----\n\n"));

console.log("wrote function defs");

// Try issuing a test visit if a patient exists
const patients = await sql`select id, first_name, card_no from patients order by created_at desc limit 3`;
console.log("patients", patients);

if (patients[0]) {
  // Simulate issue_visit as anon-ish via direct call - need to set role?
  try {
    const result = await sql`
      select public.issue_visit(
        ${patients[0].id}::uuid,
        'consultation',
        'walk_in',
        'cash',
        'green',
        '',
        'en',
        null::timestamptz,
        null::text,
        null::text,
        null::uuid
      ) as r
    `;
    console.log("test issue_visit", JSON.stringify(result[0]?.r, null, 2));
    const after = await sql`
      select token, status, s.code, care_path, path_step
      from tickets t join services s on s.id = t.service_id
      where t.status = 'waiting'
      order by created_at desc limit 5
    `;
    console.log("waiting after test", after);
  } catch (e) {
    console.error("issue_visit failed", e.message);
  }
}

await sql.end({ timeout: 5 });
