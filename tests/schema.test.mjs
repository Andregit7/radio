import test from 'node:test';
import assert from 'node:assert/strict';
import {parseJSON,validatePack,validateQuestions,imageDimensions,validateFiles} from '../dist/js/schema.js';
import {validateLearning} from '../dist/js/storage.js';
import {readFile} from 'node:fs/promises';
const pack=()=>({format:'radiology-study-pack',version:1,id:'test.pack',revision:'1',title:'Test',curriculum:{id:'course',title:'Course',chapters:[{id:'respiratory',label:'Respirator'}]},diagnoses:[{id:'diagnosis',label:'Diagnostic',chapterIds:['respiratory'],aliases:[]}],cases:[{id:'p001',title:'Cazul 01',chapterId:'respiratory',diagnosisIds:['diagnosis'],images:[{id:'primary',path:'images/test.png',width:8,height:8}],sections:[{id:'findings',label:'Semiologie',items:[{id:'finding-1',text:'Text din notițe'}]}],annotations:[]}]});
test('prototype keys and oversized JSON are rejected',()=>{
  assert.throws(()=>parseJSON('{"__proto__":{"polluted":true}}'));
  assert.throws(()=>parseJSON('{"constructor":{}}'));assert.throws(()=>parseJSON('"123456"',3));assert.equal({}.polluted,undefined);
});
test('pack validation strips unknown properties and allows study-only cases',()=>{
  const p=pack();p.execute='evil()';p.cases[0].diagnosisIds=[];const clean=validatePack(p).pack;
  assert.equal(clean.execute,undefined);assert.deepEqual(clean.cases[0].diagnosisIds,[]);assert.equal(clean.curriculum.scopes[0].id,'all');
});
test('diagnosis keywords are canonical and legacy aliases migrate on import',()=>{
  for(const version of [1,2]){
    const raw=pack();raw.version=version;raw.diagnoses[0].aliases=['termen vechi'];
    const migrated=validatePack(raw).pack;
    assert.deepEqual(migrated.diagnoses,[{id:'diagnosis',label:'Diagnostic',chapterIds:['respiratory'],keywords:['termen vechi']}]);
    assert.deepEqual(validatePack(migrated).pack,migrated);
    raw.diagnoses[0].keywords=['os'];
    assert.deepEqual(validatePack(raw).pack.diagnoses[0].keywords,['os']);
    raw.diagnoses[0].keywords=[];
    assert.deepEqual(validatePack(raw).pack.diagnoses[0].keywords,[]);
    raw.diagnoses[0].keywords='os';
    assert.throws(()=>validatePack(raw),/Cuvinte-cheie invalide/);
  }
});
test('unsafe paths, unresolved diagnoses, duplicate IDs and excessive pixels fail',()=>{
  for(const modify of [p=>p.cases[0].images[0].path='images/../../evil.png',p=>p.cases[0].images[0].path='https://evil/image.png',p=>p.cases[0].diagnosisIds=['missing'],p=>p.cases.push(structuredClone(p.cases[0])),p=>p.cases[0].images[0].width=10000000]){const p=pack();modify(p);assert.throws(()=>validatePack(p));}
});
test('annotations accept data geometry and require item/image references',()=>{
  const p=pack();p.cases[0].annotations=[{id:'a1',imageId:'primary',itemId:'finding-1',shape:'ellipse',cx:.4,cy:.4,rx:.1,ry:.1}];assert.equal(validatePack(p).pack.cases[0].annotations.length,1);
  p.cases[0].annotations[0].itemId='missing';assert.throws(()=>validatePack(p));
  p.cases[0].annotations[0].itemId='finding-1';p.cases[0].annotations[0].cx=Infinity;assert.throws(()=>validatePack(p));
});
test('question banks must match a revision and contain resolvable correct IDs',()=>{
  const p=validatePack(pack()).pack,q={format:'radiology-question-bank',version:1,packId:p.id,revision:p.revision,items:[{id:'q1',caseId:'p001',sectionId:'diagnosis',kind:'mcq',prompt:'Question?',options:[{id:'a',label:'A'},{id:'b',label:'B'}],correctOptionIds:['a']}]};
  assert.equal(validateQuestions(q,p).items.length,1);q.revision='2';assert.throws(()=>validateQuestions(q,p));q.revision='1';q.items[0].correctOptionIds=['missing'];assert.throws(()=>validateQuestions(q,p));
});
test('PNG signatures and dimensions are checked before storage',async()=>{
  const image=new Uint8Array(await readFile(new URL('./fixtures/test.png',import.meta.url)));assert.deepEqual(imageDimensions(image),{width:8,height:8,mime:'image/png'});
  assert.throws(()=>imageDimensions(new TextEncoder().encode('<svg onload="evil()"/>')));
  const files=new Map([['pack.json',new TextEncoder().encode(JSON.stringify(pack()))],['images/test.png',image]]);
  assert.equal((await validateFiles(files)).blobs.length,1);
  files.set('execute.js',new TextEncoder().encode('evil()'));await assert.rejects(()=>validateFiles(files));
});
test('image hashes detect changed assets and wrong declared geometry',async()=>{
  const image=new Uint8Array(await readFile(new URL('./fixtures/test.png',import.meta.url))),p=pack();p.cases[0].images[0].sha256='0'.repeat(64);
  const files=new Map([['pack.json',new TextEncoder().encode(JSON.stringify(p))],['images/test.png',image]]);await assert.rejects(()=>validateFiles(files),/corupt/);
  delete p.cases[0].images[0].sha256;p.cases[0].images[0].width=9;files.set('pack.json',new TextEncoder().encode(JSON.stringify(p)));await assert.rejects(()=>validateFiles(files),/Dimensiuni/);
});
test('learning backups reject invalid counters and untrusted keys',()=>{
  const backup={format:'radiology-learning-backup',version:1,createdAt:1,packs:[],progress:{},bookmarks:[],visited:[]};assert.deepEqual(validateLearning(backup).progress,{});
  backup.progress={bad:{}};assert.throws(()=>validateLearning(backup));
  backup.progress={'pack|q|catalogue':{attempts:1,correct:2,streak:0,lapses:0,intervalDays:0,dueAt:1,lastAt:1,lastCorrect:false,signature:'x'}};assert.throws(()=>validateLearning(backup));
});

const v2pack=()=>({format:'radiology-study-pack',version:2,id:'test.v2',revision:'2',title:'Test v2',
  curriculum:{id:'course',title:'Course',chapters:[{id:'respiratory',label:'Respirator'}],chapterBanks:[{chapterId:'respiratory',sections:{
    examination:{options:[{id:'rx',label:'Rx torace'},{id:'ct',label:'CT'}]},
    projection:{options:[{id:'pa',label:'PA'},{id:'ap',label:'AP'}]},
    differentials:{options:[{id:'diff',label:'Diferențial'}]},
    investigations:{options:[{id:'explore',label:'CT'}]},
    findings:{types:[{id:'opacity',label:'Opacitate',fields:[
      {id:'topography',label:'Topografie',kind:'single',options:[{id:'left',label:'Stânga'},{id:'right',label:'Dreapta'}]},
      {id:'size',label:'Mărime',kind:'measurementMm'},
    ]}]}
  }}]},
  diagnoses:[{id:'d1',label:'Pneumonie',chapterIds:['respiratory'],aliases:[]},{id:'d2',label:'Atelectazie',chapterIds:['respiratory'],aliases:[]}],
  cases:[
    {id:'p1',title:'Caz 1',chapterId:'respiratory',diagnosisIds:['d1'],images:[
      {id:'primary',role:'primary',path:'images/p1.png',width:8,height:8},
      {id:'normal',role:'comparison',path:'images/p2.png',width:8,height:8},
    ],sections:[{id:'findings',label:'Semiologie',items:[{id:'f1',text:'Opacitate'}]},{id:'differentials',label:'Diferențial',items:[{id:'diff-1',text:'Atelectazie',targetCaseId:'p2'}]}],
      annotations:[{id:'a1',imageId:'primary',itemId:'f1',shape:'polyline',points:[[.1,.1],[.2,.2]],style:{color:'#ff0000'}},
        {id:'a2',imageId:'primary',itemId:'f1',shape:'ellipse',cx:.5,cy:.5,rx:.1,ry:.1,style:{pattern:'dots'}}],
      comparisons:[{id:'cmp',label:'Normal',caseId:'p2',imageId:'primary'}],
      structured:{status:'source-derived',choices:{examination:['rx'],projection:['pa'],differentials:['diff'],investigations:[]},observations:[{itemId:'f1',typeId:'opacity',values:{topography:['left'],size:12.3},note:'Notă de studiu'}]}},
    {id:'p2',title:'Caz 2',chapterId:'respiratory',diagnosisIds:['d2'],images:[{id:'primary',role:'primary',path:'images/p2.png',width:8,height:8}],sections:[],annotations:[],comparisons:[]},
  ]});

test('pack v2 preserves typed findings, mark styles, comparison layers and linked differentials',()=>{
  const clean=validatePack(v2pack()).pack;
  assert.equal(clean.version,2);
  assert.equal(clean.cases[0].annotations[0].shape,'polyline');
  assert.deepEqual(clean.cases[0].annotations[0].style,{pattern:'none',color:'#ff0000'});
  assert.deepEqual(clean.cases[0].annotations[1].style,{pattern:'dots'});
  assert.equal(clean.cases[0].comparisons[0].caseId,'p2');
  assert.equal(clean.cases[0].sections[1].items[0].targetCaseId,'p2');
  assert.equal(clean.cases[0].structured.observations[0].values.size,12.3);
  assert.equal(clean.curriculum.chapterBanks.length,1);
});

test('v1 rejects v2 features instead of silently stripping them',()=>{
  const styled=v2pack();styled.version=1;assert.throws(()=>validatePack(styled),/versiunea 2/);
  const structured=structuredClone(v2pack());structured.version=1;delete structured.cases[0].annotations;
  assert.throws(()=>validatePack(structured),/versiunea 2/);
  const comparison=structuredClone(v2pack());comparison.version=1;delete comparison.cases[0].structured;delete comparison.cases[0].annotations;
  assert.throws(()=>validatePack(comparison),/versiunea 2/);
});

test('v2 rejects dangling comparison targets, invalid fills and cross-chapter diagnosis',()=>{
  const bad=structuredClone(v2pack());bad.cases[0].comparisons[0].imageId='missing';assert.throws(()=>validatePack(bad));
  const arrow=structuredClone(v2pack());arrow.cases[0].annotations[0]={id:'a1',imageId:'primary',itemId:'f1',shape:'arrow',x1:.1,y1:.1,x2:.2,y2:.2,style:{pattern:'dots'}};assert.throws(()=>validatePack(arrow),/închise/);
  const cross=structuredClone(v2pack());cross.diagnoses[0].chapterIds=['other'];
  cross.curriculum.chapters.push({id:'other',label:'Altul'});
  assert.throws(()=>validatePack(cross),/aparține capitolului/);
  const unknown=structuredClone(v2pack());unknown.curriculum.chapterBanks[0].sections.findings.types[0].fields[0].options[0].id='renamed';
  assert.throws(()=>validatePack(unknown),/invalide/);
});

test('pack v2 written questions require a rubric and a v2 pack',()=>{
  const pack=validatePack(v2pack()).pack;
  const bank={format:'radiology-question-bank',version:2,packId:pack.id,revision:pack.revision,items:[
    {id:'w1',caseId:'p1',kind:'written',sectionId:'findings',prompt:'Explică.',rubric:'Topografie și mărime.'},
    {id:'m1',caseId:'p1',kind:'mcq',sectionId:'diagnosis',prompt:'Diagnostic?',options:[{id:'a',label:'A'},{id:'b',label:'B'}],correctOptionIds:['a']}]};
  assert.equal(validateQuestions(bank,pack).items[0].kind,'written');
  const missing=structuredClone(bank);missing.items[0].rubric='';assert.throws(()=>validateQuestions(missing,pack));
  const v1={...structuredClone(bank),version:1};assert.throws(()=>validateQuestions(v1,pack));
});

test('learning backups v2 carry structured and written results',()=>{
  const backup={format:'radiology-learning-backup',version:2,createdAt:1,packs:[],progress:{},selfAssessments:{},bookmarks:[],visited:[]};
  backup.progress={'pack|structured:p1|structured':{attempts:1,correct:0,streak:0,lapses:1,intervalDays:0,dueAt:2,lastAt:1,lastCorrect:false,signature:'s',identified:2,total:4,selfAssessed:false}};
  backup.selfAssessments={'pack|w1|written':{attempts:1,correct:1,streak:1,lapses:0,intervalDays:1,dueAt:2,lastAt:1,lastCorrect:true,signature:'w',identified:1,total:1,selfAssessed:true}};
  const clean=validateLearning(backup);assert.equal(clean.progress['pack|structured:p1|structured'].identified,2);assert.equal(clean.selfAssessments['pack|w1|written'].selfAssessed,true);
  backup.version=1;assert.throws(()=>validateLearning(backup),/versiunea 1/);
  backup.version=2;backup.progress['pack|structured:p1|structured'].identified=5;assert.throws(()=>validateLearning(backup));
});

test('learning backups keep self-assessments optional and separate from automatic answers',()=>{
  const backup={format:'radiology-learning-backup',version:1,createdAt:1,packs:[],progress:{},bookmarks:[],visited:[]};
  const first=validateLearning(backup);assert.deepEqual(first.selfAssessments,{});
  backup.progress={'pack|match:p1|matching':{attempts:1,correct:1,streak:1,lapses:0,intervalDays:1,dueAt:2,lastAt:1,lastCorrect:true,signature:'m'}};
  backup.selfAssessments={'pack|interpretation:p1|interpretation':{attempts:1,correct:0,streak:0,lapses:1,intervalDays:0,dueAt:2,lastAt:1,lastCorrect:false,signature:'s',selfAssessed:true,identified:2,total:3,sectionId:'interpretation',chapterId:'respiratory',caseId:'p1'}};
  const clean=validateLearning(backup);assert.equal(clean.progress['pack|match:p1|matching'].attempts,1);assert.equal(clean.selfAssessments['pack|interpretation:p1|interpretation'].identified,2);
  backup.selfAssessments['pack|interpretation:p1|interpretation'].identified=4;assert.throws(()=>validateLearning(backup));
  backup.selfAssessments['pack|bad|matching']=backup.selfAssessments['pack|interpretation:p1|interpretation'];delete backup.selfAssessments['pack|interpretation:p1|interpretation'];backup.selfAssessments['pack|bad|matching'].identified=2;assert.throws(()=>validateLearning(backup));
});
