import test from 'node:test';
import assert from 'node:assert/strict';
import {structuredExercise,gradeStructured,structuredRecord,describeObservation} from '../dist/js/structured.js';
import {availableExercises} from '../dist/js/exercises.js';
import {questionSignature} from '../dist/js/core.js';
import {availableQuestions} from '../dist/js/core.js';

const bank={chapterId:'respiratory',sections:{
  examination:{options:[{id:'rx',label:'Rx torace'},{id:'ct',label:'CT'}]},
  projection:{options:[{id:'pa',label:'PA'},{id:'ap',label:'AP'}]},
  differentials:{options:[{id:'diff-1',label:'Diagnostic diferențial'}]},
  investigations:{options:[{id:'ct-explore',label:'CT'}]},
  findings:{types:[{id:'opacity',label:'Opacitate',fields:[
    {id:'topography',label:'Topografie',kind:'single',options:[{id:'left',label:'Stânga'},{id:'right',label:'Dreapta'}]},
    {id:'number',label:'Număr',kind:'single',options:[{id:'single',label:'Unică'},{id:'multiple',label:'Multiple'}]},
    {id:'size',label:'Mărime',kind:'measurementMm'},
    {id:'contour',label:'Contur',kind:'multiple',options:[{id:'well',label:'Bine delimitat'},{id:'ill',label:'Imprecis'}]},
  ]}]}
}};
const caseData={id:'p001',chapterId:'respiratory',diagnosisIds:['d1'],images:[{id:'primary',path:'images/p001.jpeg',width:8,height:8,role:'primary'}],
  sections:[
    {id:'examination',items:[{id:'e1',text:'Rx torace'}]},
    {id:'projection',items:[{id:'pr1',text:'PA'}]},
    {id:'findings',items:[{id:'f1',text:'Opacitate stângă'},{id:'f2',text:'Opacitate dreaptă'}]},
    {id:'diagnosis',items:[{id:'dx1',text:'Pneumonie'}]},
    {id:'differentials',items:[]},
    {id:'investigations',items:[]},
  ],
  structured:{status:'source-derived',choices:{examination:['rx'],projection:['pa'],differentials:['diff-1'],investigations:[]},observations:[
    {itemId:'f1',typeId:'opacity',values:{topography:['left'],number:['single'],size:12.3,contour:['well','ill']}},
    {itemId:'f2',typeId:'opacity',values:{topography:['right'],number:['multiple'],size:22}},
  ]},
  annotations:[]};
const pack={cases:[caseData],diagnoses:[{id:'d1',label:'Pneumonie',chapterIds:['respiratory'],aliases:[]},{id:'d2',label:'Atelectazie',chapterIds:['respiratory'],aliases:[]}],
  curriculum:{chapters:[{id:'respiratory',label:'Respirator'}],chapterBanks:[bank],scopes:[{id:'all',chapterIds:['respiratory']}]}};

test('structured exercise uses authored chapter banks and omits unkeyed sections',()=>{
  const q=structuredExercise(pack,caseData);
  assert(q,'structured exercise should exist');
  assert.deepEqual(q.steps.map(step=>step.id),['examination','projection','findings','diagnosis']);
  assert.equal(q.steps.find(step=>step.id==='findings').expected.length,2);
  assert.equal(q.steps.find(step=>step.id==='findings').types[0].fields.find(field=>field.id==='size').kind,'measurementMm');
  assert(!q.steps.some(step=>step.id==='investigations'),'unkeyed section must not be assessed');
  assert.deepEqual(availableExercises(pack,null).structured.map(row=>row.caseId),['p001']);
  assert.equal(availableExercises(pack,null).interpretation.length,0,'legacy prose must not become a v2 self-assessment');
});

test('structured grading requires exact choice sets and one-to-one observations',()=>{
  const q=structuredExercise(pack,caseData),findings=q.steps.find(step=>step.id==='findings');
  const answer={sections:{examination:{choiceIds:['rx']},projection:{choiceIds:['pa']},findings:{observations:[
    {typeId:'opacity',values:{topography:['right'],number:['multiple'],size:22}},
    {typeId:'opacity',values:{topography:['left'],number:['single'],size:12.3,contour:['ill','well']}},
  ]},diagnosis:{choiceIds:['d1']}}};
  const grade=gradeStructured(q,answer);
  assert(grade.correct);assert.equal(grade.hit,4);
  const extra=structuredClone(answer);extra.sections.findings.observations.push({typeId:'opacity',values:{topography:['left']}});
  assert(!gradeStructured(q,extra).correct,'extra observation must fail the findings step');
  const wrong=structuredClone(answer);wrong.sections.findings.observations[0].values.topography=['left'];
  assert(!gradeStructured(q,wrong).results.find(row=>row.stepId==='findings').correct,'duplicate match must not count twice');
  assert.equal(findings.expected.length,2);
  assert.equal(describeObservation(findings,findings.expected[0]).includes('mm'),true);
});

test('structured signature ignores labels and option order but follows the image and keys',()=>{
  const q=structuredExercise(pack,caseData);
  const relabel=structuredClone(pack);relabel.curriculum.chapterBanks[0].sections.findings.types[0].label='Opacitate redenumită';
  relabel.diagnoses[0].label='Pneumonie redenumită';
  relabel.curriculum.chapterBanks[0].sections.examination.options.reverse();
  const q2=structuredExercise(relabel,relabel.cases[0]);
  assert.equal(questionSignature(q),questionSignature(q2));
  const keyChange=structuredClone(pack);keyChange.cases[0].structured.observations[0].values.size=13.1;
  assert.notEqual(questionSignature(q),questionSignature(structuredExercise(keyChange,keyChange.cases[0])));
  const imageChange=structuredClone(pack);imageChange.cases[0].images[0].sha256='0'.repeat(64);
  assert.notEqual(questionSignature(q),questionSignature(structuredExercise(imageChange,imageChange.cases[0])));
});

test('structured progress schedules once and keeps the score separate from accuracy counters',()=>{
  const q=structuredExercise(pack,caseData),grade=gradeStructured(q,{sections:{}});
  const record=structuredRecord(null,grade,1000);
  assert.equal(record.attempts,1);assert.equal(record.correct,0);assert.equal(record.identified,0);assert.equal(record.total,4);assert.equal(record.selfAssessed,false);
  const again=structuredRecord(record,{...grade,correct:true,hit:4},2000);
  assert.equal(again.attempts,2);assert.equal(again.correct,1);assert.equal(again.lastCorrect,true);
});

test('written questions live in the short pool and carry their own signature',()=>{
  const bank={items:[
    {id:'w1',caseId:'p001',kind:'written',sectionId:'findings',prompt:'Explică opacitatea.',rubric:'Topografie, contur, mărime.',reviewStatus:'source-derived'},
    {id:'m1',caseId:'p001',kind:'mcq',sectionId:'findings',prompt:'Ce observi?',options:[{id:'a',label:'A'},{id:'b',label:'B'}],correctOptionIds:['a'],reviewStatus:'source-derived'},
  ]};
  const short=availableQuestions(pack,bank,{kind:'mixed'});
  assert(short.some(row=>row.kind==='written'&&row.id==='w1'));
  assert(short.some(row=>row.kind==='mcq'&&row.id==='m1'));
  assert.equal(availableQuestions(pack,bank,{kind:'mcq'}).some(row=>row.kind==='written'),false);
  const w=short.find(row=>row.kind==='written');
  assert.notEqual(questionSignature(w),questionSignature({...w,rubric:'Alt barem'}));
});
