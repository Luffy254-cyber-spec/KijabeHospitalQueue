import postgres from "postgres";

const url = process.env.DATABASE_URL || "postgres://postgres:6285@localhost:5432/kijabe_care_flow";
const sql = postgres(url, { max: 1, onnotice: () => {} });

const board = await sql`select public.get_display_board() as b`;
const b = board[0].b;
console.log("waiting_all", b.waiting_all);
console.log(
  "queues waiting",
  b.queues.filter((q) => q.waiting > 0).map((q) => ({ code: q.code, n: q.waiting, next: q.next_tokens })),
);

const counters = await sql`
  select c.id, c.name, s.code
  from counters c join services s on s.id = c.service_id
  where c.active order by c.name
`;
console.log("counters", counters.map((c) => ({ name: c.name, code: c.code })));

const triage = counters.find((c) => c.code === "triage");
if (triage) {
  // get_counter_queue needs auth.uid() - may fail
  try {
    const q = await sql`select public.get_counter_queue(${triage.id}::uuid) as q`;
    console.log("triage queue", q[0].q);
  } catch (e) {
    console.log("get_counter_queue error (expected without auth):", e.message);
  }
}

// Check automation thresholds
const autoSrc = await sql`
  select pg_get_functiondef(p.oid) as def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='run_queue_automation'
`;
const def = autoSrc[0]?.def || "";
const noShow = def.match(/auto_no_show[\s\S]{0,400}/);
const interval = def.match(/interval '[^']+'/g);
console.log("intervals in automation", interval);
console.log("no_show snippet", noShow?.[0]?.slice(0, 350));

await sql.end({ timeout: 5 });
