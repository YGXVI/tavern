-- Аудит #57 (TASK-035): вспомогательные списки токенов без проверки членства.
-- visible_token_ids был доступен любому вошедшему: можно было перечислить видимые токены чужой кампании.
-- Обе функции нужны только охранникам (security definer) — прямой вызов закрыт, членство проверяется внутри.
create or replace function public.hero_token_ids(c text)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(t.id), '{}') from public.tokens t where t.campaign_id = c and t.character_id is not null and public.is_member(c);
$$;
create or replace function public.visible_token_ids(c text)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(t.id), '{}') from public.tokens t where t.campaign_id = c and not t.hidden and public.is_member(c);
$$;
revoke execute on function public.hero_token_ids(text), public.visible_token_ids(text) from public, anon, authenticated;
