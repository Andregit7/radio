import {initAppearance,themeControl} from './lib/appearance.js';
import {el,button,icon,modal} from './lib/dom.js';
import {creditsButton} from './lib/credits.js';

initAppearance();

function chooseDraft(drafts,activeId,onOpenDraft){
  const list=el('div',{class:'studio-draft-picker'},...drafts.map(draft=>button([
    icon('book',18),
    el('span',{},el('strong',{},draft.title || 'Pachet fără titlu'),draft.id===activeId?el('small',{},'Deschis ultima dată'):null),
    icon('chevron',15),
  ],()=>{
    document.getElementById('modal').close();
    return onOpenDraft(draft.id);
  },'studio-draft-choice')));
  modal('Pachete salvate',list,[button('Înapoi',()=>document.getElementById('modal').close(),'button secondary')]);
}

export function studioLanding({drafts,activeId,onNew,onOpenZip,onOpenDraft,onExport,onUpdate,updateChecking,updateLabel}){
  const active=drafts.find(row=>row.id===activeId);
  const saved=drafts.length?button([icon('book',18),'Pachete salvate'],()=>chooseDraft(drafts,activeId,onOpenDraft),'button secondary'):null;
  return el('main',{class:'studio-landing'},
    el('section',{class:'studio-launch-card','aria-labelledby':'studio-launch-title'},
      el('div',{class:'studio-launch-brand'},
        el('img',{src:'./icons/icon.svg',alt:'',width:56,height:56}),
        el('h1',{id:'studio-launch-title'},'RadioEasy Studio')),
      el('div',{class:'studio-launch-actions'},
        button([icon('plus',18),'Pachet nou'],onNew),
        button([icon('upload',18),'Deschide ZIP'],onOpenZip,'button secondary'),
        saved,
        button([icon('download',18),'Validează și exportă'],onExport,'button secondary',{disabled:!active,'aria-describedby':'studio-launch-pack'}),
        button([icon('refresh',18),el('span',{'aria-live':'polite'},updateLabel)],onUpdate,'button secondary update-check',{disabled:updateChecking})),
      el('p',{class:'studio-launch-current',id:'studio-launch-pack'},active?['Pachet pentru validare și export ',el('strong',{},active.title || 'Pachet fără titlu')]:'Deschide un pachet pentru a-l valida și exporta.'),
      el('footer',{class:'studio-launch-preferences'},
        el('div',{class:'studio-launch-preferences-actions'},creditsButton('button secondary'),themeControl()),
        el('span',{class:'studio-launch-status',id:'save-status',role:'status'}))));
}

export function studioWorkspaceHeader({title,onMenu,status}){
  return el('header',{class:'studio-workspace-header'},
    button([icon('back',16),'Meniu'],onMenu,'button secondary'),
    el('div',{class:'studio-workspace-pack'},
      el('strong',{title},title || 'Pachet fără titlu'),
      el('span',{class:'save-status',id:'save-status','aria-live':'polite'},status)));
}
