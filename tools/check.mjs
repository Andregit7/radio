import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
async function files(directory,exclude=true){const rows=[];for(const entry of await readdir(directory,{withFileTypes:true})){const p=path.join(directory,entry.name);if(entry.isSymbolicLink())throw new Error(`Unexpected symlink: ${p}`);if(entry.isDirectory()){if(!exclude || !['packs','node_modules','.git','starter-pack','releases'].includes(entry.name))rows.push(...await files(p,exclude));}else rows.push(p);}return rows;}
let checks=0;
for(const directory of ['dist','studio']){
  const base=path.join(root,directory),rows=await files(base);
  for(const filename of rows){
    if(/\.(js|mjs)$/.test(filename)){
      const syntax=spawnSync(process.execPath,['--check',filename],{encoding:'utf8'});if(syntax.status!==0)throw new Error(syntax.stderr);checks++;
      const text=await readFile(filename,'utf8');
      if(/\b(?:eval|Function)\s*\(|\.innerHTML\s*=|sendBeacon\s*\(|new\s+(?:WebSocket|XMLHttpRequest)/.test(text))throw new Error(`Unexpected executable/network sink: ${filename}`);
      for(const match of text.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)){
        if(!match[1].startsWith('.'))throw new Error(`Nonlocal import in ${filename}`);
        await stat(path.resolve(path.dirname(filename),match[1]));checks++;
      }
    }
    if(filename.endsWith('.html')){
      const text=await readFile(filename,'utf8');if(!text.includes('Content-Security-Policy'))throw new Error(`Missing CSP: ${filename}`);
      for(const match of text.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)){await stat(path.resolve(path.dirname(filename),match[1]));checks++;}
    }
  }
  const worker=await readFile(path.join(base,'sw.js'),'utf8');
  const match=worker.match(/const FILES=\[([\s\S]*?)\];/);
  if(!match)throw new Error(`Missing shell cache list: ${directory}`);
  for(const value of match[1].matchAll(/'([^']+)'/g)){if(value[1]==='./')continue;await stat(path.join(base,value[1]));checks++;}
  const manifest=JSON.parse(await readFile(path.join(base,'manifest.webmanifest'),'utf8'));
  if(manifest.start_url!=='./' || manifest.scope!=='./')throw new Error('Manifest must support GitHub Pages subpaths.');
  const release=JSON.parse(await readFile(path.join(base,'release.json'),'utf8'));
  const staged=path.join(root,'releases',directory==='dist'?'study-site':'studio-site');
  let hasStage=false;try{hasStage=(await stat(staged)).isDirectory();}catch{}
  for(const item of release.files){
    const bytes=await readFile(path.join(base,item.path));if(createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw new Error(`Stale source checksum: ${directory}/${item.path}`);checks++;
    if(hasStage){const copy=await readFile(path.join(staged,item.path));if(createHash('sha256').update(copy).digest('hex')!==item.sha256)throw new Error(`Deployment checksum mismatch: ${item.path}`);checks++;}
  }
  if(hasStage){const allowed=new Set(['release.json',...release.files.map(item=>item.path)]);for(const file of await files(staged,false)){const relative=path.relative(staged,file).split(path.sep).join('/');if(!allowed.has(relative))throw new Error(`Unexpected deployment asset: ${relative}`);}}
}
for(const name of ['core.js','schema.js','zip.js','archive.js','archive-worker.js','dom.js']){
  const [study,studio]=await Promise.all([readFile(path.join(root,'dist/js',name)),readFile(path.join(root,'studio/lib',name))]);
  if(!study.equals(studio))throw new Error(`Shared module stale in Studio: ${name}`);checks++;
}
console.log(`${checks} static, syntax, cache, local-asset and shared-module checks passed.`);
