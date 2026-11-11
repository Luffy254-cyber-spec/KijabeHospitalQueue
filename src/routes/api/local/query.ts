import { createFileRoute } from "@tanstack/react-router";
import { withUser } from "@/lib/db.server";
import { bearerUser } from "@/lib/local-auth.server";
import { corsHeaders } from "@/lib/http-security";
import { handleMockQuery } from "@/lib/mock-db.server";

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

/** Patient, payment and audit tables must never be readable anonymously. */
const STAFF_ONLY = new Set(["patients", "payments", "feedback", "ticket_events", "automation_settings"]);

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
      OPTIONS: async ({ request }) => new Response(null, { status: 204, headers: corsHeaders(request) }),
      POST: async ({ request }) => {
        const cors = corsHeaders(request);
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
          if (STAFF_ONLY.has(table) && !user) {
            return Response.json(
              { data: null, error: { message: "Sign in as staff to read this table" } },
              { status: 403, headers: cors },
            );
          }
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
          let data: Record<string, unknown>[] = [];
          try {
            data = await withUser(user?.id || null, user?.email || null, async (tx) => {
              const rows = await tx.unsafe(q, params);
              return rows;
            });
          } catch (dbErr) {
            console.warn("[Local Query] Using in-memory store fallback:", (dbErr as Error)?.message);
            const mockData = handleMockQuery(body);
            if (body.single) {
              return Response.json({ data: mockData ?? null, error: null }, { headers: cors });
            }
            return Response.json({ data: mockData ?? [], error: null }, { headers: cors });
          }

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
