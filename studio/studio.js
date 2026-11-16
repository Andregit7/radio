import {el,button,icon,badge,toast,modal} from './lib/dom.js';
import {SECTION_LABELS,normalise,shuffled} from './lib/core.js';
import {LIMITS,validatePack,validateQuestions,validateFiles,imageDimensions,requireThat} from './lib/schema.js';
import {archiveJob} from './lib/archive.js';

let db,drafts=[],draft=null,caseId=null,tab='case',imageURL=null,drawItemId=null,saveTimer,saveGeneration=0,undoSnapshot=null;
const uid=prefix=>prefix+'-'+crypto.randomUUID();
const act=fn=>async event=>{try{await fn(event);}catch(error){toast(error.message || 'Operația nu a putut fi finalizată.',true);}};
const currentCase=()=>draft?.pack.cases.find(item=>item.id===caseId);
const req=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
function txDone(tx){return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error || new Error('Salvarea a eșuat.'));tx.onerror=()=>{};});}
function status(message){const node=document.getElementById('save-status');if(node)node.textContent=message;}
function changed(){saveGeneration++;status('Se salvează…');clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveNow().catch(error=>{status('Nesalvat');toast(error.message,true);}),450);}
function remember(){if(draft)undoSnapshot={pack:structuredClone(draft.pack),bank:structuredClone(draft.bank)};}
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
      draft?button([icon('download',15),'Validează & exportă'],act(exportDraft)):null));
  const root=document.getElementById('studio');
  if(!draft){root.replaceChildren(head,el('main',{class:'studio-empty'},badge('APLICAȚIE PENTRU CONTRIBUTORI','green'),el('h1',{},'Explicații care arată unde să privești.'),el('p',{},'Organizează radiografiile, leagă observațiile de imagine și pregătește exerciții. Totul se lucrează local; colegii primesc un singur pachet ZIP.'),el('div',{class:'button-row'},button('Creează primul pachet',act(newPack)),button('Deschide un pachet existent',()=>document.getElementById('open-pack').click(),'button secondary'))));return;}
  const select=el('select',{class:'select','aria-label':'Proiect de pachet',onchange:act(event=>openDraft(event.target.value))},...drafts.map(row=>el('option',{value:row.id,selected:row.id===draft.pack.id},row.title)));
  const side=el('aside',{class:'studio-sidebar'},select,button([icon('plus',14),'Adaugă radiografie'],()=>document.getElementById('add-image').click(),'button secondary'),
    el('div',{class:'studio-case-list'},...draft.pack.cases.map(item=>button([el('span',{},item.title),el('small',{},draft.pack.curriculum.chapters.find(c=>c.id===item.chapterId)?.label || '')],()=>{caseId=item.id;drawItemId=null;tab='case';render();},`studio-case ${caseId===item.id?'active':''}`))));
  const work=el('main',{class:'studio-workspace'},el('nav',{class:'studio-tabs','aria-label':'Secțiuni Studio'},...[["case","Caz & repere"],["catalogue","Diagnostice"],["curriculum","Programă"],["questions","Grile"]].map(([id,label])=>button(label,()=>{tab=id;render();},`chip ${tab===id?'active':''}`))),
    undoSnapshot?button('Anulează ultima editare',act(async()=>{const old=undoSnapshot;undoSnapshot=null;draft.pack=old.pack;draft.bank=old.bank;changed();await saveNow();render();}),'button ghost'):null);
  if(tab==='case')renderCaseEditor(work);else if(tab==='catalogue')renderCatalogue(work);else if(tab==='curriculum')renderCurriculum(work);else renderQuestions(work);
  root.replaceChildren(head,el('div',{class:'studio-layout'},side,work));
}

function renderCaseEditor(work){
  const item=currentCase();if(!item){work.append(el('div',{class:'studio-empty'},el('h1',{},'Începe cu o radiografie.'),el('p',{},'Alege o imagine PNG sau JPEG. Nu se cere acces la un director; citești doar fișierul ales.'),button('Alege imaginea',()=>document.getElementById('add-image').click())));return;}
  work.append(el('div',{class:'studio-title'},el('h1',{},item.title),badge('SCHIȚĂ LOCALĂ')));
  const image=item.images[0],blob=draft.files.get(image.path),picture=el('img',{alt:item.title});
  if(blob){imageURL=URL.createObjectURL(blob);picture.src=imageURL;}
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 1000 1000');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('aria-label','Desenează o elipsă pe imagine');
  const overlays=el('div',{class:'studio-overlay'}),hint=el('p',{class:'studio-image-hint'},'Alege observația cu butonul „Leagă”, apoi trage pe imagine pentru a desena o elipsă. Coordonatele rămân corecte la redimensionare.');
  function draw(){
    svg.replaceChildren();overlays.replaceChildren(el('strong',{},`${item.annotations.length} repere`));
    for(const region of item.annotations.filter(r=>r.imageId===image.id)){
      if(region.shape==='ellipse'){const ellipse=document.createElementNS(svg.namespaceURI,'ellipse');for(const k of ['cx','cy','rx','ry'])ellipse.setAttribute(k,region[k]*1000);svg.append(ellipse);}
      const point=item.sections.flatMap(s=>s.items).find(p=>p.id===region.itemId);
      const reviewed=el('input',{type:'checkbox',checked:region.reviewStatus==='reviewed',onchange:()=>{region.reviewStatus=reviewed.checked?'reviewed':'draft';changed();}});
      overlays.append(el('div',{},el('span',{},(point?.text || region.itemId).slice(0,65)),button(icon('close',13),()=>{remember();item.annotations=item.annotations.filter(r=>r.id!==region.id);changed();draw();},'icon-button',{'aria-label':'Șterge reperul'})),el('label',{},reviewed,'Reper verificat de contributor'));
    }
  }
  let start=null,preview;
  const point=event=>{const r=svg.getBoundingClientRect();return [Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))];};
  svg.addEventListener('pointerdown',event=>{
    if(!drawItemId){toast('Alege mai întâi observația pe care vrei să o legi de imagine.');return;}
    start=point(event);svg.setPointerCapture(event.pointerId);preview=document.createElementNS(svg.namespaceURI,'ellipse');svg.append(preview);
  });
  svg.addEventListener('pointermove',event=>{if(!start)return;const end=point(event);preview.setAttribute('cx',(start[0]+end[0])*500);preview.setAttribute('cy',(start[1]+end[1])*500);preview.setAttribute('rx',Math.abs(start[0]-end[0])*500);preview.setAttribute('ry',Math.abs(start[1]-end[1])*500);});
  svg.addEventListener('pointerup',event=>{
    if(!start)return;const end=point(event),rx=Math.abs(start[0]-end[0])/2,ry=Math.abs(start[1]-end[1])/2;
    if(rx>.005 && ry>.005){remember();item.annotations.push({id:uid('region'),imageId:image.id,itemId:drawItemId,shape:'ellipse',cx:(start[0]+end[0])/2,cy:(start[1]+end[1])/2,rx,ry,label:String(item.annotations.length+1),reviewStatus:'draft'});changed();}
    start=null;draw();
  });
  svg.addEventListener('pointercancel',()=>{start=null;draw();});
  const imageColumn=el('div',{class:'studio-image-column'},el('div',{class:'studio-image-wrap'},picture,svg),hint,overlays);
  const notes=el('div',{});
  notes.append(el('section',{class:'studio-form-section'},field('Numele cazului',item.title,value=>changeCase(c=>c.title=value,false)),
    selectField('Capitol',draft.pack.curriculum.chapters,item.chapterId,value=>changeCase(c=>c.chapterId=value)),
    selectField('Diagnosticul pozitiv',[{id:'',label:'Nu este precizat / alege un diagnostic'},...draft.pack.diagnoses.map(d=>({id:d.id,label:d.label}))],item.diagnosisIds[0] || '',value=>{
      changeCase(c=>{c.diagnosisIds=value?[value]:[];const section=c.sections.find(s=>s.id==='diagnosis');if(value && !section.items.length)section.items.push({id:uid('point'),text:draft.pack.diagnoses.find(d=>d.id===value).label});});render();
    }),el('p',{class:'studio-note'},'Adaugă sau redenumește diagnosticele din fila „Diagnostice”. Cazurile fără diagnostic pot fi studiate, fără întrebare automată de diagnostic.')));
  for(const [sectionId,label] of Object.entries(SECTION_LABELS)){
    let section=item.sections.find(s=>s.id===sectionId);if(!section){section={id:sectionId,label,items:[],status:'missing'};item.sections.push(section);}
    const group=el('section',{class:'studio-form-section'},el('h2',{},label));
    for(const entry of section.items){
      const input=el('textarea',{value:entry.text,'aria-label':label,oninput:event=>changeCase(()=>{entry.text=event.target.value;})});
      const attach=button('Leagă',()=>{drawItemId=entry.id;hint.textContent=`Desenezi pentru: ${entry.text.slice(0,140)}`;work.querySelectorAll('[data-link-item]').forEach(b=>b.classList.toggle('active',b.getAttribute('data-link-item')===entry.id));},`chip ${drawItemId===entry.id?'active':''}`,{'data-link-item':entry.id});
      group.append(el('div',{class:'studio-item'},input,el('div',{class:'studio-item-tools'},attach,button(icon('close',13),()=>{changeCase(c=>{section.items=section.items.filter(p=>p.id!==entry.id);c.annotations=c.annotations.filter(r=>r.itemId!==entry.id);});if(drawItemId===entry.id)drawItemId=null;render();},'icon-button',{'aria-label':'Șterge observația'}))));
    }
    group.append(button([icon('plus',13),'Adaugă observație'],()=>{changeCase(()=>section.items.push({id:uid('point'),text:''}));render();},'button ghost'));notes.append(group);
  }
  if(item.referenceText)notes.append(el('details',{class:'studio-source'},el('summary',{},'Transcrierea sursă păstrată'),item.referenceText));
  work.append(el('div',{class:'studio-editor-grid'},imageColumn,notes));draw();
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
  const item=currentCase();work.append(el('div',{class:'studio-title'},el('h1',{},'Grile pentru caz')));
  if(!item){work.append(el('p',{},'Adaugă sau selectează mai întâi un caz.'));return;}
  work.append(el('div',{class:'studio-banner'},'Întrebarea de diagnostic cu selecție din catalog este creată automat în Study. Grilele de aici sunt opționale. Modificarea explicațiilor unui caz readuce grilele lui în starea „schiță”.'));
  const questions=draft.bank.items.filter(q=>q.caseId===caseId);
  work.append(button('Adaugă o grilă',()=>{
    remember();const id=uid('question');draft.bank.items.push({id,caseId,sectionId:'diagnosis',kind:'mcq',prompt:'Care este diagnosticul pozitiv?',options:['a','b','c','d'].map(id=>({id,label:'',feedback:''})),correctOptionIds:['a'],feedback:'',reviewStatus:'draft'});changed();render();
  },'button secondary'));
  if(item.diagnosisIds.length)work.append(button('Propune o grilă de diagnostic',()=>{
    const correct=draft.pack.diagnoses.find(d=>d.id===item.diagnosisIds[0]),others=shuffled(draft.pack.diagnoses.filter(d=>d.id!==correct.id && d.chapterIds.includes(item.chapterId))).slice(0,3);
    if(!others.length){toast('Adaugă mai întâi alte diagnostice din capitol.',true);return;}
    remember();draft.bank.items.push({id:uid('question'),caseId,sectionId:'diagnosis',kind:'mcq',prompt:'Care este diagnosticul pozitiv?',options:[correct,...others].map(d=>({id:d.id,label:d.label,feedback:''})),correctOptionIds:[correct.id],feedback:item.sections.find(s=>s.id==='diagnosis')?.items.map(p=>p.text).join('\n') || '',reviewStatus:'draft'});changed();render();
  },'button ghost'));
  for(const q of questions){
    let reviewed;const touch=fn=>{fn();q.reviewStatus='draft';if(reviewed)reviewed.checked=false;changed();};
    const card=el('section',{class:'studio-question'},selectField('Secțiunea evaluată',Object.entries(SECTION_LABELS).map(([id,label])=>({id,label})),q.sectionId,value=>touch(()=>q.sectionId=value)),field('Întrebarea',q.prompt,value=>touch(()=>q.prompt=value),{textarea:true}));
    const options=el('div',{class:'studio-options'});
    for(const option of q.options){
      const radio=el('input',{type:'radio',name:q.id,checked:q.correctOptionIds.includes(option.id),'aria-label':'Marchează această opțiune drept corectă',onchange:()=>touch(()=>q.correctOptionIds=[option.id])});
      options.append(el('div',{class:'studio-option'},radio,el('input',{type:'text',value:option.label,'aria-label':'Textul opțiunii',oninput:event=>touch(()=>option.label=event.target.value)})));
      options.append(field('Explicația opțiunii (opțional)',option.feedback || '',value=>touch(()=>option.feedback=value)));
    }
    reviewed=el('input',{type:'checkbox',checked:q.reviewStatus!=='draft',onchange:act(async()=>{
      if(reviewed.checked){try{validateQuestions({...draft.bank,revision:draft.pack.revision,items:[q]},validatePack(draft.pack).pack);q.reviewStatus='reviewed';}catch(error){reviewed.checked=false;throw error;}}else q.reviewStatus='draft';changed();
    })});
    card.append(options,field('Explicația răspunsului',q.feedback,value=>touch(()=>q.feedback=value),{textarea:true}),el('label',{class:'studio-checks'},reviewed,'Am verificat enunțul, cheia și toate alternativele pentru acest caz.'),el('p',{class:'studio-note'},'Schițele nu sunt incluse în export. Alternativele propuse sunt doar un punct de plecare; verifică să existe un singur răspuns optim.'),button('Elimină grila',()=>{remember();draft.bank.items=draft.bank.items.filter(row=>row.id!==q.id);changed();render();},'button ghost'));work.append(card);
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

async function importDraft(file){
  requireThat(file.size<=LIMITS.archive,'Pachetul depășește 32 MiB.');if(draft)await saveNow();
  status('Se verifică arhiva…');const {files}=await archiveJob('read',{file}),prepared=await validateFiles(files);
  const use=async()=>{draft={pack:prepared.pack,bank:prepared.bank || {format:'radiology-question-bank',version:1,packId:prepared.pack.id,revision:prepared.pack.revision,items:[]},files:new Map(prepared.blobs.map(f=>[f.path,f.blob]))};caseId=draft.pack.cases[0].id;tab='case';drawItemId=null;await saveNow();render();toast('Pachet deschis în Studio.');};
  if(drafts.some(row=>row.id===prepared.pack.id))modal('Înlocuiești proiectul local?',el('p',{class:'modal-body'},'Există deja o schiță cu același identificator. Exportă schița curentă înainte, dacă vrei să păstrezi ambele versiuni.'),[button('Renunță',()=>document.getElementById('modal').close(),'button secondary'),button('Înlocuiește',act(async()=>{document.getElementById('modal').close();await use();}))]);else await use();
}

async function exportDraft(){
  requireThat(draft,'Nu există un pachet deschis.');await saveNow();
  const {pack}=validatePack(draft.pack);
  for(const item of pack.cases){for(const section of item.sections){section.items=section.items.filter(row=>row.text.trim());section.status=section.items.length?'present':'missing';}
    item.completeness=item.sections.every(s=>s.items.length)?'full':item.sections.filter(s=>s.items.length).every(s=>s.id==='diagnosis')?'diagnosis-only':'partial';}
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
  const saved=records.find(row=>row.id===id);if(saved){draft={pack:saved.pack,bank:saved.bank,files:new Map(saved.files.map(f=>[f.path,f.blob]))};caseId=draft.pack.cases[0]?.id || null;}
  render();if('serviceWorker' in navigator && isSecureContext)navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).catch(()=>{});
}
document.getElementById('open-pack').addEventListener('change',act(async event=>{const file=event.target.files[0];event.target.value='';if(file)await importDraft(file);}));
document.getElementById('add-image').addEventListener('change',act(async event=>{const file=event.target.files[0];event.target.value='';if(file)await addImage(file);}));
document.getElementById('notice').classList.add('studio-toast');
boot().catch(error=>{document.getElementById('studio').replaceChildren(el('main',{class:'studio-empty'},el('h1',{},'Studio nu poate deschide stocarea.'),el('p',{},error.message),button('Încearcă din nou',()=>location.reload())));});
