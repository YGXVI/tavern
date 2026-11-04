# Tasks

## 1. Данные и отрисовка

- [x] 1.1 `commitMoves` записывает `movedAt` перемещённым токенам (и при «Вернуть»); проверка: Playwright — поле появилось в сцене
- [x] 1.2 `stackOrder` и `zIndex` в `renderTokens`, перетаскиваемые — сверху; `.tok.dragging` без своего z-index; проверка: Playwright — `elementFromPoint` в общей клетке даёт последнего подвинутого у мастера и игрока
- [x] 1.3 `docs/data.md` — поле `movedAt`; проверка: чтение

## 2. Проверки

- [x] 2.1 `npm test`, `npm run spec:validate`, `npm run spec:validate:archive`, синтаксис изменённого JS
- [x] 2.2 Регрессия перемещения (t018) и сценарии требования
