import { el, modal } from './dom.js';

export const CREDITS = {
  title: 'Credite',
  intro: 'RadioEasy este un atlas și un antrenor de radiologie construit local-first, fără conturi și fără servicii externe.',
  sections: [
    { heading: 'Autor', items: ['Adaugă aici numele și rolul tău.'] },
    { heading: 'Conținut medical', items: ['Adaugă aici sursele, verificarea și contribuitorii.'] },
    { heading: 'Tehnologii', items: ['Aplicație statică, fără backend sau servicii AI.'] },
  ],
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

function presentIcon() {
  const rect = (x, y, width, height, rx, className) => svg('rect', { x, y, width, height, rx, class: className });
  const bow = d => svg('path', { d, class: 'credits-present-bow' });
  return svg('svg', { viewBox: '0 0 32 32', class: 'credits-present', 'aria-hidden': 'true' }, [
    svg('g', { class: 'credits-present-base' }, [rect(5, 5, 22, 22, 3, 'credits-present-box')]),
    svg('g', { class: 'credits-present-lid' }, [
      rect(4, 4, 24, 24, 3, 'credits-present-lid-box'),
      rect(14.4, 4, 3.2, 24, 1, 'credits-present-ribbon'),
      rect(4, 14.4, 24, 3.2, 1, 'credits-present-ribbon'),
      svg('path', { d: 'M4 16H1.5M28 16h2.5', class: 'credits-present-ribbon-end' }),
      bow('M13 13c-2.7-1.2-3.5-4-2-5.2 1.5-1.2 3.5.3 5 4.5'),
      bow('M19 13c2.7-1.2 3.5-4 2-5.2-1.5-1.2-3.5.3-5 4.5'),
      bow('M13 19c-2.7 1.2-3.5 4-2 5.2 1.5 1.2 3.5-.3 5-4.5'),
      bow('M19 19c2.7 1.2 3.5 4 2 5.2-1.5 1.2-3.5-.3-5-4.5'),
      svg('circle', { cx: 16, cy: 16, r: 2.2, class: 'credits-present-knot' }),
    ]),
  ]);
}

export function openCredits() {
  const body = el('div', { class: 'credits-dialog' },
    el('p', { class: 'credits-intro' }, CREDITS.intro),
    ...CREDITS.sections.map(section => el('section', { class: 'credits-section' },
      el('h3', {}, section.heading),
      el('ul', {}, ...section.items.map(item => el('li', {}, item))))));
  const dialog = modal(CREDITS.title, body, [el('button', { type: 'button', class: 'button secondary', onclick: () => dialog.close() }, 'Închide')]);
  dialog.classList.add('credits-modal');
  return dialog;
}

export function creditsButton(className = 'nav-item') {
  const button = el('button', { type: 'button', class: `credits-button ${className}`, 'aria-label': 'Credite', title: 'Credite' },
    sparkleIcon(), presentIcon(), el('span', { class: 'credits-label' }, 'Credite'));
  button.addEventListener('click', () => {
    if (button.classList.contains('is-opening')) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const christmas = document.documentElement.dataset.theme === 'christmas';
    if (reduced || !christmas) { openCredits(); return; }
    button.classList.add('is-opening');
    setTimeout(() => {
      button.classList.remove('is-opening');
      openCredits();
    }, 380);
  });
  return button;
}
