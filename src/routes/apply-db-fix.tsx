import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/apply-db-fix")({
  component: () => (
    <main className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-xl space-y-4">
        <Link to="/staff" className="text-sm text-primary underline">
          ← Staff
        </Link>
        <h1 className="text-3xl font-bold">Local PostgreSQL</h1>
        <p>
          This app uses your local database <code>kijabe_care_flow</code> (not Supabase).
        </p>
        <p>Bootstrap:</p>
        <pre className="rounded-xl border bg-card p-4 text-sm">npm run db:bootstrap</pre>
        <p>
          Staff login: <b>admin@kijabe.local</b> / <b>admin1234</b>
        </p>
        <Link to="/staff" className="inline-block font-semibold text-primary underline">
          Open staff console →
        </Link>
      </div>
    </main>
  ),
});
