export function archiveJob(action,payload,onProgress=()=>{},signal) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./archive-worker.js',import.meta.url),{type:'module'});
    let finished=false;
    const timer=setTimeout(()=>finish(new Error('Operația a durat prea mult. Încearcă un pachet mai mic.')),120_000);
    const abort=()=>finish(new DOMException('Operație anulată.','AbortError'));
    function finish(error,result){if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();error?reject(error):resolve(result);}
    worker.onmessage=({data})=>{if(data.type==='progress')onProgress(data.value);else if(data.type==='error')finish(new Error(data.message));else if(data.type==='done')finish(null,data);};
    worker.onerror=event=>finish(new Error(event.message || 'Operația cu arhiva a eșuat.'));
    if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
    worker.postMessage({action,...payload});
  });
}
