import test from 'node:test';
import assert from 'node:assert/strict';
import {normalise,searchCatalogue,gradeAnswer,scheduleReview,chooseQuestions,progressKey,questionSignature,matchingProgress,availableQuestions,DAY} from '../dist/js/core.js';
const chapters=[{id:'respiratory',label:'Respirator'},{id:'renal',label:'Renal'}];
const diagnoses=[{id:'endo',label:'Cancer bronhopulmonar endobronșic',chapterIds:['respiratory'],aliases:['CBP endobronsic']},{id:'exo',label:'Cancer bronhopulmonar exobronșic',chapterIds:['respiratory'],aliases:[]},{id:'horse',label:'Rinichi în potcoavă',chapterIds:['renal'],aliases:[]}];
test('Romanian search handles legacy and modern diacritics, punctuation and case',()=>{
  assert.equal(normalise(' ŞȚ-șţ / ÎN  potcoavă '),'st st in potcoava');
  assert.deepEqual(searchCatalogue(diagnoses,chapters,'ENDO cancer')[0].items.map(d=>d.id),['endo']);
  assert.equal(searchCatalogue(diagnoses,chapters,'CBP')[0].items[0].id,'endo');
});
test('search hides only groups without query matches and respects declared curriculum',()=>{
  assert.equal(searchCatalogue(diagnoses,chapters).length,2);
  assert.equal(searchCatalogue(diagnoses,chapters,'cancer').length,1);
  assert.equal(searchCatalogue(diagnoses,chapters,'endobronsic')[0].items[0].label,diagnoses[0].label);
  assert.equal(searchCatalogue(diagnoses,chapters,'potcoava',['respiratory']).length,0);
});
test('grading uses IDs, exact sets, and never option position or free text',()=>{
  assert(gradeAnswer(['endo'],['endo']));assert(!gradeAnswer(['Cancer bronhopulmonar endobronșic'],['endo']));
  assert(!gradeAnswer([],[]));assert(!gradeAnswer(['endo','exo'],['endo']));
  assert(gradeAnswer(['b','a'],['a','b']));assert(gradeAnswer(['a','a'],['a']));
});
test('a mistake is due in ten minutes; successes expand spacing',()=>{
  const now=1_000_000,first=scheduleReview(null,false,now);assert.equal(first.dueAt,now+600_000);assert.equal(first.lapses,1);
  const second=scheduleReview(first,true,now);assert.equal(second.dueAt,now+DAY);
  const third=scheduleReview(second,true,now);assert.equal(third.intervalDays,3);
  assert.equal(scheduleReview(third,true,now).intervalDays,6);
});
const question=(id,chapterId='respiratory')=>({id,kind:'catalogue',sectionId:'diagnosis',chapterId,prompt:'Diagnostic?',correctOptionIds:['endo']});
test('review prioritises due mistakes, other due, new, then future items',()=>{
  const rows=['future','new','due','wrong'].map(id=>question(id)),progress={};
  for(const [id,lastCorrect,dueAt] of [['future',true,500],['due',true,10],['wrong',false,20]])progress[progressKey('pack',id)]={signature:questionSignature(question(id)),lastCorrect,dueAt};
  assert.deepEqual(chooseQuestions(rows,progress,'pack',4,'review',100,()=>.5).map(q=>q.id),['wrong','due','new','future']);
});
test('exam selection covers chapters and ignores private review history',()=>{
  const rows=[question('a'),question('b'),question('c','renal'),question('d','renal')];
  const chosen=chooseQuestions(rows,{},'pack',2,'exam',100,()=>.5);assert.equal(new Set(chosen.map(q=>q.chapterId)).size,2);
  assert.deepEqual(chosen,chooseQuestions(rows,{anything:{lastCorrect:false}},'pack',2,'exam',100,()=>.5));
});
test('changed answer keys invalidate scheduling but stable option order does not',()=>{
  const q={...question('a'),kind:'mcq',options:[{id:'x',label:'One'},{id:'y',label:'Two'}],correctOptionIds:['x']},record={signature:questionSignature(q),attempts:4};
  assert.equal(matchingProgress(record,{...q,options:[...q.options].reverse()}),record);
  assert.equal(matchingProgress(record,{...q,correctOptionIds:['y']}),null);
});
test('diagnosis-only cases remain testable; missing diagnosis is study-only; mixed avoids duplicate diagnosis tasks',()=>{
  const pack={cases:[{id:'p1',chapterId:'respiratory',diagnosisIds:['endo'],sections:[]},{id:'p2',chapterId:'renal',diagnosisIds:[],sections:[]}]};
  const bank={items:[{...question('authored'),kind:'mcq',caseId:'p1',reviewStatus:'source-derived'},{...question('projection'),kind:'mcq',caseId:'p1',sectionId:'projection',reviewStatus:'source-derived'},{...question('draft'),kind:'mcq',caseId:'p1',reviewStatus:'draft'}]};
  assert.equal(availableQuestions(pack,bank,{kind:'catalogue'}).length,1);
  assert.equal(availableQuestions(pack,bank,{kind:'mixed'}).length,2);
  assert.equal(availableQuestions(pack,bank,{kind:'mcq'}).length,2);
});
