-- COSME dryer: preserve every measurement edit and reject implausible completed cycles.
-- Additive, no historic source rows are rewritten.
create schema if not exists private;

create table if not exists private.seaweed_drying_measurement_revisions (
  id bigint generated always as identity primary key,
  submission_id uuid not null,
  bay_number smallint,
  reweigh_id uuid,
  entity_type text not null check (entity_type in ('submission','bay','reweigh_event','reweigh_bay')),
  action text not null check (action in ('baseline','insert','update','delete')),
  changed_at timestamptz not null default now(),
  request_actor text,
  enumerator_name text,
  old_state jsonb,
  new_state jsonb,
  transaction_id bigint not null default txid_current()
);
create index if not exists seaweed_drying_measurement_revisions_lookup
  on private.seaweed_drying_measurement_revisions (submission_id, bay_number, changed_at, id);
create index if not exists seaweed_drying_measurement_revisions_reweigh
  on private.seaweed_drying_measurement_revisions (reweigh_id, changed_at, id);
alter table private.seaweed_drying_measurement_revisions enable row level security;
revoke all on private.seaweed_drying_measurement_revisions from public, anon, authenticated;
revoke all on sequence private.seaweed_drying_measurement_revisions_id_seq from public, anon, authenticated;

-- Explicitly select measurement/identity fields; never archive upload tokens or credentials.
create or replace function private.seaweed_drying_bay_version(p_row public.seaweed_drying_bay_records)
returns jsonb
language sql stable
set search_path = ''
as $fn$
  select jsonb_build_object(
    'submission_id', p_row.submission_id,
    'bay_number', p_row.bay_number,
    'loading_at', p_row.loading_at,
    'loading_weight_g', p_row.loading_weight_g,
    'loading_weather', p_row.loading_weather,
    'unloading_at', p_row.unloading_at,
    'unloading_weight_g', p_row.unloading_weight_g,
    'unloading_weather', p_row.unloading_weather,
    'notes', p_row.notes
  );
$fn$;

create or replace function private.seaweed_drying_submission_version(p_row public.seaweed_drying_submissions)
returns jsonb
language sql stable
set search_path = ''
as $fn$
  select jsonb_build_object(
    'id', p_row.id,
    'receipt_number', p_row.receipt_number,
    'table_location', p_row.table_location,
    'dryer_location_code', p_row.dryer_location_code,
    'enumerator_name', p_row.enumerator_name,
    'enumerator_id', p_row.enumerator_id,
    'recorded_at', p_row.recorded_at,
    'bay_count', p_row.bay_count,
    'record_status', p_row.record_status,
    'confirmed_accurate', p_row.confirmed_accurate
  );
$fn$;

create or replace function private.seaweed_drying_reweigh_version(p_row public.seaweed_drying_reweigh_events)
returns jsonb language sql stable set search_path = ''
as $fn$
  select jsonb_build_object('id',p_row.id,'submission_id',p_row.submission_id,
    'reweigh_at',p_row.reweigh_at,'weather',p_row.weather,'notes',p_row.notes);
$fn$;

create or replace function private.seaweed_drying_reweigh_bay_version(p_row public.seaweed_drying_reweigh_bay_records)
returns jsonb language sql stable set search_path = ''
as $fn$
  select jsonb_build_object('reweigh_id',p_row.reweigh_id,
    'submission_id',p_row.submission_id,'bay_number',p_row.bay_number,
    'weight_g',p_row.weight_g);
$fn$;

create or replace function private.seaweed_drying_audit_revision()
returns trigger
language plpgsql security definer
set search_path = ''
as $fn$
declare
  v_before jsonb;
  v_after jsonb;
  v_submission_id uuid;
  v_bay_number smallint;
  v_reweigh_id uuid;
  v_actor_name text;
begin
  if tg_table_name = 'seaweed_drying_bay_records' then
    v_before := case when tg_op = 'INSERT' then null
      else private.seaweed_drying_bay_version(old) end;
    v_after := case when tg_op = 'DELETE' then null
      else private.seaweed_drying_bay_version(new) end;
    v_submission_id := case when tg_op = 'DELETE' then old.submission_id else new.submission_id end;
    v_bay_number := case when tg_op = 'DELETE' then old.bay_number else new.bay_number end;
  elsif tg_table_name='seaweed_drying_reweigh_bay_records' then
    v_before := case when tg_op='INSERT' then null
      else private.seaweed_drying_reweigh_bay_version(old) end;
    v_after := case when tg_op='DELETE' then null
      else private.seaweed_drying_reweigh_bay_version(new) end;
    v_submission_id := case when tg_op='DELETE' then old.submission_id else new.submission_id end;
    v_bay_number := case when tg_op='DELETE' then old.bay_number else new.bay_number end;
    v_reweigh_id := case when tg_op='DELETE' then old.reweigh_id else new.reweigh_id end;
  elsif tg_table_name='seaweed_drying_reweigh_events' then
    v_before := case when tg_op='INSERT' then null
      else private.seaweed_drying_reweigh_version(old) end;
    v_after := case when tg_op='DELETE' then null
      else private.seaweed_drying_reweigh_version(new) end;
    v_submission_id := case when tg_op='DELETE' then old.submission_id else new.submission_id end;
    v_bay_number := null;
    v_reweigh_id := case when tg_op='DELETE' then old.id else new.id end;
  else
    v_before := case when tg_op = 'INSERT' then null
      else private.seaweed_drying_submission_version(old) end;
    v_after := case when tg_op = 'DELETE' then null
      else private.seaweed_drying_submission_version(new) end;
    v_submission_id := case when tg_op = 'DELETE' then old.id else new.id end;
    v_bay_number := null;
  end if;

  if v_before is distinct from v_after then
    select s.enumerator_name into v_actor_name
    from public.seaweed_drying_submissions s where s.id = v_submission_id;
    insert into private.seaweed_drying_measurement_revisions
      (submission_id,bay_number,reweigh_id,entity_type,action,request_actor,enumerator_name,old_state,new_state)
    values (
      v_submission_id, v_bay_number, v_reweigh_id,
      case tg_table_name
        when 'seaweed_drying_bay_records' then 'bay'
        when 'seaweed_drying_reweigh_events' then 'reweigh_event'
        when 'seaweed_drying_reweigh_bay_records' then 'reweigh_bay'
        else 'submission'
      end,
      lower(tg_op), nullif(current_setting('request.jwt.claim.sub',true),''),
      v_actor_name, v_before, v_after
    );
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$fn$;

drop trigger if exists seaweed_drying_audit_bay_revision on public.seaweed_drying_bay_records;
create trigger seaweed_drying_audit_bay_revision
after insert or update or delete on public.seaweed_drying_bay_records
for each row execute function private.seaweed_drying_audit_revision();

drop trigger if exists seaweed_drying_audit_submission_revision on public.seaweed_drying_submissions;
create trigger seaweed_drying_audit_submission_revision
after insert or update or delete on public.seaweed_drying_submissions
for each row execute function private.seaweed_drying_audit_revision();

drop trigger if exists seaweed_drying_audit_reweigh_revision on public.seaweed_drying_reweigh_events;
create trigger seaweed_drying_audit_reweigh_revision
after insert or update or delete on public.seaweed_drying_reweigh_events
for each row execute function private.seaweed_drying_audit_revision();

drop trigger if exists seaweed_drying_audit_reweigh_bay_revision on public.seaweed_drying_reweigh_bay_records;
create trigger seaweed_drying_audit_reweigh_bay_revision
after insert or update or delete on public.seaweed_drying_reweigh_bay_records
for each row execute function private.seaweed_drying_audit_revision();

-- Archive one baseline of currently visible values, not a fabricated history.
insert into private.seaweed_drying_measurement_revisions
  (submission_id,bay_number,entity_type,action,enumerator_name,old_state,new_state)
select b.submission_id,b.bay_number,'bay','baseline',s.enumerator_name,
       null,private.seaweed_drying_bay_version(b)
from public.seaweed_drying_bay_records b
join public.seaweed_drying_submissions s on s.id=b.submission_id
where not exists (
 select 1 from private.seaweed_drying_measurement_revisions h
 where h.submission_id=b.submission_id and h.bay_number=b.bay_number
   and h.entity_type='bay' and h.action='baseline'
);

insert into private.seaweed_drying_measurement_revisions
  (submission_id,entity_type,action,enumerator_name,old_state,new_state)
select s.id,'submission','baseline',s.enumerator_name,
       null,private.seaweed_drying_submission_version(s)
from public.seaweed_drying_submissions s
where not exists (
 select 1 from private.seaweed_drying_measurement_revisions h
 where h.submission_id=s.id and h.entity_type='submission'
   and h.action='baseline'
);

insert into private.seaweed_drying_measurement_revisions
 (submission_id,reweigh_id,entity_type,action,enumerator_name,old_state,new_state)
select r.submission_id,r.id,'reweigh_event','baseline',s.enumerator_name,
  null,private.seaweed_drying_reweigh_version(r)
from public.seaweed_drying_reweigh_events r
join public.seaweed_drying_submissions s on s.id=r.submission_id
where not exists (
 select 1 from private.seaweed_drying_measurement_revisions h
 where h.reweigh_id=r.id and h.entity_type='reweigh_event' and h.action='baseline'
);

insert into private.seaweed_drying_measurement_revisions
 (submission_id,bay_number,reweigh_id,entity_type,action,enumerator_name,old_state,new_state)
select rb.submission_id,rb.bay_number,rb.reweigh_id,'reweigh_bay','baseline',s.enumerator_name,
  null,private.seaweed_drying_reweigh_bay_version(rb)
from public.seaweed_drying_reweigh_bay_records rb
join public.seaweed_drying_submissions s on s.id=rb.submission_id
where not exists (
 select 1 from private.seaweed_drying_measurement_revisions h
 where h.reweigh_id=rb.reweigh_id and h.bay_number=rb.bay_number
   and h.entity_type='reweigh_bay' and h.action='baseline'
);

-- Deferred checks see the final state of all bays after the multi-row save RPC.
-- In-progress records and existing unchanged completed rows are left undisturbed.
create or replace function private.seaweed_drying_assert_valid_completion()
returns trigger
language plpgsql security definer
set search_path = ''
as $fn$
declare
 v_id uuid;
 v_status text;
 v_issue text;
begin
 -- Photo-only updates and harmless submission touch events must not be blocked
 -- by historic bad measurements. They still receive their own audit if changed.
 if tg_op='UPDATE' and tg_table_name='seaweed_drying_bay_records'
    and new.loading_at is not distinct from old.loading_at
    and new.loading_weight_g is not distinct from old.loading_weight_g
    and new.unloading_at is not distinct from old.unloading_at
    and new.unloading_weight_g is not distinct from old.unloading_weight_g then return new; end if;
 if tg_op='UPDATE' and tg_table_name='seaweed_drying_submissions'
    and new.record_status is not distinct from old.record_status
    and new.confirmed_accurate is not distinct from old.confirmed_accurate then return new; end if;
 v_id := case
   when tg_table_name='seaweed_drying_submissions'
     then case when tg_op='DELETE' then old.id else new.id end
   else case when tg_op='DELETE' then old.submission_id else new.submission_id end
 end;
 select s.record_status into v_status
 from public.seaweed_drying_submissions s where s.id=v_id;
 if v_status <> 'complete' then
   if tg_op='DELETE' then return old; end if;
   return new;
 end if;

 select format('Bay %s: %s',b.bay_number,
   case
     when b.loading_at is null or b.loading_weight_g is null
       or b.unloading_at is null or b.unloading_weight_g is null then 'loading and unloading both need dates and weights'
     when b.unloading_at <= b.loading_at then 'unloading must be after loading'
     when b.unloading_at < b.loading_at + interval '12 hours' then 'drying duration below 12 hours needs review'
     when b.loading_weight_g <= 0 then 'fresh loading weight must be greater than zero'
     when b.unloading_weight_g >= b.loading_weight_g then 'unloading weight must be lower than fresh loading weight'
     else null
   end
 ) into v_issue
 from public.seaweed_drying_bay_records b
 where b.submission_id=v_id and
   (b.loading_at is null or b.loading_weight_g is null or
    b.unloading_at is null or b.unloading_weight_g is null or
    b.unloading_at < b.loading_at + interval '12 hours' or
    b.loading_weight_g <= 0 or b.unloading_weight_g >= b.loading_weight_g)
 order by b.bay_number limit 1;

 if not exists (select 1 from public.seaweed_drying_bay_records where submission_id=v_id) then
   raise exception 'A completed dryer submission must have at least one bay measurement'
     using errcode='23514';
 end if;
 if v_issue is not null then
   raise exception 'Dryer record cannot be marked complete: %. Save as in progress and correct the measurement.',v_issue
     using errcode='23514';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end;
$fn$;

drop trigger if exists seaweed_drying_validate_completed_submission on public.seaweed_drying_submissions;
create constraint trigger seaweed_drying_validate_completed_submission
after insert or update on public.seaweed_drying_submissions
deferrable initially deferred
for each row execute function private.seaweed_drying_assert_valid_completion();

drop trigger if exists seaweed_drying_validate_completed_bay on public.seaweed_drying_bay_records;
create constraint trigger seaweed_drying_validate_completed_bay
after insert or update or delete on public.seaweed_drying_bay_records
deferrable initially deferred
for each row execute function private.seaweed_drying_assert_valid_completion();
