import { createServerFn } from "@tanstack/react-start";
import { requireStaffAuth } from "@/lib/require-staff.server";
import { withUser } from "@/lib/db.server";

type TicketStatRow = {
  status: string;
  priority: number;
  payment: string;
  queued_at: Date;
  called_at: Date | null;
  completed_at: Date | null;
};

export const suggestWorkflow = createServerFn({ method: "POST" })
  .middleware([requireStaffAuth])
  .inputValidator((input: { serviceId: string; notes: string }) => {
    if (!input.serviceId || typeof input.notes !== "string") throw new Error("Invalid input");
    const notes = input.notes.trim().slice(0, 3000);
    if (notes.length < 10) throw new Error("Please describe the situation in a bit more detail.");
    return { serviceId: input.serviceId, notes };
  })
  .handler(async ({ data, context }) => {
    const found = await withUser(context.userId, context.email, async (tx) => {
      const [svc] = await tx<{ id: string; name_en: string; avg_minutes: number }[]>`
        select id, name_en, avg_minutes from public.services where id = ${data.serviceId}::uuid
      `;
      if (!svc) return null;
      const tix = await tx<TicketStatRow[]>`
        select status, priority, payment, queued_at, called_at, completed_at
        from public.tickets
        where service_id = ${svc.id}::uuid and created_at >= now() - interval '12 hours'
        limit 1000
      `;
      const ctrs = await tx<{ active: boolean }[]>`
        select name, active from public.counters where service_id = ${svc.id}::uuid
      `;
      return { svc, tix, ctrs };
    });
    if (!found) throw new Error("Department not found");

    const { svc, tix, ctrs } = found;
    const t = tix;
    const waiting = t.filter((x) => x.status === "waiting");
    const waits = t
      .filter((x) => x.called_at)
      .map((x) => (new Date(x.called_at!).getTime() - new Date(x.queued_at).getTime()) / 60000);
    const avgWait = waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null;
    const byPay = (p: string) => t.filter((x) => x.payment === p).length;
    const stats = {
      department: svc.name_en,
      expected_minutes_per_patient: svc.avg_minutes,
      counters_open: ctrs.filter((c) => c.active).length,
      tickets_last_12h: t.length,
      waiting_now: waiting.length,
      priority_or_emergency_waiting: waiting.filter((x) => x.priority > 0).length,
      average_wait_minutes: avgWait,
      no_shows: t.filter((x) => x.status === "no_show").length,
      payment_mix: { cash: byPay("cash"), insurance: byPay("insurance"), sha: byPay("sha") },
    };

    const { generateText, AiError, aiErrorMessage } = await import("@/lib/gemini.server");
    try {
      const text = await generateText({
        instructions:
          "You advise hospital outpatient operations staff at AIC Kijabe Hospital, Kenya. Suggest only NON-CLINICAL workflow changes to reduce waiting times: staffing and counter allocation, queue routing, pre-registration, payment/insurance/SHA handling, signage, communication, scheduling. Never give medical, diagnostic, triage-severity or treatment advice; if asked, say that is for clinicians. Use the live statistics provided. Reply in concise markdown: a one-line read of the situation, then 3–6 numbered suggestions each with the expected impact, then one 'Quick win for the next hour'.",
        input: `Live statistics:\n${JSON.stringify(stats, null, 2)}\n\nStaff description of current conditions:\n${data.notes}`,
      });
      return { suggestion: text || "No suggestion was returned. Please try again.", stats, error: null as string | null };
    } catch (e) {
      if (e instanceof AiError) {
        console.error("advisor ai error", e.status, e.message);
        return { suggestion: "", stats, error: aiErrorMessage(e) };
      }
      throw e;
    }
  });
