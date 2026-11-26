/* Versioned, atomic app-shell cache. Imported materials live only in IndexedDB. */
const VERSION='0.5.1-f17a4faf784f';
const PREFIX=`radia-shell:${self.registration.scope}:`;
const CACHE=PREFIX+VERSION;
const FILES=['./','./index.html','./styles.css','./manifest.webmanifest','./release.json','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png','./icons/maskable-512.png','./icons/apple-touch-icon.png',
  './js/app.js','./js/core.js','./js/schema.js','./js/zip.js','./js/archive.js','./js/archive-worker.js','./js/storage.js','./js/dom.js','./js/credits.js','./js/annotation-view.js','./js/appearance.js','./js/viewer.js','./js/case-interpretation.js','./js/exercises.js','./js/pack-compat.js'];
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);await cache.addAll(FILES.map(path=>new Request(new URL(path,self.registration.scope),{cache:'reload'})));})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const name of await caches.keys())if(name.startsWith(PREFIX) && name!==CACHE)await caches.delete(name);await self.clients.claim();})()));
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET' || url.origin!==self.location.origin)return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE),cached=await cache.match(request);
    if(cached)return cached;
    const home=new URL('./',self.registration.scope),index=new URL('./index.html',self.registration.scope);
    if(request.mode==='navigate' && (url.pathname===home.pathname || url.pathname===index.pathname))return (await cache.match(index)) || fetch(request);
    return fetch(request);
  })());
});
