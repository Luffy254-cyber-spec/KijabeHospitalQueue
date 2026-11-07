import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL || "postgres://postgres:6285@localhost:5432/kijabe_care_flow";
const sql = postgres(url, { max: 1, onnotice: () => {} });
const file = path.join(__dirname, "../drizzle/migrations/0024_notifications_add_rooms.sql");

try {
  const body = fs.readFileSync(file, "utf8");
  await sql.unsafe(body);
  const check = await sql`
    select
      to_regprocedure('public.admin_create_room(text,uuid,boolean)') is not null as create_room,
      to_regprocedure('public.admin_set_room_active(uuid,boolean)') is not null as set_active,
      to_regprocedure('public.staff_my_notifications(int)') is not null as notifications
  `;
  console.log("0024 applied", check[0]);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 2 });
}
