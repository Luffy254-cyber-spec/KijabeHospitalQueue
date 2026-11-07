-- Phone opens /track/:patientId → kiosk can detect successful QR scan.

alter table public.patients
  add column if not exists track_opened_at timestamptz;

create or replace function public.ping_patient_track(p_patient uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  update patients set track_opened_at = now() where id = p_patient;
  if not found then
    return json_build_object('ok', false);
  end if;
  return json_build_object('ok', true, 'opened_at', now());
end $$;

create or replace function public.patient_track_opened_since(p_patient uuid, p_since timestamptz)
returns boolean language sql security definer set search_path = public as $$
  select exists(
    select 1 from patients
    where id = p_patient
      and track_opened_at is not null
      and track_opened_at >= p_since
  );
$$;

revoke all on function public.ping_patient_track(uuid) from public;
grant execute on function public.ping_patient_track(uuid) to anon, authenticated;
revoke all on function public.patient_track_opened_since(uuid, timestamptz) from public;
grant execute on function public.patient_track_opened_since(uuid, timestamptz) to anon, authenticated;
