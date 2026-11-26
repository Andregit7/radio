import {el,button,icon,badge,toast,modal} from './lib/dom.js';
import {SECTION_LABELS,normalise} from './lib/core.js';
import {LIMITS,validatePack,validateFiles,imageDimensions,requireThat} from './lib/schema.js';
import {packWithoutAnswerBanks} from './lib/pack-compat.js';
import {archiveJob} from './lib/archive.js';
import {imageViewer} from './lib/viewer.js';
import {caseComparisonLayers,caseInterpretation} from './lib/case-interpretation.js';
import {annotationWorkbench} from './annotation-workbench.js';
import {studioLanding,studioWorkspaceHeader} from './landing.js';

let db,drafts=[],draft=null,caseId=null,tab='case',saveTimer,saveGeneration=0,undoSnapshot=null,pendingChapterId=null;
let showStudioMenu=true,pendingUpload=null,workbench=null,saveMessage='Salvat local';
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
  undoSnapshot={pack:structuredClone(draft.pack),files:new Map(draft.files)};
  const undo=document.getElementById('studio-undo');if(undo)undo.disabled=false;
}
function changeCase(fn){remember();fn(currentCase());changed();}
async function saveNow(){
  if(!draft)return;clearTimeout(saveTimer);const generation=saveGeneration,{pack,files}=draft;
  const tx=db.transaction(['drafts','meta'],'readwrite'),done=txDone(tx);
  const entry={id:pack.id,title:pack.title};
  tx.objectStore('drafts').put({id:pack.id,pack,files:[...files].map(([path,blob])=>({path,blob})),updatedAt:Date.now()});
  tx.objectStore('meta').put(pack.id,'activeId');await done;
  drafts=drafts.filter(row=>row.id!==entry.id);drafts.push(entry);if(generation===saveGeneration)status('Salvat local');
}
let pendingFocus=null;
const focusField=id=>{pendingFocus=id;};
function applyPendingFocus(){
  if(!pendingFocus)return;
  const node=document.querySelector(`[data-field-id="${pendingFocus}"]`);
  pendingFocus=null;
  if(node){node.focus();node.select();}
}
function syncChapterLabel(id,label){
  for(const node of document.querySelectorAll(`[data-chapter-label="${id}"]`))node.textContent=label||'Capitol fără nume';
}
function field(label,value,onChange,{textarea=false,type='text',help='',controlId=null}={}){
  const input=el(textarea?'textarea':'input',{...(textarea?{}:{type}),value,'data-field-id':controlId,oninput:event=>onChange(event.target.value)});
  return el('label',{class:'studio-field'},el('span',{},label),input,help?el('small',{class:'field-help'},help):null);
}
function selectField(label,rows,value,onChange){return el('label',{class:'studio-field'},el('span',{},label),el('select',{value,onchange:event=>onChange(event.target.value)},...rows.map(row=>el('option',{value:row.id,selected:row.id===value},row.label))));}

async function newPack(){
  if(draft)await saveNow();
  const id=uid('local'),chapters=[{id:'respiratory',label:'Respirator'},{id:'digestive',label:'Digestiv'},{id:'renal',label:'Renal'},{id:'bone',label:'Osos'}];
  const pack={format:'radiology-study-pack',version:1,id,revision:'1.0.0',title:'Pachet nou',description:'',language:'ro',source:{document:'',note:''},
    curriculum:{id:uid('curriculum'),title:'Radiologie',edition:'',chapters,scopes:[{id:'all',label:'Toată materia',chapterIds:chapters.map(c=>c.id)}]},diagnoses:[],cases:[]};
  openWorkspace({pack,files:new Map()});
  await saveNow();render();
}
async function openDraft(id){
  if(draft)await saveNow();
  const record=await req(db.transaction('drafts').objectStore('drafts').get(id));
  requireThat(record,'Pachetul nu mai este disponibil.');
  openWorkspace(projectFromRecord(record));
  await saveNow();render();
}
function projectFromRecord(record){
  return {pack:packWithoutAnswerBanks(record.pack),files:new Map(record.files.map(({path,blob})=>[path,blob]))};
}
function openWorkspace(next){
  draft=next;caseId=null;tab='case';showStudioMenu=false;pendingChapterId=null;
  undoSnapshot=null;caseViews.clear();scrollMemory.clear();
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

const scrollMemory=new Map();

function captureScroll(root){
  for(const node of root.querySelectorAll('[data-scroll-key]'))scrollMemory.set(node.dataset.scrollKey,{top:node.scrollTop,left:node.scrollLeft});
}

function restoreScroll(root){
  for(const node of root.querySelectorAll('[data-scroll-key]')){
    const saved=scrollMemory.get(node.dataset.scrollKey);
    if(saved){node.scrollTop=saved.top;node.scrollLeft=saved.left;}
  }
}

function renderCaseList(){
  const current=document.getElementById('studio-case-list');
  if(!current)return;
  captureScroll(document);
  current.replaceWith(groupedCaseList());
  restoreScroll(document);
}

function renderSidebarNav(){
  const current=document.querySelector('.studio-sidebar-nav');
  if(!current)return;
  captureScroll(document);
  current.replaceWith(sidebarNav());
  restoreScroll(document);
}

function render(){
  const root=document.getElementById('studio');
  captureScroll(root);
  workbench?.destroy();workbench=null;
  if(showStudioMenu||!draft){
    root.replaceChildren(studioLanding({drafts,activeId:draft?.pack.id,onNew:act(newPack),
      onOpenZip:()=>document.getElementById('open-pack').click(),onOpenDraft:act(openDraft),onDeleteDraft:act(deleteDraft),
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
  const side=el('aside',{class:'studio-sidebar',id:'studio-sidebar','data-scroll-key':'sidebar'},
    el('div',{class:'studio-sidebar-head'},workspaceHeader,sidebarToggle),sidebarNav());
  const work=el('main',{class:'studio-workspace','data-scroll-key':`workspace:${tab}`});
  if(tab!=='case')work.append(el('div',{class:'studio-section-tools'},undoControl()));
  if(tab==='case')renderCaseEditor(work);
  else if(tab==='catalogue')renderCatalogue(work);
  else renderCurriculum(work);
  root.replaceChildren(el('div',{class:`studio-layout studio-layout-compact${sidebarCollapsed?' studio-nav-collapsed':''}`},side,work));
  restoreScroll(root);
  workbench?.restoreScroll();
  applyPendingFocus();
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
  const sections=[['catalogue','Diagnostice','search'],['curriculum','Programă','exam']];
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
  const list=el('div',{class:'studio-case-list',id:'studio-case-list','data-scroll-key':'case-list'});
  groups.forEach((group,index)=>{
    if(!group.cases.length)return;
    const open=Boolean(expanded[group.id]),bodyId=`studio-case-group-${group.id || 'orphaned'}`;
    const head=button([icon(open?'chevron-down':'chevron-up',14),el('span',{class:'studio-case-group-label','data-chapter-label':group.id||null},group.label),
      el('span',{class:'studio-case-count'},String(group.cases.length))],
    ()=>{expanded[group.id]=!open;renderCaseList();},'studio-case-group-head',
    {'aria-expanded':String(open),'aria-controls':bodyId,title:`${group.label} · ${group.cases.length} cazuri`});
    head.style.setProperty('--chapter-accent',accents[index%accents.length]);
    list.append(el('section',{class:'studio-case-group'},head,open?el('div',{class:'studio-case-group-body',id:bodyId,'data-scroll-key':`chapter:${group.id || 'orphaned'}`},...group.cases.map(caseButton)):null));
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
    onDeleteImage:act(id=>deleteImage(id)),
    undoControl:undoControl(),
    renderNotes:controls=>renderCaseNotes(item,controls),
  });
  work.classList.add('studio-case-workspace');
  work.append(workbench.node);
}

const skipDeleteKeys={
  case:'radioeasy-studio-skip-delete',
  chapter:'radioeasy-studio-skip-chapter-delete',
  scope:'radioeasy-studio-skip-scope-delete',
  diagnosis:'radioeasy-studio-skip-diagnosis-delete',
  image:'radioeasy-studio-skip-image-delete',
  draft:'radioeasy-studio-skip-draft-delete',
};

function confirmDestructive({key,title,message,label}){
  return new Promise(resolve=>{
    let skip=false;try{skip=localStorage.getItem(key)==='off';}catch{}
    if(skip){resolve(true);return;}
    let answer=false;
    const box=el('input',{type:'checkbox'});
    const dialog=modal(title,
      el('div',{class:'studio-confirm'},el('p',{},message),
        el('label',{class:'studio-confirm-skip'},box,el('span',{},'Nu mai afișa acest mesaj'))),
      [button('Renunță',()=>dialog.close(),'button ghost'),
        button([icon('trash',15),label],()=>{answer=true;try{localStorage.setItem(key,box.checked?'off':'on');}catch{}dialog.close();},'button danger')]);
    dialog.addEventListener('close',()=>resolve(answer),{once:true});
  });
}

function removeCases(ids){
  const set=new Set(ids),removed=draft.pack.cases.filter(row=>set.has(row.id));
  draft.pack.cases=draft.pack.cases.filter(row=>!set.has(row.id));
  for(const row of draft.pack.cases){
    if(row.comparisons)row.comparisons=row.comparisons.filter(comparison=>!set.has(comparison.caseId));
    const differentials=row.sections.find(section=>section.id==='differentials');
    for(const entry of differentials?.items||[])if(set.has(entry.targetCaseId))delete entry.targetCaseId;
  }
  const used=new Set(draft.pack.cases.flatMap(row=>row.images.map(image=>image.path)));
  for(const item of removed)for(const image of item.images)if(!used.has(image.path))draft.files.delete(image.path);
  for(const id of ids)caseViews.delete(id);
}

async function deleteCase(item){
  if(!draft||!item)return;
  const index=draft.pack.cases.findIndex(row=>row.id===item.id);
  if(index<0)return;
  if(!await confirmDestructive({key:skipDeleteKeys.case,title:'Șterge cazul',label:'Șterge cazul',
    message:`Ștergi definitiv „${item.title}”? Se elimină imaginile, reperele și notițele acestui caz.`}))return;
  remember();
  removeCases([item.id]);
  caseId=(draft.pack.cases[index] || draft.pack.cases[index-1])?.id || null;
  tab='case';
  changed();await saveNow();render();
  toast('Cazul a fost șters.');
}

async function deleteChapter(chapter){
  if(!draft)return;
  const chapters=draft.pack.curriculum.chapters;
  if(chapters.length<=1){toast('Păstrează cel puțin un capitol: fiecare caz are nevoie de unul.',true);return;}
  const ids=draft.pack.cases.filter(item=>item.chapterId===chapter.id).map(item=>item.id);
  if(ids.length && !await confirmDestructive({key:skipDeleteKeys.chapter,title:'Șterge capitolul',label:'Șterge capitolul',
    message:`Capitolul „${chapter.label || 'fără nume'}” are ${ids.length} ${ids.length===1?'caz':'cazuri'}. Ștergerea capitolului șterge și ${ids.length===1?'acest caz':'aceste cazuri'}, împreună cu reperele și notițele lor.`}))return;
  remember();
  removeCases(ids);
  draft.pack.curriculum.chapters=chapters.filter(row=>row.id!==chapter.id);
  for(const scope of draft.pack.curriculum.scopes||[])scope.chapterIds=scope.chapterIds.filter(id=>id!==chapter.id);
  draft.pack.curriculum.scopes=(draft.pack.curriculum.scopes||[]).filter(scope=>scope.chapterIds.length);
  if(!draft.pack.curriculum.scopes.length)draft.pack.curriculum.scopes=[{id:uid('scope'),label:'Toată materia',chapterIds:draft.pack.curriculum.chapters.map(row=>row.id)}];
  for(const diagnosis of draft.pack.diagnoses)diagnosis.chapterIds=diagnosis.chapterIds.filter(id=>id!==chapter.id);
  draft.pack.diagnoses=draft.pack.diagnoses.filter(diagnosis=>diagnosis.chapterIds.length);
  if(caseId&&!currentCase())caseId=null;
  changed();await saveNow();render();
  toast('Capitolul a fost șters.');
}

async function deleteScope(scope){
  if(!draft)return;
  const scopes=draft.pack.curriculum.scopes;
  if(scopes.length<=1){toast('Păstrează cel puțin un domeniu de examen.',true);return;}
  if(!await confirmDestructive({key:skipDeleteKeys.scope,title:'Șterge domeniul',label:'Șterge domeniul',
    message:`Ștergi domeniul „${scope.label || 'fără nume'}”? Capitolele și cazurile rămân neschimbate.`}))return;
  remember();
  draft.pack.curriculum.scopes=scopes.filter(row=>row.id!==scope.id);
  changed();await saveNow();render();
  toast('Domeniul a fost șters.');
}

async function deleteDiagnosis(diagnosis){
  if(!draft)return;
  const used=draft.pack.cases.filter(item=>item.diagnosisIds.includes(diagnosis.id)).length;
  if(used && !await confirmDestructive({key:skipDeleteKeys.diagnosis,title:'Șterge diagnosticul',label:'Șterge diagnosticul',
    message:`Diagnosticul „${diagnosis.label}” este folosit de ${used} ${used===1?'caz':'cazuri'}. Se elimină și din ${used===1?'acel caz':'acele cazuri'}.`}))return;
  remember();
  draft.pack.diagnoses=draft.pack.diagnoses.filter(row=>row.id!==diagnosis.id);
  for(const item of draft.pack.cases)item.diagnosisIds=item.diagnosisIds.filter(id=>id!==diagnosis.id);
  changed();await saveNow();render();
  toast('Diagnosticul a fost șters.');
}

async function deleteImage(imageId){
  const item=currentCase();
  if(!item||!imageId)return;
  const image=item.images.find(row=>row.id===imageId);
  if(!image)return;
  if(item.images.length<=1){toast('Cazul are nevoie de cel puțin o imagine.',true);return;}
  if(!await confirmDestructive({key:skipDeleteKeys.image,title:'Șterge imaginea',label:'Șterge imaginea',
    message:'Ștergi imaginea selectată? Reperele desenate pe ea se șterg.'}))return;
  remember();
  item.images=item.images.filter(row=>row.id!==imageId);
  item.annotations=(item.annotations||[]).filter(row=>row.imageId!==imageId);
  for(const row of draft.pack.cases)if(row.comparisons)row.comparisons=row.comparisons.filter(comparison=>!(comparison.caseId===item.id&&comparison.imageId===imageId));
  const used=new Set(draft.pack.cases.flatMap(row=>row.images.map(candidate=>candidate.path)));
  if(!used.has(image.path))draft.files.delete(image.path);
  if(item.images.some(row=>row.role!==undefined) && !item.images.some(row=>row.role==='primary'))item.images[0].role='primary';
  const state=caseView();
  state.imageId=item.images[0].id;state.comparisonId=null;
  changed();await saveNow();render();
  toast('Imaginea a fost ștearsă.');
}

async function deleteDraft(entry){
  if(!entry)return;
  if(!await confirmDestructive({key:skipDeleteKeys.draft,title:'Șterge pachetul',label:'Șterge pachetul',
    message:`Ștergi pachetul „${entry.title || 'fără titlu'}”? Se elimină schița locală, cu cazurile, imaginile și notițele ei. Exportă-l mai întâi dacă vrei să îl păstrezi.`}))return;
  const isActive=draft?.pack.id===entry.id;
  if(isActive){clearTimeout(saveTimer);draft=null;caseId=null;showStudioMenu=true;scrollMemory.clear();}
  const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').delete(entry.id);await txDone(tx);
  drafts=drafts.filter(row=>row.id!==entry.id);
  if(isActive){const meta=db.transaction('meta','readwrite');meta.objectStore('meta').delete('activeId');await txDone(meta);}
  document.getElementById('modal').close();
  render();toast('Pachetul a fost șters.');
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
    }),el('p',{class:'studio-note'},'Adaugă sau redenumește diagnosticele din fila „Diagnostice”. Scrie explicațiile în notițele cazului. În Study, fiecare notiță poate fi autoevaluată separat.')));
  for(const [sectionId,labelText] of Object.entries(SECTION_LABELS)){
    let section=item.sections.find(s=>s.id===sectionId);if(!section){section={id:sectionId,label:labelText,items:[],status:'missing'};item.sections.push(section);}
    const group=el('section',{class:'studio-form-section'},el('h2',{},labelText));
    for(const entry of section.items){
      const input=el('textarea',{value:entry.text,'aria-label':labelText,
        oninput:event=>changeCase(()=>{entry.text=event.target.value;})});
      const toolsRow=el('div',{class:'studio-item-tools'});
      if(sectionId==='differentials'){
        const target=el('select',{class:'select','aria-label':'Cazul diagnosticului diferențial',onchange:event=>{changeCase(()=>{if(event.target.value){entry.targetCaseId=event.target.value;affectsV2();}else delete entry.targetCaseId;});}},el('option',{value:''},'Fără legătură către un caz'),...draft.pack.cases.filter(row=>row.id!==item.id).map(row=>el('option',{value:row.id,selected:entry.targetCaseId===row.id},row.title)));
        toolsRow.append(target);
      }
      group.append(el('div',{class:'studio-item studio-observation-entry','data-observation-id':entry.id},
        el('div',{class:'studio-observation-fields'},input,toolsRow),
        observationControls(entry),
        button(icon('close',13),()=>{
          changeCase(c=>{
            section.items=section.items.filter(p=>p.id!==entry.id);
            c.annotations=c.annotations.filter(row=>row.itemId!==entry.id);
          });
          removeObservation(entry.id);render();
        },'icon-button studio-remove-observation',{'aria-label':'Șterge notița'})));
    }
    group.append(button([icon('plus',13),'Adaugă notiță'],()=>{changeCase(()=>section.items.push({id:uid('point'),text:''}));render();},'button ghost'));notes.append(group);
  }
  if(item.referenceText)notes.append(el('details',{class:'studio-source'},el('summary',{},'Transcrierea sursă păstrată'),item.referenceText));
  return notes;
}

function renderCatalogue(work){
  work.append(el('div',{class:'studio-title'},el('h1',{},'Catalogul de diagnostice'),badge(`${draft.pack.diagnoses.length} INTRĂRI`)),
    el('p',{class:'studio-note'},'Asociază diagnosticele din catalog cu cazurile. În Study, studenții le văd ca referință când își verifică răspunsul.'));
  const name=el('input',{type:'text',placeholder:'Denumirea completă','aria-label':'Diagnostic nou'}),chapter=el('select',{'aria-label':'Capitolul diagnosticului'},...draft.pack.curriculum.chapters.map(c=>el('option',{value:c.id},c.label)));
  work.append(el('section',{class:'studio-form-section'},el('h2',{},'Diagnostic nou'),el('label',{class:'studio-field'},el('span',{},'Denumire'),name),el('label',{class:'studio-field'},el('span',{},'Capitol'),chapter),
    button('Adaugă în catalog',()=>{
    const label=name.value.trim();if(!label){toast('Completează denumirea.',true);return;}
    if(draft.pack.diagnoses.some(d=>normalise(d.label)===normalise(label))){toast('Diagnosticul există deja în catalog.',true);return;}
    remember();draft.pack.diagnoses.push({id:uid('diagnosis'),label,chapterIds:[chapter.value]});changed();render();
  })));
  const list=el('div',{class:'studio-panel-list'});
  for(const diagnosis of draft.pack.diagnoses)list.append(el('section',{class:'studio-catalogue-row'},
    field('Denumire completă',diagnosis.label,value=>{remember();diagnosis.label=value;changed();}),
    el('div',{class:'studio-checks studio-catalogue-tools'},...draft.pack.curriculum.chapters.map(c=>{const input=el('input',{type:'checkbox',checked:diagnosis.chapterIds.includes(c.id),onchange:()=>{if(!input.checked&&diagnosis.chapterIds.length<=1){input.checked=true;toast('Diagnosticul are nevoie de cel puțin un capitol.',true);return;}if(input.checked)diagnosis.chapterIds=[...new Set([...diagnosis.chapterIds,c.id])];else diagnosis.chapterIds=diagnosis.chapterIds.filter(id=>id!==c.id);changed();}});return el('label',{},input,c.label);}),
      button([icon('trash',14),'Șterge diagnosticul'],()=>deleteDiagnosis(diagnosis),'button ghost studio-danger-text'))));
  work.append(list);
}

function renderCurriculum(work){
  work.append(el('div',{class:'studio-title'},el('h1',{},'Pachet & programă')));
  const form=el('div',{class:'studio-main-form'},el('section',{class:'studio-form-section'},
    field('Numele pachetului',draft.pack.title,value=>{draft.pack.title=value;changed();}),
    field('Versiunea pachetului',draft.pack.revision,value=>{draft.pack.revision=value;changed();},{help:'La publicarea unei corecturi, schimbă versiunea. Identificatorii cazurilor rămân stabili.'}),
    field('Descriere',draft.pack.description,value=>{draft.pack.description=value;changed();},{textarea:true}),
    field('Materia / programa',draft.pack.curriculum.title,value=>{draft.pack.curriculum.title=value;changed();}),
    field('Ediție / an universitar',draft.pack.curriculum.edition,value=>{draft.pack.curriculum.edition=value;changed();}),
    field('Sursa și dreptul de distribuire',draft.pack.source.note,value=>{draft.pack.source.note=value;changed();},{textarea:true,help:'Pachetul și aplicația au distribuții separate. Include doar imagini și texte pe care le poți distribui.'}),
    el('p',{class:'studio-note'},`Identificator stabil: ${draft.pack.id}`)));
  const chapters=el('section',{class:'studio-form-section'},el('h2',{},'Capitole'));
  for(const chapter of draft.pack.curriculum.chapters)chapters.append(el('div',{class:'studio-entity-row'},
    field('Titlul capitolului',chapter.label,value=>{chapter.label=value;changed();syncChapterLabel(chapter.id,value);},{controlId:chapter.id}),
    button(icon('trash',16),()=>deleteChapter(chapter),'icon-button studio-danger-icon',{'aria-label':`Șterge capitolul ${chapter.label || ''}`,title:'Șterge capitolul'})));
  chapters.append(button('Adaugă capitol',()=>{remember();const chapter={id:uid('chapter'),label:''};draft.pack.curriculum.chapters.push(chapter);draft.pack.curriculum.scopes[0]?.chapterIds.push(chapter.id);focusField(chapter.id);changed();render();},'button secondary'));form.append(chapters);
  form.append(el('h2',{},'Domenii de examen'),el('p',{class:'studio-note'},'Definește explicit capitolele unui colocviu sau ale examenului final. Aplicația nu presupune unde sunt limitele programei.'));
  for(const scope of draft.pack.curriculum.scopes){
    form.append(el('section',{class:'studio-scope'},
      el('div',{class:'studio-entity-row'},
        field('Numele evaluării',scope.label,value=>{scope.label=value;changed();},{controlId:scope.id}),
        button(icon('trash',16),()=>deleteScope(scope),'icon-button studio-danger-icon',{'aria-label':`Șterge domeniul ${scope.label || ''}`,title:'Șterge domeniul'})),
      el('div',{class:'studio-checks'},...draft.pack.curriculum.chapters.map(c=>{const input=el('input',{type:'checkbox',checked:scope.chapterIds.includes(c.id),onchange:()=>{if(!input.checked&&scope.chapterIds.length<=1){input.checked=true;toast('Domeniul are nevoie de cel puțin un capitol.',true);return;}scope.chapterIds=input.checked?[...new Set([...scope.chapterIds,c.id])]:scope.chapterIds.filter(id=>id!==c.id);changed();}});return el('label',{},input,el('span',{'data-chapter-label':c.id},c.label||'Capitol fără nume'));}))))
  }
  form.append(button('Adaugă domeniu de examen',()=>{remember();const scope={id:uid('scope'),label:'',chapterIds:draft.pack.curriculum.chapters.map(c=>c.id)};draft.pack.curriculum.scopes.push(scope);focusField(scope.id);changed();render();},'button secondary'));
  work.append(form);
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

function sanitiseForExport(pack){
  const caseIndex=new Map(pack.cases.map(row=>[row.id,new Set(row.images.map(image=>image.id))]));
  for(const item of pack.cases){
    const referenced=new Set((item.annotations||[]).map(row=>row.itemId));
    for(const section of item.sections){
      section.items=section.items.filter(row=>row.text.trim() || referenced.has(row.id));
      section.status=section.items.length?'present':'missing';
    }
    const itemIds=new Set(item.sections.flatMap(section=>section.items.map(row=>row.id)));
    item.annotations=(item.annotations||[]).filter(row=>itemIds.has(row.itemId));
    const comparisons=(item.comparisons||[]).filter(row=>caseIndex.get(row.caseId)?.has(row.imageId));
    if(pack.version===2 || comparisons.length)item.comparisons=comparisons;else delete item.comparisons;
    const differentials=item.sections.find(section=>section.id==='differentials');
    for(const row of differentials?.items||[])if(row.targetCaseId && (!caseIndex.has(row.targetCaseId)||row.targetCaseId===item.id))delete row.targetCaseId;
    item.completeness=item.sections.every(section=>section.items.length)?'full':item.sections.filter(section=>section.items.length).every(section=>section.id==='diagnosis')?'diagnosis-only':'partial';
    if(item.comparisons?.length || item.images.some(image=>image.role==='comparison') ||
      item.annotations.some(row=>row.style || row.shape==='polyline') || differentials?.items.some(row=>row.targetCaseId))pack.version=2;
  }
}

async function importDraft(file){
  requireThat(file.size<=LIMITS.archive,'Pachetul depășește 32 MiB.');if(draft)await saveNow();
  status('Se verifică arhiva…');const {files}=await archiveJob('read',{file}),prepared=await validateFiles(files);
  const use=async()=>{
    openWorkspace(projectFromRecord({pack:prepared.pack,files:prepared.blobs}));
    await saveNow();render();toast('Pachet deschis în Studio.');
  };
  if(drafts.some(row=>row.id===prepared.pack.id))modal('Înlocuiești proiectul local?',el('p',{class:'modal-body'},'Există deja o schiță cu același identificator. Exportă schița curentă înainte, dacă vrei să păstrezi ambele versiuni.'),[button('Renunță',()=>document.getElementById('modal').close(),'button secondary'),button('Înlocuiește',act(async()=>{document.getElementById('modal').close();await use();}))]);else await use();
}

async function exportDraft(){
  requireThat(draft,'Nu există un pachet deschis.');await saveNow();
  const packSnapshot=structuredClone(draft.pack),assets=draft.files;
  sanitiseForExport(packSnapshot);
  const {pack}=validatePack(packSnapshot);
  const used=new Set(pack.cases.flatMap(item=>item.images.map(image=>image.path)));
  const files=[{name:'pack.json',data:JSON.stringify(pack,null,2)}];
  for(const path of used){requireThat(assets.has(path),`Imagine lipsă: ${path}`);files.push({name:path,data:assets.get(path)});}
  // Validate exactly the data which will be exported, including hashes and links.
  const check=await validateFiles(new Map(await Promise.all(files.map(async f=>[f.name,typeof f.data==='string'?new TextEncoder().encode(f.data):new Uint8Array(await f.data.arrayBuffer())]))));
  modal('Pachet valid pentru Study',el('div',{class:'studio-validate'},`${check.pack.cases.length} cazuri · ${check.pack.diagnoses.length} diagnostice\n${check.pack.cases.reduce((n,c)=>n+c.annotations.length,0)} repere vizuale\n\nImaginile și referințele au fost verificate. Exportul nu include progresul niciunui student.`),[
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
  if(saved)draft=projectFromRecord(saved);
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
