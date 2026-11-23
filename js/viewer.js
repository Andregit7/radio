import { el, button, icon } from './dom.js';
import { annotationNumbers, annotationRenderer, annotationsInObservationOrder, placeAnnotationLabels, raiseAnnotations } from './annotation-view.js';

const viewerMode = value => value === 'fill' ? 'fill' : 'fit';

export function radiographTools(stage, { canZoom, zoom, onMarksChange, buttonClass = 'viewer-tool' }) {
  let visible = false;
  const marksButton = button([icon('eye', 17), 'Repere'], () => onMarksChange(!visible), buttonClass, { 'aria-pressed': 'false' });
  stage.addEventListener('wheel', event => {
    if (!event.deltaY || !canZoom()) return;
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1);
    zoom(Math.min(1.25, Math.max(.8, Math.exp(-delta * .0015))), event);
  }, { passive: false });
  return {
    marksButton,
    syncMarks(hasMarks, showMarks) {
      visible = hasMarks && showMarks;
      marksButton.disabled = !hasMarks;
      marksButton.classList.toggle('active', visible);
      marksButton.setAttribute('aria-pressed', String(visible));
      marksButton.title = !hasMarks ? 'Nu există repere pe această imagine' : visible ? 'Ascunde reperele' : 'Afișează reperele';
    },
  };
}

export function imageViewer(record, caseData, { allowAnnotations=true, onSelect=()=>{}, exercise=null, comparisons=[], compact=false,
  mode='fit', onModeChange=()=>{}, loadAsset=async path=>(await import('./storage.js')).assetBlob(record,path),
  initialImageId, initialComparisonId, singleImageId, initiallyHidden=false }={}) {
  const primary = caseData.images.filter(image => image.role !== 'comparison');
  const singleImage=caseData.images.find(row=>row.id===singleImageId);
  const images=singleImage ? [singleImage] : primary.length ? primary : caseData.images.slice(0, 1);
  const annotationOrder=allowAnnotations ? annotationsInObservationOrder(caseData) : [];
  const numbers=allowAnnotations && !exercise ? annotationNumbers(caseData) : new Map();
  const notes=new Map((caseData.sections || []).flatMap(section=>section.items.map(item=>[item.id,item.text])));
  const regionLabels=new Map((exercise?.regions || []).map(region=>[region.annotationId,region.label]));
  let image=images.find(row=>row.id===initialImageId) || images[0],url,disposed=false,zoom=1,showAll=allowAnnotations&&!initiallyHidden,loadId=0;
  let activeItem=null,activeAnnotation=null;
  let displayMode=viewerMode(mode),naturalWidth=0,naturalHeight=0,appliedWidth=0,appliedHeight=0,resizeObserver=null,pan=null;
  let labelWidth=0,labelHeight=0;
  const marks=[];
  const picture=el('img',{class:'radiograph',alt:`Radiografie: ${caseData.title}`,draggable:'false'});
  const overlay=document.createElementNS('http://www.w3.org/2000/svg','svg');
  overlay.setAttribute('viewBox','0 0 1000 1000');overlay.setAttribute('preserveAspectRatio','none');overlay.setAttribute('class','annotation-layer');overlay.setAttribute('aria-label','Marcaje pe radiografie');
  const canvas=el('div',{class:'image-canvas'},picture,overlay);
  const stage=el('div',{class:'image-stage',tabindex:'0','aria-label':'Radiografie. Rotița ajustează zoomul, trage imaginea pentru a o deplasa, comută între potrivire și umplere.'},canvas);
  const loading=el('div',{class:'image-loading'},'Se încarcă imaginea…');
  stage.append(loading);
  const stageFrame=el('div',{class:'viewer-stage-frame'},stage);
  const zoomLabel=el('span',{class:'zoom-label'},'100%');

  function overflowing(){
    return stage.scrollWidth-stage.clientWidth>1 || stage.scrollHeight-stage.clientHeight>1;
  }
  function layoutLabels(){
    if(!showAll || (appliedWidth===labelWidth && appliedHeight===labelHeight))return;
    labelWidth=appliedWidth;labelHeight=appliedHeight;
    placeAnnotationLabels(marks,appliedWidth,appliedHeight,{neutral:Boolean(exercise)});
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
      layoutLabels();
    }
    if(focus){
      stage.scrollLeft=focus.x*width-boxWidth/2;
      stage.scrollTop=focus.y*height-boxHeight/2;
    }
    stage.classList.toggle('pannable',overflowing());
  }
  function setZoom(value){
    const next=Math.max(1,Math.min(3,Math.round(value*4)/4));
    if(next===zoom)return;
    zoom=next;zoomLabel.textContent=`${Math.round(zoom*100)}%`;applySize(true);
  }
  function zoomAt(clientX,clientY,factor){
    const next=Math.max(1,Math.min(3,Math.round(zoom*factor*100)/100));
    if(next===zoom)return;
    const before=canvas.getBoundingClientRect();
    if(!before.width || !before.height)return;
    const anchor={x:(clientX-before.left)/before.width,y:(clientY-before.top)/before.height};
    zoom=next;zoomLabel.textContent=`${Math.round(zoom*100)}%`;applySize();
    const after=canvas.getBoundingClientRect();
    stage.scrollLeft+=anchor.x*after.width+after.left-clientX;
    stage.scrollTop+=anchor.y*after.height+after.top-clientY;
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
    const id=pan.id;pan=null;stage.classList.remove('panning');
    try{if(stage.hasPointerCapture(id))stage.releasePointerCapture(id);}catch{}
  }
  stage.addEventListener('pointerdown',event=>{
    if(!event.isPrimary || event.button!==0 || disposed)return;
    if(event.target?.closest?.('.annotation'))return;
    if(!overflowing())return;
    pan={id:event.pointerId,x:event.clientX,y:event.clientY,left:stage.scrollLeft,top:stage.scrollTop};
    stage.classList.add('panning');
    try{stage.setPointerCapture(event.pointerId);}catch{}
    event.preventDefault();
  });
  stage.addEventListener('pointermove',event=>{
    if(!pan || event.pointerId!==pan.id)return;
    stage.scrollLeft=pan.left-(event.clientX-pan.x);
    stage.scrollTop=pan.top-(event.clientY-pan.y);
    event.preventDefault();
  });
  stage.addEventListener('pointerup',endPan);
  stage.addEventListener('pointercancel',endPan);
  stage.addEventListener('lostpointercapture',endPan);
  canvas.addEventListener('dragstart',event=>event.preventDefault());

  const handleResize=()=>{if(!disposed)applySize(true);};
  if(typeof ResizeObserver==='function'){resizeObserver=new ResizeObserver(handleResize);resizeObserver.observe(stage);}
  else window.addEventListener('resize',handleResize);

  const tools=radiographTools(stage,{
    canZoom:()=>!disposed && Boolean(naturalWidth),
    zoom:(factor,event)=>zoomAt(event.clientX,event.clientY,factor),
    onMarksChange:visible=>{showAll=visible;refresh();layoutLabels();},
  });
  const fullscreen=button(icon('expand',18),async()=>{
    try{
      if(document.fullscreenElement)await document.exitFullscreen();
      else if(root.requestFullscreen)await root.requestFullscreen();
      else root.classList.toggle('viewer-expanded');
    }catch{root.classList.toggle('viewer-expanded');}
  },'viewer-tool',{'aria-label':'Radiografie pe tot ecranul'});
  const root=el('section',{class:compact?'viewer viewer-compact':'viewer','aria-label':`Vizualizator radiografie: ${caseData.title}`},
    compact?null:el('div',{class:'viewer-top'},el('span',{class:'film-label'},'RADIOGRAFIE'),el('span',{class:'film-index'},exercise?caseData.title:caseData.source?.page?`Sursa · p. ${caseData.source.page}`:caseData.title)),
    stageFrame,
    el('div',{class:'viewer-controls'},
      compact?null:el('div',{class:'mode-controls',role:'group','aria-label':'Mod de afișare'},fitButton,fillButton),
      compact?null:el('div',{class:'zoom-controls'},button('−',()=>setZoom(zoom-.25),'viewer-tool',{'aria-label':'Micșorează imaginea'}),zoomLabel,button('+',()=>setZoom(zoom+.25),'viewer-tool',{'aria-label':'Mărește imaginea'}),button('Reset',resetView,'viewer-tool')),
      el('div',{class:'viewer-extra'},tools.marksButton,compact?null:fullscreen)));
  const primaryTabs=images.length>1 ? images.map((item,index)=>button(`Imaginea ${index+1}`,()=>{
    image=item;
    selectLayer(0);
  },'chip',{'aria-pressed':String(item===image)})) : [];
  if(primaryTabs.length)root.append(el('div',{class:'image-tabs'},...primaryTabs));

  const activeComparisons = new Set();
  const comparisonButtons = new Map();
  const comparisonBar = comparisons.length ? el('div',{class:'viewer-layers','aria-label':'Straturi de comparație'},el('span',{class:'field-label'},'Compară cu')) : null;
  const comparisonPanels = comparisons.length ? el('div',{class:'viewer-comparisons'}) : null;
  const comparisonViewers = new Map();
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
    for (const [row,{ viewer,panel }] of comparisonViewers) {
      if (activeComparisons.has(row)) continue;
      viewer.destroy();
      panel.remove();
      comparisonViewers.delete(row);
    }
    for (const row of activeComparisons) {
      if (comparisonViewers.has(row)) continue;
      const subject = row.imageId ? caseData : {
        title: row.label, images: [{ id: row.id, path: row.path }], sections: [], annotations: [],
      };
      const viewer=imageViewer(record,subject,{loadAsset,compact:true,singleImageId:row.imageId,
        initiallyHidden:true,allowAnnotations:allowAnnotations&&!exercise});
      const panel=el('figure',{class:'comparison-panel'},viewer.node,el('figcaption',{},row.label));
      comparisonViewers.set(row,{viewer,panel});
      comparisonPanels.append(panel);
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
    for(const {node,row} of marks){
      const selected=activeAnnotation ? row===activeAnnotation : row.itemId===activeItem;
      node.classList.toggle('active',selected);
      node.setAttribute('aria-pressed',String(selected));
    }
    overlay.classList.toggle('annotation-hidden',!showAll);
    tools.syncMarks(marks.length>0,showAll);
    raiseAnnotations(marks.map(({node})=>node),node=>node.classList.contains('active'));
  }
  function draw(){
    overlay.replaceChildren();marks.length=0;
    labelWidth=labelHeight=0;
    if(allowAnnotations){
      const comparison=comparisons[layerIndex-1];
      const imageId=comparison ? comparison.imageId : image.id;
      const render=annotationRenderer(overlay,{neutral:Boolean(exercise)});
      const visible=annotationOrder.filter(row=>row.imageId===imageId && (!exercise || regionLabels.has(row.id)));
      for(const [index,row] of visible.entries()){
        const labelNumber=(exercise ? regionLabels : numbers).get(row.id) || String(index+1);
        const group=render(row,{label:labelNumber,interactive:true});
        group.setAttribute('tabindex','0');group.setAttribute('role','button');
        group.setAttribute('aria-label',exercise?`Regiunea ${labelNumber}`:`Marcaj ${labelNumber}: ${notes.get(row.itemId) || ''}`);
        const select=()=>{
          activeAnnotation=row;activeItem=null;refresh();
          onSelect(exercise ? row.id : row.itemId);
        };
        group.addEventListener('click',select);
        group.addEventListener('keydown',event=>{
          if(event.key==='Enter' || event.key===' '){event.preventDefault();select();}
        });
        overlay.append(group);marks.push({node:group,row});
      }
    }
    refresh();
    layoutLabels();
  }
  function showLinkedImage(matches){
    if(marks.some(({row})=>matches(row)))return;
    const linkedImages=new Set(annotationOrder.filter(matches).map(row=>row.imageId));
    const primaryImage=images.find(row=>linkedImages.has(row.id));
    const comparisonIndex=comparisons.findIndex(row=>linkedImages.has(row.imageId));
    if(primaryImage){image=primaryImage;selectLayer(0);}
    else if(comparisonIndex>=0)selectLayer(comparisonIndex+1);
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
  return {
    node:root,
    selectItem(id){
      if(!allowAnnotations || exercise)return;
      activeItem=id;activeAnnotation=null;showAll=true;
      showLinkedImage(row=>row.itemId===id);
      refresh();layoutLabels();
    },
    selectAnnotation(id){
      if(!allowAnnotations)return;
      activeAnnotation=annotationOrder.find(row=>row.id===id);
      activeItem=null;
      if(activeAnnotation)showLinkedImage(row=>row===activeAnnotation);
      refresh();
    },
    destroy(){
      disposed=true;resizeObserver?.disconnect();resizeObserver=null;window.removeEventListener('resize',handleResize);endPan();
      if(url)URL.revokeObjectURL(url);
      for(const {viewer} of comparisonViewers.values())viewer.destroy();
      comparisonViewers.clear();
    },
  };
}
