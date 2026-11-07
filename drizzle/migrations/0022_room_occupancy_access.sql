-- Room occupancy for all staff (no forced assignment); extend get_my_access

create or replace function public.get_my_access()
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
  roles text[];
  st text;
  att json;
  summons json;
  room_status json;
  today date := (now() at time zone 'Africa/Nairobi')::date;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  select coalesce(array_agg(role::text), '{}') into roles from user_roles where user_id = uid;
  select coalesce(status, 'approved') into st from staff_profiles where user_id = uid;
  if st is null then st := case when 'admin' = any(roles) or 'superadmin' = any(roles) then 'approved' else 'pending' end; end if;
  select row_to_json(a) into att from staff_attendance a
    where a.user_id = uid and a.day = today and a.checked_out_at is null;
  select coalesce(json_agg(json_build_object(
      'id', s.id, 'message', s.message, 'created_at', s.created_at,
      'from_email', (select email from auth.users u where u.id = s.from_admin)
    ) order by s.created_at desc), '[]'::json)
    into summons
    from staff_summons s where s.to_staff = uid and s.acknowledged_at is null;
  select coalesce(json_agg(json_build_object(
      'counter_id', c.id, 'name', c.name, 'service', s.name_en,
      'occupied', exists(
        select 1 from staff_attendance a
        where a.counter_id = c.id and a.day = today and a.checked_out_at is null
      ),
      'occupant', (
        select coalesce(sp.full_name, public._compose_name(sp.first_name, sp.last_name, sp.surname), split_part(u.email,'@',1))
        from staff_attendance a
        join auth.users u on u.id = a.user_id
        left join staff_profiles sp on sp.user_id = a.user_id
        where a.counter_id = c.id and a.day = today and a.checked_out_at is null
        limit 1
      )
    ) order by c.name), '[]'::json)
    into room_status
    from counters c
    join services s on s.id = c.service_id
    where c.active;
  return json_build_object(
    'user_id', uid,
    'roles', roles,
    'status', st,
    'is_superadmin', public.is_superadmin(uid),
    'is_staff', public.is_staff(uid),
    'attendance', att,
    'assigned_rooms', '[]'::json,
    'rooms', room_status,
    'summons', summons
  );
end $$;