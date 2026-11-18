import { APP_VERSION, SECTION_LABELS, matches, shuffled, progressKey, gradeAnswer, scheduleReview,
  chooseQuestions, availableQuestions, dateLabel, questionSignature, matchingProgress } from './core.js';
import { LIMITS, parseJSON, requireThat, validateFiles, safePath } from './schema.js';
import { openDatabase, listPacks, assetBlob, packAssets, getMeta, setMeta, setMetas, installPacks, removePack,
  learningSnapshot, validateLearning, mergeLearning, restoreLearningFile } from './storage.js';
import { archiveJob } from './archive.js';
import { el, button, link, badge, icon, toast, modal } from './dom.js';
import { imageViewer } from './viewer.js';
import { catalogueSelector } from './catalogue.js';
import { EXERCISE_LABELS, SECTION_PROMPTS, SECTION_ORDER, availableExercises, gradeMatching, matchingScore,
  recordSelfAssessment, sessionAnswer, advanceSession, finishSessionEarly, receivedAnswers, selfAssessmentItems,
  canonicalDiagnosisLabels } from './exercises.js';
import { gradeStructured, structuredRecord, describeObservation, stepLabel, optionLabel as structuredOptionLabel } from './structured.js';

const state={packs:[],activeId:null,progress:{},selfAssessments:{},bookmarks:[],visited:[],session:null,starter:null,offlineReady:false,registration:null,prompt:null,route:'library',page:0,chapter:'all',query:'',onlyBookmarks:false,updateChecking:false};
let cleanup=[],renderToken=0,activeExport=false,installing=false,swReloading=false;
const act=fn=>async event=>{try{return await fn(event);}catch(error){toast(friendlyError(error),true);}};
const active=()=>state.packs.find(row=>row.id===state.activeId) || state.packs[0];
const visitKey=(record,item)=>`${record.id}|${item.id}`;
function friendlyError(error){return error?.name==='QuotaExceededError'?'Nu mai este loc pe acest dispozitiv. Pachetul nu a fost salvat; datele existente au rămas intacte.':error?.message || 'Operația nu a putut fi finalizată.';}
function registerCleanup(fn){cleanup.push(fn);}
function chapterLabel(pack,id){return pack.curriculum.chapters.find(row=>row.id===id)?.label || id;}
function pct(n,total){return total?Math.round(n/total*100):0;}
function bar(value){const fill=el('span');fill.style.width=`${Math.max(0,Math.min(100,value))}%`;return el('div',{class:'thin-progress'},fill);}
function heading(title,description,action=null){return el('header',{class:'page-head'},el('div',{},el('h1',{},title),description?el('p',{},description):null),action);}
function stat(label,value){return el('div',{class:'stat'},el('div',{},el('div',{class:'stat-label'},label),el('div',{class:'stat-value'},value)));}
function noPack(){return el('div',{class:'empty-state'},el('div',{class:'round-icon'},icon('book',25)),el('h2',{},'Mai întâi, un pachet.'),el('p',{},'Adaugă materialele tale pentru a începe să studiezi și să exersezi.'),link('Deschide biblioteca','#library','button'));}
function exerciseLabel(q){return EXERCISE_LABELS[q.kind] || SECTION_LABELS[q.sectionId] || 'Exercițiu';}
function coverageLabel(item){return item.completeness==='diagnosis-only'?'Doar diagnostic':item.completeness==='full'?'Explicație completă':'Explicație parțială';}

function imageThumb(record,item,className='',onCleanup=registerCleanup){
  const img=el('img',{alt:`Radiografie: ${item.title}`,class:className,loading:'lazy'});let disposed=false,url;
  const primary=item.images.find(row=>row.role!=='comparison') || item.images[0];
  assetBlob(record,primary.path).then(blob=>{if(!disposed && blob){url=URL.createObjectURL(blob);img.src=url;}}).catch(()=>{});
  onCleanup(()=>{disposed=true;if(url)URL.revokeObjectURL(url);});return img;
}

async function toggleFullscreen(target){
  try{if(document.fullscreenElement)await document.exitFullscreen();else if(target.requestFullscreen)await target.requestFullscreen();else target.classList.toggle('image-zoomed');}
  catch{target.classList.toggle('image-zoomed');}
}
function fullscreenButton(target,label='Vezi imaginea pe tot ecranul'){
  return button([icon('expand',15),label],()=>toggleFullscreen(target),'button secondary');
}

function shell(){
  const record=active();const routes=[['library','Bibliotecă','book'],['practice','Recapitulare','repeat'],['exam','Simulare','exam'],['progress','Progres','chart']];
  const current=state.route.startsWith('case/') || state.route==='cases'?'library':state.route;
  const nav=routes.map(([route,label,name])=>link([icon(name),el('span',{},label)],`#${route}`,`nav-item ${current===route?'active':''}`));
  const side=el('aside',{class:'sidebar'},link([el('img',{src:'./icons/icon.svg',alt:''}),el('div',{class:'brand-word'},'RadioEasy')],'#library','brand'),
    el('nav',{class:'nav-list','aria-label':'Navigare principală'},...nav),
    el('div',{class:'sidebar-bottom'},button([icon('refresh'),el('span',{'aria-live':'polite'},updateCheckLabel())],act(()=>checkForUpdates()),'nav-item update-check',{disabled:state.updateChecking}),link([icon('settings'),el('span',{},'Date & instalare')],'#settings',`nav-item ${current==='settings'?'active':''}`),
      el('div',{class:'private-note'},icon('shield',17),el('span',{},'Materialele și progresul rămân pe dispozitivul tău.')),
      el('div',{class:'sidebar-version'},el('span',{},`v${APP_VERSION}`))));
  const packSelect=state.packs.length>1?el('select',{class:'pack-select','aria-label':'Pachet activ',onchange:act(async event=>{state.activeId=event.target.value;state.page=0;state.chapter='all';state.query='';await setMeta('activeId',state.activeId);location.hash='library';await render();})},...state.packs.map(row=>el('option',{value:row.id,selected:row.id===record?.id},row.pack.title))):el('span',{class:'pack-select'},record?.pack.curriculum.title || 'Spațiul tău de studiu');
  const top=el('header',{class:'topbar'},link([el('img',{src:'./icons/icon.svg',alt:''}),'RadioEasy'],'#library','mobile-brand'),el('div',{class:'topbar-right'},packSelect));
  const main=el('main',{class:'content',id:'main',tabindex:'-1'});
  const update=state.registration?.waiting?el('div',{class:'update-banner'},el('span',{},'O versiune nouă este gata.'),button('Actualizează acum',act(()=>activateUpdate()),'button secondary')):null;
  const mobile=el('nav',{class:'mobile-nav','aria-label':'Navigare mobilă'},...routes.map(([route,label,name])=>link([icon(name),el('span',{},label)],`#${route}`,current===route?'active':'')),link([icon('settings'),el('span',{},'Date')],'#settings',current==='settings'?'active':''));
  document.getElementById('app').replaceChildren(el('div',{class:'app-shell'},side,el('div',{class:'main-shell'},top,update,main),mobile));return main;
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

function renderLibrary(main){
  const record=active();
  main.append(heading('Biblioteca mea',null,button([icon('plus',17),'Importă pachet'],()=>document.getElementById('pack-input').click())));
  if(/FBAN|FBAV|Instagram|Discord|; wv\)/i.test(navigator.userAgent))main.append(el('div',{class:'embedded-banner'},el('span',{},'Pentru instalare și date păstrate în același loc, deschide RadioEasy în Safari sau Chrome.'),link('Vezi instrucțiunile','#settings','button secondary')));
  if(!record){
    main.append(el('section',{class:'empty-library'},el('div',{class:'round-icon'},icon('book',28)),el('h2',{},'Atlasul tău începe aici.'),el('p',{},'Importă un pachet ZIP primit de la colegi. Imaginile, explicațiile și exercițiile vor fi disponibile pe acest dispozitiv.'),
      el('div',{class:'button-row'},button([icon('upload',17),'Alege un pachet ZIP'],()=>document.getElementById('pack-input').click()),state.starter?button('Adaugă pachetul de curs',act(loadStarter),'button secondary'):null),
      state.starter?el('div',{class:'starter-footnote'},`${state.starter.cases} de cazuri din notițele tale`):null));
    main.append(el('section',{class:'panel privacy-panel'},el('h3',{},'Materialele rămân pe acest dispozitiv.'),el('p',{},'Aplicația citește fișierul ales local și nu îl trimite către un server.')));return;
  }
  const pack=record.pack,pools=availableExercises(pack,record.bank,{chapterIds:[]}),questions=[...availableQuestions(pack,record.bank,{kind:'catalogue'}),...availableQuestions(pack,record.bank,{kind:'mcq'}),...pools.matching,...pools.structured],learned=pack.cases.filter(item=>state.visited.includes(visitKey(record,item))).length;
  const valid=questions.map(q=>matchingProgress(state.progress[progressKey(record.id,q.id,q.kind)],q)).filter(Boolean);
  const attempts=valid.reduce((n,r)=>n+r.attempts,0),correct=valid.reduce((n,r)=>n+r.correct,0);
  const autoDue=valid.filter(r=>r.dueAt<=Date.now()).length;
  const selfDue=Object.entries(state.selfAssessments).filter(([key,value])=>key.startsWith(record.id+'|') && value.dueAt<=Date.now()).length;
  main.append(el('div',{class:'stats-row'},stat('Cazuri disponibile',pack.cases.length),stat('Cazuri citite',learned),stat('Precizie la răspunsuri',attempts?`${pct(correct,attempts)}%`:'—'),stat('De recapitulat',autoDue+selfDue)));
  const next=pack.cases.find(item=>!state.visited.includes(visitKey(record,item))) || pack.cases[0];
  main.append(el('section',{class:'hero-pack'},el('div',{class:'hero-copy'},el('h2',{},pack.title),el('p',{},`${pack.cases.length} cazuri, organizate în ${pack.curriculum.chapters.length} capitole.`),el('div',{class:'button-row'},link(['Continuă studiul',icon('arrow',16)],`#case/${next.id}`,'button'),link('Toate cazurile','#cases','button ghost'))),el('a',{href:`#case/${next.id}`,class:'hero-image'},imageThumb(record,next))));
  main.append(el('div',{class:'section-head'},el('h2',{},'Explorează pe capitole')));
  main.append(el('div',{class:'chapter-grid'},...pack.curriculum.chapters.map(chapter=>{
    const items=pack.cases.filter(item=>item.chapterId===chapter.id),seen=items.filter(item=>state.visited.includes(visitKey(record,item))).length;
    return el('a',{href:'#cases',class:'chapter-card',onclick:()=>{state.chapter=chapter.id;state.query='';state.page=0;}},el('div',{class:'chapter-image'},items[0]?imageThumb(record,items[0]):null),
      el('div',{class:'chapter-copy'},el('div',{class:'chapter-title'},el('h3',{},chapter.label)),el('p',{},`${items.length} ${items.length===1?'caz':'cazuri'}`),bar(pct(seen,items.length)),el('div',{class:'chapter-progress-label'},`${seen} din ${items.length} citite`)));
  })));
  main.append(el('section',{class:'panel review-teaser'},el('div',{class:'round-icon'},icon('repeat',24)),el('div',{},el('h3',{},autoDue+selfDue?'Ai exerciții de recapitulat.':'Nimic de recapitulat acum.'),el('p',{},autoDue+selfDue?`${autoDue+selfDue} exerciții sunt pregătite pentru o nouă trecere.`:'Continuă cu material nou sau verifică progresul.'),link(['Începe o recapitulare',icon('arrow',14)],'#practice','text-link'))));
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
  const comparisons=(item.comparisons||[]).map(row=>{const target=pack.cases.find(caseRow=>caseRow.id===row.caseId),imageRow=target?.images.find(image=>image.id===row.imageId);return target&&imageRow?{label:row.label,path:imageRow.path}:null;}).filter(Boolean);
  if(!state.visited.includes(key)){state.visited.push(key);setMeta('visited',state.visited).catch(error=>toast(friendlyError(error),true));}
  const bookmark=button(icon('bookmark',17),act(async()=>{const exists=state.bookmarks.includes(key);state.bookmarks=exists?state.bookmarks.filter(v=>v!==key):[...state.bookmarks,key];await setMeta('bookmarks',state.bookmarks);bookmark.classList.toggle('active',!exists);bookmark.setAttribute('aria-pressed',String(!exists));toast(exists?'Caz eliminat din salvate.':'Caz salvat.');}),`icon-button ${state.bookmarks.includes(key)?'active':''}`,{'aria-label':'Salvează cazul','aria-pressed':String(state.bookmarks.includes(key))});
  main.append(el('header',{class:'reader-header'},link([icon('back',14),'Toate cazurile'],'#cases','button ghost'),el('div',{class:'section-head'},el('h1',{},item.title),el('div',{class:'button-row'},bookmark,button([icon('exam',15),'Exersează cazul'],act(()=>openCasePractice(record,item)),'button secondary'))),el('div',{class:'reader-meta'},badge(chapterLabel(pack,item.chapterId),'green'),item.completeness!=='full'?badge(coverageLabel(item),'orange'):null,item.source.page?el('span',{},`Notițe, pagina ${item.source.page}`):null)));
  const rows=new Map(),bodies=new Map();
  const viewer=imageViewer(record,item,{comparisons,onSelect:itemId=>{const row=rows.get(itemId);if(row){const body=row.parentElement;body.hidden=false;const toggle=bodies.get(body);toggle?.setAttribute('aria-expanded','true');for(const r of rows.values())r.classList.toggle('active',r===row);row.scrollIntoView({behavior:'smooth',block:'nearest'});}}});registerCleanup(()=>viewer.destroy());
  const observationNotes=new Map((item.structured?.observations||[]).filter(row=>row.note).map(row=>[row.itemId,row.note]));
  const notes=el('section',{class:'interpretation','aria-label':'Interpretarea radiografiei'});
  if(item.annotations.some(a=>a.reviewStatus!=='reviewed'))notes.append(el('div',{class:'annotation-note'},icon('info',14),'Marcaje orientative, în curs de verificare.'));
  for(const [index,sectionId] of Object.keys(SECTION_LABELS).entries()){
    const section=item.sections.find(row=>row.id===sectionId),body=el('div',{class:'notes-body',id:`section-${sectionId}`});
    const toggle=button([el('span',{class:'notes-number'},String(index+1).padStart(2,'0')),SECTION_LABELS[sectionId],icon('chevron',15)],()=>{body.hidden=!body.hidden;toggle.setAttribute('aria-expanded',String(!body.hidden));},'notes-heading',{'aria-expanded':'true','aria-controls':body.id});bodies.set(body,toggle);
    if(!section?.items.length)body.append(el('p',{class:'missing'},'Nu este precizat în notițele sursă.'));
    else for(const point of section.items){const linked=item.annotations.some(a=>a.itemId===point.id),row=el('div',{class:`finding ${linked?'linked':''}`,tabindex:linked?'0':null,role:linked?'button':null},point.text);
      if(linked){const select=()=>{viewer.selectItem(point.id);for(const r of rows.values())r.classList.toggle('active',r===row);};row.addEventListener('click',select);row.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();select();}});}
      body.append(row);rows.set(point.id,row);
      if(observationNotes.has(point.id))body.append(el('p',{class:'study-note'},icon('info',13),observationNotes.get(point.id)));
    }
    if(item.structured?.sectionNotes?.[sectionId])body.append(el('p',{class:'study-note'},icon('info',13),item.structured.sectionNotes[sectionId]));
    notes.append(el('section',{class:'notes-section'},toggle,body));
  }
  notes.append(el('details',{class:'source-disclosure'},el('summary',{},'Vezi transcrierea integrală'),el('div',{class:'source-text'},item.referenceText)));
  main.append(el('div',{class:'reader-grid'},viewer.node,notes));
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
  let disposed=false,url;
  const image=el('img',{class:'explanation-image',alt:`Radiografie: ${target.title}`});
  const picture=target.images.find(row=>row.role!=='comparison') || target.images[0];
  assetBlob(record,picture.path).then(blob=>{if(!disposed && blob){url=URL.createObjectURL(blob);image.src=url;}}).catch(()=>{});
  const body=el('div',{class:'case-preview'},
    el('div',{class:'case-preview-head'},image,badge(chapterLabel(record.pack,target.chapterId),'green')),
    el('p',{class:'case-preview-note'},'Previzualizare comparativă. Cazul principal rămâne deschis; închide fereastra pentru a reveni.'),
    el('div',{class:'diagnosis-line'},el('span',{},'Diagnostic pozitiv'),el('strong',{},canonicalDiagnosisLabels(record,target.id).join('; ') || 'Neprecizat în sursă')),
    ...SECTION_ORDER.map(sectionId=>{const section=target.sections.find(row=>row.id===sectionId);return el('section',{class:'explanation-section'},el('h3',{},SECTION_LABELS[sectionId]),section?.items.length?el('ul',{},...section.items.map(item=>el('li',{},item.text))):el('p',{class:'missing'},'Nu este precizat în notițele sursă.'));}));
  const dialog=modal(target.title,body,[button('Înapoi la caz',()=>dialog.close(),'button secondary')]);
  dialog.classList.add('explanation-modal');
  const cleanup=()=>{disposed=true;if(url)URL.revokeObjectURL(url);dialog.classList.remove('explanation-modal');dialog.removeEventListener('close',cleanup);};
  dialog.addEventListener('close',cleanup);
}

const METHOD_COPY=Object.freeze({
  structured:{label:'Interpretare structurată',description:'Alegi observațiile și proprietățile lor din banca capitolului, apoi diagnosticul. Se corectează automat.'},
  interpretation:{label:'Interpretare completă',description:'Scrii ce observi în fiecare secțiune. Fără marcaje pe imagine. La final compari cu notițele.'},
  regions:{label:'Regiuni numerotate',description:'Regiunile sunt numerotate pe imagine. Scrii ce reprezintă fiecare.'},
  matching:{label:'Potrivire',description:'Asociezi descrierile din notițe cu regiunile numerotate. Se corectează automat.'},
  short:{label:'Întrebări scurte',description:'Alegi diagnosticul din listă sau răspunsul dintre variante. Se corectează automat.'},
});

function methodCounts(record,chapterIds){
  const pools=availableExercises(record.pack,record.bank,{chapterIds});
  return {structured:pools.structured.length,interpretation:pools.interpretation.length,regions:pools.regions.length,matching:pools.matching.length,short:pools.short.length};
}

function renderPractice(main,mode){
  const record=active();if(!record){main.append(noPack());return;}
  const session=state.session;
  if(session && session.packId===record.id && session.revision===record.pack.revision && session.mode===mode){
    if(session.finished)renderResults(main,record,session);else renderQuestion(main,record,session);return;
  }
  main.append(heading(mode==='exam'?'Simulare':'Recapitulare',mode==='exam'?'Un test echilibrat pe capitole. Explicațiile apar la final.':'Exersează ce ai învățat. Explicația apare imediat după fiecare răspuns.'));
  if(session && !session.finished){
    const other=session.mode==='exam'?'simulare':'recapitulare';
    main.append(el('div',{class:'resume-banner'},el('span',{},`Ai o ${other} începută. Răspunsurile sunt păstrate.`),
      button('Continuă sesiunea',act(async()=>{state.activeId=session.packId;const target=session.mode==='exam'?'exam':'practice';if(location.hash===`#${target}`)await render();else location.hash=target;}),'button secondary'),
      button('Încheie',()=>confirmFinishSession(),'button ghost')));
  }
  const pack=record.pack;
  const capability=methodCounts(record,[]);
  let method=capability.structured?'structured':capability.interpretation?'interpretation':capability.short?'short':'interpretation';
  const scopeSelect=pack.curriculum.scopes.length>1?el('select',{class:'select','aria-label':'Ce parte din materie'},...pack.curriculum.scopes.map(scope=>el('option',{value:scope.id},scope.label))):null;
  const chapterSelect=el('select',{class:'select','aria-label':'Capitole'});
  const count=el('input',{class:'number-input',type:'number',min:'1',max:'100',value:method==='short'?'10':'5',inputmode:'numeric','aria-label':'Număr de exerciții'});
  const countLabel=el('span',{class:'field-label'},'Număr de cazuri');
  const available=el('p',{class:'field-help'});
  const methodBox=el('fieldset',{class:'method-grid'});
  const start=button([mode==='exam'?'Începe simularea':'Începe recapitularea',icon('arrow',16)],act(async()=>{
    const pools=availableExercises(pack,record.bank,{chapterIds:chapterIds()}),pool=pools[method];
    const requested=Number(count.value);
    requireThat(Number.isInteger(requested) && requested>=1 && requested<=Math.min(100,pool.length),'Alege un număr valid de exerciții.');
    const history={...state.progress,...state.selfAssessments};
    await beginSession(record,chooseQuestions(pool,history,record.id,requested,mode),mode,chapterIds(),method);
  }),'button large');
  function scopeChapters(){return scopeSelect?pack.curriculum.scopes.find(scope=>scope.id===scopeSelect.value)?.chapterIds || []:pack.curriculum.chapters.map(chapter=>chapter.id);}
  function chapterIds(){return chapterSelect.value==='all'?scopeChapters():[chapterSelect.value];}
  function drawMethods(counts){
    methodBox.replaceChildren(el('legend',{class:'field-label'},'Ce vrei să exersezi?'));
    const order=['structured','interpretation','regions','matching','short'];
    for(const id of order){
      const enabled=counts[id]>0,guided=id==='regions'||id==='matching';
      const reason=!enabled?(guided?(capability[id]?'Nu există cazuri verificate în capitolul ales.':'Disponibil după verificarea marcajelor de pe imagine.'):id==='structured'?'Disponibil după completarea observațiilor structurate.':'Nu există în selecția curentă.'):`${counts[id]} ${id==='short'?'întrebări disponibile':'cazuri disponibile'}`;
      const card=el('label',{class:`method-card ${method===id?'active':''} ${enabled?'':'disabled'}`},
        el('input',{type:'radio',name:'method',value:id,checked:method===id,disabled:!enabled,onchange:()=>{method=id;count.value=String(Math.min(id==='short'?10:5,counts[id]||1));updateAvailability();}}),
        el('span',{class:'method-copy'},el('strong',{},METHOD_COPY[id].label),el('span',{},METHOD_COPY[id].description),el('span',{class:'method-count'},reason)));
      methodBox.append(card);
    }
  }
  function updateChapters(){const allowed=scopeChapters();chapterSelect.replaceChildren(el('option',{value:'all'},'Toate capitolele'),...pack.curriculum.chapters.filter(chapter=>allowed.includes(chapter.id)).map(chapter=>el('option',{value:chapter.id},chapter.label)));updateAvailability();}
  function updateAvailability(){
    const counts=methodCounts(record,chapterIds());
    if(!counts[method])method=['structured','interpretation','regions','matching','short'].find(key=>counts[key]) || 'interpretation';
    drawMethods(counts);
    countLabel.textContent=method==='short'?'Număr de întrebări':'Număr de cazuri';
    const max=Math.min(100,counts[method] || 0);count.max=String(Math.max(1,max));if(Number(count.value)>max)count.value=String(max || 1);
    if(!Number(count.value) && max)count.value=String(Math.min(method==='short'?10:5,max));
    available.textContent=max?`${max} ${method==='short'?'întrebări disponibile':'cazuri disponibile'} pentru selecția ta.`:'Nu există exerciții pentru selecția curentă.';
    start.disabled=max===0;
    start.firstChild.textContent=mode==='exam'?'Începe simularea':'Începe recapitularea';
  }
  if(scopeSelect)scopeSelect.addEventListener('change',updateChapters);
  chapterSelect.addEventListener('change',updateAvailability);
  const methodsGroup=el('div',{class:'form-group'},methodBox);
  const form=el('form',{class:'setup-form',onsubmit:event=>event.preventDefault()},
    methodsGroup,
    scopeSelect?el('div',{class:'form-group'},el('label',{class:'field-label'},'Ce parte din materie',scopeSelect)):null,
    el('div',{class:'form-group'},el('label',{class:'field-label'},'Capitole',chapterSelect)),
    el('div',{class:'form-group'},el('label',{},countLabel,count),available),start);
  const aside=el('aside',{class:'setup-aside'},el('div',{class:'round-icon'},icon(mode==='exam'?'exam':'repeat',25)),
    el('h2',{},'De ce două moduri?'),
    el('p',{},'Recapitulare te ajută să înveți: alege mai ales ce ai greșit sau ce nu ai mai văzut, iar explicația apare imediat.'),
    el('p',{},'Simulare te testează: amestecă exercițiile între capitole și arată explicațiile abia la final.'),
    el('p',{},'Ambele intră în progres.'),
    el('p',{class:'field-help'},'Reperele și explicațiile sunt ascunse în timpul exercițiului.'));
  main.append(el('div',{class:'setup-grid'},form,aside));updateChapters();
}

async function beginSession(record,questions,mode,chapterIds,method){
  requireThat(questions.length,'Pachetul nu conține exerciții pentru această selecție.');
  const next={version:1,packId:record.id,revision:record.pack.revision,mode,method,chapterIds,startedAt:Date.now(),index:0,finished:false,answers:[],
    questions:questions.map(q=>({...q,...(q.kind==='mcq'?{options:shuffled(q.options)}:{})}))};
  await setMeta('session',next);state.session=next;const route=mode==='exam'?'exam':'practice';
  if(location.hash!==`#${route}`)location.hash=route;else await render();
}

async function openCasePractice(record,item){
  const pools=availableExercises(record.pack,record.bank,{chapterIds:[item.chapterId]});
  const options=[];
  const structured=pools.structured.find(q=>q.caseId===item.id);if(structured)options.push(['structured',structured]);
  const interpretation=pools.interpretation.find(q=>q.caseId===item.id);if(interpretation)options.push(['interpretation',interpretation]);
  const regions=pools.regions.find(q=>q.caseId===item.id);if(regions)options.push(['regions',regions]);
  const matching=pools.matching.find(q=>q.caseId===item.id);if(matching)options.push(['matching',matching]);
  const short=pools.short.filter(q=>q.caseId===item.id);if(short.length)options.push(['short',short]);
  requireThat(options.length,'Acest caz nu are încă exerciții.');
  const start=async([method,payload])=>{const dialog=document.getElementById('modal');if(dialog.open)dialog.close();await beginSession(record,method==='short'?payload:[payload],'review',[item.chapterId],method);};
  if(options.length===1){await start(options[0]);return;}
  modal('Cum vrei să exersezi cazul?',el('div',{class:'method-picker'},...options.map(([id,payload])=>button([el('strong',{},METHOD_COPY[id].label),el('span',{},METHOD_COPY[id].description)],act(()=>start([id,payload])),'method-pick'))),
    [button('Renunță',()=>document.getElementById('modal').close(),'button secondary')]);
}

function selfCheckPanel(record,q,answer,onChange){
  const items=selfAssessmentItems(record,q);
  const checked=new Set(Object.values(answer?.selfChecks || {}).flat());
  const groups=new Map();
  for(const item of items){if(!groups.has(item.sectionId))groups.set(item.sectionId,[]);groups.get(item.sectionId).push(item);}
  const root=el('div',{class:'self-check'},el('p',{class:'field-help'},'Bifează ce ai identificat. Nu există notare automată.'));
  for(const [sectionId,rows] of groups){
    const group=el('section',{class:'self-check-group'},el('h4',{},SECTION_LABELS[sectionId]||sectionId));
    for(const item of rows){
      const input=el('input',{type:'checkbox',checked:checked.has(item.id)});
      input.addEventListener('change',()=>onChange?.(item.id,input.checked,sectionId));
      group.append(el('label',{class:'self-check-row'},input,el('span',{},item.text)));
    }
    root.append(group);
  }
  if(q.kind==='interpretation'){
    const source=record.pack.cases.find(row=>row.id===q.caseId),dx=source?.sections.find(row=>row.id==='diagnosis');
    if(dx?.items.length)root.append(el('details',{class:'help-details'},el('summary',{},'Din notițele sursă'),...dx.items.map(item=>el('p',{},item.text))));
  }
  return root;
}

function answerSummary(record,q,answer){
  if(!answer || answer.skipped)return 'Sărit';
  if(q.kind==='structured'){const grade=gradeStructured(q,answer);return `${grade.hit} din ${grade.total} etape corecte`;}
  if(q.kind==='written')return answer.text?`Răspuns scris · ${answer.text.split(/\s+/).filter(Boolean).length} cuvinte`:'Răspuns scris';
  if(q.kind==='catalogue')return `Ai ales: ${(answer.selectedIds||[]).map(id=>optionLabel(record,q,id)).join('; ')}`;
  if(q.kind==='mcq')return `Ai ales: ${(answer.selectedIds||[]).map(id=>optionLabel(record,q,id)).join('; ')}`;
  if(q.kind==='matching'){const score=matchingScore(answer.mapping||{},q.correctMapping);return `Potriviri corecte: ${score.hit} din ${score.total}`;}
  if(q.kind==='regions')return `${Object.values(answer.regionAnswers||{}).filter(Boolean).length} regiuni descrise`;
  if(q.kind==='interpretation')return `${Object.values(answer.textAnswers||{}).filter(Boolean).length} secțiuni completate`;
  return '';
}

function optionLabel(record,q,id){return q.kind==='catalogue'?record.pack.diagnoses.find(row=>row.id===id)?.label || id:q.options.find(row=>row.id===id)?.label || id;}

function answerFeedback(record,q,answer){
  const correct=(q.correctOptionIds||[]).map(id=>optionLabel(record,q,id));
  const detail=el('div',{class:`feedback ${answer.correct?'':'wrong'}`},el('h3',{},answer.correct?'Răspuns corect':'Răspuns de referință'),el('p',{},`Răspuns corect: ${correct.join('; ')}`));
  if(!answer.correct)detail.append(el('p',{},`Răspunsul tău: ${(answer.selectedIds||[]).map(id=>optionLabel(record,q,id)).join('; ') || '—'}`));
  if(q.sectionId!=='diagnosis' && q.feedback)detail.append(el('p',{},q.feedback));
  if(!answer.correct && q.options)for(const option of q.options.filter(row=>answer.selectedIds.includes(row.id) && !q.correctOptionIds.includes(row.id) && row.feedback))detail.append(el('p',{},option.feedback));
  return detail;
}

function matchingFeedback(record,q,answer){
  const options=new Map(q.options.map(option=>[option.id,option]));
  const detail=el('div',{class:`feedback ${answer.correct?'':'wrong'}`},el('h3',{},answer.correct?'Toate potrivirile sunt corecte':'Răspuns de referință'));
  for(const pair of q.pairs){
    const chosen=answer.mapping?.[pair.regionId],correctId=q.correctMapping[pair.regionId];
    detail.append(el('div',{class:`pair ${chosen===correctId?'ok':'bad'}`},el('strong',{},`Regiunea ${pair.label}`),el('span',{},`Răspunsul tău: ${options.get(chosen)?.text || '—'}`),el('span',{},`Corect: ${options.get(correctId)?.text || ''}`)));
  }
  return detail;
}

function commitSession(nextSession,nextProgress=null,nextAssessments=null){
  const values={session:nextSession};if(nextProgress)values.progress=nextProgress;if(nextAssessments)values.selfAssessments=nextAssessments;
  state.session=nextSession;if(nextProgress)state.progress=nextProgress;if(nextAssessments)state.selfAssessments=nextAssessments;
  return setMetas(values);
}

function renderQuestion(main,record,session){
  const q=session.questions[session.index],source=record.pack.cases.find(item=>item.id===q.caseId);
  if(!source || !q){main.append(noPack());return;}
  if(q.kind==='structured'){renderStructuredQuestion(main,record,session);return;}
  if(q.kind==='written'){renderWrittenQuestion(main,record,session);return;}
  const review=session.mode==='review',stored=session.answers[session.index];
  let currentAnswer=stored || null,checksDraft={...(stored?.selfChecks || {})},busy=false;
  const fieldNodes=new Map();

  main.append(el('div',{class:'quiz-top'},button([icon('back',14),'Pauză'],()=>{location.hash='library';},'button ghost'),bar(pct(session.index,session.questions.length)),el('span',{class:'quiz-counter'},`${session.index+1} / ${session.questions.length} · ${session.mode==='exam'?'Simulare':'Recapitulare'}`),button('Încheie',()=>confirmFinishSession(async()=>{if(q.kind==='interpretation'||q.kind==='regions')await saveChecks(true);}),'button ghost')));

  const guided=q.kind==='regions'||q.kind==='matching';
  const viewer=imageViewer(record,source,guided?{exercise:q,onSelect:id=>{const field=fieldNodes.get(id);field?.focus();}}:{allowAnnotations:false});
  registerCleanup(()=>viewer.destroy());

  const panel=el('section',{class:'question-panel','aria-label':'Exercițiu'},badge(exerciseLabel(q),'green'),el('h2',{},q.prompt));
  const submit=button(review?'Trimite răspunsul':session.index===session.questions.length-1?'Finalizează simularea':'Confirmă și continuă',act(async()=>{
    if(busy)return;const payload=buildPayload();if(!payload)return;busy=true;submit.disabled=true;
    try{if(review){await saveReview(payload);}else{await saveExam(payload);}}
    finally{busy=false;submit.disabled=false;}
  }),'button',{disabled:true});
  const skip=button('Sari peste',act(async()=>{if(busy)return;busy=true;const next=advanceSession(state.session,{skipped:true,at:Date.now()});await commitSession(next);await render();}),'button ghost');

  function buildPayload(){
    if(q.kind==='interpretation'){
      const textAnswers=Object.fromEntries([...fieldNodes].map(([id,node])=>[id,node.value.trim()]).filter(([,value])=>value));
      if(!Object.keys(textAnswers).length){toast('Scrie cel puțin o secțiune.',true);return null;}
      return {textAnswers,at:Date.now()};
    }
    if(q.kind==='regions'){
      const regionAnswers=Object.fromEntries([...fieldNodes].map(([id,node])=>[id,node.value.trim()]).filter(([,value])=>value));
      if(!Object.keys(regionAnswers).length){toast('Scrie cel puțin o regiune.',true);return null;}
      return {regionAnswers,at:Date.now()};
    }
    if(q.kind==='matching'){
      const mapping=Object.fromEntries(Object.entries(checksDraft.mapping||{}).filter(([,value])=>value));
      if(Object.keys(mapping).length!==q.pairs.length){toast('Completează toate potrivirile.',true);return null;}
      const correct=gradeMatching(mapping,q.correctMapping);
      return {mapping,correct,at:Date.now()};
    }
    const selection=checksDraft.selectedIds||[];
    if(!selection.length){toast('Alege un răspuns.',true);return null;}
    return {selectedIds:[...selection],correct:gradeAnswer(selection,q.correctOptionIds),at:Date.now()};
  }

  async function saveReview(payload){
    let nextProgress=state.progress;
    if(q.kind==='catalogue'||q.kind==='mcq'||q.kind==='matching'){
      const correct=payload.correct,key=progressKey(record.id,q.id,q.kind),previous=matchingProgress(state.progress[key],q);
      nextProgress={...state.progress,[key]:{...scheduleReview(previous,correct),signature:questionSignature(q),sectionId:q.sectionId,chapterId:q.chapterId,caseId:q.caseId}};
    }
    const next=sessionAnswer(state.session,payload);await commitSession(next,nextProgress);await render();
  }

  async function saveExam(payload){
    let nextProgress=state.progress;
    if(q.kind==='catalogue'||q.kind==='mcq'||q.kind==='matching'){
      const correct=payload.correct,key=progressKey(record.id,q.id,q.kind),previous=matchingProgress(state.progress[key],q);
      nextProgress={...state.progress,[key]:{...scheduleReview(previous,correct),signature:questionSignature(q),sectionId:q.sectionId,chapterId:q.chapterId,caseId:q.caseId}};
    }
    const next=advanceSession(state.session,payload);await commitSession(next,nextProgress);await render();
  }

  async function saveChecks(recordAttempt){
    if(!currentAnswer || (q.kind!=='interpretation'&&q.kind!=='regions'))return;
    if(recordAttempt && !currentAnswer.selfTouched)return;
    const items=selfAssessmentItems(record,q),checked=[...new Set(Object.values(checksDraft).flat())].filter(id=>items.some(item=>item.id===id));
    const nextAnswer={...currentAnswer,selfChecks:checksDraft,selfTouched:true,selfComplete:checked.length===items.length && items.length>0};
    if(!recordAttempt){currentAnswer=nextAnswer;await commitSession(sessionAnswer(state.session,nextAnswer));return;}
    if(currentAnswer.selfRecorded)return;
    const key=progressKey(record.id,q.id,q.kind),previous=matchingProgress(state.selfAssessments[key],q);
    const nextAssessments={...state.selfAssessments,[key]:{...recordSelfAssessment(previous,{identified:checked.length,total:items.length}),signature:questionSignature(q),sectionId:q.sectionId,chapterId:q.chapterId,caseId:q.caseId}};
    const recorded={...nextAnswer,selfRecorded:true,selfComplete:checked.length===items.length && items.length>0};
    const nextSession=sessionAnswer(state.session,recorded);currentAnswer=recorded;
    await commitSession(nextSession,state.progress,nextAssessments);
  }

  if(q.kind==='interpretation'){
    const values=stored?.textAnswers || {};
    for(const section of q.sections){
      const textarea=el('textarea',{class:'interpretation-input',rows:'3',maxlength:'4000',readOnly:Boolean(stored),'aria-label':SECTION_PROMPTS[section.id]||section.label});
      textarea.value=values[section.id] || '';
      if(!stored)textarea.addEventListener('input',()=>{submit.disabled=!([...fieldNodes.values()].some(node=>node.value.trim()));});
      fieldNodes.set(section.id,textarea);
      panel.append(el('label',{class:'interpretation-field'},el('span',{class:'field-label'},section.label),el('span',{class:'field-help'},SECTION_PROMPTS[section.id]||''),textarea));
    }
    const missing=SECTION_ORDER.filter(id=>!q.sections.some(section=>section.id===id));
    if(missing.length)panel.append(el('p',{class:'field-help'},`Nu sunt evaluate pentru acest caz: ${missing.map(id=>SECTION_LABELS[id]).join(', ')}.`));
  }else if(q.kind==='regions'){
    const values=stored?.regionAnswers || {};
    for(const region of q.regions){
      const textarea=el('textarea',{class:'interpretation-input',rows:'2',maxlength:'2000',readOnly:Boolean(stored),'aria-label':`Ce reprezintă regiunea ${region.label}?`});
      textarea.value=values[region.annotationId] || '';
      if(!stored)textarea.addEventListener('input',()=>{submit.disabled=!([...fieldNodes.values()].some(node=>node.value.trim()));});
      fieldNodes.set(region.annotationId,textarea);
      panel.append(el('label',{class:'interpretation-field'},el('span',{class:'field-label'},`Regiunea ${region.label}`),textarea));
    }
  }else if(q.kind==='matching'){
    checksDraft.mapping={...(stored?.mapping || {})};
    const options=el('div',{class:'matching-options'},el('p',{class:'field-label'},'Descrieri'),...q.options.map((option,index)=>el('div',{class:'matching-option'},el('strong',{},String.fromCharCode(65+index)),el('span',{},option.text))));
    panel.append(options);
    for(const pair of q.pairs){
      const select=el('select',{class:'select',disabled:Boolean(stored),'aria-label':`Potrivire pentru regiunea ${pair.label}`},el('option',{value:''},'Alege descrierea…'),...q.options.map((option,index)=>el('option',{value:option.id,selected:checksDraft.mapping[pair.regionId]===option.id},`${String.fromCharCode(65+index)}. ${option.text}`)));
      select.addEventListener('change',()=>{checksDraft.mapping[pair.regionId]=select.value;submit.disabled=Object.keys(checksDraft.mapping).filter(key=>checksDraft.mapping[key]).length!==q.pairs.length;});
      fieldNodes.set(pair.regionId,select);
      panel.append(el('label',{class:'interpretation-field'},el('span',{class:'field-label'},`Regiunea ${pair.label}`),select));
    }
  }else if(q.kind==='catalogue'){
    if(stored)panel.append(el('div',{class:'saved-answer'},el('strong',{},'Ai ales: '),(stored.selectedIds||[]).map(id=>optionLabel(record,q,id)).join('; ')));
    else panel.append(catalogueSelector(record.pack,{chapterIds:session.chapterIds,selected:checksDraft.selectedIds||[],multiple:q.correctOptionIds.length>1,onChange:ids=>{checksDraft.selectedIds=ids;submit.disabled=!ids.length;}}));
  }else{
    const options=el('div',{class:'mcq-options'});
    for(const [index,option] of q.options.entries()){
      const field=el('input',{type:q.correctOptionIds.length>1?'checkbox':'radio',name:'mcq-answer',value:option.id,checked:(stored?.selectedIds||checksDraft.selectedIds||[]).includes(option.id),disabled:Boolean(stored)});
      const selected=(stored?.selectedIds||checksDraft.selectedIds||[]).includes(option.id);
      const row=el('label',{class:`mcq-option ${selected?'selected':''} ${stored && review?(q.correctOptionIds.includes(option.id)?'correct':selected?'incorrect':''):''}`},field,el('span',{class:'option-letter'},String.fromCharCode(65+index)),el('span',{},option.label));
      field.addEventListener('change',()=>{if(q.correctOptionIds.length===1)checksDraft.selectedIds=[];const set=new Set(checksDraft.selectedIds||[]);if(field.checked)set.add(option.id);else set.delete(option.id);checksDraft.selectedIds=[...set];options.querySelectorAll('.mcq-option').forEach(node=>node.classList.toggle('selected',node.querySelector('input').checked));submit.disabled=!checksDraft.selectedIds.length;});options.append(row);
    }
    panel.append(options);
  }

  if(stored && review){
    if(q.kind==='interpretation'||q.kind==='regions'){
      panel.append(selfCheckPanel(record,q,{...stored,selfChecks:checksDraft},(id,on,sectionId)=>{const set=new Set(checksDraft[sectionId]||[]);if(on)set.add(id);else set.delete(id);checksDraft[sectionId]=[...set];currentAnswer={...currentAnswer,selfChecks:checksDraft,selfTouched:true};commitSession(sessionAnswer(state.session,currentAnswer)).catch(error=>toast(friendlyError(error),true));}));
    }else if(q.kind==='matching'){
      panel.append(matchingFeedback(record,q,stored));
    }else{
      panel.append(answerFeedback(record,q,stored));
    }
    panel.append(el('div',{class:'question-actions'},el('span',{class:'text-muted'},`${session.index+1} din ${session.questions.length}`),button([session.index===session.questions.length-1?'Vezi rezultatul':'Continuă',icon('arrow',16)],act(async()=>{if(q.kind==='interpretation'||q.kind==='regions')await saveChecks(true);const next=advanceSession(state.session,currentAnswer || {skipped:true,at:Date.now()});await commitSession(next);await render();}))));
  }else if(!stored){
    panel.append(el('div',{class:'question-actions'},el('span',{class:'field-help'},'Răspunsul se salvează local.'),skip,submit));
    if(q.kind==='matching')submit.disabled=true;
  }
  main.append(el('div',{class:'quiz-grid'},viewer.node,panel));
}

function quizTop(main,record,session){
  main.append(el('div',{class:'quiz-top'},button([icon('back',14),'Pauză'],()=>{location.hash='library';},'button ghost'),bar(pct(session.index,session.questions.length)),el('span',{class:'quiz-counter'},`${session.index+1} / ${session.questions.length} · ${session.mode==='exam'?'Simulare':'Recapitulare'}`),button('Încheie',()=>confirmFinishSession(),'button ghost')));
}

function structuredProgress(record,q,grade){
  const key=progressKey(record.id,q.id,'structured'),previous=matchingProgress(state.progress[key],q);
  return {...state.progress,[key]:{...structuredRecord(previous,grade),signature:questionSignature(q),sectionId:q.sectionId,chapterId:q.chapterId,caseId:q.caseId}};
}

function structuredChoiceInput(step,sectionAnswer,onChange){
  const root=el('div',{class:step.multiple?'mcq-options':'mcq-options'});
  for(const [index,option] of step.options.entries()){
    const selected=(sectionAnswer.choiceIds||[]).includes(option.id);
    const field=el('input',{type:step.multiple?'checkbox':'radio',name:`structured-${step.id}`,value:option.id,checked:selected});
    const row=el('label',{class:`mcq-option ${selected?'selected':''}`},field,el('span',{class:'option-letter'},String.fromCharCode(65+index)),el('span',{},option.label));
    field.addEventListener('change',()=>{
      const set=new Set(sectionAnswer.choiceIds||[]);
      if(step.multiple){if(field.checked)set.add(option.id);else set.delete(option.id);}
      else set.clear(),set.add(option.id);
      sectionAnswer.choiceIds=[...set];
      root.querySelectorAll('.mcq-option').forEach(node=>node.classList.toggle('selected',node.querySelector('input').checked));
      onChange(sectionAnswer.choiceIds.length>0);
    });
    root.append(row);
  }
  return root;
}

function structuredFindingsInput(step,sectionAnswer,onChange){
  const root=el('div',{class:'structured-findings'});
  sectionAnswer.observations=sectionAnswer.observations||[];
  const types=step.types||[];
  function draw(){
    root.replaceChildren();
    if(!types.length)root.append(el('p',{class:'field-help'},'Banca capitolului nu are tipuri de observații.'));
    for(const [index,row] of sectionAnswer.observations.entries()){
      row.values=row.values||{};
      const type=types.find(item=>item.id===row.typeId);
      const select=el('select',{class:'select','aria-label':'Tipul observației'},...types.map(item=>el('option',{value:item.id,selected:item.id===row.typeId},item.label)));
      select.addEventListener('change',()=>{row.typeId=select.value;row.values={};draw();});
      const card=el('div',{class:'structured-observation'},el('div',{class:'structured-observation-head'},el('strong',{},`Observația ${index+1}`),select,button(icon('close',13),()=>{sectionAnswer.observations.splice(index,1);draw();onChange(sectionAnswer.observations.length>0);},'icon-button',{'aria-label':'Elimină observația'})));
      for(const field of (type?.fields||[]).filter(item=>item.scoreable!==false)){
        const value=row.values?.[field.id];
        if(field.kind==='measurementMm'){
          const input=el('input',{type:'number',min:'0',step:'0.1',value:value??'','aria-label':field.label,class:'select'});
          input.addEventListener('input',()=>{const number=Number(input.value);if(Number.isFinite(number)&&number>0)row.values[field.id]=Math.round(number*10)/10;else delete row.values[field.id];});
          card.append(el('label',{class:'structured-field'},el('span',{},`${field.label} (mm)`),input));
        }else if(field.kind==='single'){
          const control=el('select',{class:'select','aria-label':field.label},el('option',{value:''},'Necompletat'),...field.options.map(option=>el('option',{value:option.id,selected:(value||[])[0]===option.id},option.label)));
          control.addEventListener('change',()=>{row.values[field.id]=control.value?[control.value]:[];});
          card.append(el('label',{class:'structured-field'},el('span',{},field.label),control));
        }else{
          const checks=el('div',{class:'studio-checks structured-checks'},...field.options.map(option=>{const input=el('input',{type:'checkbox',checked:(value||[]).includes(option.id)});input.addEventListener('change',()=>{const set=new Set(row.values[field.id]||[]);if(input.checked)set.add(option.id);else set.delete(option.id);row.values[field.id]=[...set];});return el('label',{},input,option.label);}));
          card.append(el('div',{class:'structured-field'},el('span',{},field.label),checks));
        }
      }
      root.append(card);
    }
    const add=button([icon('plus',13),'Adaugă observație'],()=>{if(!types[0])return;sectionAnswer.observations.push({typeId:types[0].id,values:{}});draw();onChange(true);},'button ghost');
    root.append(add);
  }
  draw();onChange(sectionAnswer.observations.length>0);
  return root;
}

function structuredFeedback(step,result){
  const detail=el('div',{class:`feedback ${result.correct?'':'wrong'}`},el('h3',{},result.correct?'Etapă corectă':'Răspuns de referință'));
  if(step.kind==='choice'){
    detail.append(el('p',{},`Corect: ${result.expected.map(id=>structuredOptionLabel(step,id)).join('; ')}`));
    if(!result.correct)detail.append(el('p',{},`Răspunsul tău: ${result.selected.map(id=>structuredOptionLabel(step,id)).join('; ')||'—'}`));
  }else{
    detail.append(el('p',{},`Observații potrivite: ${result.hit} din ${result.total}.`));
    detail.append(el('p',{},'Observații de referință:'));
    for(const row of step.expected)detail.append(el('p',{class:'feedback-row'},'• '+describeObservation(step,row)));
    if(!result.correct && result.submitted.length){
      detail.append(el('p',{},'Observațiile tale:'));for(const row of result.submitted)detail.append(el('p',{class:'feedback-row'},'• '+describeObservation(step,row)));
    }
  }
  return detail;
}

function renderStructuredQuestion(main,record,session){
  const q=session.questions[session.index],source=record.pack.cases.find(item=>item.id===q.caseId),review=session.mode==='review',stored=session.answers[session.index];
  if(!source)return;
  let answer=stored?JSON.parse(JSON.stringify(stored)):{sections:{},revealed:{},step:0};
  answer.sections=answer.sections||{};answer.revealed=answer.revealed||{};
  quizTop(main,record,session);
  const viewer=imageViewer(record,source,{allowAnnotations:false});registerCleanup(()=>viewer.destroy());
  const panel=el('section',{class:'question-panel structured-panel','aria-label':'Interpretare structurată'},badge(exerciseLabel(q),'green'),el('h2',{},q.prompt));
  let busy=false;
  const save=next=>commitSession(sessionAnswer(state.session,next));
  if(review){
    const index=Math.min(answer.step||0,q.steps.length-1),step=q.steps[index],sectionAnswer=answer.sections[step.id]||(answer.sections[step.id]=step.kind==='findings'?{observations:[]}:{choiceIds:[]});
    panel.append(el('div',{class:'structured-progress'},`Etapa ${index+1} din ${q.steps.length} · ${stepLabel(step)}`));
    const revealed=answer.revealed[step.id];
    if(revealed){
      const grade=gradeStructured(q,answer),result=grade.results.find(row=>row.stepId===step.id);
      panel.append(structuredFeedback(step,result));
      if(index===q.steps.length-1)panel.append(el('p',{class:'structured-total'},`Rezultat pe caz: ${grade.hit} din ${grade.total} etape corecte.`));
      const last=index===q.steps.length-1;
      panel.append(el('div',{class:'question-actions'},el('span',{class:'field-help'},last?'Rezultatul este salvat o singură dată.':'Următoarea etapă pornește de la informația de referință.'),button([last?'Vezi rezultatul':'Continuă',icon('arrow',16)],act(async()=>{
        if(busy)return;busy=true;
        if(last){const next=advanceSession(state.session,answer);await commitSession(next);await render();}
        else{answer.step=index+1;await save(answer);await render();}
      }))));
    }else{
      const submit=button('Trimite etapa',act(async()=>{
        if(busy)return;busy=true;submit.disabled=true;
        try{
          answer.sections[step.id]=sectionAnswer;answer.revealed[step.id]=true;answer.at=Date.now();
          const grade=gradeStructured(q,answer);
          let nextProgress=null;
          if(index===q.steps.length-1 && !answer.recorded){answer.correct=grade.correct;answer.completed=true;answer.recorded=true;nextProgress=structuredProgress(record,q,grade);}
          await commitSession(sessionAnswer(state.session,answer),nextProgress);
          await render();
        }finally{busy=false;}
      }),'button');
      const body=el('div',{class:'structured-input'},el('p',{class:'field-help'},['examination','projection','diagnosis','differentials','investigations'].includes(step.sectionId)?'Alege toate variantele corecte.':'Completează observațiile pe care le identifici; poți adăuga mai multe rânduri.'),step.kind==='choice'?structuredChoiceInput(step,sectionAnswer,enabled=>{submit.disabled=!enabled;}):structuredFindingsInput(step,sectionAnswer,enabled=>{submit.disabled=!enabled;}));
      body.append(el('div',{class:'question-actions'},el('span',{class:'field-help'},'Răspunsul acestei etape se blochează după trimitere.'),button('Sari peste etapa',act(async()=>{
        answer.sections[step.id]=sectionAnswer;answer.revealed[step.id]=true;
        if(index===q.steps.length-1){
          const grade=gradeStructured(q,answer);answer.correct=grade.correct;answer.completed=true;
          let nextProgress=null;if(!answer.recorded){answer.recorded=true;nextProgress=structuredProgress(record,q,grade);}
          await commitSession(sessionAnswer(state.session,answer),nextProgress);
        }else{answer.step=index+1;await save(answer);}
        await render();
      }),'button ghost'),submit));
      panel.append(body);
    }
  }else{
    for(const step of q.steps){
      const sectionAnswer=answer.sections[step.id]||(answer.sections[step.id]=step.kind==='findings'?{observations:[]}:{choiceIds:[]});
      panel.append(el('section',{class:'structured-exam-step'},el('h3',{},stepLabel(step)),el('p',{class:'field-help'},step.prompt),step.kind==='choice'?structuredChoiceInput(step,sectionAnswer,()=>{}):structuredFindingsInput(step,sectionAnswer,()=>{})));
    }
    panel.append(el('div',{class:'question-actions'},el('span',{class:'field-help'},'Corectarea apare doar la finalul simulării. Poți modifica răspunsurile până atunci.'),button([session.index===session.questions.length-1?'Finalizează simularea':'Confirmă și continuă',icon('arrow',16)],act(async()=>{
      if(busy)return;busy=true;
      const grade=gradeStructured(q,answer);answer.correct=grade.correct;answer.completed=true;answer.at=Date.now();
      const nextProgress=structuredProgress(record,q,grade);
      await commitSession(advanceSession(state.session,answer),nextProgress);await render();
    }),'button')));
  }
  main.append(el('div',{class:'quiz-grid'},viewer.node,panel));
}

function saveWrittenAssessment(record,q,answer,checked,advance){
  let selfAssessments=state.selfAssessments;
  if(checked && !answer.selfRecorded){const key=progressKey(record.id,q.id,'written'),previous=matchingProgress(state.selfAssessments[key],q);selfAssessments={...state.selfAssessments,[key]:{...recordSelfAssessment(previous,{identified:1,total:1}),signature:questionSignature(q),sectionId:q.sectionId,chapterId:q.chapterId,caseId:q.caseId}};}
  const nextAnswer={...answer,selfChecked:checked,selfRecorded:Boolean(answer.selfRecorded||checked)};
  const next=advance?advanceSession(state.session,nextAnswer):sessionAnswer(state.session,nextAnswer);
  return commitSession(next,selfAssessments!==state.selfAssessments?selfAssessments:null);
}

function renderWrittenQuestion(main,record,session){
  const q=session.questions[session.index],source=record.pack.cases.find(item=>item.id===q.caseId),review=session.mode==='review',stored=session.answers[session.index];
  if(!source)return;
  quizTop(main,record,session);
  const viewer=imageViewer(record,source,{allowAnnotations:false});registerCleanup(()=>viewer.destroy());
  const panel=el('section',{class:'question-panel','aria-label':'Răspuns scris'},badge(exerciseLabel(q),'green'),el('h2',{},q.prompt),el('p',{class:'field-help'},'Răspunsul este autoevaluat cu baremul autorului. Nu intră în precizia automată.'));
  if(stored){
    panel.append(el('div',{class:'saved-answer'},stored.text||'—'));
    if(review || session.finished){
      panel.append(el('div',{class:'feedback'},el('h3',{},'Baremul autorului'),el('p',{},q.rubric)));
      const checked=Boolean(stored.selfChecked),input=el('input',{type:'checkbox',checked,disabled:Boolean(stored.selfRecorded)});
      panel.append(el('label',{class:'self-check-row'},input,el('span',{},stored.selfRecorded?'Autoevaluare salvată.':'Am acoperit punctele din barem.')));
      if(review)panel.append(el('div',{class:'question-actions'},el('span',{class:'field-help'},`${session.index+1} din ${session.questions.length}`),button([session.index===session.questions.length-1?'Vezi rezultatul':'Continuă',icon('arrow',16)],act(async()=>{await saveWrittenAssessment(record,q,{...stored,selfChecked:input.checked},input.checked,true);await render();}))));
    }
  }else{
    const textarea=el('textarea',{class:'interpretation-input','aria-label':'Răspunsul tău',rows:'6',maxlength:'4000'});
    const submit=button(review?'Trimite răspunsul':session.index===session.questions.length-1?'Finalizează simularea':'Confirmă și continuă',act(async()=>{
      if(!textarea.value.trim()){toast('Scrie un răspuns.',true);return;}
      const answer={text:textarea.value.trim(),at:Date.now()};
      if(review){await commitSession(sessionAnswer(state.session,answer));await render();}
      else{await commitSession(advanceSession(state.session,answer));await render();}
    }),'button',{disabled:true});
    textarea.addEventListener('input',()=>{submit.disabled=!textarea.value.trim();});
    panel.append(textarea,el('div',{class:'question-actions'},el('span',{class:'field-help'},'Răspunsul se salvează local.'),submit));
  }
  main.append(el('div',{class:'quiz-grid'},viewer.node,panel));
}

function confirmFinishSession(before=null){
  const session=state.session;if(!session || session.finished)return;
  const answered=receivedAnswers(session).length;
  modal('Închei sesiunea?',el('p',{class:'modal-body'},answered?`Ai parcurs ${answered} exerciții. Răspunsurile confirmate rămân salvate; cele fără răspuns nu contează.`:'Nu ai răspuns la niciun exercițiu. Sesiunea va fi închisă.'),[
    button('Continuă sesiunea',()=>document.getElementById('modal').close(),'button secondary'),
    button(answered?'Încheie și vezi rezultatele':'Închide sesiunea',act(async()=>{
      document.getElementById('modal').close();if(typeof before==='function')await before();
      const current=state.session;if(!receivedAnswers(current).length){await setMeta('session',null);state.session=null;await render();toast('Sesiune închisă.');return;}
      const next=finishSessionEarly(current);await setMeta('session',next);state.session=next;
      const target=next.mode==='exam'?'exam':'practice';
      if(location.hash===`#${target}`)await render();else location.hash=target;
    }),'button danger')]);
}

function exerciseStatus(record,q,answer){
  if(!answer || answer.skipped)return {label:'Sărit',kind:''};
  if(q.kind==='structured'){
    if(!answer.completed)return {label:'Incomplet',kind:''};
    const progress=matchingProgress(state.progress[progressKey(record.id,q.id,q.kind)],q);
    return progress?.attempts?{label:`${progress.identified}/${progress.total} etape`,kind:progress.lastCorrect?'green':'orange'}:{label:'Neînregistrat',kind:'orange'};
  }
  if(q.kind==='written'){
    const progress=matchingProgress(state.selfAssessments[progressKey(record.id,q.id,q.kind)],q);
    return progress?.attempts?{label:progress.lastCorrect?'Autoevaluat':'De refăcut',kind:progress.lastCorrect?'green':'orange'}:{label:'Neautoevaluat',kind:'orange'};
  }
  if(q.kind==='interpretation'||q.kind==='regions'){
    const progress=matchingProgress(state.selfAssessments[progressKey(record.id,q.id,q.kind)],q);
    return progress?.attempts?{label:`${progress.identified}/${progress.total} identificate`,kind:progress.lastCorrect?'green':'orange'}:{label:'Neautoevaluat',kind:'orange'};
  }
  return answer.correct?{label:'Corect',kind:'green'}:{label:'De revizuit',kind:'orange'};
}

function learnerAnswerBlock(record,q,answer){
  if(!answer || answer.skipped)return el('p',{},'Exercițiu sărit.');
  if(q.kind==='structured'){
    return el('div',{},...q.steps.map(step=>{
      const row=answer.sections?.[step.id]||{};
      const text=step.kind==='findings'?(row.observations||[]).map(item=>describeObservation(step,item)).join('; ')||'—':(row.choiceIds||[]).map(id=>structuredOptionLabel(step,id)).join('; ')||'—';
      return el('div',{class:'learner-section'},el('strong',{},stepLabel(step)),el('p',{},text));
    }));
  }
  if(q.kind==='written')return el('p',{},answer.text||'—');
  if(q.kind==='interpretation'){
    return el('div',{},...q.sections.map(section=>el('div',{class:'learner-section'},el('strong',{},section.label),el('p',{},answer.textAnswers?.[section.id] || '—'))));
  }
  if(q.kind==='regions'){
    return el('div',{},...q.regions.map(region=>el('div',{class:'learner-section'},el('strong',{},`Regiunea ${region.label}`),el('p',{},answer.regionAnswers?.[region.annotationId] || '—'))));
  }
  return el('p',{},answerSummary(record,q,answer));
}

async function saveResultSelfAssessment(record,q,index,checks){
  const items=selfAssessmentItems(record,q),checked=[...new Set(Object.values(checks).flat())].filter(id=>items.some(item=>item.id===id));
  const key=progressKey(record.id,q.id,q.kind),previous=matchingProgress(state.selfAssessments[key],q);
  const nextAssessments={...state.selfAssessments,[key]:{...recordSelfAssessment(previous,{identified:checked.length,total:items.length}),signature:questionSignature(q),sectionId:q.sectionId,chapterId:q.chapterId,caseId:q.caseId}};
  const answers=[...state.session.answers];answers[index]={...answers[index],selfChecks:checks,selfTouched:true,selfRecorded:true,selfComplete:checked.length===items.length&&items.length>0};
  await commitSession({...state.session,answers},state.progress,nextAssessments);
}

function structuredExplanation(q,answer){
  const grade=gradeStructured(q,answer),root=el('div',{class:'structured-feedback'});
  root.append(el('p',{class:'field-help'},`Rezultat: ${grade.hit} din ${grade.total} etape corecte.`));
  for(const result of grade.results){
    const step=q.steps.find(row=>row.id===result.stepId);
    root.append(el('section',{class:'explanation-section'},el('h3',{},stepLabel(step)),structuredFeedback(step,result)));
  }
  return root;
}

async function saveResultWrittenAssessment(record,q,index,checked){
  let selfAssessments=state.selfAssessments;
  if(checked){const key=progressKey(record.id,q.id,'written'),previous=matchingProgress(state.selfAssessments[key],q);selfAssessments={...state.selfAssessments,[key]:{...recordSelfAssessment(previous,{identified:1,total:1}),signature:questionSignature(q),sectionId:q.sectionId,chapterId:q.chapterId,caseId:q.caseId}};}
  const answers=[...state.session.answers];answers[index]={...answers[index],selfChecked:checked,selfRecorded:Boolean(checked||answers[index]?.selfRecorded)};
  await commitSession({...state.session,answers},state.progress,selfAssessments!==state.selfAssessments?selfAssessments:null);
}

function openExplanation(record,session,index){
  const q=session.questions[index],answer=session.answers[index],source=record.pack.cases.find(item=>item.id===q.caseId);
  if(!source)return;
  const urls=[];
  const image=el('img',{class:'explanation-image',alt:`Radiografie: ${source.title}`});
  image.addEventListener('click',()=>toggleFullscreen(image));
  let disposed=false,url;
  assetBlob(record,source.images.find(row=>row.role!=='comparison')?.path || source.images[0].path).then(blob=>{if(!disposed && blob){url=URL.createObjectURL(blob);image.src=url;}}).catch(()=>{});
  urls.push(()=>{disposed=true;if(url)URL.revokeObjectURL(url);});
  const labels=canonicalDiagnosisLabels(record,q.caseId),selfKind=q.kind==='interpretation'||q.kind==='regions',writtenKind=q.kind==='written';
  let checks={...(answer?.selfChecks || {})},writtenChecked=Boolean(answer?.selfChecked);
  const reference=q.kind==='structured'?structuredExplanation(q,answer)
    :writtenKind?el('div',{class:'feedback'},el('h3',{},'Baremul autorului'),el('p',{},q.rubric),el('label',{class:'self-check-row'},el('input',{type:'checkbox',checked:writtenChecked,disabled:Boolean(answer?.selfRecorded),onchange:event=>{writtenChecked=event.target.checked;}}),el('span',{},answer?.selfRecorded?'Autoevaluare salvată.':'Am acoperit punctele din barem.')))
    :selfKind
    ? selfCheckPanel(record,q,{...answer,selfChecks:checks},(id,on,sectionId)=>{const set=new Set(checks[sectionId]||[]);if(on)set.add(id);else set.delete(id);checks[sectionId]=[...set];})
    : q.kind==='matching'?matchingFeedback(record,q,answer):answerFeedback(record,q,answer);
  const body=el('div',{class:'explanation-body'},
    el('div',{class:'explanation-figure'},image),
    fullscreenButton(image),
    el('div',{class:'diagnosis-line'},el('span',{},'Diagnostic pozitiv'),el('strong',{},labels.join('; ') || 'Neprecizat în sursă')),
    el('div',{class:'learner-answer'},el('span',{},'Răspunsul tău'),learnerAnswerBlock(record,q,answer)),
    reference,
    el('details',{class:'complete-explanation'},el('summary',{},'Vezi explicația completă'),el('div',{},...SECTION_ORDER.map(sectionId=>{
      const section=source.sections.find(row=>row.id===sectionId);
      return el('section',{class:'explanation-section'},el('h3',{},SECTION_LABELS[sectionId]),section?.items.length?el('ul',{},...section.items.map(item=>el('li',{},item.text))):el('p',{class:'missing'},'Nu este precizat în notițele sursă.'));
    }))));
  const actions=[];
  if(writtenKind && answer && !answer.skipped && !answer.selfRecorded)actions.push(button('Salvează autoevaluarea',act(async()=>{await saveResultWrittenAssessment(record,q,index,writtenChecked);dialog.close();await render();toast(writtenChecked?'Autoevaluare salvată.':'Răspunsul rămâne neautoevaluat.');}),'button'));
  else if(selfKind && answer && !answer.skipped)actions.push(button('Salvează autoevaluarea',act(async()=>{await saveResultSelfAssessment(record,q,index,checks);dialog.close();await render();toast('Autoevaluare salvată.');}),'button'));
  actions.push(button('Înapoi la rezultate',()=>dialog.close(),'button secondary'));
  const dialog=modal(`${source.title} · ${exerciseLabel(q)}`,body,actions);
  dialog.classList.add('explanation-modal');
  const cleanup=()=>{urls.forEach(fn=>fn());dialog.classList.remove('explanation-modal');dialog.removeEventListener('close',cleanup);};
  dialog.addEventListener('close',cleanup);
}

function renderResults(main,record,session){
  const rows=session.questions.map((q,index)=>({q,answer:session.answers[index],index})).filter(row=>row.answer);
  const auto=rows.filter(row=>['catalogue','mcq','matching','structured'].includes(row.q.kind) && !row.answer.skipped && (row.q.kind!=='structured' || row.answer.completed));
  const written=rows.filter(row=>['interpretation','regions','written'].includes(row.q.kind) && !row.answer.skipped);
  const autoCorrect=auto.filter(row=>row.answer.correct).length;
  const summary=el('div',{class:'results-summary'});
  if(auto.length)summary.append(el('div',{class:'summary-card'},el('strong',{},`${autoCorrect} din ${auto.length}`),el('span',{},'exerciții cu corectare automată')));
  if(written.length)summary.append(el('div',{class:'summary-card'},el('strong',{},`${written.length}`),el('span',{},'răspunsuri autoevaluate')));
  if(!auto.length && !written.length)summary.append(el('div',{class:'summary-card'},el('strong',{},'0'),el('span',{},'exerciții încheiate')));
  main.append(heading(session.finishedEarly?'Sesiune încheiată devreme':'Rezultate',session.finishedEarly?'Doar exercițiile la care ai răspuns sunt numărate.':'Răspunsurile sunt salvate. Poți revedea fiecare explicație fără să părăsești pagina.'),summary);
  const list=el('div',{class:'result-list'});
  for(const row of rows){
    const {q,answer,index}=row,source=record.pack.cases.find(item=>item.id===q.caseId),status=exerciseStatus(record,q,answer);
    const thumbButton=button(imageThumb(record,source,'result-image'),()=>openExplanation(record,session,index),'result-thumb',{'aria-label':`Vezi explicația pentru ${source.title}`});
    list.append(el('article',{class:'result-row'},thumbButton,el('div',{class:'result-copy'},el('div',{class:'section-head'},el('h3',{},`${source.title} · ${exerciseLabel(q)}`),badge(status.label,status.kind)),el('p',{},answerSummary(record,q,answer)),button('Vezi explicația',()=>openExplanation(record,session,index),'button secondary'))));
  }
  main.append(list);
  const unanswered=session.questions.length-rows.length;
  if(unanswered)main.append(el('p',{class:'field-help'},`${unanswered} exerciții nu au fost parcurse.`));
  main.append(el('div',{class:'button-row'},button('O sesiune nouă',act(async()=>{await setMeta('session',null);state.session=null;await render();})),link('Continuă studiul','#library','button secondary')));
}

function renderProgress(main){
  const record=active();if(!record){main.append(noPack());return;}const pack=record.pack,pools=availableExercises(pack,record.bank,{chapterIds:[]});
  const autoQuestions=[...pools.short.filter(q=>q.kind!=='written'),...pools.matching,...pools.structured],written=[...pools.interpretation,...pools.regions,...pools.short.filter(q=>q.kind==='written')];
  const autoData=autoQuestions.map(q=>({q,record:matchingProgress(state.progress[progressKey(record.id,q.id,q.kind)],q)})).filter(row=>row.record);
  const selfData=written.map(q=>({q,record:matchingProgress(state.selfAssessments[progressKey(record.id,q.id,q.kind)],q)})).filter(row=>row.record);
  const attempts=autoData.reduce((n,row)=>n+row.record.attempts,0),correct=autoData.reduce((n,row)=>n+row.record.correct,0);
  const seen=pack.cases.filter(item=>state.visited.includes(visitKey(record,item))).length;
  const interpreted=new Set(selfData.map(row=>row.q.caseId)).size;
  const due=autoData.filter(row=>row.record.dueAt<=Date.now()).length+selfData.filter(row=>row.record.dueAt<=Date.now()).length;
  main.append(heading('Progres','Ce ai citit, ce ai exersat și ce merită revizuit.'));
  main.append(el('section',{class:'panel progress-note'},el('h2',{},'Ce intră în progres'),el('p',{},'Include exercițiile din Recapitulare și Simulare. Întrebările cu răspuns automat intră în precizie. Interpretările scrise sunt autoevaluate și apar separat.')));
  main.append(el('div',{class:'stats-row'},stat('Cazuri citite',`${seen} / ${pack.cases.length}`),stat('Cazuri autoevaluate',interpreted),stat('Întrebări cu răspuns automat',attempts),stat('Precizie',attempts?`${pct(correct,attempts)}%`:'—'),stat('De recapitulat',due)));
  const chapterRows=pack.curriculum.chapters.map(chapter=>{
    const all=pack.cases.filter(item=>item.chapterId===chapter.id),visited=all.filter(item=>state.visited.includes(visitKey(record,item))).length;
    const auto=autoData.filter(row=>row.q.chapterId===chapter.id),self=selfData.filter(row=>row.q.chapterId===chapter.id);
    const n=auto.reduce((sum,row)=>sum+row.record.attempts,0),c=auto.reduce((sum,row)=>sum+row.record.correct,0);
    const dueRows=auto.filter(row=>row.record.dueAt<=Date.now()).length+self.filter(row=>row.record.dueAt<=Date.now()).length;
    return el('tr',{},el('td',{},chapter.label),el('td',{},`${visited} / ${all.length}`),el('td',{},n),el('td',{},n?`${pct(c,n)}%`:'—'),el('td',{},self.length),el('td',{},dueRows));
  });
  main.append(el('section',{class:'panel'},el('div',{class:'section-head'},el('h2',{},'Pe capitole')),el('div',{class:'table-wrap'},el('table',{class:'table'},el('thead',{},el('tr',{},...['Capitol','Cazuri citite','Întrebări','Precizie','Autoevaluări','De recapitulat'].map(label=>el('th',{scope:'col'},label)))),el('tbody',{},...chapterRows)))));
  main.append(el('div',{class:'section-head'},el('h2',{},'De revizuit')));
  const mistakes=autoData.filter(row=>!row.record.lastCorrect).sort((a,b)=>b.record.lastAt-a.record.lastAt).slice(0,6);
  const incomplete=selfData.filter(row=>!row.record.lastCorrect).sort((a,b)=>b.record.lastAt-a.record.lastAt).slice(0,6);
  if(!mistakes.length && !incomplete.length)main.append(el('section',{class:'panel privacy-panel'},el('p',{},attempts||selfData.length?'Nimic de revizuit la ultima trecere. Continuă cu material nou.':'După primele exerciții, aici apar întrebările și interpretările la care merită să revii.')));
  const reviewRow=(q,progress,label)=>el('div',{class:'result-row'},el('div',{class:'result-copy'},
    el('div',{class:'section-head'},el('h3',{},`${pack.cases.find(item=>item.id===q.caseId).title} · ${exerciseLabel(q)}`),badge(label,'orange')),
    el('p',{},`${chapterLabel(pack,q.chapterId)} · ${progress.attempts} ${progress.attempts===1?'încercare':'încercări'} · ${dateLabel(progress.lastAt)}`),
    link('Revezi cazul →',`#case/${q.caseId}`,'text-link')));
  if(mistakes.length)main.append(el('section',{class:'panel'},el('h2',{},'Întrebări de revizuit'),el('div',{class:'result-list'},...mistakes.map(({q,record:progress})=>reviewRow(q,progress,'De revizuit')))));
  if(incomplete.length)main.append(el('section',{class:'panel'},el('h2',{},'Autoevaluări de refăcut'),el('div',{class:'result-list'},...incomplete.map(({q,record:progress})=>reviewRow(q,progress,`${progress.identified}/${progress.total} identificate`)))));
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
    el('p',{class:'field-help'},'Verifică buildul publicat față de buildul activ și îl aplică fără să șteargă materialele sau progresul. Reîncărcarea forțată este rezerva pentru un worker blocat.'),
    state.prompt?button('Instalează aplicația',act(async()=>{await state.prompt.prompt();state.prompt=null;await render();})):null,
    el('ol',{class:'install-steps'},el('li',{},'iPhone / iPad: Safari → Partajează → Adaugă pe ecranul principal.'),el('li',{},'Android: Chrome → meniu → Instalează / Adaugă pe ecranul principal.'),el('li',{},'Windows: Chrome sau Edge → pictograma de instalare din bara de adrese.'),el('li',{},'macOS: Safari → Fișier → Adaugă în Dock; sau instalare din Chrome/Edge.')),
    el('details',{class:'help-details'},el('summary',{},'Ai deschis linkul din Discord sau altă aplicație?'),el('p',{},'Deschide meniul linkului și alege Safari sau Chrome. Dacă opțiunea lipsește, copiază linkul și lipește-l în browser.')));
  const privacy=el('section',{class:'settings-card'},el('h2',{},icon('shield',19),'Datele rămân pe dispozitiv'),el('p',{},'Fără cont, reclame sau trimiterea materialelor către un server. Materialele, răspunsurile și progresul sunt salvate local.'));
  const packs=el('section',{class:'settings-card full'},el('h2',{},icon('book',19),'Materiale pe acest dispozitiv'));
  if(!state.packs.length)packs.append(el('p',{},'Niciun material importat încă.'));
  for(const record of state.packs)packs.append(el('div',{class:'detail-row'},el('div',{},el('strong',{},record.pack.title),el('p',{class:'field-help'},`${record.pack.cases.length} cazuri`)),
    el('div',{class:'button-row'},button('Salvează pachetul',act(()=>exportPack(record)),'button secondary'),button('Elimină',()=>confirmRemove(record),'button danger'))));
  main.append(el('div',{class:'settings-grid'},backup,install,privacy,packs));
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

async function filesForPack(record,prefix=''){
  const files=[{name:prefix+'pack.json',data:JSON.stringify(record.pack)}];
  if(record.bank)files.push({name:prefix+'questions.json',data:JSON.stringify(record.bank)});
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
    for(const [i,record] of state.packs.entries()){const folder=`packs/${String(i).padStart(3,'0')}/`;snapshot.packFolders.push({folder,id:record.id,revision:record.pack.revision});files.push(...await filesForPack(record,folder));job.update((i+1)/state.packs.length*.2);}
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
  await installPacks([prepared]);state.packs=await listPacks();state.activeId=prepared.pack.id;
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
    state.packs=await listPacks();await reloadLearning();if(!active())state.activeId=state.packs[0]?.id;state.session=null;await setMeta('session',null);
    job.finish();await render();toast('Materialele și progresul au fost restaurate.');
  }catch(error){job.finish();if(error.name!=='AbortError')throw error;}finally{installing=false;}
}

function confirmRemove(record){
  modal('Elimini materialul de pe acest dispozitiv?',el('p',{class:'modal-body'},`Imaginile și explicațiile din „${record.pack.title}” vor fi eliminate. Progresul și cazurile salvate rămân păstrate pentru o eventuală reimportare. Exportă pachetul sau o copie completă înainte, dacă nu ai altă copie.`),[
    button('Renunță',()=>document.getElementById('modal').close(),'button secondary'),button('Elimină materialul',act(async()=>{await removePack(record);state.packs=await listPacks();if(state.activeId===record.id)state.activeId=state.packs[0]?.id || null;if(state.session?.packId===record.id){state.session=null;await setMeta('session',null);}document.getElementById('modal').close();await render();toast('Material eliminat. Progresul a fost păstrat.');}),'button danger'),
  ]);
}

async function loadStarter(){
  requireThat(state.starter && safePath(state.starter.path) && state.starter.path.startsWith('packs/'),'Pachetul de curs nu este configurat.');
  const response=await fetch(new URL(state.starter.path,document.baseURI));requireThat(response.ok,'Pachetul de curs nu poate fi descărcat. Importă fișierul ZIP original.');
  const blob=await response.blob();await importPackFile(new File([blob],'radiografii-explicate.study.zip',{type:'application/zip'}));
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

async function checkForUpdates(){
  if(state.updateChecking)return;
  if(!state.registration){
    toast('Actualizarea automată nu este disponibilă în acest browser. Reîncarcă pagina.',true);
    return;
  }
  state.updateChecking=true;refreshUpdateControls();
  try{
    const [latest,current]=await Promise.all([latestRelease(),activeBuildId()]);
    let status=state.registration.waiting?'waiting':'none';
    if(status!=='waiting'){
      await state.registration.update();
      status=await waitForInstalledWorker(state.registration,15000);
    }
    if(status!=='waiting' && latest?.buildId && current && latest.buildId!==current){
      const registration=await registerBuild(latest.buildId);
      if(registration)status=await waitForInstalledWorker(registration,10000);
    }
    state.updateChecking=false;refreshUpdateControls();
    if(status==='waiting'){
      if(state.session && !state.session.finished){toast('Versiunea nouă se aplică după ce închei sesiunea.');await render();}
      else{toast('Se aplică versiunea nouă…');await activateUpdate();}
      return;
    }
    if(latest?.buildId && current && latest.buildId!==current){
      toast('Există o versiune nouă, dar workerul nu s-a activat. Reîncarc forțat.',true);
      if(navigator.onLine)await forceRefresh();
      else toast('Reconectează-te la internet și încearcă din nou.',true);
      return;
    }
    toast('Ai deja cea mai recentă versiune.');
  }catch{
    state.updateChecking=false;refreshUpdateControls();
    toast('Nu am putut verifica actualizările. Verifică conexiunea și încearcă din nou.',true);
  }
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
  [state.packs,state.activeId,state.session]=await Promise.all([listPacks(),getMeta('activeId'),getMeta('session')]);await reloadLearning();
  if(!state.activeId || !state.packs.some(row=>row.id===state.activeId))state.activeId=state.packs[0]?.id || null;
  if(state.session && !state.packs.some(row=>row.id===state.session.packId && row.pack.revision===state.session.revision)){state.session=null;await setMeta('session',null);}
  await render();setupOffline();
  fetch('./starter.json',{cache:'no-store'}).then(response=>response.ok?response.json():null).then(starter=>{
    if(starter && safePath(starter.path) && starter.path.startsWith('packs/') && Number.isInteger(starter.cases) && Number.isFinite(starter.bytes)){state.starter=starter;if(state.route==='library' && !active())render().catch(()=>{});}
  }).catch(()=>{});
}

window.addEventListener('hashchange',()=>render().catch(error=>toast(friendlyError(error),true)));
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();state.prompt=event;if(state.route==='settings')render().catch(()=>{});});
document.getElementById('pack-input').addEventListener('change',act(async event=>{const file=event.target.files[0];event.target.value='';if(file)await importPackFile(file);}));
document.getElementById('backup-input').addEventListener('change',act(async event=>{const file=event.target.files[0];event.target.value='';if(file)await restoreBackup(file);}));
boot().catch(error=>{document.getElementById('app').replaceChildren(el('main',{class:'fatal'},el('img',{src:'./icons/icon.svg',width:'48',height:'48',alt:''}),el('h1',{},'Să pregătim spațiul de studiu.'),el('p',{},friendlyError(error)),el('p',{},'Folosește un browser actualizat, într-o fereastră obișnuită. Dacă linkul a fost deschis din altă aplicație, copiază-l în Safari, Chrome, Edge sau Firefox.'),button('Încearcă din nou',()=>location.reload())));});
