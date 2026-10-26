import './style.css';
import { checkSupport } from './gate.js';
import { renderApp } from './app.js';
import { renderUnsupported } from './unsupported.js';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

const gate = checkSupport();
if (!gate.ok) {
  renderUnsupported(root, gate.missing);
} else {
  void renderApp(root);
}
