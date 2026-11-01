-- Add private, stable package identifiers to the existing COSME grant-checked Finance response.
-- No new table access, financial mutation or RLS change.
create or replace function public.cosme_finance_read()
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare
  v_role text := cosme_metrics.caller_role();
begin
  if (select auth.uid()) is null or v_role is null or v_role not in ('owner','editor','reader') then
    raise exception 'COSME Metrics access required' using errcode='42501';
  end if;
  return jsonb_build_object(
    'sources',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',s.id,'display_name',s.display_name,'source_kind',s.source_kind,
        'source_date',s.source_date,'revision',s.revision,
        'source_url',s.source_url) order by s.display_name),'[]'::jsonb)
      from cosme_metrics.finance_sources s
      where s.project_key='COSME' and exists(
        select 1 from cosme_metrics.finance_packages p
        where p.source_id=s.id and p.publication_status='published'
          and p.project_key='COSME'
      )
    ),
    'packages',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',p.id,'source_id',p.source_id,'package_key',p.package_key,'activity',p.activity,
        'version',p.version,'basis',p.basis,'currency',p.currency,
        'units_covered',p.units_covered,'unit_label',p.unit_label,
        'funding_scope',p.funding_scope,'control_total',p.control_total,
        'reconciliation_status',p.reconciliation_status
      ) order by p.display_order,p.activity,p.version),'[]'::jsonb)
      from cosme_metrics.finance_packages p
      where p.project_key='COSME' and p.publication_status='published'
    ),
    'lines',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',l.id,'package_id',l.package_id,'source_row',l.source_row,
        'entry_date',l.entry_date,'category',l.category,'subcategory',l.subcategory,
        'description',l.description,'quantity',l.quantity,'unit',l.unit,
        'unit_rate',l.unit_rate,'rate_currency',l.rate_currency,'amount',l.amount,'funding_org',l.funding_org,
        'included_in_total',l.included_in_total,
        'reconciliation_status',l.reconciliation_status,'note',l.note
      ) order by l.source_row),'[]'::jsonb)
      from cosme_metrics.finance_lines l
      join cosme_metrics.finance_packages p on p.id=l.package_id
      where p.project_key='COSME' and p.publication_status='published'
    )
  );
end
$function$;
revoke all on function public.cosme_finance_read() from public,anon;
grant execute on function public.cosme_finance_read() to authenticated;
comment on function public.cosme_finance_read() is
  'Read-only, COSME Metrics-grant-gated finance source package and evidence feed. No transactions are modified.';
notify pgrst,'reload schema';
