import { el, button, icon } from './dom.js';
import { assetBlob } from './storage.js';
import { annotationRenderer } from './annotation-view.js';

const viewerMode = value => value === 'fill' ? 'fill' : 'fit';

export function imageViewer(record, caseData, { allowAnnotations=true, onSelect=()=>{}, exercise=null, comparisons=[], allowLayers=true, mode='fit', onModeChange=()=>{} }={}) {
  const primary = caseData.images.filter(image => image.role !== 'comparison');
  const images = primary.length ? primary : caseData.images.slice(0, 1);
  let image=images[0],url,disposed=false,zoom=1,showAll=Boolean(allowAnnotations),activeItem=null,loadId=0;
  let displayMode=viewerMode(mode),naturalWidth=0,naturalHeight=0,appliedWidth=0,appliedHeight=0,resizeObserver=null,pan=null;
  const marks=[],offUrls=[];
  const picture=el('img',{class:'radiograph',alt:`Radiografie: ${caseData.title}`,draggable:'false'});
  const overlay=document.createElementNS('http://www.w3.org/2000/svg','svg');
  overlay.setAttribute('viewBox','0 0 1000 1000');overlay.setAttribute('preserveAspectRatio','none');overlay.setAttribute('class','annotation-layer');overlay.setAttribute('aria-label','Marcaje pe radiografie');
  const canvas=el('div',{class:'image-canvas'},picture,overlay);
  const stage=el('div',{class:'image-stage',tabindex:'0','aria-label':'Radiografie. Comută între potrivire și umplere, ajustează zoomul sau trage imaginea pentru a o deplasa.'},canvas);
  const loading=el('div',{class:'image-loading'},'Se încarcă imaginea…');
  stage.append(loading);
  const zoomLabel=el('span',{class:'zoom-label'},'100%');

  function overflowing(){
    return stage.scrollWidth-stage.clientWidth>1 || stage.scrollHeight-stage.clientHeight>1;
  }
  function syncPannable(){
    canvas.classList.toggle('pannable',overflowing());
  }
  function stageFocus(){
    const box=stage.getBoundingClientRect(),area=canvas.getBoundingClientRect();
    if(!area.width || !area.height)return {x:.5,y:.5};
    return {x:(box.left+stage.clientWidth/2-area.left)/area.width,y:(box.top+stage.clientHeight/2-area.top)/area.height};
  }
  function applySize(keepCenter=false){
    if(disposed || !naturalWidth || !naturalHeight)return;
    const boxWidth=stage.clientWidth,boxHeight=stage.clientHeight;
    if(!boxWidth || !boxHeight)return;
    const focus=keepCenter?stageFocus():null;
    const scale=displayMode==='fill'?Math.max(boxWidth/naturalWidth,boxHeight/naturalHeight):Math.min(boxWidth/naturalWidth,boxHeight/naturalHeight);
    const width=naturalWidth*scale*zoom,height=naturalHeight*scale*zoom;
    if(Math.abs(width-appliedWidth)>.01 || Math.abs(height-appliedHeight)>.01){
      canvas.style.width=`${width}px`;canvas.style.height=`${height}px`;appliedWidth=width;appliedHeight=height;
    }
    if(focus){
      stage.scrollLeft=focus.x*width-boxWidth/2;
      stage.scrollTop=focus.y*height-boxHeight/2;
    }
    syncPannable();
  }
  function setZoom(value){
    const next=Math.max(1,Math.min(3,Math.round(value*4)/4));
    if(next===zoom)return;
    zoom=next;zoomLabel.textContent=`${Math.round(zoom*100)}%`;applySize(true);
  }
  function resetView(){
    zoom=1;zoomLabel.textContent='100%';applySize();stage.scrollTo(0,0);
  }
  const fitButton=button('Fit',()=>setMode('fit'),'viewer-tool mode-button',{'aria-pressed':'true',title:'Întreaga imagine, încadrată în vizualizator'});
  const fillButton=button('Fill',()=>setMode('fill'),'viewer-tool mode-button',{'aria-pressed':'false',title:'Imaginea umple vizualizatorul; derulează sau trage pentru rest'});
  function syncMode(){
    const fill=displayMode==='fill';
    fitButton.setAttribute('aria-pressed',String(!fill));fillButton.setAttribute('aria-pressed',String(fill));
    fitButton.classList.toggle('active',!fill);fillButton.classList.toggle('active',fill);
    stage.classList.toggle('fit-mode',!fill);stage.classList.toggle('fill-mode',fill);
  }
  function setMode(next){
    const value=viewerMode(next);
    if(value===displayMode)return;
    displayMode=value;zoom=1;zoomLabel.textContent='100%';syncMode();applySize();stage.scrollTo(0,0);
    onModeChange(value);
  }

  function endPan(event){
    if(!pan || (event && event.pointerId!==pan.id))return;
    const id=pan.id;pan=null;canvas.classList.remove('panning');
    try{if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);}catch{}
  }
  canvas.addEventListener('pointerdown',event=>{
    if(!event.isPrimary || event.button!==0 || disposed)return;
    if(event.target?.closest?.('.annotation'))return;
    if(!overflowing())return;
    pan={id:event.pointerId,x:event.clientX,y:event.clientY,left:stage.scrollLeft,top:stage.scrollTop};
    canvas.classList.add('panning');
    try{canvas.setPointerCapture(event.pointerId);}catch{}
    event.preventDefault();
  });
  canvas.addEventListener('pointermove',event=>{
    if(!pan || event.pointerId!==pan.id)return;
    stage.scrollLeft=pan.left-(event.clientX-pan.x);
    stage.scrollTop=pan.top-(event.clientY-pan.y);
    event.preventDefault();
  });
  canvas.addEventListener('pointerup',endPan);
  canvas.addEventListener('pointercancel',endPan);
  canvas.addEventListener('lostpointercapture',endPan);
  canvas.addEventListener('dragstart',event=>event.preventDefault());

  const handleResize=()=>{if(!disposed)applySize(true);};
  if(typeof ResizeObserver==='function'){resizeObserver=new ResizeObserver(handleResize);resizeObserver.observe(stage);}
  window.addEventListener('resize',handleResize);

  const annotationsButton=allowAnnotations && !exercise && caseData.annotations.length?button([icon('eye',17),'Repere'],()=>{showAll=!showAll;annotationsButton.setAttribute('aria-pressed',String(showAll));refresh();},'viewer-tool',{'aria-pressed':String(showAll),title:showAll?'Ascunde reperele':'Afișează reperele'}):null;
  const root=el('section',{class:'viewer','aria-label':'Vizualizator radiografie'},
    el('div',{class:'viewer-top'},el('span',{class:'film-label'},'RADIOGRAFIE'),el('span',{class:'film-index'},exercise?caseData.title:caseData.source.page?`Sursa · p. ${caseData.source.page}`:caseData.title)),
    stage,
    el('div',{class:'viewer-controls'},
      el('div',{class:'mode-controls',role:'group','aria-label':'Mod de afișare'},fitButton,fillButton),
      el('div',{class:'zoom-controls'},button('−',()=>setZoom(zoom-.25),'viewer-tool',{'aria-label':'Micșorează imaginea'}),zoomLabel,button('+',()=>setZoom(zoom+.25),'viewer-tool',{'aria-label':'Mărește imaginea'}),button('Reset',resetView,'viewer-tool')),
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
      picture.onload=()=>{
        loading.hidden=true;
        naturalWidth=picture.naturalWidth || 0;naturalHeight=picture.naturalHeight || 0;
        appliedWidth=0;appliedHeight=0;applySize();
      };
      picture.onerror=()=>{loading.hidden=false;loading.textContent='Imaginea nu poate fi afișată. Reimportă pachetul.';};picture.src=url;
    }catch(error){loading.textContent=error.message;}
  }
  syncMode();
  load(image);
  return {node:root,selectItem(id){activeItem=id;showAll=Boolean(allowAnnotations);annotationsButton?.setAttribute('aria-pressed',String(showAll));refresh();},
    destroy(){disposed=true;resizeObserver?.disconnect();resizeObserver=null;window.removeEventListener('resize',handleResize);endPan();if(url)URL.revokeObjectURL(url);for(const objectUrl of offUrls)URL.revokeObjectURL(objectUrl);offUrls.length=0;}};
}
