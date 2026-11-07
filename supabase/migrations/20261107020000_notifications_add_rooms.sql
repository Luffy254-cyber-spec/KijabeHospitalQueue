-- Staff notification history + superadmin create/deactivate rooms

create or replace function public.admin_create_room(
  p_name text,
  p_service_id uuid,
  p_active boolean default true
) returns json
language plpgsql security definer set search_path = public as $$
declare
  rid uuid;
  rname text := trim(p_name);
  svc text;
begin
  if not public.is_superadmin(auth.uid()) then
    raise exception 'Superadmin only';
  end if;
  if rname is null or length(rname) < 2 then
    raise exception 'Room name required';
  end if;
  select name_en into svc from public.services where id = p_service_id;
  if svc is null then
    raise exception 'Unknown service';
  end if;
  if exists (
    select 1 from public.counters c
    where lower(c.name) = lower(rname) and c.service_id = p_service_id
  ) then
    raise exception 'A room with that name already exists for this service';
  end if;

  insert into public.counters (name, service_id, active)
  values (rname, p_service_id, coalesce(p_active, true))
  returning id into rid;

  return json_build_object(
    'id', rid,
    'name', rname,
    'service_id', p_service_id,
    'service', svc,
    'active', coalesce(p_active, true)
  );
end $$;

create or replace function public.admin_set_room_active(
  p_counter_id uuid,
  p_active boolean
) returns json
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if not public.is_superadmin(auth.uid()) then
    raise exception 'Superadmin only';
  end if;
  update public.counters
    set active = coalesce(p_active, true)
    where id = p_counter_id
    returning id, name, service_id, active into r;
  if r.id is null then
    raise exception 'Room not found';
  end if;
  return json_build_object(
    'id', r.id,
    'name', r.name,
    'service_id', r.service_id,
    'active', r.active
  );
end $$;

-- Open + recent acknowledged summons for the signed-in staff member
create or replace function public.staff_my_notifications(p_limit int default 50)
returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  lim int := greatest(1, least(coalesce(p_limit, 50), 100));
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if not public.is_staff(uid) and not public.is_superadmin(uid) then
    raise exception 'Staff only';
  end if;
  return coalesce((
    select json_agg(row_to_json(x) order by x.created_at desc)
    from (
      select
        s.id,
        s.message,
        s.created_at,
        s.acknowledged_at,
        (s.acknowledged_at is null) as open,
        (select email from auth.users u where u.id = s.from_admin) as from_email
      from public.staff_summons s
      where s.to_staff = uid
      order by s.created_at desc
      limit lim
    ) x
  ), '[]'::json);
end $$;

-- Ensure approved staff always appear (status coalesce + staff/admin roles)
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

grant execute on function public.admin_create_room(text, uuid, boolean) to authenticated;
grant execute on function public.admin_set_room_active(uuid, boolean) to authenticated;
grant execute on function public.staff_my_notifications(int) to authenticated;
