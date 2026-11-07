import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/track/$patientId")({
  head: () => ({
    meta: [
      { title: "Track my queue — Kijabe Hospital" },
      { name: "description", content: "Follow your place in the outpatient queue at AIC Kijabe Hospital." },
    ],
  }),
  component: PatientTrackPage,
});

type TicketBit = {
  id: string;
  token: string;
  status: string;
  service_en: string;
  service_sw: string;
  counter: string | null;
  ahead: number;
  est_minutes: number;
  triage?: string;
};

type Track = {
  found?: boolean;
  has_ticket?: boolean;
  message?: string;
  ticket?: TicketBit | null;
};

const STATUS_TEXT: Record<string, string> = {
  waiting: "Waiting in queue",
  called: "It's your turn — go to the room shown",
  serving: "Being served",
  done: "Visit complete",
  no_show: "Missed — please see the help desk",
};

function PatientTrackPage() {
  const { patientId } = Route.useParams();
  const [data, setData] = useState<Track | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = () =>
      supabase.rpc("get_patient_track", { p_patient: patientId }).then(({ data: d }) => {
        const track = d as unknown as Track;
        setData(track);
        setLoaded(true);
        if (track?.ticket?.id) supabase.rpc("mark_ticket_opened", { p_id: track.ticket.id });
      });
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [patientId]);

  if (!loaded) return <main className="min-h-screen bg-background" />;
  if (!data?.found) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <p className="text-muted-foreground">Tracking link not found.</p>
      </main>
    );
  }

  const ticket = data.ticket;
  const called = ticket?.status === "called";

  return (
    <main className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-md text-center">
        <img src="/brand/kijabe-logo.png" alt="" className="mx-auto h-12 w-auto object-contain" />
        <p className="mt-3 text-sm font-semibold uppercase tracking-[0.2em] text-primary">AIC Kijabe Hospital</p>
        <p className="mt-1 text-xs text-muted-foreground">Live queue on your phone · updates every few seconds</p>

        {!data.has_ticket || !ticket ? (
          <div className="mt-8 rounded-3xl border bg-card p-8">
            <p className="font-display text-2xl font-bold text-foreground">Almost there</p>
            <p className="mt-3 text-muted-foreground">
              {data.message || "Finish check-in on the kiosk — your ticket will appear here automatically."}
            </p>
            <p className="mt-6 text-sm text-muted-foreground">You can buy a snack and keep this page open.</p>
            <div className="mx-auto mt-6 h-2 w-32 overflow-hidden rounded-full bg-muted">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-primary" />
            </div>
          </div>
        ) : (
          <div className={`mt-8 rounded-3xl p-8 ${called ? "animate-pulse bg-accent text-accent-foreground" : "border bg-card"}`}>
            {called && <p className="mb-2 text-sm font-bold uppercase tracking-[0.3em]">Now calling you</p>}
            <p className="font-display text-6xl font-extrabold text-primary">{ticket.token}</p>
            <p className="mt-2 text-lg">{ticket.service_en}</p>
            <p className="mt-6 text-2xl font-bold">{STATUS_TEXT[ticket.status] ?? ticket.status}</p>
            {called && ticket.counter && <p className="mt-1 text-xl font-semibold">Go to {ticket.counter}</p>}
            {ticket.status === "waiting" && (
              <p className="mt-2 text-muted-foreground">
                {ticket.ahead} ahead · about {ticket.est_minutes} min
              </p>
            )}
            <Link to="/ticket/$id" params={{ id: ticket.id }} className="mt-6 inline-block text-sm font-semibold text-primary underline">
              Open full ticket view
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
