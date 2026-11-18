import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url))),tests=(await readdir(path.join(root,'tests'))).filter(f=>f.endsWith('.test.mjs')).map(f=>path.join(root,'tests',f));
const run=spawnSync(process.execPath,['--test','--test-reporter=tap',...tests],{cwd:root,encoding:'utf8'});
const check=spawnSync(process.execPath,[path.join(root,'tools/check.mjs')],{cwd:root,encoding:'utf8'});
await mkdir(path.join(root,'test-results'),{recursive:true});await writeFile(path.join(root,'test-results/node-tests.tap'),run.stdout+run.stderr);
const metric=name=>Number(run.stdout.match(new RegExp(`# ${name} (\\d+)`))?.[1] || 0);
let browserIntegration={executed:false,reason:'Run checks.html in a browser and record the observed results in docs/browser-checks.json.'};
try {
  const evidence=JSON.parse(await readFile(path.join(root,'docs/browser-checks.json'),'utf8'));
  const study=JSON.parse(await readFile(path.join(root,'dist/release.json'),'utf8'));
  const studio=JSON.parse(await readFile(path.join(root,'studio/release.json'),'utf8'));
  browserIntegration=evidence.testedBuilds?.study===study.buildId && evidence.testedBuilds?.studio===studio.buildId
    ?evidence:{executed:false,reason:'App files changed after the recorded browser checks; repeat them for these builds.'};
} catch {}
let coursePack={cases:null,diagnoses:null,sourceDerivedMCQs:null,annotations:null,reviewedAnnotations:null};
try{
  const build=JSON.parse(await readFile(path.join(root,'starter-pack/build-report.json'),'utf8'));
  coursePack={cases:build.cases,diagnoses:build.diagnoses,sourceDerivedMCQs:build.questions,
    annotations:build.annotationCount,reviewedAnnotations:build.reviewedAnnotationCount ?? 0};
}catch{}
const report={version:JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version,generatedAt:new Date().toISOString(),
  nodeTests:{exitCode:run.status,tests:metric('tests'),passed:metric('pass'),failed:metric('fail'),skipped:metric('skipped')},
  staticChecks:{exitCode:check.status,result:check.stdout.trim()},
  browserIntegration,
  deviceInstallation:{executed:false,platforms:['Windows','Android','iOS','macOS']},
  coursePack};
await writeFile(path.join(root,'verification-results.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(run.status!==0 || check.status!==0){console.error(run.stderr,check.stderr);process.exitCode=1;}
