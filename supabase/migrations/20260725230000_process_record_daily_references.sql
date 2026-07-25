begin;

create or replace function public.ag_process_record_form_context(
  p_process_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_aggregator_id uuid;
  v_process_date date := coalesce(
    p_process_date,
    (now() at time zone 'Africa/Nairobi')::date
  );
  v_received_total_kg numeric;
  v_pressed_liquid_total_l numeric;
begin
  perform public.ag_require_permission('can_submit_collection');
  v_aggregator_id := public.ag_require_active_aggregator();

  select coalesce(sum(collection.sack_weight_kg), 0)
  into v_received_total_kg
  from public.collections collection
  where collection.aggregator_id = v_aggregator_id
    and (collection.collected_at at time zone 'Africa/Nairobi')::date = v_process_date;

  select coalesce(sum(
    case
      when stock.weight_unit = 'L' then stock.weight_value
      when stock.weight_unit = 'mL' then stock.weight_value / 1000
      else 0
    end
  ), 0)
  into v_pressed_liquid_total_l
  from public.ag_stabilization_packing_records stock
  where stock.aggregator_id = v_aggregator_id
    and stock.packed_on = v_process_date
    and stock.record_type = 'initial'
    and stock.weight_unit in ('L', 'mL');

  return jsonb_build_object(
    'process_date', v_process_date,
    'next_record_number', public.ag_next_process_record_number(v_aggregator_id),
    'received_seaweed_total_kg', v_received_total_kg,
    'pressed_liquid_total_l', v_pressed_liquid_total_l
  );
end;
$$;

revoke all on function public.ag_process_record_form_context(date)
  from public, anon, authenticated;
grant execute on function public.ag_process_record_form_context(date)
  to authenticated;

notify pgrst, 'reload schema';

commit;
