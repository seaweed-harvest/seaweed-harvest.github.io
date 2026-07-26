begin;

drop policy if exists "ag authorised read collection farmer allocations"
  on public.ag_collection_farmer_allocations;
create policy "ag authorised read collection farmer allocations"
on public.ag_collection_farmer_allocations
for select
to authenticated
using (
  (
    public.ag_user_has_aggregator_access(aggregator_id, (select auth.uid()))
    and (
      public.ag_has_permission('can_view_data')
      or public.ag_has_permission('can_edit_collections')
      or public.ag_has_permission('can_view_finance')
    )
  )
  or farmer_record_id = (
    select profile.farmer_record_id
    from public.ag_user_profiles profile
    where profile.id = (select auth.uid())
      and profile.account_status = 'active'
  )
);

notify pgrst, 'reload schema';

commit;
