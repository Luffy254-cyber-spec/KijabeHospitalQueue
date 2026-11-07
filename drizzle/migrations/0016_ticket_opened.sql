alter table public.tickets add column if not exists opened_at timestamptz;

create or replace function public.mark_ticket_opened(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update tickets set opened_at = coalesce(opened_at, now()) where id = p_id;
end $$;

create or replace function public.ticket_was_opened(p_id uuid)
returns boolean language sql security definer set search_path = public as $$
  select coalesce((select opened_at is not null from tickets where id = p_id), false);
$$;

revoke all on function public.mark_ticket_opened(uuid) from public;
grant execute on function public.mark_ticket_opened(uuid) to anon, authenticated;
revoke all on function public.ticket_was_opened(uuid) from public;
grant execute on function public.ticket_was_opened(uuid) to anon, authenticated;
