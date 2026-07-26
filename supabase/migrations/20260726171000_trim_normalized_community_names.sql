begin;

create or replace function public.ag_normalize_community_name(p_name text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select btrim(
    lower(
      regexp_replace(
        regexp_replace(trim(coalesce(p_name, '')), '[^[:alnum:]]+', ' ', 'g'),
        '\s+',
        ' ',
        'g'
      )
    )
  );
$$;

revoke all on function public.ag_normalize_community_name(text) from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
