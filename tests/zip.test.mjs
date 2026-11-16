import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {crc32,inspectZip,readZip,writeZip} from '../dist/js/zip.js';
import {validateFiles} from '../dist/js/schema.js';
const fixture=name=>readFile(new URL(`./fixtures/${name}`,import.meta.url));
test('CRC32 matches a published standard check value, including incremental chunks',()=>{
  const data=new TextEncoder().encode('123456789');assert.equal(crc32(data),0xcbf43926);assert.equal(crc32(data.subarray(4),crc32(data.subarray(0,4))),0xcbf43926);
});
test('ordinary stored ZIPs from Python import correctly',async()=>{
  const files=await readZip(await fixture('valid-stored.zip'));assert.equal(files[0].name,'pack.json');assert.equal(new TextDecoder().decode(files[0].data),'{}');
});
test('ordinary deflated ZIPs from Python import correctly',async()=>{
  const files=await readZip(await fixture('valid-deflated.zip'));assert.equal(new TextDecoder().decode(files[0].data),'{}');
});
test('writer roundtrips binary content and exports standard stored ZIP',async()=>{
  const data=new Uint8Array([0,255,1,127,255]),blob=await writeZip([{name:'images/x.png',data},{name:'pack.json',data:'{}'}]);
  const buffer=await blob.arrayBuffer();assert.equal(inspectZip(buffer).entries[0].method,0);
  const files=await readZip(buffer);assert.deepEqual(files[0].data,data);assert.equal(new TextDecoder().decode(files[1].data),'{}');
});
test('truncated archives and unsafe export paths are rejected',async()=>{
  assert.throws(()=>inspectZip(new Uint8Array(10)));await assert.rejects(()=>writeZip([{name:'../x',data:'bad'}]));
});
test('malicious fixtures are actually read and rejected',async()=>{
  for(const name of ['zip-slip.zip','duplicate.zip','active-file.zip','overlap.zip','oversize.zip']){const bytes=await fixture(name);assert.throws(()=>inspectZip(bytes),undefined,name);}
});
test('overlapping ranges are rejected even when local names and keys agree',async()=>{
  const bytes=await fixture('overlap.zip');assert.throws(()=>inspectZip(bytes),/suprapuse/);
});
test('actual inflation cannot exceed a forged small declared size',async()=>{
  const bytes=await fixture('inflate-overflow.zip');assert.equal(inspectZip(bytes).entries[0].original,1);
  await assert.rejects(()=>readZip(bytes),/limitele declarate/);
});
test('CRC corruption is rejected after extraction',async()=>{const bytes=await fixture('bad-crc.zip');await assert.rejects(()=>readZip(bytes),/corupt/);});
test('real starter pack validates every image and assessment reference',async t=>{
  let bytes;try{bytes=await readFile(new URL('../starter-pack/radiografii-explicate.study.zip',import.meta.url));}catch{t.skip('Course assets are intentionally separate from public code.');return;}
  const result=await validateFiles(await readZip(bytes));assert.equal(result.pack.cases.length,80);assert.equal(result.pack.diagnoses.length,60);assert.equal(result.blobs.length,80);assert(result.bank.items.length>=20);
});
