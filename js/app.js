import { APP_VERSION, SECTION_LABELS, matches, progressKey, scheduleReview, bytesLabel,
  chooseQuestions, dateLabel, questionSignature, matchingProgress } from './core.js';
import { LIMITS, parseJSON, requireThat, validateFiles, safePath } from './schema.js';
import { openDatabase, listPacks, assetBlob, packAssets, getMeta, setMeta, setMetas, installPacks, removePack,
  learningSnapshot, validateLearning, mergeLearning, restoreLearningFile, clearLearning } from './storage.js';
import { archiveJob } from './archive.js';
import { el, button, link, badge, icon, toast, modal } from './dom.js';
import { creditsButton } from './credits.js';
import { initAppearance, themeControl } from './appearance.js';
import { imageViewer } from './viewer.js';
import {caseComparisonLayers,caseInterpretation} from './case-interpretation.js';
import { EXERCISE_LABELS, SECTION_PROMPTS, availableExercises, interpretationExercise, assessmentMean, recordSelfAssessment,
  sessionAnswer, advanceSession, finishSessionEarly, receivedAnswers, selfAssessmentItems,
  canonicalDiagnosisLabels, validNoteScore } from './exercises.js';
import { packWithoutAnswerBanks } from './pack-compat.js';
import { defaultPackAction, downloadDefaultPack, fetchDefaultPackManifest, validateDefaultPackContents } from './default-pack.js';

const state={packs:[],activeId:null,progress:{},selfAssessments:{},bookmarks:[],visited:[],session:null,starter:null,defaultPack:null,offlineReady:false,registration:null,prompt:null,route:'library',page:0,chapter:'all',query:'',onlyBookmarks:false,updateChecking:false,viewerMode:'fit'};
const navPreferenceKey='radioeasy-study-nav-collapsed';
const narrowNav=matchMedia('(max-width: 950px)');
let navPreference;
try{navPreference=localStorage.getItem(navPreferenceKey);}catch{}
let cleanup=[],renderToken=0,defaultPackRequest=0,activeExport=false,installing=false,swReloading=false;
const act=fn=>async event=>{try{return await fn(event);}catch(error){toast(friendlyError(error),true);}};
const active=()=>state.packs.find(row=>row.id===state.activeId) || state.packs[0];
const visitKey=(record,item)=>`${record.id}|${item.id}`;
function setViewerMode(mode){
  const value=mode==='fill'?'fill':'fit';if(state.viewerMode===value)return;
  state.viewerMode=value;setMeta('viewerMode',value).catch(error=>toast(friendlyError(error),true));
}
function friendlyError(error){return error?.name==='QuotaExceededError'?'Nu mai este loc pe acest dispozitiv. Pachetul nu a fost salvat; datele existente au rămas intacte.':error?.message || 'Operația nu a putut fi finalizată.';}
function registerCleanup(fn){cleanup.push(fn);}
function chapterLabel(pack,id){return pack.curriculum.chapters.find(row=>row.id===id)?.label || id;}
function pct(n,total){return total?Math.round(n/total*100):0;}
function bar(value){const fill=el('span');fill.style.width=`${Math.max(0,Math.min(100,value))}%`;return el('div',{class:'thin-progress'},fill);}
function heading(title,description,action=null){return el('header',{class:'page-head'},el('div',{},el('h1',{},title),description?el('p',{},description):null),action);}
function stat(label,value){return el('div',{class:'stat'},el('div',{},el('div',{class:'stat-label'},label),el('div',{class:'stat-value'},value)));}
function noPack(){return el('div',{class:'empty-state'},el('div',{class:'round-icon'},icon('book',25)),el('h2',{},'Mai întâi, un pachet.'),el('p',{},'Adaugă materialele tale pentru a începe să studiezi și să exersezi.'),link('Deschide biblioteca','#library','button'));}
function exerciseLabel(q){return EXERCISE_LABELS[q.kind];}
function coverageLabel(item){return item.completeness==='diagnosis-only'?'Doar diagnostic':item.completeness==='full'?'Explicație completă':'Explicație parțială';}

function imageThumb(record,item,className='',onCleanup=registerCleanup){
  const img=el('img',{alt:`Radiografie: ${item.title}`,class:className,loading:'lazy'});let disposed=false,url;
  const primary=item.images.find(row=>row.role!=='comparison') || item.images[0];
  assetBlob(record,primary.path).then(blob=>{if(!disposed && blob){url=URL.createObjectURL(blob);img.src=url;}}).catch(()=>{});
  onCleanup(()=>{disposed=true;if(url)URL.revokeObjectURL(url);});return img;
}

function shell(){
  const record=active();const routes=[['library','Bibliotecă','book'],['practice','Recapitulare','repeat'],['exam','Simulare','exam'],['progress','Progres','chart']];
  const current=state.route.startsWith('case/') || state.route==='cases'?'library':state.route;
  const navLink=(route,label,name)=>el('a',{href:`#${route}`,class:`nav-item ${current===route?'active':''}`,title:label,'aria-current':current===route?'page':null},icon(name),el('span',{},label));
  const brand=el('a',{href:'#library',class:'brand','aria-label':'RadioEasy'},el('img',{src:'./icons/icon.svg',alt:''}),el('span',{class:'brand-word'},'RadioEasy'));
  const desktopToggle=button(icon('menu',18),()=>{
    navPreference=String(!desktopCollapsed());
    try{localStorage.setItem(navPreferenceKey,navPreference);}catch{}
    updateDesktopMenu();
  },'icon-button sidebar-toggle',{'aria-controls':'study-sidebar-menu'});
  const packSelect=state.packs.length>1?el('select',{class:'pack-select','aria-label':'Pachet activ',onchange:act(async event=>{state.activeId=event.target.value;state.page=0;state.chapter='all';state.query='';await setMeta('activeId',state.activeId);location.hash='library';await render();})},...state.packs.map(row=>el('option',{value:row.id,selected:row.id===record?.id},row.pack.title))):el('span',{class:'pack-select'},record?.pack.curriculum.title || 'Spațiul tău de studiu');
  const side=el('aside',{class:'sidebar',id:'study-sidebar'},
    el('div',{class:'sidebar-head'},brand,desktopToggle),
    el('div',{class:'sidebar-menu',id:'study-sidebar-menu'},
      el('nav',{class:'nav-list','aria-label':'Navigare principală'},...routes.map(row=>navLink(...row))),
      el('div',{class:'sidebar-pack'},el('span',{class:'field-label'},'Pachet activ'),packSelect),
      el('div',{class:'sidebar-bottom'},themeControl(),
        button([icon('refresh'),el('span',{'aria-live':'polite'},updateCheckLabel())],act(()=>checkForUpdates()),'nav-item update-check',{disabled:state.updateChecking,title:'Verifică actualizările'}),
        navLink('settings','Date & instalare','settings'),
        creditsButton(),
        el('div',{class:'sidebar-version'},`v${APP_VERSION}`))));
  const mobileToggle=button(icon('menu',21),()=>setMobileMenu(mobileToggle.getAttribute('aria-expanded')!=='true'),'icon-button mobile-menu-toggle',{'aria-controls':'study-sidebar','aria-expanded':'false','aria-label':'Deschide meniul'});
  const top=el('header',{class:'study-mobile-header'},mobileToggle,link([el('img',{src:'./icons/icon.svg',alt:''}),'RadioEasy'],'#library','mobile-brand'));
  const main=el('main',{class:'content',id:'main',tabindex:'-1'});
  const update=state.registration?.waiting?el('div',{class:'update-banner'},el('span',{},'O versiune nouă este gata.'),button('Actualizează acum',act(()=>activateUpdate()),'button secondary')):null;
  const mobile=el('nav',{class:'mobile-nav','aria-label':'Navigare mobilă'},...routes.map(([route,label,name])=>link([icon(name),el('span',{},label)],`#${route}`,current===route?'active':'')),link([icon('settings'),el('span',{},'Date')],'#settings',current==='settings'?'active':''));
  const layout=el('div',{class:'app-shell'},top,side,el('div',{class:'main-shell'},update,main),mobile);
  const desktopCollapsed=()=>navPreference==null?narrowNav.matches:navPreference==='true';
  function updateDesktopMenu(){
    const collapsed=desktopCollapsed();
    const label=collapsed?'Extinde meniul':'Restrânge meniul';
    layout.classList.toggle('nav-collapsed',collapsed);
    desktopToggle.title=label;
    desktopToggle.setAttribute('aria-label',label);
    desktopToggle.setAttribute('aria-expanded',String(!collapsed));
  }
  function setMobileMenu(open){
    const label=open?'Restrânge meniul':'Deschide meniul';
    layout.classList.toggle('mobile-menu-open',open);
    mobileToggle.setAttribute('aria-expanded',String(open));
    mobileToggle.setAttribute('aria-label',label);
  }
  side.addEventListener('click',event=>{if(event.target.closest('a'))setMobileMenu(false);});
  layout.addEventListener('keydown',event=>{if(event.key==='Escape' && layout.classList.contains('mobile-menu-open')){setMobileMenu(false);mobileToggle.focus();}});
  narrowNav.addEventListener('change',updateDesktopMenu);
  registerCleanup(()=>narrowNav.removeEventListener('change',updateDesktopMenu));
  updateDesktopMenu();
  document.getElementById('app').replaceChildren(layout);return main;
}

async function render(){
  const token=++renderToken;for(const release of cleanup)release();cleanup=[];
  state.route=location.hash.slice(1).split('?')[0] || 'library';
  const main=shell();
  if(state.route==='library')renderLibrary(main);
  else if(state.route==='cases')renderCases(main);
  else if(state.route.startsWith('case/'))await renderReader(main,decodeURIComponent(state.route.slice(5)));
  else if(state.route==='practice' || state.route==='exam')renderPractice(main,state.route==='exam'?'exam':'review');
  else if(state.route==='progress')renderProgress(main);
  else if(state.route==='settings')await renderSettings(main,token);
  else main.append(noPack());
}

function defaultPackOffer(){
  const manifest=state.defaultPack,record=state.packs.find(row=>row.id===manifest?.id);
  const action=defaultPackAction(manifest,record);
  if(!action)return null;
  return {
    manifest,
    size:`${manifest.cases} cazuri · ${bytesLabel(manifest.bytes)}`,
    button:button([icon('download',17),action==='install'?'Descarcă pachetul de curs':'Actualizează pachetul de curs'],
      act(()=>offerDefaultPack(manifest)), 'button default-pack-action', {disabled:state.updateChecking}),
  };
}

function renderLibrary(main){
  const record=active();
  const offer=defaultPackOffer();
  main.append(heading('Biblioteca mea',null,button([icon('plus',17),'Importă pachet'],()=>document.getElementById('pack-input').click())));
  if(/FBAN|FBAV|Instagram|Discord|; wv\)/i.test(navigator.userAgent))main.append(el('div',{class:'embedded-banner'},el('span',{},'Pentru instalare și date păstrate în același loc, deschide RadioEasy în Safari sau Chrome.'),link('Vezi instrucțiunile','#settings','button secondary')));
  if(!record){
    const importButton=button([icon('upload',17),'Alege un pachet ZIP'],()=>document.getElementById('pack-input').click(),offer?'button secondary':'button');
    main.append(el('section',{class:'empty-library'},el('div',{class:'round-icon'},icon('book',28)),
      el('h2',{},offer?.manifest.title || 'Atlasul tău începe aici.'),
      el('p',{},offer?'Descarcă atlasul de curs direct pe acest dispozitiv pentru a studia și fără internet.':'Importă un pachet ZIP primit de la colegi. Imaginile, explicațiile și exercițiile vor fi disponibile pe acest dispozitiv.'),
      el('div',{class:'button-row'},offer?.button,importButton,!offer&&state.starter?button('Adaugă pachetul de curs',act(loadStarter),'button secondary'):null),
      offer?el('div',{class:'starter-footnote'},offer.size):state.starter?el('div',{class:'starter-footnote'},`${state.starter.cases} de cazuri din notițele tale`):null));
    main.append(el('section',{class:'panel privacy-panel'},el('h3',{},'Materialele rămân pe acest dispozitiv.'),el('p',{},'Aplicația citește fișierul ales local și nu îl trimite către un server.')));return;
  }
  if(offer)main.append(el('section',{class:'panel review-teaser'},el('div',{class:'round-icon'},icon('book',24)),
    el('div',{},el('h3',{},offer.manifest.title),el('p',{},`Versiunea ${offer.manifest.revision} · ${offer.size}`)),offer.button));
  const pack=record.pack,learned=pack.cases.filter(item=>state.visited.includes(visitKey(record,item))).length;
  const { diagnoses, assessed } = progressData(record);
  const { attempts, correct, due } = progressTotals(diagnoses, assessed);
  main.append(el('div',{class:'stats-row'},stat('Cazuri disponibile',pack.cases.length),stat('Cazuri citite',learned),stat('Diagnostice corecte',attempts?`${pct(correct,attempts)}%`:'—'),stat('De recapitulat',due)));
  const next=pack.cases.find(item=>!state.visited.includes(visitKey(record,item))) || pack.cases[0];
  main.append(el('section',{class:'hero-pack'},el('div',{class:'hero-copy'},el('h2',{},pack.title),el('p',{},`${pack.cases.length} cazuri, organizate în ${pack.curriculum.chapters.length} capitole.`),el('div',{class:'button-row'},link(['Continuă studiul',icon('arrow',16)],`#case/${next.id}`,'button'),link('Toate cazurile','#cases','button ghost'))),el('a',{href:`#case/${next.id}`,class:'hero-image'},imageThumb(record,next))));
  main.append(el('div',{class:'section-head'},el('h2',{},'Explorează pe capitole')));
  main.append(el('div',{class:'chapter-grid'},...pack.curriculum.chapters.map(chapter=>{
    const items=pack.cases.filter(item=>item.chapterId===chapter.id),seen=items.filter(item=>state.visited.includes(visitKey(record,item))).length;
    return el('a',{href:'#cases',class:'chapter-card',onclick:()=>{state.chapter=chapter.id;state.query='';state.page=0;}},el('div',{class:'chapter-image'},items[0]?imageThumb(record,items[0]):null),
      el('div',{class:'chapter-copy'},el('div',{class:'chapter-title'},el('h3',{},chapter.label)),el('p',{},`${items.length} ${items.length===1?'caz':'cazuri'}`),bar(pct(seen,items.length)),el('div',{class:'chapter-progress-label'},`${seen} din ${items.length} citite`)));
  })));
  main.append(el('section',{class:'panel review-teaser'},el('div',{class:'round-icon'},icon('repeat',24)),el('div',{},el('h3',{},due?'Ai exerciții de recapitulat.':'Nimic de recapitulat acum.'),el('p',{},due?`${due} exerciții sunt pregătite pentru o nouă trecere.`:'Continuă cu material nou sau verifică progresul.'),link(['Începe o recapitulare',icon('arrow',14)],'#practice','text-link'))));
}

function renderCases(main){
  const record=active();if(!record){main.append(noPack());return;}const pack=record.pack;
  main.append(heading('Toate cazurile',pack.title));
  const results=el('div'),search=el('input',{type:'search',placeholder:'Caută în cazuri și explicații…',value:state.query,'aria-label':'Caută în cazuri'});
  let thumbnails=[];registerCleanup(()=>{for(const dispose of thumbnails)dispose();thumbnails=[];});
  let timer;search.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{state.query=search.value;state.page=0;draw();},120);});registerCleanup(()=>clearTimeout(timer));
  const filters=el('div',{class:'filter-bar'},el('label',{class:'search-field'},icon('search',17),search));
  const chips=[];
  for(const chapter of [{id:'all',label:'Toate'},...pack.curriculum.chapters]){
    const chip=button(chapter.label,()=>{state.chapter=chapter.id;state.page=0;chips.forEach(([b,id])=>b.classList.toggle('active',id===state.chapter));draw();},`chip ${state.chapter===chapter.id?'active':''}`);chips.push([chip,chapter.id]);filters.append(chip);
  }
  const bookmarked=button([icon('bookmark',14),'Salvate'],()=>{state.onlyBookmarks=!state.onlyBookmarks;bookmarked.classList.toggle('active',state.onlyBookmarks);state.page=0;draw();},`chip ${state.onlyBookmarks?'active':''}`);filters.append(bookmarked);
  main.append(filters,results);
  function draw(){
    for(const dispose of thumbnails)dispose();thumbnails=[];
    const candidates=pack.cases.filter(item=>(state.chapter==='all' || item.chapterId===state.chapter) && (!state.onlyBookmarks || state.bookmarks.includes(visitKey(record,item))) && matches(`${item.title} ${item.referenceText} ${chapterLabel(pack,item.chapterId)}`,state.query));
    state.page=Math.min(state.page,Math.max(0,Math.ceil(candidates.length/12)-1));
    const start=state.page*12,items=candidates.slice(start,start+12);
    results.replaceChildren(items.length?el('div',{class:'case-grid'},...items.map(item=>link([el('div',{class:'case-photo'},imageThumb(record,item,'',dispose=>thumbnails.push(dispose)),badge(chapterLabel(pack,item.chapterId))),el('div',{class:'case-card-copy'},el('h3',{},item.title),el('p',{},pack.diagnoses.find(d=>d.id===item.diagnosisIds[0])?.label || 'Interpretare din notițe'),el('div',{class:'case-meta'},el('span',{},coverageLabel(item)),state.visited.includes(visitKey(record,item))?icon('check',14):el('span',{},'Deschide →')))],`#case/${item.id}`,'case-card'))):el('div',{class:'no-results'},'Niciun caz nu corespunde filtrelor.'));
    if(candidates.length>12)results.append(el('div',{class:'pagination'},button('Înapoi',()=>{state.page--;draw();},'button secondary',{disabled:state.page===0}),el('span',{},`${start+1}–${Math.min(start+12,candidates.length)} din ${candidates.length}`),button('Înainte',()=>{state.page++;draw();},'button secondary',{disabled:start+12>=candidates.length})));
  }
  draw();
}

async function renderReader(main,id){
  const record=active();if(!record){main.append(noPack());return;}const pack=record.pack,item=pack.cases.find(row=>row.id===id);
  if(!item){main.append(el('div',{class:'empty-state'},el('h2',{},'Cazul nu este în acest pachet.'),link('Înapoi la cazuri','#cases','button')));return;}
  const key=visitKey(record,item);
  const comparisons=caseComparisonLayers(pack,item);
  if(!state.visited.includes(key)){state.visited.push(key);setMeta('visited',state.visited).catch(error=>toast(friendlyError(error),true));}
  const bookmark=button(icon('bookmark',17),act(async()=>{const exists=state.bookmarks.includes(key);state.bookmarks=exists?state.bookmarks.filter(v=>v!==key):[...state.bookmarks,key];await setMeta('bookmarks',state.bookmarks);bookmark.classList.toggle('active',!exists);bookmark.setAttribute('aria-pressed',String(!exists));toast(exists?'Caz eliminat din salvate.':'Caz salvat.');}),`icon-button ${state.bookmarks.includes(key)?'active':''}`,{'aria-label':'Salvează cazul','aria-pressed':String(state.bookmarks.includes(key))});
  const exercise = interpretationExercise(item);
  const assessment = exercise && matchingProgress(state.selfAssessments[progressKey(record.id, exercise.id, exercise.kind)], exercise);
  const lastAssessment = assessment?.scores?.length
    ? button('Ultima autoevaluare', () => openLastAssessment(item, assessment), 'button ghost')
    : null;
  main.append(el('header',{class:'reader-header'},link([icon('back',14),'Toate cazurile'],'#cases','button ghost'),el('div',{class:'section-head'},el('h1',{},item.title),el('div',{class:'button-row'},bookmark,lastAssessment,button([icon('exam',15),'Exersează cazul'],act(()=>openCasePractice(record,item)),'button secondary'))),el('div',{class:'reader-meta'},badge(chapterLabel(pack,item.chapterId),'green'),item.completeness!=='full'?badge(coverageLabel(item),'orange'):null,item.source.page?el('span',{},`Notițe, pagina ${item.source.page}`):null)));
  const notes=caseInterpretation(item,itemId=>viewer.selectItem(itemId));
  const viewer=imageViewer(record,item,{comparisons,mode:state.viewerMode,onModeChange:setViewerMode,
    onSelect:itemId=>notes.select(itemId,true),
  });
  registerCleanup(()=>viewer.destroy());
  main.append(el('div',{class:'reader-grid'},viewer.node,notes.node));
  const differentialLinks=(item.sections.find(section=>section.id==='differentials')?.items||[]).filter(row=>row.targetCaseId);
  if(differentialLinks.length){
    const panel=el('section',{class:'differential-panel'},el('div',{class:'section-head'},el('h2',{},'Diagnostice diferențiale')),el('p',{class:'field-help'},'Deschide un caz comparativ într-o fereastră, fără să părăsești cazul curent.'));
    for(const row of differentialLinks){
      const target=pack.cases.find(caseRow=>caseRow.id===row.targetCaseId);if(!target)continue;
      panel.append(el('div',{class:'differential-row'},el('div',{},el('strong',{},row.text),el('small',{},`${target.title} · ${chapterLabel(pack,target.chapterId)}`)),button([icon('eye',15),'Compară'],()=>openCasePreview(record,target),'button secondary')));
    }
    main.append(panel);
  }
  const index=pack.cases.indexOf(item);
  main.append(el('div',{class:'reader-pager'},index>0?link([icon('back',15),'Cazul anterior'],`#case/${pack.cases[index-1].id}`,'button secondary'):el('span'),index<pack.cases.length-1?link(['Cazul următor',icon('arrow',15)],`#case/${pack.cases[index+1].id}`,'button'):link('Toate cazurile','#cases','button')));
}

function openCasePreview(record,target){
  const viewer=imageViewer(record,target,{mode:state.viewerMode});
  const body=el('div',{class:'case-preview'},
    el('div',{class:'case-preview-head'},viewer.node,badge(chapterLabel(record.pack,target.chapterId),'green')),
    el('p',{class:'case-preview-note'},'Previzualizare comparativă. Cazul principal rămâne deschis; închide fereastra pentru a reveni.'),
    el('div',{class:'diagnosis-line'},el('span',{},'Diagnostic pozitiv'),el('strong',{},canonicalDiagnosisLabels(record,target.id).join('; ') || 'Neprecizat în sursă')),
    ...SECTION_ORDER.map(sectionId=>{const section=target.sections.find(row=>row.id===sectionId);return el('section',{class:'explanation-section'},el('h3',{},SECTION_LABELS[sectionId]),section?.items.length?el('ul',{},...section.items.map(item=>el('li',{},item.text))):el('p',{class:'missing'},'Nu este precizat în notițele sursă.'));}));
  const dialog=modal(target.title,body,[button('Înapoi la caz',()=>dialog.close(),'button secondary')]);
  dialog.classList.add('explanation-modal');
  const cleanup=()=>{viewer.destroy();dialog.classList.remove('explanation-modal');dialog.removeEventListener('close',cleanup);};
  dialog.addEventListener('close',cleanup);
}

const METHOD_COPY = Object.freeze({
  catalogue: 'Scrii diagnosticul și îl verifici comparându-l cu răspunsul de referință.',
  interpretation: 'Interpretezi radiografia și îți dai o notă de la 0 la 10 pentru fiecare punct din explicație.',
});
const STUDY_METHODS = Object.keys(METHOD_COPY);
const SESSION_VERSION = 2;

function renderPractice(main, mode) {
  const record = active();
  if (!record) {
    main.append(noPack());
    return;
  }
  const session = state.session;
  if (session && session.packId === record.id && session.revision === record.pack.revision && session.mode === mode) {
    if (session.finished) renderResults(main, record, session);
    else renderQuestion(main, record, session);
    return;
  }

  const exam = mode === 'exam';
  const startLabel = exam ? 'Începe simularea' : 'Începe recapitularea';
  main.append(heading(exam ? 'Simulare' : 'Recapitulare', exam
    ? 'Exersează cazuri din capitolele alese. Verifici răspunsurile la final.'
    : 'Reia cazurile care merită revizuite. Verifici răspunsul după fiecare caz.'));
  if (session && !session.finished) {
    const target = session.mode === 'exam' ? 'exam' : 'practice';
    main.append(el('div', { class: 'resume-banner' },
      el('span', {}, 'Ai o sesiune începută. Răspunsurile sunt păstrate.'),
      button('Continuă sesiunea', act(async () => {
        await setMeta('activeId', session.packId);
        state.activeId = session.packId;
        if (location.hash === '#' + target) await render();
        else location.hash = target;
      }), 'button secondary'),
      button('Încheie', () => confirmFinishSession(), 'button ghost')));
  }

  const { pack } = record;
  const scopes = pack.curriculum.scopes;
  const scopeSelect = scopes.length > 1 ? el('select', { class: 'select', 'aria-label': 'Ce parte din materie' },
    ...scopes.map(scope => el('option', { value: scope.id }, scope.label))) : null;
  const chapterSelect = el('select', { class: 'select', 'aria-label': 'Capitole' });
  const count = el('input', { class: 'number-input', type: 'number', min: '1', max: '100', value: '5', inputmode: 'numeric' });
  const available = el('p', { class: 'field-help' });
  const methodBox = el('fieldset', { class: 'method-grid' });
  let method = 'catalogue';
  let pool = [];
  const start = button([startLabel, icon('arrow', 16)], act(async () => {
    const requested = Number(count.value);
    requireThat(Number.isInteger(requested) && requested >= 1 && requested <= Math.min(100, pool.length),
      'Alege un număr valid de cazuri.');
    const history = method === 'catalogue' ? state.progress : state.selfAssessments;
    start.disabled = true;
    try { await beginSession(record, chooseQuestions(pool, history, record.id, requested, mode), mode); }
    catch (error) { start.disabled = false; throw error; }
  }), 'button large');

  function scopeChapters() {
    return scopeSelect ? scopes.find(scope => scope.id === scopeSelect.value).chapterIds
      : pack.curriculum.chapters.map(chapter => chapter.id);
  }

  function drawChapters() {
    const allowed = scopeChapters();
    chapterSelect.replaceChildren(el('option', { value: 'all' }, 'Toate capitolele'),
      ...pack.curriculum.chapters.filter(chapter => allowed.includes(chapter.id))
        .map(chapter => el('option', { value: chapter.id }, chapter.label)));
    drawMethods();
  }

  function drawMethods() {
    const chapterIds = chapterSelect.value === 'all' ? scopeChapters() : [chapterSelect.value];
    const pools = availableExercises(pack, { chapterIds });
    if (!pools[method].length) method = STUDY_METHODS.find(id => pools[id].length) || 'catalogue';
    pool = pools[method];
    const max = Math.min(100, pool.length);
    count.max = String(max || 1);
    if (Number(count.value) > max) count.value = String(max || 1);
    available.textContent = max ? max + ' cazuri disponibile pentru selecția ta.' : 'Nu există exerciții pentru selecția curentă.';
    start.disabled = !max;
    methodBox.replaceChildren(el('legend', { class: 'field-label' }, 'Ce vrei să exersezi?'),
      ...STUDY_METHODS.map(id => {
        const enabled = pools[id].length > 0;
        return el('label', { class: 'method-card' + (method === id ? ' active' : '') + (enabled ? '' : ' disabled') },
          el('input', { type: 'radio', name: 'method', value: id, checked: method === id, disabled: !enabled,
            onchange: () => { method = id; drawMethods(); methodBox.querySelector('input:checked')?.focus(); } }),
          el('span', { class: 'method-copy' }, el('strong', {}, EXERCISE_LABELS[id]),
            el('span', {}, METHOD_COPY[id]), el('span', { class: 'method-count' }, pools[id].length + ' cazuri disponibile')));
      }));
  }

  scopeSelect?.addEventListener('change', drawChapters);
  chapterSelect.addEventListener('change', drawMethods);
  const form = el('form', { class: 'setup-form', onsubmit: event => { event.preventDefault(); start.click(); } },
    el('div', { class: 'form-group' }, methodBox),
    scopeSelect ? el('div', { class: 'form-group' }, el('label', { class: 'field-label' }, 'Ce parte din materie', scopeSelect)) : null,
    el('div', { class: 'form-group' }, el('label', { class: 'field-label' }, 'Capitole', chapterSelect)),
    el('div', { class: 'form-group' }, el('label', {}, el('span', { class: 'field-label' }, 'Număr de cazuri'), count), available), start);
  main.append(form);
  drawChapters();
}

async function beginSession(record, questions, mode) {
  requireThat(questions.length, 'Pachetul nu conține exerciții pentru această selecție.');
  const next = { version: SESSION_VERSION, packId: record.id, revision: record.pack.revision, mode,
    startedAt: Date.now(), index: 0, finished: false, answers: [], questions };
  await commitSession(next);
  const route = mode === 'exam' ? 'exam' : 'practice';
  if (location.hash !== '#' + route) location.hash = route;
  else await render();
}

async function openCasePractice(record, item) {
  const pools = availableExercises(record.pack, { chapterIds: [item.chapterId] });
  const options = STUDY_METHODS.map(id => pools[id].find(q => q.caseId === item.id)).filter(Boolean);
  if (!options.length) {
    toast('Acest caz nu are încă note de verificat.', true);
    return;
  }
  const start = async question => {
    const dialog = document.getElementById('modal');
    if (dialog.open) dialog.close();
    await beginSession(record, [question], 'review');
  };
  if (options.length === 1) {
    await start(options[0]);
    return;
  }
  modal('Cum vrei să exersezi cazul?', el('div', { class: 'method-picker' }, ...options.map(question =>
    button([el('strong', {}, exerciseLabel(question)), el('span', {}, METHOD_COPY[question.kind])],
      act(() => start(question)), 'method-pick'))),
  [button('Renunță', () => document.getElementById('modal').close(), 'button secondary')]);
}

async function commitSession(nextSession, nextProgress = null, nextAssessments = null) {
  const values = { session: nextSession };
  if (nextProgress) values.progress = nextProgress;
  if (nextAssessments) values.selfAssessments = nextAssessments;
  await setMetas(values);
  state.session = nextSession;
  if (nextProgress) state.progress = nextProgress;
  if (nextAssessments) state.selfAssessments = nextAssessments;
}

const scoreFormatter = new Intl.NumberFormat('ro', { maximumFractionDigits: 1 });
const scoreLabel = score => scoreFormatter.format(score) + '/10';

function noteRatingPanel(source, answer, onChange) {
  const notes = selfAssessmentItems(source);
  const ratings = new Map((answer.scores || []).map(row => [row.id, row.score]));
  const groups = new Map();
  for (const note of notes) {
    if (!groups.has(note.sectionId)) groups.set(note.sectionId, []);
    groups.get(note.sectionId).push(note);
  }
  const root = el('div', { class: 'self-check' }, el('h3', {}, 'Autoevaluare'),
    el('p', { class: 'field-help' }, answer.scores
      ? 'Notele tale pentru fiecare punct din explicație.'
      : 'Compară interpretarea ta cu explicația. Alege o notă pentru fiecare punct, de la 0 (omis sau greșit) la 10 (complet și corect).'));
  for (const [sectionId, rows] of groups) {
    const group = el('section', { class: 'self-check-group' }, el('h4', {}, SECTION_LABELS[sectionId]));
    for (const note of rows) {
      const options = Array.from({ length: 11 }, (_, score) =>
        el('option', { value: String(score), selected: ratings.get(note.id) === score }, String(score)));
      const input = el('select', { class: 'select', disabled: !onChange },
        el('option', { value: '', disabled: true, selected: !ratings.has(note.id) }, '0–10'), ...options);
      input.addEventListener('change', () => {
        ratings.set(note.id, Number(input.value));
        onChange?.(notes.map(row => ({ id: row.id, score: ratings.get(row.id) })));
      });
      group.append(el('label', { class: 'self-check-row note-score-row' }, el('span', {}, note.text), input));
    }
    root.append(group);
  }
  return root;
}

function openLastAssessment(source, assessment) {
  const body = el('div', { class: 'explanation-body' },
    el('p', {}, scoreLabel(assessmentMean(assessment.scores)) + ' · ' + dateLabel(assessment.lastAt)),
    noteRatingPanel(source, assessment));
  const dialog = modal('Ultima autoevaluare', body,
    [button('Închide', () => dialog.close(), 'button secondary')]);
}

function diagnosisReference(record, source) {
  const labels = canonicalDiagnosisLabels(record, source);
  const items = diagnosisNotes(source);
  return el('div', { class: 'feedback' }, el('h3', {}, 'Diagnostic de referință'),
    ...[...new Set([...labels, ...items])].map(text => el('p', {}, text)));
}

function diagnosisNotes(source) {
  return selfAssessmentItems(source).filter(item => item.sectionId === 'diagnosis').map(item => item.text);
}

function learnerAnswerBlock(q, answer) {
  if (q.kind === 'catalogue') return el('p', {}, answer.text || '—');
  return el('div', {}, ...q.sections.filter(section => answer.textAnswers?.[section.id]).map(section =>
    el('div', { class: 'learner-section' }, el('strong', {}, section.label), el('p', {}, answer.textAnswers[section.id]))));
}

function attemptRecord(record, q, answer, selfAssessed) {
  const key = progressKey(record.id, q.id, q.kind);
  const history = selfAssessed ? state.selfAssessments : state.progress;
  const previous = matchingProgress(history[key], q);
  const updated = selfAssessed
    ? recordSelfAssessment(previous, answer.scores)
    : scheduleReview(previous, answer.correct);
  return { ...history, [key]: { ...updated, signature: questionSignature(q), sectionId: q.sectionId,
    chapterId: q.chapterId, caseId: q.caseId } };
}

async function saveVerification(record, index, verification, advance) {
  const session = state.session;
  const answer = session.answers[index];
  if (!answer || answer.skipped || typeof answer.correct === 'boolean' || answer.scores) return;
  const q = session.questions[index];
  const rating = q.kind === 'interpretation';
  const updated = { ...answer, ...verification };
  const next = advance ? advanceSession(session, updated) : sessionAnswer(session, updated, index);
  const history = attemptRecord(record, q, updated, rating);
  await commitSession(next, rating ? null : history, rating ? history : null);
}

function verificationControls(record, q, source, answer, onVerify, actionLabel) {
  const root = el('div');
  if (q.kind === 'catalogue') {
    root.append(diagnosisReference(record, source));
    if (onVerify) {
      root.append(el('p', { class: 'field-help' }, 'Compară diagnosticul tău cu referința.'),
        el('div', { class: 'question-actions' },
          button('De revăzut', act(() => onVerify({ correct: false })), 'button secondary'),
          button('Corect', act(() => onVerify({ correct: true })))));
    }
    return root;
  }
  let scores;
  const save = onVerify ? button(actionLabel, act(() => onVerify({ scores })), 'button', { disabled: true }) : null;
  root.append(noteRatingPanel(source, answer, onVerify ? rows => {
    scores = rows;
    save.disabled = !scores.length || !scores.every(row => validNoteScore(row.score));
  } : null));
  if (save) root.append(el('div', { class: 'question-actions' }, save));
  return root;
}

function renderQuestion(main, record, session) {
  const q = session.questions[session.index];
  const source = q && record.pack.cases.find(item => item.id === q.caseId);
  if (!source) { main.append(noPack()); return; }

  const stored = session.answers[session.index];
  const review = session.mode === 'review';
  const final = session.index + 1 === session.questions.length;
  const diagnosis = q.kind === 'catalogue';
  let busy = false;
  async function proceed(action) {
    if (busy) return;
    busy = true;
    try {
      await action();
      await render();
    } finally { busy = false; }
  }

  main.append(el('div', { class: 'quiz-top' },
    button([icon('back', 14), 'Pauză'], () => { location.hash = 'library'; }, 'button ghost'),
    bar(pct(session.index, session.questions.length)),
    el('span', { class: 'quiz-counter' }, (session.index + 1) + ' / ' + session.questions.length + ' · ' + (review ? 'Recapitulare' : 'Simulare')),
    button('Încheie', () => { if (!busy) confirmFinishSession(); }, 'button ghost')));

  const subject = stored ? source : { ...source, title: 'Caz de verificat' };
  const viewer = imageViewer(record, subject, { allowAnnotations: Boolean(stored),
    comparisons: stored ? caseComparisonLayers(record.pack, source) : [],
    mode: state.viewerMode, onModeChange: setViewerMode });
  registerCleanup(() => viewer.destroy());
  const panel = el('section', { class: 'question-panel', 'aria-label': 'Exercițiu' },
    badge(exerciseLabel(q), 'green'), el('h2', {}, q.prompt));

  if (stored) {
    if (diagnosis || Object.keys(stored.textAnswers || {}).length) {
      panel.append(el('div', { class: 'learner-answer' },
        el('span', {}, 'Răspunsul tău'), learnerAnswerBlock(q, stored)));
    }
    panel.append(verificationControls(record, q, source, stored,
      verification => proceed(() => saveVerification(record, session.index, verification, true)),
      final ? 'Salvează și vezi rezultatul' : 'Salvează și continuă'));
  } else {
    const fields = new Map();
    const submitLabel = review
      ? diagnosis ? 'Vezi diagnosticul' : 'Vezi notițele'
      : final ? 'Finalizează simularea' : 'Confirmă și continuă';
    const submit = button(submitLabel, act(() => proceed(async () => {
      const payload = { at: Date.now() };
      if (diagnosis) {
        payload.text = fields.get('diagnosis').value.trim();
        if (!payload.text) return;
      } else {
        payload.textAnswers = Object.fromEntries([...fields].map(([id, field]) => [id, field.value.trim()])
          .filter(([, text]) => text));
      }
      await commitSession(review ? sessionAnswer(session, payload) : advanceSession(session, payload));
    })), 'button', { disabled: diagnosis });

    function addField(id, label, help = null) {
      const input = el('textarea', { class: 'interpretation-input', rows: diagnosis ? '2' : '3', maxlength: '4000' });
      fields.set(id, input);
      if (diagnosis) input.addEventListener('input', () => { submit.disabled = !input.value.trim(); });
      panel.append(el('label', { class: 'interpretation-field' }, el('span', { class: 'field-label' }, label),
        help ? el('span', { class: 'field-help' }, help) : null, input));
    }

    if (diagnosis) addField('diagnosis', 'Diagnosticul tău');
    else {
      panel.append(el('p', { class: 'field-help' }, 'Poți scrie răspunsurile sau le poți formula în gând înainte să vezi notițele.'));
      for (const section of q.sections) addField(section.id, section.label, SECTION_PROMPTS[section.id]);
    }
    panel.append(el('div', { class: 'question-actions' },
      button('Sari peste', act(() => proceed(() => commitSession(advanceSession(session, { skipped: true, at: Date.now() })))), 'button ghost'),
      submit));
  }
  main.append(el('div', { class: 'quiz-grid' }, viewer.node, panel));
}

function confirmFinishSession() {
  const session = state.session;
  if (!session || session.finished) return;
  const answered = receivedAnswers(session).length;
  const dialog = modal('Închei sesiunea?', el('p', { class: 'modal-body' }, answered
    ? 'Ai răspuns la ' + answered + ' cazuri. Poți verifica răspunsurile rămase din pagina de rezultate.'
    : 'Nu ai răspuns la niciun caz. Sesiunea va fi închisă.'), [
    button('Continuă sesiunea', () => dialog.close(), 'button secondary'),
    button(answered ? 'Încheie și vezi rezultatele' : 'Închide sesiunea', act(async event => {
      const action = event.currentTarget;
      action.disabled = true;
      try {
        const next = answered ? finishSessionEarly(state.session) : null;
        if (next && state.activeId !== session.packId) {
          await setMeta('activeId', session.packId);
          state.activeId = session.packId;
        }
        await commitSession(next);
        dialog.close();
        const target = session.mode === 'exam' ? 'exam' : 'practice';
        if (location.hash === '#' + target) await render();
        else location.hash = target;
      } finally { action.disabled = false; }
    }), 'button danger'),
  ]);
}

function exerciseStatus(q, answer) {
  if (answer.skipped) return { label: 'Sărit', kind: 'neutral' };
  if (q.kind === 'interpretation') {
    const mean = assessmentMean(answer.scores);
    return { label: mean === null ? 'De autoevaluat' : scoreLabel(mean), kind: 'neutral' };
  }
  if (answer.correct === true) return { label: 'Corect', kind: 'green' };
  if (answer.correct === false) return { label: 'De revăzut', kind: 'orange' };
  return { label: 'De verificat', kind: 'neutral' };
}

function openExplanation(record, session, index) {
  const q = session.questions[index], answer = session.answers[index];
  const source = record.pack.cases.find(item => item.id === q.caseId);
  if (!source) return;

  const viewer = imageViewer(record, source, { comparisons: caseComparisonLayers(record.pack, source),
    mode: state.viewerMode, onModeChange: setViewerMode });
  const notes = caseInterpretation(source, itemId => viewer.selectItem(itemId));
  const reviewed = typeof answer.correct === 'boolean' || Boolean(answer.scores);
  let saving = false;
  const verify = answer.skipped || reviewed ? null : async verification => {
    if (saving) return;
    saving = true;
    try {
      await saveVerification(record, index, verification, false);
      dialog.close();
      await render();
    } finally { saving = false; }
  };

  const body = el('div', { class: 'explanation-body' },
    el('div', { class: 'explanation-figure' }, viewer.node),
    answer.text || Object.values(answer.textAnswers || {}).some(Boolean)
      ? el('div', { class: 'learner-answer' }, el('span', {}, 'Răspunsul tău'), learnerAnswerBlock(q, answer))
      : null,
    answer.skipped && q.kind === 'interpretation' ? null
      : verificationControls(record, q, source, answer, verify, 'Salvează autoevaluarea'),
    el('details', { class: 'complete-explanation' }, el('summary', {}, 'Vezi explicația completă'), notes.node));
  const dialog = modal(source.title + ' · ' + exerciseLabel(q), body,
    [button('Înapoi la rezultate', () => dialog.close(), 'button secondary')]);
  dialog.classList.add('explanation-modal');
  dialog.addEventListener('close', () => {
    viewer.destroy();
    dialog.classList.remove('explanation-modal');
  }, { once: true });
}

function renderResults(main, record, session) {
  const rows = session.questions.map((q, index) => ({ q, answer: session.answers[index], index }))
    .filter(row => row.answer);
  const verified = rows.filter(row => typeof row.answer.correct === 'boolean');
  const scores = rows.flatMap(row => row.answer.scores || []);
  const pending = rows.filter(row => !row.answer.skipped && !row.answer.scores && typeof row.answer.correct !== 'boolean').length;
  const summary = el('div', { class: 'results-summary' });
  if (verified.length) summary.append(el('div', { class: 'summary-card' },
    el('strong', {}, verified.filter(row => row.answer.correct).length + ' din ' + verified.length),
    el('span', {}, 'diagnostice corecte')));
  if (scores.length) summary.append(el('div', { class: 'summary-card' },
    el('strong', {}, scoreLabel(assessmentMean(scores))), el('span', {}, 'media notelor')));
  if (pending) summary.append(el('div', { class: 'summary-card' }, el('strong', {}, pending), el('span', {}, 'cazuri de verificat')));
  if (!verified.length && !scores.length && !pending) summary.append(el('div', { class: 'summary-card' },
    el('strong', {}, '0'), el('span', {}, 'cazuri verificate')));

  main.append(heading(session.finishedEarly ? 'Sesiune încheiată devreme' : 'Rezultate', pending
    ? 'Deschide fiecare caz pentru a compara răspunsul tău cu explicația.'
    : 'Poți revedea explicațiile oricând în această sesiune.'), summary);
  const list = el('div', { class: 'result-list' });
  for (const { q, answer, index } of rows) {
    const source = record.pack.cases.find(item => item.id === q.caseId);
    if (!source) continue;
    const status = exerciseStatus(q, answer);
    const open = () => openExplanation(record, session, index);
    const thumb = button(imageThumb(record, source, 'result-image'), open, 'result-thumb',
      { 'aria-label': 'Vezi explicația pentru ' + source.title });
    const text = answer.skipped ? 'Sărit' : q.kind === 'catalogue'
      ? 'Răspunsul tău: ' + answer.text
      : answer.scores ? 'Autoevaluare: ' + status.label : status.label;
    const detail = typeof answer.correct === 'boolean'
      ? el('p', { class: 'result-answer ' + (answer.correct ? 'right' : 'wrong') }, status.label)
      : null;
    const labels = answer.correct === false ? canonicalDiagnosisLabels(record, source) : [];
    const reference = answer.correct === false
      ? el('p', { class: 'result-answer right' }, 'Diagnostic de referință: ' + (labels.length ? labels : diagnosisNotes(source)).join(', '))
      : null;
    const action = answer.skipped || answer.scores || typeof answer.correct === 'boolean' ? 'Vezi explicația'
      : q.kind === 'interpretation' ? 'Autoevaluează' : 'Verifică diagnosticul';
    list.append(el('article', { class: 'result-tile ' + status.kind }, thumb, el('div', { class: 'result-copy' },
      el('h3', { class: 'result-heading' }, source.title + ' · ' + exerciseLabel(q)),
      el('div', { class: 'result-answers' }, el('p', { class: 'result-answer muted' }, text), detail, reference),
      button(action, open, 'button secondary'))));
  }
  main.append(list);
  const unanswered = session.questions.length - rows.length;
  if (unanswered) main.append(el('p', { class: 'field-help' }, unanswered + ' cazuri nu au fost parcurse.'));
  main.append(el('div', { class: 'button-row' },
    button('O sesiune nouă', act(async () => { await commitSession(null); await render(); })),
    link('Continuă studiul', '#library', 'button secondary')));
}

function progressData(record) {
  const pools = availableExercises(record.pack);
  const data = (questions, history) => questions.flatMap(q => {
    const progress = matchingProgress(history[progressKey(record.id, q.id, q.kind)], q);
    return progress ? [{ q, progress }] : [];
  });
  return { diagnoses: data(pools.catalogue, state.progress), assessed: data(pools.interpretation, state.selfAssessments) };
}

function progressTotals(diagnoses, assessed) {
  return {
    attempts: diagnoses.reduce((sum, row) => sum + row.progress.attempts, 0),
    correct: diagnoses.reduce((sum, row) => sum + row.progress.correct, 0),
    due: [...diagnoses, ...assessed].filter(row => row.progress.dueAt <= Date.now()).length,
  };
}

function renderProgress(main) {
  const record = active();
  if (!record) { main.append(noPack()); return; }
  const { pack } = record;
  const { diagnoses, assessed } = progressData(record);
  const { attempts, correct, due } = progressTotals(diagnoses, assessed);
  const seen = pack.cases.filter(item => state.visited.includes(visitKey(record, item))).length;
  const mean = assessmentMean(assessed.flatMap(row => row.progress.scores || []));
  main.append(heading('Progres', 'Ce ai citit, ce ai exersat și ce merită revizuit.'));
  main.append(el('div', { class: 'stats-row' }, stat('Cazuri citite', seen + ' / ' + pack.cases.length),
    stat('Cazuri autoevaluate', assessed.length),
    stat('Media ultimelor autoevaluări', mean === null ? '—' : scoreLabel(mean)),
    stat('Diagnostice corecte', attempts ? pct(correct, attempts) + '%' : '—'),
    stat('De recapitulat', due)));

  const chapterRows = pack.curriculum.chapters.map(chapter => {
    const all = pack.cases.filter(item => item.chapterId === chapter.id);
    const visited = all.filter(item => state.visited.includes(visitKey(record, item))).length;
    const chapterDiagnoses = diagnoses.filter(row => row.q.chapterId === chapter.id);
    const chapterAssessed = assessed.filter(row => row.q.chapterId === chapter.id);
    const totals = progressTotals(chapterDiagnoses, chapterAssessed);
    return el('tr', {}, el('td', {}, chapter.label), el('td', {}, visited + ' / ' + all.length),
      el('td', {}, totals.attempts ? pct(totals.correct, totals.attempts) + '%' : '—'),
      el('td', {}, chapterAssessed.length), el('td', {}, totals.due));
  });
  main.append(el('section', { class: 'panel' }, el('div', { class: 'section-head' }, el('h2', {}, 'Pe capitole')),
    el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
      el('thead', {}, el('tr', {}, ...['Capitol', 'Cazuri citite', 'Diagnostice corecte', 'Autoevaluări', 'De recapitulat']
        .map(label => el('th', { scope: 'col' }, label)))), el('tbody', {}, ...chapterRows)))));

  const review = [...diagnoses, ...assessed].filter(row => !row.progress.lastCorrect)
    .sort((a, b) => b.progress.lastAt - a.progress.lastAt).slice(0, 6);
  if (review.length) {
    main.append(el('section', { class: 'panel' }, el('div', { class: 'section-head' }, el('h2', {}, 'De revizuit')),
      el('div', { class: 'result-list' }, ...review.map(({ q, progress }) => {
        const source = pack.cases.find(item => item.id === q.caseId);
        const mean = assessmentMean(progress.scores);
        const status = mean === null ? 'De revăzut' : scoreLabel(mean);
        return el('div', { class: 'result-row' }, el('div', { class: 'result-copy' },
          el('div', { class: 'section-head' }, el('h3', {}, source.title + ' · ' + exerciseLabel(q)), badge(status, 'orange')),
          el('p', {}, chapterLabel(pack, q.chapterId) + ' · ' + dateLabel(progress.lastAt)),
          link('Revezi cazul →', '#case/' + q.caseId, 'text-link')));
      }))));
  }
}


async function renderSettings(main,token){
  main.append(heading('Date & instalare','Copie de siguranță, instalare și materiale.'));
  const lastExport=await getMeta('lastExportAt',0);
  const [currentBuild,latest]=await Promise.all([activeBuildId(),latestRelease()]);
  if(token!==renderToken)return;
  const backup=el('section',{class:'settings-card'},el('h2',{},icon('download',19),'Copie de siguranță'),el('p',{},'Salvează progresul într-un fișier. Pentru imagini și explicații, folosește copia completă.'),
    el('div',{class:'detail-row'},el('span',{},'Ultima copie'),el('strong',{},dateLabel(lastExport))),
    el('div',{class:'detail-row'},el('span',{},'Build activ'),el('strong',{},currentBuild||'Se inițializează')),
    el('div',{class:'detail-row'},el('span',{},'Ultimul build publicat'),el('strong',{},latest?.buildId||'Nu poate fi verificat')),
    el('div',{class:'button-row'},button([icon('download',15),'Salvează progresul'],act(exportProgress)),button('Salvează tot, cu imagini',act(exportFull),'button secondary',{disabled:!state.packs.length})),
    el('div',{class:'button-row'},button([icon('upload',15),'Restaurează dintr-o copie'],()=>document.getElementById('backup-input').click(),'button ghost')),
    el('p',{class:'field-help'},'Fișierul de progres nu include imaginile. Copia completă le include.'));
  const install=el('section',{class:'settings-card'},el('h2',{},icon('plus',19),'Instalează RadioEasy'),el('p',{},'Deschide linkul direct în browser, apoi adaugă aplicația. Importă materialele din aplicația instalată pentru a păstra studiul în același loc.'),
    el('div',{class:'detail-row'},el('span',{},'Funcționează fără internet'),el('strong',{},state.offlineReady?'Da':'Nu încă')),
    button([icon('refresh',15),el('span',{'aria-live':'polite'},updateCheckLabel())],act(()=>checkForUpdates()),'button secondary update-check',{disabled:state.updateChecking}),
    button('Reîncarcă forțat',act(async()=>{
      if(state.session && !state.session.finished){toast('Încheie sesiunea înainte de repararea actualizării.',true);return;}
      if(!navigator.onLine){toast('Conectează-te la internet înainte de reparare.',true);return;}
      await forceRefresh();
    }),'button ghost',{title:'Resetează workerul și reîncarcă din rețea; materialele și progresul rămân salvate'}),
    el('p',{class:'field-help'},'Verifică aplicația și pachetul de curs. Actualizările păstrează materialele și progresul compatibil.'),
    state.prompt?button('Instalează aplicația',act(async()=>{await state.prompt.prompt();state.prompt=null;await render();})):null,
    el('ol',{class:'install-steps'},el('li',{},'iPhone / iPad: Safari → Partajează → Adaugă pe ecranul principal.'),el('li',{},'Android: Chrome → meniu → Instalează / Adaugă pe ecranul principal.'),el('li',{},'Windows: Chrome sau Edge → pictograma de instalare din bara de adrese.'),el('li',{},'macOS: Safari → Fișier → Adaugă în Dock; sau instalare din Chrome/Edge.')),
    el('details',{class:'help-details'},el('summary',{},'Ai deschis linkul din Discord sau altă aplicație?'),el('p',{},'Deschide meniul linkului și alege Safari sau Chrome. Dacă opțiunea lipsește, copiază linkul și lipește-l în browser.')));
  const privacy=el('section',{class:'settings-card'},el('h2',{},icon('shield',19),'Datele rămân pe dispozitiv'),el('p',{},'Fără cont, reclame sau trimiterea materialelor către un server. Materialele, răspunsurile și progresul sunt salvate local.'));
  const reset=el('section',{class:'settings-card'},el('h2',{},icon('refresh',19),'Resetează progresul'),el('p',{},'Șterge răspunsurile, autoevaluările și istoricul cazurilor parcurse. Materialele instalate și cazurile salvate rămân pe dispozitiv.'),
    el('div',{class:'button-row'},button('Resetează progresul',()=>confirmResetLearning(),'button danger')));
  const packs=el('section',{class:'settings-card full'},el('h2',{},icon('book',19),'Materiale pe acest dispozitiv'));
  if(!state.packs.length)packs.append(el('p',{},'Niciun material importat încă.'));
  for(const record of state.packs)packs.append(el('div',{class:'detail-row'},el('div',{},el('strong',{},record.pack.title),el('p',{class:'field-help'},`${record.pack.cases.length} cazuri`)),
    el('div',{class:'button-row'},button('Salvează pachetul',act(()=>exportPack(record)),'button secondary'),button('Elimină',()=>confirmRemove(record),'button danger'))));
  main.append(el('div',{class:'settings-grid'},backup,install,privacy,reset,packs));
}

function jobDialog(title,message){
  const controller=new AbortController(),text=el('p',{},message),progress=el('progress',{max:'1',value:0});
  let finished=false,locked=false;
  const cancel=button('Anulează',()=>{controller.abort();dialog.close();},'button secondary');
  const dialog=modal(title,el('div',{class:'import-progress'},text,progress),[cancel]);
  const onClose=()=>{if(!finished && !locked)controller.abort();};
  const onCancel=event=>{if(locked)event.preventDefault();else controller.abort();};
  dialog.addEventListener('close',onClose);dialog.addEventListener('cancel',onCancel);
  return {signal:controller.signal,update(value,message){if(controller.signal.aborted)throw new DOMException('Operație anulată.','AbortError');progress.value=value;if(message)text.textContent=message;},
    lock(){locked=true;cancel.disabled=true;dialog.querySelector('.modal-head button').disabled=true;},
    finish(){finished=true;dialog.removeEventListener('close',onClose);dialog.removeEventListener('cancel',onCancel);dialog.close();}};
}

function download(blob,name){
  const url=URL.createObjectURL(blob),a=el('a',{href:url,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30_000);
}
async function recordExport(){await setMeta('lastExportAt',Date.now());toast('Copia a fost descărcată. Păstreaz-o într-un loc sigur.');if(state.route==='settings')await render();}
async function exportProgress(){const snapshot=await learningSnapshot(state.packs);download(new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'}),`radioeasy-progres-${new Date().toISOString().slice(0,10)}.json`);await recordExport();}

async function listStudyPacks() {
  return (await listPacks()).map(record => ({
    ...record, originalPack: record.pack, pack: packWithoutAnswerBanks(record.pack),
  }));
}

async function filesForPack(record, { prefix = '', preserveLegacy = false } = {}) {
  const pack = preserveLegacy ? record.originalPack : record.pack;
  const files=[{name:prefix+'pack.json',data:JSON.stringify(pack)}];
  if(preserveLegacy && record.bank)files.push({name:prefix+'questions.json',data:JSON.stringify(record.bank)});
  for(const asset of await packAssets(record))files.push({name:prefix+asset.path,data:asset.blob});return files;
}

async function exportPack(record){
  if(activeExport)return;activeExport=true;const job=jobDialog('Se pregătește pachetul','Imaginile și explicațiile sunt împachetate pe acest dispozitiv.');
  try{const files=await filesForPack(record),result=await archiveJob('write',{files},p=>job.update(p),job.signal);job.finish();download(result.blob,`${record.id}-${record.pack.revision}.study.zip`);toast('Exportul pachetului a fost pornit.');}
  catch(error){job.finish();if(error.name!=='AbortError')throw error;}finally{activeExport=false;}
}

async function exportFull(){
  if(activeExport)return;activeExport=true;const job=jobDialog('Se pregătește copia completă','Materialele și progresul sunt citite local.');
  try{
    const snapshot=await learningSnapshot(state.packs),files=[];snapshot.packFolders=[];
    for(const [i,record] of state.packs.entries()){const folder=`packs/${String(i).padStart(3,'0')}/`;snapshot.packFolders.push({folder,id:record.id,revision:record.pack.revision});files.push(...await filesForPack(record,{prefix:folder,preserveLegacy:true}));job.update((i+1)/state.packs.length*.2);}
    files.unshift({name:'backup.json',data:JSON.stringify(snapshot)});
    const result=await archiveJob('write',{files},p=>job.update(.2+p*.8,'Se scrie arhiva de backup…'),job.signal);
    job.finish();download(result.blob,`radioeasy-backup-complet-${new Date().toISOString().slice(0,10)}.zip`);await recordExport();
  }catch(error){job.finish();if(error.name!=='AbortError')throw error;}finally{activeExport=false;}
}

async function importPackFile(file){
  if(installing)return;requireThat(file.size<=LIMITS.archive,'Pachetul depășește limita de 32 MiB. Împarte colecția în pachete mai mici.');installing=true;
  const job=jobDialog('Se importă pachetul','Se verifică arhiva și imaginile…');
  try{
    const result=await archiveJob('read',{file},p=>job.update(p*.45),job.signal);
    const prepared=await validateFiles(result.files,p=>job.update(.45+p*.5,'Se verifică integritatea imaginilor…'));
    job.update(.95,'Se salvează pachetul pe dispozitiv…');
    const existing=state.packs.find(row=>row.id===prepared.pack.id);
    if(existing){
      job.finish();installing=false;
      modal('Înlocuiește pachetul?',el('p',{class:'modal-body'},`${prepared.pack.title}, versiunea ${prepared.pack.revision}, conține ${prepared.pack.cases.length} de cazuri. Va înlocui versiunea ${existing.pack.revision}. Progresul compatibil și cazurile salvate rămân păstrate.`),[
        button('Renunță',()=>document.getElementById('modal').close(),'button secondary'),button('Înlocuiește',act(async()=>{document.getElementById('modal').close();await commitPack(prepared);})),
      ]);return;
    }
    job.lock();await commitPack(prepared);job.finish();
  }catch(error){job.finish();if(error.name!=='AbortError')throw error;}finally{installing=false;}
}

async function commitPack(prepared){
  await installPacks([prepared]);state.packs=await listStudyPacks();state.activeId=prepared.pack.id;
  if(state.session?.packId===prepared.pack.id){state.session=null;await setMeta('session',null);}
  await setMeta('activeId',state.activeId);state.chapter='all';state.page=0;state.query='';location.hash='library';await render();toast(`${prepared.pack.cases.length} de cazuri sunt disponibile pe acest dispozitiv.`);
}

async function restoreBackup(file){
  if(file.name.toLowerCase().endsWith('.json')){await restoreLearningFile(file);await reloadLearning();await render();toast('Progresul și cazurile salvate au fost restaurate.');return;}
  if(installing)return;requireThat(file.size<=LIMITS.archive,'Backupul depășește limita de 32 MiB.');installing=true;
  const job=jobDialog('Se restaurează copia','Datele existente rămân intacte până la finalul verificării.');
  try{
    const result=await archiveJob('read',{file},p=>job.update(p*.4),job.signal),files=new Map(result.files.map(f=>[f.name,f.data]));
    requireThat(files.has('backup.json'),'Acesta este un pachet de studiu. Folosește „Importă pachet” din Bibliotecă.');
    const raw=parseJSON(new TextDecoder('utf-8',{fatal:true}).decode(files.get('backup.json'))),incoming=validateLearning(raw);
    requireThat(Array.isArray(raw.packFolders) && raw.packFolders.length<=100,'Lista pachetelor din backup este invalidă.');
    const prepared=[],used=new Set(['backup.json']),packIds=new Set(),folders=new Set();
    for(const [i,entry] of raw.packFolders.entries()){
      requireThat(typeof entry.folder==='string' && /^packs\/[0-9]{3}\/$/.test(entry.folder) && !folders.has(entry.folder),'Director de backup invalid.');folders.add(entry.folder);
      const subset=new Map();for(const [name,data] of files)if(name.startsWith(entry.folder)){subset.set(name.slice(entry.folder.length),data);used.add(name);}
      const candidate=await validateFiles(subset,p=>job.update(.4+(i+p)/Math.max(1,raw.packFolders.length)*.5));
      requireThat(candidate.pack.id===entry.id && candidate.pack.revision===entry.revision && !packIds.has(entry.id),'Identificare de pachet contradictorie în backup.');packIds.add(entry.id);prepared.push(candidate);
    }
    requireThat(used.size===files.size,'Backupul conține fișiere nerecunoscute.');
    const merged=await mergeLearning(incoming);job.update(.95,'Se salvează toate datele…');job.lock();await installPacks(prepared,merged);
    state.packs=await listStudyPacks();await reloadLearning();if(!active())state.activeId=state.packs[0]?.id;state.session=null;await setMeta('session',null);
    job.finish();await render();toast('Materialele și progresul au fost restaurate.');
  }catch(error){job.finish();if(error.name!=='AbortError')throw error;}finally{installing=false;}
}

function confirmRemove(record){
  modal('Elimini materialul de pe acest dispozitiv?',el('p',{class:'modal-body'},`Imaginile și explicațiile din „${record.pack.title}” vor fi eliminate. Progresul și cazurile salvate rămân păstrate pentru o eventuală reimportare. Exportă pachetul sau o copie completă înainte, dacă nu ai altă copie.`),[
    button('Renunță',()=>document.getElementById('modal').close(),'button secondary'),button('Elimină materialul',act(async()=>{await removePack(record);state.packs=await listStudyPacks();if(state.activeId===record.id)state.activeId=state.packs[0]?.id || null;if(state.session?.packId===record.id){state.session=null;await setMeta('session',null);}document.getElementById('modal').close();await render();toast('Material eliminat. Progresul a fost păstrat.');}),'button danger'),
  ]);
}

function confirmResetLearning(){
  modal('Resetezi progresul?',el('div',{class:'modal-body'},el('p',{},'Se șterg răspunsurile, autoevaluările, istoricul cazurilor citite sau exersate și sesiunea în curs.'),
    el('p',{},'Materialele instalate și cazurile salvate rămân pe dispozitiv. Progresul poate fi recuperat doar dintr-o copie de siguranță.')),[
    button('Renunță',()=>document.getElementById('modal').close(),'button secondary'),
    button('Resetează progresul',act(async()=>{
      await clearLearning();
      state.progress={};state.selfAssessments={};state.visited=[];state.session=null;
      document.getElementById('modal').close();toast('Progresul a fost resetat.');
      await render();
    }),'button danger'),
  ]);
}

async function loadStarter(){
  requireThat(state.starter && safePath(state.starter.path) && state.starter.path.startsWith('packs/'),'Pachetul de curs nu este configurat.');
  const response=await fetch(new URL(state.starter.path,document.baseURI));requireThat(response.ok,'Pachetul de curs nu poate fi descărcat. Importă fișierul ZIP original.');
  const blob=await response.blob();await importPackFile(new File([blob],'radiografii-explicate.study.zip',{type:'application/zip'}));
}

async function refreshDefaultPack(){
  const request=++defaultPackRequest;
  const manifest=await fetchDefaultPackManifest(document.baseURI);
  if(request===defaultPackRequest)state.defaultPack=manifest;
  return state.defaultPack;
}

async function offerDefaultPack(manifest){
  const previous=state.packs.find(row=>row.id===manifest.id);
  const action=defaultPackAction(manifest,previous);
  if(!action || installing)return;
  if(state.session?.packId===manifest.id && !state.session.finished){
    toast('Încheie sesiunea acestui pachet înainte de actualizare.');return;
  }
  if(action==='replace'){
    const dialog=modal('Actualizezi pachetul de curs?',el('p',{class:'modal-body'},
      `Versiunea publicată ${manifest.revision} va înlocui pachetul importat, versiunea ${previous.pack.revision}. Progresul compatibil rămâne salvat.`),[
      button('Renunță',()=>dialog.close(),'button secondary'),
      button('Actualizează',act(()=>loadDefaultPack(manifest,previous)))]);
    return;
  }
  await loadDefaultPack(manifest,previous);
}

async function loadDefaultPack(manifest,previous){
  if(installing)return;
  installing=true;
  const job=jobDialog(previous?'Se actualizează pachetul de curs':'Se descarcă pachetul de curs',`${manifest.title} · ${bytesLabel(manifest.bytes)}`);
  try{
    const file=await downloadDefaultPack(document.baseURI,manifest,job.signal,p=>job.update(p*.55));
    const result=await archiveJob('read',{file},p=>job.update(.55+p*.2,'Se verifică arhiva.'),job.signal);
    const prepared=await validateFiles(result.files,p=>job.update(.75+p*.2,'Se verifică integritatea imaginilor.'));
    validateDefaultPackContents(prepared.pack,manifest);
    job.update(.95,'Se salvează pachetul pe dispozitiv.');
    job.lock();
    await installPacks([prepared],previous?null:{activeId:manifest.id},
      {expectedToken:previous?.token ?? null,sha256:manifest.sha256});
    state.packs=await listStudyPacks();
    if(state.session?.packId===manifest.id)state.session=null;
    if(!previous){state.activeId=manifest.id;state.page=0;state.chapter='all';state.query='';location.hash='library';}
    job.finish();
    await render();
    toast(previous?`${manifest.title} a fost actualizat la versiunea ${manifest.revision}.`:
      `${manifest.cases} de cazuri sunt disponibile pe acest dispozitiv.`);
  }catch(error){job.finish();if(error.name!=='AbortError')throw error;}
  finally{installing=false;}
}

async function reloadLearning(){
  [state.progress,state.selfAssessments,state.bookmarks,state.visited]=await Promise.all([getMeta('progress',{}),getMeta('selfAssessments',{}),getMeta('bookmarks',[]),getMeta('visited',[])]);
}

function updateCheckLabel(){
  return state.updateChecking?'Verific actualizările…':'Verifică actualizări';
}

function refreshUpdateControls(){
  for(const node of document.querySelectorAll('.update-check')){
    node.disabled=state.updateChecking;
    const label=node.querySelector('span');
    if(label)label.textContent=updateCheckLabel();
  }
  for(const node of document.querySelectorAll('.default-pack-action'))node.disabled=state.updateChecking;
}

async function activeBuildId(){
  try{
    const scope=state.registration?.scope || new URL('./',location.href).href;
    const prefix=`radia-shell:${scope}`;
    const key=(await caches.keys()).find(name=>name.startsWith(prefix));
    if(key)return key.slice(prefix.length).match(/-([0-9a-f]{12})$/)?.[1] || null;
    const response=await caches.match(new URL('./release.json',document.baseURI).href);
    return response ? (await response.json()).buildId || null : null;
  }catch{return null;}
}

async function latestRelease(){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetch(new URL(`./release.json?ts=${Date.now()}`,document.baseURI),{cache:'no-store',signal:controller.signal});
    if(!response.ok)return null;
    const data=await response.json();
    return typeof data.buildId==='string' ? data : null;
  }catch{return null;}finally{clearTimeout(timer);}
}

function waitForInstalledWorker(registration,timeout=15000){
  return new Promise(resolve=>{
    if(!registration)return resolve('failed');
    const deadline=Date.now()+timeout;
    let watched=null,finished=false;
    const finish=status=>{if(finished)return;finished=true;clearInterval(timer);resolve(status);};
    const check=()=>{
      if(registration.waiting)return finish('waiting');
      const installing=registration.installing;
      if(installing && installing!==watched){
        watched=installing;
        installing.addEventListener('statechange',()=>{
          if(installing.state==='redundant')finish('failed');
          else if(registration.waiting)finish('waiting');
        });
      }
      if(watched?.state==='redundant')return finish('failed');
      if(Date.now()>deadline)return finish('timeout');
    };
    const timer=setInterval(check,200);check();
  });
}

function reloadForUpdate(){
  if(swReloading)return;
  swReloading=true;location.reload();
}

async function forceRefresh(){
  try{const registration=await navigator.serviceWorker.getRegistration();await registration?.unregister();}catch{}
  reloadForUpdate();
}

async function registerBuild(buildId){
  try{
    const registration=await navigator.serviceWorker.register(new URL(`./sw.js?build=${encodeURIComponent(buildId)}`,document.baseURI).href,{scope:'./',updateViaCache:'none'});
    state.registration=registration;return registration;
  }catch{return null;}
}

async function activateUpdate(){
  if(state.session && !state.session.finished){toast('Încheie sesiunea înainte de actualizare. Răspunsurile tale sunt salvate.');return false;}
  let waiting=state.registration?.waiting;
  if(!waiting){
    const status=await waitForInstalledWorker(state.registration,4000);
    if(status==='waiting')waiting=state.registration.waiting;
  }
  if(!waiting)return false;
  const activated=new Promise(resolve=>{
    const timer=setTimeout(()=>resolve(false),5000);
    navigator.serviceWorker.addEventListener('controllerchange',()=>{clearTimeout(timer);resolve(true);},{once:true});
  });
  waiting.postMessage({type:'ACTIVATE_UPDATE'});
  if(await activated){reloadForUpdate();return true;}
  if(navigator.onLine){
    toast('Actualizarea nu s-a activat; workerul este resetat și pagina se reîncarcă.',true);
    await forceRefresh();
  }else toast('Actualizarea nu s-a activat. Reconectează-te la internet și încearcă din nou.',true);
  return false;
}

async function checkAppUpdate(){
  const registration=state.registration;
  if(!registration)return 'unavailable';
  if(registration.waiting)return 'waiting';
  const [latest,current]=await Promise.all([latestRelease(),activeBuildId()]);
  await registration.update();
  if(registration.waiting || (registration.installing && await waitForInstalledWorker(registration)==='waiting'))return 'waiting';
  if(!latest?.buildId || !current || latest.buildId===current)return 'current';
  const refreshed=await registerBuild(latest.buildId);
  return refreshed && await waitForInstalledWorker(refreshed,10000)==='waiting'?'waiting':'reload';
}

async function checkForUpdates(){
  if(state.updateChecking || installing)return;
  state.updateChecking=true;refreshUpdateControls();
  try{
    const [app,pack]=await Promise.allSettled([checkAppUpdate(),refreshDefaultPack()]);
    const manifest=pack.value,record=state.packs.find(row=>row.id===manifest?.id),action=defaultPackAction(manifest,record);
    let packError=pack.reason;
    if(action==='update'){
      try{await offerDefaultPack(manifest);}catch(error){packError=error;}
    }
    if(app.value==='waiting' || app.value==='reload'){
      if(state.session && !state.session.finished){toast('Poți actualiza aplicația după ce închei sesiunea.');await render();}
      else if(app.value==='waiting'){toast('Se actualizează aplicația.');await activateUpdate();}
      else if(navigator.onLine)await forceRefresh();
      else toast('Reconectează-te la internet și încearcă din nou.',true);
      return;
    }
    if(state.route==='library')await render();
    if(action==='replace'){await offerDefaultPack(manifest);return;}
    if(action==='install'){toast('Pachetul de curs este gata de descărcat din Bibliotecă.');return;}
    if(packError){toast(friendlyError(packError),true);return;}
    if(app.status==='rejected'){toast('Nu am putut verifica aplicația. Verifică conexiunea și încearcă din nou.',true);return;}
    if(action==='update')return;
    if(app.value==='unavailable')toast('Verificarea aplicației nu este disponibilă în acest browser.',true);
    else toast('Ai deja cele mai recente versiuni.');
  }finally{state.updateChecking=false;refreshUpdateControls();}
}

function setupOffline(){
  if(!('serviceWorker' in navigator) || !isSecureContext)return;
  const hadController=Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(hadController && (!state.session || state.session.finished))reloadForUpdate();});
  navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).then(registration=>{
    state.registration=registration;
    registration.addEventListener('updatefound',()=>{const incoming=registration.installing;incoming?.addEventListener('statechange',()=>{if(incoming.state==='installed' && navigator.serviceWorker.controller){if(!state.session || state.session.finished)render().catch(()=>{});}});});
    navigator.serviceWorker.ready.then(()=>{
      state.offlineReady=true;if(state.route==='settings')render().catch(()=>{});
      registration.update().catch(()=>{});
    });
  }).catch(()=>{state.offlineReady=false;});
}

async function boot(){
  await openDatabase();
  [state.packs,state.activeId,state.session,state.viewerMode]=await Promise.all([listStudyPacks(),getMeta('activeId'),getMeta('session'),getMeta('viewerMode','fit')]);await reloadLearning();
  state.viewerMode=state.viewerMode==='fill'?'fill':'fit';
  if(!state.activeId || !state.packs.some(row=>row.id===state.activeId))state.activeId=state.packs[0]?.id || null;
  if(state.session && (state.session.version!==SESSION_VERSION || !state.packs.some(row=>row.id===state.session.packId && row.pack.revision===state.session.revision))){
    state.session=null;await setMeta('session',null);
  }
  await render();setupOffline();
  refreshDefaultPack().then(manifest=>{
    if(manifest && state.route==='library')return render();
  }).catch(()=>{});
  fetch('./starter.json',{cache:'no-store'}).then(response=>response.ok?response.json():null).then(starter=>{
    if(starter && safePath(starter.path) && starter.path.startsWith('packs/') && Number.isInteger(starter.cases) && Number.isFinite(starter.bytes)){state.starter=starter;if(state.route==='library' && !active())render().catch(()=>{});}
  }).catch(()=>{});
}

initAppearance();
window.addEventListener('hashchange',()=>render().catch(error=>toast(friendlyError(error),true)));
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();state.prompt=event;if(state.route==='settings')render().catch(()=>{});});
document.getElementById('pack-input').addEventListener('change',act(async event=>{const file=event.target.files[0];event.target.value='';if(file)await importPackFile(file);}));
document.getElementById('backup-input').addEventListener('change',act(async event=>{const file=event.target.files[0];event.target.value='';if(file)await restoreBackup(file);}));
boot().catch(error=>{document.getElementById('app').replaceChildren(el('main',{class:'fatal'},el('img',{src:'./icons/icon.svg',width:'48',height:'48',alt:''}),el('h1',{},'Să pregătim spațiul de studiu.'),el('p',{},friendlyError(error)),el('p',{},'Folosește un browser actualizat, într-o fereastră obișnuită. Dacă linkul a fost deschis din altă aplicație, copiază-l în Safari, Chrome, Edge sau Firefox.'),button('Încearcă din nou',()=>location.reload())));});
