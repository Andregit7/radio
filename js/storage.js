import { requireThat, parseJSON, LIMITS } from './schema.js';
export const DB_NAME='radia-study-v1';
let database;
const requestResult=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
export async function openDatabase(name=database?.name || DB_NAME) {
  if(database && database.name===name)return database;
  requireThat(globalThis.indexedDB,'Browserul nu oferă stocare locală. Deschide aplicația în Safari, Chrome, Edge sau Firefox, într-o fereastră obișnuită.');
  const request=indexedDB.open(name,1);
  request.onupgradeneeded=()=>{
    const db=request.result;
    db.createObjectStore('packs',{keyPath:'id'});
    const assets=db.createObjectStore('assets',{keyPath:'key'});assets.createIndex('token','token');
    db.createObjectStore('meta');
  };
  database=await Promise.race([requestResult(request),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Stocarea este blocată. Închide celelalte file Radia și încearcă din nou.')),5000))]);
  database.onversionchange=()=>{database.close();database=undefined;};return database;
}

function transactionDone(transaction) {
  return new Promise((resolve,reject)=>{transaction.oncomplete=()=>resolve();transaction.onabort=()=>reject(transaction.error || new Error('Salvarea a fost anulată.'));transaction.onerror=()=>{};});
}

export async function getMeta(key,fallback=null) {
  const db=await openDatabase();return (await requestResult(db.transaction('meta').objectStore('meta').get(key)))??fallback;
}
export async function setMeta(key,value) {
  const db=await openDatabase(),tx=db.transaction('meta','readwrite');tx.objectStore('meta').put(value,key);await transactionDone(tx);
}
export async function setMetas(values) {
  const db=await openDatabase(),tx=db.transaction('meta','readwrite'),done=transactionDone(tx);
  for(const [key,value] of Object.entries(values))tx.objectStore('meta').put(value,key);await done;
}
export async function listPacks() {
  const db=await openDatabase();return requestResult(db.transaction('packs').objectStore('packs').getAll());
}
export async function assetBlob(record,path) {
  const db=await openDatabase();return (await requestResult(db.transaction('assets').objectStore('assets').get(`${record.token}/${path}`)))?.blob;
}
export async function packAssets(record) {
  const db=await openDatabase();return requestResult(db.transaction('assets').objectStore('assets').index('token').getAll(record.token));
}

// All replacements, assets, and optional restored learning data commit together.
// The previous pack remains intact when any write fails or quota is exceeded.
export async function installPacks(prepared,learning=null) {
  const db=await openDatabase(),tx=db.transaction(['packs','assets','meta'],'readwrite'),done=transactionDone(tx);
  const packs=tx.objectStore('packs'),assets=tx.objectStore('assets');
  try { for(const candidate of prepared){
    const token=crypto.randomUUID(),old=packs.get(candidate.pack.id);
    old.onsuccess=()=>{
      if(!old.result)return;
      const keys=assets.index('token').getAllKeys(old.result.token);
      keys.onsuccess=()=>keys.result.forEach(key=>assets.delete(key));
    };
    for(const file of candidate.blobs) assets.put({key:`${token}/${file.path}`,token,path:file.path,blob:file.blob});
    packs.put({id:candidate.pack.id,pack:candidate.pack,bank:candidate.bank,token,total:candidate.total,importedAt:Date.now()});
  }
  if(learning)for(const [key,value] of Object.entries(learning))tx.objectStore('meta').put(value,key);
  } catch(error) {tx.abort();await done.catch(()=>{});throw error;}
  await done;
}

export async function removePack(record) {
  const db=await openDatabase(),tx=db.transaction(['packs','assets'],'readwrite'),done=transactionDone(tx);
  tx.objectStore('packs').delete(record.id);
  const assets=tx.objectStore('assets'),keys=assets.index('token').getAllKeys(record.token);
  keys.onsuccess=()=>keys.result.forEach(key=>assets.delete(key));await done;
}

export function validateLearning(raw) {
  requireThat(raw && raw.format==='radiology-learning-backup' && raw.version===1,'Backup de progres incompatibil.');
  requireThat(Number.isFinite(raw.createdAt) && Array.isArray(raw.packs) && raw.packs.length<=100,'Metadate de backup invalide.');
  const records=raw.progress || {};
  requireThat(records && typeof records==='object' && !Array.isArray(records) && Object.keys(records).length<=20000,'Progres invalid.');
  const progress={};
  for(const [key,value] of Object.entries(records)){
    requireThat(/^[a-zA-Z0-9._:-]+\|[a-zA-Z0-9._:-]+\|(catalogue|mcq)$/.test(key) && key.length<400,'Cheie de progres invalidă.');
    requireThat(value && ['attempts','correct','streak','lapses'].every(k=>Number.isInteger(value[k]) && value[k]>=0 && value[k]<=1000000) && value.correct<=value.attempts && value.streak<=value.attempts && value.lapses<=value.attempts,'Număr de încercări invalid.');
    requireThat(Number.isFinite(value.intervalDays) && value.intervalDays>=0 && value.intervalDays<=90 && Number.isFinite(value.dueAt) && value.dueAt>=0 && Number.isFinite(value.lastAt) && value.lastAt>=0 && typeof value.lastCorrect==='boolean','Dată de recapitulare invalidă.');
    requireThat(typeof value.signature==='string' && value.signature.length<=20000,'Identificarea întrebării lipsește.');
    progress[key]=Object.fromEntries(['attempts','correct','streak','lapses','intervalDays','dueAt','lastAt','lastCorrect','signature','sectionId','chapterId','caseId'].filter(k=>k in value).map(k=>[k,value[k]]));
    for(const k of ['sectionId','chapterId','caseId']) if(k in progress[key]) requireThat(typeof progress[key][k]==='string' && /^[a-zA-Z0-9._:-]{1,120}$/.test(progress[key][k]),'Referință de progres invalidă.');
  }
  function keys(rows){requireThat(Array.isArray(rows) && rows.length<=20000 && rows.every(v=>typeof v==='string' && /^[a-zA-Z0-9._:-]+\|[a-zA-Z0-9._:-]+$/.test(v) && v.length<260),'Lista de marcaje este invalidă.');return [...new Set(rows)];}
  requireThat(raw.packs.every(row=>row && typeof row.id==='string' && /^[a-zA-Z0-9._:-]{1,120}$/.test(row.id) && typeof row.revision==='string' && row.revision.length<100),'Referințe de pachet invalide.');
  return {progress,bookmarks:keys(raw.bookmarks || []),visited:keys(raw.visited || [])};
}

export async function learningSnapshot(records) {
  return {format:'radiology-learning-backup',version:1,createdAt:Date.now(),
    packs:records.map(row=>({id:row.id,revision:row.pack.revision})),
    progress:await getMeta('progress',{}),bookmarks:await getMeta('bookmarks',[]),visited:await getMeta('visited',[])};
}

export async function mergeLearning(incoming) {
  const current={progress:await getMeta('progress',{}),bookmarks:await getMeta('bookmarks',[]),visited:await getMeta('visited',[])};
  for(const [key,record] of Object.entries(incoming.progress))if(!current.progress[key] || record.lastAt>current.progress[key].lastAt) current.progress[key]=record;
  current.bookmarks=[...new Set([...current.bookmarks,...incoming.bookmarks])];current.visited=[...new Set([...current.visited,...incoming.visited])];
  return current;
}

export async function restoreLearningFile(file) {
  requireThat(file.size<=LIMITS.json,'Backupul JSON depășește limita de 3 MiB.');
  const learning=await mergeLearning(validateLearning(parseJSON(await file.text())));
  const db=await openDatabase(),tx=db.transaction('meta','readwrite'),done=transactionDone(tx);
  for(const [key,value] of Object.entries(learning))tx.objectStore('meta').put(value,key);
  await done;return learning;
}
