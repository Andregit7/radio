export const LIMITS = Object.freeze({ archive: 32 * 1024 * 1024, total: 64 * 1024 * 1024,
  entry: 12 * 1024 * 1024, json: 3 * 1024 * 1024, entries: 1200, cases: 500, diagnoses: 2500,
  pixels: 12_000_000, questions: 6000 });

export function requireThat(condition, message) { if (!condition) throw new Error(message); }
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 20000) => typeof value === 'string' && value.length <= max;
const id = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
const list = (value, max) => Array.isArray(value) && value.length <= max;
const unique = rows => new Set(rows.map(row => row.id)).size === rows.length;
const strings = (rows, max = 100) => list(rows, max) && rows.every(value => text(value, 400));
const range = value => Number.isFinite(value) && value >= 0 && value <= 1;
export const safePath = value => typeof value === 'string' && value.length <= 220 &&
  /^[a-zA-Z0-9_./-]+$/.test(value) && !value.startsWith('/') && !value.includes('..') && !value.includes('//') && !value.endsWith('/');

export function parseJSON(value, max = LIMITS.json) {
  requireThat(typeof value === 'string' && new TextEncoder().encode(value).length <= max, 'Fișierul JSON depășește limita permisă.');
  try { return JSON.parse(value, (key, item) => {
    requireThat(!['__proto__', 'prototype', 'constructor'].includes(key), 'Cheie JSON nesigură.'); return item;
  }); } catch (error) { throw new Error(`JSON invalid: ${error.message}`); }
}

export function validateAnnotation(row, imageIds, itemIds) {
  requireThat(object(row) && id(row.id) && imageIds.has(row.imageId) && itemIds.has(row.itemId), 'Adnotare cu referințe invalide.');
  requireThat(['ellipse', 'rect', 'polygon', 'arrow'].includes(row.shape), 'Formă de adnotare nesuportată.');
  if (row.shape === 'ellipse') requireThat([row.cx, row.cy, row.rx, row.ry].every(range) && row.rx > 0 && row.ry > 0, 'Elipsă invalidă.');
  if (row.shape === 'rect') requireThat([row.x, row.y, row.width, row.height].every(range) && row.width > 0 && row.height > 0, 'Dreptunghi invalid.');
  if (row.shape === 'arrow') requireThat([row.x1, row.y1, row.x2, row.y2].every(range), 'Săgeată invalidă.');
  if (row.shape === 'polygon') requireThat(list(row.points, 100) && row.points.length >= 3 && row.points.every(p => Array.isArray(p) && p.length === 2 && p.every(range)), 'Poligon invalid.');
  return { id: row.id, imageId: row.imageId, itemId: row.itemId, shape: row.shape,
    ...Object.fromEntries(['cx','cy','rx','ry','x','y','width','height','x1','y1','x2','y2'].filter(k => k in row).map(k => [k, row[k]])),
    ...(row.points ? { points: row.points.map(p => [...p]) } : {}),
    label: text(row.label, 80) ? row.label : '', reviewStatus: row.reviewStatus === 'reviewed' ? 'reviewed' : 'draft' };
}

export function validatePack(raw) {
  requireThat(object(raw) && raw.format === 'radiology-study-pack' && raw.version === 1, 'Acest format de pachet nu este compatibil cu RadioEasy v1.');
  requireThat(id(raw.id) && text(raw.title, 200) && raw.title.trim() && text(raw.revision, 60) && raw.revision.trim(), 'Identificarea pachetului este incompletă.');
  const curriculum = raw.curriculum;
  requireThat(object(curriculum) && id(curriculum.id) && text(curriculum.title, 200) && list(curriculum.chapters, 50) && curriculum.chapters.length, 'Curriculum invalid.');
  requireThat(curriculum.chapters.every(c => object(c) && id(c.id) && text(c.label, 120)) && unique(curriculum.chapters), 'Capitole invalide sau duplicate.');
  const chapterIds = new Set(curriculum.chapters.map(row => row.id));
  const scopes = curriculum.scopes || [{ id: 'all', label: 'Toată materia', chapterIds: [...chapterIds] }];
  requireThat(list(scopes, 30) && unique(scopes) && scopes.every(row => id(row.id) && text(row.label, 160) && list(row.chapterIds, 50) && row.chapterIds.length && row.chapterIds.every(v => chapterIds.has(v))), 'Domenii de examen invalide.');
  requireThat(list(raw.diagnoses, LIMITS.diagnoses) && unique(raw.diagnoses), 'Catalog de diagnostice invalid.');
  requireThat(raw.diagnoses.every(row => object(row) && id(row.id) && text(row.label, 400) && row.label.trim() &&
    list(row.chapterIds, 50) && row.chapterIds.length && row.chapterIds.every(v => chapterIds.has(v)) && strings(row.aliases || [])), 'Diagnostic invalid în catalog.');
  const diagnosisIds = new Set(raw.diagnoses.map(row => row.id));
  requireThat(list(raw.cases, LIMITS.cases) && raw.cases.length && unique(raw.cases), 'Lista de cazuri este goală sau invalidă.');
  const assets = new Map();
  const cases = raw.cases.map(item => {
    requireThat(object(item) && id(item.id) && chapterIds.has(item.chapterId) && text(item.title, 200) && list(item.diagnosisIds, 20) && item.diagnosisIds.every(v => diagnosisIds.has(v)), 'Caz cu identificare sau diagnostic invalid.');
    requireThat(list(item.images, 8) && item.images.length && unique(item.images), 'Imaginile cazului sunt invalide.');
    const images = item.images.map(image => {
      requireThat(object(image) && id(image.id) && safePath(image.path) && /^images\/.+\.(png|jpe?g)$/i.test(image.path), 'Sunt acceptate numai imagini PNG/JPEG în directorul images/.');
      requireThat(Number.isInteger(image.width) && Number.isInteger(image.height) && image.width > 0 && image.height > 0 && image.width * image.height <= LIMITS.pixels, 'Dimensiuni de imagine invalide.');
      requireThat(!image.sha256 || /^[a-f0-9]{64}$/i.test(image.sha256), 'Sumă de control invalidă.');
      if (assets.has(image.path)) requireThat(assets.get(image.path).width === image.width && assets.get(image.path).height === image.height && assets.get(image.path).sha256 === image.sha256, 'Imagine reutilizată cu metadate contradictorii.');
      const clean = { id: image.id, path: image.path, width: image.width, height: image.height, ...(image.sha256 ? {sha256:image.sha256.toLowerCase()} : {}) };
      assets.set(image.path, clean); return clean;
    });
    requireThat(list(item.sections, 6) && unique(item.sections), 'Secțiunile cazului sunt invalide.');
    const sections = item.sections.map(section => {
      requireThat(['examination','projection','findings','diagnosis','differentials','investigations'].includes(section.id) && text(section.label, 120) && list(section.items, 100) && unique(section.items), 'Secțiune nesuportată.');
      requireThat(section.items.every(row => object(row) && id(row.id) && text(row.text)), 'Text sau identificator invalid.');
      return { id: section.id, label: section.label, items: section.items.map(row => ({ id: row.id, text: row.text })), status: section.items.length ? 'present' : 'missing' };
    });
    const itemIds = new Set(sections.flatMap(row => row.items.map(point => point.id)));
    requireThat(itemIds.size === sections.reduce((n, section) => n + section.items.length, 0), 'Identificatori de observații duplicați.');
    requireThat(list(item.annotations || [], 1000), 'Prea multe adnotări.');
    const annotations = (item.annotations || []).map(row => validateAnnotation(row, new Set(images.map(image => image.id)), itemIds));
    requireThat(unique(annotations), 'Identificatori de adnotări duplicați.');
    return { id:item.id, title:item.title, chapterId:item.chapterId, diagnosisIds:[...item.diagnosisIds], images, sections, annotations,
      referenceText: text(item.referenceText, 30000) ? item.referenceText : '',
      source: { document: text(item.source?.document, 200) ? item.source.document : '', page: Number.isInteger(item.source?.page) && item.source.page > 0 ? item.source.page : null },
      completeness: ['full','partial','diagnosis-only'].includes(item.completeness) ? item.completeness : 'partial' };
  });
  const clean = { format:raw.format,version:1,id:raw.id,revision:raw.revision,title:raw.title,
    description:text(raw.description, 3000) ? raw.description : '',language:text(raw.language, 20) ? raw.language : 'ro',
    source: {document:text(raw.source?.document, 200) ? raw.source.document : '',note:text(raw.source?.note, 3000) ? raw.source.note : ''},
    curriculum: {id:curriculum.id,title:curriculum.title,edition:text(curriculum.edition, 100) ? curriculum.edition : '',chapters:curriculum.chapters.map(c => ({id:c.id,label:c.label})),scopes:scopes.map(s => ({id:s.id,label:s.label,chapterIds:[...s.chapterIds]}))},
    diagnoses:raw.diagnoses.map(d => ({id:d.id,label:d.label,chapterIds:[...d.chapterIds],aliases:[...(d.aliases || [])]})),cases };
  return {pack:clean,assets};
}

export function validateQuestions(raw, pack) {
  if (raw == null) return null;
  requireThat(object(raw) && raw.format === 'radiology-question-bank' && raw.version === 1 && raw.packId === pack.id && raw.revision === pack.revision, 'Banca de întrebări nu corespunde versiunii pachetului.');
  requireThat(list(raw.items, LIMITS.questions) && unique(raw.items), 'Bancă de întrebări invalidă.');
  const cases = new Set(pack.cases.map(row => row.id));
  const items = raw.items.map(row => {
    requireThat(object(row) && id(row.id) && cases.has(row.caseId) && row.kind === 'mcq' && text(row.prompt, 2000) && row.prompt.trim(), 'Întrebare invalidă.');
    requireThat(list(row.options, 8) && row.options.length >= 2 && unique(row.options) && row.options.every(o => id(o.id) && text(o.label, 1500) && o.label.trim() && text(o.feedback || '', 4000)), 'Opțiuni invalide sau necompletate.');
    requireThat(new Set(row.options.map(o=>o.label.trim().toLocaleLowerCase('ro'))).size===row.options.length, 'Opțiuni de răspuns duplicate.');
    const options = new Set(row.options.map(o => o.id));
    requireThat(list(row.correctOptionIds, 8) && row.correctOptionIds.length > 0 && row.correctOptionIds.every(v => options.has(v)) && new Set(row.correctOptionIds).size === row.correctOptionIds.length, 'Cheie de răspuns invalidă.');
    requireThat(['examination','projection','findings','diagnosis','differentials','investigations'].includes(row.sectionId) && text(row.feedback || '', 10000), 'Secțiune sau explicație invalidă.');
    return { id:row.id,caseId:row.caseId,kind:'mcq',sectionId:row.sectionId,prompt:row.prompt,
      correctOptionIds:[...row.correctOptionIds],options:row.options.map(o=>({id:o.id,label:o.label,feedback:o.feedback || ''})),
      feedback:row.feedback || '',reviewStatus:['reviewed','source-derived','draft'].includes(row.reviewStatus) ? row.reviewStatus : 'draft' };
  });
  return {format:raw.format,version:1,packId:pack.id,revision:pack.revision,items};
}

export function imageDimensions(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && bytes[0]===137 && bytes[1]===80 && bytes[2]===78 && bytes[3]===71 && view.getUint32(4)===0x0d0a1a0a && view.getUint32(12)===0x49484452)
    return {width:view.getUint32(16),height:view.getUint32(20),mime:'image/png'};
  if (bytes[0]===255 && bytes[1]===216) {
    let p=2;
    while(p+4<=bytes.length) {
      requireThat(bytes[p]===255,'Structură JPEG invalidă.');
      while(bytes[p]===255) p++;
      const marker=bytes[p++];
      if(marker===0xd9 || marker===0xda) break;
      if(marker===0x01 || (marker>=0xd0 && marker<=0xd7)) continue;
      if(p+2>bytes.length) break;
      const size=view.getUint16(p);
      requireThat(size>=2 && p+size<=bytes.length,'Segment JPEG invalid.');
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        requireThat(size>=8,'JPEG incomplet.');
        return {height:view.getUint16(p+3),width:view.getUint16(p+5),mime:'image/jpeg'};
      }
      p+=size;
    }
  }
  throw new Error('Imagine PNG/JPEG invalidă sau nesuportată.');
}

export async function validateFiles(files, onProgress = () => {}) {
  const map = files instanceof Map ? files : new Map(files.map(f=>[f.name, f.data]));
  requireThat(map.has('pack.json'), 'Lipsește pack.json din rădăcina arhivei.');
  const decode = data => {requireThat(data.byteLength<=LIMITS.json,'Fișierul JSON depășește limita de 3 MiB.');return new TextDecoder('utf-8',{fatal:true}).decode(data);};
  const {pack,assets} = validatePack(parseJSON(decode(map.get('pack.json'))));
  const bank = map.has('questions.json') ? validateQuestions(parseJSON(decode(map.get('questions.json'))),pack) : null;
  const blobs = [];
  let total=map.get('pack.json').byteLength+(map.get('questions.json')?.byteLength || 0);
  for(const [path,metadata] of assets) {
    const data=map.get(path);
    requireThat(data && data.byteLength<=LIMITS.entry, `Imagine lipsă sau prea mare: ${path}`);
    const dims=imageDimensions(data);
    requireThat(dims.width===metadata.width && dims.height===metadata.height && dims.width*dims.height<=LIMITS.pixels, `Dimensiuni diferite pentru ${path}`);
    requireThat((dims.mime==='image/png')===path.toLowerCase().endsWith('.png'), 'Extensia imaginii nu corespunde conținutului.');
    if(metadata.sha256) {
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
      requireThat(hash===metadata.sha256, `Imagine coruptă: ${path}`);
    }
    total+=data.byteLength; blobs.push({path,blob:new Blob([data],{type:dims.mime})});
    onProgress(blobs.length/assets.size);
  }
  const expected=new Set(['pack.json','questions.json',...assets.keys()]);
  requireThat([...map.keys()].every(path=>expected.has(path)), 'Arhiva conține fișiere neutilizate. Exportă un pachet curat din Studio.');
  return {pack,bank,blobs,total};
}
