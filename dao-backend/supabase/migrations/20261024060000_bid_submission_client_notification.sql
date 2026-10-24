-- #175 BUG-07: inform the Client once when a submitted offer becomes effective.
-- The existing outbox worker delivers the email later; offer submission never calls Resend.
-- The event key includes the immutable bid version ID and is unique per recipient.
begin;

create or replace function dao_private.notify_client_on_bid_submission()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_title text;
begin
  if new.status='submitted' and old.status is distinct from 'submitted' then
    select p.safe_title into v_title
      from public.publications p where p.id=new.publication_id;
    perform dao_private.queue_project_notice(
      'bid_submitted:' || new.id::text,
      new.project_id,
      'bid_submitted',
      jsonb_build_object(
        'title', coalesce(v_title,'Chantier'),
        'publication_id', new.publication_id::text
      )
    );
  end if;
  return new;
end;
$$;

create trigger bid_submission_client_notice
  after update of status on public.bid_versions
  for each row
  when (old.status is distinct from new.status and new.status='submitted')
  execute function dao_private.notify_client_on_bid_submission();

commit;
