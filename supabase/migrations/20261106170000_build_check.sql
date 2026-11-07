-- P4b (#202; решение YGXVI 05.11, вариант A): пометку «сборку проверил сервер» ставит только база.
-- Проверку делает Edge Function validate-build (тот же движок правил, что в конструкторе) и вызывает команду листа
-- от имени игрока с секретным заголовком x-build-check. Здесь хранится только SHA-256 ключа; сам ключ — в секретах функции.
-- Любая запись с новым блоком creation получает verified = 'client', если заголовка нет: подделать пометку из браузера,
-- в том числе прямой вставкой листа, нельзя. Пока ключ не задан, все сборки — 'client', как раньше.

create table public.build_check_key (
  id boolean primary key default true check (id),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$')
);
alter table public.build_check_key enable row level security;
revoke all on public.build_check_key from public, anon, authenticated;

create function public.build_check_ok() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare h text; k text;
begin
  begin h := current_setting('request.headers', true)::json ->> 'x-build-check';
  exception when others then return false; end;
  if coalesce(h, '') = '' then return false; end if;
  select key_hash into k from public.build_check_key;
  return k is not null and k = encode(sha256(convert_to(h, 'UTF8')), 'hex');
end $$;
revoke execute on function public.build_check_ok() from public, anon, authenticated;

create function public.character_verified() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if jsonb_typeof(new.data -> 'creation') is distinct from 'object' then return new; end if;
  -- Сборка не менялась (хиты, заметки, сумка) — пометка прежняя.
  if tg_op = 'UPDATE' and (new.data -> 'creation') - 'verified' = (old.data -> 'creation') - 'verified' then
    new.data := jsonb_set(new.data, '{creation,verified}', coalesce(old.data #> '{creation,verified}', '"client"'::jsonb));
    return new;
  end if;
  new.data := jsonb_set(new.data, '{creation,verified}', to_jsonb(case when public.build_check_ok() then 'server' else 'client' end));
  return new;
end $$;
revoke execute on function public.character_verified() from public, anon, authenticated;
-- Последним из BEFORE-триггеров листа (идут по имени): после проверок и записи команд.
create trigger characters_verified before insert or update on public.characters for each row execute function public.character_verified();
