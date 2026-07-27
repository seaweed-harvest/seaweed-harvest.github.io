begin;

alter function public.ag_public_form_entry_context(text, text, text)
  volatile;

notify pgrst, 'reload schema';

commit;
