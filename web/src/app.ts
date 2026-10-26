import {
  TEMPLATE_SCHEMA_VERSION,
  classifyAspect,
  type AspectClass,
  type TemplateV1,
} from '@override-studio/shared';
import {
  parseFit,
  sampleAt,
  summarize,
  formatClock,
  type Activity,
  type TelemetrySample,
} from './telemetry.js';
import { formatMetric, type Units } from './format.js';
import { drawOverlay } from './overlay.js';
import { renderVideo } from './render.js';
import { BUILTIN_TEMPLATES } from './templates.js';
import { FIXTURE_FIT_URL, FIXTURE_VIDEO_URL } from './fixtures.js';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatOffset(sec: number): string {
  const sign = sec < 0 ? '−' : '+';
  return `${sign}${Math.abs(sec).toFixed(1)} s`;
}

/** Representative sample so template thumbnails render before any FIT loads. */
const DEMO_SAMPLE: TelemetrySample = {
  t: 63,
  speed: 9.5,
  heartRate: 152,
  power: 220,
  cadence: 90,
  elevation: 540,
  distance: 5200,
  grade: 4.5,
};

interface LayoutOverride {
  aspect: AspectClass;
  x: number;
  y: number;
}

export async function renderApp(root: HTMLElement): Promise<void> {
  let activity: Activity | null = null;
  let offsetSec = 0;
  let videoURL: string | null = null;
  let videoFile: Blob | null = null;
  let rendering = false;
  let units: Units = 'metric';
  let selectedTemplateId = BUILTIN_TEMPLATES[0].id;
  const widgetOverrides = new Map<string, Map<string, boolean>>();
  const layoutOverrides = new Map<string, Map<string, LayoutOverride>>();

  const selectedTemplate = (): TemplateV1 | undefined =>
    BUILTIN_TEMPLATES.find((t) => t.id === selectedTemplateId);

  const effectiveTemplate = (template: TemplateV1): TemplateV1 => {
    const vis = widgetOverrides.get(template.id);
    const lay = layoutOverrides.get(template.id);
    if (!vis && !lay) return template;
    return {
      ...template,
      widgets: template.widgets.map((w) => {
        const pos = lay?.get(w.id);
        return {
          ...w,
          visible: vis?.get(w.id) ?? w.visible,
          layout: pos
            ? { ...w.layout, [pos.aspect]: { ...w.layout[pos.aspect], x: pos.x, y: pos.y } }
            : w.layout,
        };
      }),
    };
  };

  root.innerHTML = '';
  const wrap = el('main', 'app');

  const header = el('header', 'app-header');
  header.append(el('h1', undefined, 'override.studio'));
  header.append(el('span', 'phase-badge', 'render 100% local'));
  wrap.appendChild(header);

  const status = el('p', 'muted', 'Carga un video y un FIT, o usa los fixtures.');
  status.setAttribute('role', 'status');

  // Sources
  const sources = el('section', 'sources');
  const videoLabel = el('label', 'file-label', 'Video MP4');
  const videoInput = el('input');
  videoInput.type = 'file';
  videoInput.accept = 'video/mp4,.mp4';
  videoLabel.appendChild(videoInput);
  const fitLabel = el('label', 'file-label', 'Archivo FIT');
  const fitInput = el('input');
  fitInput.type = 'file';
  fitInput.accept = '.fit';
  fitLabel.appendChild(fitInput);
  const fixtureBtn = el('button', 'btn', 'Cargar fixtures');
  fixtureBtn.type = 'button';
  sources.append(videoLabel, fitLabel, fixtureBtn);
  wrap.append(sources, status);

  // Live stage
  const stage = el('section', 'stage');
  const video = el('video', 'source-video');
  video.preload = 'auto';
  video.setAttribute('aria-hidden', 'true');
  const canvas = el('canvas', 'live-preview');
  const liveCtx = canvas.getContext('2d');
  if (!liveCtx) throw new Error('No se pudo crear el lienzo de previsualización.');
  const timeline = el('input', 'timeline');
  timeline.type = 'range';
  timeline.min = '0';
  timeline.max = '0';
  timeline.step = '0.05';
  timeline.value = '0';
  timeline.disabled = true;
  timeline.setAttribute('aria-label', 'Posición del video');
  const clocks = el('div', 'clocks');
  const playBtn = el('button', 'btn btn-small', 'Reproducir');
  playBtn.type = 'button';
  playBtn.disabled = true;
  const videoClock = el('span', undefined, 'video 00:00');
  const teleClock = el('span', undefined, 'tele —');
  const offsetClock = el('strong', undefined, formatOffset(0));
  clocks.append(playBtn, videoClock, teleClock, offsetClock);
  const stageHint = el(
    'p',
    'muted',
    'Arrastra un widget para moverlo · doble clic restablece su posición · clic en el video reproduce/pausa.',
  );
  stage.append(video, canvas, timeline, clocks, stageHint);
  wrap.appendChild(stage);

  // Template selector, right under the live preview.
  const templateBox = el('section', 'template-box');
  templateBox.append(el('h2', undefined, 'Plantilla'));
  interface Thumb {
    template: TemplateV1;
    card: HTMLButtonElement;
    ctx: CanvasRenderingContext2D;
    sig: string;
  }
  const thumbs: Thumb[] = [];
  const cardsBox = el('div', 'template-cards');
  const syncCards = (): void => {
    for (const th of thumbs) {
      const active = th.template.id === selectedTemplateId;
      th.card.classList.toggle('selected', active);
      th.card.setAttribute('aria-pressed', String(active));
    }
  };
  for (const t of BUILTIN_TEMPLATES) {
    const card = el('button', 'template-card');
    card.type = 'button';
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = 512;
    thumbCanvas.height = 288;
    thumbCanvas.className = 'template-thumb';
    thumbCanvas.setAttribute('aria-hidden', 'true');
    const thumbCtx = thumbCanvas.getContext('2d');
    if (!thumbCtx) throw new Error('No se pudo crear miniatura de plantilla.');
    const name = el('span', 'template-name', t.name);
    card.append(thumbCanvas, name);
    card.addEventListener('click', () => {
      selectedTemplateId = t.id;
      rebuildWidgets();
      syncCards();
    });
    cardsBox.appendChild(card);
    thumbs.push({ template: t, card, ctx: thumbCtx, sig: '' });
  }
  templateBox.appendChild(cardsBox);
  syncCards();
  wrap.appendChild(templateBox);

  // Offset controls
  const offsetBox = el('section', 'offset-box');
  offsetBox.append(el('h2', undefined, 'Sincronización'));
  const offsetBtns = el('div', 'offset-btns');
  for (const delta of [-0.5, -0.1, 0.1, 0.5]) {
    const btn = el('button', 'btn', `${delta > 0 ? '+' : ''}${delta.toFixed(1)} s`);
    btn.type = 'button';
    btn.addEventListener('click', () => {
      offsetSec = Math.min(120, Math.max(-120, offsetSec + delta));
    });
    offsetBtns.appendChild(btn);
  }
  const zeroBtn = el('button', 'btn', '0.0 s');
  zeroBtn.type = 'button';
  zeroBtn.addEventListener('click', () => {
    offsetSec = 0;
  });
  offsetBtns.appendChild(zeroBtn);
  offsetBox.append(offsetBtns);
  offsetBox.append(
    el('p', 'muted', 'Atajo: ← / → ajustan ±0.1 s, con Mayús ±0.5 s. Espacio reproduce/pausa.'),
  );
  wrap.appendChild(offsetBox);

  // Editor
  const editor = el('section', 'editor-box');
  editor.append(el('h2', undefined, 'Editor'));
  const trimRow = el('div', 'editor-row');
  const mkTrim = (labelText: string, btnText: string): [HTMLInputElement, HTMLButtonElement] => {
    const group = el('label', 'trim-group', labelText);
    const input = el('input', 'trim-input');
    input.type = 'number';
    input.min = '0';
    input.step = '0.1';
    input.placeholder = 's';
    const btn = el('button', 'btn btn-small', btnText);
    btn.type = 'button';
    group.append(input, btn);
    trimRow.appendChild(group);
    return [input, btn];
  };
  const [trimStartInput, trimStartBtn] = mkTrim('Inicio ', '⦉ cursor');
  const [trimEndInput, trimEndBtn] = mkTrim('Fin ', 'cursor ⦊');
  trimStartBtn.addEventListener('click', () => {
    trimStartInput.value = video.currentTime.toFixed(1);
  });
  trimEndBtn.addEventListener('click', () => {
    trimEndInput.value = video.currentTime.toFixed(1);
  });
  editor.appendChild(trimRow);

  const optsRow = el('div', 'editor-row');
  const audioLabel = el('label', 'check', 'Incluir audio');
  const audioCheck = el('input');
  audioCheck.type = 'checkbox';
  audioCheck.checked = true;
  audioLabel.prepend(audioCheck);
  const unitsGroup = el('div', 'units');
  const mkUnit = (value: Units, text: string): void => {
    const label = el('label', 'check', text);
    const radio = el('input');
    radio.type = 'radio';
    radio.name = 'units';
    radio.value = value;
    radio.checked = value === units;
    radio.addEventListener('change', () => {
      if (radio.checked) units = value;
    });
    label.prepend(radio);
    unitsGroup.appendChild(label);
  };
  mkUnit('metric', 'km / m');
  mkUnit('imperial', 'mi / ft');
  optsRow.append(audioLabel, unitsGroup);
  editor.appendChild(optsRow);

  const widgetsTitle = el('h3', undefined, 'Widgets');
  const widgetsBox = el('div', 'widgets');
  editor.append(widgetsTitle, widgetsBox);
  wrap.appendChild(editor);

  // Render
  const renderBox = el('section', 'render-box');
  renderBox.append(el('h2', undefined, 'Render'));

  const renderRow = el('div', 'render-row');
  const renderBtn = el('button', 'btn btn-primary', 'Renderizar video');
  renderBtn.type = 'button';
  renderRow.appendChild(renderBtn);
  renderBox.appendChild(renderRow);
  const progress = el('progress', 'render-progress');
  progress.max = 1;
  progress.value = 0;
  progress.hidden = true;
  progress.setAttribute('aria-label', 'Progreso del render');
  const progressLabel = el('p', 'muted', '');
  const previewCanvas = el('canvas', 'render-preview');
  previewCanvas.hidden = true;
  const result = el('p', 'result');
  renderBox.append(progress, progressLabel, previewCanvas, result);
  wrap.appendChild(renderBox);

  const footer = el('p', 'muted');
  wrap.appendChild(footer);
  root.appendChild(wrap);

  const setStatus = (text: string): void => {
    status.textContent = text;
  };

  const repaintThumbs = (sample: TelemetrySample): void => {
    for (const th of thumbs) {
      const vis = widgetOverrides.get(th.template.id);
      const visKey = th.template.widgets
        .map((w) => `${w.id}:${vis?.get(w.id) ?? w.visible}`)
        .join(',');
      const sig = `${th.template.id}|${units}|${Math.floor(sample.t)}|${visKey}`;
      if (sig === th.sig) continue;
      th.sig = sig;
      th.ctx.fillStyle = '#0d0d0d';
      th.ctx.fillRect(0, 0, 512, 288);
      drawOverlay(th.ctx, effectiveTemplate(th.template), sample, 512, 288, units);
    }
  };

  const rebuildWidgets = (): void => {
    widgetsBox.innerHTML = '';
    const template = selectedTemplate();
    if (!template) return;
    let overrides = widgetOverrides.get(template.id);
    if (!overrides) {
      overrides = new Map(template.widgets.map((w) => [w.id, w.visible]));
      widgetOverrides.set(template.id, overrides);
    }
    for (const widget of template.widgets) {
      const label = el('label', 'check', widget.id);
      const check = el('input');
      check.type = 'checkbox';
      check.checked = overrides.get(widget.id) ?? widget.visible;
      check.addEventListener('change', () => {
        overrides.set(widget.id, check.checked);
      });
      label.prepend(check);
      widgetsBox.appendChild(label);
    }
  };
  rebuildWidgets();

  const setVideoSource = (url: string, file: Blob, name: string): void => {
    if (videoURL && videoURL.startsWith('blob:')) URL.revokeObjectURL(videoURL);
    videoURL = url;
    videoFile = file;
    video.src = url;
    setStatus(`Video: ${name}.`);
  };

  const loadFitBuffer = (buffer: ArrayBuffer, name: string): void => {
    try {
      activity = parseFit(buffer);
      const s = summarize(activity);
      const distUnit = formatMetric('distance', s.distanceM, units);
      const speedUnit = s.avgSpeed !== null ? formatMetric('speed', s.avgSpeed, units) : null;
      footer.textContent =
        `FIT: ${name} — ${s.samples} muestras, ${formatClock(s.durationSec)}` +
        `, ${distUnit.value} ${distUnit.unit}` +
        (speedUnit ? `, media ${speedUnit.value} ${speedUnit.unit}` : '') +
        ` (schema v${TEMPLATE_SCHEMA_VERSION}).`;
      setStatus(`FIT cargado: ${s.samples} muestras. El overlay se previsualiza en vivo.`);
    } catch (err) {
      activity = null;
      setStatus(err instanceof Error ? err.message : 'No se pudo leer el FIT.');
    }
  };

  videoInput.addEventListener('change', () => {
    const file = videoInput.files?.[0];
    if (file) setVideoSource(URL.createObjectURL(file), file, file.name);
  });

  fitInput.addEventListener('change', () => {
    const file = fitInput.files?.[0];
    if (file) {
      void file.arrayBuffer().then((buffer) => loadFitBuffer(buffer, file.name));
    }
  });

  fixtureBtn.addEventListener('click', () => {
    setStatus('Cargando fixtures…');
    void fetch(FIXTURE_VIDEO_URL)
      .then((res) => {
        if (!res.ok) throw new Error('No se pudo cargar el fixture de video.');
        return res.blob();
      })
      .then((blob) => setVideoSource(URL.createObjectURL(blob), blob, 'sample-720p.mp4'))
      .then(() => fetch(FIXTURE_FIT_URL))
      .then((res) => {
        if (!res.ok) throw new Error('No se pudo cargar el fixture FIT.');
        return res.arrayBuffer();
      })
      .then((buffer) => loadFitBuffer(buffer, 'sample.fit'))
      .catch((err: unknown) => {
        setStatus(err instanceof Error ? err.message : 'Error cargando fixtures.');
      });
  });

  const syncPlayBtn = (): void => {
    playBtn.textContent = video.paused ? 'Reproducir' : 'Pausar';
  };

  const togglePlay = (): void => {
    if (!video.src) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
    syncPlayBtn();
  };

  playBtn.addEventListener('click', togglePlay);
  video.addEventListener('play', syncPlayBtn);
  video.addEventListener('pause', syncPlayBtn);

  // Widget drag & drop on the live canvas.
  interface DragState {
    widgetId: string;
    dx: number;
    dy: number;
    moved: boolean;
  }
  let drag: DragState | null = null;
  let downPos: { x: number; y: number } | null = null;

  const toNorm = (e: { clientX: number; clientY: number }): { nx: number; ny: number } => {
    const rect = canvas.getBoundingClientRect();
    return {
      nx: (e.clientX - rect.left) / rect.width,
      ny: (e.clientY - rect.top) / rect.height,
    };
  };

  const hitWidget = (nx: number, ny: number): string | undefined => {
    const template = selectedTemplate();
    if (!template || !activity) return undefined;
    const aspect = classifyAspect(canvas.width, canvas.height);
    const widgets = effectiveTemplate(template).widgets;
    for (let i = widgets.length - 1; i >= 0; i--) {
      const w = widgets[i];
      if (!w.visible) continue;
      const b = w.layout[aspect];
      if (nx >= b.x && nx <= b.x + b.w && ny >= b.y && ny <= b.y + b.h) return w.id;
    }
    return undefined;
  };

  canvas.addEventListener('pointerdown', (e) => {
    downPos = { x: e.clientX, y: e.clientY };
    const template = selectedTemplate();
    if (!template) return;
    const { nx, ny } = toNorm(e);
    const hit = hitWidget(nx, ny);
    if (!hit) return;
    const aspect = classifyAspect(canvas.width, canvas.height);
    const box = effectiveTemplate(template).widgets.find((w) => w.id === hit)?.layout[aspect];
    if (!box) return;
    drag = { widgetId: hit, dx: nx - box.x, dy: ny - box.y, moved: false };
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (drag) {
      const template = selectedTemplate();
      if (!template) return;
      if (
        downPos &&
        Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 3
      ) {
        drag.moved = true;
      }
      const aspect = classifyAspect(canvas.width, canvas.height);
      const widgetId = drag.widgetId;
      const box = effectiveTemplate(template).widgets.find((w) => w.id === widgetId)
        ?.layout[aspect];
      if (!box) return;
      const { nx, ny } = toNorm(e);
      let perTemplate = layoutOverrides.get(template.id);
      if (!perTemplate) {
        perTemplate = new Map();
        layoutOverrides.set(template.id, perTemplate);
      }
      perTemplate.set(drag.widgetId, {
        aspect,
        x: Math.min(Math.max(nx - drag.dx, 0), 1 - box.w),
        y: Math.min(Math.max(ny - drag.dy, 0), 1 - box.h),
      });
    } else if (e.pointerType === 'mouse' && downPos === null) {
      const { nx, ny } = toNorm(e);
      canvas.style.cursor = hitWidget(nx, ny) ? 'grab' : 'pointer';
    }
  });

  const endDrag = (e: PointerEvent): void => {
    if (drag) {
      drag = null;
      canvas.style.cursor = 'pointer';
    } else if (
      downPos &&
      Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) < 6
    ) {
      togglePlay();
    }
    downPos = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', () => {
    drag = null;
    downPos = null;
  });

  canvas.addEventListener('dblclick', (e) => {
    const template = selectedTemplate();
    if (!template) return;
    const { nx, ny } = toNorm(e);
    const hit = hitWidget(nx, ny);
    if (hit) layoutOverrides.get(template.id)?.delete(hit);
  });

  renderBtn.addEventListener('click', () => {
    if (rendering) return;
    if (!videoFile) {
      setStatus('Carga primero un video.');
      return;
    }
    if (!activity) {
      setStatus('Carga primero un FIT.');
      return;
    }
    const template = selectedTemplate();
    if (!template) {
      setStatus('Plantilla no encontrada.');
      return;
    }
    const trimStart = Math.max(0, Number(trimStartInput.value) || 0);
    const trimEndRaw = trimEndInput.value.trim();
    const trimEnd = trimEndRaw === '' ? null : Number(trimEndRaw);
    if (trimEnd !== null && !(trimEnd > trimStart)) {
      setStatus('El fin del recorte debe ser mayor que el inicio.');
      return;
    }
    rendering = true;
    renderBtn.disabled = true;
    progress.hidden = false;
    previewCanvas.hidden = false;
    result.innerHTML = '';
    const job = { file: videoFile, act: activity, off: offsetSec, u: units };
    void renderVideo({
      file: job.file,
      activity: job.act,
      offsetSec: job.off,
      template: effectiveTemplate(template),
      units: job.u,
      includeAudio: audioCheck.checked,
      trimStart,
      trimEnd,
      canvas: previewCanvas,
      onProgress: (done, total) => {
        progress.value = total > 0 ? done / total : 0;
        progressLabel.textContent = `Renderizando ${formatClock(done)} / ${formatClock(total)}…`;
      },
    })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const mb = (blob.size / 1024 / 1024).toFixed(2);
        const link = el('a', undefined, `Descargar MP4 (${mb} MB)`);
        link.href = url;
        link.download = 'override.mp4';
        result.append('Listo. ', link);
        progressLabel.textContent = '';
        progress.hidden = true;
      })
      .catch((err: unknown) => {
        setStatus(err instanceof Error ? err.message : 'Falló el render.');
        progressLabel.textContent = '';
        progress.hidden = true;
      })
      .finally(() => {
        rendering = false;
        renderBtn.disabled = false;
      });
  });

  video.addEventListener('loadedmetadata', () => {
    timeline.max = String(video.duration);
    timeline.disabled = false;
    playBtn.disabled = false;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    if (trimEndInput.value.trim() === '' && Number.isFinite(video.duration)) {
      trimEndInput.value = video.duration.toFixed(1);
    }
  });

  let scrubbing = false;
  timeline.addEventListener('pointerdown', () => {
    scrubbing = true;
  });
  window.addEventListener('pointerup', () => {
    scrubbing = false;
  });
  timeline.addEventListener('input', () => {
    video.currentTime = Number(timeline.value);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === ' ') {
      if (event.target === document.body || event.target === canvas) {
        togglePlay();
        event.preventDefault();
      }
      return;
    }
    if (event.target instanceof HTMLInputElement) return;
    const step = event.shiftKey ? 0.5 : 0.1;
    if (event.key === 'ArrowLeft') {
      offsetSec = Math.min(120, Math.max(-120, offsetSec - step));
      event.preventDefault();
    } else if (event.key === 'ArrowRight') {
      offsetSec = Math.min(120, Math.max(-120, offsetSec + step));
      event.preventDefault();
    }
  });

  const paintPlaceholder = (): void => {
    if (canvas.width === 300 && canvas.height === 150) {
      canvas.width = 1280;
      canvas.height = 720;
    }
    liveCtx.fillStyle = '#0d0d0d';
    liveCtx.fillRect(0, 0, canvas.width, canvas.height);
    liveCtx.fillStyle = '#898989';
    liveCtx.font = '300 28px Inter, system-ui, sans-serif';
    liveCtx.textAlign = 'center';
    liveCtx.textBaseline = 'middle';
    liveCtx.fillText('Carga un video para previsualizar', canvas.width / 2, canvas.height / 2);
  };
  paintPlaceholder();

  const tick = (): void => {
    const vt = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    if (!scrubbing && Number.isFinite(video.duration)) {
      timeline.max = String(video.duration);
      timeline.value = String(vt);
    }
    videoClock.textContent = `video ${formatClock(vt)}`;
    offsetClock.textContent = formatOffset(offsetSec);

    if (video.src && video.readyState >= 2 && video.videoWidth > 0) {
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      liveCtx.drawImage(video, 0, 0, canvas.width, canvas.height);
      if (activity) {
        const tt = vt + offsetSec;
        const inRange = tt >= 0 && tt <= activity.durationSec;
        const sample = sampleAt(activity, tt);
        const template = selectedTemplate();
        if (template) {
          drawOverlay(
            liveCtx,
            effectiveTemplate(template),
            sample,
            canvas.width,
            canvas.height,
            units,
          );
        }
        teleClock.textContent = `tele ${formatClock(sample.t)}${inRange ? '' : ' (fuera de rango)'}`;
        teleClock.classList.toggle('out-of-range', !inRange);
        repaintThumbs(sample);
      } else {
        teleClock.textContent = 'tele —';
        repaintThumbs({ ...DEMO_SAMPLE, t: vt });
      }
    } else if (!video.src) {
      teleClock.textContent = 'tele —';
      repaintThumbs(DEMO_SAMPLE);
      if (video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) paintPlaceholder();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
