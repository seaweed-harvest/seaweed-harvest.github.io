-- Extend the active one-bay Dryer Shed submission backend to accept T6-T8.
-- Deliberately fail closed on unexpected function versions, preserving grants
-- and security definer settings. Apply to COSME dryer Supabase project ONLY.
do $migration$
declare
  v_function regprocedure := 'public.submit_seaweed_drying_observation(jsonb,text)'::regprocedure;
  v_definition text;
  v_updated text;
  v_oid oid;
  v_owner oid;
  v_acl aclitem[];
  v_security_definer boolean;
  v_config text[];
  v_after_oid oid;
  v_after_owner oid;
  v_after_acl aclitem[];
  v_after_security_definer boolean;
  v_after_config text[];
  v_location_fragment text := $fragment$
      ('bati-dryer-shed-t5', 'ST-0102', 'Dryer Shed - T5'),
      ('bati-dryer-shed', 'ST-0102', 'Dryer Shed'),
$fragment$;
  v_location_replacement text := $fragment$
      ('bati-dryer-shed-t5', 'ST-0102', 'Dryer Shed - T5'),
      ('bati-dryer-shed-t6', 'ST-0102', 'Dryer Shed - T6'),
      ('bati-dryer-shed-t7', 'ST-0102', 'Dryer Shed - T7'),
      ('bati-dryer-shed-t8', 'ST-0102', 'Dryer Shed - T8'),
      ('bati-dryer-shed', 'ST-0102', 'Dryer Shed'),
$fragment$;
  v_shed_list_fragment text := $fragment$    'bati-dryer-shed-t5'
  )$fragment$;
  v_shed_list_replacement text := $fragment$    'bati-dryer-shed-t5',
    'bati-dryer-shed-t6',
    'bati-dryer-shed-t7',
    'bati-dryer-shed-t8'
  )$fragment$;
  v_old_prompt text := 'Select Dryer Shed - T1, T2, T3, T4 or T5 for a new record';
  v_new_prompt text := 'Select Dryer Shed - T1 through T8 for a new record';
begin
  select p.oid, p.proowner, p.proacl, p.prosecdef, p.proconfig,
         pg_get_functiondef(p.oid)
    into v_oid, v_owner, v_acl, v_security_definer, v_config, v_definition
  from pg_proc p
  where p.oid = v_function::oid;

  if position('bati-dryer-shed-t6' in v_definition) > 0
     or position('bati-dryer-shed-t7' in v_definition) > 0
     or position('bati-dryer-shed-t8' in v_definition) > 0 then
    if position('bati-dryer-shed-t6' in v_definition) > 0
       and position('bati-dryer-shed-t7' in v_definition) > 0
       and position('bati-dryer-shed-t8' in v_definition) > 0 then
      return;
    end if;
    raise exception 'Dryer Shed T6-T8 function was partly migrated; refusing to continue';
  end if;

  if (length(v_definition) - length(replace(v_definition, v_location_fragment, '')))
       / length(v_location_fragment) <> 1 then
    raise exception 'Expected Dryer Shed T5 location fragment was not found exactly once';
  end if;

  if (length(v_definition) - length(replace(v_definition, v_shed_list_fragment, '')))
       / length(v_shed_list_fragment) <> 2 then
    raise exception 'Expected T5 shed validation list was not found exactly twice';
  end if;

  if (length(v_definition) - length(replace(v_definition, v_old_prompt, '')))
       / length(v_old_prompt) <> 1 then
    raise exception 'Expected T5-only prompt was not found exactly once';
  end if;

  v_updated := replace(v_definition, v_location_fragment, v_location_replacement);
  v_updated := replace(v_updated, v_shed_list_fragment, v_shed_list_replacement);
  v_updated := replace(v_updated, v_old_prompt, v_new_prompt);

  if position('bati-dryer-shed-t6' in v_updated) = 0
     or position('bati-dryer-shed-t7' in v_updated) = 0
     or position('bati-dryer-shed-t8' in v_updated) = 0 then
    raise exception 'Dryer Shed T6-T8 patch did not produce the expected function';
  end if;

  execute v_updated;

  select p.oid, p.proowner, p.proacl, p.prosecdef, p.proconfig
    into v_after_oid, v_after_owner, v_after_acl, v_after_security_definer, v_after_config
  from pg_proc p
  where p.oid = v_function::oid;

  if v_after_oid is distinct from v_oid
     or v_after_owner is distinct from v_owner
     or v_after_acl is distinct from v_acl
     or v_after_security_definer is distinct from v_security_definer
     or v_after_config is distinct from v_config then
    raise exception 'Dryer Shed function owner, grants or security settings changed unexpectedly';
  end if;
end;
$migration$;

notify pgrst, 'reload schema';
