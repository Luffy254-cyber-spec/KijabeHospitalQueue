-- Hashed staff work IDs (never stored in plain text) + registration-first queue for new patients.

alter table public.staff_profiles add column if not exists work_id_hash text;
alter table public.staff_profiles add column if not exists work_id_last4 text;
alter table public.staff_profiles add column if not exists work_id_set_at timestamptz;

create unique index if not exists staff_profiles_work_id_hash_uidx
  on public.staff_profiles (work_id_hash)
  where work_id_hash is not null;

-- New patients are put in the Registration queue first (hospital number + identity check).
-- Registration staff then send them on to triage / the clinic.
create or replace function public.queue_at_registration(p_patient uuid, p_language text default 'en')
returns json language plpgsql security definer set search_path = public as $$
declare
  open_id uuid;
  existing json;
  pat public.patients;
  svc public.services;
  t public.tickets;
  n int;
  ahead int;
  desks int;
begin
  select x.id into open_id from tickets x
  where x.patient_id = p_patient
    and x.status in ('waiting', 'called', 'serving')
  order by x.queued_at desc
  limit 1;

  if open_id is not null then
    existing := public.get_ticket_status(open_id);
    return json_build_object('queued', false, 'already', true, 'ticket', existing);
  end if;

  select * into svc from services where code = 'registration';
  if svc.id is null then
    -- Hospital has no registration desk configured: keep the previous behaviour.
    return public.queue_at_triage(p_patient, p_language);
  end if;

  select * into pat from patients where id = p_patient;
  if pat.id is null then raise exception 'Unknown patient'; end if;

  insert into daily_sequences(service_id, day, last_no)
    values (svc.id, (now() at time zone 'Africa/Nairobi')::date, 1)
    on conflict (service_id, day) do update set last_no = daily_sequences.last_no + 1
    returning last_no into n;

  insert into tickets(
    token, service_id, visit_type, payment, priority, phone, language, patient_id,
    triage_level, triage_note, care_path, path_step
  ) values (
    svc.prefix || '-' || case when n < 100 then lpad(n::text, 3, '0') else n::text end,
    svc.id, 'walk_in', 'cash', 0, pat.phone, coalesce(nullif(p_language, ''), 'en'), pat.id,
    'green', 'New patient — see registration staff first', array['registration'], 0
  ) returning * into t;

  insert into ticket_events(ticket_id, action, service_id) values (t.id, 'issued', svc.id);

  select count(*) into ahead from tickets x
  where x.service_id = svc.id and x.status = 'waiting' and x.id <> t.id
    and (x.priority > t.priority or (x.priority = t.priority and x.queued_at <= t.queued_at));
  select greatest(count(*), 1) into desks from counters where service_id = svc.id and active;

  return json_build_object(
    'id', t.id, 'token', t.token, 'ahead', ahead,
    'est_minutes', ceil(ahead * svc.avg_minutes / desks::numeric),
    'service_en', svc.name_en, 'service_sw', svc.name_sw,
    'created_at', t.created_at, 'triage', t.triage_level,
    'path', (select json_agg(json_build_object('en', x.name_en, 'sw', x.name_sw) order by ord)
      from unnest(t.care_path) with ordinality u(c, ord) join services x on x.code = u.c),
    'card_no', pat.card_no,
    'queued', true, 'already', false
  );
end $$;

revoke all on function public.queue_at_registration(uuid, text) from public;
grant execute on function public.queue_at_registration(uuid, text) to anon, authenticated;

-- Expose only the masked tail of the work ID to the superadmin console.
create or replace function public.admin_list_staff()
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public.is_superadmin(auth.uid()) then raise exception 'Superadmin only'; end if;
  return coalesce((select json_agg(row_to_json(x) order by x.full_name asc nulls last) from (
    select u.id, u.email, u.email_confirmed_at, u.created_at,
      coalesce(
        nullif(trim(sp.full_name), ''),
        public._compose_name(sp.first_name, sp.last_name, sp.surname),
        split_part(u.email, '@', 1)
      ) as full_name,
      sp.first_name, sp.last_name, sp.surname, sp.phone,
      sp.work_id_last4,
      (sp.work_id_hash is not null) as work_id_set,
      lower(coalesce(
        sp.status,
        case when exists(
          select 1 from user_roles r
          where r.user_id = u.id and r.role in ('admin', 'superadmin', 'staff')
        ) then 'approved' else 'pending' end
      )) as status,
      sp.approved_at,
      (select array_agg(role::text) from user_roles ur where ur.user_id = u.id) as roles,
      exists(
        select 1 from staff_attendance a
        where a.user_id = u.id
          and a.day = (now() at time zone 'Africa/Nairobi')::date
          and a.checked_out_at is null
      ) as on_duty,
      (select c.name from staff_attendance a
        left join counters c on c.id = a.counter_id
        where a.user_id = u.id
          and a.day = (now() at time zone 'Africa/Nairobi')::date
          and a.checked_out_at is null
        limit 1) as current_room
    from auth.users u
    left join staff_profiles sp on sp.user_id = u.id
    where exists (select 1 from user_roles ur where ur.user_id = u.id)
       or exists (select 1 from staff_profiles p where p.user_id = u.id)
  ) x), '[]'::json);
end $$;
