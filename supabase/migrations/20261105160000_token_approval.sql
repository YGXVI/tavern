-- Все новые токены игрока — заявки. Обычные guard_token/RLS продолжают проверять владение и вид.
-- Не меняет существующие токены; не расширяет права на создание.
create or replace function public.guard_token_approval()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.is_master(new.campaign_id) then return new; end if;
  if exists (select 1 from public.tokens t where t.campaign_id = new.campaign_id
      and t.id in (new.data ->> 'summonedBy', new.data ->> 'riding')
      and t.data -> 'pending' = 'true'::jsonb) then
    raise exception 'Сначала дождитесь разрешения мастера на этот токен' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.data := jsonb_set(new.data, '{pending}', 'true'::jsonb);
  elsif old.data -> 'pending' = 'true'::jsonb then
    raise exception 'Токен ждёт разрешения мастера; можно только отменить запрос' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_token_approval() from public, anon, authenticated;
-- Идёт до tokens_guard (PostgreSQL сортирует BEFORE-триггеры по имени).
create trigger tokens_approval before insert or update on public.tokens
for each row execute function public.guard_token_approval();

create or replace function public.guard_token_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or public.is_master(old.campaign_id) then return old; end if;
  if not exists (select 1 from public.scenes s where s.id = old.scene_id) or not exists (select 1 from public.campaigns c where c.id = old.campaign_id) then return old; end if;
  if old.character_id is not null and exists (
    select 1 from public.character_operations o where o.campaign_id = old.campaign_id
      and o.character_id = old.character_id and o.caller_id = auth.uid()
      and o.kind = 'archive' and o.transaction_id = txid_current() and o.response is null
  ) then return old; end if;
  if old.data -> 'pending' = 'true'::jsonb and public.owns_token(old) then return old; end if;
  if old.character_id is not null or not public.owns_token(old) then raise exception 'Удаляет мастер' using errcode = '42501'; end if;
  return old;
end $$;
