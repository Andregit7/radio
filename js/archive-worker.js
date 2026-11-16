import { readZip, writeZip } from './zip.js';
self.onmessage=async({data})=>{
  try{
    const progress=value=>self.postMessage({type:'progress',value});
    if(data.action==='read') {
      const files=await readZip(await data.file.arrayBuffer(),progress);
      self.postMessage({type:'done',files},files.map(file=>file.data.buffer));
    } else if(data.action==='write') {
      const blob=await writeZip(data.files,progress);self.postMessage({type:'done',blob});
    } else throw new Error('Operație necunoscută.');
  }catch(error){self.postMessage({type:'error',message:error.message});}
};
