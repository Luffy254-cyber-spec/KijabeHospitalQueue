/** @deprecated Local Postgres — use db.server + local-auth instead of Supabase. */
export { sql, withUser } from "@/lib/db.server";
export { bearerUser as assertStaffUser, bearerUser } from "@/lib/local-auth.server";
