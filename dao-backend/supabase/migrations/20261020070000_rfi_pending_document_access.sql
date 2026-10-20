begin;

-- The upload finalizer must be able to read the authenticated owner's pending
-- metadata before validating the private Storage object. The object itself
-- remains private and no other user can observe this quarantine row.
create policy rfi_documents_owner_quarantine
on public.technical_rfi_documents
for select to authenticated
using(owner_id=auth.uid() and status='quarantined');

notify pgrst,'reload schema';
commit;
