import postgres from "postgres";

const url = process.env.DATABASE_URL || "postgres://postgres:6285@localhost:5432/kijabe_care_flow";
const sql = postgres(url, { max: 1, onnotice: () => {} });

const st = await sql`select * from automation_state`;
console.log("automation_state", st);

// Simulate what happens if staff calls get_counter_queue as marcellino
const u = await sql`select id, email from auth.users where email = 'marcellinostephen052@gmail.com'`;
const triage = await sql`
  select c.id, c.name from counters c
  join services s on s.id = c.service_id where s.code = 'triage' and c.active limit 1
`;
const reg = await sql`
  select c.id, c.name from counters c
  join services s on s.id = c.service_id where s.code = 'registration' and c.active limit 1
`;

if (u[0] && triage[0]) {
  await sql.begin(async (tx) => {
    await tx`select set_config('app.current_user_id', ${u[0].id}, true)`;
    await tx`select set_config('app.role', 'authenticated', true)`;
    const jwt = JSON.stringify({ sub: u[0].id, email: u[0].email, role: "authenticated" });
    await tx`select set_config('app.current_jwt', ${jwt}, true)`;
    try {
      const q = await tx`select public.get_counter_queue(${triage[0].id}::uuid) as q`;
      console.log("staff triage queue", q[0].q);
    } catch (e) {
      console.log("staff triage ERROR", e.message);
    }
    try {
      const q2 = await tx`select public.get_counter_queue(${reg[0].id}::uuid) as q`;
      console.log("staff registration queue", q2[0].q);
    } catch (e) {
      console.log("staff registration ERROR", e.message);
    }
  });
}

await sql.end({ timeout: 5 });
