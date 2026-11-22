import { el, button, icon } from './dom.js';
import { searchCatalogue } from './core.js';
let instance=0;
export function catalogueSelector(pack,{chapterIds=[],selected=[],multiple=false,onChange=()=>{},disabled=false}={}){
  const uid=`catalogue-${++instance}`,collapsed=new Set(),selection=new Set(selected);
  const input=el('input',{type:'search',class:'catalogue-input',id:`${uid}-query`,placeholder:'Caută un diagnostic…',autocomplete:'off',spellcheck:'false',disabled,'aria-describedby':`${uid}-hint`});
  const count=el('span',{class:'result-count',role:'status','aria-live':'polite'});
  const groups=el('div',{class:'catalogue-groups'});
  const clear=button(icon('close',16),()=>{input.value='';render();input.focus();},'icon-button clear-search',{'aria-label':'Șterge căutarea',hidden:true,disabled});
  const root=el('div',{class:'catalogue-selector'},el('label',{for:input.id,class:'field-label'},'Alege din programa selectată'),
    el('div',{class:'catalogue-search'},icon('search',19),input,clear),
    el('div',{class:'catalogue-hint',id:`${uid}-hint`},el('span',{},'Tastează denumirea sau un cuvânt-cheie ori răsfoiește capitolele.'),count),groups);
  function render(){
    const query=input.value.trim(),results=searchCatalogue(pack.diagnoses,pack.curriculum.chapters,query,chapterIds);
    clear.hidden=!query;groups.replaceChildren();
    const found=new Set(results.flatMap(group=>group.items.map(row=>row.id))).size;count.textContent=`${found} ${found===1?'diagnostic':'diagnostice'}`;
    if(!results.length){groups.append(el('div',{class:'no-results'},el('strong',{},'Niciun diagnostic găsit'),el('p',{},'Încearcă un alt cuvânt sau șterge căutarea.')));return;}
    for(const group of results){
      const groupId=`${uid}-${group.id}`,content=el('div',{id:groupId,class:'diagnosis-options',role:'group','aria-label':group.label});
      const isOpen=Boolean(query)||!collapsed.has(group.id);content.hidden=!isOpen;
      const heading=button([el('span',{},group.label),el('span',{class:'group-count'},group.items.length),icon('chevron',16)],()=>{
        content.hidden=!content.hidden;heading.setAttribute('aria-expanded',String(!content.hidden));
        if(content.hidden)collapsed.add(group.id);else collapsed.delete(group.id);
      },'catalogue-heading',{'aria-expanded':String(isOpen),'aria-controls':groupId});
      for(const item of group.items){
        const radio=el('input',{type:multiple?'checkbox':'radio',name:uid,value:item.id,checked:selection.has(item.id),disabled,
          onchange:()=>{
            if(!multiple)selection.clear();
            if(radio.checked)selection.add(item.id);else selection.delete(item.id);
            root.querySelectorAll('.diagnosis-option').forEach(label=>{const field=label.querySelector('input');field.checked=selection.has(field.value);label.classList.toggle('selected',field.checked);});
            onChange([...selection]);
          }});
        content.append(el('label',{class:`diagnosis-option ${selection.has(item.id)?'selected':''}`},radio,el('span',{},item.label)));
      }
      groups.append(el('section',{class:'catalogue-group'},heading,content));
    }
  }
  input.addEventListener('input',render);
  input.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){const first=groups.querySelector('.diagnosis-options:not([hidden]) input');if(first){event.preventDefault();first.focus();}}if(event.key==='Escape' && input.value){input.value='';render();}});
  render();return root;
}
