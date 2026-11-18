import { el, button, icon } from './dom.js';
import { assetBlob } from './storage.js';
import { annotationRenderer } from './annotation-view.js';

export function imageViewer(record, caseData, { allowAnnotations=true, onSelect=()=>{}, exercise=null, comparisons=[], allowLayers=true }={}) {
  const primary = caseData.images.filter(image => image.role !== 'comparison');
  const images = primary.length ? primary : caseData.images.slice(0, 1);
  let image=images[0],url,disposed=false,zoom=1,showAll=Boolean(allowAnnotations),activeItem=null,loadId=0;
  const marks=[],offUrls=[];
  const picture=el('img',{class:'radiograph',alt:`Radiografie: ${caseData.title}`,draggable:'false'});
  const overlay=document.createElementNS('http://www.w3.org/2000/svg','svg');
  overlay.setAttribute('viewBox','0 0 1000 1000');overlay.setAttribute('preserveAspectRatio','none');overlay.setAttribute('class','annotation-layer');overlay.setAttribute('aria-label','Marcaje pe radiografie');
  const canvas=el('div',{class:'image-canvas'},picture,overlay);
  const stage=el('div',{class:'image-stage',tabindex:'0','aria-label':'Radiografie. Folosește comenzile de zoom și derularea pentru detalii.'},canvas);
  const loading=el('div',{class:'image-loading'},'Se încarcă imaginea…');
  stage.append(loading);
  const zoomLabel=el('span',{class:'zoom-label'},'100%');
  function setZoom(value){zoom=Math.max(1,Math.min(3,value));canvas.style.width=`${zoom*100}%`;zoomLabel.textContent=`${Math.round(zoom*100)}%`;}
  const annotationsButton=allowAnnotations && !exercise && caseData.annotations.length?button([icon('eye',17),'Repere'],()=>{showAll=!showAll;annotationsButton.setAttribute('aria-pressed',String(showAll));refresh();},'viewer-tool',{'aria-pressed':String(showAll),title:showAll?'Ascunde reperele':'Afișează reperele'}):null;
  const root=el('section',{class:'viewer','aria-label':'Vizualizator radiografie'},
    el('div',{class:'viewer-top'},el('span',{class:'film-label'},'RADIOGRAFIE'),el('span',{class:'film-index'},exercise?caseData.title:caseData.source.page?`Sursa · p. ${caseData.source.page}`:caseData.title)),
    stage,
    el('div',{class:'viewer-controls'},
      el('div',{class:'zoom-controls'},button('−',()=>setZoom(zoom-.25),'viewer-tool',{'aria-label':'Micșorează imaginea'}),zoomLabel,button('+',()=>setZoom(zoom+.25),'viewer-tool',{'aria-label':'Mărește imaginea'}),button('Reset',()=>{setZoom(1);stage.scrollTo(0,0);},'viewer-tool')),
      el('div',{class:'viewer-extra'},allowLayers?annotationsButton:null,
        button(icon('expand',18),async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(root.requestFullscreen)await root.requestFullscreen();}catch{}},'viewer-tool',{'aria-label':'Radiografie pe tot ecranul'}))));
  if(images.length>1)root.append(el('div',{class:'image-tabs'},...images.map((item,index)=>button(`Imaginea ${index+1}`,()=>load(item),'chip'))));

  const activeComparisons = new Set();
  const comparisonBar = comparisons.length ? el('div',{class:'viewer-layers','aria-label':'Straturi de comparație'},el('span',{class:'field-label'},'Compară cu')) : null;
  const comparisonPanels = comparisons.length ? el('div',{class:'viewer-comparisons'}) : null;
  const comparisonUrls = new Map();
  if (comparisons.length) {
    const limit = 2;
    for (const [index, row] of comparisons.entries()) {
      const toggle = button(row.label, () => {
        if (activeComparisons.has(row)) activeComparisons.delete(row);
        else {
          if (activeComparisons.size >= limit) activeComparisons.delete([...activeComparisons][0]);
          activeComparisons.add(row);
        }
        drawComparisons();
      }, 'chip', { 'aria-pressed': 'false' });
      row.toggle = toggle; comparisonBar.append(toggle);
    }
    root.append(comparisonBar, comparisonPanels);
    drawComparisons();
  }

  function paintComparisons() {
    comparisonPanels.replaceChildren();
    for (const row of activeComparisons) {
      const img = el('img', { class: 'radiograph', alt: `Comparație: ${row.label}` });
      const panel = el('figure', { class: 'comparison-panel' }, img, el('figcaption', {}, row.label));
      comparisonPanels.append(panel);
      if (comparisonUrls.has(row.path)) { img.src = comparisonUrls.get(row.path); continue; }
      assetBlob(record, row.path).then(blob => {
        if (disposed || !blob) return;
        const objectUrl = URL.createObjectURL(blob);
        comparisonUrls.set(row.path, objectUrl); offUrls.push(objectUrl);
        if (activeComparisons.has(row)) img.src = objectUrl;
      }).catch(() => {});
    }
  }
  function drawComparisons() {
    if (!comparisonPanels) return;
    comparisonPanels.hidden = activeComparisons.size === 0;
    for (const row of comparisons) {
      const active = activeComparisons.has(row);
      row.toggle?.classList.toggle('active', active);
      row.toggle?.setAttribute('aria-pressed', String(active));
    }
    paintComparisons();
  }

  function refresh(){
    for(const {node,row} of marks){const selected=row.itemId===activeItem;node.classList.toggle('active',selected);node.classList.toggle('annotation-hidden',!showAll);}
  }
  function regionRows(){
    if(!exercise)return caseData.annotations.filter(row=>row.imageId===image.id);
    const allowed=new Set(exercise.regions.map(region=>region.annotationId));
    return caseData.annotations.filter(row=>row.imageId===image.id && allowed.has(row.id));
  }
  function regionLabel(row,index){
    if(!exercise)return row.label || String(index+1);
    return exercise.regions.find(region=>region.annotationId===row.id)?.label || String(index+1);
  }
  function draw(){
    overlay.replaceChildren();marks.length=0;
    if(!allowAnnotations)return;
    const render = annotationRenderer(overlay, { neutral: Boolean(exercise) });
    for(const [index,row] of regionRows().entries()){
      const labelNumber=regionLabel(row,index);
      const group=render(row,{label:labelNumber});
      group.setAttribute('tabindex','0');group.setAttribute('role','button');
      const item=caseData.sections.flatMap(section=>section.items).find(item=>item.id===row.itemId);
      group.setAttribute('aria-label',exercise?`Regiunea ${labelNumber}`:`Marcaj ${labelNumber}: ${item?.text || ''}`);
      const select=()=>{activeItem=row.itemId;showAll=true;annotationsButton?.setAttribute('aria-pressed','true');refresh();onSelect(exercise?row.id:row.itemId);};
      group.addEventListener('click',select);group.addEventListener('keydown',event=>{if(event.key==='Enter' || event.key===' '){event.preventDefault();select();}});
      overlay.append(group);marks.push({node:group,row});
    }
    refresh();
  }
  async function load(next){
    image=next;const current=++loadId;loading.hidden=false;draw();
    try{
      const blob=await assetBlob(record,image.path);
      if(disposed || current!==loadId)return;
      if(!blob)throw new Error('Imaginea lipsește. Reimportă pachetul original.');
      if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(blob);
      picture.onload=()=>{loading.hidden=true;};picture.onerror=()=>{loading.hidden=false;loading.textContent='Imaginea nu poate fi afișată. Reimportă pachetul.';};picture.src=url;
    }catch(error){loading.textContent=error.message;}
  }
  load(image);
  return {node:root,selectItem(id){activeItem=id;showAll=Boolean(allowAnnotations);annotationsButton?.setAttribute('aria-pressed',String(showAll));refresh();},
    destroy(){disposed=true;if(url)URL.revokeObjectURL(url);for(const objectUrl of offUrls)URL.revokeObjectURL(objectUrl);offUrls.length=0;}};
}
