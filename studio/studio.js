import {el,button,icon,badge,toast,modal} from './lib/dom.js';
import {SECTION_LABELS,normalise,shuffled} from './lib/core.js';
import {LIMITS,validatePack,validateQuestions,validateFiles,imageDimensions,requireThat} from './lib/schema.js';
import {archiveJob} from './lib/archive.js';
import {annotationRenderer,MARK_PALETTE,autoColour} from './lib/annotation-view.js';

let db,drafts=[],draft=null,caseId=null,tab='case',imageURL=null,drawItemId=null,saveTimer,saveGeneration=0,undoSnapshot=null;
let activeImageId=null,drawTool='ellipse',drawPattern='none',drawColor='auto',closedFreehand=true,activeAnnotationId=null,pendingUpload='case',selectedChapters={};
let registration=null,updateChecking=false;
const uid=prefix=>prefix+'-'+crypto.randomUUID();
const act=fn=>async event=>{try{await fn(event);}catch(error){toast(error.message || 'Operația nu a putut fi finalizată.',true);}};
const currentCase=()=>draft?.pack.cases.find(item=>item.id===caseId);
const currentImage=()=>currentCase()?.images.find(row=>row.id===activeImageId) || currentCase()?.images[0];
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
function status(message){const node=document.getElementById('save-status');if(node)node.textContent=message;}
function updateCheckLabel(){return updateChecking?'Verific actualizările…':'Verifică actualizări';}
function refreshUpdateControls(){
  for(const node of document.querySelectorAll('.update-check')){
    node.disabled=updateChecking;
    const label=node.querySelector('span');
    if(label)label.textContent=updateCheckLabel();
  }
}
async function activateUpdate(){
  const waiting=registration?.waiting;
  if(!waiting)return false;
  let reloaded=false;
  const reload=()=>{if(reloaded)return;reloaded=true;location.reload();};
  navigator.serviceWorker.addEventListener('controllerchange',reload,{once:true});
  try{await saveNow();}catch{toast('Proiectul nu a putut fi salvat. Verifică spațiul liber și încearcă din nou.',true);return false;}
  waiting.postMessage({type:'ACTIVATE_UPDATE'});
  setTimeout(reload,4000);
  return true;
}
function waitForWaitingWorker(deadline){
  return new Promise(resolve=>{
    const poll=()=>{
      if(registration?.waiting)return resolve(true);
      if(Date.now()>deadline)return resolve(false);
      setTimeout(poll,250);
    };
    poll();
  });
}
async function checkForUpdates(){
  if(updateChecking)return;
  if(!registration){toast('Actualizarea automată nu este disponibilă în acest browser. Reîncarcă pagina.',true);return;}
  updateChecking=true;refreshUpdateControls();
  try{
    await registration.update();
    const ready=await waitForWaitingWorker(Date.now()+15000);
    updateChecking=false;refreshUpdateControls();
    if(ready){toast('Se aplică versiunea nouă…');await activateUpdate();}
    else toast('Ai deja cea mai recentă versiune.');
  }catch{
    updateChecking=false;refreshUpdateControls();
    toast('Nu am putut verifica actualizările. Verifică conexiunea și încearcă din nou.',true);
  }
}
function changed(){saveGeneration++;status('Se salvează…');clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveNow().catch(error=>{status('Nesalvat');toast(error.message,true);}),450);}
function remember(){if(draft)undoSnapshot={pack:structuredClone(draft.pack),bank:structuredClone(draft.bank),files:new Map(draft.files)};}
function changeCase(fn,assessmentChanged=true){remember();fn(currentCase());if(assessmentChanged)for(const q of draft.bank.items.filter(q=>q.caseId===caseId))q.reviewStatus='draft';changed();}
async function saveNow(){
  if(!draft)return;clearTimeout(saveTimer);const generation=saveGeneration;
  const tx=db.transaction(['drafts','meta'],'readwrite'),done=txDone(tx);
  tx.objectStore('drafts').put({id:draft.pack.id,pack:draft.pack,bank:draft.bank,files:[...draft.files].map(([path,blob])=>({path,blob})),updatedAt:Date.now()});
  tx.objectStore('meta').put(draft.pack.id,'activeId');await done;
  const entry={id:draft.pack.id,title:draft.pack.title};drafts=drafts.filter(d=>d.id!==entry.id);drafts.push(entry);if(generation===saveGeneration)status('Salvat local');
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
  draft={pack,bank:{format:'radiology-question-bank',version:1,packId:id,revision:pack.revision,items:[]},files:new Map()};caseId=null;tab='curriculum';await saveNow();render();
}
async function openDraft(id){if(draft)await saveNow();const record=await req(db.transaction('drafts').objectStore('drafts').get(id));if(!record)return;draft={pack:record.pack,bank:record.bank,files:new Map(record.files.map(f=>[f.path,f.blob]))};caseId=draft.pack.cases[0]?.id || null;drawItemId=null;await saveNow();render();}

function render(){
  if(imageURL){URL.revokeObjectURL(imageURL);imageURL=null;}
  const head=el('header',{class:'studio-header'},el('div',{class:'studio-brand'},el('img',{src:'./icons/icon.svg',alt:''}),'RadioEasy',el('small',{},'PACK STUDIO')),
    el('div',{class:'studio-header-actions'},el('span',{class:'save-status',id:'save-status'},draft?'Salvat local':'Offline după prima încărcare'),
      button([icon('plus',15),'Pachet nou'],act(newPack),'button secondary'),button([icon('upload',15),'Deschide ZIP'],()=>document.getElementById('open-pack').click(),'button secondary'),
      draft?button([icon('download',15),'Validează & exportă'],act(exportDraft)):null,
      button([icon('refresh',15),el('span',{'aria-live':'polite'},updateCheckLabel())],act(()=>checkForUpdates()),'button secondary update-check',{disabled:updateChecking,title:'Verifică și aplică o versiune nouă, fără a șterge proiectele salvate'})));
  const root=document.getElementById('studio');
  if(!draft){root.replaceChildren(head,el('main',{class:'studio-empty'},badge('APLICAȚIE PENTRU CONTRIBUTORI','green'),el('h1',{},'Explicații care arată unde să privești.'),el('p',{},'Organizează radiografiile, leagă observațiile de imagine și pregătește exerciții. Totul se lucrează local; colegii primesc un singur pachet ZIP.'),el('div',{class:'button-row'},button('Creează primul pachet',act(newPack)),button('Deschide un pachet existent',()=>document.getElementById('open-pack').click(),'button secondary'))));return;}
  const select=el('select',{class:'select','aria-label':'Proiect de pachet',onchange:act(event=>openDraft(event.target.value))},...drafts.map(row=>el('option',{value:row.id,selected:row.id===draft.pack.id},row.title)));
  const side=el('aside',{class:'studio-sidebar'},select,button([icon('plus',14),'Adaugă radiografie'],()=>document.getElementById('add-image').click(),'button secondary'),
    el('div',{class:'studio-case-list'},...draft.pack.cases.map(item=>button([el('span',{},item.title),el('small',{},draft.pack.curriculum.chapters.find(c=>c.id===item.chapterId)?.label || '')],()=>{caseId=item.id;drawItemId=null;activeImageId=null;activeAnnotationId=null;tab='case';render();},`studio-case ${caseId===item.id?'active':''}`))));
  const work=el('main',{class:'studio-workspace'},el('nav',{class:'studio-tabs','aria-label':'Secțiuni Studio'},...[["case","Caz & repere"],["banks","Bănci de răspunsuri"],["catalogue","Diagnostice"],["curriculum","Programă"],["questions","Grile"]].map(([id,label])=>button(label,()=>{tab=id;render();},`chip ${tab===id?'active':''}`))),
    undoSnapshot?button('Anulează ultima editare',act(async()=>{const old=undoSnapshot;undoSnapshot=null;draft.pack=old.pack;draft.bank=old.bank;draft.files=old.files;changed();await saveNow();render();}),'button ghost'):null);
  if(tab==='case')renderCaseEditor(work);else if(tab==='banks')renderBanks(work);else if(tab==='catalogue')renderCatalogue(work);else if(tab==='curriculum')renderCurriculum(work);else renderQuestions(work);
  const previousList=root.querySelector('.studio-case-list'),scrollTop=previousList?.scrollTop || 0,scrollLeft=previousList?.scrollLeft || 0;
  root.replaceChildren(head,el('div',{class:'studio-layout'},side,work));
  const nextList=root.querySelector('.studio-case-list');if(nextList){nextList.scrollTop=scrollTop;nextList.scrollLeft=scrollLeft;}
}

function renderCaseEditor(work){
  const item=currentCase();if(!item){work.append(el('div',{class:'studio-empty'},el('h1',{},'Începe cu o radiografie.'),el('p',{},'Alege o imagine PNG sau JPEG. Nu se cere acces la un director; citești doar fișierul ales.'),button('Alege imaginea',()=>document.getElementById('add-image').click())));return;}
  if(!activeImageId || !item.images.some(row=>row.id===activeImageId))activeImageId=item.images.find(row=>row.role!=='comparison')?.id || item.images[0].id;
  const image=currentImage(),blob=draft.files.get(image.path),picture=el('img',{alt:item.title});
  if(blob){imageURL=URL.createObjectURL(blob);picture.src=imageURL;}
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 1000 1000');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('tabindex','0');svg.setAttribute('aria-label','Desenează un reper pe imagine');
  const hint=el('p',{class:'studio-image-hint'},'Alege observația cu butonul „Leagă”, apoi desenează pe imagine. Instrumentul implicit este elipsa; coordonatele rămân corecte la redimensionare.');
  const reviewBadge=badge(draft.pack.version===2?'PACHET v2':'SCHIȚĂ LOCALĂ');
  work.append(el('div',{class:'studio-title'},el('h1',{},item.title),reviewBadge));

  const imageSelect=selectField('Imaginea editată',item.images.map((row,index)=>({id:row.id,label:`${index+1}. ${row.role==='comparison'?'Comparație':'Principală'} · ${row.path.split('/').pop()}`})),image.id,value=>{activeImageId=value;activeAnnotationId=null;render();});
  const toolButtons=['ellipse','rect','arrow','freehand'].map((value,index)=>button(({ellipse:'Elipsă',rect:'Dreptunghi',arrow:'Săgeată',freehand:'Contur liber'})[value],()=>{drawTool=value;render();},`chip ${drawTool===value?'active':''}`));
  const colourChoices=el('select',{class:'select','aria-label':'Culoarea reperului',onchange:event=>{drawColor=event.target.value;render();}},
    el('option',{value:'auto',selected:drawColor==='auto'},'Automată (culoare nouă)'),
    ...MARK_PALETTE.map(colour=>el('option',{value:colour,selected:drawColor===colour},colour)));
  const colourInput=el('input',{type:'color',value:/^#[0-9a-f]{6}$/i.test(drawColor)?drawColor:MARK_PALETTE[0],'aria-label':'Culoare personalizată',oninput:event=>{drawColor=event.target.value;}});
  const patternSelect=el('select',{class:'select','aria-label':'Umplerea reperului',onchange:event=>{drawPattern=event.target.value;render();}},...[['none','Fără umplere'],['diagonal','Linii oblice'],['dots','Puncte'],['vertical','Linii verticale'],['horizontal','Linii orizontale']].map(([value,label])=>el('option',{value,selected:drawPattern===value},label)));
  const freehandToggle=el('label',{class:'studio-checks'},el('input',{type:'checkbox',checked:closedFreehand,onchange:event=>{closedFreehand=event.target.checked;}}),'Contur liber închis (umplere disponibilă)');
  const tools=el('div',{class:'studio-form-section compact'},el('h2',{},'Instrument de desen'),el('div',{class:'studio-image-tools'},...toolButtons),imageSelect,el('div',{class:'button-row'},button('Adaugă o imagine acestui caz',()=>{pendingUpload='case';document.getElementById('add-case-image').click();},'button secondary')),
    el('div',{class:'studio-draw-grid'},el('div',{class:'studio-field'},el('span',{},'Culoare'),colourChoices,colourInput),el('div',{class:'studio-field'},el('span',{},'Umplere'),patternSelect),drawTool==='freehand'?freehandToggle:null),
    el('p',{class:'studio-note'},'Fiecare reper nou primește automat o culoare diferită. Poți alege o culoare personalizată sau o poți schimba ulterior din listă. Umplerea este disponibilă doar pentru forme închise; săgeata se desenează de la coadă la vârf.'));

  function styleFor(shape){
    const closed=['ellipse','rect','polygon'].includes(shape);
    const color=drawColor==='auto'?autoColour(item.annotations,image.id):drawColor;
    return {color,...(closed && drawPattern!=='none'?{pattern:drawPattern}:{})};
  }
  function renderMarks(){
    const renderer=annotationRenderer(svg,{prefix:'studio-marks'});
    svg.replaceChildren();
    for(const region of item.annotations.filter(row=>row.imageId===image.id)){
      const label=region.label || String(item.annotations.filter(row=>row.imageId===region.imageId).indexOf(region)+1);
      const group=renderer(region,{label});
      group.setAttribute('tabindex','0');group.setAttribute('role','button');
      group.setAttribute('aria-label',`Reper ${label}`);
      group.addEventListener('click',()=>{activeAnnotationId=region.id;render();});
      group.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();activeAnnotationId=region.id;render();}});
      if(region.id===activeAnnotationId)group.classList.add('active');
      svg.append(group);
    }
  }
  let start=null,previewRow=null,previewGroup=null,toolAtStart=drawTool;
  const point=event=>{const r=svg.getBoundingClientRect();return [Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))];};
  function preview(){if(previewGroup)previewGroup.remove();if(!previewRow)return;const renderer=annotationRenderer(svg,{prefix:'studio-preview'});previewGroup=renderer(previewRow,{label:''});previewGroup.classList.add('studio-preview');svg.append(previewGroup);}
  function clearPreview(){previewRow=null;previewGroup?.remove();previewGroup=null;}
  svg.addEventListener('pointerdown',event=>{
    if(!drawItemId){toast('Alege mai întâi observația pe care vrei să o legi de imagine.');return;}
    if(!draft.files.get(image.path))return;
    start=point(event);toolAtStart=drawTool;svg.setPointerCapture(event.pointerId);
    if(toolAtStart==='freehand')previewRow={shape:closedFreehand?'polygon':'polyline',points:[start]};
    else if(toolAtStart==='ellipse')previewRow={shape:'ellipse',cx:start[0],cy:start[1],rx:.0001,ry:.0001};
    else if(toolAtStart==='rect')previewRow={shape:'rect',x:start[0],y:start[1],width:.0001,height:.0001};
    else previewRow={shape:'arrow',x1:start[0],y1:start[1],x2:start[0],y2:start[1]};
    preview();
  });
  svg.addEventListener('pointermove',event=>{
    if(!start)return;const end=point(event);
    if(toolAtStart==='freehand'){
      const last=previewRow.points[previewRow.points.length-1];
      if(Math.hypot(end[0]-last[0],end[1]-last[1])>.004 && previewRow.points.length<100)previewRow.points.push(end);
    }else if(toolAtStart==='ellipse'){
      Object.assign(previewRow,{cx:(start[0]+end[0])/2,cy:(start[1]+end[1])/2,rx:Math.abs(start[0]-end[0])/2,ry:Math.abs(start[1]-end[1])/2});
    }else if(toolAtStart==='rect'){
      Object.assign(previewRow,{x:Math.min(start[0],end[0]),y:Math.min(start[1],end[1]),width:Math.abs(start[0]-end[0]),height:Math.abs(start[1]-end[1])});
    }else Object.assign(previewRow,{x1:start[0],y1:start[1],x2:end[0],y2:end[1]});
    preview();
  });
  function finish(event){
    if(!start)return;const end=point(event),row=previewRow;
    let valid=false;
    if(toolAtStart==='ellipse')valid=row.rx>.005 && row.ry>.005;
    else if(toolAtStart==='rect')valid=row.width>.008 && row.height>.008;
    else if(toolAtStart==='arrow')valid=Math.hypot(row.x2-row.x1,row.y2-row.y1)>.02;
    else valid=row.points.length>=(row.shape==='polygon'?3:2) && new Set(row.points.map(pair=>pair.join(':'))).size>=2;
    if(valid && row.shape==='polygon'){
      const area=row.points.reduce((sum,point,index)=>{const next=row.points[(index+1)%row.points.length];return sum+point[0]*next[1]-next[0]*point[1];},0);
      valid=Math.abs(area)>.000001;
    }
    if(valid){
      remember();const shape=row.shape;
      item.annotations.push({...row,id:uid('region'),imageId:image.id,itemId:drawItemId,label:String(item.annotations.filter(r=>r.imageId===image.id).length+1),style:styleFor(shape),reviewStatus:'draft'});
      ensureV2();activeAnnotationId=item.annotations[item.annotations.length-1].id;changed();
    }
    start=null;clearPreview();render();
  }
  svg.addEventListener('pointerup',finish);
  svg.addEventListener('pointercancel',()=>{start=null;clearPreview();});
  svg.addEventListener('keydown',event=>{if(event.key==='Escape'){start=null;clearPreview();}});

  const coordForm=el('div',{class:'studio-coord-form'},el('span',{class:'field-label'},'Adaugă prin coordonate (0–1)'),
    ...['x','y','width','height'].map(name=>el('input',{type:'number',min:'0',max:'1',step:'0.001',value:name==='width'||name==='height'?'0.1':'0.4','aria-label':name,class:'select',inputmode:'decimal'})));
  const coordInputs=[...coordForm.querySelectorAll('input')];
  coordForm.append(button('Adaugă elipsă',()=>{
    if(!drawItemId){toast('Alege mai întâi observația.',true);return;}
    const [x,y,width,height]=coordInputs.map(input=>Math.max(0,Math.min(1,Number(input.value))));
    if(![x,y,width,height].every(Number.isFinite)||width<=0||height<=0){toast('Completează coordonate valide.',true);return;}
    remember();item.annotations.push({id:uid('region'),imageId:image.id,itemId:drawItemId,shape:'ellipse',cx:x+width/2,cy:y+height/2,rx:width/2,ry:height/2,label:String(item.annotations.filter(r=>r.imageId===image.id).length+1),style:styleFor('ellipse'),reviewStatus:'draft'});
    ensureV2();changed();render();
  },'button ghost'));

  const imageColumn=el('div',{class:'studio-image-column'},tools,el('div',{class:'studio-image-wrap'},picture,svg),hint,coordForm);
  const markList=el('section',{class:'studio-form-section'},el('h2',{},`Repere pe imagine (${item.annotations.filter(row=>row.imageId===image.id).length})`));
  for(const region of item.annotations.filter(row=>row.imageId===image.id)){
    const pointRow=item.sections.flatMap(section=>section.items).find(point=>point.id===region.itemId);
    const reviewed=el('input',{type:'checkbox',checked:region.reviewStatus==='reviewed',onchange:event=>{region.reviewStatus=event.target.checked?'reviewed':'draft';changed();}});
    const colour=el('input',{type:'color',value:region.style?.color || '#e8c777','aria-label':'Culoarea reperului',oninput:event=>{remember();region.style={...(region.style||{}),color:event.target.value};ensureV2();changed();renderMarks();}});
    const pattern=el('select',{class:'select','aria-label':'Umplerea reperului',onchange:event=>{remember();region.style={...(region.style||{}),pattern:event.target.value};ensureV2();changed();renderMarks();}},...[['none','Fără umplere'],['diagonal','Linii oblice'],['dots','Puncte'],['vertical','Linii verticale'],['horizontal','Linii orizontale']].map(([value,label])=>el('option',{value,selected:(region.style?.pattern||'none')===value},label)));
    const auto=button('Auto',()=>{remember();const {color,...rest}=region.style||{};if(!rest.pattern||rest.pattern==='none')delete region.style;else region.style=rest;changed();render();},'icon-button',{'aria-label':'Culoare automată'});
    markList.append(el('div',{class:'studio-mark-row'},el('div',{},el('strong',{},(pointRow?.text||region.itemId).slice(0,70)),el('small',{},`${({ellipse:'Elipsă',rect:'Dreptunghi',arrow:'Săgeată',polygon:'Contur închis',polyline:'Contur deschis'})[region.shape]||region.shape}`)),el('div',{class:'studio-mark-tools'},colour,auto,
      ['ellipse','rect','polygon'].includes(region.shape)?pattern:null,reviewed,el('span',{class:'field-help'},'verificat'),
      button(icon('close',13),()=>{remember();item.annotations=item.annotations.filter(row=>row.id!==region.id);if(activeAnnotationId===region.id)activeAnnotationId=null;changed();render();},'icon-button',{'aria-label':'Șterge reperul'}))));
  }
  imageColumn.append(markList);

  const comparisons=[];
  const comparisonSection=el('section',{class:'studio-form-section'},el('h2',{},'Straturi de comparație'),el('p',{class:'studio-note'},'Alege o altă imagine din pachet, de exemplu o structură normală sau un diagnostic diferențial. Study le afișează opțional, lângă imaginea principală.'));
  for(const row of item.comparisons || []){
    const target=draft.pack.cases.find(c=>c.id===row.caseId),targetImage=target?.images.find(imageRow=>imageRow.id===row.imageId);
    comparisonSection.append(el('div',{class:'studio-item'},el('div',{},el('strong',{},row.label),el('small',{},`${target?.title||row.caseId} · ${targetImage?.path.split('/').pop()||row.imageId}`)),button(icon('close',13),()=>{remember();item.comparisons=item.comparisons.filter(c=>c.id!==row.id);changed();render();},'icon-button',{'aria-label':'Șterge comparația'})));
  }
  const targetCase=el('select',{class:'select','aria-label':'Cazul de comparație'},...draft.pack.cases.map(caseRow=>el('option',{value:caseRow.id,selected:caseRow.id===item.id},caseRow.title)));
  const targetImage=el('select',{class:'select','aria-label':'Imaginea de comparație'});
  const fillTargetImages=()=>{const source=draft.pack.cases.find(c=>c.id===targetCase.value);targetImage.replaceChildren(...(source?.images||[]).map(row=>el('option',{value:row.id},row.role==='comparison'?`Comparație · ${row.path.split('/').pop()}`:`Principală · ${row.path.split('/').pop()}`)));};
  targetCase.addEventListener('change',fillTargetImages);fillTargetImages();
  const label=el('input',{type:'text',placeholder:'Eticheta comparației','aria-label':'Eticheta comparației',value:'Structură de comparație'});
  comparisonSection.append(el('div',{class:'studio-compare-form'},targetCase,targetImage,label,button('Adaugă comparație',()=>{
    const source=draft.pack.cases.find(c=>c.id===targetCase.value),imageRow=source?.images.find(row=>row.id===targetImage.value);
    if(!source||!imageRow){toast('Alege o imagine validă.',true);return;}
    if(source.id===item.id && imageRow.id===image.id){toast('Comparația nu poate fi chiar imaginea de bază.',true);return;}
    if((item.comparisons||[]).some(row=>row.caseId===source.id&&row.imageId===imageRow.id)){toast('Comparația există deja.',true);return;}
    remember();item.comparisons=item.comparisons||[];item.comparisons.push({id:uid('comparison'),label:label.value.trim()||'Comparație',caseId:source.id,imageId:imageRow.id});ensureV2();changed();render();
  },'button secondary')));
  comparisonSection.append(el('button',{type:'button',class:'button ghost',onclick:()=>{pendingUpload='comparison';document.getElementById('add-case-image').click();}},'+ Încarcă o imagine de comparație'));
  imageColumn.append(comparisonSection);

  const notes=el('div',{});
  notes.append(el('section',{class:'studio-form-section'},field('Numele cazului',item.title,value=>changeCase(c=>c.title=value,false)),
    selectField('Capitol',draft.pack.curriculum.chapters,item.chapterId,value=>changeCase(c=>c.chapterId=value)),
    selectField('Diagnosticul pozitiv',[{id:'',label:'Nu este precizat / alege un diagnostic'},...draft.pack.diagnoses.map(d=>({id:d.id,label:d.label}))],item.diagnosisIds[0] || '',value=>{
      changeCase(c=>{c.diagnosisIds=value?[value]:[];const section=c.sections.find(s=>s.id==='diagnosis');if(value && !section.items.length)section.items.push({id:uid('point'),text:draft.pack.diagnoses.find(d=>d.id===value).label});});render();
    }),el('p',{class:'studio-note'},'Adaugă sau redenumește diagnosticele din fila „Diagnostice”. Cazurile fără diagnostic pot fi studiate, fără întrebare automată de diagnostic.')));
  notes.append(structuredEditor(item));
  for(const [sectionId,labelText] of Object.entries(SECTION_LABELS)){
    let section=item.sections.find(s=>s.id===sectionId);if(!section){section={id:sectionId,label:labelText,items:[],status:'missing'};item.sections.push(section);}
    const group=el('section',{class:'studio-form-section'},el('h2',{},labelText));
    for(const entry of section.items){
      const input=el('textarea',{value:entry.text,'aria-label':labelText,oninput:event=>changeCase(()=>{entry.text=event.target.value;})});
      const attach=button('Leagă',()=>{drawItemId=entry.id;hint.textContent=`Desenezi pentru: ${entry.text.slice(0,140)}`;work.querySelectorAll('[data-link-item]').forEach(b=>b.classList.toggle('active',b.getAttribute('data-link-item')===entry.id));},`chip ${drawItemId===entry.id?'active':''}`,{'data-link-item':entry.id});
      const toolsRow=el('div',{class:'studio-item-tools'},attach);
      if(sectionId==='differentials'){
        const target=el('select',{class:'select','aria-label':'Cazul diagnosticului diferențial',onchange:event=>{changeCase(()=>{if(event.target.value)entry.targetCaseId=event.target.value;else delete entry.targetCaseId;});}},el('option',{value:''},'Fără legătură către un caz'),...draft.pack.cases.filter(row=>row.id!==item.id).map(row=>el('option',{value:row.id,selected:row.targetCaseId===row.id},row.title)));
        toolsRow.append(target);
      }
      group.append(el('div',{class:'studio-item'},input,toolsRow,el('div',{class:'studio-item-tools'},button(icon('close',13),()=>{changeCase(c=>{section.items=section.items.filter(p=>p.id!==entry.id);c.annotations=c.annotations.filter(r=>r.itemId!==entry.id);if(c.structured)c.structured.observations=c.structured.observations.filter(row=>row.itemId!==entry.id);});if(drawItemId===entry.id)drawItemId=null;render();},'icon-button',{'aria-label':'Șterge observația'}))));
    }
    group.append(button([icon('plus',13),'Adaugă observație'],()=>{changeCase(()=>section.items.push({id:uid('point'),text:''}));render();},'button ghost'));notes.append(group);
  }
  notes.append(notesEditor(item));
  if(item.referenceText)notes.append(el('details',{class:'studio-source'},el('summary',{},'Transcrierea sursă păstrată'),item.referenceText));
  work.append(el('div',{class:'studio-editor-grid'},imageColumn,notes));renderMarks();
}

function structuredEditor(item){
  const wrapper=el('section',{class:'studio-form-section'},el('h2',{},'Observații structurate & note'));
  if(!item.structured){
    wrapper.append(el('p',{class:'studio-note'},'Observațiile scrise liber rămân pentru studiu. Pentru notare automată, creează tipuri de observații în fila „Bănci de răspunsuri” și mapează aici observațiile acestui caz. Notele nu generează întrebări automat.'),button('Creează observații structurate',()=>{remember();ensureStructured(item);changed();render();},'button secondary'));
    return wrapper;
  }
  const structured=item.structured;
  const status=el('select',{class:'select',onchange:event=>{structured.status=event.target.value;changed();}},...[['draft','Schiță — nu se notează'],['source-derived','Derivat din sursă'],['reviewed','Verificat de contributor']].map(([value,text])=>el('option',{value,selected:structured.status===value},text)));
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
  work.append(el('div',{class:'studio-title'},el('h1',{},'Catalogul de diagnostice'),badge(`${draft.pack.diagnoses.length} INTRĂRI`)),el('p',{class:'studio-note'},'Denumirile sunt afișate complet. Sinonimele și abrevierile ajută la căutare, fără a crea opțiuni duplicate.'));
  const name=el('input',{type:'text',placeholder:'Denumirea completă','aria-label':'Diagnostic nou'}),chapter=el('select',{'aria-label':'Capitolul diagnosticului'},...draft.pack.curriculum.chapters.map(c=>el('option',{value:c.id},c.label)));
  work.append(el('section',{class:'studio-form-section'},el('h2',{},'Diagnostic nou'),el('label',{class:'studio-field'},el('span',{},'Denumire'),name),el('label',{class:'studio-field'},el('span',{},'Capitol'),chapter),button('Adaugă în catalog',()=>{
    const label=name.value.trim();if(!label){toast('Completează denumirea.',true);return;}
    if(draft.pack.diagnoses.some(d=>normalise(d.label)===normalise(label))){toast('Diagnosticul există deja; folosește aliasurile pentru alte denumiri.',true);return;}
    remember();draft.pack.diagnoses.push({id:uid('diagnosis'),label,chapterIds:[chapter.value],aliases:[]});changed();render();
  })));
  const list=el('div',{class:'studio-panel-list'});
  for(const diagnosis of draft.pack.diagnoses)list.append(el('section',{class:'studio-catalogue-row'},
    field('Denumire completă',diagnosis.label,value=>{remember();diagnosis.label=value;changed();}),
    field('Aliasuri de căutare (separate prin virgulă)',diagnosis.aliases.join(', '),value=>{diagnosis.aliases=value.split(',').map(s=>s.trim()).filter(Boolean);changed();}),
    el('div',{class:'studio-checks'},...draft.pack.curriculum.chapters.map(c=>{const input=el('input',{type:'checkbox',checked:diagnosis.chapterIds.includes(c.id),onchange:()=>{if(input.checked)diagnosis.chapterIds=[...new Set([...diagnosis.chapterIds,c.id])];else diagnosis.chapterIds=diagnosis.chapterIds.filter(id=>id!==c.id);changed();}});return el('label',{},input,c.label);})),el('small',{class:'field-help'},diagnosis.id)));
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
  work.append(el('div',{class:'studio-banner'},'Întrebarea de diagnostic cu selecție din catalog este creată automat în Study. Întrebările de aici sunt opționale. Modificarea explicațiilor unui caz readuce întrebările lui în starea „schiță”. Notele nu devin întrebări automat.'));
  const questions=draft.bank.items.filter(q=>q.caseId===caseId);
  work.append(button('Adaugă o grilă',()=>{
    remember();const id=uid('question');draft.bank.items.push({id,caseId,sectionId:'diagnosis',kind:'mcq',prompt:'Care este diagnosticul pozitiv?',options:['a','b','c','d'].map(id=>({id,label:'',feedback:''})),correctOptionIds:['a'],feedback:'',reviewStatus:'draft'});changed();render();
  },'button secondary'));
  work.append(button('Adaugă răspuns scris',()=>{
    remember();ensureBankV2();affectsV2();draft.bank.items.push({id:uid('question'),caseId,sectionId:'findings',kind:'written',prompt:'Explică observația din imagine.',rubric:'',reviewStatus:'draft'});changed();render();
  },'button secondary'));
  if(item.diagnosisIds.length)work.append(button('Propune o grilă de diagnostic',()=>{
    const correct=draft.pack.diagnoses.find(d=>d.id===item.diagnosisIds[0]),others=shuffled(draft.pack.diagnoses.filter(d=>d.id!==correct.id && d.chapterIds.includes(item.chapterId))).slice(0,3);
    if(!others.length){toast('Adaugă mai întâi alte diagnostice din capitol.',true);return;}
    remember();draft.bank.items.push({id:uid('question'),caseId,sectionId:'diagnosis',kind:'mcq',prompt:'Care este diagnosticul pozitiv?',options:[correct,...others].map(d=>({id:d.id,label:d.label,feedback:''})),correctOptionIds:[correct.id],feedback:item.sections.find(s=>s.id==='diagnosis')?.items.map(p=>p.text).join('\n') || '',reviewStatus:'draft'});changed();render();
  },'button ghost'));
  for(const q of questions){
    const kind=q.kind || 'mcq';let reviewed;const touch=fn=>{fn();q.reviewStatus='draft';if(reviewed)reviewed.checked=false;changed();};
    const card=el('section',{class:'studio-question'},el('div',{class:'studio-question-kind'},badge(kind==='written'?'RĂSPUNS SCRIS':'Grilă',kind==='written'?'orange':'green')),selectField('Secțiunea evaluată',Object.entries(SECTION_LABELS).map(([id,label])=>({id,label})),q.sectionId,value=>touch(()=>q.sectionId=value)),field('Întrebarea',q.prompt,value=>touch(()=>q.prompt=value),{textarea:true}));
    if(kind==='written'){
      card.append(field('Baremul autorului',q.rubric || '',value=>touch(()=>q.rubric=value),{textarea:true,help:'Afișat după ce studentul răspunde. Nu este notat automat; studentul își verifică răspunsul.'}));
      reviewed=el('input',{type:'checkbox',checked:q.reviewStatus!=='draft',onchange:act(async()=>{
        if(reviewed.checked){try{ensureBankV2();validateQuestions({...draft.bank,revision:draft.pack.revision,items:[q]},validatePack(draft.pack).pack);q.reviewStatus='reviewed';}catch(error){reviewed.checked=false;throw error;}}else q.reviewStatus='draft';changed();
      })});
      card.append(el('label',{class:'studio-checks'},reviewed,'Am verificat enunțul și baremul.'),el('p',{class:'studio-note'},'Răspunsul scris și autoevaluarea nu intră niciodată în precizia automată.'),button('Elimină întrebarea',()=>{remember();draft.bank.items=draft.bank.items.filter(row=>row.id!==q.id);changed();render();},'button ghost'));
    }else{
      const options=el('div',{class:'studio-options'});
      for(const option of q.options || []){
        const radio=el('input',{type:'radio',name:q.id,checked:(q.correctOptionIds||[]).includes(option.id),'aria-label':'Marchează această opțiune drept corectă',onchange:()=>touch(()=>q.correctOptionIds=[option.id])});
        options.append(el('div',{class:'studio-option'},radio,el('input',{type:'text',value:option.label,'aria-label':'Textul opțiunii',oninput:event=>touch(()=>option.label=event.target.value)})));
        options.append(field('Explicația opțiunii (opțional)',option.feedback || '',value=>touch(()=>option.feedback=value)));
      }
      reviewed=el('input',{type:'checkbox',checked:q.reviewStatus!=='draft',onchange:act(async()=>{
        if(reviewed.checked){try{validateQuestions({...draft.bank,revision:draft.pack.revision,items:[q]},validatePack(draft.pack).pack);q.reviewStatus='reviewed';}catch(error){reviewed.checked=false;throw error;}}else q.reviewStatus='draft';changed();
      })});
      card.append(options,field('Explicația răspunsului',q.feedback,value=>touch(()=>q.feedback=value),{textarea:true}),el('label',{class:'studio-checks'},reviewed,'Am verificat enunțul, cheia și toate alternativele pentru acest caz.'),el('p',{class:'studio-note'},'Schițele nu sunt incluse în export. Alternativele propuse sunt doar un punct de plecare; verifică să existe un singur răspuns optim.'),button('Elimină grila',()=>{remember();draft.bank.items=draft.bank.items.filter(row=>row.id!==q.id);changed();render();},'button ghost'));
    }
    work.append(card);
  }
}

async function addImage(file){
  requireThat(draft,'Creează sau deschide mai întâi un pachet.');requireThat(file.size<=LIMITS.entry,'Imaginea depășește limita de 12 MiB.');
  const bytes=new Uint8Array(await file.arrayBuffer()),dims=imageDimensions(bytes);requireThat(dims.width*dims.height<=LIMITS.pixels,'Imaginea depășește 12 megapixeli.');
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join(''),id=uid('case'),path=`images/${id}.${dims.mime==='image/png'?'png':'jpeg'}`;
  remember();draft.files.set(path,new Blob([bytes],{type:dims.mime}));
  draft.pack.cases.push({id,title:`Cazul ${String(draft.pack.cases.length+1).padStart(2,'0')}`,chapterId:draft.pack.curriculum.chapters[0].id,diagnosisIds:[],
    images:[{id:'primary',path,width:dims.width,height:dims.height,sha256}],sections:Object.entries(SECTION_LABELS).map(([id,label])=>({id,label,items:[],status:'missing'})),annotations:[],referenceText:'',source:{document:'',page:null},completeness:'partial'});
  caseId=id;tab='case';drawItemId=null;changed();await saveNow();render();
}

async function addCaseImage(file,role='primary'){
  requireThat(draft,'Creează sau deschide mai întâi un pachet.');const item=currentCase();requireThat(item,'Selectează mai întâi un caz.');
  requireThat(file.size<=LIMITS.entry,'Imaginea depășește limita de 12 MiB.');
  const bytes=new Uint8Array(await file.arrayBuffer()),dims=imageDimensions(bytes);requireThat(dims.width*dims.height<=LIMITS.pixels,'Imaginea depășește 12 megapixeli.');
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join(''),id=uid('image'),path=`images/${uid('img')}.${dims.mime==='image/png'?'png':'jpeg'}`;
  remember();draft.files.set(path,new Blob([bytes],{type:dims.mime}));
  item.images.push({id,path,width:dims.width,height:dims.height,sha256,...(role==='comparison'||draft.pack.version===2?{role}:{})});
  if(role==='comparison'){affectsV2();item.comparisons=item.comparisons||[];item.comparisons.push({id:uid('comparison'),label:'Comparație locală',caseId:item.id,imageId:id});}
  activeImageId=id;changed();await saveNow();render();toast(role==='comparison'?'Imaginea de comparație a fost adăugată.':'Imaginea a fost adăugată cazului.');
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
  const use=async()=>{draft={pack:prepared.pack,bank:prepared.bank || {format:'radiology-question-bank',version:1,packId:prepared.pack.id,revision:prepared.pack.revision,items:[]},files:new Map(prepared.blobs.map(f=>[f.path,f.blob]))};caseId=draft.pack.cases[0].id;tab='case';drawItemId=null;activeImageId=null;await saveNow();render();toast('Pachet deschis în Studio.');};
  if(drafts.some(row=>row.id===prepared.pack.id))modal('Înlocuiești proiectul local?',el('p',{class:'modal-body'},'Există deja o schiță cu același identificator. Exportă schița curentă înainte, dacă vrei să păstrezi ambele versiuni.'),[button('Renunță',()=>document.getElementById('modal').close(),'button secondary'),button('Înlocuiește',act(async()=>{document.getElementById('modal').close();await use();}))]);else await use();
}

async function exportDraft(){
  requireThat(draft,'Nu există un pachet deschis.');await saveNow();sanitiseForExport();
  const {pack}=validatePack(draft.pack);
  const bank=validateQuestions({...draft.bank,revision:pack.revision,items:draft.bank.items.filter(q=>q.reviewStatus!=='draft')},pack),used=new Set(pack.cases.flatMap(item=>item.images.map(image=>image.path)));
  const files=[{name:'pack.json',data:JSON.stringify(pack,null,2)}];if(bank.items.length)files.push({name:'questions.json',data:JSON.stringify(bank,null,2)});
  for(const path of used){requireThat(draft.files.has(path),`Imagine lipsă: ${path}`);files.push({name:path,data:draft.files.get(path)});}
  // Validate exactly the data which will be exported, including hashes and links.
  const check=await validateFiles(new Map(await Promise.all(files.map(async f=>[f.name,typeof f.data==='string'?new TextEncoder().encode(f.data):new Uint8Array(await f.data.arrayBuffer())]))));
  const skipped=draft.bank.items.length-bank.items.length;
  modal('Pachet valid pentru Study',el('div',{class:'studio-validate'},`${check.pack.cases.length} cazuri · ${check.pack.diagnoses.length} diagnostice · ${bank.items.length} grile\n${check.pack.cases.reduce((n,c)=>n+c.annotations.length,0)} repere vizuale\n${skipped} grile în starea schiță nu vor fi exportate.\n\nImaginile și referințele au fost verificate. Exportul nu include progresul niciunui student.`),[
    button('Înapoi',()=>document.getElementById('modal').close(),'button secondary'),button('Descarcă ZIP',act(async()=>{
      status('Se exportă…');const result=await archiveJob('write',{files});const url=URL.createObjectURL(result.blob),a=el('a',{href:url,download:`${pack.id}-${pack.revision}.study.zip`});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);document.getElementById('modal').close();status('Salvat local');toast('Exportul pachetului a fost pornit.');
    })),
  ]);
}

async function boot(){
  requireThat(globalThis.indexedDB,'Deschide Studio într-un browser obișnuit, cu stocare locală disponibilă.');
  const request=indexedDB.open('radia-studio-v1',1);request.onupgradeneeded=()=>{request.result.createObjectStore('drafts',{keyPath:'id'});request.result.createObjectStore('meta');};db=await req(request);db.onversionchange=()=>db.close();
  const records=await req(db.transaction('drafts').objectStore('drafts').getAll());drafts=records.map(row=>({id:row.id,title:row.pack.title}));const id=await req(db.transaction('meta').objectStore('meta').get('activeId'));
  const saved=records.find(row=>row.id===id);if(saved){draft={pack:saved.pack,bank:saved.bank,files:new Map(saved.files.map(f=>[f.path,f.blob]))};caseId=draft.pack.cases[0]?.id || null;activeImageId=null;}
  render();
  if('serviceWorker' in navigator && isSecureContext){
    navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).then(worker=>{
      registration=worker;
      worker.addEventListener('updatefound',()=>{const incoming=worker.installing;incoming?.addEventListener('statechange',()=>{if(incoming.state==='installed' && navigator.serviceWorker.controller){refreshUpdateControls();if(!draft)render();}});});
      navigator.serviceWorker.ready.then(()=>worker.update().catch(()=>{})).catch(()=>{});
    }).catch(()=>{});
  }
}
document.getElementById('open-pack').addEventListener('change',act(async event=>{const file=event.target.files[0];event.target.value='';if(file)await importDraft(file);}));
document.getElementById('add-image').addEventListener('change',act(async event=>{const file=event.target.files[0];event.target.value='';if(file)await addImage(file);}));
document.getElementById('add-case-image').addEventListener('change',act(async event=>{const file=event.target.files[0];event.target.value='';const role=pendingUpload;pendingUpload='case';if(file)await addCaseImage(file,role==='comparison'?'comparison':'primary');}));
document.getElementById('notice').classList.add('studio-toast');
boot().catch(error=>{document.getElementById('studio').replaceChildren(el('main',{class:'studio-empty'},el('h1',{},'Studio nu poate deschide stocarea.'),el('p',{},error.message),button('Încearcă din nou',()=>location.reload())));});
