-- Наложения эффектов (#193, §7 плана): строка на одно временное наложение на существе. В базе лежат причины, а не итоги.
-- target — существо (персонаж или токен), cast_id — нить концентрации: рвётся, и снимаются все строки разом.
-- visible = false — тайное мастера: игрок видит только итог (решение YGXVI 07.11).
create table public.effects (
  id text primary key check (length(id) between 3 and 64),
  campaign_id text not null references public.campaigns (id) on delete cascade,
  target text not null check (length(target) between 1 and 80),
  ref text not null check (length(ref) between 1 and 120),
  cast_id text,
  by uuid references public.profiles (id) on delete set null default auth.uid(),
  visible boolean not null default true,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 16384),
  created_at timestamptz not null default now()
);
create index effects_campaign on public.effects (campaign_id);
create index effects_cast on public.effects (campaign_id, cast_id);

alter table public.effects enable row level security;
create policy effects_read on public.effects for select to authenticated
  using (public.is_master(campaign_id) or (public.is_member(campaign_id) and (visible or by = (select auth.uid()))));
create policy effects_insert on public.effects for insert to authenticated
  with check (public.is_master(campaign_id) or (public.is_member(campaign_id) and by = (select auth.uid()) and visible));
create policy effects_update on public.effects for update to authenticated
  using (public.is_master(campaign_id) or (public.is_member(campaign_id) and by = (select auth.uid())))
  with check (public.is_master(campaign_id) or (public.is_member(campaign_id) and by = (select auth.uid()) and visible));
-- Снять может ещё и хозяин цели: заклинание на моём герое я вправе не терпеть.
create policy effects_delete on public.effects for delete to authenticated
  using (public.is_master(campaign_id) or (public.is_member(campaign_id) and (by = (select auth.uid()) or (visible and exists (
    select 1 from public.characters c where c.id = target and c.campaign_id = effects.campaign_id and c.owner_id = (select auth.uid()))))));
revoke all on public.effects from public, anon, authenticated;
grant select, insert, update, delete on public.effects to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'effects') then
    alter publication supabase_realtime add table public.effects;
  end if;
end $$;
