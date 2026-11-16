// Narrow ZIP container support: stored/deflated entries only. Inflation is performed
// by the browser, never by downloaded code. All limits apply before AND after inflate.
import { LIMITS, requireThat, safePath } from './schema.js';
const encoder=new TextEncoder();
const table=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++) n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(bytes, previous=0) { let crc=previous^0xffffffff; for(const b of bytes) crc=table[(crc^b)&255]^(crc>>>8); return (crc^0xffffffff)>>>0; }

export function inspectZip(buffer) {
  const bytes=new Uint8Array(buffer), view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  requireThat(bytes.length>=22 && bytes.length<=LIMITS.archive,'Arhiva este goală, invalidă sau depășește 32 MiB.');
  let end=-1;
  for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--) if(view.getUint32(p,true)===0x06054b50 && p+22+view.getUint16(p+20,true)===bytes.length){end=p;break;}
  requireThat(end>=0,'Nu este o arhivă ZIP standard.');
  const count=view.getUint16(end+10,true),size=view.getUint32(end+12,true),offset=view.getUint32(end+16,true);
  requireThat(view.getUint16(end+4,true)===0 && view.getUint16(end+6,true)===0 && view.getUint16(end+8,true)===count,'Arhivele pe mai multe volume nu sunt acceptate.');
  requireThat(count>0 && count<=LIMITS.entries && offset+size===end,'Director ZIP invalid sau ZIP64 nesuportat.');
  const decoder=new TextDecoder('utf-8',{fatal:true}), names=new Set(),entries=[],ranges=[];
  let p=offset,total=0;
  for(let i=0;i<count;i++) {
    requireThat(p+46<=end && view.getUint32(p,true)===0x02014b50,'Director ZIP incomplet.');
    const flags=view.getUint16(p+8,true),method=view.getUint16(p+10,true),crc=view.getUint32(p+16,true);
    const compressed=view.getUint32(p+20,true),original=view.getUint32(p+24,true),nameLength=view.getUint16(p+28,true),extra=view.getUint16(p+30,true),comment=view.getUint16(p+32,true),local=view.getUint32(p+42,true);
    requireThat(p+46+nameLength+extra+comment<=end && !(flags&0x61) && [0,8].includes(method),'ZIP criptat sau metodă de compresie nesuportată.');
    const name=decoder.decode(bytes.subarray(p+46,p+46+nameLength));
    const directory=name.endsWith('/');
    const base=directory?name.slice(0,-1):name;
    requireThat(safePath(base) && !names.has(name.toLowerCase()),'Cale ZIP nesigură sau duplicată.'); names.add(name.toLowerCase());
    requireThat(directory || /(^|\/)(pack\.json|questions\.json|backup\.json)$/.test(name) || /(^|\/)images\/.+\.(png|jpe?g)$/i.test(name),'Tip de fișier nepermis în arhivă.');
    requireThat(original<=LIMITS.entry && compressed<=LIMITS.archive && local+30<=offset,'Intrare ZIP prea mare sau invalidă.');
    total+=original;requireThat(total<=LIMITS.total,'Conținutul dezarhivat depășește 64 MiB.');
    requireThat(view.getUint32(local,true)===0x04034b50 && view.getUint16(local+6,true)===flags && view.getUint16(local+8,true)===method,'Antete ZIP contradictorii.');
    const localName=view.getUint16(local+26,true),localExtra=view.getUint16(local+28,true),start=local+30+localName+localExtra;
    requireThat(start+compressed<=offset && decoder.decode(bytes.subarray(local+30,local+30+localName))===name,'Date ZIP în afara arhivei.');
    if(!(flags&8)) requireThat(view.getUint32(local+14,true)===crc && view.getUint32(local+18,true)===compressed && view.getUint32(local+22,true)===original,'Dimensiuni ZIP contradictorii.');
    if(method===0) requireThat(original===compressed,'Dimensiune ZIP necomprimat invalidă.');
    const mode=(view.getUint32(p+38,true)>>>16)&0xf000;
    requireThat(mode!==0xa000,'Legăturile simbolice nu sunt acceptate.');
    if(directory) requireThat(original===0 && compressed===0,'Director ZIP cu conținut.');
    ranges.push([local,start+compressed]);
    if(!directory) entries.push({name,method,crc,compressed,original,start});
    p+=46+nameLength+extra+comment;
  }
  requireThat(p===end,'Director ZIP ambiguu.');
  ranges.sort((a,b)=>a[0]-b[0]);
  requireThat(ranges.every((r,i)=>i===0 || r[0]>=ranges[i-1][1]),'Intrări ZIP suprapuse.');
  return {bytes,entries};
}

export async function readZip(buffer,onProgress=()=>{}) {
  const {bytes,entries}=inspectZip(buffer), files=[];
  let actualTotal=0;
  for(const entry of entries) {
    let stream=new Blob([bytes.subarray(entry.start,entry.start+entry.compressed)]).stream();
    if(entry.method===8) {
      let decompressor;
      try{decompressor=new DecompressionStream('deflate-raw');}catch{throw new Error('Browserul nu poate decomprima acest ZIP. Actualizează browserul sau exportă pachetul fără compresie (ZIP stored).');}
      stream=stream.pipeThrough(decompressor);
    }
    const reader=stream.getReader(),parts=[];
    let length=0,crc=0;
    try {
      while(true){const {done,value}=await reader.read();if(done)break;
        length+=value.byteLength;actualTotal+=value.byteLength;
        requireThat(length<=entry.original && length<=LIMITS.entry && actualTotal<=LIMITS.total,'Datele dezarhivate depășesc limitele declarate.');
        crc=crc32(value,crc);parts.push(value);
      }
    }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
    requireThat(length===entry.original && crc===entry.crc,`Fișier corupt în arhivă: ${entry.name}`);
    const data=new Uint8Array(length);let p=0;for(const part of parts){data.set(part,p);p+=part.length;}
    files.push({name:entry.name,data});onProgress(files.length/entries.length);
  }
  return files;
}

// Write ordinary uncompressed ZIPs. Images are already compressed; stored ZIPs
// avoid extra CPU/RAM and remain compatible with older browsers and desktop tools.
export async function writeZip(files,onProgress=()=>{}) {
  requireThat(files.length>0 && files.length<=LIMITS.entries,'Prea multe fișiere pentru un singur backup.');
  const chunks=[],central=[];let offset=0,total=0;
  const names=new Set();
  for(const file of files){
    requireThat(safePath(file.name) && !names.has(file.name.toLowerCase()),'Cale de export invalidă.');names.add(file.name.toLowerCase());
    const data=file.data instanceof Blob ? new Uint8Array(await file.data.arrayBuffer()) : file.data instanceof Uint8Array ? file.data : encoder.encode(file.data);
    requireThat(data.length<=LIMITS.entry,'Fișier prea mare pentru export.');total+=data.length;requireThat(total<=LIMITS.total,'Backup prea mare; exportă pachetele separat.');
    const name=encoder.encode(file.name),crc=crc32(data),header=new Uint8Array(30+name.length),v=new DataView(header.buffer);
    v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);header.set(name,30);
    const directory=new Uint8Array(46+name.length),d=new DataView(directory.buffer);
    d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(14,33,true);d.setUint32(16,crc,true);d.setUint32(20,data.length,true);d.setUint32(24,data.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);directory.set(name,46);
    chunks.push(header,data);central.push(directory);offset+=header.length+data.length;onProgress(central.length/files.length);
  }
  const centralSize=central.reduce((n,row)=>n+row.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);
  e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
  const blob=new Blob([...chunks,...central,end],{type:'application/zip'});
  requireThat(blob.size<=LIMITS.archive,'Backup mai mare de 32 MiB. Exportă pachetele separat.');return blob;
}
