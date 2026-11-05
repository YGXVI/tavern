# Продолжение: свои существа (#203)

Приостановлено по просьбе sol0139 05.11.2026, продолжить в 13:40 Asia/Dushanbe.

Запрос: в конструкторе библиотеки нет новых настроек картинки; у Нарзугона с атакой +10, уроном 1к12+5 колющий + 3к10 огонь в статблоке нет кнопок урона; картинка на карте заменяется инициалами; после перезагрузки токен пропадает. Пользователь подтвердил: dropdice-test.vercel.app, ошибок не видел. Проверить весь путь библиотека → карта → сервер → перезагрузка.

База test: bfa4ab99daf9e3c19138bf380a624dee4921f6a1. Рабочая ветка claude/dev. WIP НЕ интегрировать в test до завершения и проверок. Предыдущие задачи (редактор картинки токена на столе и кубы поверх UI) уже в test и опубликованы. Главную main не менять.

Что изменено, но НЕ проверено полностью:
- views/creatures.js подключает существующий tokenImageEditor к кнопке «Настроить картинку» конструктора; загрузка в личный бакет через uploadLibraryImage, учёт uploaded и cleanup. token-image.js получил параметр title.
- sheet.js: урон lib-существа берётся из damageComponents, кнопка на каждый компонент (data-part), monsterRoll бросает выбранный; реакции тоже через actionHTML, строки через traitHTML. table.css .monster-rolls складывает кнопки вертикально, ограничивает ширину.
- screens.css: overflow hidden/min-size у портрета конструктора (на скриншоте был вытянут).
- server-e2e/harness.mjs: добавлены creatures/campaign_creatures, упрощённые RLS, бакеты library/tokens; fake-supabase.js: getUser и перенос data URL настоящих файлов. Это обновление старого тестового стенда, не изменение runtime сервера.

Находки:
1. Редактор картинки раньше был только в p-token.js, библиотека creatures.js пользовалась pickImageFile напрямую. Исправляется WIP.
2. toMonster в rules/creature.js намеренно выставляет damage='' для нескольких компонентов и хранит damageComponents; sheet раньше рисовал кнопки только a.damage. Исправляется WIP. Проверить ещё действия/бонусные/реакции/легендарные, отсутствие бонуса и +0, русские формулы и несколько типов урона.
3. Причина исчезновения токена НЕ найдена. Не утверждать, что устранена. Runtime placeCreatures (p-side.js) делает snapshotOf(tpl), token lib:<copyId>, groupPlacements в server/model.js объединяет снимок+токен в place; sync.js sendPlacement вызывает RPC place_creature, fallback две вставки. Migration 20261105130000_token_097_rest.sql и supabase/tests/rls.sql проверяют эту транзакцию. Ошибка отправки вызывает failed(), toast storage-error и loadCampaign; beforeunload может потерять ещё не отправленную очередь (пока гипотеза).
4. placeCreatures/placeSummon переиспользуют старый снимок sourceId даже после правок шаблона: новые токены могут получать старые атаки и картинку. Подумать о новом снимке на изменённую версию, не изменяя уже поставленных существ; не менять старые копии молча.
5. libImageNow/fillLibImage в p-side.js сначала ставят инициалы, затем асинхронно campaignImage копирует private library: в tokens и обновляет токен + master snapshot. Исследовать гонку с записью постановки/перезагрузкой и сообщения об ошибке.

Временное воспроизведение /tmp/own-creature-repro.mjs и лог /tmp/own-creature-repro.log (если сохранились). Seed fakeServer с мастером A=00000000-0000-0000-0000-0000000000a1, c-own, s-own; реальный browser server=1; saveCreature шаблон Нарзугон и placeCreatures, whenSynced, проверка fake.T.tokens/campaign_creatures, reload. Сейчас упирается в старый fake harness: saveCreature -> fromRow «Личная запись недоступна», потому что query().upsert().single() возвращает массив вместо одной строки. getUser уже добавлен. Исправить этот тестовый двойник и дописать нормальный постоянный browser regression сценарий. Атомарный place_creature в fake пока НЕ реализован, сработает fallback PGRST202. Важно проверить и RPC, и fallback, не прикрыть проблему слабым fake.

Инструменты: Playwright установлен /tmp/token-image-browser/node_modules/playwright; Chromium /usr/bin/chromium, args --enable-unsafe-swiftshader; local python http.server dist порт4173 ещё мог работать. Запуск shell/network/socket часто требует exec_command require_escalated; не обходить proxy. GH auth работает: git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push origin claude/dev. Старый npm ci без escalation однажды удалил часть node_modules; npm ci --ignore-scripts с escalation восстанавливает. PostgreSQL локально в /usr/lib/postgresql не найден, миграции живой БД не запускались.

Следующее:
- Проверить свежие origin/test и claude/dev, сохранить чужие изменения; WIP продолжить, не начать заново.
- Довести воспроизведение и исправить реальную причину пропажи/картинки, проверить подтверждение сервером и reload. Если реальную причину не удаётся воспроизвести, честно сказать, собрать диагностические признаки, не выдавать гипотезу за исправление.
- Проверить конструктор через UI с картинкой и атакой как на скринах; оба компонента урона бросаются и сохраняются; портрет проходит из library в tokens и виден после reload; повторная постановка после редактирования; роли master/player, 390px; ошибки загрузки и отказ сервера не должны давать ложный успех.
- npm test, spec:validate, spec:validate:archive, node --check, git diff --check. До WIP тестов было 294, spec24, архив84. Для WIP пока только синтаксис creatures.js/sheet.js (прошёл до последующих мелких изменений); зелёный CI НЕ заявлять.
- Закончив, интегрировать в test обычным merge по AGENTS, обновить тело Issue #203 коротким отчётом, дождаться штатного CI/deploy и сверить live JS/CSS. При изменении общих server контрактов предупредить #204 без запросов повторного согласования. Новых Issues/task-веток не создавать.
