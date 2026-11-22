import { el, modal } from './dom.js';

export const CREDITS = {
  title: 'Credite',
  body: 'RadioEasy este un atlas de radiologie pentru studenți la medicină, construit local-first, fără conturi și fără servicii externe. Autor: [numele autorului] — [o scurtă prezentare a autorului se adaugă aici].',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(name, attrs, children = []) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  for (const child of children) node.append(child);
  return node;
}

function sparkleIcon() {
  return svg('svg', { viewBox: '0 0 24 24', class: 'credits-sparkle', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [
    svg('path', { d: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z' }),
    svg('path', { d: 'M18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8z' }),
  ]);
}

export function openCredits() {
  const body = el('div', { class: 'credits-dialog' }, el('p', { class: 'credits-intro' }, CREDITS.body));
  const dialog = modal(CREDITS.title, body, [el('button', { type: 'button', class: 'button secondary', onclick: () => dialog.close() }, 'Închide')]);
  dialog.classList.add('credits-modal');
  return dialog;
}

export function creditsButton(className = 'nav-item') {
  const button = el('button', { type: 'button', class: `credits-button ${className}`, 'aria-label': 'Credite', title: 'Credite' },
    sparkleIcon(), el('span', { class: 'credits-label' }, 'Credite'), el('span', { class: 'credits-bow', 'aria-hidden': 'true' }));
  button.addEventListener('click', () => openCredits());
  return button;
}
