import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL || "postgres://postgres:6285@localhost:5432/kijabe_care_flow";
const sql = postgres(url, { max: 1, onnotice: () => {} });
const file = path.join(__dirname, "../drizzle/migrations/0025_observe_new_department.sql");

try {
  await sql.unsafe(fs.readFileSync(file, "utf8"));
  const check = await sql`
    select
      to_regprocedure('public.admin_create_service(text,text,text,int,text)') is not null as create_svc,
      to_regprocedure('public.admin_create_room(text,uuid,boolean,text)') is not null as create_room,
      to_regprocedure('public.admin_observe_queue(uuid)') is not null as observe
  `;
  console.log("0025 applied", check[0]);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 2 });
}
