-- Phone tracking by patient: latest open ticket, or "waiting for check-in".

create or replace function public.get_patient_track(p_patient uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  tid uuid;
  st json;
begin
  if p_patient is null then
    return json_build_object('found', false);
  end if;

  select t.id into tid
  from tickets t
  where t.patient_id = p_patient
    and t.status in ('waiting', 'called', 'serving')
  order by t.queued_at desc nulls last, t.created_at desc
  limit 1;

  if tid is null then
    return json_build_object(
      'found', true,
      'has_ticket', false,
      'patient_id', p_patient,
      'message', 'Finish check-in on the kiosk — your place will appear here.'
    );
  end if;

  st := public.get_ticket_status(tid);
  return json_build_object(
    'found', true,
    'has_ticket', true,
    'patient_id', p_patient,
    'ticket', st
  );
end $$;

revoke all on function public.get_patient_track(uuid) from public;
grant execute on function public.get_patient_track(uuid) to anon, authenticated;
