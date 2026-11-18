import {execFileSync} from 'node:child_process';
import {cp,rm,readFile,mkdtemp,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const repo=path.resolve(process.env.RADIOEASY_PAGES_REPO || path.join(root,'..','..','..','radio-pages'));
const dryRun=process.argv.includes('--dry-run');
const PUBLISHED=['.nojekyll','checks','checks.html','icons','index.html','js','manifest.webmanifest','release.json','styles.css','sw.js','studio'];
const SOURCE_ONLY=['dist','docs','tests','tools','node_modules','starter-pack','releases','test-results'];
const git=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']});
const run=(cwd,args)=>execFileSync('git',args,{cwd,stdio:'inherit'});

async function stageInto(target){
  for(const name of [...PUBLISHED,...SOURCE_ONLY])await rm(path.join(target,name),{recursive:true,force:true});
  await cp(path.join(root,'releases','study-site'),target,{recursive:true,force:true});
  await cp(path.join(root,'releases','studio-site'),path.join(target,'studio'),{recursive:true,force:true});
  await cp(path.join(root,'dist','checks.html'),path.join(target,'checks.html'),{force:true});
  await cp(path.join(root,'dist','checks'),path.join(target,'checks'),{recursive:true,force:true});
  const study=JSON.parse(await readFile(path.join(target,'release.json'),'utf8'));
  const studio=JSON.parse(await readFile(path.join(target,'studio','release.json'),'utf8'));
  return {study,studio};
}

async function main(){
  await readFile(path.join(root,'releases','study-site','release.json')).catch(()=>{
    throw new Error('Lipsește buildul. Rulează mai întâi: npm run release');
  });

  if(dryRun){
    const scratch=await mkdtemp(path.join(os.tmpdir(),'radioeasy-deploy-'));
    try{
      const {study,studio}=await stageInto(scratch);
      console.log(`Study:  ${study.app} ${study.version} ${study.buildId}`);
      console.log(`Studio: ${studio.app} ${studio.version} ${studio.buildId}`);
      console.log(`Fișiere: ${(await readdir(scratch,{recursive:true})).length}`);
      console.log('Dry run: buildul este complet; depozitul nu a fost modificat.');
    }finally{await rm(scratch,{recursive:true,force:true});}
    return;
  }

  await readFile(path.join(repo,'.git','HEAD')).catch(()=>{
    throw new Error(`Nu găsesc depozitul Pages la ${repo}. Clonează-l o dată:\n  git clone https://github.com/Andregit7/radio.git "${repo}"`);
  });
  if(git(repo,['status','--porcelain']).trim())throw new Error(`Depozitul ${repo} are modificări necommise. Rezolvă-le înainte de deploy.`);
  if(git(repo,['branch','--show-current']).trim()!=='gh-pages')run(repo,['checkout','gh-pages']);
  run(repo,['pull','--ff-only','origin','gh-pages']);

  const {study,studio}=await stageInto(repo);
  console.log(`Study:  ${study.app} ${study.version} ${study.buildId}`);
  console.log(`Studio: ${studio.app} ${studio.version} ${studio.buildId}`);
  console.log(`Repo:   ${repo}`);

  if(!git(repo,['status','--porcelain']).trim()){console.log('Nicio modificare de publicat.');return;}
  run(repo,['add','-A']);
  run(repo,['commit','-m',`Deploy RadioEasy v${study.version}`]);
  run(repo,['push','origin','gh-pages']);
  console.log('\nPublicat. GitHub Pages se actualizează în câteva secunde:');
  console.log('https://andregit7.github.io/radio/#library');
  console.log('Deschide într-o fereastră privată pentru a evita cache-ul vechi.');
}

main().catch(error=>{console.error(`\nDeploy oprit: ${error.message}`);process.exitCode=1;});
