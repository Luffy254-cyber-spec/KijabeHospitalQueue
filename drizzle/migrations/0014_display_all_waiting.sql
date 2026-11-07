-- Display board: every waiting patient across all departments (not only registration).

create or replace function public.get_display_board()
returns json language plpgsql security definer set search_path = public as $$
begin
  perform run_queue_automation(false);
  return json_build_object(
    'called', coalesce((select json_agg(r) from (
      select t.token, c.name as counter, s.name_en as service_en, s.name_sw as service_sw, t.status, t.called_at, t.recall_count
      from tickets t join services s on s.id = t.service_id left join counters c on c.id = t.counter_id
      where t.status in ('called','serving') and t.called_at > now() - interval '12 hours'
      order by t.called_at desc limit 12) r), '[]'::json),
    'queues', coalesce((select json_agg(q order by q.sort) from (
      select s.code, s.name_en, s.name_sw, s.sort, s.avg_minutes, s.surge_threshold,
        (select count(*) from tickets t where t.service_id = s.id and t.status = 'waiting') as waiting,
        (select count(*) from counters c where c.service_id = s.id and c.active) as open_counters,
        (select array_agg(tok) from (
          select t.token as tok from tickets t
          where t.service_id = s.id and t.status = 'waiting'
          order by t.priority desc, t.queued_at
          limit 24
        ) z) as next_tokens
      from services s) q), '[]'::json),
    -- Flat list so the TV can show every waiting patient at every step of the care path
    'waiting_all', coalesce((select json_agg(w order by w.sort, w.priority desc, w.queued_at) from (
      select t.token, t.priority, t.queued_at, t.triage_level as triage,
        s.code as service_code, s.name_en as service_en, s.name_sw as service_sw, s.sort,
        (select count(*) from tickets x
          where x.service_id = t.service_id and x.status = 'waiting'
            and (x.priority > t.priority or (x.priority = t.priority and x.queued_at <= t.queued_at))
            and x.id <> t.id
        ) as ahead
      from tickets t
      join services s on s.id = t.service_id
      where t.status = 'waiting'
      order by s.sort, t.priority desc, t.queued_at
      limit 80
    ) w), '[]'::json)
  );
end $$;

revoke all on function public.get_display_board() from public;
grant execute on function public.get_display_board() to anon, authenticated;
