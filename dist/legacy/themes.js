export const themes=[
  {id:'midnight',name:'Полночь',description:'Глубокий синий и лунное серебро.',tag:'Тёмная · по умолчанию'},
  {id:'parchment',name:'Пергамент',description:'Светлая бумага и чернила старых карт.',tag:'Светлая'},
  {id:'graphite',name:'Графит',description:'Нейтральный уголь и мягкий янтарь.',tag:'Тёмная'},
  {id:'wine',name:'Бордовое вино',description:'Тёплый бордовый и приглушённое золото.',tag:'Тёмная'}
];
export function initThemePicker(notify){
  const root=document.documentElement,dialog=document.querySelector('#themeDialog'),catalog=document.querySelector('#themeCatalog'),status=document.querySelector('#themeStatus'),key='rasputye-theme-v1';
  let applied=themes.some(t=>t.id===root.dataset.theme)?root.dataset.theme:'midnight',preview=applied;
  catalog.innerHTML=themes.map(t=>`<button type="button" class="theme-card" data-theme="${t.id}" data-theme-choice="${t.id}" aria-pressed="false"><span class="theme-sample" aria-hidden="true"><span class="sample-sidebar"><i></i><i></i><i></i></span><span class="sample-main"><span class="sample-heading"></span><span class="sample-panels"><i></i><i></i></span><span class="sample-lines"><i></i><i></i></span></span></span><span class="theme-details"><span class="theme-card-title">${t.name}<span class="theme-check" aria-hidden="true">✓</span></span><span class="theme-card-description">${t.description}</span><span class="theme-tag">${t.tag}</span></span></button>`).join('');
  function setTheme(id){root.dataset.theme=id;const bg=getComputedStyle(root).getPropertyValue('--page').trim();document.querySelector('meta[name="theme-color"]').content=bg;}
  function update(){catalog.querySelectorAll('[data-theme-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.themeChoice===preview)));const name=themes.find(t=>t.id===preview).name;status.textContent=preview===applied?`Текущая тема: ${name}`:`Предпросмотр: ${name}`;}
  document.querySelector('#themeOpen').onclick=()=>{preview=applied;update();dialog.showModal()};
  catalog.onclick=e=>{const b=e.target.closest('[data-theme-choice]');if(!b)return;preview=b.dataset.themeChoice;setTheme(preview);update()};
  function cancel(){setTheme(applied);preview=applied;dialog.close()}
  document.querySelector('#themeCancel').onclick=cancel;document.querySelector('#themeClose').onclick=cancel;
  dialog.addEventListener('cancel',e=>{e.preventDefault();cancel()});
  document.querySelector('#themeApply').onclick=()=>{setTheme(preview);applied=preview;try{localStorage.setItem(key,applied);notify(`Тема «${themes.find(t=>t.id===applied).name}» сохранена`)}catch{notify('Тема применена. Браузер не разрешил сохранить выбор.')}dialog.close()};
  setTheme(applied);
}
