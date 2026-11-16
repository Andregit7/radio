import { APP_VERSION, SECTION_LABELS, normalise, matches, shuffled, progressKey, gradeAnswer, scheduleReview,
  chooseQuestions, availableQuestions, bytesLabel, dateLabel, questionSignature, matchingProgress } from './core.js';
import { LIMITS, parseJSON, requireThat, validateFiles, safePath } from './schema.js';
import { openDatabase, listPacks, assetBlob, packAssets, getMeta, setMeta, setMetas, installPacks, removePack,
  learningSnapshot, validateLearning, mergeLearning, restoreLearningFile } from './storage.js';
import { archiveJob } from './archive.js';
import { el, button, link, badge, icon, toast, modal } from './dom.js';
import { imageViewer } from './viewer.js';
import { catalogueSelector } from './catalogue.js';

const state={packs:[],activeId:null,progress:{},bookmarks:[],visited:[],session:null,starter:null,offlineReady:false,registration:null,prompt:null,route:'library',page:0,chapter:'all',query:'',onlyBookmarks:false};
let cleanup=[],renderToken=0,activeExport=false,installing=false;
const act=fn=>async event=>{try{return await fn(event);}catch(error){toast(friendlyError(error),true);}};
const active=()=>state.packs.find(row=>row.id===state.activeId) || state.packs[0];
const visitKey=(record,item)=>`${record.id}|${item.id}`;
function friendlyError(error){return error?.name==='QuotaExceededError'?'Eroare de spațiu: pachetul nu a fost salvat. Eliberează spațiu și încearcă din nou. Datele existente au rămas intacte.':error?.message || 'Operația nu a putut fi finalizată.';}
function registerCleanup(fn){cleanup.push(fn);}
function chapterLabel(pack,id){return pack.curriculum.chapters.find(row=>row.id===id)?.label || id;}
function pct(n,total){return total?Math.round(n/total*100):0;}
function bar(value){const fill=el('span');fill.style.width=`${Math.max(0,Math.min(100,value))}%`;return el('div',{class:'thin-progress'},fill);}
function heading(kicker,title,description,action=null){return el('header',{class:'page-head'},el('div',{},el('div',{class:'eyebrow'},kicker),el('h1',{},title),description?el('p',{},description):null),action);}
function stat(label,value,name){return el('div',{class:'stat'},el('div',{},el('div',{class:'stat-label'},label),el('div',{class:'stat-value'},value)),el('div',{class:'stat-icon'},icon(name,19)));}
function noPack(){return el('div',{class:'empty-state'},el('div',{class:'round-icon'},icon('book',25)),el('h2',{},'Mai întâi, un pachet.'),el('p',{},'Adaugă materialele tale pentru a începe să studiezi și să exersezi.'),link('Deschide biblioteca','#library','button'));}

function imageThumb(record,item,className='',onCleanup=registerCleanup){
  const img=el('img',{alt:`Radiografie: ${item.title}`,class:className,loading:'lazy'});let disposed=false,url;
  assetBlob(record,item.images[0].path).then(blob=>{if(!disposed && blob){url=URL.createObjectURL(blob);img.src=url;}}).catch(()=>{});
  onCleanup(()=>{disposed=true;if(url)URL.revokeObjectURL(url);});return img;
}

function shell(){
  const record=active();const routes=[['library','Bibliotecă','book'],['practice','Recapitulare','repeat'],['exam','Simulare','exam'],['progress','Progres','chart']];
  const current=state.route.startsWith('case/') || state.route==='cases'?'library':state.route;
  const nav=routes.map(([route,label,name])=>link([icon(name),el('span',{},label)],`#${route}`,`nav-item ${current===route?'active':''}`));
  const side=el('aside',{class:'sidebar'},link([el('img',{src:'./icons/icon.svg',alt:''}),el('div',{},el('div',{class:'brand-word'},'radia',el('span',{},'·')),el('div',{class:'brand-caption'},'Radiologie, înțeleasă.'))],'#library','brand'),
    el('div',{class:'nav-caption'},'Spațiul tău de studiu'),el('nav',{class:'nav-list','aria-label':'Navigare principală'},...nav),
    el('div',{class:'sidebar-bottom'},link([icon('settings'),el('span',{},'Date & instalare')],'#settings',`nav-item ${current==='settings'?'active':''}`),
      el('div',{class:'private-note'},icon('shield',17),el('span',{},'Materialele și progresul rămân pe dispozitivul tău.')),
      el('div',{class:'sidebar-version'},el('span',{},'STUDY APP'),el('span',{},`v${APP_VERSION}`))));
  const packSelect=state.packs.length>1?el('select',{class:'pack-select','aria-label':'Pachet activ',onchange:act(async event=>{state.activeId=event.target.value;state.page=0;state.chapter='all';state.query='';await setMeta('activeId',state.activeId);location.hash='library';await render();})},...state.packs.map(row=>el('option',{value:row.id,selected:row.id===record?.id},row.pack.title))):el('span',{class:'pack-select'},record?.pack.curriculum.title || 'Spațiul tău de studiu');
  const title={library:'Biblioteca mea',cases:'Toate cazurile',practice:'Recapitulare',exam:'Simulare de examen',progress:'Progres',settings:'Date & instalare'}[state.route] || 'Interpretare';
  const top=el('header',{class:'topbar'},link([el('img',{src:'./icons/icon.svg',alt:''}),'radia'],'#library','mobile-brand'),el('div',{class:'breadcrumb'},'Spațiul de studiu',icon('chevron',12),el('strong',{},title)),
    el('div',{class:'topbar-right'},packSelect,el('span',{class:'local-pill',id:'offline-status'},el('span',{class:'status-dot'}),state.offlineReady?'Pregătit offline':'Pe dispozitivul tău'),el('div',{class:'avatar','aria-label':'Fără cont'},icon('sun',16))));
  const main=el('main',{class:'content',id:'main',tabindex:'-1'});
  const update=state.registration?.waiting?el('div',{class:'update-banner'},el('span',{},'O versiune nouă este gata.'),button('Actualizează după sesiune',act(applyUpdate),'button secondary')):null;
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
  main.append(heading('Biblioteca mea','Învață să vezi.','Radiografii, explicații și exerciții. În ritmul tău, oriunde ai fi.',button([icon('plus',17),'Importă pachet'],()=>document.getElementById('pack-input').click())));
  if(/FBAN|FBAV|Instagram|Discord|; wv\)/i.test(navigator.userAgent))main.append(el('div',{class:'embedded-banner'},el('span',{},'Pentru instalare și date păstrate în același loc, deschide Radia în Safari sau Chrome.'),link('Vezi instrucțiunile','#settings','button secondary')));
  if(!record){
    main.append(el('section',{class:'empty-library'},el('div',{class:'round-icon'},icon('book',28)),el('h2',{},'Atlasul tău începe aici.'),el('p',{},'Importă un pachet ZIP primit de la colegi. Imaginile, explicațiile și exercițiile vor fi disponibile pe acest dispozitiv.'),
      el('div',{class:'button-row'},button([icon('upload',17),'Alege un pachet ZIP'],()=>document.getElementById('pack-input').click()),state.starter?button('Adaugă pachetul de curs',act(loadStarter),'button secondary'):null),
      state.starter?el('div',{class:'starter-footnote'},`${state.starter.cases} de cazuri · ${bytesLabel(state.starter.bytes)} · din notițele tale`):null));
    main.append(el('div',{class:'bottom-grid',style:null},el('section',{class:'panel privacy-panel'},el('h3',{},'Fără cont. Fără upload.'),el('p',{},'Pachetul este citit local. Doar tu alegi fișierul, iar aplicația nu îl trimite către un server.')),el('section',{class:'panel privacy-panel'},el('h3',{},'Un loc pentru fiecare capitol.'),el('p',{},'Respirator, digestiv, renal, osos — sau orice structură definită de pachet.'))));return;
  }
  const pack=record.pack,questions=[...availableQuestions(pack,record.bank,{kind:'catalogue'}),...availableQuestions(pack,record.bank,{kind:'mcq'})],learned=pack.cases.filter(item=>state.visited.includes(visitKey(record,item))).length;
  const valid=questions.map(q=>matchingProgress(state.progress[progressKey(record.id,q.id,q.kind)],q)).filter(Boolean);
  const attempts=valid.reduce((n,r)=>n+r.attempts,0),correct=valid.reduce((n,r)=>n+r.correct,0),due=valid.filter(r=>r.dueAt<=Date.now()).length;
  main.append(el('div',{class:'stats-row'},stat('Cazuri în bibliotecă',pack.cases.length,'image'),stat('Cazuri parcurse',learned,'eye'),stat('Răspunsuri corecte',attempts?`${pct(correct,attempts)}%`:'—','check'),stat('De recapitulat',due,'repeat')));
  const first=pack.cases[0],film=el('div',{class:'hero-visual','aria-hidden':'true'},el('div',{class:'film-card back'}),el('div',{class:'film-card'},imageThumb(record,first),el('div',{class:'film-caption'},'RADIOGRAFII EXPLICATE · ATLAS')));
  const next=pack.cases.find(item=>!state.visited.includes(visitKey(record,item))) || first;
  main.append(el('section',{class:'hero-pack'},el('div',{class:'hero-copy'},badge('PACHETUL TĂU DE CURS','outline'),el('h2',{},pack.title),el('p',{},`${pack.cases.length} de cazuri, organizate în ${pack.curriculum.chapters.length} capitole. Urmărește explicațiile și descoperă detaliile fiecărei imagini.`),el('div',{class:'button-row'},link(['Continuă studiul',icon('arrow',16)],`#case/${next.id}`,'button'),link('Toate cazurile','#cases','button ghost'))),film));
  main.append(el('div',{class:'section-head'},el('h2',{},'Explorează pe capitole'),el('span',{class:'caption'},pack.curriculum.title)));
  main.append(el('div',{class:'chapter-grid'},...pack.curriculum.chapters.map((chapter,index)=>{
    const items=pack.cases.filter(item=>item.chapterId===chapter.id),seen=items.filter(item=>state.visited.includes(visitKey(record,item))).length;
    return el('a',{href:'#cases',class:'chapter-card',onclick:()=>{state.chapter=chapter.id;state.query='';state.page=0;}},el('div',{class:'chapter-image'},items[0]?imageThumb(record,items[0]):null,el('span',{class:'chapter-number'},String(index+1).padStart(2,'0'))),
      el('div',{class:'chapter-copy'},el('div',{class:'chapter-title'},el('h3',{},chapter.label),icon('arrow',15)),el('p',{},`${items.length} ${items.length===1?'caz':'cazuri'} · ${pack.diagnoses.filter(d=>d.chapterIds.includes(chapter.id)).length} diagnostice`),bar(pct(seen,items.length)),el('div',{class:'chapter-progress-label'},`${seen} din ${items.length} parcurse`)));
  })));
  main.append(el('div',{class:'bottom-grid'},el('section',{class:'panel review-teaser'},el('div',{class:'round-icon'},icon('repeat',24)),el('div',{},el('h3',{},due?'Câteva detalii merită revăzute.':'Puțin azi. Mai clar mâine.'),el('p',{},due?`${due} întrebări sunt pregătite pentru o nouă recapitulare.`:'Exersează cu grile și diagnostice din programa ta.'),link(['Începe o recapitulare',icon('arrow',14)],'#practice','text-link'))),el('section',{class:'panel privacy-panel'},el('h3',{},[icon('shield',17),' Doar pe dispozitivul tău']),el('p',{},'Păstrează o copie a progresului. Poți muta studiul pe alt dispozitiv prin export și import.'),link(['Date & backup',icon('arrow',14)],'#settings','text-link'))));
  main.append(el('footer',{class:'pack-foot'},el('span',{},`${pack.title} · v${pack.revision} · ${bytesLabel(record.total)} pe dispozitiv`),el('span',{},'Materiale de curs · explicațiile abreviate sunt marcate')));
}

function renderCases(main){
  const record=active();if(!record){main.append(noPack());return;}const pack=record.pack;
  main.append(heading('Atlas · '+pack.title,'Un caz. O privire mai atentă.','Alege un capitol sau găsește o explicație din notițe.'));
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
    results.replaceChildren(items.length?el('div',{class:'case-grid'},...items.map(item=>link([el('div',{class:'case-photo'},imageThumb(record,item,'',dispose=>thumbnails.push(dispose)),badge(chapterLabel(pack,item.chapterId))),el('div',{class:'case-card-copy'},el('h3',{},item.title),el('p',{},pack.diagnoses.find(d=>d.id===item.diagnosisIds[0])?.label || 'Interpretare din notițe'),el('div',{class:'case-meta'},el('span',{},item.completeness==='diagnosis-only'?'Explicație abreviată':`${item.sections.filter(s=>s.items.length).length} secțiuni`),state.visited.includes(visitKey(record,item))?icon('check',14):el('span',{},'Deschide →')))],`#case/${item.id}`,'case-card'))):el('div',{class:'no-results'},'Niciun caz nu corespunde filtrelor.'));
    if(candidates.length>12)results.append(el('div',{class:'pagination'},button('Înapoi',()=>{state.page--;draw();},'button secondary',{disabled:state.page===0}),el('span',{},`${start+1}–${Math.min(start+12,candidates.length)} din ${candidates.length}`),button('Înainte',()=>{state.page++;draw();},'button secondary',{disabled:start+12>=candidates.length})));
  }
  draw();
}

async function renderReader(main,id){
  const record=active();if(!record){main.append(noPack());return;}const pack=record.pack,item=pack.cases.find(row=>row.id===id);
  if(!item){main.append(el('div',{class:'empty-state'},el('h2',{},'Cazul nu este în acest pachet.'),link('Înapoi la cazuri','#cases','button')));return;}
  const key=visitKey(record,item);
  if(!state.visited.includes(key)){state.visited.push(key);setMeta('visited',state.visited).catch(error=>toast(friendlyError(error),true));}
  const bookmark=button(icon('bookmark',17),act(async()=>{const exists=state.bookmarks.includes(key);state.bookmarks=exists?state.bookmarks.filter(v=>v!==key):[...state.bookmarks,key];await setMeta('bookmarks',state.bookmarks);bookmark.classList.toggle('active',!exists);bookmark.setAttribute('aria-pressed',String(!exists));toast(exists?'Caz eliminat din salvate.':'Caz salvat.');}),`icon-button ${state.bookmarks.includes(key)?'active':''}`,{'aria-label':'Salvează cazul','aria-pressed':String(state.bookmarks.includes(key))});
  main.append(el('header',{class:'reader-header'},link([icon('back',14),'Toate cazurile'],'#cases','button ghost'),el('div',{class:'section-head'},el('h1',{},item.title),el('div',{class:'button-row'},bookmark,button([icon('exam',15),'Exersează cazul'],act(()=>startCasePractice(record,item)),'button secondary'))),el('div',{class:'reader-meta'},badge(chapterLabel(pack,item.chapterId),'green'),item.completeness!=='full'?badge(item.completeness==='diagnosis-only'?'Explicație abreviată':'Unele secțiuni lipsesc','orange'):null,el('span',{},`Sursa · pagina ${item.source.page || '—'}`))));
  const rows=new Map(),bodies=new Map();
  const viewer=imageViewer(record,item,{onSelect:itemId=>{const row=rows.get(itemId);if(row){const body=row.parentElement;body.hidden=false;const toggle=bodies.get(body);toggle?.setAttribute('aria-expanded','true');for(const r of rows.values())r.classList.toggle('active',r===row);row.scrollIntoView({behavior:'smooth',block:'nearest'});}}});registerCleanup(()=>viewer.destroy());
  const notes=el('section',{class:'interpretation','aria-label':'Interpretarea radiografiei'});
  if(item.annotations.some(a=>a.reviewStatus!=='reviewed'))notes.append(el('div',{class:'annotation-note'},icon('info',14),'Repere orientative, în curs de verificare.'));
  for(const [index,sectionId] of Object.keys(SECTION_LABELS).entries()){
    const section=item.sections.find(row=>row.id===sectionId),body=el('div',{class:'notes-body',id:`section-${sectionId}`});
    const toggle=button([el('span',{class:'notes-number'},String(index+1).padStart(2,'0')),SECTION_LABELS[sectionId],icon('chevron',15)],()=>{body.hidden=!body.hidden;toggle.setAttribute('aria-expanded',String(!body.hidden));},'notes-heading',{'aria-expanded':'true','aria-controls':body.id});bodies.set(body,toggle);
    if(!section?.items.length)body.append(el('p',{class:'missing'},'Nu este precizat în notițele sursă.'));
    else for(const point of section.items){const linked=item.annotations.some(a=>a.itemId===point.id),row=el('div',{class:`finding ${linked?'linked':''}`,tabindex:linked?'0':null,role:linked?'button':null},point.text);
      if(linked){const select=()=>{viewer.selectItem(point.id);for(const r of rows.values())r.classList.toggle('active',r===row);};row.addEventListener('click',select);row.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();select();}});}
      body.append(row);rows.set(point.id,row);
    }
    notes.append(el('section',{class:'notes-section'},toggle,body));
  }
  notes.append(el('details',{class:'source-disclosure'},el('summary',{},'Vezi transcrierea integrală'),el('div',{class:'source-text'},item.referenceText)));
  main.append(el('div',{class:'reader-grid'},viewer.node,notes));
  const index=pack.cases.indexOf(item);
  main.append(el('div',{class:'reader-pager'},index>0?link([icon('back',15),'Cazul anterior'],`#case/${pack.cases[index-1].id}`,'button secondary'):el('span'),index<pack.cases.length-1?link(['Cazul următor',icon('arrow',15)],`#case/${pack.cases[index+1].id}`,'button'):link('Toate cazurile','#cases','button')));
}

function renderPractice(main,mode){
  const record=active();if(!record){main.append(noPack());return;}
  const session=state.session;
  if(session && session.packId===record.id && session.revision===record.pack.revision && session.mode===mode){
    if(session.finished)renderResults(main,record,session);else renderQuestion(main,record,session);return;
  }
  main.append(heading(mode==='exam'?'Simulare de examen':'Recapitulare activă',mode==='exam'?'Pune totul cap la cap.':'Ce revii, rămâne.',mode==='exam'?'Un set echilibrat de întrebări. Vezi răspunsurile și explicațiile la final.':'Exersează cu explicații după fiecare răspuns. Greșelile revin mai repede.'));
  if(session && !session.finished)main.append(el('div',{class:'resume-banner'},el('span',{},'Ai o sesiune începută. Răspunsurile sunt păstrate.'),button('Continuă sesiunea',act(async()=>{state.activeId=session.packId;location.hash=session.mode==='exam'?'exam':'practice';await render();}),'button secondary')));
  let kind='mixed';
  const pack=record.pack,scopeSelect=el('select',{class:'select','aria-label':'Programa examenului'},...pack.curriculum.scopes.map(scope=>el('option',{value:scope.id},scope.label))),chapterSelect=el('select',{class:'select','aria-label':'Capitole'});
  const count=el('input',{class:'number-input',type:'number',min:'1',max:'100',value:'10',inputmode:'numeric','aria-label':'Număr de întrebări'});
  const available=el('p',{class:'field-help'});
  const choices=[];
  const kinds=el('div',{class:'segmented'},...[["mixed","Mixt"],["catalogue","Catalog de diagnostice"],["mcq","Grile"]].map(([id,label])=>{
    const b=button(label,()=>{kind=id;choices.forEach(([node,key])=>node.classList.toggle('active',key===id));updateAvailability();},`chip ${kind===id?'active':''}`,{'aria-pressed':String(kind===id)});choices.push([b,id]);return b;
  }));
  function scopeChapters(){return pack.curriculum.scopes.find(scope=>scope.id===scopeSelect.value)?.chapterIds || pack.curriculum.chapters.map(chapter=>chapter.id);}
  function chapterIds(){return chapterSelect.value==='all'?scopeChapters():[chapterSelect.value];}
  function updateChapters(){const allowed=scopeChapters();chapterSelect.replaceChildren(el('option',{value:'all'},'Toate capitolele din programă'),...pack.curriculum.chapters.filter(chapter=>allowed.includes(chapter.id)).map(chapter=>el('option',{value:chapter.id},chapter.label)));updateAvailability();}
  function updateAvailability(){const length=availableQuestions(pack,record.bank,{kind,chapterIds:chapterIds()}).length;available.textContent=`${length} întrebări disponibile pentru selecția ta.`;count.max=String(Math.min(100,length));if(Number(count.value)>length)count.value=String(length);if(length && Number(count.value)<1)count.value=String(Math.min(10,length));start.disabled=length===0;choices.forEach(([node,key])=>node.setAttribute('aria-pressed',String(key===kind)));}
  scopeSelect.addEventListener('change',updateChapters);chapterSelect.addEventListener('change',updateAvailability);
  const start=button([mode==='exam'?'Începe simularea':'Începe recapitularea',icon('arrow',16)],act(async()=>{
    const questions=availableQuestions(pack,record.bank,{kind,chapterIds:chapterIds()}),requested=Number(count.value);
    requireThat(Number.isInteger(requested) && requested>=1 && requested<=Math.min(100,questions.length),'Alege un număr valid de întrebări.');
    await beginSession(record,chooseQuestions(questions,state.progress,record.id,requested,mode),mode,chapterIds());
  }),'button large');
  const form=el('form',{class:'setup-form',onsubmit:event=>event.preventDefault()},
    el('div',{class:'form-group'},el('label',{class:'field-label'},'Programa',scopeSelect),el('p',{class:'field-help'},'Domeniile de examen sunt definite în pachet.')),
    el('div',{class:'form-group'},el('label',{class:'field-label'},'Capitole',chapterSelect)),
    el('div',{class:'form-group'},el('div',{class:'field-label'},'Tipul întrebărilor'),kinds),
    el('div',{class:'form-group'},el('label',{class:'field-label'},'Număr de întrebări',count),available),start);
  const aside=el('aside',{class:'setup-aside'},el('div',{class:'round-icon'},icon(mode==='exam'?'exam':'repeat',25)),
    el('h2',{},mode==='exam'?'Imaginea întâi. Explicația, la final.':'Recunoaște. Alege. Înțelege.'),
    el('p',{},mode==='exam'?'Răspunzi pe rând, fără indicii de corectitudine. La final primești rezultatul și explicațiile fiecărui caz.':'În catalog, tastezi pentru a restrânge lista și alegi denumirea completă. În grile, selectezi dintre opțiunile pregătite în pachet.'),
    el('div',{class:'aside-stat'},mode==='exam'?'Întrebările sunt distribuite între capitolele selectate.':'Întrebările greșite revin după 10 minute. Reușitele se repetă la intervale mai mari.'),
    el('p',{class:'field-help'},'Reperele grafice și explicațiile imaginii sunt ascunse pe durata întrebării.'));
  main.append(el('div',{class:'setup-grid'},form,aside));updateChapters();
}

async function beginSession(record,questions,mode,chapterIds){
  requireThat(questions.length,'Pachetul nu conține întrebări pentru această selecție.');
  const next={version:1,packId:record.id,revision:record.pack.revision,mode,chapterIds,startedAt:Date.now(),index:0,finished:false,answers:[],
    questions:questions.map(q=>({...q,...(q.options?{options:shuffled(q.options)}:{})}))};
  await setMeta('session',next);state.session=next;const route=mode==='exam'?'exam':'practice';
  if(location.hash!==`#${route}`)location.hash=route;else await render();
}

async function startCasePractice(record,item){
  const questions=availableQuestions(record.pack,record.bank).filter(q=>q.caseId===item.id);
  requireThat(questions.length,'Acest caz este disponibil pentru studiu; nu are încă întrebări.');
  await beginSession(record,questions,'review',record.pack.curriculum.chapters.map(chapter=>chapter.id));
}

function renderQuestion(main,record,session){
  const q=session.questions[session.index],source=record.pack.cases.find(item=>item.id===q.caseId),answer=session.answers[session.index];
  if(!source || !q){main.append(noPack());return;}
  let selection=answer?[...answer.selectedIds]:[],submitting=false;
  main.append(el('div',{class:'quiz-top'},button([icon('back',14),'Pauză'],()=>{location.hash='library';},'button ghost'),bar(pct(session.index,session.questions.length)),el('span',{class:'quiz-counter'},`${session.index+1} / ${session.questions.length} · ${session.mode==='exam'?'Simulare':'Recapitulare'}`)));
  const viewer=imageViewer(record,source,{allowAnnotations:false});registerCleanup(()=>viewer.destroy());
  const panel=el('section',{class:'question-panel','aria-label':'Întrebare'},badge(SECTION_LABELS[q.sectionId] || 'Interpretare','green'),el('h2',{},q.prompt),el('p',{class:'question-hint'},q.correctOptionIds.length>1?'Selectează toate răspunsurile corecte.':'Alege un singur răspuns.'));
  const submit=button('Confirmă răspunsul',act(async()=>{
    if(submitting || !selection.length)return;submitting=true;submit.disabled=true;
    try{
      const correct=gradeAnswer(selection,q.correctOptionIds),key=progressKey(record.id,q.id,q.kind);
      const previous=matchingProgress(state.progress[key],q),nextProgress={...state.progress,[key]:{...scheduleReview(previous,correct),signature:questionSignature(q),sectionId:q.sectionId,chapterId:q.chapterId,caseId:q.caseId}};
      const nextSession={...session,answers:[...session.answers,{selectedIds:[...selection],correct,at:Date.now()}]};
      await setMetas({progress:nextProgress,session:nextSession});state.progress=nextProgress;state.session=nextSession;await render();
    }finally{submitting=false;submit.disabled=false;}
  }),'button',{disabled:!selection.length});
  const onChange=ids=>{selection=ids;submit.disabled=!ids.length;};
  if(q.kind==='catalogue')panel.append(answer?el('div',{class:'saved-answer'},el('strong',{},'Ai ales: '),selection.map(id=>optionLabel(record,q,id)).join('; ')):catalogueSelector(record.pack,{chapterIds:session.chapterIds,selected:selection,multiple:q.correctOptionIds.length>1,onChange}));
  else{
    const options=el('div',{class:'mcq-options'});
    for(const [index,option] of q.options.entries()){
      const field=el('input',{type:q.correctOptionIds.length>1?'checkbox':'radio',name:'mcq-answer',value:option.id,checked:selection.includes(option.id),disabled:Boolean(answer)});
      const row=el('label',{class:`mcq-option ${selection.includes(option.id)?'selected':''} ${answer && session.mode==='review'?(q.correctOptionIds.includes(option.id)?'correct':selection.includes(option.id)?'incorrect':''):''}`},field,el('span',{class:'option-letter'},String.fromCharCode(65+index)),el('span',{},option.label));
      field.addEventListener('change',()=>{if(q.correctOptionIds.length===1)selection=[];if(field.checked)selection=[...new Set([...selection,option.id])];else selection=selection.filter(id=>id!==option.id);options.querySelectorAll('.mcq-option').forEach(node=>node.classList.toggle('selected',node.querySelector('input').checked));onChange(selection);});options.append(row);
    }
    panel.append(options);
  }
  if(answer){
    if(session.mode==='review')panel.append(answerFeedback(record,q,answer));
    else panel.append(el('div',{class:'saved-answer'},[icon('check',16),' Răspuns salvat. Explicațiile apar la final.']));
    panel.append(el('div',{class:'question-actions'},el('span',{class:'text-muted'},`${session.index+1} din ${session.questions.length}`),button([session.index===session.questions.length-1?'Vezi rezultatul':'Următoarea',icon('arrow',16)],act(async()=>{
      const next={...session,...(session.index===session.questions.length-1?{finished:true,finishedAt:Date.now()}:{index:session.index+1})};await setMeta('session',next);state.session=next;await render();
    }))));
  }else panel.append(el('div',{class:'question-actions'},el('span',{class:'field-help'},q.kind==='catalogue'?'Tastezi pentru a căuta. Alegi pentru a răspunde.':'Răspunsul se salvează local.'),submit));
  main.append(el('div',{class:'quiz-grid'},viewer.node,panel));
}

function optionLabel(record,q,id){return q.kind==='catalogue'?record.pack.diagnoses.find(row=>row.id===id)?.label || id:q.options.find(row=>row.id===id)?.label || id;}
function answerFeedback(record,q,answer){
  const detail=el('div',{class:`feedback ${answer.correct?'':'wrong'}`},el('h3',{},[icon(answer.correct?'check':'info',16),answer.correct?' Corect.':' Mai privește o dată.']),el('p',{},`Răspuns de referință: ${q.correctOptionIds.map(id=>optionLabel(record,q,id)).join('; ')}`));
  if(q.feedback)detail.append(el('p',{},q.feedback));
  if(!answer.correct && q.options)for(const option of q.options.filter(row=>answer.selectedIds.includes(row.id) && !q.correctOptionIds.includes(row.id) && row.feedback))detail.append(el('p',{},option.feedback));
  if(q.reviewStatus==='source-derived')detail.append(el('div',{class:'field-help'},'Întrebare construită din notițele de curs.'));
  return detail;
}

function renderResults(main,record,session){
  const correct=session.answers.filter(answer=>answer.correct).length,total=session.questions.length;
  main.append(heading('Sesiune încheiată',session.mode==='exam'?'Simularea ta, explicată.':'Încă un pas înainte.','Răspunsurile sunt salvate. Întrebările greșite vor reveni în recapitulare.'));
  main.append(el('section',{class:'results-hero'},el('div',{class:'score-ring'},`${pct(correct,total)}%`),el('h2',{},`${correct} din ${total} răspunsuri corecte`),el('p',{},'Deschide fiecare întrebare pentru a revedea explicația.'),el('div',{class:'button-row'},button('O sesiune nouă',act(async()=>{await setMeta('session',null);state.session=null;await render();})),link('Continuă studiul','#library','button secondary'))));
  main.append(el('div',{class:'result-list'},...session.questions.map((q,index)=>{
    const answer=session.answers[index],source=record.pack.cases.find(item=>item.id===q.caseId);
    const row=el('details',{class:'result-row'},el('summary',{},el('span',{},`${index+1}. ${source.title} · ${SECTION_LABELS[q.sectionId]}`),badge(answer?.correct?'Corect':'De revăzut',answer?.correct?'green':'orange')),
      el('p',{},q.prompt),el('p',{},`Ai ales: ${(answer?.selectedIds || []).map(id=>optionLabel(record,q,id)).join('; ')}`),answerFeedback(record,q,answer || {correct:false,selectedIds:[]}),link('Deschide explicația completă →',`#case/${q.caseId}`,'text-link'));
    return row;
  })));
}

function renderProgress(main){
  const record=active();if(!record){main.append(noPack());return;}const pack=record.pack;
  const questions=[...availableQuestions(pack,record.bank,{kind:'catalogue'}),...availableQuestions(pack,record.bank,{kind:'mcq'})];
  const data=questions.map(q=>({q,record:matchingProgress(state.progress[progressKey(record.id,q.id,q.kind)],q)})).filter(row=>row.record);
  const attempts=data.reduce((n,row)=>n+row.record.attempts,0),correct=data.reduce((n,row)=>n+row.record.correct,0),seen=pack.cases.filter(item=>state.visited.includes(visitKey(record,item))).length,due=data.filter(row=>row.record.dueAt<=Date.now()).length;
  main.append(heading('Progresul meu','Mai multă claritate, zi de zi.','Vezi ce ai parcurs și ce merită o nouă privire.',link('Recapitulează','#practice','button')),
    el('div',{class:'stats-row'},stat('Cazuri parcurse',`${seen} / ${pack.cases.length}`,'eye'),stat('Răspunsuri date',attempts,'exam'),stat('Răspunsuri corecte',attempts?`${pct(correct,attempts)}%`:'—','check'),stat('Întrebări scadente',due,'clock')));
  const rows=pack.curriculum.chapters.map(chapter=>{
    const all=pack.cases.filter(item=>item.chapterId===chapter.id),visited=all.filter(item=>state.visited.includes(visitKey(record,item))).length,records=data.filter(row=>row.q.chapterId===chapter.id),n=records.reduce((n,row)=>n+row.record.attempts,0),c=records.reduce((n,row)=>n+row.record.correct,0);
    return el('tr',{},el('td',{},chapter.label),el('td',{},`${visited} / ${all.length}`,bar(pct(visited,all.length))),el('td',{},n),el('td',{},n?`${pct(c,n)}%`:'—'),el('td',{},records.filter(row=>row.record.dueAt<=Date.now()).length));
  });
  main.append(el('section',{class:'panel'},el('div',{class:'section-head'},el('h2',{},'Pe capitole'),badge('DOAR DATE LOCALE')),el('div',{class:'table-wrap'},el('table',{class:'table'},el('thead',{},el('tr',{},...['Capitol','Cazuri parcurse','Încercări','Precizie','Scadente'].map(label=>el('th',{scope:'col'},label)))),el('tbody',{},...rows)))));
  main.append(el('div',{class:'section-head',style:null},el('h2',{},'Unde să revii')));
  const mistakes=data.filter(row=>!row.record.lastCorrect).sort((a,b)=>b.record.lastAt-a.record.lastAt).slice(0,6);
  if(!mistakes.length)main.append(el('section',{class:'panel privacy-panel'},el('p',{},attempts?'Nicio greșeală la ultima încercare a întrebărilor parcurse. Continuă cu material nou.':'După primele exerciții, aici apar întrebările la care merită să revii.')));
  else main.append(el('div',{class:'result-list'},...mistakes.map(({q,record:progress})=>el('div',{class:'result-row'},el('div',{class:'section-head'},el('h3',{},`${pack.cases.find(item=>item.id===q.caseId).title} · ${SECTION_LABELS[q.sectionId]}`),badge(q.kind==='catalogue'?'Catalog':'Grilă','orange')),el('p',{},`${chapterLabel(pack,q.chapterId)} · ${progress.attempts} încercări · ${dateLabel(progress.lastAt)}`),link('Revezi cazul →',`#case/${q.caseId}`,'text-link')))));
  main.append(el('p',{class:'footer-note'},'Progresul păstrează separat răspunsurile din catalog și grile. Datele nu sunt trimise către un server.'));
}

async function renderSettings(main,token){
  main.append(heading('Date & instalare','Studiul tău. Sub controlul tău.','Exportă o copie, mută progresul sau pregătește aplicația pentru acces rapid.'));
  const lastExport=await getMeta('lastExportAt',0);if(token!==renderToken)return;
  const storageDetails=el('div',{},el('div',{class:'detail-row'},el('span',{},'Pachete instalate'),el('strong',{},state.packs.length)),el('div',{class:'detail-row'},el('span',{},'Imagini și materiale'),el('strong',{},bytesLabel(state.packs.reduce((n,row)=>n+row.total,0)))),el('div',{class:'detail-row'},el('span',{},'Aplicație offline'),el('strong',{},state.offlineReady?'Pregătită':'Se pregătește / necesită conexiune')));
  const backup=el('section',{class:'settings-card'},el('h2',{},icon('download',19),'Backup & restaurare'),el('p',{},'Backupul JSON păstrează progresul și cazurile salvate. Pentru imagini și explicații, alege backupul complet ZIP.'),
    el('div',{class:'detail-row'},el('span',{},'Ultimul export pornit'),el('strong',{},dateLabel(lastExport))),
    el('div',{class:'button-row'},button([icon('download',15),'Progres JSON'],act(exportProgress)),button('Backup complet ZIP',act(exportFull),'button secondary',{disabled:!state.packs.length})),
    el('div',{class:'button-row'},button([icon('upload',15),'Restaurează JSON / ZIP'],()=>document.getElementById('backup-input').click(),'button ghost')),
    el('p',{class:'field-help'},'La restaurare, încercările mai recente și marcajele se păstrează. JSON nu include imaginile; păstrează și pachetele originale.'));
  const install=el('section',{class:'settings-card'},el('h2',{},icon('plus',19),'Instalează Radia'),el('p',{},'Deschide linkul direct în browser, apoi adaugă aplicația. Importă pachetele din aplicația instalată pentru a păstra studiul în același loc.'),
    state.prompt?button('Instalează aplicația',act(async()=>{await state.prompt.prompt();state.prompt=null;await render();})):null,
    el('ol',{class:'install-steps'},el('li',{},'iPhone / iPad: Safari → Partajează → Adaugă pe ecranul principal.'),el('li',{},'Android: Chrome → meniu → Instalează / Adaugă pe ecranul principal.'),el('li',{},'Windows: Chrome sau Edge → pictograma de instalare din bara de adrese.'),el('li',{},'macOS: Safari → Fișier → Adaugă în Dock; sau instalare din Chrome/Edge.')),
    el('details',{class:'help-details'},el('summary',{},'Ai deschis linkul din Discord sau altă aplicație?'),el('p',{},'Deschide meniul linkului și alege Safari sau Chrome. Dacă opțiunea lipsește, copiază linkul și lipește-l în browser. Instalează Radia înainte să imporți materialele.')));
  const storage=el('section',{class:'settings-card'},el('h2',{},icon('shield',19),'Spațiu pe dispozitiv'),storageDetails,
    el('p',{class:'field-help'},'Browserul poate elimina date locale când spațiul este insuficient sau când ștergi datele site-ului. Un backup descărcat rămâne esențial.'),
    button('Protecție suplimentară a stocării',act(async()=>{
      if(!navigator.storage?.persist){toast('Browserul nu oferă această opțiune. Folosește backupurile.');return;}
      const granted=await navigator.storage.persist();toast(granted?'Browserul a acordat stocare persistentă. Păstrează și backupuri.':'Browserul nu a acordat persistența. Toate funcțiile rămân disponibile.');
    }),'button secondary'),el('p',{class:'field-help'},'Opțional. Browserul poate cere confirmare; aplicația funcționează și fără această permisiune.'));
  const privacy=el('section',{class:'settings-card'},el('h2',{},icon('eye',19),'Confidențialitate verificabilă'),el('p',{},'Fără cont, reclame, analiză de trafic sau servicii AI. Materialele importate, răspunsurile și progresul sunt procesate local. Aplicația nu le încarcă pe un server.'),
    el('p',{},'La găzduirea pe GitHub Pages, GitHub înregistrează IP-ul vizitatorilor în jurnalele sale de securitate. Descărcarea aplicației și verificările de actualizare necesită conexiune.'),
    el('details',{class:'help-details'},el('summary',{},'Cum verific aplicația?'),el('p',{},'Deschide codul și lista sumelor de control. În instrumentele browserului poți inspecta solicitările din Network. Încearcă și redeschiderea aplicației în modul avion.'),
      el('div',{class:'audit-links'},link('Codul aplicației','./js/app.js'),link('Validarea pachetelor','./js/schema.js'),link('Citirea ZIP','./js/zip.js'),link('Service Worker','./sw.js'),link('Sume de control','./release.json'))));
  const packs=el('section',{class:'settings-card full'},el('h2',{},icon('book',19),'Pachetele de pe acest dispozitiv'));
  if(!state.packs.length)packs.append(el('p',{},'Niciun pachet importat încă.'));
  for(const record of state.packs)packs.append(el('div',{class:'detail-row'},el('div',{},el('strong',{},record.pack.title),el('p',{class:'field-help'},`v${record.pack.revision} · ${record.pack.cases.length} cazuri · ${bytesLabel(record.total)}`)),
    el('div',{class:'button-row'},button('Exportă pachetul',act(()=>exportPack(record)),'button secondary'),button('Elimină',()=>confirmRemove(record),'button danger'))));
  main.append(el('div',{class:'settings-grid'},backup,install,storage,privacy,packs),el('p',{class:'footer-note'},`Radia Study v${APP_VERSION} · Fără dependențe JavaScript externe la rulare.`));
  navigator.storage?.estimate().then(estimate=>{
    if(token!==renderToken)return;storageDetails.append(el('div',{class:'detail-row'},el('span',{},'Spațiu utilizat / cotă estimată'),el('strong',{},`${bytesLabel(estimate.usage)} / ${bytesLabel(estimate.quota)}`)));
  }).catch(()=>{});
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
async function recordExport(){await setMeta('lastExportAt',Date.now());toast('Exportul a fost pornit. Păstrează fișierul descărcat într-un loc sigur.');if(state.route==='settings')await render();}
async function exportProgress(){const snapshot=await learningSnapshot(state.packs);download(new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'}),`radia-progres-${new Date().toISOString().slice(0,10)}.json`);await recordExport();}

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
  if(activeExport)return;activeExport=true;const job=jobDialog('Se pregătește backupul','Pachetele și progresul sunt citite local.');
  try{
    const snapshot=await learningSnapshot(state.packs),files=[];snapshot.packFolders=[];
    for(const [i,record] of state.packs.entries()){const folder=`packs/${String(i).padStart(3,'0')}/`;snapshot.packFolders.push({folder,id:record.id,revision:record.pack.revision});files.push(...await filesForPack(record,folder));job.update((i+1)/state.packs.length*.2);}
    files.unshift({name:'backup.json',data:JSON.stringify(snapshot)});
    const result=await archiveJob('write',{files},p=>job.update(.2+p*.8,'Se scrie arhiva de backup…'),job.signal);
    job.finish();download(result.blob,`radia-backup-complet-${new Date().toISOString().slice(0,10)}.zip`);await recordExport();
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
  const job=jobDialog('Se restaurează backupul','Datele existente rămân intacte până la finalul verificării.');
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
    job.finish();await render();toast('Pachetele și progresul au fost restaurate.');
  }catch(error){job.finish();if(error.name!=='AbortError')throw error;}finally{installing=false;}
}

function confirmRemove(record){
  modal('Elimini pachetul de pe acest dispozitiv?',el('p',{class:'modal-body'},`Imaginile și explicațiile din „${record.pack.title}” vor fi eliminate. Progresul și cazurile salvate rămân păstrate pentru o eventuală reimportare. Exportă pachetul sau un backup complet înainte, dacă nu ai altă copie.`),[
    button('Renunță',()=>document.getElementById('modal').close(),'button secondary'),button('Elimină pachetul',act(async()=>{await removePack(record);state.packs=await listPacks();if(state.activeId===record.id)state.activeId=state.packs[0]?.id || null;if(state.session?.packId===record.id){state.session=null;await setMeta('session',null);}document.getElementById('modal').close();await render();toast('Pachet eliminat. Progresul a fost păstrat.');}),'button danger'),
  ]);
}

async function loadStarter(){
  requireThat(state.starter && safePath(state.starter.path) && state.starter.path.startsWith('packs/'),'Pachetul de curs nu este configurat.');
  const response=await fetch(new URL(state.starter.path,document.baseURI));requireThat(response.ok,'Pachetul de curs nu poate fi descărcat. Importă fișierul ZIP original.');
  const blob=await response.blob();await importPackFile(new File([blob],'radiografii-explicate.study.zip',{type:'application/zip'}));
}

async function reloadLearning(){
  [state.progress,state.bookmarks,state.visited]=await Promise.all([getMeta('progress',{}),getMeta('bookmarks',[]),getMeta('visited',[])]);
}

async function applyUpdate(){
  if(state.session && !state.session.finished){toast('Încheie sesiunea înainte de actualizare. Răspunsurile tale sunt salvate.');return;}
  if(state.registration?.waiting){navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});state.registration.waiting.postMessage({type:'ACTIVATE_UPDATE'});}
}

function setupOffline(){
  if(!('serviceWorker' in navigator) || !isSecureContext)return;
  navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).then(registration=>{
    state.registration=registration;
    registration.addEventListener('updatefound',()=>{const incoming=registration.installing;incoming?.addEventListener('statechange',()=>{if(incoming.state==='installed' && navigator.serviceWorker.controller){if(!state.session || state.session.finished)render().catch(()=>{});}});});
    navigator.serviceWorker.ready.then(()=>{
      state.offlineReady=true;const status=document.getElementById('offline-status');if(status)status.replaceChildren(el('span',{class:'status-dot'}),'Pregătit offline');
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
