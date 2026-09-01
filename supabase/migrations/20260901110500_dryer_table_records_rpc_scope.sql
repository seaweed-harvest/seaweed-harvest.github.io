revoke execute on function public.list_authenticated_seaweed_drying_ledger(text, integer) from authenticated;

comment on function public.list_authenticated_seaweed_drying_ledger(text, integer) is
  'Read-only COSME protected-owner dryer ledger. Invoked through the dryer project anon API role because the accepted account token belongs to the separate Seaweed Harvest account project; the function validates that foreign token and owner/COSME permissions before returning rows. Performs no data mutations.';
