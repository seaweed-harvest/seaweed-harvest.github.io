begin;

alter table public.ag_process_records
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz;

update public.ag_process_records
set
  started_at = (process_date + start_time) at time zone 'Africa/Nairobi',
  finished_at = (process_date + end_time) at time zone 'Africa/Nairobi'
where started_at is null or finished_at is null;

alter table public.ag_process_records
  alter column started_at set not null,
  alter column finished_at set not null;

alter table public.ag_process_records
  drop constraint if exists ag_process_record_times_check;

alter table public.ag_process_records
  drop constraint if exists ag_process_record_timestamps_check;
alter table public.ag_process_records
  add constraint ag_process_record_timestamps_check
  check (finished_at > started_at);

comment on column public.ag_process_records.started_at is
  'Authoritative start timestamp for the processing run, entered in Africa/Nairobi local time.';
comment on column public.ag_process_records.finished_at is
  'Authoritative finish timestamp for the processing run; must be later than started_at.';

create or replace function public.ag_sync_process_record_timestamps()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.started_at is null or new.finished_at is null then
      if new.process_date is null or new.start_time is null or new.end_time is null then
        raise exception 'Start date/time and finish date/time are required.'
          using errcode = '22023';
      end if;
      new.started_at := (new.process_date + new.start_time)
        at time zone 'Africa/Nairobi';
      new.finished_at := (
        new.process_date
        + case when new.end_time < new.start_time then 1 else 0 end
        + new.end_time
      ) at time zone 'Africa/Nairobi';
    end if;
  elsif new.started_at is distinct from old.started_at
    or new.finished_at is distinct from old.finished_at then
    null;
  elsif new.process_date is distinct from old.process_date
    or new.start_time is distinct from old.start_time
    or new.end_time is distinct from old.end_time then
    new.started_at := (new.process_date + new.start_time)
      at time zone 'Africa/Nairobi';
    new.finished_at := (
      new.process_date
      + case when new.end_time < new.start_time then 1 else 0 end
      + new.end_time
    ) at time zone 'Africa/Nairobi';
  end if;

  if new.started_at is null or new.finished_at is null
    or new.finished_at <= new.started_at then
    raise exception 'Finish date and time must be later than the start date and time.'
      using errcode = '22023';
  end if;

  new.process_date := (new.started_at at time zone 'Africa/Nairobi')::date;
  new.start_time := (new.started_at at time zone 'Africa/Nairobi')::time;
  new.end_time := (new.finished_at at time zone 'Africa/Nairobi')::time;
  return new;
end;
$$;

drop trigger if exists ag_sync_process_record_timestamps
  on public.ag_process_records;
create trigger ag_sync_process_record_timestamps
before insert or update of process_date, start_time, end_time, started_at, finished_at
on public.ag_process_records
for each row
execute function public.ag_sync_process_record_timestamps();

create or replace function public.ag_submit_process_record(
  p_submission_id uuid,
  p_record jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, storage, pg_temp
as $$
declare
  v_start_date date;
  v_finish_date date;
  v_start_time time;
  v_finish_time time;
  v_started_at timestamptz;
  v_finished_at timestamptz;
  v_legacy_end_time time;
  v_legacy_record jsonb;
  v_result jsonb;
begin
  perform public.ag_require_organisation_capability('form_process_record');
  if p_record is null or jsonb_typeof(p_record) <> 'object' then
    raise exception 'Process record must be an object.' using errcode = '22023';
  end if;

  begin
    v_start_date := nullif(
      coalesce(p_record ->> 'start_date', p_record ->> 'process_date'),
      ''
    )::date;
    v_start_time := nullif(p_record ->> 'start_time', '')::time;
    v_finish_time := nullif(
      coalesce(p_record ->> 'finish_time', p_record ->> 'end_time'),
      ''
    )::time;
    v_finish_date := nullif(p_record ->> 'finish_date', '')::date;
  exception
    when invalid_text_representation then
      raise exception 'Start and finish dates and times must be valid.'
        using errcode = '22023';
  end;

  if v_start_date is null or v_start_time is null or v_finish_time is null then
    raise exception 'Start date/time and finish date/time are required.'
      using errcode = '22023';
  end if;
  if v_finish_date is null then
    v_finish_date := v_start_date
      + case when v_finish_time < v_start_time then 1 else 0 end;
  end if;

  v_started_at := (v_start_date + v_start_time) at time zone 'Africa/Nairobi';
  v_finished_at := (v_finish_date + v_finish_time) at time zone 'Africa/Nairobi';
  if v_finished_at <= v_started_at then
    raise exception 'Finish date and time must be later than the start date and time.'
      using errcode = '22023';
  end if;

  v_legacy_end_time := case
    when v_finish_date = v_start_date and v_finish_time > v_start_time
      then v_finish_time
    else time '23:59:59.999999'
  end;
  v_legacy_record := (
    p_record - array['start_date', 'finish_date', 'finish_time']::text[]
  ) || jsonb_build_object(
    'process_date', v_start_date,
    'start_time', v_start_time,
    'end_time', v_legacy_end_time
  );

  v_result := public.ag_submit_process_record_without_organisation_access(
    p_submission_id,
    v_legacy_record
  );

  if not coalesce((v_result ->> 'duplicate')::boolean, false) then
    update public.ag_process_records
    set
      started_at = v_started_at,
      finished_at = v_finished_at,
      updated_at = now()
    where id = (v_result ->> 'record_id')::uuid;
  else
    select record.started_at, record.finished_at
    into v_started_at, v_finished_at
    from public.ag_process_records record
    where record.id = (v_result ->> 'record_id')::uuid;
  end if;

  return v_result || jsonb_build_object(
    'started_at', v_started_at,
    'finished_at', v_finished_at
  );
end;
$$;

create or replace function public.ag_form_record_ledger(
  p_record_type text,
  p_start_date date default null,
  p_end_date date default null,
  p_community_id text default null,
  p_search text default null,
  p_page_limit integer default 50,
  p_page_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_capability text := public.ag_record_type_capability(p_record_type);
  v_result jsonb;
  v_rows jsonb;
begin
  if v_capability is null then
    raise exception 'Unknown record type.' using errcode = '22023';
  end if;
  perform public.ag_require_organisation_capability(v_capability);
  v_result := public.ag_form_record_ledger_without_organisation_access(
    p_record_type,
    p_start_date,
    p_end_date,
    p_community_id,
    p_search,
    p_page_limit,
    p_page_offset
  );
  if p_record_type <> 'process' then
    return v_result;
  end if;

  select coalesce(
    jsonb_agg(
      item.value || jsonb_build_object(
        'start_date', (record.started_at at time zone 'Africa/Nairobi')::date,
        'start_time', (record.started_at at time zone 'Africa/Nairobi')::time,
        'finish_date', (record.finished_at at time zone 'Africa/Nairobi')::date,
        'finish_time', (record.finished_at at time zone 'Africa/Nairobi')::time,
        'started_at', record.started_at,
        'finished_at', record.finished_at,
        'duration_minutes', round(
          (extract(epoch from (record.finished_at - record.started_at)) / 60.0)::numeric,
          2
        )
      )
      order by item.ordinality
    ),
    '[]'::jsonb
  )
  into v_rows
  from jsonb_array_elements(v_result -> 'rows') with ordinality as item(value, ordinality)
  join public.ag_process_records record
    on record.id = (item.value ->> 'id')::uuid;

  return jsonb_set(v_result, '{rows}', v_rows, true);
end;
$$;

alter function public.ag_sec_operational_summary(date, date, text, text)
  rename to ag_sec_operational_summary_without_full_process_timestamps;

create function public.ag_sec_operational_summary(
  p_start_date date default null,
  p_end_date date default null,
  p_grouping text default 'day',
  p_community_id text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_result jsonb;
  v_rows jsonb;
  v_aggregator_id uuid;
  v_start date;
  v_end date;
  v_grouping text;
  v_total_minutes numeric;
begin
  v_result := public.ag_sec_operational_summary_without_full_process_timestamps(
    p_start_date,
    p_end_date,
    p_grouping,
    p_community_id
  );
  v_aggregator_id := public.ag_require_active_aggregator();
  v_start := (v_result ->> 'start_date')::date;
  v_end := (v_result ->> 'end_date')::date;
  v_grouping := v_result ->> 'grouping';

  with duration_rows as (
    select
      public.ag_operational_period_start(record.process_date, v_grouping) as period_start,
      round(sum(
        (extract(epoch from (record.finished_at - record.started_at)) / 60.0)::numeric
      ), 2) as process_minutes
    from public.ag_process_records record
    where record.aggregator_id = v_aggregator_id
      and record.process_date between v_start and v_end
    group by public.ag_operational_period_start(record.process_date, v_grouping)
  )
  select coalesce(
    jsonb_agg(
      item.value || jsonb_build_object(
        'process_minutes', coalesce(duration.process_minutes, 0)
      )
      order by item.ordinality
    ),
    '[]'::jsonb
  )
  into v_rows
  from jsonb_array_elements(v_result -> 'rows') with ordinality as item(value, ordinality)
  left join duration_rows duration
    on duration.period_start = (item.value ->> 'period_start')::date;

  select round(coalesce(sum(
    (extract(epoch from (record.finished_at - record.started_at)) / 60.0)::numeric
  ), 0), 2)
  into v_total_minutes
  from public.ag_process_records record
  where record.aggregator_id = v_aggregator_id
    and record.process_date between v_start and v_end;

  v_result := jsonb_set(v_result, '{rows}', v_rows, true);
  v_result := jsonb_set(
    v_result,
    '{totals,process_minutes}',
    to_jsonb(v_total_minutes),
    true
  );
  return v_result;
end;
$$;

revoke all on function public.ag_sync_process_record_timestamps()
  from public, anon, authenticated;
revoke all on function public.ag_submit_process_record(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.ag_form_record_ledger(text, date, date, text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.ag_sec_operational_summary_without_full_process_timestamps(date, date, text, text)
  from public, anon, authenticated;
revoke all on function public.ag_sec_operational_summary(date, date, text, text)
  from public, anon, authenticated;

grant execute on function public.ag_submit_process_record(uuid, jsonb)
  to authenticated;
grant execute on function public.ag_form_record_ledger(text, date, date, text, text, integer, integer)
  to authenticated;
grant execute on function public.ag_sec_operational_summary(date, date, text, text)
  to authenticated;

comment on function public.ag_submit_process_record(uuid, jsonb) is
  'Submits a Process Record with authoritative start and finish timestamps while accepting legacy process_date/start_time/end_time payloads.';
comment on function public.ag_sec_operational_summary(date, date, text, text) is
  'Returns operational summaries with processing duration calculated from complete start and finish timestamps.';

notify pgrst, 'reload schema';

commit;
