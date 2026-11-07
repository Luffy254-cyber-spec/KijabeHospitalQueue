import { createFileRoute } from "@tanstack/react-router";
import { withUser } from "@/lib/db.server";
import { bearerUser } from "@/lib/local-auth.server";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const ALLOWED_TABLES = new Set([
  "services",
  "counters",
  "tickets",
  "ticket_events",
  "automation_settings",
  "patients",
  "payments",
  "service_fees",
  "feedback",
]);

type Filter =
  | { type: "eq"; col: string; val: unknown }
  | { type: "in"; col: string; val: unknown[] }
  | { type: "neq"; col: string; val: unknown }
  | { type: "ilike"; col: string; val: string };

function ident(name: string) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`Invalid identifier: ${name}`);
  return `"${name}"`;
}

export const Route = createFileRoute("/api/local/query")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            table?: string;
            select?: string;
            filters?: Filter[];
            order?: { col: string; ascending?: boolean };
            limit?: number;
            single?: boolean;
          };
          const table = body.table || "";
          if (!ALLOWED_TABLES.has(table)) {
            return Response.json({ error: { message: `Table not allowed: ${table}` } }, { status: 400, headers: cors });
          }
          const user = bearerUser(request);
          const cols =
            !body.select || body.select === "*"
              ? "*"
              : body.select
                  .split(",")
                  .map((c) => c.trim())
                  .filter(Boolean)
                  .map((c) => {
                    // allow nested selects like tickets(token) — strip for local simplicity
                    if (c.includes("(")) return null;
                    return ident(c);
                  })
                  .filter(Boolean)
                  .join(", ") || "*";

          const params: unknown[] = [];
          const where: string[] = [];
          for (const f of body.filters || []) {
            if (f.type === "eq") {
              params.push(f.val);
              where.push(`${ident(f.col)} = $${params.length}`);
            } else if (f.type === "neq") {
              params.push(f.val);
              where.push(`${ident(f.col)} <> $${params.length}`);
            } else if (f.type === "in") {
              params.push(f.val);
              where.push(`${ident(f.col)} = any($${params.length})`);
            } else if (f.type === "ilike") {
              params.push(f.val);
              where.push(`${ident(f.col)} ilike $${params.length}`);
            }
          }
          let q = `select ${cols} from public.${ident(table)}`;
          if (where.length) q += ` where ${where.join(" and ")}`;
          if (body.order?.col) {
            q += ` order by ${ident(body.order.col)} ${body.order.ascending === false ? "desc" : "asc"}`;
          }
          if (body.limit) {
            params.push(body.limit);
            q += ` limit $${params.length}`;
          }

          const data = await withUser(user?.id || null, user?.email || null, async (tx) => {
            const rows = await tx.unsafe(q, params);
            return rows;
          });

          if (body.single) {
            if (!data.length) {
              return Response.json(
                { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } },
                { headers: cors },
              );
            }
            return Response.json({ data: data[0], error: null }, { headers: cors });
          }
          return Response.json({ data, error: null }, { headers: cors });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Query failed";
          return Response.json({ data: null, error: { message: msg } }, { status: 400, headers: cors });
        }
      },
    },
  },
});
