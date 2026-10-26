-- BioStim batch edit: read the complete original submission and atomically update it.
-- Every operation is tenant-scoped, authenticated, audited, and delegates
-- serial/range/stock-action checks to ag_correct_stabilization_packing_batch.
create or replace function public.ag_get_stabilization_packing_batch_for_edit(
  p_batch_submission_id uuid
) returns jsonb
language plpgsql stable security definer
set search_path to 'public','auth','pg_temp'
as $fn$
declare
 v_actor uuid := (select auth.uid());
 v_org uuid;
 v_rows jsonb;
 v_count integer;
 v_last timestamptz;
begin
 if v_actor is null then raise exception 'Sign in to edit stock.' using errcode='42501'; end if;
 v_org := public.ag_require_organisation_capability('form_stock_record');
 if not (public.ag_has_permission('can_view_data') or public.ag_has_permission('can_submit_collection')) then
   raise exception 'Stock record access required.' using errcode='42501';
 end if;
 if p_batch_submission_id is null then raise exception 'Choose a batch.' using errcode='22023'; end if;
 if not public.ag_has_permission('can_edit_collections') and
   exists (select 1 from public.ag_stabilization_packing_records r
     where r.aggregator_id=v_org and r.batch_submission_id=p_batch_submission_id
       and r.record_type='initial' and r.recorded_by_user_id is distinct from v_actor) then
   raise exception 'You cannot edit this batch.' using errcode='42501';
 end if;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.carton_serial::numeric, r.id),'[]'::jsonb),
        count(*),max(r.updated_at)
   into v_rows,v_count,v_last
 from public.ag_stabilization_packing_records r
 where r.aggregator_id=v_org and r.batch_submission_id=p_batch_submission_id and r.record_type='initial';
 if v_count=0 then raise exception 'Batch not found.' using errcode='P0002'; end if;
 if v_count>100 then raise exception 'Batch too large for one edit.' using errcode='22023'; end if;
 return jsonb_build_object('rows',v_rows,'expected_count',v_count,
    'expected_latest_updated_at',v_last);
end;
$fn$;

create or replace function public.ag_update_stabilization_packing_batch_from_form(
  p_batch_submission_id uuid, p_record jsonb
) returns jsonb
language plpgsql security definer
set search_path to 'public','auth','pg_temp'
as $fn$
declare
 v_actor uuid := (select auth.uid());
 v_org uuid;
 v_profile public.ag_user_profiles%rowtype;
 v_date date;
 v_name text;
 v_notes text;
 v_hydrometer numeric;
 v_hydrometer_scale text;
 v_ecoli boolean;
 v_first public.ag_stabilization_packing_records%rowtype;
 v_result jsonb;
 v_extra_change boolean;
 v_first_serial text;
 v_last_serial text;
 v_prior jsonb;
begin
 if v_actor is null then raise exception 'Sign in to edit stock.' using errcode='42501'; end if;
 if p_batch_submission_id is null or p_record is null or jsonb_typeof(p_record)<>'object' then
   raise exception 'A batch and correction form are required.' using errcode='22023';
 end if;
 v_org := public.ag_require_organisation_capability('form_stock_record');
 select * into v_profile from public.ag_user_profiles where id=v_actor and account_status='active';
 if not found then raise exception 'An active user profile is required.' using errcode='42501'; end if;
 select * into v_first from public.ag_stabilization_packing_records r
   where r.aggregator_id=v_org and r.batch_submission_id=p_batch_submission_id and r.record_type='initial'
   order by carton_serial::numeric,id limit 1;
 if not found then raise exception 'Batch not found.' using errcode='P0002'; end if;
 v_date := nullif(p_record->>'packed_on','')::date;
 v_name := nullif(trim(p_record->>'recorded_by_name'),'');
 v_notes := nullif(trim(p_record->>'notes'),'');
 v_hydrometer := nullif(p_record->>'hydrometer_value','')::numeric;
 v_hydrometer_scale := nullif(trim(p_record->>'hydrometer_scale'),'');
 v_ecoli := nullif(p_record->>'e_coli_sample_taken','')::boolean;
 if v_date is null or v_date > (now() at time zone 'Africa/Nairobi')::date then
   raise exception 'Enter a valid production date.' using errcode='22023';
 end if;
 if v_name is null or length(v_name)>160 or length(coalesce(v_notes,''))>1000 then
   raise exception 'Check recorded by and notes.' using errcode='22023';
 end if;
 if v_hydrometer is not null and (v_hydrometer<=0 or v_hydrometer>10) then
   raise exception 'Hydrometer SG must be greater than 0 and no more than 10.' using errcode='22023';
 end if;
 if v_hydrometer is not null and v_hydrometer_scale <> 'SG' then
   raise exception 'Hydrometer readings on the batch form must use SG.' using errcode='22023';
 end if;
 if v_hydrometer is null then v_hydrometer_scale:=null; end if;
 v_extra_change := exists (
   select 1 from public.ag_stabilization_packing_records r
   where r.aggregator_id=v_org and r.batch_submission_id=p_batch_submission_id and r.record_type='initial'
    and (r.packed_on is distinct from v_date or r.recorded_by_name is distinct from v_name
      or r.notes is distinct from v_notes or r.hydrometer_value is distinct from v_hydrometer
      or r.hydrometer_scale is distinct from v_hydrometer_scale
      or r.e_coli_sample_taken is distinct from v_ecoli)
 );
 -- Prevent altering already moved stock via the supplementary fields.
 if v_extra_change and exists (
  select 1 from public.ag_stabilization_packing_records r
   join public.ag_stabilization_stock_actions a
     on a.aggregator_id=r.aggregator_id and a.carton_serial=r.carton_serial
   where r.aggregator_id=v_org and r.batch_submission_id=p_batch_submission_id and r.record_type='initial'
 ) then
  raise exception 'This batch has stock movements. Correct its affected records individually.'
    using errcode='55000';
 end if;
 v_result := public.ag_correct_stabilization_packing_batch(
    p_batch_submission_id,p_record
 );
 if v_extra_change then
   insert into public.ag_audit_log(actor_user_id,actor_email,action,target_type,target_id,details)
   select v_actor,v_profile.email,'stock_batch_original_form_updated','stock_record',r.id::text,
     jsonb_build_object('batch_submission_id',p_batch_submission_id,
       'before',jsonb_build_object('packed_on',r.packed_on,'recorded_by_name',r.recorded_by_name,
          'notes',r.notes,'hydrometer_value',r.hydrometer_value,'hydrometer_scale',r.hydrometer_scale,
          'e_coli_sample_taken',r.e_coli_sample_taken),
       'after',jsonb_build_object('packed_on',v_date,'recorded_by_name',v_name,'notes',v_notes,
          'hydrometer_value',v_hydrometer,'hydrometer_scale',v_hydrometer_scale,
          'e_coli_sample_taken',v_ecoli))
   from public.ag_stabilization_packing_records r
    where r.aggregator_id=v_org and r.batch_submission_id=p_batch_submission_id and r.record_type='initial';
   update public.ag_stabilization_packing_records r
     set packed_on=v_date,recorded_by_name=v_name,notes=v_notes,
         hydrometer_value=v_hydrometer,hydrometer_scale=v_hydrometer_scale,
         e_coli_sample_taken=v_ecoli,updated_at=now()
   where r.aggregator_id=v_org and r.batch_submission_id=p_batch_submission_id and r.record_type='initial';
 end if;
 return v_result;
end;
$fn$;
revoke all on function public.ag_get_stabilization_packing_batch_for_edit(uuid) from public,anon,authenticated;
grant execute on function public.ag_get_stabilization_packing_batch_for_edit(uuid) to authenticated;
revoke all on function public.ag_update_stabilization_packing_batch_from_form(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ag_update_stabilization_packing_batch_from_form(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
