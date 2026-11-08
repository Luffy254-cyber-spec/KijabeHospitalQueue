import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/apply-db-fix")({
  component: () => (
    <main className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-xl space-y-4">
        <Link to="/staff" className="text-sm text-primary underline">
          ← Staff
        </Link>
        <h1 className="text-3xl font-bold">Database setup</h1>
        <p>
          This app runs on PostgreSQL. A maintainer provisions the schema from the
          repository with:
        </p>
        <pre className="rounded-xl border bg-card p-4 text-sm">npm run db:bootstrap</pre>
        <p>
          The script prints the development administrator it created once. Use a
          different, strong password for any hosted database and share it only
          through your password manager.
        </p>
        <Link to="/staff" className="inline-block font-semibold text-primary underline">
          Open staff console →
        </Link>
      </div>
    </main>
  ),
});
