-- Do not auto-generate hospital card numbers on registration.
-- Existing KH cards remain for returning patients who already have one.

alter table public.patients alter column card_no drop not null;

create or replace function public.register_patient(p_name text, p_phone text, p_national_id text)
returns json language plpgsql security definer set search_path = public as $$
declare p public.patients; nid text := nullif(upper(regexp_replace(coalesce(p_national_id,''),'\s','','g')),'');
begin
  if length(trim(coalesce(p_name,''))) < 3 or length(p_name) > 120 then raise exception 'Invalid name'; end if;
  if p_phone is not null and p_phone !~ '^\+254[0-9]{9}$' then raise exception 'Invalid phone'; end if;
  if nid is not null and nid !~ '^[A-Z0-9]{5,12}$' then raise exception 'Invalid ID'; end if;
  if nid is not null and exists(select 1 from patients where national_id = nid) then raise exception 'ID already registered'; end if;
  insert into patients(card_no, full_name, phone, national_id)
    values (null, regexp_replace(trim(p_name),'\s+',' ','g'), p_phone, nid) returning * into p;
  return json_build_object('patient_id', p.id, 'card_no', p.card_no, 'first_name', split_part(p.full_name,' ',1));
end $$;

revoke all on function public.register_patient(text,text,text) from public;
grant execute on function public.register_patient(text,text,text) to anon, authenticated;
