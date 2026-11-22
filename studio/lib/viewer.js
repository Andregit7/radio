import { el, button, icon } from './dom.js';
import { annotationNumbers, annotationRenderer, annotationsInObservationOrder } from './annotation-view.js';

const viewerMode = value => value === 'fill' ? 'fill' : 'fit';

export function imageViewer(record, caseData, { allowAnnotations=true, onSelect=()=>{}, exercise=null, comparisons=[], allowLayers=true,
  mode='fit', onModeChange=()=>{}, loadAsset=async path=>(await import('./storage.js')).assetBlob(record,path), initialImageId, initialComparisonId }={}) {
  const primary = caseData.images.filter(image => image.role !== 'comparison');
  const images = primary.length ? primary : caseData.images.slice(0, 1);
  const annotationOrder=annotationsInObservationOrder(caseData), numbers=annotationNumbers(caseData);
  const notes=new Map(caseData.sections.flatMap(section=>section.items.map(item=>[item.id,item.text])));
  let image=images.find(row=>row.id===initialImageId) || images[0],url,disposed=false,zoom=1,showAll=Boolean(allowAnnotations),activeItem=null,loadId=0;
  let displayMode=viewerMode(mode),naturalWidth=0,naturalHeight=0,appliedWidth=0,appliedHeight=0,resizeObserver=null,pan=null;
  const marks=[],offUrls=[];
  const picture=el('img',{class:'radiograph',alt:`Radiografie: ${caseData.title}`,draggable:'false'});
  const overlay=document.createElementNS('http://www.w3.org/2000/svg','svg');
  overlay.setAttribute('viewBox','0 0 1000 1000');overlay.setAttribute('preserveAspectRatio','none');overlay.setAttribute('class','annotation-layer');overlay.setAttribute('aria-label','Marcaje pe radiografie');
  const canvas=el('div',{class:'image-canvas'},picture,overlay);
  const stage=el('div',{class:'image-stage',tabindex:'0','aria-label':'Radiografie. Comută între potrivire și umplere, ajustează zoomul sau trage imaginea pentru a o deplasa.'},canvas);
  const loading=el('div',{class:'image-loading'},'Se încarcă imaginea…');
  stage.append(loading);
  const stageFrame=el('div',{class:'viewer-stage-frame'},stage);
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
    stageFrame,
    el('div',{class:'viewer-controls'},
      el('div',{class:'mode-controls',role:'group','aria-label':'Mod de afișare'},fitButton,fillButton),
      el('div',{class:'zoom-controls'},button('−',()=>setZoom(zoom-.25),'viewer-tool',{'aria-label':'Micșorează imaginea'}),zoomLabel,button('+',()=>setZoom(zoom+.25),'viewer-tool',{'aria-label':'Mărește imaginea'}),button('Reset',resetView,'viewer-tool')),
      el('div',{class:'viewer-extra'},allowLayers?annotationsButton:null,
        button(icon('expand',18),async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(root.requestFullscreen)await root.requestFullscreen();}catch{}},'viewer-tool',{'aria-label':'Radiografie pe tot ecranul'}))));
  const primaryTabs=images.length>1 ? images.map((item,index)=>button(`Imaginea ${index+1}`,()=>{
    image=item;
    selectLayer(0);
  },'chip',{'aria-pressed':String(item===image)})) : [];
  if(primaryTabs.length)root.append(el('div',{class:'image-tabs'},...primaryTabs));

  const activeComparisons = new Set();
  const comparisonButtons = new Map();
  const comparisonBar = comparisons.length ? el('div',{class:'viewer-layers','aria-label':'Straturi de comparație'},el('span',{class:'field-label'},'Compară cu')) : null;
  const comparisonPanels = comparisons.length ? el('div',{class:'viewer-comparisons'}) : null;
  const comparisonUrls = new Map();
  let layerIndex=0;
  const layerSelect=comparisons.length ? el('select',{'aria-label':'Strat afișat pe radiografie',onchange:event=>selectLayer(Number(event.target.value))},
    el('option',{value:'0'},'Radiografia principală'),
    ...comparisons.map((row,index)=>el('option',{value:String(index+1)},row.label))) : null;
  if (comparisons.length) {
    const limit = 2;
    const cycle=offset=>selectLayer((layerIndex+offset+comparisons.length+1)%(comparisons.length+1));
    stageFrame.append(el('div',{class:'viewer-layer-switch',role:'group','aria-label':'Schimbă stratul afișat'},
      button('‹',()=>cycle(-1),'viewer-tool',{'aria-label':'Stratul anterior',title:'Stratul anterior [','aria-keyshortcuts':'['}),
      layerSelect,
      button('›',()=>cycle(1),'viewer-tool',{'aria-label':'Stratul următor',title:'Stratul următor ]','aria-keyshortcuts':']'})));
    root.addEventListener('keydown',event=>{
      if (event.altKey || event.ctrlKey || event.metaKey || event.target===layerSelect) return;
      const previous=event.key==='[' || (event.target===stage && event.key==='ArrowLeft');
      const next=event.key===']' || (event.target===stage && event.key==='ArrowRight');
      if (!previous && !next) return;
      event.preventDefault();
      cycle(previous ? -1 : 1);
    });
    for (const row of comparisons) {
      const toggle = button(row.label, () => {
        if (activeComparisons.has(row)) activeComparisons.delete(row);
        else {
          if (activeComparisons.size >= limit) activeComparisons.delete([...activeComparisons][0]);
          activeComparisons.add(row);
        }
        drawComparisons();
      }, 'chip', { 'aria-pressed': 'false' });
      comparisonButtons.set(row,toggle);
      comparisonBar.append(toggle);
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
      if (!comparisonUrls.has(row.path)) {
        const loaded=Promise.resolve().then(()=>loadAsset(row.path)).then(blob=>{
          if (!blob || disposed) return null;
          const objectUrl=URL.createObjectURL(blob);
          offUrls.push(objectUrl);
          return objectUrl;
        }).catch(()=>null);
        comparisonUrls.set(row.path,loaded);
      }
      comparisonUrls.get(row.path).then(objectUrl=>{if(objectUrl && !disposed && activeComparisons.has(row))img.src=objectUrl;});
    }
  }
  function drawComparisons() {
    if (!comparisonPanels) return;
    comparisonPanels.hidden = activeComparisons.size === 0;
    for (const [row,toggle] of comparisonButtons) {
      const active = activeComparisons.has(row);
      toggle.classList.toggle('active', active);
      toggle.setAttribute('aria-pressed', String(active));
    }
    paintComparisons();
  }

  function refresh(){
    for(const {node,row} of marks){const selected=row.itemId===activeItem;node.classList.toggle('active',selected);node.classList.toggle('annotation-hidden',!showAll);}
  }
  function regionRows(){
    const imageId=layerIndex ? comparisons[layerIndex-1].imageId : image.id;
    if(!exercise)return annotationOrder.filter(row=>row.imageId===imageId);
    const allowed=new Set(exercise.regions.map(region=>region.annotationId));
    return annotationOrder.filter(row=>row.imageId===imageId && allowed.has(row.id));
  }
  function regionLabel(row,index){
    if(!exercise)return numbers.get(row.id) || String(index+1);
    return exercise.regions.find(region=>region.annotationId===row.id)?.label || String(index+1);
  }
  function draw(){
    overlay.replaceChildren();marks.length=0;
    if(!allowAnnotations)return;
    const render = annotationRenderer(overlay, { neutral: Boolean(exercise) });
    for(const [index,row] of regionRows().entries()){
      const labelNumber=regionLabel(row,index);
      const group=render(row,{label:labelNumber,interactive:true});
      group.setAttribute('tabindex','0');group.setAttribute('role','button');
      group.setAttribute('aria-label',exercise?`Regiunea ${labelNumber}`:`Marcaj ${labelNumber}: ${notes.get(row.itemId) || ''}`);
      const select=()=>{activeItem=row.itemId;showAll=true;annotationsButton?.setAttribute('aria-pressed','true');refresh();onSelect(exercise?row.id:row.itemId);};
      group.addEventListener('click',select);group.addEventListener('keydown',event=>{if(event.key==='Enter' || event.key===' '){event.preventDefault();select();}});
      overlay.append(group);marks.push({node:group,row});
    }
    refresh();
  }
  function selectLayer(index){
    layerIndex=index;
    if(layerSelect)layerSelect.value=String(index);
    const comparison=comparisons[index-1];
    picture.alt=comparison ? `Comparație: ${comparison.label}` : `Radiografie: ${caseData.title}`;
    for(const [tabIndex,tab] of primaryTabs.entries()){
      const active=!comparison && images[tabIndex]===image;
      tab.classList.toggle('active',active);
      tab.setAttribute('aria-pressed',String(active));
    }
    resetView();
    draw();
    load(comparison?.path || image.path);
  }
  async function load(path){
    const current=++loadId;
    loading.textContent='Se încarcă imaginea.';
    loading.hidden=false;
    try{
      const blob=await loadAsset(path);
      if(disposed || current!==loadId)return;
      if(!blob)throw new Error('Imaginea lipsește. Reimportă pachetul original.');
      if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(blob);
      picture.onload=()=>{
        if(disposed || current!==loadId)return;
        loading.hidden=true;
        naturalWidth=picture.naturalWidth || 0;naturalHeight=picture.naturalHeight || 0;
        appliedWidth=0;appliedHeight=0;applySize();
      };
      picture.onerror=()=>{
        if(disposed || current!==loadId)return;
        loading.hidden=false;
        loading.textContent='Imaginea nu poate fi afișată. Reimportă pachetul.';
      };
      picture.src=url;
    }catch(error){if(!disposed && current===loadId)loading.textContent=error.message;}
  }
  syncMode();
  const initialComparison=caseData.images.find(row=>row.id===initialImageId && row.role==='comparison');
  selectLayer(comparisons.findIndex(row=>initialComparisonId ? row.id===initialComparisonId : initialComparison && row.imageId===initialComparison.id)+1);
  return {node:root,selectItem(id){
    activeItem=id;
    showAll=Boolean(allowAnnotations);
    annotationsButton?.setAttribute('aria-pressed',String(showAll));
    if (allowAnnotations && !exercise && !marks.some(({row})=>row.itemId===id)) {
      const linkedImages=new Set(annotationOrder.filter(row=>row.itemId===id).map(row=>row.imageId));
      const primaryImage=images.find(row=>linkedImages.has(row.id));
      const comparisonIndex=comparisons.findIndex(row=>linkedImages.has(row.imageId));
      if (primaryImage) { image=primaryImage; selectLayer(0); }
      else if (comparisonIndex>=0) selectLayer(comparisonIndex+1);
    }
    refresh();
  },
    destroy(){disposed=true;resizeObserver?.disconnect();resizeObserver=null;window.removeEventListener('resize',handleResize);endPan();if(url)URL.revokeObjectURL(url);for(const objectUrl of offUrls)URL.revokeObjectURL(objectUrl);offUrls.length=0;}};
}
