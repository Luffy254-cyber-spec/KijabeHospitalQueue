import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Sparkles, Star } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/ticket/$id")({
  head: () => ({
    meta: [
      { title: "My Queue Ticket — Kijabe Hospital" },
      { name: "description", content: "Follow your place in the queue at AIC Kijabe Hospital." },
      { property: "og:title", content: "My Queue Ticket — Kijabe Hospital" },
      { property: "og:description", content: "Follow your place in the queue at AIC Kijabe Hospital." },
    ],
  }),
  component: TicketPage,
});

type PayStatus = {
  found?: boolean;
  paid?: boolean;
  status?: string;
  method?: string;
  amount_kes?: number;
  mpesa_receipt?: string | null;
};

type Status = {
  id: string;
  token: string;
  status: string;
  service_en: string;
  service_sw: string;
  counter: string | null;
  ahead: number;
  est_minutes: number;
  has_feedback: boolean;
  triage?: string;
  step?: number;
  path?: { en: string; sw: string }[] | null;
  payment?: string;
  payment_status?: PayStatus | null;
};

const STATUS_TEXT: Record<string, string> = {
  waiting: "Waiting in queue",
  called: "It's your turn — please go to the room shown",
  serving: "Being served",
  done: "Visit complete",
  closed: "Visit closed",
  cancelled: "Visit cancelled",
  no_show: "Missed — please see the help desk",
};

const DISCHARGED = new Set(["done", "closed", "cancelled"]);

function TicketPage() {
  const { id } = Route.useParams();
  const [s, setS] = useState<Status | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const load = () =>
      supabase.rpc("get_ticket_status", { p_id: id }).then(({ data }) => {
        setS(data as unknown as Status);
        setLoaded(true);
      });
    load();
    supabase.rpc("mark_ticket_opened", { p_id: id });
    // Poll fallback (network / missed realtime)
    const t = setInterval(load, 8000);
    const ch = supabase
      .channel(`ticket-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets", filter: `id=eq.${id}` }, () => {
        setLive(true);
        load();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "payments", filter: `ticket_id=eq.${id}` }, () => {
        setLive(true);
        load();
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setLive(true);
      });
    return () => {
      clearInterval(t);
      supabase.removeChannel(ch);
    };
  }, [id]);

  if (!loaded) return <main className="min-h-screen bg-background" />;
  if (!s) return <main className="flex min-h-screen items-center justify-center bg-background p-6"><p>Ticket not found.</p></main>;

  const pay = s.payment_status;
  const called = s.status === "called";
  const discharged = DISCHARGED.has(s.status);

  return (
    <main className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-md">
        <p className="text-center text-sm font-semibold uppercase tracking-[0.2em] text-primary">AIC Kijabe Hospital</p>
        <p className="mt-1 text-center text-xs text-muted-foreground">{live ? "Live updates on" : "Connecting…"} · track from your phone</p>
        <div className={`mt-4 rounded-3xl p-8 text-center ${called ? "animate-pulse bg-accent text-accent-foreground" : "bg-card border"}`}>
          {called && <p className="mb-2 text-sm font-bold uppercase tracking-[0.3em]">Now calling you</p>}
          <p className="font-display text-6xl font-extrabold">{s.token}</p>
          <p className="mt-2 text-lg">{s.service_en} · {s.service_sw}</p>
          <p className="mt-6 text-2xl font-bold">{STATUS_TEXT[s.status] ?? s.status}</p>
          {called && s.counter && <p className="mt-1 text-xl font-semibold">Go to {s.counter}</p>}
          {s.triage && s.triage !== "green" && (
            <p className={`mt-3 inline-block rounded-full px-4 py-1 text-sm font-bold uppercase ${s.triage === "red" ? "bg-destructive text-destructive-foreground" : "bg-accent text-accent-foreground"}`}>
              {s.triage === "red" ? "Red · urgent" : "Orange · priority"}
            </p>
          )}
          {s.status === "waiting" && (
            <p className="mt-2 text-muted-foreground">{s.ahead} ahead of you · about {s.est_minutes} min</p>
          )}
        </div>

        {discharged && (
          <div className="ticket-blessing mt-4 overflow-hidden rounded-3xl border border-success/30 bg-gradient-to-br from-success/15 via-card to-primary/15 p-6 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-success" aria-hidden />
            <p className="mt-3 font-display text-2xl font-extrabold tracking-tight">Quick recovery</p>
            <p className="mt-1 text-sm text-muted-foreground">May God bless you · Mungu akubariki</p>
            <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.28em] text-success">
              Visit complete · Huduma imekamilika
            </p>
          </div>
        )}

        {pay?.found && (
          <div className={`mt-4 rounded-2xl border p-4 ${pay.paid ? "border-success/40 bg-success/10" : "bg-card"}`}>
            <p className="font-semibold">Payment</p>
            {pay.paid ? (
              <p className="text-sm text-success">
                Paid{pay.method ? ` via ${pay.method}` : ""} · KES {pay.amount_kes}
                {pay.mpesa_receipt ? ` · ${pay.mpesa_receipt}` : ""}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {pay.status === "pushed" ? "M-Pesa prompt sent — enter your PIN on your phone" : `Status: ${pay.status}`}
              </p>
            )}
          </div>
        )}

        {s.path && s.path.length > 1 && (
          <ol className="mt-5 space-y-2">
            {s.path.map((p, i) => (
              <li
                key={i}
                className={`flex items-center gap-3 rounded-xl border p-3 ${
                  i === (s.step ?? 0) && s.status !== "done"
                    ? "border-primary bg-primary/10 font-bold"
                    : i < (s.step ?? 0) || s.status === "done"
                      ? "text-muted-foreground line-through"
                      : ""
                }`}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-sm">{i + 1}</span>
                {p.en} · {p.sw}
              </li>
            ))}
          </ol>
        )}
        {s.status === "done" && !s.has_feedback && <Feedback id={s.id} onDone={() => setS({ ...s, has_feedback: true })} />}
        {s.has_feedback && <p className="mt-6 text-center text-muted-foreground">Thank you for your feedback. Asante!</p>}
      </div>
    </main>
  );
}

function Stars({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="mt-4">
      <p className="font-semibold">{label}</p>
      <div className="mt-1 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => onChange(n)} aria-label={`${n} stars`}>
            <Star className={`h-9 w-9 ${n <= value ? "fill-accent text-accent" : "text-muted-foreground"}`} />
          </button>
        ))}
      </div>
    </div>
  );
}

function Feedback({ id, onDone }: { id: string; onDone: () => void }) {
  const [overall, setOverall] = useState(0);
  const [wait, setWait] = useState(0);
  const [courtesy, setCourtesy] = useState(0);
  const [comment, setComment] = useState("");
  const submit = async () => {
    const { error } = await supabase.rpc("submit_feedback", {
      p_ticket: id,
      p_rating: overall,
      p_wait: wait || (null as unknown as number),
      p_courtesy: courtesy || (null as unknown as number),
      p_comment: comment,
    });
    if (error) toast.error("Could not send feedback");
    else onDone();
  };
  return (
    <div className="mt-6 rounded-3xl border bg-card p-6">
      <h2 className="text-xl font-bold">How was your visit?</h2>
      <Stars label="Overall experience" value={overall} onChange={setOverall} />
      <Stars label="Waiting time" value={wait} onChange={setWait} />
      <Stars label="Staff courtesy" value={courtesy} onChange={setCourtesy} />
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={1000}
        placeholder="Anything we can improve?"
        className="mt-4 w-full rounded-xl border bg-background p-3"
        rows={3}
      />
      <button disabled={!overall} onClick={submit} className="mt-4 h-12 w-full rounded-xl bg-primary font-bold text-primary-foreground disabled:opacity-40">
        Send feedback
      </button>
    </div>
  );
}
