import {mkdir,copyFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
await mkdir(new URL('studio/lib/',root),{recursive:true});await mkdir(new URL('studio/icons/',root),{recursive:true});
for(const name of ['core.js','schema.js','zip.js','archive.js','archive-worker.js','dom.js','credits.js','annotation-view.js','appearance.js','viewer.js','case-interpretation.js'])await copyFile(new URL('dist/js/'+name,root),new URL('studio/lib/'+name,root));
for(const name of ['icon.svg','icon-192.png','icon-512.png','maskable-512.png','apple-touch-icon.png'])await copyFile(new URL('dist/icons/'+name,root),new URL('studio/icons/'+name,root));
await copyFile(new URL('dist/styles.css',root),new URL('studio/base.css',root));
console.log('Studio: shared, readable modules copied. No Study runtime dependency.');
