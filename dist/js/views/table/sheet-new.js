// Новый общий лист (TASK-004 5.1–5.2): постоянный NPC, Sidekick или герой — вручную, из SRD или копией. Открывается из редактора
// листа и из панели мастера «Герой на сцену». Токен создаёт мастер отдельно: лист живёт независимо от карты.
import { esc, uid } from '../../core/dom.js';
import { updateCampaign, isMasterOf, userById } from '../../core/campaign.js';
import { isServerMode } from '../../core/store.js';
import { modal } from '../../ui/kit.js';
import { createCharacterSheet } from '../../server/sync.js';
import { copy, validateDraft, prepareSheetDerived } from './sheet-fields.js';
import { emptySheet, sheetFromSrd, copySheet } from './sheet-creature.js';
import { BESTIARY, loadSrdBestiary } from '../../data/bestiary.js';

// Встроенные существа песочницы — те же статблоки SRD, но без отметки каталога; своё «Порождение» SRD не относится.
const fromCatalogue = (m) => m.srd === true || m.id !== 'faceless-spawn';

/** source — лист для копии или null; onOpen(id) — что сделать с созданным листом. */
export async function newSheetDialog(ctx, { source = null, onOpen } = {}) {
  try { await loadSrdBestiary(); } catch { /* ручное создание остаётся доступно */ }
  const master = isMasterOf(ctx.c, ctx.userId), newActorId = uid('ch-');
  let created = null;
  const m = modal(`<div class="panel-section"><h3>${source?'Копия листа':'Новый общий лист'}</h3><label class="sheet-field">Имя<input data-create-name value="${esc(source?source.name+' — копия':'')}"></label><label class="sheet-field">Профиль<select data-create-profile ${master&&!source?'':'disabled'}>${[['pc','Полноценный герой'],['creature','NPC со статблоком'],['sidekick','Sidekick']].map(([k,n])=>`<option value="${k}" ${k===(source?source.profile||'pc':master?'creature':'pc')?'selected':''}>${n}</option>`).join('')}</select></label><label class="sheet-field">Владелец<select data-create-owner><option value="${ctx.userId}">Я</option>${master?`<option value="">Без владельца</option>${ctx.c.members.filter(m=>m.status==='active'&&m.userId!==ctx.userId).map(m=>`<option value="${esc(m.userId)}">${esc(userById(m.userId)?.name||m.name||m.userId)}</option>`).join('')}`:''}</select></label>${!source?`<label class="sheet-field">Основа<select data-create-source><option value="">Ручной лист — неизвестные числа не заполняются</option>${BESTIARY.filter(fromCatalogue).map(m=>`<option value="${esc(m.id)}">SRD · ${esc(m.name)}</option>`).join('')}</select></label>`:''}<p class="t-sm muted">Токены, управление, связи и ход не создаются автоматически. Числа экземпляра независимы от каталога.</p><p class="sheet-error" data-create-error role="alert"></p><button class="btn btn-primary" data-create-ok>Создать лист</button><button class="btn" data-close>Отмена</button></div>`);
  m.box.querySelector('[data-create-ok]').onclick = async () => {
    const button = m.box.querySelector('[data-create-ok]'); button.disabled = true;
    try {
      if (!created) {
        const name = m.box.querySelector('[data-create-name]').value.trim(), profile = m.box.querySelector('[data-create-profile]').value, ownerId = m.box.querySelector('[data-create-owner]').value || null;
        const identity = { id: newActorId, ownerId, name, profile }, catalogueId = m.box.querySelector('[data-create-source]')?.value;
        created = source ? copySheet(source, identity, () => uid('entry-')) : catalogueId ? sheetFromSrd({ ...BESTIARY.find((x) => x.id === catalogueId), srd: true }, identity) : emptySheet(identity);
        created.profile = profile;
        if (catalogueId && !created.portrait) created.portrait = BESTIARY.find((x) => x.id === catalogueId)?.img || null;
        if (created.statblock?.baseSnapshot && !source) {
          const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(created.statblock.baseSnapshot)));
          created.statblock.templateVersion = `sha256:${Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, '0')).join('')}`;
        }
        if (profile === 'sidekick' && !created.sidekick) created.sidekick = { class: 'warrior', baseLevel: created.level, baseSnapshot: copy(created.statblock?.baseSnapshot || { stats: created.stats, hpMax: created.hpMax }), hitDie: null, growthHistory: [] };
        if (profile === 'sidekick' && !created.hitDicePools?.length) created.hitDicePools = [{ id: uid('hd-'), name: 'Базовые кости — уточните', source: 'base-statblock', die: null, total: null, spent: null }];
        created = prepareSheetDerived(created);
        const issues = validateDraft(created);
        if (issues.length) { created = null; throw new Error(issues.join('; ')); }
      }
      if (isServerMode()) await createCharacterSheet(ctx.cid, created); else updateCampaign(ctx.cid, (c) => c.characters.push(copy(created)));
      m.close(); onOpen?.(created.id);
    } catch (e) {
      m.box.querySelector('[data-create-error]').textContent = e.message || 'Не удалось создать лист';
      if (created) { for (const input of m.box.querySelectorAll('input,select')) input.disabled = true; button.textContent = 'Повторить создание с тем же ID'; }
    } finally { button.disabled = false; }
  };
}
