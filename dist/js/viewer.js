import { el, button, icon } from './dom.js';
import { assetBlob } from './storage.js';
let viewerNumber=0;

export function imageViewer(record, caseData, { allowAnnotations=true, onSelect=()=>{} }={}) {
  let image=caseData.images[0],url,disposed=false,zoom=1,showAll=false,activeItem=null,loadId=0;
  const marks=[];
  const picture=el('img',{class:'radiograph',alt:`Radiografie: ${caseData.title}`,draggable:'false'});
  const overlay=document.createElementNS('http://www.w3.org/2000/svg','svg');
  const arrowId=`radia-arrow-${++viewerNumber}`;
  overlay.setAttribute('viewBox','0 0 1000 1000');overlay.setAttribute('preserveAspectRatio','none');overlay.setAttribute('class','annotation-layer');overlay.setAttribute('aria-label','Repere pe radiografie');
  const canvas=el('div',{class:'image-canvas'},picture,overlay);
  const stage=el('div',{class:'image-stage',tabindex:'0','aria-label':'Radiografie. Folosește comenzile de zoom și derularea pentru detalii.'},canvas);
  const loading=el('div',{class:'image-loading'},'Se încarcă imaginea…');
  stage.append(loading);
  const zoomLabel=el('span',{class:'zoom-label'},'100%');
  function setZoom(value){zoom=Math.max(1,Math.min(3,value));canvas.style.width=`${zoom*100}%`;zoomLabel.textContent=`${Math.round(zoom*100)}%`;}
  const annotationsButton=button([icon('eye',17),'Repere'],()=>{showAll=!showAll;annotationsButton.setAttribute('aria-pressed',String(showAll));refresh();},'viewer-tool',{'aria-pressed':'false',title:'Afișează toate reperele'});
  const root=el('section',{class:'viewer','aria-label':'Vizualizator radiografie'},
    el('div',{class:'viewer-top'},el('span',{class:'film-label'},'RADIOGRAFIE'),el('span',{class:'film-index'},caseData.source.page?`Sursa · p. ${caseData.source.page}`:caseData.title)),
    stage,
    el('div',{class:'viewer-controls'},
      el('div',{class:'zoom-controls'},button('−',()=>setZoom(zoom-.25),'viewer-tool',{'aria-label':'Micșorează imaginea'}),zoomLabel,button('+',()=>setZoom(zoom+.25),'viewer-tool',{'aria-label':'Mărește imaginea'}),button('Reset',()=>{setZoom(1);stage.scrollTo(0,0);},'viewer-tool')),
      el('div',{class:'viewer-extra'},allowAnnotations && caseData.annotations.length?annotationsButton:null,
        button(icon('expand',18),async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(root.requestFullscreen)await root.requestFullscreen();}catch{}},'viewer-tool',{'aria-label':'Radiografie pe tot ecranul'}))));
  if(caseData.images.length>1)root.append(el('div',{class:'image-tabs'},...caseData.images.map((item,index)=>button(`Imaginea ${index+1}`,()=>load(item),'chip'))));

  function refresh(){
    for(const {node,row} of marks){const selected=row.itemId===activeItem;node.classList.toggle('active',selected);node.classList.toggle('annotation-hidden',!showAll && !selected);}
  }
  function draw(){
    overlay.replaceChildren();marks.length=0;
    if(!allowAnnotations)return;
    const defs=document.createElementNS(overlay.namespaceURI,'defs'),marker=document.createElementNS(overlay.namespaceURI,'marker');
    for(const [key,value] of Object.entries({id:arrowId,viewBox:'0 0 8 8',refX:'7',refY:'4',markerWidth:'7',markerHeight:'7',orient:'auto-start-reverse'}))marker.setAttribute(key,value);
    const head=document.createElementNS(overlay.namespaceURI,'path');head.setAttribute('d','M0 0L8 4L0 8L2 4Z');head.setAttribute('fill','#e8c777');marker.append(head);defs.append(marker);overlay.append(defs);
    for(const [index,row] of caseData.annotations.filter(a=>a.imageId===image.id).entries()){
      const group=document.createElementNS(overlay.namespaceURI,'g');
      group.setAttribute('class','annotation');group.setAttribute('tabindex','0');group.setAttribute('role','button');
      const item=caseData.sections.flatMap(section=>section.items).find(item=>item.id===row.itemId);
      group.setAttribute('aria-label',`Reper ${row.label || index+1}: ${item?.text || ''}`);
      const type={ellipse:'ellipse',rect:'rect',polygon:'polygon',arrow:'line'}[row.shape];
      const shape=document.createElementNS(overlay.namespaceURI,type);
      if(row.shape==='polygon')shape.setAttribute('points',row.points.map(p=>p.map(v=>v*1000).join(',')).join(' '));
      else for(const key of ({ellipse:['cx','cy','rx','ry'],rect:['x','y','width','height'],arrow:['x1','y1','x2','y2']}[row.shape]))shape.setAttribute(key,row[key]*1000);
      shape.setAttribute('vector-effect','non-scaling-stroke');group.append(shape);
      if(row.shape==='arrow')shape.setAttribute('marker-end',`url(#${arrowId})`);
      const x=(row.cx ?? row.x ?? row.x1 ?? row.points?.[0][0] ?? .1)*1000;
      const y=(row.cy!=null?row.cy-row.ry:row.y ?? row.y1 ?? row.points?.[0][1] ?? .1)*1000;
      const circle=document.createElementNS(overlay.namespaceURI,'circle');circle.setAttribute('cx',x);circle.setAttribute('cy',Math.max(30,y));circle.setAttribute('r','24');circle.setAttribute('class','annotation-number');group.append(circle);
      const label=document.createElementNS(overlay.namespaceURI,'text');label.setAttribute('x',x);label.setAttribute('y',Math.max(30,y)+8);label.setAttribute('text-anchor','middle');label.textContent=row.label || String(index+1);group.append(label);
      const select=()=>{activeItem=row.itemId;refresh();onSelect(row.itemId);};group.addEventListener('click',select);group.addEventListener('keydown',event=>{if(event.key==='Enter' || event.key===' '){event.preventDefault();select();}});
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
  return {node:root,selectItem(id){activeItem=id;refresh();},destroy(){disposed=true;if(url)URL.revokeObjectURL(url);}};
}
