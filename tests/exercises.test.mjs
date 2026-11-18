import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretationExercise,regionsExercise,matchingExercise,availableExercises,gradeMatching,
  recordSelfAssessment,advanceSession,finishSessionEarly,selfAssessmentItems,EXERCISE_LABELS} from '../dist/js/exercises.js';
import {questionSignature} from '../dist/js/core.js';

const caseData={id:'p001',chapterId:'respiratory',diagnosisIds:['d1'],
  sections:[
    {id:'examination',items:[{id:'p001-examination-1',text:'Rx torace'}]},
    {id:'projection',items:[{id:'p001-projection-1',text:'PA'}]},
    {id:'findings',items:[{id:'f1',text:'Opacitate'},{id:'f2',text:'Distrucție'},{id:'f3',text:'Retracție'}]},
    {id:'diagnosis',items:[{id:'dx1',text:'Diagnostic canonic - alias'}]},
    {id:'differentials',items:[]},
    {id:'investigations',items:[]},
  ],
  annotations:[
    {id:'a1',imageId:'primary',itemId:'f1',shape:'ellipse',reviewStatus:'reviewed'},
    {id:'a2',imageId:'primary',itemId:'f2',shape:'ellipse',reviewStatus:'reviewed'},
    {id:'a3',imageId:'primary',itemId:'f3',shape:'ellipse',reviewStatus:'reviewed'},
    {id:'a4',imageId:'primary',itemId:'f1',shape:'ellipse',reviewStatus:'draft'},
  ]};
const record={pack:{id:'pack',diagnoses:[{id:'d1',label:'Diagnostic canonic',aliases:['alias']}],cases:[caseData]}};
const pack={cases:[caseData],curriculum:{chapters:[{id:'respiratory',label:'Respirator'}],scopes:[{id:'all',chapterIds:['respiratory']}]}};

test('full interpretation includes only present sections and excludes diagnosis-only cases',()=>{
  const exercise=interpretationExercise(caseData);
  assert.deepEqual(exercise.sections.map(section=>section.id),['examination','projection','findings','diagnosis']);
  assert(!exercise.sections.some(section=>section.id==='differentials'),'empty sections must not be assessed');
  assert.equal(interpretationExercise({...caseData,sections:[{id:'diagnosis',items:[{id:'dx',text:'X'}]}]}),null);
  assert.equal(interpretationExercise({...caseData,sections:[]}),null);
});

test('self-assessment uses the canonical diagnosis and not the raw alias text',()=>{
  const exercise=interpretationExercise(caseData),items=selfAssessmentItems(record,exercise);
  assert(items.some(item=>item.id==='diagnosis:d1'&&item.text==='Diagnostic canonic'));
  assert(!items.some(item=>item.text.includes('alias')),'raw diagnosis text must not be the answer');
  assert(items.some(item=>item.id==='p001-examination-1'));
});

test('guided regions use reviewed annotations only and require one-to-one links',()=>{
  const exercise=regionsExercise(caseData);
  assert.deepEqual(exercise.regions.map(row=>row.itemId),['f1','f2','f3']);
  assert(!exercise.regions.some(row=>row.annotationId==='a4'),'draft annotation leaked into exercise');
  const duplicate={...caseData,annotations:[...caseData.annotations,{id:'a5',imageId:'primary',itemId:'f1',shape:'ellipse',reviewStatus:'reviewed'}]};
  assert.equal(regionsExercise(duplicate),null);
  assert.equal(regionsExercise({...caseData,annotations:[]}),null);
});

test('matching requires three reviewed pairs and grades exact mappings',()=>{
  const exercise=matchingExercise(caseData,()=>.5);
  assert.equal(exercise.pairs.length,3);
  assert.equal(exercise.options.length,3);
  assert(gradeMatching(exercise.correctMapping,exercise.correctMapping));
  const wrong={...exercise.correctMapping};wrong[exercise.pairs[0].regionId]=exercise.options.find(option=>option.id!==wrong[exercise.pairs[0].regionId]).id;
  assert(!gradeMatching(wrong,exercise.correctMapping));
  assert(!gradeMatching({},exercise.correctMapping));
  const two={...caseData,annotations:caseData.annotations.filter(row=>row.itemId!=='f3')};
  assert.equal(matchingExercise(two),null);
});

test('available exercise counts follow chapters and keep short questions separate',()=>{
  const bank={items:[{id:'q1',caseId:'p001',kind:'mcq',sectionId:'diagnosis',prompt:'Q',options:[{id:'o1',label:'A'},{id:'o2',label:'B'}],correctOptionIds:['o1'],reviewStatus:'source-derived'}]};
  const pools=availableExercises(pack,bank,{chapterIds:['respiratory']});
  assert.equal(pools.interpretation.length,1);
  assert.equal(pools.regions.length,1);
  assert.equal(pools.matching.length,1);
  assert.equal(pools.short.length,1);
  assert.equal(availableExercises(pack,bank,{chapterIds:['other']}).short.length,0);
});

test('signatures stay stable for old questions and ignore shuffled option order',()=>{
  const old={kind:'mcq',sectionId:'diagnosis',prompt:'P',correctOptionIds:['b','a'],options:[{id:'b',label:'B'},{id:'a',label:'A'}]};
  assert.equal(questionSignature(old),JSON.stringify(['mcq','diagnosis','P',['a','b'],[['a','A'],['b','B']]]));
  const exercise=interpretationExercise(caseData);
  assert.equal(questionSignature(exercise),questionSignature({...exercise,itemIds:[...exercise.itemIds].reverse()}));
  const matching=matchingExercise(caseData,()=>.5);
  assert.equal(questionSignature(matching),questionSignature({...matching,options:[...matching.options].reverse()}));
});

test('self-assessment schedules a review without inventing accuracy',()=>{
  const first=recordSelfAssessment(null,{identified:2,total:3},1000);
  assert.equal(first.attempts,1);assert.equal(first.correct,0);assert.equal(first.lastCorrect,false);
  assert.equal(first.identified,2);assert.equal(first.total,3);assert.equal(first.selfAssessed,true);
  const complete=recordSelfAssessment(first,{identified:3,total:3},2000);
  assert.equal(complete.attempts,2);assert.equal(complete.correct,1);assert.equal(complete.lastCorrect,true);
});

test('session transitions advance once and early finish keeps received answers',()=>{
  const session={version:1,index:0,finished:false,questions:[{id:'a'},{id:'b'}],answers:[]};
  const first=advanceSession(session,{selectedIds:['x'],correct:true},10);
  assert.equal(first.index,1);assert.equal(first.finished,false);assert.equal(first.answers[0].correct,true);
  const last=advanceSession(first,{skipped:true},20);
  assert.equal(last.finished,true);assert.equal(last.finishedAt,20);assert.equal(last.answers[1].skipped,true);
  const ended=finishSessionEarly(session,30);
  assert.equal(ended.finished,true);assert.equal(ended.finishedEarly,true);assert.equal(ended.answers.length,0);
});

test('exercise labels are learner-facing, not internal kinds',()=>{
  assert.equal(EXERCISE_LABELS.interpretation,'Interpretare completă');
  assert.equal(EXERCISE_LABELS.matching,'Potrivire');
  assert.equal(EXERCISE_LABELS.catalogue,'Alegere din listă');
});
