import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url))),tests=(await readdir(path.join(root,'tests'))).filter(f=>f.endsWith('.test.mjs')).map(f=>path.join(root,'tests',f));
const run=spawnSync(process.execPath,['--test','--test-reporter=tap',...tests],{cwd:root,encoding:'utf8'});
const check=spawnSync(process.execPath,[path.join(root,'tools/check.mjs')],{cwd:root,encoding:'utf8'});
await mkdir(path.join(root,'test-results'),{recursive:true});await writeFile(path.join(root,'test-results/node-tests.tap'),run.stdout+run.stderr);
const metric=name=>Number(run.stdout.match(new RegExp(`# ${name} (\\d+)`))?.[1] || 0);
const report={version:JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version,generatedAt:new Date().toISOString(),
  nodeTests:{exitCode:run.status,tests:metric('tests'),passed:metric('pass'),failed:metric('fail'),skipped:metric('skipped')},
  staticChecks:{exitCode:check.status,result:check.stdout.trim()},
  browserIntegration:{executed:false,reason:'Local preview was blocked: loopback EACCES and unavailable in-app browser connection.'},
  deviceInstallation:{executed:false,platforms:['Windows','Android','iOS','macOS']},
  coursePack:{cases:80,diagnoses:60,sourceDerivedMCQs:21,draftAnnotations:1}};
await writeFile(path.join(root,'verification-results.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(run.status!==0 || check.status!==0){console.error(run.stderr,check.stderr);process.exitCode=1;}
