import {
  TEMPLATE_SCHEMA_VERSION,
  classifyAspect,
  type AspectClass,
  type Template,
} from '@override-studio/shared';
import {
  parseFit,
  sampleAt,
  summarize,
  formatClock,
  formatSpan,
  type Activity,
  type TelemetrySample,
} from './telemetry.js';
import { formatMetric, type Units } from './format.js';
import { getCreationTime } from './video-meta.js';
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

/** A clip can sit anywhere inside a long activity, so the guard is generous. */
const OFFSET_LIMIT = 86400;

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
  w: number;
  h: number;
}

/** One video of the ride. Sync/trim/audio are per clip; template + units are global. */
interface Clip {
  id: number;
  name: string;
  file: Blob;
  url: string;
  duration: number;
  videoCreation: Date | null;
  offsetSec: number;
  offsetDirty: boolean;
  trimStart: number;
  trimEnd: number | null;
  includeAudio: boolean;
  status: 'listo' | 'renderizando' | 'hecho' | 'error';
}

export async function renderApp(root: HTMLElement): Promise<void> {
  let activity: Activity | null = null;
  const clips: Clip[] = [];
  let selectedClipId: number | null = null;
  let nextClipId = 1;
  let rendering = false;
  let units: Units = 'metric';
  let selectedTemplateId = BUILTIN_TEMPLATES[0].id;
  const widgetOverrides = new Map<string, Map<string, boolean>>();
  const layoutOverrides = new Map<string, Map<string, LayoutOverride>>();

  const activeClip = (): Clip | null =>
    clips.find((c) => c.id === selectedClipId) ?? null;

  const selectedTemplate = (): Template | undefined =>
    BUILTIN_TEMPLATES.find((t) => t.id === selectedTemplateId);

  const effectiveTemplate = (template: Template): Template => {
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
            ? {
                ...w.layout,
                [pos.aspect]: {
                  ...w.layout[pos.aspect],
                  x: pos.x,
                  y: pos.y,
                  w: pos.w,
                  h: pos.h,
                },
              }
            : w.layout,
        };
      }),
    };
  };

  root.innerHTML = '';
  const wrap = el('main', 'app');

  // Header: project-level controls (FIT, units, fixtures, render all).
  const header = el('header', 'app-header');
  const logo = el('img', 'header-logo');
  logo.src = '/icon.svg';
  logo.alt = '';
  header.append(logo, el('h1', undefined, 'override.studio'));
  header.append(el('span', 'phase-badge', 'render 100% local'));
  const headerSpacer = el('span', 'header-spacer');
  const headerActions = el('div', 'header-actions');
  const fitLabel = el('label', 'file-label', 'Archivo FIT');
  const fitInput = el('input');
  fitInput.type = 'file';
  fitInput.accept = '.fit';
  fitLabel.appendChild(fitInput);
  const fitPill = el('span', 'phase-badge', 'sin FIT');
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
  const fixtureBtn = el('button', 'btn', 'Fixtures');
  fixtureBtn.type = 'button';
  const renderAllBtn = el('button', 'btn btn-primary', 'Renderizar todo');
  renderAllBtn.type = 'button';
  headerActions.append(fitLabel, fitPill, unitsGroup, fixtureBtn, renderAllBtn);
  header.append(headerSpacer, headerActions);
  wrap.appendChild(header);

  const status = el('p', 'muted', 'Agrega los videos de la salida y un FIT, o usa los fixtures.');
  status.setAttribute('role', 'status');
  wrap.appendChild(status);

  const grid = el('div', 'editor-grid');
  wrap.appendChild(grid);

  // Media bin (left): the ride's clips.
  const bin = el('aside', 'bin');
  const binHead = el('div', 'bin-head');
  binHead.append(el('h2', undefined, 'Clips'));
  const binCount = el('span', 'muted', '0');
  binHead.appendChild(binCount);
  const addLabel = el('label', 'file-label', '+ Agregar videos');
  const videoInput = el('input');
  videoInput.type = 'file';
  videoInput.accept = 'video/mp4,.mp4,video/quicktime,.mov';
  videoInput.multiple = true;
  addLabel.appendChild(videoInput);
  const binList = el('div', 'bin-list');
  const binEmpty = el('p', 'muted', 'Sin clips. Los videos de una misma salida comparten el FIT.');
  bin.append(binHead, addLabel, binList, binEmpty);
  grid.appendChild(bin);

  // Center: viewer + sync + templates.
  const center = el('div', 'center');
  grid.appendChild(center);
  const stage = el('section', 'stage');
  const video = el('video', 'source-video');
  video.preload = 'auto';
  video.setAttribute('aria-hidden', 'true');
  const canvas = el('canvas', 'live-preview');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Previsualización del video con la telemetría superpuesta');
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
  const videoClock = el('span', undefined, 'video 00:00 / 00:00');
  const recordedClock = el('span', undefined, 'grabado —');
  const teleClock = el('span', undefined, 'tele —');
  const offsetClock = el('strong', undefined, formatOffset(0));
  clocks.append(playBtn, videoClock, recordedClock, teleClock, offsetClock);
  const stageHint = el(
    'p',
    'muted',
    'Arrastra un widget para moverlo · arrastra su esquina azul para redimensionarlo · clic derecho lo elimina · doble clic restablece su posición y tamaño · clic en el video reproduce/pausa.',
  );
  stage.append(video, canvas, timeline, clocks, stageHint);
  center.appendChild(stage);

  // Sync lives right under the video timeline.
  const syncBox = el('section', 'offset-box');
  syncBox.append(el('h2', undefined, 'Sincronización'));
  const offsetBtns = el('div', 'offset-btns');
  syncBox.append(offsetBtns);
  syncBox.append(
    el(
      'p',
      'muted',
      'Atajo: ← / → ajustan ±0.1 s, con Mayús ±0.5 s. Espacio reproduce/pausa. Arrastra sobre la actividad para posicionar el clip.',
    ),
  );
  center.appendChild(syncBox);

  // Template selector, right under the live preview.
  const templateBox = el('section', 'template-box');
  const templateHead = el('div', 'template-head');
  templateHead.append(el('h2', undefined, 'Plantilla'));
  const resetWidgetsBtn = el('button', 'btn btn-small', 'Restablecer widgets');
  resetWidgetsBtn.type = 'button';
  resetWidgetsBtn.title = 'Restaura los widgets eliminados y sus posiciones originales';
  resetWidgetsBtn.addEventListener('click', () => {
    const template = selectedTemplate();
    if (!template) return;
    widgetOverrides.delete(template.id);
    layoutOverrides.delete(template.id);
  });
  templateHead.appendChild(resetWidgetsBtn);
  templateBox.appendChild(templateHead);
  interface Thumb {
    template: Template;
    card: HTMLButtonElement;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    sig: string;
  }
  let thumbAspect: AspectClass = 'horizontal';
  let lastThumbSample: TelemetrySample = DEMO_SAMPLE;
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
      syncCards();
    });
    cardsBox.appendChild(card);
    thumbs.push({ template: t, card, canvas: thumbCanvas, ctx: thumbCtx, sig: '' });
  }
  /** Thumbnails mirror the loaded video's aspect so cards preview the real layout. */
  const sizeThumbs = (): void => {
    const dims =
      thumbAspect === 'vertical'
        ? { w: 162, h: 288 }
        : thumbAspect === 'square'
          ? { w: 288, h: 288 }
          : { w: 512, h: 288 };
    for (const th of thumbs) {
      th.canvas.width = dims.w;
      th.canvas.height = dims.h;
      th.sig = '';
    }
  };
  templateBox.appendChild(cardsBox);
  syncCards();
  // Templates sit above the viewer: one strip, no scroll to pick one.
  center.prepend(templateBox);

  // Inspector (right): selected clip settings + render.
  const inspector = el('aside', 'inspector');
  inspector.append(el('h2', undefined, 'Clip'));
  const clipName = el('p', 'clip-name', 'Sin clip seleccionado');
  inspector.appendChild(clipName);
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
    trimStartInput.dispatchEvent(new Event('change'));
  });
  trimEndBtn.addEventListener('click', () => {
    trimEndInput.value = video.currentTime.toFixed(1);
    trimEndInput.dispatchEvent(new Event('change'));
  });
  trimStartInput.addEventListener('change', () => {
    const clip = activeClip();
    if (clip) clip.trimStart = Math.max(0, Number(trimStartInput.value) || 0);
  });
  trimEndInput.addEventListener('change', () => {
    const clip = activeClip();
    if (!clip) return;
    const raw = trimEndInput.value.trim();
    clip.trimEnd = raw === '' ? null : Math.max(0, Number(raw) || 0);
  });
  inspector.appendChild(trimRow);
  const audioLabel = el('label', 'check', 'Incluir audio');
  const audioCheck = el('input');
  audioCheck.type = 'checkbox';
  audioCheck.checked = true;
  audioLabel.prepend(audioCheck);
  audioCheck.addEventListener('change', () => {
    const clip = activeClip();
    if (clip) clip.includeAudio = audioCheck.checked;
  });
  inspector.appendChild(audioLabel);
  inspector.append(el('h2', undefined, 'Render'));
  const renderRow = el('div', 'render-row');
  const renderBtn = el('button', 'btn btn-primary', 'Renderizar clip');
  renderBtn.type = 'button';
  renderRow.appendChild(renderBtn);
  inspector.appendChild(renderRow);
  const progress = el('progress', 'render-progress');
  progress.max = 1;
  progress.value = 0;
  progress.hidden = true;
  progress.setAttribute('aria-label', 'Progreso del render');
  const progressLabel = el('p', 'muted', '');
  const previewCanvas = el('canvas', 'render-preview');
  previewCanvas.hidden = true;
  const result = el('div', 'result');
  inspector.append(progress, progressLabel, previewCanvas, result);
  grid.appendChild(inspector);

  // Bottom timeline: the whole activity with every clip window.
  const timelineBox = el('section', 'timeline-box');
  timelineBox.append(el('h2', undefined, 'Actividad'));
  const activityCanvas = el('canvas', 'activity-overview');
  activityCanvas.width = 1400;
  activityCanvas.height = 110;
  activityCanvas.setAttribute('role', 'img');
  activityCanvas.setAttribute('aria-label', 'Vista general de la actividad con la posición de los clips');
  const activityCtx = activityCanvas.getContext('2d');
  if (!activityCtx) throw new Error('No se pudo crear el lienzo de actividad.');
  const activityLabel = el('p', 'muted', 'Carga un FIT para ver la actividad.');
  timelineBox.append(activityCanvas, activityLabel);
  wrap.appendChild(timelineBox);

  const footer = el('p', 'muted');
  wrap.appendChild(footer);
  root.appendChild(wrap);

  const setStatus = (text: string): void => {
    status.textContent = text;
  };

  const repaintThumbs = (sample: TelemetrySample): void => {
    lastThumbSample = sample;
    for (const th of thumbs) {
      const vis = widgetOverrides.get(th.template.id);
      const visKey = th.template.widgets
        .map((w) => `${w.id}:${vis?.get(w.id) ?? w.visible}`)
        .join(',');
      const sig = `${th.template.id}|${units}|${thumbAspect}|${Math.floor(sample.t)}|${visKey}`;
      if (sig === th.sig) continue;
      th.sig = sig;
      th.ctx.fillStyle = '#0d0d0d';
      th.ctx.fillRect(0, 0, th.canvas.width, th.canvas.height);
      drawOverlay(
        th.ctx,
        effectiveTemplate(th.template),
        sample,
        th.canvas.width,
        th.canvas.height,
        units,
      );
    }
  };

  const fmtRecorded = (d: Date): string => {
    const pad = (n: number): string => String(n).padStart(2, '0');
    return (
      `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  };

  const clipWindow = (clip: Clip): [number, number] => {
    const dur = clip.duration > 0 ? clip.duration : 0;
    const start = clip.offsetSec + clip.trimStart;
    const end = clip.offsetSec + (clip.trimEnd ?? dur);
    return [start, Math.max(end, start)];
  };

  const binRows = new Map<number, { row: HTMLButtonElement; meta: HTMLSpanElement }>();

  const syncBin = (): void => {
    binCount.textContent = String(clips.length);
    binEmpty.hidden = clips.length > 0;
    binList.innerHTML = '';
    binRows.clear();
    for (const clip of clips) {
      const row = el('button', 'clip-row');
      row.type = 'button';
      if (clip.id === selectedClipId) row.classList.add('selected');
      const dot = el('span', `clip-dot clip-dot-${clip.status}`);
      const name = el('span', 'clip-title', clip.name);
      name.title = clip.name;
      const meta = el('span', 'clip-meta');
      const remove = el('span', 'clip-remove', '×');
      remove.title = 'Quitar clip';
      remove.setAttribute('role', 'button');
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        removeClip(clip.id);
      });
      row.append(dot, name, meta, remove);
      row.addEventListener('click', () => selectClip(clip.id));
      binList.appendChild(row);
      binRows.set(clip.id, { row, meta });
    }
    syncBinMeta();
  };

  /** Offset text updates live; called from tick with a cheap string compare. */
  let binMetaSig = '';
  const syncBinMeta = (): void => {
    const sig = clips
      .map(
        (c) =>
          `${c.id}:${c.status}:${c.duration.toFixed(1)}:${c.offsetSec.toFixed(1)}:${c.videoCreation?.getTime() ?? -1}`,
      )
      .join('|');
    if (sig === binMetaSig) return;
    binMetaSig = sig;
    for (const clip of clips) {
      const refs = binRows.get(clip.id);
      if (!refs) continue;
      const parts = [
        clip.duration > 0 ? formatClock(clip.duration) : '—',
        clip.videoCreation ? fmtRecorded(clip.videoCreation) : 'sin fecha',
        formatOffset(clip.offsetSec),
      ];
      refs.meta.textContent = parts.join(' · ');
      refs.row.classList.toggle('selected', clip.id === selectedClipId);
    }
  };

  const showRecorded = (clip: Clip | null): void => {
    recordedClock.textContent =
      clip?.videoCreation ? `grabado ${fmtRecorded(clip.videoCreation)}` : 'grabado —';
  };

  const selectClip = (id: number): void => {
    const clip = clips.find((c) => c.id === id);
    if (!clip) return;
    selectedClipId = id;
    if (video.src !== clip.url) {
      video.src = clip.url;
      video.currentTime = 0;
    }
    trimStartInput.value = clip.trimStart > 0 ? String(clip.trimStart) : '';
    trimEndInput.value = clip.trimEnd !== null ? String(clip.trimEnd) : '';
    audioCheck.checked = clip.includeAudio;
    clipName.textContent = clip.name;
    showRecorded(clip);
    binMetaSig = '';
    syncBinMeta();
  };

  const removeClip = (id: number): void => {
    if (rendering) {
      setStatus('Espera a que termine el render para quitar clips.');
      return;
    }
    const idx = clips.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const [clip] = clips.splice(idx, 1);
    if (clip.url.startsWith('blob:')) URL.revokeObjectURL(clip.url);
    if (selectedClipId === id) {
      selectedClipId = null;
      const next = clips[0];
      if (next) {
        selectClip(next.id);
      } else {
        video.removeAttribute('src');
        video.load();
        timeline.disabled = true;
        timeline.value = '0';
        timeline.max = '0';
        playBtn.disabled = true;
        clipName.textContent = 'Sin clip seleccionado';
        showRecorded(null);
      }
    }
    binMetaSig = '';
    syncBin();
  };

  const applyAutoOffset = (clip: Clip): boolean => {
    if (!activity || !clip.videoCreation) return false;
    clip.offsetSec = Math.min(
      OFFSET_LIMIT,
      Math.max(
        -OFFSET_LIMIT,
        (clip.videoCreation.getTime() - activity.startTime.getTime()) / 1000,
      ),
    );
    clip.offsetDirty = true;
    return true;
  };

  const tryAutoSync = (clip: Clip | null = activeClip()): void => {
    if (!clip || clip.offsetDirty) return;
    if (!activity || !clip.videoCreation) {
      if (activity && !clip.videoCreation) {
        setStatus(
          `“${clip.name}” sin fecha de grabación: posiciónalo en la vista de actividad.`,
        );
      }
      return;
    }
    const fmt = (d: Date): string => d.toLocaleTimeString('es', { hour12: false });
    applyAutoOffset(clip);
    setStatus(
      `Offset auto “${clip.name}”: ${formatOffset(clip.offsetSec)} ` +
        `(video ${fmt(clip.videoCreation)} − FIT ${fmt(activity.startTime)}). Ajusta fino con ← / →.`,
    );
  };

  const addClip = (file: Blob, name: string): void => {
    const clip: Clip = {
      id: nextClipId++,
      name,
      file,
      url: URL.createObjectURL(file),
      duration: 0,
      videoCreation: null,
      offsetSec: 0,
      offsetDirty: false,
      trimStart: 0,
      trimEnd: null,
      includeAudio: true,
      status: 'listo',
    };
    clips.push(clip);
    syncBin();
    if (selectedClipId === null) selectClip(clip.id);
    else binMetaSig = '';
    void getCreationTime(file).then((date) => {
      if (!clips.includes(clip)) return;
      clip.videoCreation = date;
      if (clip.id === selectedClipId) showRecorded(clip);
      tryAutoSync(clip);
      binMetaSig = '';
    });
    setStatus(`Clip agregado: ${name}.`);
  };

  const loadFitBuffer = (buffer: ArrayBuffer, name: string): void => {
    try {
      activity = parseFit(buffer);
      fitPill.textContent = name;
      overviewCache = null;
      const metric = pickOverviewMetric(activity);
      if (metric) {
        let min = Infinity;
        let max = -Infinity;
        for (const s of activity.samples) {
          const v = s[metric];
          if (typeof v === 'number') {
            if (v < min) min = v;
            if (v > max) max = v;
          }
        }
        if (max > min) overviewCache = { metric, min, max };
      }
      const s = summarize(activity);
      const distUnit = formatMetric('distance', s.distanceM, units);
      const speedUnit = s.avgSpeed !== null ? formatMetric('speed', s.avgSpeed, units) : null;
      footer.textContent =
        `FIT: ${name} — ${s.samples} muestras, ${formatSpan(s.durationSec)}` +
        `, ${distUnit.value} ${distUnit.unit}` +
        (speedUnit ? `, media ${speedUnit.value} ${speedUnit.unit}` : '') +
        ` (schema v${TEMPLATE_SCHEMA_VERSION}).`;
      // One ride, many videos: every undated clip gets its auto offset now.
      let synced = 0;
      for (const clip of clips) {
        if (!clip.offsetDirty && applyAutoOffset(clip)) synced += 1;
      }
      setStatus(
        `FIT cargado: ${s.samples} muestras` +
          (synced > 0 ? `, ${synced} clip(s) sincronizados.` : '. El overlay se previsualiza en vivo.'),
      );
      const clip = activeClip();
      if (clip && activity && !clip.videoCreation) tryAutoSync(clip);
      binMetaSig = '';
    } catch (err) {
      activity = null;
      setStatus(err instanceof Error ? err.message : 'No se pudo leer el FIT.');
    }
  };

  videoInput.addEventListener('change', () => {
    const files = videoInput.files;
    if (files) for (const file of files) addClip(file, file.name);
    videoInput.value = '';
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
      .then((blob) => addClip(blob, 'sample-720p.mp4'))
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

  // Sync buttons act on the selected clip.
  const needClip = (): Clip | null => {
    const clip = activeClip();
    if (!clip) setStatus('Agrega primero un video.');
    return clip;
  };
  const autoBtn = el('button', 'btn', 'Auto');
  autoBtn.type = 'button';
  autoBtn.title = 'Calcula el offset desde la fecha del video y el inicio del FIT';
  autoBtn.addEventListener('click', () => {
    const clip = needClip();
    if (!clip) return;
    if (!activity) {
      setStatus('Carga primero un FIT.');
      return;
    }
    if (!clip.videoCreation) {
      setStatus('El video no trae fecha de grabación en sus metadatos.');
      return;
    }
    applyAutoOffset(clip);
  });
  offsetBtns.appendChild(autoBtn);
  for (const delta of [-0.5, -0.1, 0.1, 0.5]) {
    const btn = el('button', 'btn', `${delta > 0 ? '+' : ''}${delta.toFixed(1)} s`);
    btn.type = 'button';
    btn.addEventListener('click', () => {
      const clip = needClip();
      if (!clip) return;
      clip.offsetSec = Math.min(OFFSET_LIMIT, Math.max(-OFFSET_LIMIT, clip.offsetSec + delta));
      clip.offsetDirty = true;
    });
    offsetBtns.appendChild(btn);
  }
  const zeroBtn = el('button', 'btn', '0.0 s');
  zeroBtn.type = 'button';
  zeroBtn.addEventListener('click', () => {
    const clip = needClip();
    if (!clip) return;
    clip.offsetSec = 0;
    clip.offsetDirty = true;
  });
  offsetBtns.appendChild(zeroBtn);

  // Activity overview: coarse clip positioning for long activities.
  type OverviewMetric = 'power' | 'speed' | 'heartRate';
  const OVERVIEW_LABELS: Record<OverviewMetric, string> = {
    power: 'Potencia',
    speed: 'Velocidad',
    heartRate: 'FC',
  };
  const OVERVIEW_PAD = 10;
  let overviewCache: { metric: OverviewMetric; min: number; max: number } | null = null;

  const pickOverviewMetric = (act: Activity): OverviewMetric | null => {
    const keys: OverviewMetric[] = ['power', 'speed', 'heartRate'];
    const stride = Math.max(1, Math.floor(act.samples.length / 200));
    for (const key of keys) {
      let present = 0;
      let total = 0;
      for (let i = 0; i < act.samples.length; i += stride) {
        total += 1;
        if (typeof act.samples[i][key] === 'number') present += 1;
      }
      if (total > 0 && present / total > 0.5) return key;
    }
    return null;
  };

  const paintOverview = (tt: number): void => {
    const W = activityCanvas.width;
    const H = activityCanvas.height;
    activityCtx.fillStyle = '#ffffff';
    activityCtx.fillRect(0, 0, W, H);
    if (!activity || !overviewCache || activity.durationSec <= 0) {
      activityCtx.fillStyle = '#898989';
      activityCtx.font = '300 20px Inter, system-ui, sans-serif';
      activityCtx.textAlign = 'center';
      activityCtx.textBaseline = 'middle';
      activityCtx.fillText(
        activity ? 'Sin datos graficables' : 'Carga un FIT para ver la actividad',
        W / 2,
        H / 2,
      );
      activityLabel.textContent = activity ? '' : 'Carga un FIT para ver la actividad.';
      return;
    }
    const { metric, min, max } = overviewCache;
    const dur = activity.durationSec;
    const X = (t: number): number =>
      OVERVIEW_PAD + (Math.min(Math.max(t, 0), dur) / dur) * (W - OVERVIEW_PAD * 2);
    const Y = (v: number): number =>
      H - OVERVIEW_PAD - ((v - min) / (max - min)) * (H - OVERVIEW_PAD * 2);
    activityCtx.beginPath();
    activityCtx.moveTo(X(0), H - OVERVIEW_PAD);
    const stride = Math.max(1, Math.floor(activity.samples.length / 400));
    for (let i = 0; i < activity.samples.length; i += stride) {
      const s = activity.samples[i];
      const v = s[metric];
      activityCtx.lineTo(X(s.t), Y(typeof v === 'number' ? v : min));
    }
    activityCtx.lineTo(X(dur), H - OVERVIEW_PAD);
    activityCtx.closePath();
    activityCtx.fillStyle = 'rgba(36, 36, 36, 0.14)';
    activityCtx.fill();
    for (const clip of clips) {
      const [winStart, winEnd] = clipWindow(clip);
      const selected = clip.id === selectedClipId;
      activityCtx.fillStyle = selected ? 'rgba(0, 153, 255, 0.16)' : 'rgba(36, 36, 36, 0.10)';
      activityCtx.fillRect(X(winStart), 2, Math.max(2, X(winEnd) - X(winStart)), H - 4);
      activityCtx.strokeStyle = selected ? '#101010' : '#898989';
      activityCtx.lineWidth = 1;
      activityCtx.strokeRect(X(winStart) + 0.5, 2.5, Math.max(2, X(winEnd) - X(winStart)), H - 5);
    }
    activityCtx.strokeStyle = '#0099ff';
    activityCtx.lineWidth = 2;
    activityCtx.beginPath();
    activityCtx.moveTo(X(tt), 0);
    activityCtx.lineTo(X(tt), H);
    activityCtx.stroke();
    const clip = activeClip();
    activityLabel.textContent = clip
      ? `${OVERVIEW_LABELS[metric]} · “${clip.name}” ${formatSpan(clipWindow(clip)[0])} – ${formatSpan(clipWindow(clip)[1])}`
      : `${OVERVIEW_LABELS[metric]} · ${clips.length} clip(s)`;
  };

  const overviewSeek = (clientX: number, center: boolean): void => {
    const clip = activeClip();
    if (!clip || !activity || activity.durationSec <= 0) return;
    const rect = activityCanvas.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * activityCanvas.width;
    const t =
      ((px - OVERVIEW_PAD) / (activityCanvas.width - OVERVIEW_PAD * 2)) * activity.durationSec;
    const videoDur = clip.duration > 0 ? clip.duration : 0;
    const maxStart = Math.max(0, activity.durationSec - videoDur);
    const target = center ? t - videoDur / 2 : t - (overviewDrag?.grabDelta ?? 0);
    clip.offsetSec = Math.min(
      OFFSET_LIMIT,
      Math.max(-OFFSET_LIMIT, Math.min(Math.max(target, 0), maxStart)),
    );
    clip.offsetDirty = true;
  };

  let overviewDrag: { grabDelta: number; downX: number; downY: number; moved: boolean } | null =
    null;
  activityCanvas.addEventListener('pointerdown', (e) => {
    const clip = activeClip();
    if (!clip || !activity || activity.durationSec <= 0) return;
    const rect = activityCanvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * activityCanvas.width;
    const t =
      ((px - OVERVIEW_PAD) / (activityCanvas.width - OVERVIEW_PAD * 2)) * activity.durationSec;
    overviewDrag = {
      grabDelta: t - clip.offsetSec,
      downX: e.clientX,
      downY: e.clientY,
      moved: false,
    };
    activityCanvas.setPointerCapture(e.pointerId);
  });
  activityCanvas.addEventListener('pointermove', (e) => {
    if (!overviewDrag) return;
    if (Math.hypot(e.clientX - overviewDrag.downX, e.clientY - overviewDrag.downY) > 4) {
      overviewDrag.moved = true;
    }
    if (overviewDrag.moved) overviewSeek(e.clientX, false);
  });
  activityCanvas.addEventListener('pointerup', (e) => {
    if (overviewDrag && !overviewDrag.moved) overviewSeek(e.clientX, true);
    overviewDrag = null;
  });
  activityCanvas.addEventListener('pointercancel', () => {
    overviewDrag = null;
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
    mode: 'move' | 'resize';
    dx: number;
    dy: number;
    moved: boolean;
  }
  let drag: DragState | null = null;
  let downPos: { x: number; y: number } | null = null;
  /** Selected widget shows an outline + resize handle; template-scoped so stale picks never match. */
  let selected: { templateId: string; widgetId: string } | null = null;
  /** Resize handle: square at the widget's bottom-right corner, in CSS px. */
  const HANDLE_PX = 14;
  /** Min normalized size: overlay skips boxes under 24×16 px, 0.04 stays above that at 720p+. */
  const MIN_NORM = 0.04;

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

  const selectedBox = (): { x: number; y: number; w: number; h: number } | null => {
    const template = selectedTemplate();
    const sel = selected;
    if (!template || !sel || sel.templateId !== template.id || !activity) return null;
    const aspect = classifyAspect(canvas.width, canvas.height);
    return (
      effectiveTemplate(template).widgets.find((w) => w.id === sel.widgetId)?.layout[aspect] ??
      null
    );
  };

  const onHandle = (e: { clientX: number; clientY: number }): boolean => {
    const box = selectedBox();
    if (!box) return false;
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + (box.x + box.w) * rect.width;
    const cy = rect.top + (box.y + box.h) * rect.height;
    return (
      e.clientX >= cx - HANDLE_PX &&
      e.clientX <= cx &&
      e.clientY >= cy - HANDLE_PX &&
      e.clientY <= cy
    );
  };

  canvas.addEventListener('pointerdown', (e) => {
    downPos = { x: e.clientX, y: e.clientY };
    const template = selectedTemplate();
    if (!template) return;
    const { nx, ny } = toNorm(e);
    const hit = hitWidget(nx, ny);
    if (!hit) return;
    selected = { templateId: template.id, widgetId: hit };
    const aspect = classifyAspect(canvas.width, canvas.height);
    const box = effectiveTemplate(template).widgets.find((w) => w.id === hit)?.layout[aspect];
    if (!box) return;
    const resize = onHandle(e);
    drag = resize
      ? {
          widgetId: hit,
          mode: 'resize',
          dx: box.x + box.w - nx,
          dy: box.y + box.h - ny,
          moved: false,
        }
      : { widgetId: hit, mode: 'move', dx: nx - box.x, dy: ny - box.y, moved: false };
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = resize ? 'nwse-resize' : 'grabbing';
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
      if (drag.mode === 'resize') {
        const w = Math.min(Math.max(nx + drag.dx - box.x, MIN_NORM), 1 - box.x);
        const h = Math.min(Math.max(ny + drag.dy - box.y, MIN_NORM), 1 - box.y);
        perTemplate.set(drag.widgetId, { aspect, x: box.x, y: box.y, w, h });
      } else {
        perTemplate.set(drag.widgetId, {
          aspect,
          x: Math.min(Math.max(nx - drag.dx, 0), 1 - box.w),
          y: Math.min(Math.max(ny - drag.dy, 0), 1 - box.h),
          w: box.w,
          h: box.h,
        });
      }
    } else if (e.pointerType === 'mouse' && downPos === null) {
      const { nx, ny } = toNorm(e);
      canvas.style.cursor = onHandle(e) ? 'nwse-resize' : hitWidget(nx, ny) ? 'grab' : 'pointer';
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
      selected = null;
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

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const template = selectedTemplate();
    if (!template) return;
    const { nx, ny } = toNorm(e);
    const hit = hitWidget(nx, ny);
    if (!hit) return;
    let perTemplate = widgetOverrides.get(template.id);
    if (!perTemplate) {
      perTemplate = new Map(template.widgets.map((w) => [w.id, w.visible]));
      widgetOverrides.set(template.id, perTemplate);
    }
    perTemplate.set(hit, false);
    if (selected?.widgetId === hit) selected = null;
  });

  const outputName = (clip: Clip): string => {
    const base = clip.name.replace(/\.[^.]*$/, '') || 'clip';
    return `${base}-overlay.mp4`;
  };

  /** Renders one clip; sequential by design (one encoder at a time). */
  const renderOne = async (clip: Clip, tag: string): Promise<void> => {
    if (!activity) throw new Error('Carga primero un FIT.');
    const template = selectedTemplate();
    if (!template) throw new Error('Plantilla no encontrada.');
    const trimStart = Math.max(0, clip.trimStart);
    if (clip.trimEnd !== null && !(clip.trimEnd > trimStart)) {
      throw new Error(`“${clip.name}”: el fin del recorte debe ser mayor que el inicio.`);
    }
    clip.status = 'renderizando';
    binMetaSig = '';
    const blob = await renderVideo({
      file: clip.file,
      activity,
      offsetSec: clip.offsetSec,
      template: effectiveTemplate(template),
      units,
      includeAudio: clip.includeAudio,
      trimStart,
      trimEnd: clip.trimEnd,
      canvas: previewCanvas,
      onProgress: (done, total) => {
        progress.value = total > 0 ? done / total : 0;
        progressLabel.textContent =
          `${tag} “${clip.name}”: ${formatClock(done)} / ${formatClock(total)}…`;
      },
    });
    const url = URL.createObjectURL(blob);
    const mb = (blob.size / 1024 / 1024).toFixed(2);
    const line = el('p', 'result-line');
    const link = el('a', undefined, `${outputName(clip)} (${mb} MB)`);
    link.href = url;
    link.download = outputName(clip);
    line.append('Listo. ', link);
    result.appendChild(line);
    clip.status = 'hecho';
    binMetaSig = '';
  };

  const setRendering = (on: boolean): void => {
    rendering = on;
    renderBtn.disabled = on;
    renderAllBtn.disabled = on;
    progress.hidden = !on;
    previewCanvas.hidden = !on;
    if (on) {
      progress.value = 0;
      result.innerHTML = '';
    }
  };

  renderBtn.addEventListener('click', () => {
    if (rendering) return;
    const clip = needClip();
    if (!clip || !activity) {
      if (!activity) setStatus('Carga primero un FIT.');
      return;
    }
    setRendering(true);
    void renderOne(clip, 'Renderizando')
      .then(() => {
        progressLabel.textContent = '';
        setStatus(`Render listo: ${outputName(clip)}.`);
      })
      .catch((err: unknown) => {
        clip.status = 'error';
        binMetaSig = '';
        setStatus(err instanceof Error ? err.message : 'Falló el render.');
        progressLabel.textContent = '';
      })
      .finally(() => setRendering(false));
  });

  renderAllBtn.addEventListener('click', () => {
    if (rendering) return;
    if (clips.length === 0) {
      setStatus('Agrega primero un video.');
      return;
    }
    if (!activity) {
      setStatus('Carga primero un FIT.');
      return;
    }
    setRendering(true);
    void (async () => {
      let done = 0;
      for (const clip of clips) {
        try {
          await renderOne(clip, `Clip ${done + 1}/${clips.length}.`);
          done += 1;
        } catch (err) {
          clip.status = 'error';
          binMetaSig = '';
          setStatus(err instanceof Error ? err.message : 'Falló el render.');
          break;
        }
      }
      progressLabel.textContent = '';
      if (done === clips.length) setStatus(`Render listo: ${done} clip(s).`);
    })().finally(() => setRendering(false));
  });

  video.addEventListener('error', () => {
    setStatus(
      'No se pudo decodificar este video en Chrome (¿HEVC de iPhone?). Conviértelo a H.264 para usarlo.',
    );
  });

  video.addEventListener('loadedmetadata', () => {
    timeline.max = String(video.duration);
    timeline.disabled = false;
    playBtn.disabled = false;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const clip = activeClip();
    if (clip) {
      clip.duration = Number.isFinite(video.duration) ? video.duration : 0;
      binMetaSig = '';
    }
    const thumbClass = classifyAspect(canvas.width, canvas.height);
    if (thumbClass !== thumbAspect) {
      thumbAspect = thumbClass;
      sizeThumbs();
      repaintThumbs(lastThumbSample);
    }
    if (clip && trimEndInput.value.trim() === '' && Number.isFinite(video.duration)) {
      trimEndInput.value = video.duration.toFixed(1);
      clip.trimEnd = Number.isFinite(video.duration) ? video.duration : null;
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
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const clip = activeClip();
      if (!clip) return;
      const delta = event.key === 'ArrowLeft' ? -step : step;
      clip.offsetSec = Math.min(OFFSET_LIMIT, Math.max(-OFFSET_LIMIT, clip.offsetSec + delta));
      clip.offsetDirty = true;
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
    liveCtx.fillText('Agrega videos para previsualizar', canvas.width / 2, canvas.height / 2);
  };
  paintPlaceholder();

  const tick = (): void => {
    const clip = activeClip();
    const offsetSec = clip?.offsetSec ?? 0;
    const vt = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    if (!scrubbing && Number.isFinite(video.duration)) {
      timeline.max = String(video.duration);
      timeline.value = String(vt);
    }
    // Video time stays outside the canvas: it is UI chrome, never rendered output.
    const dur = Number.isFinite(video.duration) ? video.duration : 0;
    videoClock.textContent = `video ${formatClock(vt)} / ${formatClock(dur)}`;
    offsetClock.textContent = formatOffset(offsetSec);

    if (video.src && video.readyState >= 2 && video.videoWidth > 0) {
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      // ponytail: preview ignores rotation metadata (render.ts handles it); rotated
      // videos preview unrotated — upgrade by mirroring drawSample's transform.
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
        // Selection chrome is preview-only: render.ts never sees it.
        const selBox = selectedBox();
        if (selBox) {
          const sx = selBox.x * canvas.width;
          const sy = selBox.y * canvas.height;
          const sw = selBox.w * canvas.width;
          const sh = selBox.h * canvas.height;
          liveCtx.save();
          liveCtx.strokeStyle = '#0099ff';
          liveCtx.lineWidth = 2;
          liveCtx.setLineDash([8, 5]);
          liveCtx.strokeRect(sx, sy, sw, sh);
          liveCtx.setLineDash([]);
          const hs = Math.max(14, canvas.width * 0.012);
          liveCtx.fillStyle = '#0099ff';
          liveCtx.fillRect(sx + sw - hs, sy + sh - hs, hs, hs);
          liveCtx.restore();
        }
        teleClock.textContent = `tele ${formatSpan(sample.t)}${inRange ? '' : ' (fuera de rango)'}`;
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
    syncBinMeta();
    paintOverview(activity ? vt + offsetSec : 0);
    requestAnimationFrame(tick);
  };
  syncBin();
  requestAnimationFrame(tick);
}
