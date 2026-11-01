-- COSME Project Metrics: read-only timeline projection over existing, immutable releases.
-- Owner approved implementation 1 November 2026; separate production apply approval is required.
-- Each event is anchored to existing, published metric IDs. Dates and presentation labels
-- are curated from the frozen metric sources (and for Shangani, October invoice #9).
-- No milestone records, new tables, RLS changes or release writes are introduced.
create or replace function public.cosme_metrics_timeline()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $function$
declare
  v_role text := cosme_metrics.caller_role();
  v_events jsonb;
begin
  if (select auth.uid()) is null or v_role is null then
    raise exception 'Metrics access denied' using errcode = '42501';
  end if;

  with curated(start_date,end_date,event_type,metric_ids,event_title,event_summary,event_source) as (
    values
    ('2025-03-11'::date,null::date,'Report',ARRAY['SDT-0026','SDT-0027']::text[],'COSME innovation report documented the baseline assessment','The March 2025 report documented earlier community assessment findings; it is not the field survey date.',null),
    ('2025-09-22'::date,null::date,'Deployment',ARRAY['ON-0041']::text[],'Early offshore nursery raft deployed at Mkwiro',null,null),
    ('2025-09-23'::date,null::date,'Inspection',ARRAY['ON-0067']::text[],'Early offshore raft inspected',null,null),
    ('2025-10-14'::date,null::date,'Installation',ARRAY['SDT-0044']::text[],'Shangani V1.1 dryer prototype installed','Confirmed by the October field-work invoice; the published metric separately confirms an October 2025 V1.1 installation.','Cascadia Invoice #9; Drying Tables Inspection/Installation report'),
    ('2025-10-15'::date,null::date,'Pilot',ARRAY['SDT-0044']::text[],'Shangani drying-table pilot launched','Pilot launch followed installation on 14 October; monitoring handover followed on 16 October.','Cascadia Invoice #9'),
    ('2026-01-16'::date,'2026-01-17'::date,'Installation',ARRAY['SDT-0045','SDT-0016']::text[],'Funzi Island V1.2 dryer prototype installed',null,null),
    ('2026-03-17'::date,null::date,'Design',ARRAY['SDT-0042']::text[],'V1.3 dryer drawing reference dated',null,null),
    ('2026-06-22'::date,null::date,'Assessment',ARRAY['MAW-0012','MAW-0013']::text[],'Mawimbi processing baseline assessed',null,null),
    ('2026-06-30'::date,null::date,'Site selection',ARRAY['SDT-0046','SDT-0047','SDT-0048','SDT-0049']::text[],'V1.3 dryer production sites allocated','Recorded allocation across Bati, Yungi, Shangani and Funzi; a site-selection milestone is not proof that every unit was installed.',null),
    ('2026-07-06'::date,null::date,'Inspection',ARRAY['ON-0040']::text[],'Earlier offshore raft inspected','Inspection of the earlier mechanically jointed raft; this is not the later Living Machines deployment.',null),
    ('2026-07-15'::date,null::date,'Repair',ARRAY['ON-0040']::text[],'Earlier raft recovered for repair','Recovery and repair are evidenced separately from the initial 2025 deployment.',null),
    ('2026-07-21'::date,null::date,'Monitoring',ARRAY['SDT-0052']::text[],'Bati drying-table temperature monitoring recorded',null,null),
    ('2026-07-24'::date,null::date,'Decision',ARRAY['AGH-0021','AGH-0022']::text[],'Bati aggregation-hub site selection documented','Selection decision recorded in the 24 July meeting minutes; it is not a commissioning milestone.',null),
    ('2026-08-04'::date,null::date,'Consultation',ARRAY['AGH-0058']::text[],'Aggregation commercial stakeholder consultation',null,null),
    ('2026-08-25'::date,null::date,'Deployment',ARRAY['ON-0036']::text[],'Two Living Machines nursery rafts deployed at Mkwiro','Both installation reports identify 25 August 2026, rather than the approximate 24 August reference.',null),
    ('2026-08-26'::date,null::date,'Design',ARRAY['AGH-0024']::text[],'Baler technical requirements issued',null,null),
    ('2026-08-31'::date,null::date,'Procurement',ARRAY['AGH-0025']::text[],'Baler purchase order buyer-acceptance dated','The recorded buyer-acceptance date does not prove supplier signature, fabrication completion or payment.',null),
    ('2026-09-14'::date,null::date,'Testing',ARRAY['AGH-0061','AGH-0036']::text[],'Factory bale mass reported near 100 kg','Engineering meeting notes report the factory bale; a signed, complete FAT and site SAT were not verified.',null),
    ('2026-09-18'::date,null::date,'Proposal',ARRAY['MAW-0041']::text[],'G2W powered-press proposal issued','The proposal date does not establish installation or commissioning.',null),
    ('2026-09-22'::date,null::date,'Agreement',ARRAY['MAW-0003']::text[],'Cascadia–Mawimbi MOU effective',null,null),
    ('2026-10-02'::date,null::date,'Installation',ARRAY['MAW-0044','MAW-0037']::text[],'Mawimbi RO installation recorded','The water-verification chronology records 2 October; another worksheet has an inconsistent 2 September reference.',null),
    ('2026-10-19'::date,'2026-10-21'::date,'Training',ARRAY['ON-0039']::text[],'Tumbe nursery practical sessions documented','Dated practical sessions do not establish permanent commissioning or a measured growth series.',null)
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'start_date', e.start_date::text,
        'end_date', e.end_date::text,
        'type', e.event_type,
        'activity', anchor.frozen_payload->>'activity',
        'title', e.event_title,
        'summary', coalesce(e.event_summary,
          left(nullif(anchor.frozen_payload->>'note',''), 420)),
        'source_label', coalesce(e.event_source,
          nullif(anchor.frozen_payload->>'source',''),
          'COSME Metrics register'),
        'source_url', null,
        'metrics', (
          select coalesce(jsonb_agg(
            jsonb_build_object('id', related.human_id,
              'title', coalesce(nullif(ri.frozen_payload->>'title',''),
                related.human_id))
            order by ids.position
          ), '[]'::jsonb)
          from unnest(e.metric_ids) with ordinality as ids(human_id,position)
          join cosme_metrics.metrics related
            on related.project_key = 'COSME' and related.human_id = ids.human_id
          join cosme_metrics.release_items ri
            on ri.project_key = 'COSME'
            and ri.release_id = project.current_release_id
            and ri.metric_id = related.id
        )
      ) order by e.start_date, e.event_title
    ), '[]'::jsonb
  ) into v_events
  from curated e
  join cosme_metrics.projects project
    on project.project_key = 'COSME'
    and project.enabled
    and project.current_release_id is not null
  join cosme_metrics.metrics metric
    on metric.project_key = 'COSME'
    and metric.human_id = e.metric_ids[1]
  join cosme_metrics.release_items anchor
    on anchor.project_key = 'COSME'
    and anchor.release_id = project.current_release_id
    and anchor.metric_id = metric.id;

  return jsonb_build_object('can_view',true,'milestones',v_events);
end
$function$;

-- SECURITY DEFINER must never be available to anonymous or PUBLIC callers.
revoke all on function public.cosme_metrics_timeline()
  from public, anon, authenticated;
grant execute on function public.cosme_metrics_timeline()
  to authenticated;
comment on function public.cosme_metrics_timeline() is
  'Read-only curated timeline projection of the current, authorised COSME Metrics release.';
notify pgrst, 'reload schema';
