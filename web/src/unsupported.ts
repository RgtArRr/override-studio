import { t } from './i18n.js';

export function renderUnsupported(root: HTMLElement, missing: string[]): void {
  root.innerHTML = '';
  const wrap = document.createElement('main');
  wrap.className = 'unsupported';

  const card = document.createElement('section');
  card.className = 'unsupported-card';

  const title = document.createElement('h1');
  title.textContent = t('unsup.title');
  card.appendChild(title);

  const body = document.createElement('p');
  body.textContent = t('unsup.body');
  card.appendChild(body);

  const listTitle = document.createElement('p');
  listTitle.className = 'muted';
  listTitle.textContent = t('unsup.missing');
  card.appendChild(listTitle);

  const list = document.createElement('ul');
  for (const item of missing) {
    const li = document.createElement('li');
    li.textContent = item;
    list.appendChild(li);
  }
  card.appendChild(list);

  const cta = document.createElement('p');
  const chrome = document.createElement('a');
  chrome.href = 'https://www.google.com/chrome/';
  chrome.textContent = 'Chrome';
  const edge = document.createElement('a');
  edge.href = 'https://www.microsoft.com/edge';
  edge.textContent = 'Edge';
  cta.append(t('unsup.cta1'), chrome, t('unsup.cta2'), edge, t('unsup.cta3'));
  card.appendChild(cta);

  wrap.appendChild(card);
  root.appendChild(wrap);
}
