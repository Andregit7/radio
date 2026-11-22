import {el,button,icon,badge,toast,modal} from './lib/dom.js';
import {SECTION_LABELS,normalise,shuffled} from './lib/core.js';
import {LIMITS,validatePack,validateQuestions,validateFiles,imageDimensions,requireThat} from './lib/schema.js';
import {archiveJob} from './lib/archive.js';
import {imageViewer} from './lib/viewer.js';
import {caseComparisonLayers,caseInterpretation} from './lib/case-interpretation.js';
import {annotationWorkbench} from './annotation-workbench.js';
import {studioLanding,studioWorkspaceHeader} from './landing.js';

let db,drafts=[],draft=null,caseId=null,tab='case',saveTimer,saveGeneration=0,undoSnapshot=null,pendingChapterId=null;
let showStudioMenu=true,pendingUpload=null,selectedChapters={},workbench=null,saveMessage='Salvat local';
const caseViews=new Map();
const navPreferenceKey='radioeasy-studio-nav-collapsed';
let sidebarCollapsed=false;
try{sidebarCollapsed=localStorage.getItem(navPreferenceKey)==='true';}catch{}
const editorPreferences={};
let registration=null,updateChecking=false,swReloading=false;
const uid=prefix=>prefix+'-'+crypto.randomUUID();
const act=fn=>async event=>{try{await fn(event);}catch(error){toast(error.message || 'Operația nu a putut fi finalizată.',true);}};
const currentCase=()=>draft?.pack.cases.find(item=>item.id===caseId);
function caseView(id=caseId){
  if(!caseViews.has(id))caseViews.set(id,{});
  return caseViews.get(id);
}
const affectsV2=()=>{if(draft&&draft.pack.version===1)draft.pack.version=2;};
const ensureV2=affectsV2;
function ensureBankV2(){if(draft?.bank&&draft.bank.version===1)draft.bank.version=2;}
function chapterBank(chapterId=draft?.pack.curriculum.chapters[0]?.id){
  if(!draft)return null;const curriculum=draft.pack.curriculum;curriculum.chapterBanks=curriculum.chapterBanks || [];
  let bank=curriculum.chapterBanks.find(row=>row.chapterId===chapterId);
  if(!bank){bank={chapterId,sections:{}};curriculum.chapterBanks.push(bank);affectsV2();}
  return bank;
}
function bankSection(chapterId,sectionId){const bank=chapterBank(chapterId);bank.sections[sectionId]=bank.sections[sectionId] || (sectionId==='findings'?{types:[]}:{options:[]});return bank.sections[sectionId];}
function ensureStructured(item=currentCase()){
  if(!item.structured)item.structured={status:'draft',choices:{examination:[],projection:[],differentials:[],investigations:[]},observations:[]};
  item.structured.choices=item.structured.choices||{examination:[],projection:[],differentials:[],investigations:[]};
  item.structured.observations=item.structured.observations||[];
  affectsV2();return item.structured;
}
function bankOptionUsage(chapterId,sectionId,optionId){
  return (draft?.pack.cases||[]).filter(item=>item.chapterId===chapterId && item.structured?.choices?.[sectionId]?.includes(optionId)).length;
}
function observationTypeUsage(chapterId,typeId){
  return (draft?.pack.cases||[]).filter(item=>item.chapterId===chapterId && item.structured?.observations?.some(row=>row.typeId===typeId)).length;
}
function findChapterBank(chapterId){return draft?.pack.curriculum.chapterBanks?.find(row=>row.chapterId===chapterId) || null;}
function bankChoiceRows(chapterId,sectionId){
  return findChapterBank(chapterId)?.sections?.[sectionId]?.options || [];
}
const req=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
function txDone(tx){return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error || new Error('Salvarea a eșuat.'));tx.onerror=()=>{};});}
function status(message){saveMessage=message;const node=document.getElementById('save-status');if(node)node.textContent=message;}
function updateCheckLabel(){return updateChecking?'Verific actualizările…':'Verifică actualizări';}
function refreshUpdateControls(){
  for(const node of document.querySelectorAll('.update-check')){
    node.disabled=updateChecking;
    const label=node.querySelector('span');
    if(label)label.textContent=updateCheckLabel();
  }
}
async function activeBuildId(){
  try{
    const scope=registration?.scope || new URL('./',location.href).href;
    const prefix=`radia-studio:${scope}`;
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
function waitForInstalledWorker(target,timeout=15000){
  return new Promise(resolve=>{
    if(!target)return resolve('failed');
    const deadline=Date.now()+timeout;
    let watched=null,finished=false;
    const finish=status=>{if(finished)return;finished=true;clearInterval(timer);resolve(status);};
    const check=()=>{
      if(target.waiting)return finish('waiting');
      const installing=target.installing;
      if(installing && installing!==watched){
        watched=installing;
        installing.addEventListener('statechange',()=>{
          if(installing.state==='redundant')finish('failed');
          else if(target.waiting)finish('waiting');
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
  try{await saveNow();}catch{toast('Proiectul nu a putut fi salvat. Verifică spațiul liber și încearcă din nou.',true);return false;}
  try{const current=await navigator.serviceWorker.getRegistration();await current?.unregister();}catch{}
  reloadForUpdate();return true;
}
async function registerBuild(buildId){
  try{
    const worker=await navigator.serviceWorker.register(new URL(`./sw.js?build=${encodeURIComponent(buildId)}`,document.baseURI).href,{scope:'./',updateViaCache:'none'});
    registration=worker;return worker;
  }catch{return null;}
}
async function activateUpdate(){
  let waiting=registration?.waiting;
  if(!waiting){
    const status=await waitForInstalledWorker(registration,4000);
    if(status==='waiting')waiting=registration.waiting;
  }
  if(!waiting)return false;
  try{await saveNow();}catch{toast('Proiectul nu a putut fi salvat. Verifică spațiul liber și încearcă din nou.',true);return false;}
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
  if(updateChecking)return;
  if(!registration){toast('Actualizarea automată nu este disponibilă în acest browser. Reîncarcă pagina.',true);return;}
  updateChecking=true;refreshUpdateControls();
  try{
    const [latest,current]=await Promise.all([latestRelease(),activeBuildId()]);
    let status=registration.waiting?'waiting':'none';
    if(status!=='waiting'){
      await registration.update();
      status=await waitForInstalledWorker(registration,15000);
    }
    if(status!=='waiting' && latest?.buildId && current && latest.buildId!==current){
      const worker=await registerBuild(latest.buildId);
      if(worker)status=await waitForInstalledWorker(worker,10000);
    }
    updateChecking=false;refreshUpdateControls();
    if(status==='waiting'){toast('Se aplică versiunea nouă…');await activateUpdate();return;}
    if(latest?.buildId && current && latest.buildId!==current){
      toast('Există o versiune nouă, dar workerul nu s-a activat. Reîncarc forțat.',true);
      if(navigator.onLine)await forceRefresh();
      else toast('Reconectează-te la internet și încearcă din nou.',true);
      return;
    }
    toast('Ai deja cea mai recentă versiune.');
  }catch{
    updateChecking=false;refreshUpdateControls();
    toast('Nu am putut verifica actualizările. Verifică conexiunea și încearcă din nou.',true);
  }
}
function changed(){saveGeneration++;status('Se salvează…');clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveNow().catch(error=>{status('Nesalvat');toast(error.message,true);}),450);}
function remember(){
  if(!draft)return;
  undoSnapshot={pack:structuredClone(draft.pack),bank:structuredClone(draft.bank),files:new Map(draft.files)};
  const undo=document.getElementById('studio-undo');if(undo)undo.disabled=false;
}
function changeCase(fn){remember();fn(currentCase());changed();}
async function saveNow(){
  if(!draft)return;clearTimeout(saveTimer);const generation=saveGeneration,{pack,bank,files}=draft;
  const tx=db.transaction(['drafts','meta'],'readwrite'),done=txDone(tx);
  const entry={id:pack.id,title:pack.title};
  tx.objectStore('drafts').put({id:pack.id,pack,bank,files:[...files].map(([path,blob])=>({path,blob})),updatedAt:Date.now()});
  tx.objectStore('meta').put(pack.id,'activeId');await done;
  drafts=drafts.filter(row=>row.id!==entry.id);drafts.push(entry);if(generation===saveGeneration)status('Salvat local');
}
function field(label,value,onChange,{textarea=false,type='text',help=''}={}){
  const input=el(textarea?'textarea':'input',{...(textarea?{}:{type}),value,oninput:event=>onChange(event.target.value)});
  return el('label',{class:'studio-field'},el('span',{},label),input,help?el('small',{class:'field-help'},help):null);
}
function selectField(label,rows,value,onChange){return el('label',{class:'studio-field'},el('span',{},label),el('select',{value,onchange:event=>onChange(event.target.value)},...rows.map(row=>el('option',{value:row.id,selected:row.id===value},row.label))));}

async function newPack(){
  if(draft)await saveNow();
  const id=uid('local'),chapters=[{id:'respiratory',label:'Respirator'},{id:'digestive',label:'Digestiv'},{id:'renal',label:'Renal'},{id:'bone',label:'Osos'}];
  const pack={format:'radiology-study-pack',version:1,id,revision:'1.0.0',title:'Pachet nou',description:'',language:'ro',source:{document:'',note:''},
    curriculum:{id:uid('curriculum'),title:'Radiologie',edition:'',chapters,scopes:[{id:'all',label:'Toată materia',chapterIds:chapters.map(c=>c.id)}]},diagnoses:[],cases:[]};
  openWorkspace({pack,bank:{format:'radiology-question-bank',version:1,packId:id,revision:pack.revision,items:[]},files:new Map()});
  await saveNow();render();
}
async function openDraft(id){
  if(draft)await saveNow();
  const record=await req(db.transaction('drafts').objectStore('drafts').get(id));
  requireThat(record,'Pachetul nu mai este disponibil.');
  openWorkspace({pack:record.pack,bank:record.bank,files:new Map(record.files.map(f=>[f.path,f.blob]))});
  await saveNow();render();
}
function openWorkspace(next){
  draft=next;caseId=null;tab='case';showStudioMenu=false;pendingChapterId=null;
  undoSnapshot=null;caseViews.clear();selectedChapters={};
}

function undoEdit(){
  if(!undoSnapshot||!canLeaveCase())return;
  const previous=undoSnapshot;undoSnapshot=null;
  draft={...previous};
  if(caseId&&!currentCase())caseId=null;
  changed();render();
}

function canLeaveCase(){
  if(!caseViews.get(caseId)?.pending)return true;
  toast('Leagă reperul de o observație sau renunță la el înainte de a continua.');
  return false;
}

const openCaseFile=()=>{
  if(!canLeaveCase())return;
  pendingChapterId=null;
  const chapters=draft?.pack.curriculum.chapters || [],dialog=modal('Alege capitolul',
    el('div',{class:'studio-chapter-choice'},el('p',{class:'modal-body'},chapters.length?'Radiografia va fi adăugată în capitolul pe care îl alegi.':'Pachetul nu are niciun capitol, iar un caz are nevoie de unul. Adaugă mai întâi un capitol în fila „Programă”.'),
      chapters.length?el('div',{class:'studio-chapter-picker'},...chapters.map(chapter=>button([icon('book',15),el('span',{class:'studio-chapter-label'},chapter.label)],
        ()=>{dialog.close();pendingChapterId=chapter.id;document.getElementById('add-image').click();},'button secondary studio-chapter-option'))):null),
    [button('Renunță',()=>dialog.close(),'button ghost')]);
};

function captureCaseScroll(root){
  const list=root.querySelector('.studio-case-list');
  if(!list)return;
  const groups={...(editorPreferences.caseListScroll?.groups||{})};
  for(const body of list.querySelectorAll('.studio-case-group-body'))groups[body.id]={top:body.scrollTop,left:body.scrollLeft};
  editorPreferences.caseListScroll={top:list.scrollTop,left:list.scrollLeft,groups};
}

function restoreCaseScroll(root){
  const saved=editorPreferences.caseListScroll;
  if(!saved)return;
  const list=root.querySelector('.studio-case-list');
  if(!list)return;
  list.scrollTop=saved.top;list.scrollLeft=saved.left;
  for(const body of list.querySelectorAll('.studio-case-group-body')){
    const group=saved.groups?.[body.id];
    if(group){body.scrollTop=group.top;body.scrollLeft=group.left;}
  }
}

function renderCaseList(){
  const current=document.getElementById('studio-case-list');
  if(!current)return;
  captureCaseScroll(document);
  current.replaceWith(groupedCaseList());
  restoreCaseScroll(document);
}

function renderSidebarNav(){
  const current=document.querySelector('.studio-sidebar-nav');
  if(!current)return;
  captureCaseScroll(document);
  current.replaceWith(sidebarNav());
  restoreCaseScroll(document);
}

function render(){
  const root=document.getElementById('studio');
  captureCaseScroll(root);
  workbench?.destroy();workbench=null;
  if(showStudioMenu||!draft){
    root.replaceChildren(studioLanding({drafts,activeId:draft?.pack.id,onNew:act(newPack),
      onOpenZip:()=>document.getElementById('open-pack').click(),onOpenDraft:act(openDraft),
      onExport:act(exportDraft),onUpdate:act(checkForUpdates),updateChecking,updateLabel:updateCheckLabel()}));
    return;
  }
  const workspaceHeader=studioWorkspaceHeader({title:draft.pack.title,status:saveMessage,onMenu:act(async()=>{
    if(!canLeaveCase())return;
    await saveNow();showStudioMenu=true;render();
  })});
  const sidebarToggle=button(icon('menu',18),()=>{
    sidebarCollapsed=!sidebarCollapsed;
    try{localStorage.setItem(navPreferenceKey,String(sidebarCollapsed));}catch{}
    document.querySelector('.studio-layout')?.classList.toggle('studio-nav-collapsed',sidebarCollapsed);
    syncSidebarToggle(sidebarToggle);
  },'icon-button studio-sidebar-toggle',{'aria-controls':'studio-sidebar'});
  syncSidebarToggle(sidebarToggle);
  const side=el('aside',{class:'studio-sidebar',id:'studio-sidebar'},
    el('div',{class:'studio-sidebar-head'},workspaceHeader,sidebarToggle),sidebarNav());
  const work=el('main',{class:'studio-workspace'});
  if(tab!=='case')work.append(el('div',{class:'studio-section-tools'},undoControl()));
  if(tab==='case')renderCaseEditor(work);else if(tab==='banks')renderBanks(work);else if(tab==='catalogue')renderCatalogue(work);else if(tab==='curriculum')renderCurriculum(work);else renderQuestions(work);
  root.replaceChildren(el('div',{class:`studio-layout studio-layout-compact${sidebarCollapsed?' studio-nav-collapsed':''}`},side,work));
  restoreCaseScroll(root);
  workbench?.restoreScroll();
}

function sidebarNav(){
  editorPreferences.caseListOpen ??= false;
  const caseListOpen=editorPreferences.caseListOpen;
  const caseToggle=button([icon('book',16),el('span',{class:'studio-section-label'},'Cazuri & repere'),
    el('span',{class:'studio-section-arrow'},icon(caseListOpen?'chevron-down':'chevron-up',15))],
  ()=>{
    if(tab!=='case'){tab='case';editorPreferences.caseListOpen=true;render();return;}
    editorPreferences.caseListOpen=!caseListOpen;renderSidebarNav();
  },`studio-section-button${tab==='case'?' active':''}`,{'aria-expanded':String(caseListOpen),'aria-controls':caseListOpen?'studio-case-list':null});
  const sections=[['banks','Bănci de răspunsuri','grid'],['catalogue','Diagnostice','search'],['curriculum','Programă','exam'],['questions','Grile','check']];
  return el('nav',{class:'studio-sidebar-nav','aria-label':'Secțiuni Studio'},
    el('section',{class:'studio-case-section'},caseToggle,caseListOpen?caseSectionBody():null),
    ...sections.map(([id,label,name])=>button([icon(name,16),el('span',{class:'studio-section-label'},label)],
      ()=>{if(tab!==id&&canLeaveCase()){tab=id;render();}},`studio-section-button${tab===id?' active':''}`,{'aria-current':tab===id?'page':null})));
}

function caseSectionBody(){
  return el('div',{class:'studio-case-section-body'},
    button([icon('plus',14),'Adaugă radiografie'],openCaseFile,'button secondary studio-case-add'),
    groupedCaseList());
}

function groupedCaseList(){
  const cases=draft.pack.cases,chapters=draft.pack.curriculum.chapters;
  const expanded=editorPreferences.chapters ??= {};
  const groups=chapters.map(chapter=>({id:chapter.id,label:chapter.label,cases:cases.filter(item=>item.chapterId===chapter.id)}));
  const orphaned=cases.filter(item=>!chapters.some(chapter=>chapter.id===item.chapterId));
  if(orphaned.length)groups.push({id:'',label:'Fără capitol',cases:orphaned});
  const accents=['var(--teal)','var(--orange)','var(--info-ink)','var(--red)'];
  const list=el('div',{class:'studio-case-list',id:'studio-case-list'});
  groups.forEach((group,index)=>{
    if(!group.cases.length)return;
    const open=Boolean(expanded[group.id]),bodyId=`studio-case-group-${group.id || 'orphaned'}`;
    const head=button([icon(open?'chevron-down':'chevron-up',14),el('span',{class:'studio-case-group-label'},group.label),
      el('span',{class:'studio-case-count'},String(group.cases.length))],
    ()=>{expanded[group.id]=!open;renderCaseList();},'studio-case-group-head',
    {'aria-expanded':String(open),'aria-controls':bodyId,title:`${group.label} · ${group.cases.length} cazuri`});
    head.style.setProperty('--chapter-accent',accents[index%accents.length]);
    list.append(el('section',{class:'studio-case-group'},head,open?el('div',{class:'studio-case-group-body',id:bodyId},...group.cases.map(caseButton)):null));
  });
  if(!cases.length)list.append(el('p',{class:'studio-case-empty'},'Niciun caz adăugat. Adaugă o radiografie pentru a începe.'));
  return list;
}

function caseButton(item){
  return button(el('span',{class:'studio-case-title'},item.title),()=>{
    if(caseId===item.id&&tab==='case')return;
    if(canLeaveCase()){caseId=item.id;tab='case';render();}
  },`studio-case ${caseId===item.id?'active':''}`,{'aria-current':caseId===item.id?'true':null});
}

function syncSidebarToggle(toggle){
  const label=sidebarCollapsed?'Extinde lista cazurilor':'Restrânge lista cazurilor';
  toggle.title=label;
  toggle.setAttribute('aria-label',label);
  toggle.setAttribute('aria-expanded',String(!sidebarCollapsed));
}

function undoControl(){
  return button('Anulează ultima editare',undoEdit,'button ghost',{id:'studio-undo',disabled:!undoSnapshot});
}

function renderCaseEditor(work){
  const item=currentCase();
  if(!item){
    work.append(el('div',{class:'studio-empty studio-empty-select'},
      el('aside',{class:'setup-aside'},el('div',{class:'round-icon'},icon('image',25)),
        el('h2',{},'Alege un caz pentru a-l edita'),
        el('p',{},'Selectează un caz din lista „Cazuri & repere” din stânga pentru a-i edita imaginile, reperele și explicațiile.'),
        el('p',{class:'field-help'},'Poți adăuga o radiografie nouă cu „Adaugă radiografie”; alegi capitolul înainte de a selecta imaginea.')),
      draft.pack.cases.length?null:button([icon('plus',14),'Adaugă radiografie'],openCaseFile,'button secondary')),undoControl());
    return;
  }
  const state=caseView();
  workbench=annotationWorkbench({item,pack:draft.pack,files:draft.files,state,preferences:editorPreferences,remember,changed,ensureV2,uid,
    onUpload:role=>{pendingUpload={role,caseId,project:draft};document.getElementById('add-case-image').click();},
    onPreview:(imageId,comparisonId)=>showCasePreview(item,imageId||state.imageId,comparisonId),
    onDelete:act(()=>deleteCase(item)),
    undoControl:undoControl(),
    renderNotes:controls=>renderCaseNotes(item,controls),
  });
  work.classList.add('studio-case-workspace');
  work.append(workbench.node);
}

const deleteConfirmKey='radioeasy-studio-skip-delete';

function askDeleteCase(item){
  return new Promise(resolve=>{
    let answer=false;
    const skip=el('input',{type:'checkbox'});
    const dialog=modal('Șterge cazul',
      el('div',{class:'studio-confirm'},
        el('p',{},`Ștergi definitiv „${item.title}”? Se elimină imaginea, reperele și întrebările legate de acest caz.`),
        el('label',{class:'studio-confirm-skip'},skip,el('span',{},'Nu mai afișa acest mesaj'))),
      [button('Renunță',()=>dialog.close(),'button ghost'),
        button([icon('trash',15),'Șterge cazul'],()=>{answer=true;try{localStorage.setItem(deleteConfirmKey,skip.checked?'off':'on');}catch{}dialog.close();},'button danger')]);
    dialog.addEventListener('close',()=>resolve(answer),{once:true});
  });
}

async function deleteCase(item){
  if(!draft||!item)return;
  let skip=false;try{skip=localStorage.getItem(deleteConfirmKey)==='off';}catch{}
  if(!skip && !await askDeleteCase(item))return;
  const index=draft.pack.cases.findIndex(row=>row.id===item.id);
  if(index<0)return;
  remember();
  draft.pack.cases=draft.pack.cases.filter(row=>row.id!==item.id);
  if(draft.bank?.items)draft.bank.items=draft.bank.items.filter(row=>row.caseId!==item.id);
  for(const row of draft.pack.cases){
    if(row.comparisons)row.comparisons=row.comparisons.filter(comparison=>comparison.caseId!==item.id);
    const differentials=row.sections.find(section=>section.id==='differentials');
    for(const entry of differentials?.items||[])if(entry.targetCaseId===item.id)delete entry.targetCaseId;
  }
  const used=new Set(draft.pack.cases.flatMap(row=>row.images.map(image=>image.path)));
  for(const image of item.images)if(!used.has(image.path))draft.files.delete(image.path);
  caseViews.delete(item.id);
  caseId=(draft.pack.cases[index] || draft.pack.cases[index-1])?.id || null;
  tab='case';
  changed();await saveNow();render();
  toast('Cazul a fost șters.');
}

function showCasePreview(item,initialImageId,initialComparisonId){
  const files=draft.files;
  const notes=caseInterpretation(item,itemId=>viewer.selectItem(itemId));
  const viewer=imageViewer(null,item,{initialImageId,initialComparisonId,loadAsset:path=>files.get(path),comparisons:caseComparisonLayers(draft.pack,item),
    onSelect:itemId=>notes.select(itemId,true),
  });
  const dialog=modal(`Previzualizare Study · ${item.title}`,el('div',{class:'reader-grid studio-study-preview'},viewer.node,notes.node),[
    button('Înapoi la editare',()=>dialog.close(),'button secondary'),
  ]);
  dialog.classList.add('studio-preview-dialog');
  dialog.addEventListener('close',()=>{viewer.destroy();dialog.classList.remove('studio-preview-dialog');},{once:true});
}

function renderCaseNotes(item,{observationControls,removeObservation}){
  const notes=document.createDocumentFragment();
  const state=caseView();
  notes.append(el('details',{class:'studio-form-section studio-notes-details',open:state.caseDetailsOpen,
    ontoggle:event=>{state.caseDetailsOpen=event.target.open;}},el('summary',{},'Detalii caz'),
    field('Numele cazului',item.title,value=>changeCase(c=>c.title=value)),
    selectField('Capitol',draft.pack.curriculum.chapters,item.chapterId,value=>changeCase(c=>c.chapterId=value)),
    selectField('Diagnosticul pozitiv',[{id:'',label:'Nu este precizat / alege un diagnostic'},...draft.pack.diagnoses.map(d=>({id:d.id,label:d.label}))],item.diagnosisIds[0] || '',value=>{
      changeCase(c=>{c.diagnosisIds=value?[value]:[];const section=c.sections.find(s=>s.id==='diagnosis');if(value && !section.items.length)section.items.push({id:uid('point'),text:draft.pack.diagnoses.find(d=>d.id===value).label});});render();
    }),el('p',{class:'studio-note'},'Adaugă sau redenumește diagnosticele din fila „Diagnostice”. Cazurile fără diagnostic pot fi studiate, fără întrebare automată de diagnostic.')));
  for(const [sectionId,labelText] of Object.entries(SECTION_LABELS)){
    let section=item.sections.find(s=>s.id===sectionId);if(!section){section={id:sectionId,label:labelText,items:[],status:'missing'};item.sections.push(section);}
    const group=el('section',{class:'studio-form-section'},el('h2',{},labelText));
    for(const entry of section.items){
      const input=el('textarea',{value:entry.text,'aria-label':labelText,oninput:event=>changeCase(()=>{entry.text=event.target.value;})});
      const toolsRow=el('div',{class:'studio-item-tools'});
      if(sectionId==='differentials'){
        const target=el('select',{class:'select','aria-label':'Cazul diagnosticului diferențial',onchange:event=>{changeCase(()=>{if(event.target.value)entry.targetCaseId=event.target.value;else delete entry.targetCaseId;});}},el('option',{value:''},'Fără legătură către un caz'),...draft.pack.cases.filter(row=>row.id!==item.id).map(row=>el('option',{value:row.id,selected:row.targetCaseId===row.id},row.title)));
        toolsRow.append(target);
      }
      group.append(el('div',{class:'studio-item studio-observation-entry','data-observation-id':entry.id},
        el('div',{class:'studio-observation-fields'},input,toolsRow),
        observationControls(entry),
        button(icon('close',13),()=>{
          changeCase(c=>{
            section.items=section.items.filter(p=>p.id!==entry.id);
            c.annotations=c.annotations.filter(row=>row.itemId!==entry.id);
            if(c.structured)c.structured.observations=c.structured.observations.filter(row=>row.itemId!==entry.id);
          });
          removeObservation(entry.id);render();
        },'icon-button studio-remove-observation',{'aria-label':'Șterge observația'})));
    }
    group.append(button([icon('plus',13),'Adaugă observație'],()=>{changeCase(()=>section.items.push({id:uid('point'),text:''}));render();},'button ghost'));notes.append(group);
  }
  notes.append(structuredEditor(item),notesEditor(item));
  if(item.referenceText)notes.append(el('details',{class:'studio-source'},el('summary',{},'Transcrierea sursă păstrată'),item.referenceText));
  return notes;
}

function structuredEditor(item){
  const wrapper=el('section',{class:'studio-form-section'},el('h2',{},'Observații structurate & note'));
  if(!item.structured){
    wrapper.append(el('p',{class:'studio-note'},'Observațiile scrise liber rămân pentru studiu. Pentru notare automată, creează tipuri de observații în fila „Bănci de răspunsuri” și mapează aici observațiile acestui caz. Notele nu generează întrebări automat.'),button('Creează observații structurate',()=>{remember();ensureStructured(item);changed();render();},'button secondary'));
    return wrapper;
  }
  const structured=item.structured;
  if(structured.status==='reviewed')structured.status='source-derived';
  const status=el('select',{class:'select',onchange:event=>{structured.status=event.target.value;changed();}},...[['draft','Schiță — nu se notează'],['source-derived','Derivat din sursă']].map(([value,text])=>el('option',{value,selected:structured.status===value},text)));
  wrapper.append(el('label',{class:'studio-field'},el('span',{},'Starea observațiilor'),status),el('p',{class:'studio-note'},'Câmpurile necompletate nu sunt evaluate. Notele sunt doar pentru învățare și nu intră în notare.'));
  for(const sectionId of ['examination','projection','differentials','investigations']){
    const rows=bankChoiceRows(item.chapterId,sectionId),group=el('div',{class:'studio-structured-choice'},el('span',{class:'field-label'},SECTION_LABELS[sectionId]));
    if(!rows.length)group.append(el('p',{class:'field-help'},'Nu există variante pentru acest capitol. Adaugă-le în „Bănci de răspunsuri”.'));
    else group.append(el('div',{class:'studio-checks'},...rows.map(option=>{const input=el('input',{type:'checkbox',checked:(structured.choices?.[sectionId]||[]).includes(option.id),onchange:()=>{ensureStructured(item);const set=new Set(structured.choices[sectionId]||[]);if(input.checked)set.add(option.id);else set.delete(option.id);structured.choices[sectionId]=[...set];changed();}});return el('label',{},input,option.label);})));
    wrapper.append(group);
  }
  const bank=findChapterBank(item.chapterId),types=bank?.sections?.findings?.types || [];
  const observations=el('div',{class:'studio-observations'},el('h3',{},'Observații'));
  if(!types.length)observations.append(el('p',{class:'field-help'},'Creează mai întâi tipuri de observații pentru acest capitol.'));
  for(const [index,row] of (structured.observations||[]).entries()){
    const type=types.find(itemType=>itemType.id===row.typeId),finding=item.sections.find(s=>s.id==='findings')?.items.find(p=>p.id===row.itemId);
    const typeSelect=el('select',{class:'select','aria-label':'Tipul observației',onchange:event=>{remember();const next=types.find(itemType=>itemType.id===event.target.value);row.typeId=event.target.value;row.values={};if(next && finding)finding.text=finding.text||next.label;changed();render();}},...types.map(itemType=>el('option',{value:itemType.id,selected:itemType.id===row.typeId},itemType.label)));
    const card=el('div',{class:'studio-observation'},el('div',{class:'studio-observation-head'},el('strong',{},`Observația ${index+1}`),typeSelect,button(icon('close',13),()=>{remember();structured.observations=structured.observations.filter(candidate=>candidate!==row);changed();render();},'icon-button',{'aria-label':'Șterge observația'})));
    card.append(el('p',{class:'field-help'},`Text sursă: ${finding?.text || row.itemId}`));
    for(const fieldDef of type?.fields || []){
      const value=row.values?.[fieldDef.id];
      if(fieldDef.kind==='measurementMm'){
        const input=el('input',{type:'number',min:'0',step:'0.1',value:value??'','aria-label':fieldDef.label,oninput:event=>{remember();const number=Number(event.target.value);if(Number.isFinite(number)&&number>0)row.values={...(row.values||{}),[fieldDef.id]:Math.round(number*10)/10};else delete (row.values||{})[fieldDef.id];changed();}});
        card.append(el('label',{class:'studio-field'},el('span',{},`${fieldDef.label} (mm)`),input));
      }else if(fieldDef.kind==='single'){
        const select=el('select',{class:'select','aria-label':fieldDef.label,onchange:event=>{remember();const set=event.target.value?[event.target.value]:[];row.values={...(row.values||{}),[fieldDef.id]:set};changed();}},el('option',{value:''},'Necompletat'),...fieldDef.options.map(option=>el('option',{value:option.id,selected:(value||[])[0]===option.id},option.label)));
        card.append(el('label',{class:'studio-field'},el('span',{},fieldDef.label),select));
      }else{
        const checks=el('div',{class:'studio-checks'},...fieldDef.options.map(option=>{const input=el('input',{type:'checkbox',checked:(value||[]).includes(option.id),onchange:()=>{remember();const set=new Set(row.values?.[fieldDef.id]||[]);if(input.checked)set.add(option.id);else set.delete(option.id);row.values={...(row.values||{}),[fieldDef.id]:[...set]};changed();}});return el('label',{},input,option.label);}));
        card.append(el('div',{class:'studio-field'},el('span',{},fieldDef.label),checks));
      }
    }
    card.append(field('Notă de studiu pentru această observație',row.note||'',value=>{remember();row.note=value;changed();},{textarea:true,help:'Nota nu este folosită automat în întrebări sau notare.'}));
    observations.append(card);
  }
  observations.append(button([icon('plus',13),'Adaugă observație'],()=>{
    const type=types[0];if(!type){toast('Creează un tip de observație în fila „Bănci de răspunsuri”.',true);return;}
    remember();ensureStructured(item);const findingSection=item.sections.find(s=>s.id==='findings') || (item.sections.push({id:'findings',label:SECTION_LABELS.findings,items:[],status:'missing'}),item.sections.find(s=>s.id==='findings'));
    const point={id:uid('point'),text:type.label};findingSection.items.push(point);structured.observations.push({itemId:point.id,typeId:type.id,values:{}});changed();render();
  },'button secondary'));
  wrapper.append(observations);
  return wrapper;
}

function notesEditor(item){
  const structured=item.structured;
  const details=el('details',{class:'studio-form-section studio-notes-details'},el('summary',{},'Note de studiu (opționale)'));
  details.append(el('p',{class:'studio-note'},'Notele sunt păstrate pentru învățare și transparență. Nu sunt folosite automat pentru întrebări sau notare. Dacă vrei să testezi o notă, scrie o întrebare proprie în fila „Grile”.'));
  for(const [sectionId,label] of Object.entries(SECTION_LABELS)){
    details.append(field(`Notă — ${label}`,structured?.sectionNotes?.[sectionId]||'',value=>{remember();const current=ensureStructured(item);current.sectionNotes={...(current.sectionNotes||{})};if(value.trim())current.sectionNotes[sectionId]=value;else delete current.sectionNotes[sectionId];changed();},{textarea:true}));
  }
  return details;
}

function renderBanks(work){
  const chapters=draft.pack.curriculum.chapters;
  const selected=selectedChapters.bank && chapters.some(row=>row.id===selectedChapters.bank)?selectedChapters.bank:chapters[0]?.id;
  selectedChapters.bank=selected;
  work.append(el('div',{class:'studio-title'},el('h1',{},'Bănci de răspunsuri'),badge('VARIANTE PE CAPITOL')));
  work.append(el('p',{class:'studio-note'},'Fiecare capitol are propriile variante. Observațiile au tipuri și câmpuri; celelalte secțiuni au liste de variante. Identificatorii sunt stabili, deci poți redenumi fără să strici cazurile. Notele nu se transformă automat în întrebări.'));
  work.append(selectField('Capitolul',chapters,selected,value=>{selectedChapters.bank=value;render();}));
  const bank=findChapterBank(selected);
  if(!bank){
    work.append(el('section',{class:'studio-form-section'},el('p',{class:'studio-note'},'Capitolul nu are încă o bancă. Creează una pentru a putea adăuga variante și tipuri de observații.'),button('Creează banca pentru acest capitol',()=>{remember();chapterBank(selected);changed();render();},'button secondary')));
    return;
  }
  for(const sectionId of ['examination','projection','differentials','investigations']){
    const rows=bank.sections?.[sectionId]?.options || [];
    const card=el('section',{class:'studio-form-section'},el('h2',{},SECTION_LABELS[sectionId]),el('p',{class:'field-help'},'Apare ca opțiuni de răspuns în exercițiile acestui capitol.'));
    for(const option of rows){
      const usage=bankOptionUsage(selected,sectionId,option.id);
      const input=el('input',{type:'text',value:option.label,oninput:event=>{option.label=event.target.value;changed();}});
      card.append(el('div',{class:'studio-bank-row'},input,el('small',{class:'field-help'},usage?`${usage} cazuri`:''),button(icon('close',13),()=>{if(usage){toast('Varianta este folosită de un caz. Elimină mai întâi selecțiile.',true);return;}remember();bank.sections[sectionId].options=rows.filter(row=>row.id!==option.id);changed();render();},'icon-button',{'aria-label':'Șterge varianta'})));
    }
    card.append(button([icon('plus',13),'Adaugă variantă'],()=>{remember();bankSection(selected,sectionId).options.push({id:uid('option'),label:'Varianta nouă'});changed();render();},'button ghost'));
    work.append(card);
  }
  const findings=bank.sections?.findings || {types:[]};
  const findingsCard=el('section',{class:'studio-form-section'},el('h2',{},'Tipuri de observații (Semiologie)'),el('p',{class:'field-help'},'Tipurile sunt specifice capitolului: opacitate, hipertransparență etc. pentru Respirator; nișă, imagine de adiție etc. pentru Digestiv.'));
  for(const type of findings.types || []){
    const usage=observationTypeUsage(selected,type.id);
    const typeCard=el('div',{class:'studio-bank-type'},el('div',{class:'studio-bank-row'},el('strong',{},'Tip'),el('input',{type:'text',value:type.label,oninput:event=>{type.label=event.target.value;changed();}}),el('small',{class:'field-help'},usage?`${usage} observații`:''),button(icon('close',13),()=>{if(usage){toast('Tipul este folosit de un caz. Elimină mai întâi observațiile.',true);return;}remember();findings.types=findings.types.filter(row=>row.id!==type.id);changed();render();},'icon-button',{'aria-label':'Șterge tipul'})));
    for(const fieldDef of type.fields){
      const fieldUsage=(draft.pack.cases||[]).filter(item=>item.chapterId===selected && item.structured?.observations?.some(row=>row.typeId===type.id && row.values?.[fieldDef.id]!==undefined)).length;
      const kind=el('select',{class:'select','aria-label':'Tipul câmpului',onchange:event=>{remember();fieldDef.kind=event.target.value;if(fieldDef.kind==='measurementMm')delete fieldDef.options;else if(!fieldDef.options)fieldDef.options=[{id:uid('option'),label:'Varianta 1'}];changed();render();}},...[['single','O singură variantă'],['multiple','Mai multe variante'],['measurementMm','Măsurare în mm']].map(([value,text])=>el('option',{value,selected:fieldDef.kind===value},text)));
      const row=el('div',{class:'studio-bank-field'},el('input',{type:'text',value:fieldDef.label,oninput:event=>{fieldDef.label=event.target.value;changed();}}),kind,el('small',{class:'field-help'},fieldUsage?`${fieldUsage} valori`:''),button(icon('close',13),()=>{if(fieldUsage){toast('Câmpul are valori într-un caz. Golește-le mai întâi.',true);return;}remember();type.fields=type.fields.filter(row=>row.id!==fieldDef.id);changed();render();},'icon-button',{'aria-label':'Șterge câmpul'}));
      typeCard.append(row);
      if(fieldDef.kind!=='measurementMm'){
        const choices=el('div',{class:'studio-bank-options'});
        for(const option of fieldDef.options || []){
          choices.append(el('div',{class:'studio-bank-row'},el('input',{type:'text',value:option.label,oninput:event=>{option.label=event.target.value;changed();}}),button(icon('close',13),()=>{const used=(draft.pack.cases||[]).filter(item=>item.chapterId===selected && item.structured?.observations?.some(observation=>observation.typeId===type.id && (observation.values?.[fieldDef.id]||[]).includes(option.id))).length;if(used){toast('Varianta este folosită într-un caz.',true);return;}remember();fieldDef.options=fieldDef.options.filter(row=>row.id!==option.id);changed();render();},'icon-button',{'aria-label':'Șterge varianta'})));
        }
        choices.append(button([icon('plus',13),'Adaugă variantă'],()=>{remember();fieldDef.options.push({id:uid('option'),label:'Varianta nouă'});changed();render();},'button ghost'));
        typeCard.append(choices);
      }
    }
    typeCard.append(button([icon('plus',13),'Adaugă câmp'],()=>{remember();type.fields.push({id:uid('field'),label:'Câmp nou',kind:'single',options:[{id:uid('option'),label:'Varianta 1'}]});changed();render();},'button ghost'));
    findingsCard.append(typeCard);
  }
  findingsCard.append(button([icon('plus',13),'Adaugă tip de observație'],()=>{remember();bankSection(selected,'findings').types.push({id:uid('type'),label:'Tip nou',fields:[]});changed();render();},'button secondary'));
  work.append(findingsCard);
}

function renderCatalogue(work){
  work.append(el('div',{class:'studio-title'},el('h1',{},'Catalogul de diagnostice'),badge(`${draft.pack.diagnoses.length} INTRĂRI`)),
    el('p',{class:'studio-note'},'În Study, diagnosticul apare pe măsură ce studentul îi tastează denumirea completă. Poți adăuga cuvinte-cheie pentru o căutare mai rapidă, de exemplu „tumoră” sau „os” pentru un fibrom osos.'));
  const keywordLabel='Cuvinte-cheie (opțional, separate prin virgulă)';
  const parseKeywords=value=>value.split(',').map(keyword=>keyword.trim()).filter(Boolean);
  const keywords=el('input',{type:'text'});
  const name=el('input',{type:'text',placeholder:'Denumirea completă','aria-label':'Diagnostic nou'}),chapter=el('select',{'aria-label':'Capitolul diagnosticului'},...draft.pack.curriculum.chapters.map(c=>el('option',{value:c.id},c.label)));
  work.append(el('section',{class:'studio-form-section'},el('h2',{},'Diagnostic nou'),el('label',{class:'studio-field'},el('span',{},'Denumire'),name),el('label',{class:'studio-field'},el('span',{},'Capitol'),chapter),
    el('label',{class:'studio-field'},el('span',{},keywordLabel),keywords),button('Adaugă în catalog',()=>{
    const label=name.value.trim();if(!label){toast('Completează denumirea.',true);return;}
    if(draft.pack.diagnoses.some(d=>normalise(d.label)===normalise(label))){toast('Diagnosticul există deja în catalog.',true);return;}
    remember();draft.pack.diagnoses.push({id:uid('diagnosis'),label,chapterIds:[chapter.value],keywords:parseKeywords(keywords.value)});changed();render();
  })));
  const list=el('div',{class:'studio-panel-list'});
  for(const diagnosis of draft.pack.diagnoses)list.append(el('section',{class:'studio-catalogue-row'},
    field('Denumire completă',diagnosis.label,value=>{remember();diagnosis.label=value;changed();}),
    field(keywordLabel,(diagnosis.keywords ?? diagnosis.aliases ?? []).join(', '),value=>{
      diagnosis.keywords=parseKeywords(value);delete diagnosis.aliases;changed();
    }),
    el('div',{class:'studio-checks'},...draft.pack.curriculum.chapters.map(c=>{const input=el('input',{type:'checkbox',checked:diagnosis.chapterIds.includes(c.id),onchange:()=>{if(input.checked)diagnosis.chapterIds=[...new Set([...diagnosis.chapterIds,c.id])];else diagnosis.chapterIds=diagnosis.chapterIds.filter(id=>id!==c.id);changed();}});return el('label',{},input,c.label);}))));
  work.append(list);
}

function renderCurriculum(work){
  work.append(el('div',{class:'studio-title'},el('h1',{},'Pachet & programă')));
  const form=el('div',{class:'studio-main-form'},el('section',{class:'studio-form-section'},
    field('Numele pachetului',draft.pack.title,value=>{draft.pack.title=value;changed();}),
    field('Versiunea pachetului',draft.pack.revision,value=>{draft.pack.revision=value;draft.bank.revision=value;changed();},{help:'La publicarea unei corecturi, schimbă versiunea. Identificatorii cazurilor rămân stabili.'}),
    field('Descriere',draft.pack.description,value=>{draft.pack.description=value;changed();},{textarea:true}),
    field('Materia / programa',draft.pack.curriculum.title,value=>{draft.pack.curriculum.title=value;changed();}),
    field('Ediție / an universitar',draft.pack.curriculum.edition,value=>{draft.pack.curriculum.edition=value;changed();}),
    field('Sursa și dreptul de distribuire',draft.pack.source.note,value=>{draft.pack.source.note=value;changed();},{textarea:true,help:'Pachetul și aplicația au distribuții separate. Include doar imagini și texte pe care le poți distribui.'}),
    el('p',{class:'studio-note'},`Identificator stabil: ${draft.pack.id}`)));
  const chapters=el('section',{class:'studio-form-section'},el('h2',{},'Capitole'));
  for(const chapter of draft.pack.curriculum.chapters)chapters.append(field('Titlul capitolului',chapter.label,value=>{chapter.label=value;changed();}));
  chapters.append(button('Adaugă capitol',()=>{remember();const chapter={id:uid('chapter'),label:'Capitol nou'};draft.pack.curriculum.chapters.push(chapter);draft.pack.curriculum.scopes[0]?.chapterIds.push(chapter.id);changed();render();},'button secondary'));form.append(chapters);
  form.append(el('h2',{},'Domenii de examen'),el('p',{class:'studio-note'},'Definește explicit capitolele unui colocviu sau ale examenului final. Aplicația nu presupune unde sunt limitele programei.'));
  for(const scope of draft.pack.curriculum.scopes){
    form.append(el('section',{class:'studio-scope'},field('Numele evaluării',scope.label,value=>{scope.label=value;changed();}),el('div',{class:'studio-checks'},...draft.pack.curriculum.chapters.map(c=>{const input=el('input',{type:'checkbox',checked:scope.chapterIds.includes(c.id),onchange:()=>{scope.chapterIds=input.checked?[...new Set([...scope.chapterIds,c.id])]:scope.chapterIds.filter(id=>id!==c.id);changed();}});return el('label',{},input,c.label);}))))
  }
  form.append(button('Adaugă domeniu de examen',()=>{remember();draft.pack.curriculum.scopes.push({id:uid('scope'),label:'Evaluare nouă',chapterIds:draft.pack.curriculum.chapters.map(c=>c.id)});changed();render();},'button secondary'));
  work.append(form);
}

function renderQuestions(work){
  const item=currentCase();work.append(el('div',{class:'studio-title'},el('h1',{},'Întrebări pentru caz')));
  if(!item){work.append(el('p',{},'Adaugă sau selectează mai întâi un caz.'));return;}
  work.append(el('div',{class:'studio-banner'},'Întrebarea de diagnostic cu selecție din catalog este creată automat în Study. Întrebările de aici sunt opționale. Notele nu devin întrebări automat.'));
  const questions=draft.bank.items.filter(q=>q.caseId===caseId);
  work.append(button('Adaugă o grilă',()=>{
    remember();const id=uid('question');draft.bank.items.push({id,caseId,sectionId:'diagnosis',kind:'mcq',prompt:'Care este diagnosticul pozitiv?',options:['a','b','c','d'].map(id=>({id,label:'',feedback:''})),correctOptionIds:['a'],feedback:''});changed();render();
  },'button secondary'));
  work.append(button('Adaugă răspuns scris',()=>{
    remember();ensureBankV2();affectsV2();draft.bank.items.push({id:uid('question'),caseId,sectionId:'findings',kind:'written',prompt:'Explică observația din imagine.',rubric:''});changed();render();
  },'button secondary'));
  if(item.diagnosisIds.length)work.append(button('Propune o grilă de diagnostic',()=>{
    const correct=draft.pack.diagnoses.find(d=>d.id===item.diagnosisIds[0]),others=shuffled(draft.pack.diagnoses.filter(d=>d.id!==correct.id && d.chapterIds.includes(item.chapterId))).slice(0,3);
    if(!others.length){toast('Adaugă mai întâi alte diagnostice din capitol.',true);return;}
    remember();draft.bank.items.push({id:uid('question'),caseId,sectionId:'diagnosis',kind:'mcq',prompt:'Care este diagnosticul pozitiv?',options:[correct,...others].map(d=>({id:d.id,label:d.label,feedback:''})),correctOptionIds:[correct.id],feedback:item.sections.find(s=>s.id==='diagnosis')?.items.map(p=>p.text).join('\n') || ''});changed();render();
  },'button ghost'));
  for(const q of questions){
    const kind=q.kind || 'mcq';const touch=fn=>{fn();changed();};
    const card=el('section',{class:'studio-question'},el('div',{class:'studio-question-kind'},badge(kind==='written'?'RĂSPUNS SCRIS':'Grilă',kind==='written'?'orange':'green')),selectField('Secțiunea evaluată',Object.entries(SECTION_LABELS).map(([id,label])=>({id,label})),q.sectionId,value=>touch(()=>q.sectionId=value)),field('Întrebarea',q.prompt,value=>touch(()=>q.prompt=value),{textarea:true}));
    if(kind==='written'){
      card.append(field('Baremul autorului',q.rubric || '',value=>touch(()=>q.rubric=value),{textarea:true,help:'Afișat după ce studentul răspunde. Nu este notat automat; studentul își verifică răspunsul.'}),
        el('p',{class:'studio-note'},'Răspunsul scris și autoevaluarea nu intră niciodată în precizia automată.'),button('Elimină întrebarea',()=>{remember();draft.bank.items=draft.bank.items.filter(row=>row.id!==q.id);changed();render();},'button ghost'));
    }else{
      const options=el('div',{class:'studio-options'});
      for(const option of q.options || []){
        const radio=el('input',{type:'radio',name:q.id,checked:(q.correctOptionIds||[]).includes(option.id),'aria-label':'Marchează această opțiune drept corectă',onchange:()=>touch(()=>q.correctOptionIds=[option.id])});
        options.append(el('div',{class:'studio-option'},radio,el('input',{type:'text',value:option.label,'aria-label':'Textul opțiunii',oninput:event=>touch(()=>option.label=event.target.value)})));
        options.append(field('Explicația opțiunii (opțional)',option.feedback || '',value=>touch(()=>option.feedback=value)));
      }
      card.append(options,field('Explicația răspunsului',q.feedback,value=>touch(()=>q.feedback=value),{textarea:true}),
        el('p',{class:'studio-note'},'Alternativele propuse sunt doar un punct de plecare; verifică să existe un singur răspuns optim.'),button('Elimină grila',()=>{remember();draft.bank.items=draft.bank.items.filter(row=>row.id!==q.id);changed();render();},'button ghost'));
    }
    work.append(card);
  }
}

async function addImage(file,chapterId=pendingChapterId){
  pendingChapterId=null;
  requireThat(draft,'Creează sau deschide mai întâi un pachet.');requireThat(file.size<=LIMITS.entry,'Imaginea depășește limita de 12 MiB.');
  const chapters=draft.pack.curriculum.chapters,chapter=chapters.some(row=>row.id===chapterId)?chapterId:chapters[0]?.id;
  requireThat(chapter,'Adaugă mai întâi un capitol în fila „Programă”.');
  const bytes=new Uint8Array(await file.arrayBuffer()),dims=imageDimensions(bytes);requireThat(dims.width*dims.height<=LIMITS.pixels,'Imaginea depășește 12 megapixeli.');
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join(''),id=uid('case'),path=`images/${id}.${dims.mime==='image/png'?'png':'jpeg'}`;
  remember();draft.files.set(path,new Blob([bytes],{type:dims.mime}));
  draft.pack.cases.push({id,title:`Cazul ${String(draft.pack.cases.length+1).padStart(2,'0')}`,chapterId:chapter,diagnosisIds:[],
    images:[{id:'primary',path,width:dims.width,height:dims.height,sha256}],sections:Object.entries(SECTION_LABELS).map(([id,label])=>({id,label,items:[],status:'missing'})),annotations:[],referenceText:'',source:{document:'',page:null},completeness:'partial'});
  caseId=id;tab='case';editorPreferences.caseListOpen=true;(editorPreferences.chapters ??= {})[chapter]=true;changed();await saveNow();render();
}

async function addCaseImage(file,upload){
  const {role,caseId:targetId,project}=upload;
  const item=project.pack.cases.find(row=>row.id===targetId);
  requireThat(draft===project&&item,'Selectează mai întâi un caz.');
  requireThat(file.size<=LIMITS.entry,'Imaginea depășește limita de 12 MiB.');
  const bytes=new Uint8Array(await file.arrayBuffer()),dims=imageDimensions(bytes);requireThat(dims.width*dims.height<=LIMITS.pixels,'Imaginea depășește 12 megapixeli.');
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join(''),id=uid('image'),path=`images/${uid('img')}.${dims.mime==='image/png'?'png':'jpeg'}`;
  requireThat(draft===project&&project.pack.cases.includes(item),'Proiectul s-a schimbat. Alege din nou imaginea.');
  remember();project.files.set(path,new Blob([bytes],{type:dims.mime}));
  item.images.push({id,path,width:dims.width,height:dims.height,sha256,...(role==='comparison'||draft.pack.version===2?{role}:{})});
  const state=caseView(targetId);
  if(role==='comparison'){
    affectsV2();state.comparisonId=uid('comparison');
    item.comparisons=item.comparisons||[];
    const label=file.name.replace(/\.(png|jpe?g)$/i,'').trim().slice(0,120)||'Comparație locală';
    item.comparisons.push({id:state.comparisonId,label,caseId:item.id,imageId:id});
  }else{state.imageId=id;state.comparisonId=null;}
  changed();await saveNow();render();toast(role==='comparison'?'Imaginea de comparație a fost adăugată.':'Imaginea a fost adăugată cazului.');
}

function sanitiseForExport(){
  const pack=draft.pack;
  if(draft.bank?.version===2 || draft.bank?.items?.some(row=>row.kind==='written')){pack.version=2;if(draft.bank)draft.bank.version=2;}
  if(pack.curriculum.chapterBanks){
    for(const bank of pack.curriculum.chapterBanks){
      for(const [sectionId,section] of Object.entries(bank.sections||{})){
        if((section.options && !section.options.length) || (section.types && !section.types.length))delete bank.sections[sectionId];
      }
    }
    pack.curriculum.chapterBanks=pack.curriculum.chapterBanks.filter(bank=>Object.keys(bank.sections||{}).length);
    if(!pack.curriculum.chapterBanks.length)delete pack.curriculum.chapterBanks;
  }
  if(pack.curriculum.chapterBanks?.length)pack.version=2;
  const caseIndex=new Map(pack.cases.map(row=>[row.id,new Set(row.images.map(image=>image.id))]));
  for(const item of pack.cases){
    const referenced=new Set([...(item.annotations||[]).map(row=>row.itemId),...(item.structured?.observations||[]).map(row=>row.itemId)]);
    const types=new Map((pack.curriculum.chapterBanks?.find(bank=>bank.chapterId===item.chapterId)?.sections?.findings?.types||[]).map(type=>[type.id,type]));
    for(const section of item.sections){
      section.items=section.items.filter(row=>row.text.trim() || referenced.has(row.id));
      for(const row of section.items)if(!row.text.trim() && section.id==='findings'){
        const type=types.get(item.structured?.observations?.find(observation=>observation.itemId===row.id)?.typeId);
        row.text=type?.label || 'Observație';
      }
      section.status=section.items.length?'present':'missing';
    }
    const itemIds=new Set(item.sections.flatMap(section=>section.items.map(row=>row.id)));
    item.annotations=(item.annotations||[]).filter(row=>itemIds.has(row.itemId));
    if(item.structured){
      item.structured.observations=(item.structured.observations||[]).filter(row=>itemIds.has(row.itemId));
      for(const sectionId of ['examination','projection','differentials','investigations']){
        const choices=new Set((pack.curriculum.chapterBanks?.find(bank=>bank.chapterId===item.chapterId)?.sections?.[sectionId]?.options||[]).map(option=>option.id));
        item.structured.choices={...(item.structured.choices||{}),[sectionId]:(item.structured.choices?.[sectionId]||[]).filter(id=>choices.has(id))};
      }
    }
    const comparisons=(item.comparisons||[]).filter(row=>caseIndex.get(row.caseId)?.has(row.imageId));
    if(pack.version===2 || comparisons.length)item.comparisons=comparisons;else delete item.comparisons;
    const differentials=item.sections.find(section=>section.id==='differentials');
    for(const row of differentials?.items||[])if(row.targetCaseId && (!caseIndex.has(row.targetCaseId)||row.targetCaseId===item.id))delete row.targetCaseId;
    item.completeness=item.sections.every(section=>section.items.length)?'full':item.sections.filter(section=>section.items.length).every(section=>section.id==='diagnosis')?'diagnosis-only':'partial';
    if(item.structured||item.comparisons?.length||item.images.some(image=>image.role==='comparison')||item.annotations.some(row=>row.style||row.shape==='polyline'))pack.version=2;
  }
}

async function importDraft(file){
  requireThat(file.size<=LIMITS.archive,'Pachetul depășește 32 MiB.');if(draft)await saveNow();
  status('Se verifică arhiva…');const {files}=await archiveJob('read',{file}),prepared=await validateFiles(files);
  const use=async()=>{
    openWorkspace({pack:prepared.pack,bank:prepared.bank||{format:'radiology-question-bank',version:1,packId:prepared.pack.id,revision:prepared.pack.revision,items:[]},files:new Map(prepared.blobs.map(f=>[f.path,f.blob]))});
    await saveNow();render();toast('Pachet deschis în Studio.');
  };
  if(drafts.some(row=>row.id===prepared.pack.id))modal('Înlocuiești proiectul local?',el('p',{class:'modal-body'},'Există deja o schiță cu același identificator. Exportă schița curentă înainte, dacă vrei să păstrezi ambele versiuni.'),[button('Renunță',()=>document.getElementById('modal').close(),'button secondary'),button('Înlocuiește',act(async()=>{document.getElementById('modal').close();await use();}))]);else await use();
}

async function exportDraft(){
  requireThat(draft,'Nu există un pachet deschis.');await saveNow();sanitiseForExport();
  const {pack}=validatePack(draft.pack);
  const bank=validateQuestions({...draft.bank,revision:pack.revision},pack),used=new Set(pack.cases.flatMap(item=>item.images.map(image=>image.path)));
  const files=[{name:'pack.json',data:JSON.stringify(pack,null,2)}];if(bank.items.length)files.push({name:'questions.json',data:JSON.stringify(bank,null,2)});
  for(const path of used){requireThat(draft.files.has(path),`Imagine lipsă: ${path}`);files.push({name:path,data:draft.files.get(path)});}
  // Validate exactly the data which will be exported, including hashes and links.
  const check=await validateFiles(new Map(await Promise.all(files.map(async f=>[f.name,typeof f.data==='string'?new TextEncoder().encode(f.data):new Uint8Array(await f.data.arrayBuffer())]))));
  modal('Pachet valid pentru Study',el('div',{class:'studio-validate'},`${check.pack.cases.length} cazuri · ${check.pack.diagnoses.length} diagnostice · ${bank.items.length} grile\n${check.pack.cases.reduce((n,c)=>n+c.annotations.length,0)} repere vizuale\n\nImaginile și referințele au fost verificate. Exportul nu include progresul niciunui student.`),[
    button('Înapoi',()=>document.getElementById('modal').close(),'button secondary'),button('Descarcă ZIP',act(async()=>{
      status('Se exportă…');const result=await archiveJob('write',{files});const url=URL.createObjectURL(result.blob),a=el('a',{href:url,download:`${pack.id}-${pack.revision}.study.zip`});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);document.getElementById('modal').close();status('Salvat local');toast('Exportul pachetului a fost pornit.');
    })),
  ]);
}

async function boot(){
  requireThat(globalThis.indexedDB,'Deschide Studio într-un browser obișnuit, cu stocare locală disponibilă.');
  const request=indexedDB.open('radia-studio-v1',1);request.onupgradeneeded=()=>{request.result.createObjectStore('drafts',{keyPath:'id'});request.result.createObjectStore('meta');};db=await req(request);db.onversionchange=()=>db.close();
  const records=await req(db.transaction('drafts').objectStore('drafts').getAll());drafts=records.map(row=>({id:row.id,title:row.pack.title}));const id=await req(db.transaction('meta').objectStore('meta').get('activeId'));
  const saved=records.find(row=>row.id===id)||records.reduce((latest,row)=>!latest||row.updatedAt>latest.updatedAt?row:latest,null);
  if(saved)draft={pack:saved.pack,bank:saved.bank,files:new Map(saved.files.map(f=>[f.path,f.blob]))};
  render();
  if('serviceWorker' in navigator && isSecureContext){
    const hadController=Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange',()=>{if(hadController)reloadForUpdate();});
    navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).then(worker=>{
      registration=worker;
       worker.addEventListener('updatefound',()=>{const incoming=worker.installing;incoming?.addEventListener('statechange',()=>{if(incoming.state==='installed' && navigator.serviceWorker.controller)refreshUpdateControls();});});
      navigator.serviceWorker.ready.then(()=>worker.update().catch(()=>{})).catch(()=>{});
    }).catch(()=>{});
  }
}
document.getElementById('open-pack').addEventListener('change',act(async event=>{const file=event.target.files[0];event.target.value='';if(file)await importDraft(file);}));
document.getElementById('add-image').addEventListener('change',act(async event=>{const file=event.target.files[0];event.target.value='';if(file)await addImage(file);else pendingChapterId=null;}));
document.getElementById('add-case-image').addEventListener('change',act(async event=>{const file=event.target.files[0],upload=pendingUpload;event.target.value='';pendingUpload=null;if(file&&upload)await addCaseImage(file,upload);}));
document.getElementById('notice').classList.add('studio-toast');
boot().catch(error=>{document.getElementById('studio').replaceChildren(el('main',{class:'studio-empty'},el('h1',{},'Studio nu poate deschide stocarea.'),el('p',{},error.message),button('Încearcă din nou',()=>location.reload())));});
