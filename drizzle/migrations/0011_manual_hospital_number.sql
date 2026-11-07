-- Kiosk registration never auto-issues hospital numbers (card_no stays null).
-- Staff registration keys in the hospital number manually.

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

-- Staff desk: issue a hospital number (keyed in — never auto-generated)
create or replace function public.staff_register_patient(
  p_name text, p_phone text, p_national_id text, p_hospital_no text
) returns json language plpgsql security definer set search_path = public as $$
declare p public.patients;
  nid text := nullif(upper(regexp_replace(coalesce(p_national_id,''),'\s','','g')),'');
  hno text := upper(regexp_replace(trim(coalesce(p_hospital_no,'')), '\s', '', 'g'));
begin
  if not public.is_staff() then raise exception 'Staff only'; end if;
  if length(trim(coalesce(p_name,''))) < 3 or length(p_name) > 120 then raise exception 'Invalid name'; end if;
  if p_phone is not null and p_phone !~ '^\+254[0-9]{9}$' then raise exception 'Invalid phone'; end if;
  if nid is not null and nid !~ '^[A-Z0-9]{5,12}$' then raise exception 'Invalid ID'; end if;
  if nid is not null and exists(select 1 from patients where national_id = nid) then raise exception 'ID already registered'; end if;
  if hno is null or length(hno) < 3 or length(hno) > 24 then raise exception 'Hospital number required'; end if;
  if hno !~ '^[A-Z0-9/-]+$' then raise exception 'Invalid hospital number'; end if;
  if exists(select 1 from patients where card_no = hno) then raise exception 'Hospital number already registered'; end if;
  insert into patients(card_no, full_name, phone, national_id)
    values (hno, regexp_replace(trim(p_name),'\s+',' ','g'), p_phone, nid) returning * into p;
  return json_build_object('patient_id', p.id, 'card_no', p.card_no, 'first_name', split_part(p.full_name,' ',1));
end $$;

-- Assign / update hospital number on an existing patient (staff only)
create or replace function public.staff_set_hospital_number(p_patient uuid, p_hospital_no text)
returns json language plpgsql security definer set search_path = public as $$
declare p public.patients;
  hno text := upper(regexp_replace(trim(coalesce(p_hospital_no,'')), '\s', '', 'g'));
begin
  if not public.is_staff() then raise exception 'Staff only'; end if;
  if hno is null or length(hno) < 3 or length(hno) > 24 then raise exception 'Hospital number required'; end if;
  if hno !~ '^[A-Z0-9/-]+$' then raise exception 'Invalid hospital number'; end if;
  if exists(select 1 from patients where card_no = hno and id <> p_patient) then
    raise exception 'Hospital number already registered';
  end if;
  update patients set card_no = hno where id = p_patient returning * into p;
  if p.id is null then raise exception 'Patient not found'; end if;
  return json_build_object('patient_id', p.id, 'card_no', p.card_no, 'first_name', split_part(p.full_name,' ',1));
end $$;

-- Drop mistaken 4-arg kiosk overload if it was applied earlier
drop function if exists public.register_patient(text, text, text, text);

revoke all on function public.register_patient(text,text,text) from public;
grant execute on function public.register_patient(text,text,text) to anon, authenticated;

revoke all on function public.staff_register_patient(text,text,text,text) from public;
grant execute on function public.staff_register_patient(text,text,text,text) to authenticated;

revoke all on function public.staff_set_hospital_number(uuid,text) from public;
grant execute on function public.staff_set_hospital_number(uuid,text) to authenticated;
