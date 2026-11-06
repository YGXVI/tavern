-- Тайное мастера в сценах (аудит 04.11, #204; решение YGXVI 05.11 — вариант A, этап «сцены»).
-- Раньше любой участник читал через API все сцены кампании, заметку мастера, потайные двери и сложность замков.
--   scenes.revealed  — сцену видели игроки. Включается сама и не выключается: мастер сделал сцену текущей, отправил туда
--                      игрока или поставил на неё героя. Закрытые сцены, их токены, рисунки и туман игрокам не отдаются.
--   scene_hidden     — читает только мастер: {note, walls: {id: поля}}. Неоткрытая потайная дверь в публичной строке —
--                      обычная стена {id, a, b, kind: 'wall'}; сложность замка (lockDc) — только здесь.
-- Мастер пишет сцену целиком: клиент подставляет скрытое обратно, раскладку делает триггер. Дверь игрока — как раньше.

alter table public.scenes add column revealed boolean not null default false;

create table public.scene_hidden (
  scene_id text primary key,
  campaign_id text not null references public.campaigns(id) on delete cascade,
  data jsonb not null default '{}'::jsonb
);
create index scene_hidden_campaign on public.scene_hidden(campaign_id);
alter table public.scene_hidden enable row level security;
create policy scene_hidden_master_read on public.scene_hidden for select to authenticated using (public.is_master(campaign_id));
revoke all on public.scene_hidden from public, anon, authenticated;
grant select on public.scene_hidden to authenticated;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'scene_hidden') then
    alter publication supabase_realtime add table public.scene_hidden;
  end if;
end $$;

-- Данные сцены → {pub, sec}: что видят все и что только мастер.
create function public.scene_parts(d jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare w jsonb; walls jsonb := '[]'; hid jsonb := '{}'; sec jsonb := '{}'; pub jsonb := d;
begin
  if jsonb_typeof(d -> 'walls') = 'array' then
    for w in select value from jsonb_array_elements(d -> 'walls') loop
      if w ->> 'kind' = 'secret' and coalesce(w -> 'discovered', 'false'::jsonb) <> 'true'::jsonb then
        hid := hid || jsonb_build_object(w ->> 'id', w - array['id', 'a', 'b']);
        walls := walls || jsonb_build_array(jsonb_build_object('id', w -> 'id', 'a', w -> 'a', 'b', w -> 'b', 'kind', 'wall'));
      elsif w ? 'lockDc' then
        hid := hid || jsonb_build_object(w ->> 'id', jsonb_build_object('lockDc', w -> 'lockDc'));
        walls := walls || jsonb_build_array(w - 'lockDc');
      else walls := walls || jsonb_build_array(w);
      end if;
    end loop;
    pub := jsonb_set(pub, '{walls}', walls);
  end if;
  if hid <> '{}'::jsonb then sec := jsonb_build_object('walls', hid); end if;
  if coalesce(d ->> 'note', '') <> '' then sec := sec || jsonb_build_object('note', d -> 'note'); end if;
  return jsonb_build_object('pub', pub - 'note', 'sec', sec);
end $$;
revoke execute on function public.scene_parts(jsonb) from public, anon, authenticated;

create function public.scene_put_hidden(sid text, cid text, sec jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if sec = '{}'::jsonb then delete from public.scene_hidden where scene_id = sid;
  else
    insert into public.scene_hidden(scene_id, campaign_id, data) values (sid, cid, sec)
    on conflict (scene_id) do update set data = excluded.data where public.scene_hidden.data is distinct from excluded.data;
  end if;
end $$;
revoke execute on function public.scene_put_hidden(text, text, jsonb) from public, anon, authenticated;

-- Перенос уже созданных сцен: триггера раскладки ещё нет, раскладываем напрямую. Охранник сцены здесь выключен:
-- он пропускает только мастера, а миграция идёт без пользователя.
alter table public.scenes disable trigger scenes_guard;
do $$
declare s public.scenes; p jsonb;
begin
  for s in select * from public.scenes loop
    p := public.scene_parts(s.data);
    update public.scenes set data = p -> 'pub' where id = s.id;
    perform public.scene_put_hidden(s.id, s.campaign_id, p -> 'sec');
  end loop;
end $$;
update public.scenes s set revealed = true
where exists (select 1 from public.campaigns c where c.id = s.campaign_id and c.data ->> 'activeSceneId' = s.id)
   or exists (select 1 from public.campaign_members m where m.scene_id = s.id)
   or exists (select 1 from public.tokens t where t.scene_id = s.id and t.character_id is not null);
alter table public.scenes enable trigger scenes_guard;

create function public.scene_split() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p jsonb;
begin
  if tg_op = 'INSERT' then
    new.revealed := new.revealed or exists (select 1 from public.campaigns c where c.id = new.campaign_id and c.data ->> 'activeSceneId' = new.id);
  else new.revealed := old.revealed or (new.revealed and (auth.uid() is null or public.is_master(new.campaign_id))); end if;
  -- Дверь игрока и смена признака не трогают скрытое: раскладка — только когда мастер записал новые данные.
  if tg_op = 'UPDATE' and (new.data = old.data or not public.is_master(new.campaign_id)) then return new; end if;
  p := public.scene_parts(new.data);
  new.data := p -> 'pub';
  perform public.scene_put_hidden(new.id, new.campaign_id, p -> 'sec');
  return new;
end $$;
revoke execute on function public.scene_split() from public, anon, authenticated;
-- После scenes_guard: BEFORE-триггеры идут по имени.
create trigger scenes_split before insert or update on public.scenes for each row execute function public.scene_split();

create function public.scene_hidden_drop() returns trigger
language plpgsql security definer set search_path = '' as $$
begin delete from public.scene_hidden where scene_id = old.id; return null; end $$;
revoke execute on function public.scene_hidden_drop() from public, anon, authenticated;
create trigger scenes_hidden_drop after delete on public.scenes for each row execute function public.scene_hidden_drop();

-- Сцена открывается сама. Вызывается из триггеров: права проверены там, где меняют кампанию, участника и токен.
create function public.scene_reveal(sid text) returns void
language sql security definer set search_path = '' as $$
  update public.scenes set revealed = true where id = sid and not revealed;
$$;
revoke execute on function public.scene_reveal(text) from public, anon, authenticated;

create function public.scene_reveal_active() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.data ->> 'activeSceneId') is not null and (tg_op = 'INSERT' or (new.data ->> 'activeSceneId') is distinct from (old.data ->> 'activeSceneId')) then
    perform public.scene_reveal(new.data ->> 'activeSceneId');
  end if;
  return null;
end $$;
revoke execute on function public.scene_reveal_active() from public, anon, authenticated;
create trigger campaigns_reveal_scene after insert or update on public.campaigns for each row execute function public.scene_reveal_active();

create function public.scene_reveal_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.scene_id is not null and (tg_op = 'INSERT' or new.scene_id is distinct from old.scene_id) then perform public.scene_reveal(new.scene_id); end if;
  return null;
end $$;
revoke execute on function public.scene_reveal_member() from public, anon, authenticated;
create trigger members_reveal_scene after insert or update of scene_id on public.campaign_members for each row execute function public.scene_reveal_member();

-- Героя на закрытую сцену ставит мастер — это и открывает её; игрок на закрытую сцену токен поставить не может (RLS ниже).
create function public.scene_reveal_token() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.character_id is not null and (tg_op = 'INSERT' or new.scene_id is distinct from old.scene_id) then perform public.scene_reveal(new.scene_id); end if;
  return null;
end $$;
revoke execute on function public.scene_reveal_token() from public, anon, authenticated;
create trigger tokens_reveal_scene after insert or update of scene_id on public.tokens for each row execute function public.scene_reveal_token();

-- Открыта ли сцена. Для проверок RLS.
create function public.scene_open(sid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.revealed from public.scenes s where s.id = sid), false);
$$;
revoke execute on function public.scene_open(text) from public, anon;
grant execute on function public.scene_open(text) to authenticated;

drop policy scenes_read on public.scenes;
create policy scenes_read on public.scenes for select to authenticated
  using (public.is_master(campaign_id) or (public.is_member(campaign_id) and revealed));
drop policy tokens_read on public.tokens;
create policy tokens_read on public.tokens for select to authenticated
  using (public.is_master(campaign_id) or (public.is_member(campaign_id) and not hidden and public.scene_open(scene_id)));
drop policy tokens_insert on public.tokens;
create policy tokens_insert on public.tokens for insert to authenticated
  with check (public.is_master(campaign_id) or (public.is_member(campaign_id) and public.scene_open(scene_id)));
drop policy drawings_read on public.drawings;
create policy drawings_read on public.drawings for select to authenticated
  using (public.is_master(campaign_id) or (public.is_member(campaign_id) and public.scene_open(scene_id)));
drop policy drawings_insert on public.drawings;
create policy drawings_insert on public.drawings for insert to authenticated
  with check (public.is_master(campaign_id) or (public.is_member(campaign_id) and public.scene_open(scene_id)));
drop policy explored_read on public.scene_explored;
create policy explored_read on public.scene_explored for select to authenticated
  using (public.is_master(campaign_id) or (public.is_member(campaign_id) and public.scene_open(scene_id)));
