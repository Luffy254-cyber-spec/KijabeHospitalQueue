import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { clampSettings, DEFAULT_SETTINGS, sampleTickets, simulate, SIM_LABEL, type AutomationSettings, type SampleTicket } from "@/lib/automation";
import { recommendAutomation } from "@/lib/automation-advisor.functions";

export const Route = createFileRoute("/automation")({
  head: () => ({
    meta: [
      { title: "Queue Automation Settings — Kijabe Hospital" },
      { name: "description", content: "Adjust, simulate and get AI recommendations for outpatient queue automation by department." },
      { property: "og:title", content: "Queue Automation Settings — Kijabe Hospital" },
      { property: "og:description", content: "Adjust, simulate and get AI recommendations for outpatient queue automation by department." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AutomationPage,
});

type Service = { id: string; name_en: string; prefix: string };

function AutomationPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    return () => sub.subscription.unsubscribe();
  }, []);
  if (!ready) return <main className="min-h-screen bg-background" />;
  if (!session) return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      <p className="text-lg">Please sign in as staff first.</p>
      <Button asChild><Link to="/staff">Go to staff sign in</Link></Button>
    </main>
  );
  return <Settings userId={session.user.id} />;
}

const RULES: { title: string; help: string; toggle: keyof AutomationSettings; fields: { key: keyof AutomationSettings; label: string }[] }[] = [
  { title: "Auto-recall", help: "Call a patient again if they haven't come to the desk.", toggle: "recall_enabled",
    fields: [{ key: "recall_after_min", label: "Minutes before recall" }, { key: "max_recalls", label: "Maximum recalls" }] },
  { title: "Auto no-show", help: "Mark a patient as missed after the last recall.", toggle: "no_show_enabled",
    fields: [{ key: "no_show_after_min", label: "Minutes after last call" }] },
  { title: "Missed patients back in queue", help: "Give missed patients another chance at the front of the line.", toggle: "requeue_enabled",
    fields: [{ key: "requeue_after_min", label: "Minutes after being missed" }, { key: "max_returns", label: "Maximum returns" }] },
  { title: "High demand", help: "Open overflow desks when the line gets long.", toggle: "surge_enabled",
    fields: [{ key: "surge_threshold", label: "Waiting patients to trigger" }] },
  { title: "Long-wait alert", help: "Highlight patients waiting too long on the staff screen.", toggle: "long_wait_enabled",
    fields: [{ key: "long_wait_min", label: "Minutes waiting" }] },
];

function Settings({ userId }: { userId: string }) {
  const [services, setServices] = useState<Service[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [saved, setSaved] = useState<AutomationSettings | null>(null);
  const [draft, setDraft] = useState<AutomationSettings>(DEFAULT_SETTINGS);
  const [meta, setMeta] = useState<{ updated_at: string; updated_by: string | null } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [saving, setSaving] = useState(false);

  const checkRole = useCallback(async () => {
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin");
    setIsAdmin(!!data?.length);
  }, [userId]);

  useEffect(() => {
    supabase.from("services").select("id,name_en,prefix").order("sort").then(({ data }) => {
      setServices(data ?? []); if (data?.[0]) setServiceId(data[0].id);
    });
    checkRole();
  }, [checkRole]);

  useEffect(() => {
    if (!serviceId) return;
    supabase.from("automation_settings").select("*").eq("service_id", serviceId).single().then(({ data }) => {
      if (!data) return;
      const s = clampSettings(data as unknown as AutomationSettings);
      setSaved(s); setDraft(s); setMeta({ updated_at: data.updated_at, updated_by: data.updated_by });
    });
  }, [serviceId]);

  const changed = saved && JSON.stringify(saved) !== JSON.stringify(draft);
  const set = (k: keyof AutomationSettings, v: number | boolean) => setDraft((d) => clampSettings({ ...d, [k]: v }, d));

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("automation_settings").update(draft).eq("service_id", serviceId);
    setSaving(false);
    if (error) toast.error(error.message);
    else { setSaved(draft); setMeta({ updated_at: new Date().toISOString(), updated_by: "you" }); toast.success("Live queue updated"); }
  };

  const claim = async () => {
    const { data, error } = await supabase.rpc("claim_first_admin");
    if (error) toast.error(error.message);
    else if (!data) toast.error("An admin already exists. Ask them to give you access.");
    else { toast.success("You are now the automation admin"); checkRole(); }
  };

  const svc = services.find((s) => s.id === serviceId);

  return (
    <main className="min-h-screen bg-background">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b bg-card px-6 py-4">
        <div className="flex items-center gap-4">
          <Link to="/staff" className="font-display text-xl font-bold text-primary">← Staff console</Link>
          <h1 className="text-lg font-semibold">Queue automation</h1>
        </div>
        <Select value={serviceId} onValueChange={setServiceId}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Department" /></SelectTrigger>
          <SelectContent>{services.map((s) => <SelectItem key={s.id} value={s.id}>{s.name_en}</SelectItem>)}</SelectContent>
        </Select>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 p-6 lg:grid-cols-[1.1fr_1fr]">
        <section className="rounded-2xl border bg-card p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">{svc?.name_en} rules</h2>
              <p className="text-sm text-muted-foreground">
                Runs every minute during clinic hours, even with no TV on.
                {meta && <> Last changed {new Date(meta.updated_at).toLocaleString("en-KE")}{meta.updated_by ? ` by ${meta.updated_by}` : ""}.</>}
              </p>
            </div>
            {!isAdmin && <Button variant="outline" size="sm" onClick={claim}>Claim admin access</Button>}
          </div>
          {isAdmin && <AddStaff />}
          {!isAdmin && <p className="mt-3 rounded-lg bg-muted p-3 text-sm">You can view and simulate changes. Only automation admins can apply them to the live queue.</p>}
          <div className="mt-4 space-y-4">
            {RULES.map((r) => (
              <div key={r.title} className="rounded-xl border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div><p className="font-semibold">{r.title}</p><p className="text-sm text-muted-foreground">{r.help}</p></div>
                  <Switch checked={draft[r.toggle] as boolean} onCheckedChange={(v) => set(r.toggle, v)} aria-label={`${r.title} on/off`} />
                </div>
                {(draft[r.toggle] as boolean) && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {r.fields.map((f) => (
                      <label key={f.key} className="text-sm">
                        {f.label}
                        <Input type="number" className="mt-1" value={draft[f.key] as number} onChange={(e) => set(f.key, Number(e.target.value))} aria-label={f.label} />
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-5 flex gap-3">
            <Button disabled={!isAdmin || !changed || saving} onClick={save}>{saving ? "Saving…" : "Apply to live queue"}</Button>
            <Button variant="outline" disabled={!changed} onClick={() => saved && setDraft(saved)}>Discard changes</Button>
          </div>
        </section>

        <div className="space-y-6">
          <Simulation draft={draft} saved={saved} prefix={svc?.prefix ?? "OPD"} />
          <Recommender serviceId={serviceId} isAdmin={isAdmin} onApply={(s) => { setDraft(s); toast.success("Loaded into the form — check the simulation, then apply."); }} />
        </div>
      </div>
    </main>
  );
}

function Simulation({ draft, saved, prefix }: { draft: AutomationSettings; saved: AutomationSettings | null; prefix: string }) {
  const [sample, setSample] = useState<SampleTicket[]>(() => sampleTickets(prefix));
  const [extra, setExtra] = useState(20);
  useEffect(() => setSample(sampleTickets(prefix)), [prefix]);
  const next = useMemo(() => simulate(draft, sample, extra, 60), [draft, sample, extra]);
  const now = useMemo(() => (saved ? simulate(saved, sample, extra, 60) : null), [saved, sample, extra]);
  const rows: [string, keyof typeof next.summary][] = [["Recalls", "recalls"], ["Marked missed", "no_shows"], ["Back in queue", "requeued"], ["Still missed after 1h", "still_missed"], ["Long-wait alerts", "long_waits"], ["Overflow desk opens", "overflow_opened"]];
  const fmt = (v: number | boolean) => (typeof v === "boolean" ? (v ? "Yes" : "No") : v);
  return (
    <section className="rounded-2xl border bg-card p-6">
      <h2 className="text-xl font-bold">Simulation (next 60 minutes)</h2>
      <p className="text-sm text-muted-foreground">Sample tickets only — nothing in the live queue changes.</p>
      <ul className="mt-3 space-y-1 text-sm">
        {sample.map((t, i) => (
          <li key={t.token} className="flex items-center justify-between gap-2">
            <span className="font-display font-bold">{t.token}</span>
            <span className="text-muted-foreground">{t.status === "called" ? "Called" : t.status === "no_show" ? "Missed" : "Waiting"} {t.minutesAgo} min ago</span>
            {t.status === "called" ? (
              <Select value={t.arrivesAt === null ? "never" : String(t.arrivesAt)} onValueChange={(v) => setSample((s) => s.map((x, j) => (j === i ? { ...x, arrivesAt: v === "never" ? null : Number(v) } : x)))}>
                <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 3, 5, 8, 12].map((m) => <SelectItem key={m} value={String(m)}>Comes in {m} min</SelectItem>)}
                  <SelectItem value="never">Never comes</SelectItem>
                </SelectContent>
              </Select>
            ) : <span className="w-40" />}
          </li>
        ))}
      </ul>
      <label className="mt-3 block text-sm">Other patients already waiting
        <Input type="number" min={0} max={500} className="mt-1" value={extra} onChange={(e) => setExtra(Math.max(0, Math.min(500, Number(e.target.value) || 0)))} />
      </label>
      <table className="mt-4 w-full text-sm">
        <thead className="text-left text-muted-foreground"><tr><th className="py-1">Outcome</th><th>Live rules</th><th>Your changes</th></tr></thead>
        <tbody className="divide-y">
          {rows.map(([label, k]) => (
            <tr key={k} className={now && now.summary[k] !== next.summary[k] ? "bg-accent/20 font-semibold" : ""}>
              <td className="py-1">{label}</td><td>{now ? fmt(now.summary[k]) : "—"}</td><td>{fmt(next.summary[k])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-semibold">Timeline with your changes ({next.events.length} events)</summary>
        <ul className="mt-2 max-h-56 overflow-auto">
          {next.events.map((e, i) => <li key={i} className="tabular-nums">+{e.minute} min · <b>{e.token}</b> · {SIM_LABEL[e.action]}</li>)}
        </ul>
      </details>
    </section>
  );
}

function Recommender({ serviceId, isAdmin, onApply }: { serviceId: string; isAdmin: boolean; onApply: (s: AutomationSettings) => void }) {
  const run = useServerFn(recommendAutomation);
  const [policy, setPolicy] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ settings: AutomationSettings; rationale: string } | null>(null);
  const submit = async () => {
    setBusy(true); setResult(null);
    try {
      const r = await run({ data: { serviceId, policy } });
      if (r.error || !r.settings) toast.error(r.error ?? "No recommendation"); else setResult({ settings: r.settings, rationale: r.rationale });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setBusy(false); }
  };
  return (
    <section className="rounded-2xl border bg-card p-6">
      <h2 className="text-xl font-bold">AI policy assistant</h2>
      <p className="text-sm text-muted-foreground">Describe your department's queue policy and get safe, suggested settings. Nothing changes until an admin applies them.</p>
      <Textarea className="mt-3" rows={5} maxLength={4000} value={policy} onChange={(e) => setPolicy(e.target.value)} disabled={!isAdmin}
        placeholder="e.g. Elderly patients walk slowly from the benches, give at least 3 minutes before recalling. Never drop someone after only one missed call. Pharmacy gets busy after 11am..." />
      <Button className="mt-3 w-full" disabled={!isAdmin || busy || !serviceId || policy.trim().length < 10} onClick={submit}>
        {busy ? "Thinking…" : isAdmin ? "Recommend settings" : "Admins only"}
      </Button>
      {result && (
        <div className="mt-4 rounded-xl bg-muted p-4 text-sm">
          <ul className="grid grid-cols-2 gap-1">
            {Object.entries(result.settings).map(([k, v]) => <li key={k}><span className="text-muted-foreground">{k.replace(/_/g, " ")}:</span> <b>{String(v)}</b></li>)}
          </ul>
          {result.rationale && <div className="mt-3 whitespace-pre-wrap leading-relaxed">{result.rationale}</div>}
          <Button className="mt-3" onClick={() => onApply(result.settings)}>Load into form & simulate</Button>
        </div>
      )}
    </section>
  );
}

function AddStaff() {
  const [email, setEmail] = useState("");
  async function add() {
    const { data, error } = await supabase.rpc("grant_staff_role", { p_email: email });
    if (error) toast.error("Could not add staff member");
    else if (!data) toast.error("No account with that email — ask them to sign up first");
    else { toast.success("Staff access granted"); setEmail(""); }
  }
  return (
    <div className="mt-3 flex gap-2 rounded-lg bg-muted p-3">
      <Input type="email" placeholder="Staff email to grant queue access" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Button disabled={!email.includes("@")} onClick={add}>Add staff</Button>
    </div>
  );
}
