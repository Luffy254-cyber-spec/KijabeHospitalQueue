-- Server-side scheduler independent of the TV; 2-minute recall timing needs per-minute cadence, limited to clinic hours (~900 runs/day)
create type public.app_role as enum ('admin', 'staff');
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role public.app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
create policy "read own roles" on public.user_roles for select to authenticated using (user_id = auth.uid());

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.claim_first_admin()
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authorized'; end if;
  if exists (select 1 from user_roles where role = 'admin') then return false; end if;
  insert into user_roles(user_id, role) values (auth.uid(), 'admin');
  return true;
end $$;
revoke all on function public.claim_first_admin() from public, anon;
grant execute on function public.claim_first_admin() to authenticated;

create table public.automation_settings (
  service_id uuid primary key references public.services(id) on delete cascade,
  recall_enabled boolean not null default true,
  recall_after_min int not null default 2 check (recall_after_min between 1 and 30),
  max_recalls int not null default 2 check (max_recalls between 0 and 5),
  no_show_enabled boolean not null default true,
  no_show_after_min int not null default 2 check (no_show_after_min between 1 and 60),
  requeue_enabled boolean not null default true,
  requeue_after_min int not null default 15 check (requeue_after_min between 1 and 240),
  max_returns int not null default 2 check (max_returns between 0 and 5),
  surge_enabled boolean not null default true,
  surge_threshold int not null default 25 check (surge_threshold between 1 and 500),
  long_wait_enabled boolean not null default true,
  long_wait_min int not null default 45 check (long_wait_min between 5 and 480),
  updated_at timestamptz not null default now(),
  updated_by text
);
grant select, update on public.automation_settings to authenticated;
grant all on public.automation_settings to service_role;
alter table public.automation_settings enable row level security;
create policy "staff read settings" on public.automation_settings for select to authenticated using (true);
create policy "admins update settings" on public.automation_settings for update to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

insert into public.automation_settings(service_id, surge_threshold) select id, surge_threshold from public.services;

create or replace function public.ensure_automation_settings() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into automation_settings(service_id, surge_threshold) values (new.id, new.surge_threshold) on conflict do nothing; return new; end $$;
create trigger services_settings after insert on public.services for each row execute function public.ensure_automation_settings();

create or replace function public.sync_surge_threshold() returns trigger language plpgsql security definer set search_path = public as $$
begin new.updated_at := now(); new.updated_by := coalesce(auth.jwt()->>'email', new.updated_by);
  update services set surge_threshold = case when new.surge_enabled then new.surge_threshold else 0 end where id = new.service_id; return new; end $$;
create trigger settings_sync before update on public.automation_settings for each row execute function public.sync_surge_threshold();

create or replace function public.run_queue_automation(p_force boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare n_recall int := 0; n_noshow int := 0; n_requeue int := 0; n_open int := 0; n_close int := 0;
begin
  update automation_state set last_run = now() where id = 1 and (p_force or last_run < now() - interval '30 seconds');
  if not found then return json_build_object('skipped', true); end if;

  with r as (update tickets t set called_at = now(), recall_count = t.recall_count + 1
    from automation_settings a where a.service_id = t.service_id and a.recall_enabled
      and t.status = 'called' and t.called_at < now() - make_interval(mins => a.recall_after_min) and t.recall_count < a.max_recalls
    returning t.id, t.service_id, t.counter_id)
  insert into ticket_events(ticket_id, action, service_id, counter_id, staff_email)
    select id, 'auto_recall', service_id, counter_id, 'Automation' from r;
  get diagnostics n_recall = row_count;

  with r as (update tickets t set status = 'no_show', completed_at = now()
    from automation_settings a where a.service_id = t.service_id and a.no_show_enabled
      and t.status = 'called' and t.called_at < now() - make_interval(mins => a.no_show_after_min)
      and (t.recall_count >= a.max_recalls or not a.recall_enabled)
    returning t.id, t.service_id, t.counter_id)
  insert into ticket_events(ticket_id, action, service_id, counter_id, staff_email)
    select id, 'auto_no_show', service_id, counter_id, 'Automation' from r;
  get diagnostics n_noshow = row_count;

  with r as (update tickets t set status = 'waiting', counter_id = null, called_at = null, completed_at = null,
      recall_count = 0, missed_returns = t.missed_returns + 1, priority = greatest(t.priority, 1), queued_at = now()
    from automation_settings a where a.service_id = t.service_id and a.requeue_enabled
      and t.status = 'no_show' and t.completed_at < now() - make_interval(mins => a.requeue_after_min)
      and t.missed_returns < a.max_returns and t.created_at > now() - interval '12 hours'
    returning t.id, t.service_id)
  insert into ticket_events(ticket_id, action, service_id, staff_email)
    select id, 'auto_requeue', service_id, 'Automation' from r;
  get diagnostics n_requeue = row_count;

  with q as (select a.service_id id, a.surge_threshold, (select count(*) from tickets t where t.service_id = a.service_id and t.status = 'waiting') w
             from automation_settings a where a.surge_enabled)
  update counters c set active = true from q where c.service_id = q.id and c.overflow and not c.active and q.w >= q.surge_threshold;
  get diagnostics n_open = row_count;
  with q as (select a.service_id id, a.surge_threshold, a.surge_enabled, (select count(*) from tickets t where t.service_id = a.service_id and t.status = 'waiting') w
             from automation_settings a)
  update counters c set active = false from q where c.service_id = q.id and c.overflow and c.active
    and (not q.surge_enabled or q.w < q.surge_threshold / 2)
    and not exists (select 1 from tickets t where t.counter_id = c.id and t.status in ('called','serving'));
  get diagnostics n_close = row_count;

  return json_build_object('recalled', n_recall, 'no_show', n_noshow, 'requeued', n_requeue, 'overflow_opened', n_open, 'overflow_closed', n_close);
end $$;
revoke all on function public.run_queue_automation(boolean) from public, anon, authenticated;

select cron.schedule('queue-automation', '* 3-17 * * *', 'select public.run_queue_automation(true)');