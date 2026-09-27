begin;
-- A complete indivisible group must be attributed in a single transaction/award.
create function dao_private.check_award_group() returns trigger
language plpgsql security definer set search_path='' as $$
declare aid uuid; bad boolean;
begin
 aid := case when TG_OP='DELETE' then OLD.award_id else NEW.award_id end;
 select exists(
   select 1 from public.award_items ai
   join public.bid_group_items gi on gi.bid_item_id=ai.bid_item_id
   join public.bid_groups g on g.id=gi.group_id
   where ai.award_id=aid and ai.active and g.indivisible
   and exists(select 1 from public.bid_group_items required
     where required.group_id=g.id and not exists(
       select 1 from public.award_items selected
       where selected.award_id=aid and selected.active and selected.bid_item_id=required.bid_item_id))
 ) into bad;
 if bad then raise exception 'indivisible_bid_group_incomplete' using errcode='23514'; end if;
 return null;
end $$;
create constraint trigger award_group_complete after insert or update or delete on public.award_items
deferrable initially deferred for each row execute function dao_private.check_award_group();

-- Link identities cannot be silently moved to another award; deactivation remains possible.
create function dao_private.lock_award_identity() returns trigger language plpgsql set search_path='' as $$
begin
 if row(NEW.award_id,NEW.project_id,NEW.contractor_id,NEW.request_id,NEW.bid_item_id)
    is distinct from row(OLD.award_id,OLD.project_id,OLD.contractor_id,OLD.request_id,OLD.bid_item_id)
 then raise exception 'award_identity_immutable' using errcode='23514'; end if;
 return NEW;
end $$;
create trigger award_identity before update on public.award_items for each row execute function dao_private.lock_award_identity();

create function dao_private.lock_submitted_version() returns trigger language plpgsql set search_path='' as $$
begin
 if OLD.submitted_at is not null then
   if TG_OP='DELETE' then raise exception 'submitted_version_immutable' using errcode='23514'; end if;
   if (to_jsonb(NEW)-'status'-'validity') is distinct from (to_jsonb(OLD)-'status'-'validity')
   then raise exception 'submitted_version_immutable' using errcode='23514'; end if;
 end if;
 if TG_OP='DELETE' then return OLD; end if;
 return NEW;
end $$;
create trigger submitted_version_immutable before update or delete on public.bid_versions
for each row execute function dao_private.lock_submitted_version();

create function dao_private.lock_bid_children() returns trigger
language plpgsql security definer set search_path='' as $$
declare oldv uuid; newv uuid;
begin
 if TG_OP<>'INSERT' then oldv:=OLD.bid_version_id; end if;
 if TG_OP<>'DELETE' then newv:=NEW.bid_version_id; end if;
 if exists(select 1 from public.bid_versions where id in (oldv,newv) and submitted_at is not null)
 then raise exception 'submitted_bid_content_immutable' using errcode='23514'; end if;
 if TG_OP='DELETE' then return OLD; end if;
 return NEW;
end $$;
create trigger immutable_bid_items before insert or update or delete on public.bid_items for each row execute function dao_private.lock_bid_children();
create trigger immutable_bid_groups before insert or update or delete on public.bid_groups for each row execute function dao_private.lock_bid_children();
create trigger immutable_bid_group_items before insert or update or delete on public.bid_group_items for each row execute function dao_private.lock_bid_children();
-- Document status may change after malware scanning; parent, path and identity may not.
create function dao_private.lock_bid_document() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='UPDATE' and (to_jsonb(NEW)-'status') is distinct from (to_jsonb(OLD)-'status')
 then raise exception 'bid_document_identity_immutable' using errcode='23514'; end if;
 return NEW;
end $$;
create trigger immutable_bid_document before update on public.bid_documents for each row execute function dao_private.lock_bid_document();
revoke all on function dao_private.check_award_group(),dao_private.lock_award_identity(),dao_private.lock_submitted_version(),dao_private.lock_bid_children(),dao_private.lock_bid_document() from public,anon,authenticated;
-- Fail closed even for privileged inserts: current, submitted, unexpired offer only.
create function dao_private.check_award_eligibility() returns trigger
language plpgsql security definer set search_path='' as $$
declare v public.bid_versions; a public.awards;
begin
 if NEW.active and (TG_OP='INSERT' or not OLD.active) then
  select bv.* into v from public.bid_versions bv join public.bid_items bi on bi.bid_version_id=bv.id
  where bi.id=NEW.bid_item_id for share of bv;
  if not found then raise exception 'unknown_bid_item' using errcode='23503'; end if;
  if v.status<>'submitted' or v.submitted_at is null or v.validity<>'current' or v.expires_at<=now()
  then raise exception 'bid_not_awardable' using errcode='23514'; end if;
  select * into a from public.awards where id=NEW.award_id for share;
  if not found then raise exception 'unknown_award' using errcode='23503'; end if;
  if a.status not in ('confirmed','contracting') then raise exception 'award_not_active' using errcode='23514'; end if;
 end if;
 return NEW;
end $$;
create trigger award_eligibility before insert or update on public.award_items for each row execute function dao_private.check_award_eligibility();
revoke all on function dao_private.check_award_eligibility() from public,anon,authenticated;
-- Disjoint object namespaces: offer files cannot be accidentally granted as project files.
alter table public.documents add constraint project_object_namespace check(object_path like 'project/' || project_id::text || '/%');
alter table public.bid_documents add constraint bid_object_namespace check(object_path like 'bid/' || bid_version_id::text || '/%');
alter table public.portfolio_assets add constraint portfolio_object_namespace check(object_path like 'portfolio/' || portfolio_project_id::text || '/%');
commit;
