-- Synthetic fixtures only. No real account, value or shared pick survives.
-- Run as postgres in a single connection; every write is rolled back.
begin;
do $test$
declare
  u_owner uuid:=gen_random_uuid(); u_editor uuid:=gen_random_uuid();
  u_reader uuid:=gen_random_uuid(); u_expired uuid:=gen_random_uuid();
  u_suspended uuid:=gen_random_uuid(); u_none uuid:=gen_random_uuid();u_inactive uuid:=gen_random_uuid();
  r_current uuid:=gen_random_uuid(); r_old uuid:=gen_random_uuid();
  m_current uuid:=gen_random_uuid(); m_old uuid:=gen_random_uuid();
  rev_current uuid:=gen_random_uuid(); rev_old uuid:=gen_random_uuid();
  result jsonb; who uuid; before_count integer;
  base_hash text;
begin
  select md5(string_agg(i.frozen_payload::text,'|' order by i.metric_id)) into base_hash
  from cosme_metrics.release_items i join cosme_metrics.releases r on r.id=i.release_id
  where r.project_key='COSME' and r.major=0 and r.minor=1;
  -- Null email prevents email-based access linking; empty metadata creates no
  -- registration request. Existing profile-sync trigger supplies default profiles.
  insert into auth.users(id,aud,role,raw_app_meta_data,raw_user_meta_data)
  select id,'authenticated','authenticated','{}'::jsonb,'{}'::jsonb
  from unnest(array[u_owner,u_editor,u_reader,u_expired,u_suspended,u_none,u_inactive]) as id;
  update public.ag_user_profiles set account_status='active'
  where id=any(array[u_owner,u_editor,u_reader,u_expired,u_none,u_inactive]);
  update public.ag_user_profiles set account_status='suspended' where id=u_suspended;
  insert into cosme_metrics.grants(project_key,user_id,role,active,expires_at) values
    ('COSME',u_owner,'owner',true,null),('COSME',u_editor,'editor',true,null),
    ('COSME',u_reader,'reader',true,null),
    ('COSME',u_expired,'editor',true,now()-interval '1 hour'),
    ('COSME',u_suspended,'editor',true,null),('COSME',u_inactive,'editor',false,null);
  insert into cosme_metrics.metrics(id,project_key,human_id) values
    (m_current,'COSME','TEST-SHARED-CURRENT'),(m_old,'COSME','TEST-SHARED-OLD');
  insert into cosme_metrics.metric_revisions(id,project_key,metric_id,revision_number,body) values
    (rev_current,'COSME',m_current,1,'{"featured":false,"value":"synthetic"}'),
    (rev_old,'COSME',m_old,1,'{"featured":true,"value":"synthetic"}');
  insert into cosme_metrics.releases(id,project_key,major,minor,purpose) values
    (r_current,'COSME',2147483000,1,'Synthetic test only'),
    (r_old,'COSME',2147483000,0,'Synthetic historical test only');
  insert into cosme_metrics.release_items(release_id,project_key,metric_id,metric_revision_id,frozen_payload,display_order) values
    (r_current,'COSME',m_current,rev_current,'{"featured":false,"value":"synthetic"}',1),
    (r_old,'COSME',m_old,rev_old,'{"featured":true,"value":"synthetic"}',1);
  update cosme_metrics.projects set current_release_id=r_current where project_key='COSME';
  perform set_config('request.jwt.claim.sub',u_owner::text,true);
  result:=public.cosme_metrics_get_picks(2147483000,1);
  assert result->>'can_edit'='true' and jsonb_array_length(result->'picks')=1,'owner read';
  result:=public.cosme_metrics_set_pick(2147483000,1,'TEST-SHARED-CURRENT',true,0);
  assert result->>'revision'='1' and result->>'featured'='true','owner save';
  assert (select count(*)=1 from cosme_metrics.pick_events where release_id=r_current),'one audit';
  begin
    perform public.cosme_metrics_set_pick(2147483000,1,'TEST-SHARED-CURRENT',false,0);
    raise exception 'stale write unexpectedly succeeded';
  exception when serialization_failure then null; end;
  assert (select count(*)=1 from cosme_metrics.pick_events where release_id=r_current),'conflict has no audit';
  perform set_config('request.jwt.claim.sub',u_editor::text,true);
  result:=public.cosme_metrics_set_pick(2147483000,1,'TEST-SHARED-CURRENT',false,1);
  assert result->>'revision'='2' and result->>'featured'='false','editor save';
  assert (select changed_by=u_editor from cosme_metrics.pick_events where release_id=r_current and revision=2),'editor audit identity';
  result:=public.cosme_metrics_get_picks(2147483000,0);
  assert result->>'can_edit'='false' and result->'picks'->0->>'featured'='true','historical isolation';
  begin
    perform public.cosme_metrics_set_pick(2147483000,0,'TEST-SHARED-OLD',false,0);
    raise exception 'historical write unexpectedly succeeded';
  exception when invalid_parameter_value then null; end;
  foreach who in array array[u_reader,u_expired,u_suspended,u_none,u_inactive] loop
    perform set_config('request.jwt.claim.sub',who::text,true);
    begin
      perform public.cosme_metrics_set_pick(2147483000,1,'TEST-SHARED-CURRENT',true,2);
      raise exception 'untrusted write unexpectedly succeeded';
    exception when insufficient_privilege then null; end;
  end loop;
  perform set_config('request.jwt.claim.sub',u_reader::text,true);
  result:=public.cosme_metrics_get_picks(2147483000,1);
  assert result->>'can_edit'='false' and result->'picks'->0->>'featured'='false','reader shared read';
  foreach who in array array[u_expired,u_suspended,u_none,u_inactive] loop
    perform set_config('request.jwt.claim.sub',who::text,true);
    begin
      perform public.cosme_metrics_get_picks(2147483000,1);
      raise exception 'untrusted read unexpectedly succeeded';
    exception when insufficient_privilege then null; end;
  end loop;
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.cosme_metrics_get_picks(2147483000,1);
    raise exception 'anonymous read unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',u_owner::text,true);
  begin
    perform public.cosme_metrics_set_pick(2147483000,1,'UNKNOWN',true,0);
    raise exception 'unknown metric unexpectedly succeeded';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.cosme_metrics_set_pick(2147483000,1,'TEST-SHARED-OLD',true,0);
    raise exception 'wrong-release metric unexpectedly succeeded';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.cosme_metrics_set_pick(2147483000,1,'TEST-SHARED-CURRENT',null,2);
    raise exception 'null selection unexpectedly succeeded';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.cosme_metrics_set_pick(2147483000,1,'TEST-SHARED-CURRENT',true,-1);
    raise exception 'negative revision unexpectedly succeeded';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.cosme_metrics_get_picks(null,1);
    raise exception 'null version unexpectedly succeeded';
  exception when invalid_parameter_value then null; end;
  begin
    update cosme_metrics.pick_events set featured=true where release_id=r_current;
    raise exception 'audit update unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  assert base_hash=(select md5(string_agg(i.frozen_payload::text,'|' order by i.metric_id))
    from cosme_metrics.release_items i join cosme_metrics.releases r on r.id=i.release_id
    where r.project_key='COSME' and r.major=0 and r.minor=1),'V0.1 unchanged';
  assert not has_function_privilege('anon','public.cosme_metrics_get_picks(integer,integer)','execute'),'anon RPC denied';
  assert not has_function_privilege('anon','public.cosme_metrics_set_pick(integer,integer,text,boolean,integer)','execute'),'anon write denied';
  assert has_function_privilege('authenticated','public.cosme_metrics_get_picks(integer,integer)','execute'),'authenticated RPC granted';
  assert not has_table_privilege('authenticated','cosme_metrics.release_picks','select,insert,update,delete'),'no direct table access';
  assert not has_table_privilege('anon','cosme_metrics.pick_events','select,insert,update,delete'),'no direct audit access';
  -- Exercise the actual PostgREST roles as well as grant identities.
  execute 'set local role authenticated';
  result:=public.cosme_metrics_get_picks(2147483000,1);
  assert result->>'can_edit'='true','authenticated owner read';
  result:=public.cosme_metrics_set_pick(2147483000,1,'TEST-SHARED-CURRENT',true,2);
  assert result->>'revision'='3','authenticated owner write';
  begin
    perform 1 from cosme_metrics.release_picks;
    raise exception 'authenticated direct table read unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  execute 'set local role anon';
  begin
    perform public.cosme_metrics_get_picks(2147483000,1);
    raise exception 'anon execute unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
end
$test$;
rollback;
select 'Passed: shared selection, grants, conflicts, audit and immutable history; synthetic writes rolled back' as result;
