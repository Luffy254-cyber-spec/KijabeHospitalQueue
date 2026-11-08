-- Nightly archive (00:00 Africa/Nairobi).
-- Fully cleared visits and their payments are exported to data_exports first,
-- then deleted. Waiting / called / in-room tickets and tickets whose payment is
-- still pending or pushed are never touched.

create table if not exists public.data_exports (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'nightly',
  day date not null,
  period_start date,
  period_end date,
  ticket_count integer not null default 0,
  payment_count integer not null default 0,
  visits_csv text not null default '',
  payments_csv text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists data_exports_created_idx
  on public.data_exports (created_at desc);

alter table public.data_exports enable row level security;

create or replace function public._csv_cell(v text)
returns text language sql immutable as $$
  select '"' || replace(coalesce(v, ''), '"', '""') || '"'
$$;

-- Internal: runs as the table owner (no direct grant to app users).
create or replace function public.run_nightly_archive(p_now timestamptz default now())
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (coalesce(p_now, now()) at time zone 'Africa/Nairobi')::date;
  v_cutoff timestamptz := (v_today::timestamp at time zone 'Africa/Nairobi');
  v_ids uuid[];
  v_tickets int := 0;
  v_payments int := 0;
  v_from date;
  v_to date;
  v_visits text;
  v_payments_csv text;
  v_export uuid;
begin
  perform pg_advisory_xact_lock(741258963);

  -- Cleared = finished and dated before today (Nairobi). A ticket with a
  -- pending/pushed payment is not cleared yet.
  select array_agg(t.id) into v_ids
  from public.tickets t
  where t.created_at < v_cutoff
    and t.status in ('done', 'no_show', 'closed')
    and not exists (
      select 1
      from public.payments p
      where p.ticket_id = t.id
        and p.status in ('pending', 'pushed')
    );

  v_tickets := coalesce(array_length(v_ids, 1), 0);
  if v_tickets = 0 then
    return json_build_object('tickets', 0, 'payments', 0, 'day', v_today, 'export_id', null);
  end if;

  select count(*) into v_payments
  from public.payments
  where ticket_id = any(v_ids);

  select min((t.created_at at time zone 'Africa/Nairobi')::date),
         max((t.created_at at time zone 'Africa/Nairobi')::date)
    into v_from, v_to
  from public.tickets t
  where t.id = any(v_ids);

  select string_agg(csv_row, E'\n' order by created_at) into v_visits
  from (
    select concat_ws(',',
      public._csv_cell(t.token),
      public._csv_cell(p.card_no),
      public._csv_cell(coalesce(p.full_name,
        public._compose_name(p.first_name, p.last_name, p.surname))),
      public._csv_cell(coalesce(t.phone, p.phone)),
      public._csv_cell(s.name_en),
      public._csv_cell(s.code),
      public._csv_cell(t.visit_type),
      public._csv_cell(t.payment),
      public._csv_cell(t.payment_detail),
      public._csv_cell(i.name),
      public._csv_cell(t.status),
      public._csv_cell(t.priority::text),
      public._csv_cell(t.triage_level),
      public._csv_cell(t.triage_note),
      public._csv_cell(array_to_string(t.care_path, ' > ')),
      public._csv_cell(to_char(t.queued_at at time zone 'Africa/Nairobi', 'YYYY-MM-DD HH24:MI:SS')),
      public._csv_cell(to_char(t.called_at at time zone 'Africa/Nairobi', 'YYYY-MM-DD HH24:MI:SS')),
      public._csv_cell(to_char(t.started_at at time zone 'Africa/Nairobi', 'YYYY-MM-DD HH24:MI:SS')),
      public._csv_cell(to_char(t.completed_at at time zone 'Africa/Nairobi', 'YYYY-MM-DD HH24:MI:SS')),
      public._csv_cell(to_char(t.created_at at time zone 'Africa/Nairobi', 'YYYY-MM-DD HH24:MI:SS'))
    ) as csv_row,
    t.created_at
    from public.tickets t
    join public.services s on s.id = t.service_id
    left join public.patients p on p.id = t.patient_id
    left join public.insurance_providers i on i.id = t.insurer_id
    where t.id = any(v_ids)
  ) x;

  if v_payments > 0 then
    select string_agg(csv_row, E'\n' order by created_at) into v_payments_csv
    from (
      select concat_ws(',',
        public._csv_cell(t.token),
        public._csv_cell(pay.method),
        public._csv_cell(pay.amount_kes::text),
        public._csv_cell(pay.phone),
        public._csv_cell(pay.status),
        public._csv_cell(pay.mpesa_receipt),
        public._csv_cell(pay.cover_ref),
        public._csv_cell(pay.waiver_reason),
        public._csv_cell(pay.result_code::text),
        public._csv_cell(pay.result_desc),
        public._csv_cell(to_char(pay.paid_at at time zone 'Africa/Nairobi', 'YYYY-MM-DD HH24:MI:SS')),
        public._csv_cell(to_char(pay.created_at at time zone 'Africa/Nairobi', 'YYYY-MM-DD HH24:MI:SS'))
      ) as csv_row,
      pay.created_at
      from public.payments pay
      join public.tickets t on t.id = pay.ticket_id
      where pay.ticket_id = any(v_ids)
    ) y;
  end if;

  insert into public.data_exports(
    kind, day, period_start, period_end, ticket_count, payment_count, visits_csv, payments_csv
  ) values (
    'nightly', v_today, v_from, v_to, v_tickets, v_payments,
    'token,hospital_no,patient_name,phone,service,service_code,visit_type,payment,payment_detail,insurer,status,priority,triage_level,triage_note,care_path,queued_at,called_at,started_at,completed_at,created_at'
      || E'\n' || coalesce(v_visits, ''),
    case when v_payments > 0 then
      'ticket_token,method,amount_kes,phone,status,mpesa_receipt,cover_ref,waiver_reason,result_code,result_desc,paid_at,created_at'
        || E'\n' || coalesce(v_payments_csv, '')
    else '' end
  )
  returning id into v_export;

  delete from public.tickets where id = any(v_ids);

  return json_build_object(
    'tickets', v_tickets, 'payments', v_payments,
    'day', v_today, 'export_id', v_export
  );
end $$;

revoke all on function public.run_nightly_archive(timestamptz) from public, anon, authenticated;

create or replace function public.admin_run_nightly_archive()
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public.is_superadmin(auth.uid()) then raise exception 'Superadmin only'; end if;
  return public.run_nightly_archive(now());
end $$;

create or replace function public.admin_list_data_exports()
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public.is_superadmin(auth.uid()) then raise exception 'Superadmin only'; end if;
  return coalesce((
    select json_agg(json_build_object(
      'id', e.id,
      'day', e.day,
      'period_start', e.period_start,
      'period_end', e.period_end,
      'ticket_count', e.ticket_count,
      'payment_count', e.payment_count,
      'created_at', e.created_at
    ) order by e.created_at desc)
    from public.data_exports e
  ), '[]'::json);
end $$;

create or replace function public.admin_get_data_export(p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v json;
begin
  if not public.is_superadmin(auth.uid()) then raise exception 'Superadmin only'; end if;
  select json_build_object(
    'id', e.id,
    'day', e.day,
    'period_start', e.period_start,
    'period_end', e.period_end,
    'ticket_count', e.ticket_count,
    'payment_count', e.payment_count,
    'visits_csv', e.visits_csv,
    'payments_csv', e.payments_csv
  ) into v
  from public.data_exports e
  where e.id = p_id;
  if v is null then raise exception 'Export not found'; end if;
  return v;
end $$;

grant execute on function public.admin_run_nightly_archive() to authenticated;
grant execute on function public.admin_list_data_exports() to authenticated;
grant execute on function public.admin_get_data_export(uuid) to authenticated;
