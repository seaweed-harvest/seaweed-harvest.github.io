begin;

-- Supabase default function privileges may grant EXECUTE directly to anon.
-- Keep owner deletion authenticated-only even where the primary migration has
-- already been applied.
revoke execute on function public.ag_reef_records_workspace_delete(text, uuid) from anon;

commit;
