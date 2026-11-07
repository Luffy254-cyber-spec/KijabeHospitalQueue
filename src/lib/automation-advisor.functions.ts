import { createServerFn } from "@tanstack/react-start";
import { requireStaffAuth } from "@/lib/require-staff.server";
import { withUser } from "@/lib/db.server";
import { clampSettings, type AutomationSettings } from "@/lib/automation";

type AutomationRow = Record<string, unknown>;

export const recommendAutomation = createServerFn({ method: "POST" })
  .middleware([requireStaffAuth])
  .inputValidator((input: { serviceId: string; policy: string }) => {
    if (!input.serviceId || typeof input.policy !== "string") throw new Error("Invalid input");
    const policy = input.policy.trim().slice(0, 4000);
    if (policy.length < 10) throw new Error("Please describe the policy in a bit more detail.");
    return { serviceId: input.serviceId, policy };
  })
  .handler(async ({ data, context }) => {
    const result = await withUser(context.userId, context.email, async (tx) => {
      const [role] = await tx<{ is_admin: boolean }[]>`
        select public.has_role(${context.userId}::uuid, 'admin'::public.app_role) as is_admin
      `;
      if (!role?.is_admin) return { kind: "forbidden" as const };
      const [svc] = await tx<{ name_en: string; avg_minutes: number }[]>`
        select name_en, avg_minutes from public.services where id = ${data.serviceId}::uuid
      `;
      const [current] = await tx<AutomationRow[]>`
        select * from public.automation_settings where service_id = ${data.serviceId}::uuid
      `;
      if (!svc || !current) return { kind: "missing" as const };
      return { kind: "ok" as const, svc, current };
    });
    if (result.kind === "forbidden") throw new Error("Only automation admins can request recommendations.");
    if (result.kind === "missing") throw new Error("Department not found");

    const { svc, current } = result;
    const { generateText, AiError, aiErrorMessage } = await import("@/lib/gemini.server");
    try {
      const text = await generateText({
        instructions:
          "You configure outpatient queue automation at AIC Kijabe Hospital, Kenya. Recommend SAFE, conservative thresholds that follow the staff's policy. Patient safety first: never make automation remove patients faster than the policy allows; prefer giving patients more chances. Do not give clinical advice. " +
          "Reply with ONLY a JSON object with keys: recall_enabled (bool), recall_after_min (1-30), max_recalls (0-5), no_show_enabled (bool), no_show_after_min (1-60), requeue_enabled (bool), requeue_after_min (1-240), max_returns (0-5), surge_enabled (bool), surge_threshold (1-500 waiting patients), long_wait_enabled (bool), long_wait_min (5-480), rationale (short markdown bullet list explaining each choice and any safety caveat).",
        input: `Department: ${svc.name_en} (about ${svc.avg_minutes} min per patient)\nCurrent settings: ${JSON.stringify(current)}\n\nStaff policy description:\n${data.policy}`,
      });
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) return { settings: null, rationale: "", error: "The assistant didn't return settings. Please try again." };
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(m[0]); } catch { return { settings: null, rationale: "", error: "The assistant's answer couldn't be read. Please try again." }; }
      const settings: AutomationSettings = clampSettings(parsed as Partial<Record<keyof AutomationSettings, unknown>>, current as unknown as AutomationSettings);
      return { settings, rationale: typeof parsed["rationale"] === "string" ? parsed["rationale"] : "", error: null as string | null };
    } catch (e) {
      if (e instanceof AiError) {
        console.error("automation advisor ai error", e.status, e.message);
        return { settings: null, rationale: "", error: aiErrorMessage(e) };
      }
      throw e;
    }
  });
