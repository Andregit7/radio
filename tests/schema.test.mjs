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
test('unsafe paths, unresolved diagnoses, duplicate IDs and excessive pixels fail',()=>{
  for(const modify of [p=>p.cases[0].images[0].path='images/../../evil.png',p=>p.cases[0].images[0].path='https://evil/image.png',p=>p.cases[0].diagnosisIds=['missing'],p=>p.cases.push(structuredClone(p.cases[0])),p=>p.cases[0].images[0].width=10000000]){const p=pack();modify(p);assert.throws(()=>validatePack(p));}
});
test('annotations accept data geometry and require item/image references',()=>{
  const p=pack();p.cases[0].annotations=[{id:'a1',imageId:'primary',itemId:'finding-1',shape:'ellipse',cx:.4,cy:.4,rx:.1,ry:.1}];assert.equal(validatePack(p).pack.cases[0].annotations.length,1);
  p.cases[0].annotations[0].itemId='missing';assert.throws(()=>validatePack(p));
  p.cases[0].annotations[0].itemId='finding-1';p.cases[0].annotations[0].cx=Infinity;assert.throws(()=>validatePack(p));
});
test('question banks must match a revision and contain resolvable correct IDs',()=>{
  const p=validatePack(pack()).pack,q={format:'radiology-question-bank',version:1,packId:p.id,revision:p.revision,items:[{id:'q1',caseId:'p001',sectionId:'diagnosis',kind:'mcq',prompt:'Question?',options:[{id:'a',label:'A'},{id:'b',label:'B'}],correctOptionIds:['a'],reviewStatus:'source-derived'}]};
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
