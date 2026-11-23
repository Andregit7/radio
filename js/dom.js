export function el(tag,attrs={},...children) {
  const node=document.createElement(tag);
  for(const [key,value] of Object.entries(attrs)){
    if(value==null || value===false)continue;
    if(key==='class')node.className=value;
    else if(key==='text')node.textContent=value;
    else if(key.startsWith('on') && typeof value==='function')node.addEventListener(key.slice(2).toLowerCase(),value);
    else if(['value','checked','disabled','selected','hidden','open'].includes(key))node[key]=value;
    else node.setAttribute(key,value===true?'':String(value));
  }
  for(const child of children.flat(Infinity))if(child!=null && child!==false)node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
export const button=(label,action,className='button',attrs={})=>el('button',{type:'button',class:className,onclick:action,...attrs},label);
export const link=(label,href,className='')=>el('a',{href,class:className},label);
export const badge=(label,kind='')=>el('span',{class:`badge ${kind}`},label);
export function icon(name,size=20){
  const paths={
    book:['M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4z','M13 7a3 3 0 0 1 3-3h5v15h-4a4 4 0 0 0-4 2'],
    grid:['M3 3h7v7H3z','M14 3h7v7h-7z','M3 14h7v7H3z','M14 14h7v7h-7z'],
    repeat:['M20 7H8a5 5 0 0 0-5 5','m17 3 4 4-4 4','M4 17h12a5 5 0 0 0 5-5','m7 21-4-4 4-4'],
    exam:['M8 4H5v17h14V4h-3','M8 2h8v5H8z','m8 13 2 2 5-5'],
    chart:['M4 3v17h17','M8 16v-5','M13 16V6','M18 16v-8'],
    settings:['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8','m9 3-1 3-3 1v3l-2 2 2 2v3l3 1 1 3h6l1-3 3-1v-3l2-2-2-2V7l-3-1-1-3z'],
    plus:['M12 5v14','M5 12h14'],arrow:['M4 12h16','m14 6 6 6-6 6'],back:['M20 12H4','m10 6-6 6 6 6'],
    download:['M12 3v12','m6 9 6 6 6-6','M4 16v5h16v-5'],upload:['M12 16V4','m6 10 6-6 6 6','M4 17v4h16v-4'],
    search:['M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16','m17 17 4 4'],check:['m5 12 4 4L19 6'],close:['m6 6 12 12','M18 6 6 18'],
    eye:['M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7','M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6'],
    bookmark:['M6 3h12v18l-6-4-6 4z'],shield:['m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6z','m8 12 3 3 5-6'],
    chevron:['m9 5 7 7-7 7'],'chevron-down':['m6 9 6 6 6-6'],'chevron-up':['m6 15 6-6 6 6'],more:['M5 12h.01','M12 12h.01','M19 12h.01'],expand:['M4 9V4h5','M15 4h5v5','M20 15v5h-5','M9 20H4v-5'],
    cursor:['M5 3l14 8-6 1.5-2.5 6z'],
    hand:['M8 13V6a1.5 1.5 0 0 1 3 0v6','M11 12V4.5a1.5 1.5 0 0 1 3 0V12','M14 12V6a1.5 1.5 0 0 1 3 0v7','M17 13V9a1.5 1.5 0 0 1 3 0v6a6 6 0 0 1-6 6h-2a6 6 0 0 1-4.8-2.4L4.5 15.2a1.6 1.6 0 0 1 2.6-1.9L8 15'],
    pen:['M4 20l1.2-5L16 4.2a1.5 1.5 0 0 1 2.1 0l1.7 1.7a1.5 1.5 0 0 1 0 2.1L9 18.8z','M14.5 5.7l3.8 3.8'],
    info:['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20','M12 11v6','M12 7h.01'],sun:['M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10','M12 2v2','M12 20v2','M2 12h2','M20 12h2'],
    clock:['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20','M12 6v6l4 2'],image:['M3 3h18v18H3z','m3 16 5-5 4 4 3-3 6 6','M16 7h.01'],
    refresh:['M20 11a8 8 0 1 0-.6 4','M20 4v7h-7'],
    menu:['M4 5h16v14H4z','M10 5v14'],
    trash:['M4 7h16','M9 7V4h6v3','M6 7l1 13h10l1-13','M10 11v6','M14 11v6'],
  };
  const node=document.createElementNS('http://www.w3.org/2000/svg','svg');
  for(const [k,v] of Object.entries({viewBox:'0 0 24 24',width:size,height:size,fill:'none',stroke:'currentColor','stroke-width':1.7,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))node.setAttribute(k,v);
  for(const d of paths[name] || paths.info){const p=document.createElementNS(node.namespaceURI,'path');p.setAttribute('d',d);node.append(p);}return node;
}
let toastTimer;
export function toast(message,error=false){const target=document.getElementById('notice');target.textContent=message;target.className=`toast visible ${error?'error':''}`;clearTimeout(toastTimer);toastTimer=setTimeout(()=>target.classList.remove('visible'),5500);}
export function modal(title,body,actions=[]){
  const dialog=document.getElementById('modal');
  dialog.replaceChildren(el('div',{class:'modal-head'},el('h2',{},title),button(icon('close'),()=>dialog.close(),'icon-button',{'aria-label':'Închide'})),body,el('div',{class:'modal-actions'},...actions));
  if(!dialog.open)dialog.showModal();return dialog;
}

export function observationFieldControls(fields, values, setValue, { scoreableOnly = false } = {}) {
  return fields.flatMap(field => {
    const groups = observationFieldControls(field.groups || [], values, setValue, { scoreableOnly });
    const control = scoreableOnly && field.scoreable === false
      ? null
      : observationFieldControl(field, values, setValue, groups.length ? 'Variante directe' : field.label);
    if (!groups.length) return control ? [control] : [];
    return [el('fieldset', { class: 'observation-answer-group' },
      el('legend', {}, field.label), control, ...groups)];
  });
}

function observationFieldControl(field, values, setValue, label) {
  const value = values[field.id];
  const options = field.options || [];
  if (field.kind === 'measurementMm') {
    const input = el('input', { class: 'select', type: 'number', min: '0.1', max: '2000', step: '0.1', value: value ?? '',
      oninput: event => {
        const number = Math.round(Number(event.target.value) * 10) / 10;
        setValue(field.id, number > 0 && number <= 2000 ? number : undefined);
      },
    });
    return el('label', { class: 'observation-answer-field' }, el('span', {}, `${label} (mm)`), input);
  }
  if (!options.length) return null;
  const selectedIds = Array.isArray(value) ? value : [];
  if (field.kind === 'single') {
    const select = el('select', { class: 'select', onchange: event => setValue(field.id, event.target.value ? [event.target.value] : undefined) },
      el('option', { value: '' }, 'Necompletat'),
      ...options.map(option => el('option', { value: option.id, selected: selectedIds[0] === option.id }, option.label)));
    return el('label', { class: 'observation-answer-field' }, el('span', {}, label), select);
  }
  const checks = options.map(option => el('label', {},
    el('input', { type: 'checkbox', checked: selectedIds.includes(option.id), onchange: event => {
      const current = values[field.id];
      const selected = new Set(Array.isArray(current) ? current : []);
      if (event.target.checked) selected.add(option.id);
      else selected.delete(option.id);
      setValue(field.id, selected.size ? [...selected] : undefined);
    }}), option.label));
  return el('fieldset', { class: 'observation-answer-field' },
    el('legend', {}, label), el('div', { class: 'structured-checks' }, ...checks));
}
