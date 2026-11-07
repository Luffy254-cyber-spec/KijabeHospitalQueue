import postgres from "postgres";

const url = process.env.DATABASE_URL || "postgres://postgres:6285@localhost:5432/kijabe_care_flow";
const sql = postgres(url, { max: 1, onnotice: () => {} });

const tickets = await sql`
  select t.token, t.status, s.code, s.name_en, t.care_path, t.path_step, t.created_at
  from tickets t join services s on s.id = t.service_id
  order by t.created_at desc limit 25
`;
console.log("=== recent tickets ===");
for (const t of tickets) {
  console.log(
    t.token,
    t.status,
    t.code,
    "path=",
    JSON.stringify(t.care_path),
    "step=",
    t.path_step,
  );
}

const byStatus = await sql`select status, count(*)::int as n from tickets group by status order by status`;
console.log("=== by status ===", byStatus);

const board = await sql`select public.get_display_board() as b`;
const b = board[0].b;
console.log("=== board keys ===", Object.keys(b || {}));
console.log("waiting_all", (b?.waiting_all || []).length, b?.waiting_all?.slice?.(0, 5));
console.log(
  "queues with waiting",
  (b?.queues || []).filter((q) => q.waiting > 0).map((q) => ({ code: q.code, waiting: q.waiting, next: q.next_tokens })),
);
console.log("called", (b?.called || []).length);

const defs = await sql`
  select pg_get_functiondef(p.oid) as def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_display_board'
`;
console.log("=== get_display_board has waiting_all? ===", /waiting_all/.test(defs[0]?.def || ""));

await sql.end({ timeout: 5 });
