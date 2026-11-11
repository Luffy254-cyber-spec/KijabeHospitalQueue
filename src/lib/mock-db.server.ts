/**
 * In-Memory Database Fallback for AI Studio Preview Environment.
 * Used when external PostgreSQL / Cloud SQL is not connected.
 */

export type MockService = {
  id: string;
  code: string;
  prefix: string;
  name_en: string;
  name_sw: string;
  description_en: string;
  description_sw: string;
  kiosk_visible: boolean;
  avg_minutes: number;
  sort: number;
  surge_threshold: number;
  category: string;
};

export type MockCounter = {
  id: string;
  name: string;
  service_id: string;
  active: boolean;
};

export type MockTicket = {
  id: string;
  token: string;
  service_id: string;
  visit_type: string;
  payment: string;
  priority: number;
  phone: string | null;
  language: string;
  status: "waiting" | "called" | "serving" | "done" | "no_show";
  counter_id: string | null;
  queued_at: string;
  called_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  recall_count: number;
  created_at: string;
  opened?: boolean;
};

export type MockPatient = {
  id: string;
  full_name: string;
  phone: string;
  hospital_number?: string;
  created_at: string;
};

export const MOCK_SERVICES: MockService[] = [
  {
    id: "10000000-0000-0000-0000-000000000001",
    code: "registration",
    prefix: "REG",
    name_en: "Registration",
    name_sw: "Usajili",
    description_en: "New & returning patients, file retrieval",
    description_sw: "Wagonjwa wapya na wanaorudi",
    kiosk_visible: true,
    avg_minutes: 4,
    sort: 1,
    surge_threshold: 15,
    category: "admin",
  },
  {
    id: "10000000-0000-0000-0000-000000000002",
    code: "triage",
    prefix: "TRI",
    name_en: "Triage",
    name_sw: "Uchunguzi wa Awali",
    description_en: "Vitals & nurse assessment",
    description_sw: "Vipimo vya awali na muuguzi",
    kiosk_visible: false,
    avg_minutes: 5,
    sort: 2,
    surge_threshold: 10,
    category: "clinical",
  },
  {
    id: "10000000-0000-0000-0000-000000000003",
    code: "consultation",
    prefix: "OPD",
    name_en: "Doctor Consultation",
    name_sw: "Kuonana na Daktari",
    description_en: "Outpatient clinic consultation",
    description_sw: "Kliniki ya wagonjwa wa nje",
    kiosk_visible: true,
    avg_minutes: 12,
    sort: 3,
    surge_threshold: 20,
    category: "clinical",
  },
  {
    id: "10000000-0000-0000-0000-000000000004",
    code: "cashier",
    prefix: "CSH",
    name_en: "Cashier / Billing",
    name_sw: "Malipo",
    description_en: "Cash & M-Pesa payments",
    description_sw: "Malipo ya pesa taslimu na M-Pesa",
    kiosk_visible: true,
    avg_minutes: 4,
    sort: 4,
    surge_threshold: 10,
    category: "finance",
  },
  {
    id: "10000000-0000-0000-0000-000000000005",
    code: "insurance",
    prefix: "INS",
    name_en: "Insurance & SHA",
    name_sw: "Bima na SHA",
    description_en: "Insurance, SHA & corporate approvals",
    description_sw: "Idhini za bima, SHA na makampuni",
    kiosk_visible: true,
    avg_minutes: 7,
    sort: 5,
    surge_threshold: 12,
    category: "finance",
  },
  {
    id: "10000000-0000-0000-0000-000000000006",
    code: "lab",
    prefix: "LAB",
    name_en: "Laboratory",
    name_sw: "Maabara",
    description_en: "Sample collection & results",
    description_sw: "Kuchukua sampuli na majibu",
    kiosk_visible: true,
    avg_minutes: 6,
    sort: 6,
    surge_threshold: 15,
    category: "diagnostics",
  },
  {
    id: "10000000-0000-0000-0000-000000000007",
    code: "radiology",
    prefix: "RAD",
    name_en: "Radiology / Imaging",
    name_sw: "Picha (X-Ray)",
    description_en: "X-ray, ultrasound, CT",
    description_sw: "X-ray, ultrasound, CT",
    kiosk_visible: true,
    avg_minutes: 10,
    sort: 7,
    surge_threshold: 10,
    category: "diagnostics",
  },
  {
    id: "10000000-0000-0000-0000-000000000008",
    code: "pharmacy",
    prefix: "PHM",
    name_en: "Pharmacy",
    name_sw: "Duka la Dawa",
    description_en: "Collect prescribed medicine",
    description_sw: "Kuchukua dawa",
    kiosk_visible: true,
    avg_minutes: 5,
    sort: 8,
    surge_threshold: 18,
    category: "pharmacy",
  },
  {
    id: "10000000-0000-0000-0000-000000000009",
    code: "enquiries",
    prefix: "ENQ",
    name_en: "Enquiries",
    name_sw: "Maswali",
    description_en: "Information & customer care",
    description_sw: "Maelezo na huduma kwa wateja",
    kiosk_visible: true,
    avg_minutes: 3,
    sort: 9,
    surge_threshold: 8,
    category: "support",
  },
];

export const MOCK_COUNTERS: MockCounter[] = [
  { id: "20000000-0000-0000-0000-000000000001", name: "Registration 1", service_id: "10000000-0000-0000-0000-000000000001", active: true },
  { id: "20000000-0000-0000-0000-000000000002", name: "Registration 2", service_id: "10000000-0000-0000-0000-000000000001", active: true },
  { id: "20000000-0000-0000-0000-000000000003", name: "Triage Room 1", service_id: "10000000-0000-0000-0000-000000000002", active: true },
  { id: "20000000-0000-0000-0000-000000000004", name: "Room 4", service_id: "10000000-0000-0000-0000-000000000003", active: true },
  { id: "20000000-0000-0000-0000-000000000005", name: "Room 5", service_id: "10000000-0000-0000-0000-000000000003", active: true },
  { id: "20000000-0000-0000-0000-000000000006", name: "Cashier 1", service_id: "10000000-0000-0000-0000-000000000004", active: true },
  { id: "20000000-0000-0000-0000-000000000007", name: "Insurance Desk", service_id: "10000000-0000-0000-0000-000000000005", active: true },
  { id: "20000000-0000-0000-0000-000000000008", name: "Lab Window", service_id: "10000000-0000-0000-0000-000000000006", active: true },
  { id: "20000000-0000-0000-0000-000000000009", name: "Pharmacy 1", service_id: "10000000-0000-0000-0000-000000000008", active: true },
];

export const MOCK_INSURERS = [
  { id: "30000000-0000-0000-0000-000000000001", code: "sha", name: "SHA (Social Health Authority)", active: true, requires_preauth: false },
  { id: "30000000-0000-0000-0000-000000000002", code: "jubilee", name: "Jubilee Health Insurance", active: true, requires_preauth: true },
  { id: "30000000-0000-0000-0000-000000000003", code: "britam", name: "Britam Insurance", active: true, requires_preauth: false },
  { id: "30000000-0000-0000-0000-000000000004", code: "cic", name: "CIC General Insurance", active: true, requires_preauth: false },
  { id: "30000000-0000-0000-0000-000000000005", code: "aar", name: "AAR Insurance", active: true, requires_preauth: true },
  { id: "30000000-0000-0000-0000-000000000006", code: "cash", name: "Cash / M-PESA", active: true, requires_preauth: false },
];

const now = new Date();
const isoNow = now.toISOString();

export const mockState = {
  services: [...MOCK_SERVICES],
  counters: [...MOCK_COUNTERS],
  insurers: [...MOCK_INSURERS],
  patients: [
    {
      id: "40000000-0000-0000-0000-000000000001",
      full_name: "John Kamau",
      phone: "+254712345678",
      hospital_number: "KH-10492",
      created_at: isoNow,
    },
    {
      id: "40000000-0000-0000-0000-000000000002",
      full_name: "Grace Wanjiku",
      phone: "+254722334455",
      hospital_number: "KH-20831",
      created_at: isoNow,
    },
  ] as MockPatient[],
  tickets: [
    {
      id: "50000000-0000-0000-0000-000000000001",
      token: "OPD-001",
      service_id: "10000000-0000-0000-0000-000000000003",
      visit_type: "walk_in",
      payment: "cash",
      priority: 0,
      phone: "+254712345678",
      language: "en",
      status: "serving",
      counter_id: "20000000-0000-0000-0000-000000000004",
      queued_at: new Date(Date.now() - 25 * 60000).toISOString(),
      called_at: new Date(Date.now() - 5 * 60000).toISOString(),
      started_at: new Date(Date.now() - 4 * 60000).toISOString(),
      completed_at: null,
      recall_count: 0,
      created_at: new Date(Date.now() - 25 * 60000).toISOString(),
    },
    {
      id: "50000000-0000-0000-0000-000000000002",
      token: "REG-001",
      service_id: "10000000-0000-0000-0000-000000000001",
      visit_type: "walk_in",
      payment: "cash",
      priority: 0,
      phone: null,
      language: "sw",
      status: "serving",
      counter_id: "20000000-0000-0000-0000-000000000001",
      queued_at: new Date(Date.now() - 15 * 60000).toISOString(),
      called_at: new Date(Date.now() - 2 * 60000).toISOString(),
      started_at: new Date(Date.now() - 1 * 60000).toISOString(),
      completed_at: null,
      recall_count: 0,
      created_at: new Date(Date.now() - 15 * 60000).toISOString(),
    },
    {
      id: "50000000-0000-0000-0000-000000000003",
      token: "OPD-002",
      service_id: "10000000-0000-0000-0000-000000000003",
      visit_type: "walk_in",
      payment: "sha",
      priority: 1,
      phone: "+254722334455",
      language: "en",
      status: "waiting",
      counter_id: null,
      queued_at: new Date(Date.now() - 12 * 60000).toISOString(),
      called_at: null,
      started_at: null,
      completed_at: null,
      recall_count: 0,
      created_at: new Date(Date.now() - 12 * 60000).toISOString(),
    },
    {
      id: "50000000-0000-0000-0000-000000000004",
      token: "LAB-001",
      service_id: "10000000-0000-0000-0000-000000000006",
      visit_type: "walk_in",
      payment: "insurance",
      priority: 0,
      phone: null,
      language: "en",
      status: "waiting",
      counter_id: null,
      queued_at: new Date(Date.now() - 8 * 60000).toISOString(),
      called_at: null,
      started_at: null,
      completed_at: null,
      recall_count: 0,
      created_at: new Date(Date.now() - 8 * 60000).toISOString(),
    },
  ] as MockTicket[],
  sequences: {
    REG: 1,
    TRI: 0,
    OPD: 2,
    CSH: 0,
    INS: 0,
    LAB: 1,
    RAD: 0,
    PHM: 0,
    ENQ: 0,
  } as Record<string, number>,
  ticketEvents: [] as Array<{
    id: string;
    ticket_id: string;
    action: string;
    service_id?: string;
    counter_id?: string;
    created_at: string;
  }>,
  feedback: [] as Array<Record<string, unknown>>,
};

export function handleMockQuery(body: {
  table?: string;
  select?: string;
  filters?: Array<{ type: string; col: string; val: unknown }>;
  order?: { col: string; ascending?: boolean };
  limit?: number;
  single?: boolean;
}) {
  const table = body.table || "";
  let items: Record<string, unknown>[] = [];
  if (table === "services") items = [...mockState.services];
  else if (table === "counters") items = [...mockState.counters];
  else if (table === "tickets") items = [...mockState.tickets];
  else if (table === "ticket_events") items = [...mockState.ticketEvents];
  else if (table === "patients") items = [...mockState.patients];
  else if (table === "automation_settings") {
    items = mockState.services.map((s) => ({
      id: s.id,
      service_id: s.id,
      long_wait_enabled: true,
      long_wait_min: 20,
      fast_track_enabled: true,
      fast_track_min: 5,
    }));
  }

  // Apply filters
  for (const f of body.filters || []) {
    items = items.filter((item) => {
      const val = item[f.col];
      if (f.type === "eq") return val === f.val;
      if (f.type === "neq") return val !== f.val;
      if (f.type === "in") return Array.isArray(f.val) && f.val.includes(val);
      if (f.type === "ilike") {
        const str = String(val || "").toLowerCase();
        const pattern = String(f.val || "").replace(/%/g, "").toLowerCase();
        return str.includes(pattern);
      }
      return true;
    });
  }

  // Apply sort
  if (body.order?.col) {
    const col = body.order.col;
    const asc = body.order.ascending !== false;
    items.sort((a, b) => {
      const va = String(a[col] ?? "");
      const vb = String(b[col] ?? "");
      if (va < vb) return asc ? -1 : 1;
      if (va > vb) return asc ? 1 : -1;
      return 0;
    });
  }

  // Apply limit
  if (body.limit && body.limit > 0) {
    items = items.slice(0, body.limit);
  }

  if (body.single) {
    return items[0] ?? null;
  }
  return items;
}

export function handleMockRpc(fn: string, args: Record<string, unknown> = {}) {
  const nowIso = new Date().toISOString();

  if (fn === "list_insurance_providers" || fn === "staff_list_insurers_all") {
    return mockState.insurers;
  }

  if (fn === "get_display_board") {
    const serving = mockState.tickets
      .filter((t) => t.status === "called" || t.status === "serving")
      .map((t) => {
        const counter = mockState.counters.find((c) => c.id === t.counter_id);
        const service = mockState.services.find((s) => s.id === t.service_id);
        return {
          token: t.token,
          counter_name: counter?.name ?? "Room 1",
          department: service?.name_en ?? "Consultation",
          status: t.status,
          called_at: t.called_at ?? t.queued_at,
        };
      });

    const waiting = mockState.tickets
      .filter((t) => t.status === "waiting")
      .map((t) => {
        const service = mockState.services.find((s) => s.id === t.service_id);
        return {
          token: t.token,
          service_code: service?.code ?? "consultation",
          department: service?.name_en ?? "Consultation",
          priority: t.priority,
          queued_at: t.queued_at,
        };
      });

    return {
      serving,
      waiting,
      total_waiting: waiting.length,
      total_serving: serving.length,
      departments: mockState.services.map((s) => ({
        code: s.code,
        name_en: s.name_en,
        name_sw: s.name_sw,
        waiting_count: mockState.tickets.filter((t) => t.service_id === s.id && t.status === "waiting").length,
        avg_wait: s.avg_minutes,
      })),
    };
  }

  if (fn === "issue_ticket" || fn === "issue_visit") {
    const serviceCode = (args["p_service_code"] as string) || "consultation";
    const service = mockState.services.find((s) => s.code === serviceCode) || mockState.services[2]!;
    const seq = (mockState.sequences[service.prefix] = (mockState.sequences[service.prefix] || 0) + 1);
    const token = `${service.prefix}-${String(seq).padStart(3, "0")}`;
    const newTicket: MockTicket = {
      id: crypto.randomUUID(),
      token,
      service_id: service.id,
      visit_type: (args["p_visit_type"] as string) || "walk_in",
      payment: (args["p_payment"] as string) || "cash",
      priority: Number(args["p_priority"] || 0),
      phone: (args["p_phone"] as string) || null,
      language: (args["p_language"] as string) || "en",
      status: "waiting",
      counter_id: null,
      queued_at: nowIso,
      called_at: null,
      started_at: null,
      completed_at: null,
      recall_count: 0,
      created_at: nowIso,
    };
    mockState.tickets.push(newTicket);
    mockState.ticketEvents.push({
      id: crypto.randomUUID(),
      ticket_id: newTicket.id,
      action: "issued",
      service_id: service.id,
      created_at: nowIso,
    });
    const ahead = mockState.tickets.filter((t) => t.service_id === service.id && t.status === "waiting" && t.id !== newTicket.id).length;
    return {
      ticket: newTicket,
      ahead,
      wait_min: Math.max(5, ahead * service.avg_minutes),
      id: newTicket.id,
      token: newTicket.token,
    };
  }

  if (fn === "get_ticket_status") {
    const id = args["p_id"] as string;
    const ticket = mockState.tickets.find((t) => t.id === id);
    if (!ticket) {
      return {
        id,
        token: "OPD-001",
        status: "waiting",
        counter: "Room 4",
        department: "Doctor Consultation",
        ahead: 1,
        wait_min: 10,
        queued_at: nowIso,
      };
    }
    const service = mockState.services.find((s) => s.id === ticket.service_id);
    const counter = mockState.counters.find((c) => c.id === ticket.counter_id);
    const ahead = mockState.tickets.filter((t) => t.service_id === ticket.service_id && t.status === "waiting" && new Date(t.queued_at) < new Date(ticket.queued_at)).length;
    return {
      id: ticket.id,
      token: ticket.token,
      status: ticket.status,
      counter: counter?.name ?? null,
      department: service?.name_en ?? "Consultation",
      department_sw: service?.name_sw ?? "Kuonana na Daktari",
      queued_at: ticket.queued_at,
      called_at: ticket.called_at,
      ahead,
      wait_min: Math.max(2, ahead * (service?.avg_minutes ?? 5)),
      phone: ticket.phone,
    };
  }

  if (fn === "mark_ticket_opened" || fn === "ticket_was_opened") {
    const id = args["p_id"] as string;
    const ticket = mockState.tickets.find((t) => t.id === id);
    if (ticket) ticket.opened = true;
    return true;
  }

  if (fn === "lookup_patient") {
    const query = (args["p_query"] || args["p_phone"] || args["p_hospital_number"] || "") as string;
    const match = mockState.patients.find(
      (p) =>
        (p.phone && p.phone.includes(query)) ||
        (p.hospital_number && p.hospital_number.toLowerCase().includes(query.toLowerCase())),
    );
    return match ? { patient: match, visits: [] } : null;
  }

  if (fn === "register_patient" || fn === "staff_register_patient") {
    const newPatient: MockPatient = {
      id: crypto.randomUUID(),
      full_name: (args["p_name"] || args["p_full_name"] || "Walk-in Patient") as string,
      phone: (args["p_phone"] || "+254700000000") as string,
      hospital_number: (args["p_hospital_number"] as string) || `KH-${Math.floor(10000 + Math.random() * 90000)}`,
      created_at: nowIso,
    };
    mockState.patients.push(newPatient);
    return newPatient;
  }

  if (fn === "get_counter_queue") {
    const counterId = args["p_counter"] as string;
    const counter = mockState.counters.find((c) => c.id === counterId);
    if (!counter) return { current: null, queue: [] };
    const current = mockState.tickets.find((t) => t.counter_id === counter.id && (t.status === "called" || t.status === "serving")) ?? null;
    const queue = mockState.tickets.filter((t) => t.service_id === counter.service_id && t.status === "waiting");
    return { current, queue };
  }

  if (fn === "call_next") {
    const counterId = args["p_counter"] as string;
    const counter = mockState.counters.find((c) => c.id === counterId) || mockState.counters[0]!;
    const nextTicket = mockState.tickets.find((t) => t.service_id === counter.service_id && t.status === "waiting");
    if (nextTicket) {
      nextTicket.status = "called";
      nextTicket.counter_id = counter.id;
      nextTicket.called_at = nowIso;
      mockState.ticketEvents.push({
        id: crypto.randomUUID(),
        ticket_id: nextTicket.id,
        action: "call",
        counter_id: counter.id,
        service_id: counter.service_id,
        created_at: nowIso,
      });
      return { ticket: nextTicket };
    }
    return { ticket: null };
  }

  if (fn === "call_ticket") {
    const ticketId = args["p_ticket"] as string;
    const counterId = args["p_counter"] as string;
    const ticket = mockState.tickets.find((t) => t.id === ticketId);
    if (ticket) {
      ticket.status = "called";
      ticket.counter_id = counterId;
      ticket.called_at = nowIso;
      return { ticket };
    }
    return { ticket: null };
  }

  if (fn === "staff_action") {
    const ticketId = args["p_ticket"] as string;
    const action = args["p_action"] as string;
    const ticket = mockState.tickets.find((t) => t.id === ticketId);
    if (ticket) {
      if (action === "recall") {
        ticket.status = "called";
        ticket.called_at = nowIso;
        ticket.recall_count = (ticket.recall_count || 0) + 1;
      } else if (action === "start") {
        ticket.status = "serving";
        ticket.started_at = nowIso;
      } else if (action === "complete") {
        ticket.status = "done";
        ticket.completed_at = nowIso;
      } else if (action === "no_show") {
        ticket.status = "no_show";
        ticket.completed_at = nowIso;
      } else if (action === "requeue") {
        ticket.status = "waiting";
        ticket.counter_id = null;
        ticket.called_at = null;
      } else if (action === "transfer") {
        const target = (args["p_target_service"] as string) || ticket.service_id;
        ticket.service_id = target;
        ticket.status = "waiting";
        ticket.counter_id = null;
        ticket.called_at = null;
      }
      mockState.ticketEvents.push({
        id: crypto.randomUUID(),
        ticket_id: ticket.id,
        action,
        counter_id: ticket.counter_id || undefined,
        service_id: ticket.service_id,
        created_at: nowIso,
      });
    }
    return true;
  }

  if (fn === "ensure_staff_access" || fn === "is_staff" || fn === "is_superadmin") {
    return true;
  }

  if (fn === "get_my_access") {
    return {
      is_staff: true,
      is_admin: true,
      is_superadmin: true,
      full_name: "Kijabe Staff",
      role: "admin",
    };
  }

  if (fn === "staff_check_in" || fn === "staff_check_out" || fn === "staff_session_ping" || fn === "staff_close_open_sessions") {
    return true;
  }

  if (fn === "staff_my_notifications") {
    return [];
  }

  if (fn === "admin_ops_board" || fn === "admin_daily_stats") {
    return {
      total_tickets: mockState.tickets.length,
      completed: mockState.tickets.filter((t) => t.status === "done").length,
      waiting: mockState.tickets.filter((t) => t.status === "waiting").length,
      serving: mockState.tickets.filter((t) => t.status === "serving" || t.status === "called").length,
      active_counters: mockState.counters.filter((c) => c.active).length,
    };
  }

  if (fn === "submit_feedback") {
    mockState.feedback.push({ ...args, created_at: nowIso });
    return true;
  }

  if (fn === "run_queue_automation") {
    return { triggered: 0 };
  }

  return { success: true };
}
