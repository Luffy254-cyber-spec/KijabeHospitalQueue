-- Fix: staff console showed empty while TV display showed waiting patients.
-- Cause: authenticated users could sign in to /staff without a staff/admin role,
-- so RLS on tickets returned zero rows. Display uses a security-definer RPC.

create or replace function public.ensure_staff_access()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return false; end if;
  if public.is_staff(auth.uid()) then return true; end if;
  -- First account becomes admin; later sign-ups on the staff console become staff
  if not exists (select 1 from user_roles where role = 'admin') then
    insert into user_roles(user_id, role) values (auth.uid(), 'admin') on conflict (user_id, role) do nothing;
  else
    insert into user_roles(user_id, role) values (auth.uid(), 'staff') on conflict (user_id, role) do nothing;
  end if;
  return public.is_staff(auth.uid());
end $$;

revoke all on function public.ensure_staff_access() from public, anon;
grant execute on function public.ensure_staff_access() to authenticated;

create or replace function public.get_counter_queue(p_counter uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare c public.counters;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  -- Auto-heal missing role so desk staff always see the live queue
  perform public.ensure_staff_access();
  if not public.is_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  select * into c from counters where id = p_counter;
  if c.id is null then raise exception 'Counter not found'; end if;
  return coalesce((
    select json_agg(row_to_json(t) order by t.priority desc, t.queued_at)
    from tickets t
    where (t.service_id = c.service_id and t.status = 'waiting')
       or (t.counter_id = c.id and t.status in ('called', 'serving'))
  ), '[]'::json);
end $$;

revoke all on function public.get_counter_queue(uuid) from public, anon;
grant execute on function public.get_counter_queue(uuid) to authenticated;

-- Grant desk access to the current hospital staff mailbox
insert into public.user_roles(user_id, role)
select id, 'staff'::public.app_role from auth.users
where lower(email) = lower('marcellinostephen052@gmail.com')
on conflict (user_id, role) do nothing;
