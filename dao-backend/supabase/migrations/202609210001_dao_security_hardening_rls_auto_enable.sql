-- Internal event trigger: never expose it through the Data API.
revoke execute on function public.rls_auto_enable() from anon, authenticated;
grant execute on function public.rls_auto_enable() to postgres, service_role;
