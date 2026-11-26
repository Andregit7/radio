import {openDatabase,installPacks,listPacks,assetBlob,getMeta,setMeta,mergeLearning,validateLearning,learningSnapshot} from '../js/storage.js';
import {validateFiles} from '../js/schema.js';
import {archiveJob} from '../js/archive.js';
import {imageViewer} from '../js/viewer.js';
import {caseComparisonLayers} from '../js/case-interpretation.js';
import {scheduleReview,questionSignature,progressKey} from '../js/core.js';
import {availableExercises,interpretationExercise,selfAssessmentItems,recordSelfAssessment,assessmentMean} from '../js/exercises.js';
const output=document.getElementById('results'),run=document.getElementById('run'),fixture=document.getElementById('fixture');
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const encode=value=>new TextEncoder().encode(JSON.stringify(value));
run.addEventListener('click',async()=>{
  run.disabled=true;output.textContent='';let db,name;let passed=0;
  async function check(label,fn){await fn();passed++;output.textContent+=`✓ ${label}\n`;}
  try{
    name='radioeasy-checks-'+crypto.randomUUID();db=await openDatabase(name);
    const bytes=new Uint8Array(await (await fetch('./checks/test.png')).arrayBuffer());
    const pack={format:'radiology-study-pack',version:1,id:'check.pack',revision:'1',title:'Test izolat',curriculum:{id:'check',title:'Test',chapters:[{id:'respiratory',label:'Respirator'},{id:'renal',label:'Renal'}]},diagnoses:[{id:'endo',label:'Cancer bronhopulmonar endobronșic',chapterIds:['respiratory'],aliases:[]},{id:'exo',label:'Cancer bronhopulmonar exobronșic',chapterIds:['respiratory'],aliases:[]},{id:'renal',label:'Rinichi în potcoavă',chapterIds:['renal'],aliases:[]}],cases:[{id:'c1',title:'Caz test',chapterId:'respiratory',diagnosisIds:['endo'],images:[{id:'primary',path:'images/test.png',width:8,height:8}],sections:[{id:'findings',label:'Semiologie',items:[{id:'f1',text:'Reper test'}]}],annotations:[{id:'a1',imageId:'primary',itemId:'f1',shape:'ellipse',cx:.4,cy:.5,rx:.1,ry:.2}]}]};
    const prepared=await validateFiles(new Map([['pack.json',encode(pack)],['images/test.png',bytes]]));let original;
    await check('Straturi de comparație: previzualizare, tastatură și repere locale',async()=>{
      const item=structuredClone(prepared.pack.cases[0]);
      item.images.push({id:'local',path:'images/local.png',role:'comparison',width:8,height:8});
      item.annotations.push({...item.annotations[0],id:'a2',imageId:'local',style:{color:'#ffaa00',width:5,line:'dash-dot'}});
      item.comparisons=[{id:'local-layer',label:'Comparație locală',caseId:item.id,imageId:'local'},
        {id:'other-layer',label:'Comparație externă',caseId:'other',imageId:'local'}];
      const other={id:'other',images:[{id:'local',path:'images/other.png'}]};
      const loaded=[];
      const viewer=imageViewer(null,item,{initialComparisonId:'other-layer',comparisons:caseComparisonLayers({cases:[item,other]},item),
        loadAsset:path=>{loaded.push(path);return new Blob([bytes],{type:'image/png'});}});
      fixture.append(viewer.node);
      try{
        const stage=viewer.node.querySelector('.image-stage');
        const layers=viewer.node.querySelector('.viewer-layer-switch select');
        assert(layers.value==='2' && loaded.at(-1)==='images/other.png','Stratul inițial nu a fost deschis');
        assert(!stage.querySelector('.annotation'),'Repere expuse pe comparația externă');
        stage.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
        const line=stage.querySelector('[data-annotation-id="a2"] .annotation-stroke');
        assert(layers.value==='1' && line,'Tasta nu a ales stratul cu repere locale');
        assert(getComputedStyle(line).strokeWidth==='5px' && line.hasAttribute('stroke-dasharray'),'Stilul reperului nu este vizibil');
        layers.value='0';layers.dispatchEvent(new Event('change',{bubbles:true}));
        assert(loaded.at(-1)==='images/test.png' && stage.querySelector('[data-annotation-id="a1"]'),'Revenirea la imaginea principală a eșuat');
      }finally{viewer.destroy();viewer.node.remove();}
    });
    await check('IndexedDB: pachet și imagine salvate împreună',async()=>{await installPacks([prepared]);original=(await listPacks())[0];assert((await assetBlob(original,'images/test.png')).size===bytes.length,'Imagine lipsă');});
    await check('Eroarea de scriere anulează întreaga înlocuire',async()=>{
      let rejected=false;try{await installPacks([{...prepared,blobs:[...prepared.blobs,{path:'bad',blob:()=>{}}]}]);}catch{rejected=true;}
      assert(rejected,'Eroarea injectată nu a apărut');const after=(await listPacks())[0];assert(after.token===original.token && await assetBlob(after,'images/test.png'),'Pachetul precedent a fost modificat');
    });
    await check('Backup JSON: restaurarea repetată nu dublează încercările',async()=>{
      const q={kind:'catalogue',sectionId:'diagnosis',prompt:'Diagnostic?',correctOptionIds:['endo']},record={...scheduleReview(null,true,1000),signature:questionSignature(q),sectionId:'diagnosis',chapterId:'respiratory',caseId:'c1'};
      await setMeta('progress',{[progressKey('check.pack','q1')]:record});const snapshot=await learningSnapshot(await listPacks());const restored=await mergeLearning(validateLearning(snapshot));await setMeta('progress',restored.progress);
      assert((await getMeta('progress'))[progressKey('check.pack','q1')].attempts===1,'Încercări duplicate');
    });
    await check('Worker: export și import ZIP cu integritatea imaginii păstrată',async()=>{
      const {blob}=await archiveJob('write',{files:[{name:'pack.json',data:JSON.stringify(pack)},{name:'images/test.png',data:new Blob([bytes])}]});const result=await archiveJob('read',{file:blob});assert((await validateFiles(result.files)).blobs[0].blob.size===bytes.length,'Arhivă coruptă');
    });
    await check('Pachetul publicat păstrează progresul și protejează sesiunile în curs',async()=>{
      const id='course.pack', sha256='a'.repeat(64);
      const install={...prepared,pack:{...prepared.pack,id}};
      const lookup=async()=>(await listPacks()).find(row=>row.id===id);
      await installPacks([install],null,{expectedToken:null,sha256});
      const previous=await lookup();
      const next={...install,pack:{...install.pack,revision:'2'}};
      const upgrade=expectedToken=>installPacks([next],null,{expectedToken,sha256:'b'.repeat(64)});
      const progress=await getMeta('progress');
      const rejected=operation=>operation.then(()=>false,()=>true);
      assert(previous.hostedSha256===sha256,'Pachetul instalat nu a păstrat originea');
      assert(await rejected(upgrade(null)),'O actualizare concurentă a suprascris pachetul');
      await setMeta('session',{packId:id,finished:false});
      assert(await rejected(upgrade(previous.token)),'Pachetul cu sesiune în curs a fost suprascris');
      assert((await lookup()).token===previous.token && await assetBlob(previous,'images/test.png'),'Respingerea a modificat pachetul anterior');
      await setMeta('session',{packId:id,finished:true});
      await upgrade(previous.token);
      const applied=await lookup();
      assert(applied.pack.revision==='2' && applied.token!==previous.token,'Actualizarea nu a salvat versiunea nouă');
      assert(same(await getMeta('progress'),progress) && !await getMeta('session'),'Actualizarea a pierdut progresul sau a păstrat sesiunea veche');
    });
    await check('Verificare: diagnostic și interpretare completă',async()=>{
      const pools=availableExercises(prepared.pack,{chapterIds:['respiratory']});
      assert(same(Object.keys(pools),['catalogue','interpretation']),'Metode de verificare neașteptate');
      assert(pools.catalogue.length===1 && pools.interpretation.length===1,'Lipsește o metodă de verificare');
      assert(!availableExercises(prepared.pack,{chapterIds:['renal']}).catalogue.length,'Filtrul nu respectă capitolul');
    });
    await check('Repere: coordonate relative și ascundere în teste',async()=>{
      const viewer=imageViewer(original,prepared.pack.cases[0]);fixture.append(viewer.node);
      const ellipse=viewer.node.querySelector('ellipse'),overlay=viewer.node.querySelector('.annotation-layer');
      const toggle=[...viewer.node.querySelectorAll('.viewer-tool')].find(node=>node.textContent==='Repere');
      assert(ellipse.getAttribute('cx')==='400','Coordonate greșite');
      toggle.click();assert(overlay.classList.contains('annotation-hidden'),'Repere vizibile după ascundere');
      viewer.selectItem('f1');assert(!overlay.classList.contains('annotation-hidden'),'Reper ascuns');viewer.destroy();viewer.node.remove();
      const exam=imageViewer(original,prepared.pack.cases[0],{allowAnnotations:false});
      assert(exam.node.querySelectorAll('.annotation').length===0,'Indicii vizibile în test');
      assert([...exam.node.querySelectorAll('.viewer-tool')].some(node=>node.textContent==='Repere' && node.disabled),'Comutatorul fără repere trebuie păstrat și dezactivat');
      exam.destroy();
    });
    await check('Interpretare: o notă per punct și păstrarea valorilor 0–10 în backup',async()=>{
      const c={id:'px',title:'Caz interpretare',chapterId:'respiratory',diagnosisIds:['endo'],source:{page:1},images:[{id:'primary',path:'images/test.png',width:8,height:8}],
        sections:[{id:'examination',items:[{id:'e1',text:'Rx torace'}]},{id:'findings',items:[{id:'f1',text:'Opacitate'},{id:'f2',text:'Distrucție'},{id:'f3',text:'Retracție'},{id:'blank',text:' '}]},{id:'diagnosis',items:[{id:'d1',text:'Cancer endobronșic'}]},{id:'differentials',items:[]}],
        annotations:[{id:'a1',imageId:'primary',itemId:'f1',shape:'ellipse',cx:.4,cy:.5,rx:.1,ry:.2},{id:'a2',imageId:'primary',itemId:'f2',shape:'ellipse',cx:.5,cy:.5,rx:.1,ry:.2},{id:'a3',imageId:'primary',itemId:'f3',shape:'ellipse',cx:.6,cy:.5,rx:.1,ry:.2}]};
      const ex=interpretationExercise(c);assert(ex,'Exercițiul de interpretare lipsește');assert(same(ex.sections.map(s=>s.id),['examination','findings','diagnosis']),'Secțiuni goale evaluate');
      const items=selfAssessmentItems(c);
      assert(items.some(i=>i.id==='d1'&&i.text==='Cancer endobronșic'),'Nota de diagnostic lipsește');
      assert(!items.some(i=>i.id==='blank'),'Nota goală a fost evaluată');
      const scores=items.map((item,index)=>({id:item.id,score:index?10:0}));
      const key=progressKey(original.id,ex.id,ex.kind);
      const progress={...recordSelfAssessment(null,scores,1000),signature:questionSignature(ex)};
      await setMeta('selfAssessments',{[key]:progress});
      const restored=validateLearning(JSON.parse(JSON.stringify(await learningSnapshot([original]))));
      assert(same(restored.selfAssessments[key].scores,scores),'Notele s-au pierdut în backup');
      assert(assessmentMean(restored.selfAssessments[key].scores)===8,'Media notelor este incorectă');
    });
    await check('Repere: marcajul selectat rămâne în prim-plan',async()=>{
      const c=structuredClone(prepared.pack.cases[0]);
      c.annotations.push({...c.annotations[0],id:'a2',cx:.55},{...c.annotations[0],id:'a3',cx:.65});
      const regions={regions:c.annotations.map((annotation,index)=>({annotationId:annotation.id,label:String(index+1)}))};
      const viewer=imageViewer(original,c,{exercise:regions});fixture.append(viewer.node);
      assert(viewer.node.querySelectorAll('.annotation').length===3,'Repere neașteptate');
      assert(viewer.node.querySelector('.annotation').getAttribute('aria-label')==='Regiunea 1','Etichetă care expune răspunsul');
      assert(!viewer.node.textContent.includes('Opacitate'),'Textul observației apare în exercițiu');
      const overlay=viewer.node.querySelector('.annotation-layer');
      const toggle=[...viewer.node.querySelectorAll('.viewer-tool')].find(node=>node.textContent==='Repere');
      viewer.selectAnnotation('a1');
      assert(overlay.lastElementChild.dataset.annotationId==='a1','Reperul selectat trebuie să fie în prim-plan');
      toggle.click();assert(overlay.classList.contains('annotation-hidden'),'Reperele rămân vizibile în exercițiu');
      viewer.selectAnnotation('a2');
      assert(overlay.classList.contains('annotation-hidden'),'Selectarea răspunsului dezvăluie reperele ascunse');
      toggle.click();
      assert(overlay.lastElementChild.dataset.annotationId==='a2' && !overlay.classList.contains('annotation-hidden'),'Reperul selectat nu a fost reafişat');
      viewer.destroy();viewer.node.remove();
    });
    await check('Radiografii: zoom cu rotița și deplasare după mărire',async()=>{
      const viewer=imageViewer(null,prepared.pack.cases[0],{loadAsset:()=>new Blob([bytes],{type:'image/png'})});
      fixture.append(viewer.node);
      try{
        const stage=viewer.node.querySelector('.image-stage'),image=stage.querySelector('.radiograph');
        await new Promise((resolve,reject)=>{
          image.addEventListener('load',resolve,{once:true});
          image.addEventListener('error',reject,{once:true});
        });
        await new Promise(resolve=>requestAnimationFrame(resolve));
        const box=stage.getBoundingClientRect(),x=box.left+box.width/2,y=box.top+box.height/2;
        stage.dispatchEvent(new WheelEvent('wheel',{deltaY:-200,clientX:x,clientY:y,cancelable:true}));
        assert(viewer.node.querySelector('.zoom-label').textContent==='125%','Rotița nu mărește imaginea');
        assert(stage.classList.contains('pannable'),'Radiografia mărită nu este deplasabilă');
        const before=stage.scrollLeft+stage.scrollTop;
        const pointer=(kind,shift)=>stage.dispatchEvent(new PointerEvent(kind,{
          isPrimary:true,pointerId:10,pointerType:'mouse',clientX:x-shift,clientY:y-shift,bubbles:true,cancelable:true,
        }));
        pointer('pointerdown',0);pointer('pointermove',32);pointer('pointerup',32);
        assert(stage.scrollLeft+stage.scrollTop>before,'Tragerea nu deplasează radiografia');
      }finally{viewer.destroy();viewer.node.remove();}
    });
    await check('Înlocuirea reușită curăță imaginile versiunii precedente',async()=>{await installPacks([prepared]);const after=(await listPacks())[0];assert(after.token!==original.token,'Versiune neschimbată');assert(!await assetBlob(original,'images/test.png'),'Imagini orfane');});
    output.textContent+=`\n${passed} verificări trecute.\nInstalarea PWA și pornirea în mod avion necesită verificare manuală pe fiecare platformă.`;
  }catch(error){output.textContent+=`\n✗ ${error.message}\n`;}
  finally{if(db){db.close();indexedDB.deleteDatabase(name);}run.disabled=false;fixture.replaceChildren();}
});
