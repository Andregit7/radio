import { el } from './dom.js';

const themes=[
  ['system','După sistem'],
  ['light','Luminoasă'],
  ['dark','Întunecată'],
  ['super-dark','Negru profund'],
  ['cobalt','Cobalt'],
  ['candy','Bomboane · zi'],
  ['candy-dark','Bomboane · noapte'],
  ['forest','Pădure'],
  ['beach','Plajă'],
  ['christmas','Crăciun'],
  ['session','Sesiune'],
];
const preferenceKey='radioeasy-theme';
const animationKey='radioeasy-animations';
let preference='system';
let animations=true;
let systemTheme;
let scene;

function recognizedTheme(value){
  return themes.some(([theme])=>theme===value)?value:'system';
}

const ornament=variant=>el('span',{class:`seasonal-ball ${variant}`},
  el('span',{class:'seasonal-ring'}),
  el('span',{class:'seasonal-string'}),
  el('span',{class:'seasonal-cap'}),
  el('span',{class:'seasonal-globe'}));

function christmasSnow(){
  const snow=el('div',{class:'seasonal-snow'});
  const flakeCount=42;
  for(let index=0;index<flakeCount;index++){
    const depth=Math.random();
    const phase=(index+Math.random())/flakeCount;
    const duration=40-16*depth+5*Math.random();
    const flake=el('span',{class:'seasonal-flake'});
    flake.style.setProperty('--snow-x',`${Math.random()*100}%`);
    flake.style.setProperty('--snow-y',`${phase*100}dvh`);
    flake.style.setProperty('--snow-size',`${1.5+2*depth}px`);
    flake.style.setProperty('--snow-opacity',.3+.45*depth);
    flake.style.setProperty('--snow-drift',`${44*(Math.random()-.5)}px`);
    flake.style.setProperty('--snow-duration',`${duration}s`);
    flake.style.setProperty('--snow-delay',`${-phase*duration}s`);
    snow.append(flake);
  }
  return snow;
}

function christmasScene(){
  return el('div',{class:'theme-scene christmas-scene','aria-hidden':'true'},
    christmasSnow(),
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
}

function sceneSvg(tag,attributes,...children){
  const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const [key,value] of Object.entries(attributes))node.setAttribute(key,value);
  node.append(...children);
  return node;
}

function sessionScene(){
  const path=(d,attributes={})=>sceneSvg('path',{d,...attributes});
  const ground=path('M0 146 39 134 77 139 120 129 147 133 185 125 238 131 270 140v26H0Z',{fill:'#14141e'});
  const rock=sceneSvg('g',{},
    path('m163 137 5-20 14-13 12 3 11-16 15 5 13 15 4 21-20 12-35-1Z',{fill:'#303147',stroke:'#54566f'}),
    path('m182 104 14 17-10 17m10-17 24-6 13-4m-13 4 6 20m-21-44 4 18-13 12',{stroke:'#626580','stroke-width':'1.3',fill:'none'}),
    path('m182 114-13 8 3 13 13 1Z',{fill:'#383b54'}),
    path('m205 92 15 5 12 14-12 3-11-5Z',{fill:'#454760'}));
  const restraint=sceneSvg('g',{fill:'none',stroke:'#717489','stroke-width':'1.5'},
    path('M107 134Q94 148 79 142'),
    ...[[104,137,-34],[98,141,-21],[91,143,-4],[84,143,16]].map(([cx,cy,angle])=>
      sceneSvg('ellipse',{cx,cy,rx:3.5,ry:1.8,transform:`rotate(${angle} ${cx} ${cy})`})),
    sceneSvg('circle',{cx:71,cy:140,r:9,fill:'#292a3c'}),
    path('M108 133q4 2 8 1',{stroke:'#a1a2b9','stroke-width':'3'}));
  const legs=path('m122 101-13 32-7 2m20-34 13 19-3 15 8 1',{stroke:'#9193af','stroke-width':'3.4'});
  const swing=sceneSvg('g',{class:'session-swing'},
    path('m122 101 2-27 8-8m-10 9 15 11 15-5m-24-8 14 4 14-1',{stroke:'#a3a6c1','stroke-width':'3.4'}),
    sceneSvg('circle',{cx:132,cy:57,r:8.5,fill:'#292c40',stroke:'#adb0cc','stroke-width':'2.7'}),
    path('m134 60 4 1',{stroke:'#a3a6c1','stroke-width':'1.3'}),
    path('m140 97 27-38',{stroke:'#a096a0','stroke-width':'3.5'}),
    path('M183 72q-13-7-23-20l-5 2q6 13 27 19Z',{fill:'#a8adc9',stroke:'#656982','stroke-width':'1.4'}),
    path('m149 83 2-3m3-2 2-3',{stroke:'#b7b9d3','stroke-width':'3'}));
  const chips=sceneSvg('g',{class:'session-chips',stroke:'#b9bad1','stroke-width':'1.5'},
    path('m201 93-7-7m10 4-2-10m6 12 7-9m-29 17-8-2'));
  const illustration=sceneSvg('svg',{viewBox:'0 0 270 166',class:'session-illustration',fill:'none','stroke-linecap':'round','stroke-linejoin':'round'},
    ground,
    sceneSvg('ellipse',{cx:152,cy:145,rx:81,ry:8,fill:'#111929',stroke:'#373a50'}),
    path('M84 148h29m36-2h24m27 3h18',{stroke:'#40465b'}),
    rock,legs,restraint,swing,chips);
  return el('div',{class:'theme-scene session-scene','aria-hidden':'true'},
    el('div',{class:'session-rain'}),illustration);
}

function updateScene(theme){
  const build=theme==='christmas'?christmasScene:theme==='session'?sessionScene:null;
  if(scene?.theme===theme)return;
  scene?.nodes.forEach(node=>node.remove());
  scene=build?{theme,nodes:[build()]}:null;
  if(theme==='christmas'){
    scene.nodes.push(el('ul',{class:'lightrope','aria-hidden':'true'},Array.from({length:88},()=>el('li',{},el('span')))));
  }
  if(scene)document.body.append(...scene.nodes);
}

function applyTheme(){
  const theme=preference==='system'?(systemTheme.matches?'dark':'light'):preference;
  const root=document.documentElement;
  root.dataset.theme=theme;
  root.dataset.animations=animations?'on':'off';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',getComputedStyle(root).getPropertyValue('--chrome').trim());
  updateScene(theme);
  for(const control of document.querySelectorAll('.theme-control')){
    const select=control.querySelector('select');
    if(select)select.value=preference;
    const box=control.querySelector('.theme-control-animations input');
    if(box)box.checked=animations;
  }
}

export function initAppearance(){
  if(systemTheme)return;
  systemTheme=matchMedia('(prefers-color-scheme: dark)');
  try{preference=recognizedTheme(localStorage.getItem(preferenceKey));}catch{}
  try{animations=localStorage.getItem(animationKey)!=='off';}catch{}
  const updateVisibility=()=>{document.documentElement.toggleAttribute('data-theme-paused',document.hidden);};
  document.addEventListener('visibilitychange',updateVisibility);
  updateVisibility();
  systemTheme.addEventListener('change',()=>{if(preference==='system')applyTheme();});
  window.addEventListener('storage',event=>{
    if(event.key!==animationKey && event.key!==preferenceKey && event.key!==null)return;
    if(event.key===animationKey || event.key===null)animations=event.newValue!=='off';
    if(event.key===preferenceKey || event.key===null)preference=recognizedTheme(event.newValue);
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
    el('label',{class:'theme-control-row theme-control-animations'},
      el('input',{type:'checkbox',checked:animations,onchange:event=>{
        animations=event.target.checked;
        try{localStorage.setItem(animationKey,animations?'on':'off');}catch{}
        applyTheme();
      }}),
      el('span',{},'Animații')));
}
