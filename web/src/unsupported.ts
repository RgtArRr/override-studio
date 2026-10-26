export function renderUnsupported(root: HTMLElement, missing: string[]): void {
  root.innerHTML = '';
  const wrap = document.createElement('main');
  wrap.className = 'unsupported';

  const card = document.createElement('section');
  card.className = 'unsupported-card';

  const title = document.createElement('h1');
  title.textContent = 'Este navegador no puede procesar video aquí';
  card.appendChild(title);

  const body = document.createElement('p');
  body.textContent =
    'override.studio renderiza la telemetría dentro de tu navegador con WebCodecs. ' +
    'Tu navegador actual no lo soporta (esto incluye Safari y todos los navegadores en iPhone/iPad).';
  card.appendChild(body);

  const listTitle = document.createElement('p');
  listTitle.className = 'muted';
  listTitle.textContent = 'Falta en este navegador:';
  card.appendChild(listTitle);

  const list = document.createElement('ul');
  for (const item of missing) {
    const li = document.createElement('li');
    li.textContent = item;
    list.appendChild(li);
  }
  card.appendChild(list);

  const cta = document.createElement('p');
  cta.innerHTML =
    'Usa <a href="https://www.google.com/chrome/">Chrome</a> o ' +
    '<a href="https://www.microsoft.com/edge">Edge</a> en computadora o Android para continuar.';
  card.appendChild(cta);

  wrap.appendChild(card);
  root.appendChild(wrap);
}
