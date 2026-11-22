import { el } from './dom.js';

const themes=[
  ['system','După sistem'],
  ['light','Luminoasă'],
  ['dark','Întunecată'],
  ['super-dark','Negru profund'],
  ['cobalt','Cobalt'],
  ['candy','Dulce'],
  ['forest','Pădure'],
  ['beach','Plajă'],
  ['christmas','Crăciun',true],
];
const preferenceKey='radioeasy-theme';
const animationKey='radioeasy-animations';
let preference='system';
let animations=true;
let systemTheme;
let decorations;

function recognizedTheme(value){
  return themes.some(([theme])=>theme===value)?value:'system';
}

function animatedTheme(value){
  return themes.some(([theme,,animated])=>theme===value&&animated);
}

const ornament=variant=>el('span',{class:`seasonal-ball ${variant}`},
  el('span',{class:'seasonal-ring'}),
  el('span',{class:'seasonal-string'}),
  el('span',{class:'seasonal-cap'}),
  el('span',{class:'seasonal-globe'}));

function applyTheme(){
  const theme=preference==='system'?(systemTheme.matches?'dark':'light'):preference;
  const root=document.documentElement;
  root.dataset.theme=theme;
  root.dataset.animations=animations?'on':'off';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',getComputedStyle(root).getPropertyValue('--chrome').trim());
  if(theme==='christmas' && !decorations){
    decorations=el('div',{class:'seasonal-decorations','aria-hidden':'true'},
      el('div',{class:'seasonal-snow'}),
      el('div',{class:'seasonal-ornaments'},ornament('is-red'),ornament('is-green'),ornament('is-blue'),ornament('is-white')),
      el('div',{class:'seasonal-landscape'},
        el('span',{class:'seasonal-shadow'}),
        el('span',{class:'seasonal-body'}),
        el('span',{class:'seasonal-middle'}),
        el('span',{class:'seasonal-scarf'}),
        el('span',{class:'seasonal-head'},
          el('span',{class:'seasonal-eye is-left'}),
          el('span',{class:'seasonal-eye is-right'}),
          el('span',{class:'seasonal-nose'}))));
    document.body.append(decorations);
  }
  if(decorations)decorations.hidden=theme!=='christmas';
  for(const control of document.querySelectorAll('.theme-control')){
    const select=control.querySelector('select');
    if(select)select.value=preference;
    const row=control.querySelector('.theme-control-animations');
    if(row)row.hidden=!animatedTheme(theme);
    const box=row?.querySelector('input');
    if(box)box.checked=animations;
  }
}

export function initAppearance(){
  if(systemTheme)return;
  systemTheme=matchMedia('(prefers-color-scheme: dark)');
  try{preference=recognizedTheme(localStorage.getItem(preferenceKey));}catch{}
  try{animations=localStorage.getItem(animationKey)!=='off';}catch{}
  systemTheme.addEventListener('change',()=>{if(preference==='system')applyTheme();});
  window.addEventListener('storage',event=>{
    if(event.key===animationKey){animations=event.newValue!=='off';applyTheme();return;}
    if(event.key!==preferenceKey && event.key!==null)return;
    preference=recognizedTheme(event.newValue);
    applyTheme();
  });
  applyTheme();
}

export function themeControl(){
  initAppearance();
  return el('div',{class:'theme-control'},
    el('label',{class:'theme-control-row'},el('span',{},'Temă'),
      el('select',{onchange:event=>{
        preference=recognizedTheme(event.target.value);
        try{localStorage.setItem(preferenceKey,preference);}catch{}
        applyTheme();
      }},...themes.map(([value,label])=>el('option',{value,selected:value===preference},label)))),
    el('label',{class:'theme-control-row theme-control-animations',hidden:!animatedTheme(document.documentElement.dataset.theme)},
      el('input',{type:'checkbox',checked:animations,onchange:event=>{
        animations=event.target.checked;
        try{localStorage.setItem(animationKey,animations?'on':'off');}catch{}
        applyTheme();
      }}),
      el('span',{},'Animații')));
}
