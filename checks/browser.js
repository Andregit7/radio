import {openDatabase,installPacks,listPacks,assetBlob,getMeta,setMeta,mergeLearning,validateLearning,learningSnapshot} from '../js/storage.js';
import {validateFiles} from '../js/schema.js';
import {archiveJob} from '../js/archive.js';
import {imageViewer} from '../js/viewer.js';
import {catalogueSelector} from '../js/catalogue.js';
import {scheduleReview,questionSignature,progressKey} from '../js/core.js';
import {interpretationExercise,regionsExercise,matchingExercise,gradeMatching,selfAssessmentItems} from '../js/exercises.js';
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
    await check('Catalog: diacritice, grupuri și confirmare explicită',async()=>{
      const selector=catalogueSelector(prepared.pack);fixture.append(selector);const input=selector.querySelector('input[type=search]');input.value='endobronsic';input.dispatchEvent(new Event('input',{bubbles:true}));
      assert(selector.querySelectorAll('.catalogue-group').length===1,'Capitol nerelevant afișat');assert(selector.querySelectorAll('.diagnosis-option').length===1,'Filtru incorect');assert(!selector.querySelector('.diagnosis-option input').checked,'Răspuns selectat automat');selector.remove();
    });
    await check('Repere: coordonate relative și ascundere în teste',async()=>{
      const viewer=imageViewer(original,prepared.pack.cases[0]);fixture.append(viewer.node);const ellipse=viewer.node.querySelector('ellipse');assert(ellipse.getAttribute('cx')==='400','Coordonate greșite');viewer.selectItem('f1');assert(!ellipse.parentNode.classList.contains('annotation-hidden'),'Reper ascuns');viewer.destroy();viewer.node.remove();
      const exam=imageViewer(original,prepared.pack.cases[0],{allowAnnotations:false});assert(exam.node.querySelectorAll('.annotation').length===0,'Indicii vizibile în test');exam.destroy();
    });
    await check('Interpretare: secțiuni prezente și diagnostic canonic fără alias',async()=>{
      const c={id:'px',title:'Caz interpretare',chapterId:'respiratory',diagnosisIds:['endo'],source:{page:1},images:[{id:'primary',path:'images/test.png',width:8,height:8}],
        sections:[{id:'examination',items:[{id:'e1',text:'Rx torace'}]},{id:'findings',items:[{id:'f1',text:'Opacitate'},{id:'f2',text:'Distrucție'},{id:'f3',text:'Retracție'}]},{id:'diagnosis',items:[{id:'d1',text:'endobronșic - alias'}]},{id:'differentials',items:[]}],
        annotations:[{id:'a1',imageId:'primary',itemId:'f1',shape:'ellipse',cx:.4,cy:.5,rx:.1,ry:.2,reviewStatus:'reviewed'},{id:'a2',imageId:'primary',itemId:'f2',shape:'ellipse',cx:.5,cy:.5,rx:.1,ry:.2,reviewStatus:'reviewed'},{id:'a3',imageId:'primary',itemId:'f3',shape:'ellipse',cx:.6,cy:.5,rx:.1,ry:.2,reviewStatus:'reviewed'},{id:'a4',imageId:'primary',itemId:'f1',shape:'ellipse',cx:.7,cy:.5,rx:.1,ry:.2,reviewStatus:'draft'}]};
      const ex=interpretationExercise(c);assert(ex,'Exercițiul de interpretare lipsește');assert(same(ex.sections.map(s=>s.id),['examination','findings','diagnosis']),'Secțiuni goale evaluate');
      const items=selfAssessmentItems({pack:{cases:[c],diagnoses:[{id:'endo',label:'Cancer endobronșic',aliases:['alias']}]}},ex);
      assert(items.some(i=>i.id==='diagnosis:endo'&&i.text==='Cancer endobronșic'),'Diagnostic canonic lipsă');assert(!items.some(i=>i.text.includes('alias')),'Alias expus');
      const regions=regionsExercise(c);assert(regions?.regions.length===3,'Repere verificate lipsă');
      const viewer=imageViewer(original,c,{exercise:regions});fixture.append(viewer.node);
      assert(viewer.node.querySelectorAll('.annotation').length===3,'Reper draft expus');
      assert(viewer.node.querySelector('.annotation').getAttribute('aria-label')==='Regiunea 1','Etichetă care expune răspunsul');
      assert(!viewer.node.textContent.includes('Opacitate'),'Textul observației apare în exercițiu');viewer.destroy();viewer.node.remove();
      const match=matchingExercise(c,()=>.5);assert(match?.pairs.length===3,'Potrivire incompletă');assert(gradeMatching(match.correctMapping,match.correctMapping),'Cheia potrivirii nu se notează');
    });
    await check('Înlocuirea reușită curăță imaginile versiunii precedente',async()=>{await installPacks([prepared]);const after=(await listPacks())[0];assert(after.token!==original.token,'Versiune neschimbată');assert(!await assetBlob(original,'images/test.png'),'Imagini orfane');});
    output.textContent+=`\n${passed} verificări trecute.\nInstalarea PWA și pornirea în mod avion necesită verificare manuală pe fiecare platformă.`;
  }catch(error){output.textContent+=`\n✗ ${error.message}\n`;}
  finally{if(db){db.close();indexedDB.deleteDatabase(name);}run.disabled=false;fixture.replaceChildren();}
});
