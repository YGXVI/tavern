-- «Мои герои» на сервере (#202, DEC-019 D1): личные герои вне кампаний. Видит и правит только владелец.
-- Браузер держит копию для работы без сети; строка здесь — то, что переживает смену устройства.
create table public.heroes (
  id text primary key check (char_length(id) between 1 and 64),
  owner_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 524288),
  archived_at timestamptz,
  updated_at timestamptz not null default now()
);
create index heroes_owner on public.heroes(owner_id);

alter table public.heroes enable row level security;
create policy heroes_read on public.heroes for select to authenticated using (owner_id = (select auth.uid()));
create policy heroes_insert on public.heroes for insert to authenticated with check (owner_id = (select auth.uid()));
create policy heroes_update on public.heroes for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
revoke all on public.heroes from public, anon, authenticated;
grant select, insert, update on public.heroes to authenticated;

-- Лимит: 100 героев на человека, удалённые считаются. Время правки ставит база.
create function public.heroes_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and (select count(*) from public.heroes where owner_id = new.owner_id) >= 100 then
    raise exception 'Героев слишком много' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.heroes_guard() from public, anon, authenticated;
create trigger heroes_guard before insert or update on public.heroes for each row execute function public.heroes_guard();
