import {readFile,writeFile,readdir,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url))),version=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;
async function collect(base,relative=''){
  const rows=[];for(const entry of await readdir(path.join(base,relative),{withFileTypes:true})){
    const name=relative?relative+'/'+entry.name:entry.name;
    if(['packs','checks'].includes(entry.name) || ['starter.json','checks.html'].includes(name))continue;
    if(entry.isDirectory())rows.push(...await collect(base,name));else rows.push(name);
  }return rows.sort();
}
for(const [kind,directory] of [['study','dist'],['studio','studio']]){
  const base=path.join(root,directory);
  await writeFile(path.join(base,'.nojekyll'),'');
  const names=await collect(base),hash=createHash('sha256');
  const worker=await readFile(path.join(base,'sw.js'),'utf8');
  hash.update('sw.js').update(worker.replace(/const VERSION='[^']+'/,'const VERSION=BUILD_ID'));
  for(const name of names.filter(name=>!['sw.js','release.json'].includes(name)))hash.update(name).update(await readFile(path.join(base,name)));
  const buildId=hash.digest('hex').slice(0,12);
  await writeFile(path.join(base,'sw.js'),worker.replace(/const VERSION='[^']+'/,`const VERSION='${version}-${buildId}'`));
  const records=[];for(const name of names.filter(name=>name!=='release.json')){const bytes=await readFile(path.join(base,name));records.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
  const manifest={app:`radioeasy-${kind}`,version,buildId,files:records,totalBytes:records.reduce((n,row)=>n+row.bytes,0)};
  await writeFile(path.join(base,'release.json'),JSON.stringify(manifest,null,2)+'\n');
  const destination=path.join(root,'releases',`${kind}-site`);await mkdir(destination,{recursive:true});
  for(const name of [...names.filter(name=>name!=='release.json'),'release.json']){const target=path.join(destination,name);await mkdir(path.dirname(target),{recursive:true});await copyFile(path.join(base,name),target);}
  console.log(`${kind}: ${records.length} files, ${manifest.totalBytes} bytes; build ${buildId}. Course data excluded.`);
}
