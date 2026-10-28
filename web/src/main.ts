import './style.css';
import { checkSupport } from './gate.js';
import { getLocale, loadLocale, resolveLocale, setLocale, t } from './i18n.js';
import { renderApp } from './app.js';
import { renderUnsupported } from './unsupported.js';

// Locale is fixed before anything paints: no language flicker is possible.
setLocale(resolveLocale(loadLocale(), navigator.languages ?? [navigator.language]));
document.documentElement.lang = getLocale();
document.title = t('meta.title');
document
  .querySelector('meta[name="description"]')
  ?.setAttribute('content', t('meta.description'));
document
  .querySelector('meta[property="og:title"]')
  ?.setAttribute('content', t('meta.title'));
document
  .querySelector('meta[property="og:description"]')
  ?.setAttribute('content', t('meta.description'));
document
  .querySelector('meta[property="og:locale"]')
  ?.setAttribute('content', getLocale() === 'es' ? 'es_ES' : 'en_US');

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

const gate = checkSupport();
if (!gate.ok) {
  renderUnsupported(root, gate.missing);
} else {
  void renderApp(root);
}
document.getElementById('boot')?.remove();
