# Тестовая среда (DEC-018, #204)

Ветка `test` выкатывается на **https://rasputye-test.vercel.app** — отдельно от прода:

| | Прод (`main`) | Тест (`test`) |
|---|---|---|
| Сайт | Vercel `rasputye`, токен `VERCEL_TOKEN` | Vercel `rasputye-test` (`prj_zkprAhi4…`), токен `VERCEL_TOKEN_TEST` |
| База | Supabase `ilsuespohsuligyiqjsx` | свой проект Supabase, адрес — переменная `TEST_SUPABASE_URL` |
| Вход | Discord-приложение «Распутье» | своё Discord-приложение «Распутье (тест)», гости по `?guest=1` |
| Миграции | вручную, после бэкапа | сами из CI при каждом пуше в `test` |
| Данные | настоящие | только тестовые; базу можно очистить в любой момент |

Стенд никогда не подключается к боевой базе: `tools/mark-test-stand.mjs` отказывает боевому адресу и любому ключу, кроме `sb_publishable_…`, а `tools/migrate-test-db.sh` — строке подключения к боевому проекту. Боевые данные в тестовую базу не копируются. Пока тестовая база не настроена, стенд работает песочницей.

## Как работает выкладка

Пуш в `test` → задание «Тесты» → задание «Тестовый стенд» (`.github/workflows/deploy.yml`):

1. Если есть секрет `TEST_DATABASE_URL` — `tools/migrate-test-db.sh` применяет новые файлы `supabase/migrations/*.sql` (каждый в своей транзакции, история в `supabase_migrations.schema_migrations`) и прогоняет `supabase/tests/rls.sql`. Любая ошибка или непрошедшая проверка прав останавливает выкладку.
2. `tools/mark-test-stand.mjs` подставляет `TEST_SUPABASE_URL`/`TEST_SUPABASE_KEY` в `dist/js/server/config.js`, включает серверный режим, ставит плашку «Тестовый стенд · sha» и `noindex`.
3. `vercel deploy --prod` в проект `rasputye-test`.

Чего из настроек нет — тот шаг пропускается с пометкой в логе, тесты остаются зелёными.

## Первичная настройка (делает владелец; агент токены и пароли не вводит)

**1. Supabase — новая учётная запись и проект**

1. Зарегистрироваться на supabase.com (бесплатный план; новых расходов нет).
2. Создать организацию `drop-dice-test` и проект `drop-dice-test`, регион — как у прода. Пароль базы сгенерировать и сохранить в менеджере паролей.
3. Authentication → Sign In / Providers: включить **Allow anonymous sign-ins** (вход гостем, #194).
4. Authentication → URL Configuration: Site URL `https://rasputye-test.vercel.app`, Redirect URLs `https://rasputye-test.vercel.app/**`.
5. Realtime → Settings: выключить публичный доступ (как в проде, TASK-002).
6. Схему, бакет `maps` и Realtime создают миграции — руками таблицы не заводить.

**2. Discord — отдельное приложение для теста**

1. discord.com/developers → New Application «Распутье (тест)».
2. OAuth2 → Redirects: `https://<ref тестового проекта>.supabase.co/auth/v1/callback`.
3. Client ID и Client Secret ввести в Supabase → Authentication → Providers → Discord. Секрет прода не переиспользовать.

**3. Vercel — проект и токен стенда**

1. Убедиться, что в команде есть проект `rasputye-test` с ID `prj_zkprAhi4TwEii6GylM8i1ltaP1VN` (если нет — создать проект с этим именем и прислать новый ID агенту, он поправит workflow).
2. Account Settings → Tokens: создать токен для этой команды, срок — по желанию.

**4. GitHub — Settings → Secrets and variables → Actions**

| Вид | Имя | Значение |
|---|---|---|
| Secret | `VERCEL_TOKEN_TEST` | токен из шага 3 |
| Secret | `TEST_DATABASE_URL` | Supabase → Connect → **Session pooler** (порт 5432, IPv4; прямое подключение из GitHub Actions недоступно), с паролем базы |
| Variable | `TEST_SUPABASE_URL` | `https://<ref>.supabase.co` |
| Variable | `TEST_SUPABASE_KEY` | Project Settings → API Keys → **publishable** key (`sb_publishable_…`). Secret/service_role — никогда |

**5. Запуск**

Actions → «Тесты и деплой» → Re-run для последнего запуска `test` (или любой пуш в `test`). Ожидание в логе: миграции применены, «Проверки прав: N ok», адрес выкладки; на стенде — плашка, вход через Discord и `?guest=1`.

## Обслуживание

- Бесплатный проект Supabase засыпает после недели без запросов — разбудить кнопкой Restore в панели.
- Сломанная тестовая база: Database → Reset (или новый проект) и повторный запуск workflow — миграции применятся с нуля.
- Миграция, уже применённая к тесту, не меняется задним числом: исправление — новой миграцией (как в проде).
