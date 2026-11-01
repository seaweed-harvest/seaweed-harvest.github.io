-- COSME Project Metrics: read-only timeline projection over existing, immutable releases.
-- Owner-approved 1 November 2026 timeline refinement, sourced personal reference and research-assistant milestones.
-- Dated technical events retain existing metric anchors. Earlier project, travel, and
-- prototype events come from reviewed Cascadia contract and time-log sources and have
-- explicit activity labels without claiming an unrelated metric anchor.
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

  with curated(start_date,end_date,event_type,metric_ids,event_title,event_summary,event_source,event_activity) as (
    values
    ('2025-03-11'::date,null::date,'Report',ARRAY['SDT-0026','SDT-0027']::text[],'COSME innovation report documented the baseline assessment','The March 2025 report documented earlier community assessment findings; it is not the field survey date.',null,null),
    ('2025-09-22'::date,null::date,'Deployment',ARRAY['ON-0041']::text[],'Early offshore nursery raft deployed at Mkwiro',null,null,null),
    ('2025-09-23'::date,null::date,'Inspection',ARRAY['ON-0067']::text[],'Early offshore raft inspected',null,null,null),
    ('2025-10-14'::date,null::date,'Installation',ARRAY['SDT-0044']::text[],'Shangani V1.1 dryer prototype installed','Confirmed by the October field-work invoice; the published metric separately confirms an October 2025 V1.1 installation.','Cascadia Invoice #9; Drying Tables Inspection/Installation report',null),
    ('2025-10-15'::date,null::date,'Pilot',ARRAY['SDT-0044']::text[],'Shangani drying-table pilot launched','Pilot launch followed installation on 14 October; monitoring handover followed on 16 October.','Cascadia Invoice #9',null),
    ('2026-01-16'::date,'2026-01-17'::date,'Installation',ARRAY['SDT-0045','SDT-0016']::text[],'Funzi Island V1.2 dryer prototype installed',null,null,null),
    ('2025-07-23'::date,null::date,'Travel',ARRAY[]::text[],'Bosun — arrived in Canada','The 23 July 2025 scheduled Japan Airlines flight arrived at Vancouver International at 11:40 local time. Included only as a personal reference date; not a COSME project deliverable or a shaded stay.','Japan Airlines JL018 flight itinerary, 23 July 2025; Bosun travel confirmation','Programme'),
    ('2025-11-26'::date,null::date,'Travel',ARRAY[]::text[],'Bosun — departed Canada','Air Canada boarding passes list 26 November 2025 Victoria–Vancouver and Vancouver–Brisbane departures. Personal reference only; not a COSME milestone.','Air Canada boarding passes for 26 November 2025, flights AC8170 and AC35','Programme'),
    ('2026-01-19'::date,null::date,'Inspection',ARRAY[]::text[],'January nursery raft inspection — Matt field visit','Raft inspection recorded for 19 January 2026 during Matt''s field visit. Exact raft identity, location and inspection findings still require reconciliation with the field report.','Bosun milestone confirmation, 1 November 2026 (field report pending)','Offshore Nursery'),
    ('2026-01-20'::date,null::date,'Deployment',ARRAY[]::text[],'January nursery raft installation and seeding','Raft installation and seeding recorded for 20 January 2026 during the January field visit. Exact raft identification, location and planting quantity are not yet confirmed in the reviewed sources.','Bosun milestone confirmation, 1 November 2026 (field report pending)','Offshore Nursery'),
    ('2026-02-07'::date,'2026-02-16'::date,'Trial',ARRAY[]::text[],'Funzi dryer RA cover and ventilation trials','Research assistants checked the unloaded Funzi V1.2 dryer from 7 to 16 February 2026 under different front-cover and rear-ventilation configurations. Temperature was sampled approximately at 06:00, 12:00 and 18:00; these were not loaded seaweed drying cycles.','COSME Solar Dryer Table Verification Report, October 2026, p. 4','Solar Drying Tables'),
    ('2026-02-10'::date,'2026-02-18'::date,'Trial',ARRAY[]::text[],'Shangani dryer RA cover and ventilation trials','Research assistants recorded temperatures at the unloaded Shangani V1.1 dryer from 10 to 18 February 2026, varying front-cover and rear-ventilation settings. These manual trials recorded temperature only, not continuous drying performance.','COSME Solar Dryer Table Verification Report, October 2026, p. 4','Solar Drying Tables'),
    ('2026-03-17'::date,null::date,'Design',ARRAY['SDT-0042']::text[],'V1.3 dryer drawing reference dated',null,null,null),
    ('2026-06-22'::date,null::date,'Assessment',ARRAY['MAW-0012','MAW-0013']::text[],'Mawimbi processing baseline assessed',null,null,null),
    ('2026-06-30'::date,null::date,'Site selection',ARRAY['SDT-0046','SDT-0047','SDT-0048','SDT-0049']::text[],'V1.3 dryer production sites allocated','Recorded allocation across Bati, Yungi, Shangani and Funzi; a site-selection milestone is not proof that every unit was installed.',null,null),
    ('2026-07-06'::date,null::date,'Inspection',ARRAY['ON-0040']::text[],'Earlier offshore raft inspected','Inspection of the earlier mechanically jointed raft; this is not the later Living Machines deployment.',null,null),
    ('2026-07-15'::date,null::date,'Repair',ARRAY['ON-0040']::text[],'V1.1 nursery raft recovered for repair','The earlier mechanically jointed V1.1 nursery raft was recovered on 15 July 2026 for repair. A later redeployment is separately noted in task records, but an exact redeployment date has not been verified.',null,null),
    ('2026-07-21'::date,null::date,'Monitoring',ARRAY['SDT-0052']::text[],'Bati drying-table temperature monitoring recorded',null,null,null),
    ('2026-07-24'::date,null::date,'Decision',ARRAY['AGH-0021','AGH-0022']::text[],'Bati aggregation-hub site selection documented','Selection decision recorded in the 24 July meeting minutes; it is not a commissioning milestone.',null,null),
    ('2026-08-04'::date,null::date,'Consultation',ARRAY['AGH-0058']::text[],'Aggregation commercial stakeholder consultation',null,null,null),
    ('2026-08-25'::date,null::date,'Deployment',ARRAY['ON-0036']::text[],'Two Living Machines nursery rafts deployed at Mkwiro','Both installation reports identify 25 August 2026, rather than the approximate 24 August reference.',null,null),
    ('2026-08-26'::date,null::date,'Design',ARRAY['AGH-0024']::text[],'Baler technical requirements issued',null,null,null),
    ('2026-08-31'::date,null::date,'Procurement',ARRAY['AGH-0025']::text[],'Baler purchase order buyer-acceptance dated','The recorded buyer-acceptance date does not prove supplier signature, fabrication completion or payment.',null,null),
    ('2026-09-14'::date,null::date,'Testing',ARRAY['AGH-0061','AGH-0036']::text[],'Factory bale mass reported near 100 kg','Engineering meeting notes report the factory bale; a signed, complete FAT and site SAT were not verified.',null,null),
    ('2026-09-18'::date,null::date,'Proposal',ARRAY['MAW-0041']::text[],'G2W powered-press proposal issued','The proposal date does not establish installation or commissioning.',null,null),
    ('2026-09-22'::date,null::date,'Agreement',ARRAY['MAW-0003']::text[],'Cascadia–Mawimbi MOU effective',null,null,null),
    ('2026-10-02'::date,null::date,'Installation',ARRAY['MAW-0044','MAW-0037']::text[],'Mawimbi RO installation recorded','The water-verification chronology records 2 October; another worksheet has an inconsistent 2 September reference.',null,null),
    ('2026-10-19'::date,'2026-10-21'::date,'Training',ARRAY['ON-0039']::text[],'Tumbe nursery practical sessions documented','Dated practical sessions do not establish permanent commissioning or a measured growth series.',null,null),
    ('2025-05-03'::date,null::date,'Contract',ARRAY[]::text[],'Bosun — COSME contractor agreement signed','Completed Cascadia independent-contractor agreement circulated on 3 May. This is the agreement milestone, not the first time-logged engineering work.','Cascadia completed contractor agreement email, 3 May 2025','Programme'),
    ('2025-05-19'::date,null::date,'Planning',ARRAY[]::text[],'Bosun — COSME engineering work began','First dated time-log entry was project familiarisation and reading, preceding later requirements development.','2025 Cascadia Work Log, 19 May 2025','Programme'),
    ('2025-05-21'::date,null::date,'Meeting',ARRAY[]::text[],'Initial Cascadia requirements meeting','Cascadia team meeting and development of nursery and drying-station requirements. Recorded working kickoff; not labelled a formal COSME programme inception.','2025 Cascadia Work Log, 21 May 2025','Programme'),
    ('2025-05-30'::date,null::date,'Report',ARRAY[]::text[],'COSME innovations work plan dated','Innovations plan documented the early scope and June stakeholder-consultation intentions; planned June meetings are not counted as completed.','COSME Seaweed Innovations Plan v1, 30 May 2025','Programme'),
    ('2025-08-06'::date,null::date,'Design',ARRAY[]::text[],'Drying-rack concepts developed in Victoria','On-site office design discussion with Jenn and Matt and preparation of a procurement list for the first rack prototypes.','2025 Cascadia Work Log, 6 August 2025','Solar Drying Tables'),
    ('2025-08-13'::date,null::date,'Prototype',ARRAY[]::text[],'First drying-rack frame and screen trial','Two frames built and trialled with rope and screen; the logged test found instability and torsion problems. A Victoria prototype, not a Kenya installation.','2025 Cascadia Work Log, 13 August 2025','Solar Drying Tables'),
    ('2025-09-15'::date,null::date,'Fabrication',ARRAY[]::text[],'Bosun — aluminium trestle prototype built','Time log records assembling the trestle-frame setup in Victoria ahead of the Kenya field mission.','2025 Cascadia Work Log, 15 September 2025','Solar Drying Tables'),
    ('2025-09-18'::date,'2025-10-18'::date,'Travel',ARRAY[]::text[],'Bosun — Kenya field mission (2025 travel dates)','Departed Victoria on 18 September and returned to Victoria on 18 October. These are travel endpoints, not independently verified Kenya border entry and exit dates.','2025 Cascadia Work Log, field trip travel summary','Programme'),
    ('2025-09-21'::date,null::date,'Fieldwork',ARRAY[]::text[],'Bosun — first logged Mkwiro visit','First dated in-country field-work entry includes Mkwiro transit, seaweed-farm, raft and anchor inspection and COSME team contact. Arrival date not inferred.','2025 Cascadia Work Log, 21 September 2025','Offshore Nursery'),
    ('2025-10-16'::date,null::date,'Handover',ARRAY['SDT-0044']::text[],'Shangani pilot monitoring handover','The documented handover followed installation on 14 October and pilot launch on 15 October.','October 2025 Cascadia field-work invoice and work log','Solar Drying Tables'),
    ('2026-02-04'::date,null::date,'Prototype',ARRAY[]::text[],'Bosun — Perth dryer test-bed built','Work log records the backyard test-table frame build and discussion of monitoring instructions with Lilian.','Cascadia Notion Time Log, 4 February 2026','Solar Drying Tables'),
    ('2026-03-03'::date,'2026-03-11'::date,'Trial',ARRAY['SDT-0054','SDT-0055']::text[],'Perth temperature and humidity trial','A dated Perth logger/control comparison period; the metrics document analysis of the recorded temperature and VPD, not a Kenya field installation.','Seaweed Station ST-0103; 3–11 March 2026','Solar Drying Tables'),
    ('2026-06-19'::date,'2026-07-29'::date,'Travel',ARRAY[]::text[],'Bosun — Kenya field mission (2026 travel dates)','Perth departure flight logged on 19 June; arrival back in Perth early 29 July. These endpoints are travel days, not exact Kenya border entry/exit dates.','Cascadia Notion time log, June–July 2026','Programme'),
    ('2026-10-20'::date,null::date,'Travel',ARRAY[]::text[],'Bosun — departed Perth for Kenya mission','Departed Perth via Singapore on 20 October. This is a travel-start date; arrival in Mombasa was logged separately on 21 October.','Cascadia Notion Time Log, 20 October 2026','Programme'),
    ('2026-10-21'::date,null::date,'Travel',ARRAY[]::text[],'Bosun — arrived in Mombasa','Notion time log records arrival in Mombasa and a visit to Joseph’s workshop. This is an arrival date, not the full mission duration.','Cascadia Notion Time Log, 21 October 2026','Programme'),
    ('2026-10-22'::date,null::date,'Meeting',ARRAY[]::text[],'COSME conference and closeout presentation','Notion time log records a conference, presentation and closeout session on 22 October; this was a major programme event, not a routine meeting.','Cascadia Notion Time Log, 22 October 2026','Programme')
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'start_date', e.start_date::text,
        'end_date', e.end_date::text,
        'type', e.event_type,
        'activity', coalesce(e.event_activity,anchor.frozen_payload->>'activity','Programme'),
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
  left join cosme_metrics.metrics metric
    on metric.project_key = 'COSME'
    and metric.human_id = e.metric_ids[1]
  left join cosme_metrics.release_items anchor
    on anchor.project_key = 'COSME'
    and anchor.release_id = project.current_release_id
    and anchor.metric_id = metric.id
  where cardinality(e.metric_ids)=0 or anchor.metric_id is not null;

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
