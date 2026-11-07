import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL || "postgres://postgres:6285@localhost:5432/kijabe_care_flow";
const sql = postgres(url, { max: 1, onnotice: () => {} });
const file = path.join(__dirname, "../drizzle/migrations/0023_display_rooms_serving.sql");

try {
  const body = fs.readFileSync(file, "utf8");
  await sql.unsafe(body);
  const sample = await sql`
    select jsonb_array_length((get_display_board()::jsonb)->'rooms') as rooms,
           jsonb_array_length((get_display_board()::jsonb)->'called') as called
  `;
  console.log("0023 applied", sample[0]);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 2 });
}
