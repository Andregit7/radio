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

function giftBow() {
  const path = (d, fill, stroke = 'none', width = 1) =>
    svg('path', { d, fill, stroke, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  return svg('svg', { viewBox: '0 0 80 50', class: 'credits-bow', 'aria-hidden': 'true' }, [
    path('M40 23C28 16 24 30 17 45l9-4 5 5c2-11 5-16 12-19Zm-1 1c10-9 20 4 26 19l-9-3-5 6c-3-11-6-16-14-19Z', '#ba7425', '#73421a', 1.4),
    path('M39 25c-9 1-16 9-19 18l6-3 4 4c3-10 5-14 10-17Zm3 0c9 2 16 8 20 16l-7-2-4 5c-3-9-5-13-11-17Z', '#e9ac49'),
    path('M39 24C30 22 18 24 11 19c-6-5-5-12 0-15 6-4 15 1 21 7 5 4 9 7 10 11Zm2 0c9-2 21 0 28-5 6-5 5-12 0-15-6-4-15 1-21 7-5 4-9 7-10 11Z', '#f0b751', '#986128', 1.4),
    path('M35 21C27 15 18 7 12 8c-5 1-6 6 0 10 5 3 15 2 23 3Zm10 0C53 15 62 7 68 8c5 1 6 6 0 10-5 3-15 2-23 3Z', '#8f491e'),
    path('M34 20C26 14 19 8 12 9m34 11C54 14 61 8 68 9M12 4c5-3 14 0 20 6m36-6c-5-3-14 0-20 6', 'none', '#ffdd8e', 1.6),
    path('M34 19c4-2 8-2 12 0l1 7c-5 3-9 4-14 0Z', '#e7a446', '#99541f', 1.2),
    path('M35 20c3-1 7-1 10 0l-1 2c-3-1-5-1-8 0Z', '#fff0b7'),
  ]);
}

export function openCredits() {
  const body = el('div', { class: 'credits-dialog' }, el('p', { class: 'credits-intro' }, CREDITS.body));
  const dialog = modal(CREDITS.title, body, [el('button', { type: 'button', class: 'button secondary', onclick: () => dialog.close() }, 'Închide')]);
  dialog.classList.add('credits-modal');
  return dialog;
}

export function creditsButton(className = 'nav-item') {
  const button = el('button', { type: 'button', class: `credits-button ${className}`, 'aria-label': 'Autor Credite', title: 'Autor Credite' },
    sparkleIcon(),
    el('span', { class: 'credits-label credits-label-start' }, 'Autor'),
    giftBow(),
    el('span', { class: 'credits-label credits-label-end' }, 'Credite'));
  button.addEventListener('click', () => openCredits());
  return button;
}
