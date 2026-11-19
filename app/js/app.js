import { loadModels, isCacao, predict } from './model-adapter.js';
import { addDiagnosis, getDiagnosis, listDiagnoses, deleteDiagnosis, restoreDiagnosis } from './history-db.js';
import {
  cameraSupported, startCamera, stopCamera, cameraActive, captureFrame, cameraErrorMessage, makeThumbnail,
} from './camera.js';
import { icon } from './icons.js';

const LOW_CONFIDENCE = 0.6;

const $ = (sel, root = document) => root.querySelector(sel);
const screenEl = $('#screen');
const fileCamera = $('#file-camera');
const fileGallery = $('#file-gallery');

const state = {
  tab: 'diagnostico',
  photo: null, // Blob de la foto actual
  photoUrl: null,
  vfMode: 'idle', // idle | live | photo | error
  vfError: '',
  current: null, // resultado sin guardar
  savedId: null,
  model: { status: 'loading', backend: '' },
};

let diseases = {};
let pageUrls = []; // object URLs de la pantalla actual (se liberan al cambiar)

// ------------------------------------------------------------------ utilidades
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = (p) => `${(p * 100).toFixed(1)}%`;
const secs = (ms) => `${(ms / 1000).toFixed(2)} s`;
const fmtDate = (t) => new Date(t).toLocaleString('es', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const pageUrl = (blob) => { const u = URL.createObjectURL(blob); pageUrls.push(u); return u; };

function ring(p, size, stroke) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const mid = size / 2;
  return `<svg class="ring" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle class="ring-track" cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke-width="${stroke}"/>
    <circle class="ring-value" cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - p)).toFixed(2)}" transform="rotate(-90 ${mid} ${mid})"/>
  </svg>`;
}

// `layout` elige la disposición responsiva de la pantalla (ver .layout-* en styles.css).
// El orden del HTML es siempre el del móvil; en pantallas anchas CSS Grid lo reubica.
function render(html, { focus = true, layout = 'narrow' } = {}) {
  html = `<div class="layout layout-${layout}">${html}</div>`;
  screenEl.innerHTML = html;
  // Libera las imágenes que ya no aparecen en pantalla (la foto actual se gestiona aparte).
  const keep = pageUrls.filter((u) => html.includes(u));
  pageUrls.filter((u) => !html.includes(u)).forEach((u) => URL.revokeObjectURL(u));
  pageUrls = keep;
  window.scrollTo({ top: 0 });
  if (focus) $('[data-focus]', screenEl)?.focus({ preventScroll: true });
}

let toastTimer;
function toast(message, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { hideToast(); action.run(); };
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? 6000 : 3000);
}
function hideToast() { $('#toast').classList.remove('is-visible'); }

function setPhoto(blob) {
  if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
  state.photo = blob;
  state.photoUrl = blob ? URL.createObjectURL(blob) : null;
  state.vfMode = blob ? 'photo' : 'idle';
  state.current = null;
  state.savedId = null;
}

// ------------------------------------------------------------------ estado de los modelos
function modelStatusHtml() {
  const { status } = state.model;
  if (status === 'ready') {
    return `<p class="model-status" id="model-status" data-state="ready"><span class="dot"></span>Modelos listos · funciona sin internet</p>`;
  }
  if (status === 'error') {
    return `<p class="model-status" id="model-status" data-state="error"><span class="dot"></span>No se pudieron cargar los modelos.
      <button class="btn btn-text" type="button" data-action="retry-models">Reintentar</button></p>`;
  }
  return `<p class="model-status" id="model-status" data-state="loading"><span class="dot"></span>Preparando modelos de IA…</p>`;
}

function refreshModelStatus() {
  const el = $('#model-status');
  if (el) el.outerHTML = modelStatusHtml();
}

function bootModels() {
  state.model.status = 'loading';
  refreshModelStatus();
  loadModels()
    .then((backend) => { state.model = { status: 'ready', backend }; refreshModelStatus(); })
    .catch((err) => { console.error(err); state.model.status = 'error'; refreshModelStatus(); });
}

// ------------------------------------------------------------------ pantalla: captura
function renderCapture({ focus = true } = {}) {
  const m = state.vfMode;
  let inner = '';
  if (m === 'idle') {
    inner = `<div class="vf-idle">
        <svg class="pod-art" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" aria-hidden="true">
          <path d="M12 3c4 0 6 4.5 6 9s-2 9-6 9-6-4.5-6-9 2-9 6-9z"/><path d="M12 3v18M9 4.2c-1 2.3-1.4 5-1.4 7.8s.4 5.5 1.4 7.8M15 4.2c1 2.3 1.4 5 1.4 7.8s-.4 5.5-1.4 7.8"/>
        </svg>
        <strong>Fotografía una mazorca</strong>
        <span>Toma una foto o elige una de tu galería</span>
      </div>`;
  } else if (m === 'live') {
    inner = `<video id="video" playsinline muted autoplay aria-label="Vista de la cámara"></video>`;
  } else if (m === 'photo') {
    inner = `<img class="vf-photo" src="${state.photoUrl}" alt="Foto seleccionada de la mazorca">`;
  } else if (m === 'error') {
    inner = `<div class="vf-error" role="alert">
        ${icon('alert')}
        <p>${esc(state.vfError)}</p>
        <button class="btn btn-secondary" type="button" data-action="take-photo">${icon('refresh')} Reintentar</button>
      </div>`;
  }

  let actions = '';
  if (m === 'live') {
    actions = `<button class="btn btn-primary" type="button" data-action="capture">${icon('shutter')} Capturar</button>
      <div class="btn-row">
        <button class="btn btn-secondary" type="button" data-action="gallery">${icon('gallery')} Galería</button>
        <button class="btn btn-secondary" type="button" data-action="cancel-camera">${icon('close')} Cancelar</button>
      </div>`;
  } else if (m === 'photo') {
    actions = `<button class="btn btn-primary" type="button" data-action="analyze">${icon('scan')} Analizar</button>
      <div class="btn-row">
        <button class="btn btn-secondary" type="button" data-action="take-photo">${icon('camera')} Otra foto</button>
        <button class="btn btn-secondary" type="button" data-action="gallery">${icon('gallery')} Galería</button>
      </div>`;
  } else {
    actions = `<button class="btn btn-primary" type="button" data-action="take-photo">${icon('camera')} Tomar foto</button>
      <button class="btn btn-secondary" type="button" data-action="gallery">${icon('gallery')} Elegir de galería</button>`;
  }

  render(`
    <div class="area-title">
      <h1 class="screen-title" tabindex="-1" data-focus>Nuevo diagnóstico</h1>
      <p class="screen-lead">Identifica Moniliasis, Fitoftora o Escoba de bruja.</p>
    </div>
    <section class="card area-media" aria-label="Foto de la mazorca">
      <div class="viewfinder" data-mode="${m}">
        ${inner}
        <div class="frame-guide" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      </div>
      <p class="guide">${icon('pod')} Centra la mazorca y evita sombras fuertes</p>
    </section>
    <div class="stack area-actions">${actions}</div>
    <div class="area-status">${modelStatusHtml()}</div>
    <aside class="card tips-card area-tips only-wide" aria-labelledby="tips-title">
      <h2 id="tips-title">Para una buena foto</h2>
      <ul class="tips">
        <li>Fotografía <strong>una sola mazorca</strong>, de cerca, ocupando casi todo el recuadro.</li>
        <li>Busca luz pareja: evita sombras fuertes y el sol directo detrás del fruto.</li>
        <li>Si el resultado sale poco confiable, repite la foto desde otro ángulo.</li>
      </ul>
      <h2>Cómo funciona</h2>
      <ol class="how">
        <li><strong>Filtro:</strong> comprueba que la foto sea de una mazorca de cacao.</li>
        <li><strong>Diagnóstico:</strong> identifica si está sana o tiene Moniliasis, Fitoftora o Escoba de bruja.</li>
      </ol>
    </aside>
  `, { focus, layout: 'capture' });

  if (m === 'live') {
    const video = $('#video');
    startCamera(video).then(() => {
      if (state.vfMode !== 'live' || !video.isConnected) stopCamera();
    }).catch((err) => {
      console.warn(err);
      // La cámara responde de forma asíncrona: si mientras tanto se cambió de
      // pantalla, no se redibuja la captura encima de la pantalla actual.
      if (state.vfMode !== 'live' || !video.isConnected) { stopCamera(); return; }
      state.vfMode = 'error';
      state.vfError = cameraErrorMessage(err);
      renderCapture();
    });
  }
}

// ------------------------------------------------------------------ pantalla: analizando
function renderAnalyzing() {
  render(`
    <section class="card analyzing" aria-busy="true">
      <div class="loader">
        <img src="${state.photoUrl}" alt="">
        ${ring(0.3, 148, 7)}
      </div>
      <h2 tabindex="-1" data-focus>Analizando mazorca…</h2>
      <ol class="steps" aria-live="polite">
        <li id="step-1" data-state="active"><span class="step-mark">1</span>Verificando que sea cacao</li>
        <li id="step-2" data-state="pending"><span class="step-mark">2</span>Identificando el estado</li>
      </ol>
      ${state.model.status !== 'ready' ? '<p class="screen-lead">La primera vez puede tardar unos segundos mientras se preparan los modelos.</p>' : ''}
    </section>
  `);
}

function markStep(n, s) {
  const li = $(`#step-${n}`);
  if (!li) return;
  li.dataset.state = s;
  if (s === 'done') li.querySelector('.step-mark').innerHTML = icon('check', { size: 16 });
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function analyze() {
  if (!state.photo) return;
  stopCamera();
  renderAnalyzing();
  await nextFrame();
  try {
    // Paso 1: si no es cacao, la imagen no se analiza.
    const gate = await isCacao(state.photo);
    if (!gate.isCacao) { renderNotCacao(gate); return; }
    markStep(1, 'done');
    markStep(2, 'active');
    await nextFrame();
    // Paso 2: estado de la mazorca.
    const res = await predict(state.photo);
    markStep(2, 'done');
    state.current = {
      label: res.label,
      confidence: res.confidence,
      inferenceMs: res.inferenceMs,
      gateConfidence: gate.confidence,
      createdAt: Date.now(),
    };
    state.savedId = null;
    renderResult(state.current, { photoUrl: state.photoUrl });
  } catch (err) {
    console.error(err);
    renderAnalysisError();
  }
}

function renderAnalysisError() {
  render(`
    <section class="card reject" role="alert">
      <div class="reject-photo">
        <img src="${state.photoUrl}" alt="">
        <span class="badge">${icon('alert')}</span>
      </div>
      <h2 tabindex="-1" data-focus>No se pudo completar el análisis</h2>
      <p>Los modelos de IA no respondieron. Si es la primera vez que usas la app, conéctate a internet una vez para descargarlos.</p>
    </section>
    <div class="stack">
      <button class="btn btn-primary" type="button" data-action="analyze">${icon('refresh')} Reintentar</button>
      <button class="btn btn-secondary" type="button" data-action="new">${icon('camera')} Cambiar foto</button>
    </div>
  `);
  bootModels();
}

// ------------------------------------------------------------------ pantalla: no es cacao
function renderNotCacao(gate) {
  render(`
    <section class="card reject">
      <div class="reject-photo">
        <img src="${state.photoUrl}" alt="Foto analizada">
        <span class="badge">${icon('alert')}</span>
      </div>
      <p class="eyebrow">Imagen rechazada</p>
      <h2 tabindex="-1" data-focus>No se puede analizar esta imagen</h2>
      <p><strong>No es un cacao.</strong> BioPlant AI solo diagnostica mazorcas de cacao, así que esta foto no se analizó.</p>
      <span class="chip chip-amber">${icon('pod')} Coincidencia con cacao: ${pct(gate.confidence)}</span>
      <ul class="tips">
        <li>Fotografía <strong>una mazorca de cacao</strong>, de cerca y ocupando casi todo el recuadro.</li>
        <li>Usa luz pareja y evita sombras fuertes.</li>
        <li>Si sí es cacao, prueba desde otro ángulo.</li>
      </ul>
    </section>
    <div class="stack">
      <button class="btn btn-primary" type="button" data-action="retake">${icon('camera')} Tomar otra foto</button>
      <button class="btn btn-secondary" type="button" data-action="gallery">${icon('gallery')} Elegir de galería</button>
    </div>
  `);
}

// ------------------------------------------------------------------ pantalla: resultado
function renderResult(rec, { photoUrl, fromHistory = false } = {}) {
  const d = diseases[rec.label];
  if (!d) { renderAnalysisError(); return; }
  const low = rec.confidence < LOW_CONFIDENCE;
  const healthy = rec.label === 'sano';

  const agentChip = healthy
    ? `<span class="chip">${icon('checkCircle')} Sin patógeno detectado</span>`
    : `<span class="chip">${icon('microbe')} ${esc(d.tipoAgente)} · <em>${esc(d.agente)}</em></span>`;

  const banners = [];
  if (low) {
    banners.push(`<div class="low-banner" role="alert">${icon('alert')}<span>Resultado poco confiable. Toma otra foto con mejor luz y enfoque.</span></div>`);
  } else if (healthy) {
    banners.push(`<div class="low-banner ok-banner">${icon('checkCircle')}<span>No se detectaron signos de enfermedad.</span></div>`);
  }

  const steps = d.pasos.map((p, i) => `
    <li class="step-card">
      <span class="step-icon">${icon(p.icono)}</span>
      <div>
        <h4>${healthy ? '' : `Paso ${i + 1}: `}${esc(p.titulo)}</h4>
        <p>${esc(p.texto)}</p>
      </div>
    </li>`).join('');

  let actions;
  if (fromHistory) {
    actions = `<button class="btn btn-secondary btn-danger" type="button" data-action="delete-current" data-id="${rec.id}">${icon('trash')} Eliminar del historial</button>`;
  } else {
    const saveBtn = state.savedId
      ? `<button class="btn ${low ? 'btn-secondary' : 'btn-primary'}" type="button" disabled>${icon('check')} Guardado en el historial</button>`
      : `<button class="btn ${low ? 'btn-secondary' : 'btn-primary'}" type="button" data-action="save">${icon('save')} Guardar en Historial</button>`;
    actions = low
      ? `<button class="btn btn-primary" type="button" data-action="retake">${icon('camera')} Repetir foto</button>${saveBtn}`
      : `${saveBtn}<button class="btn btn-secondary" type="button" data-action="new">${icon('camera')} Nuevo diagnóstico</button>`;
  }

  render(`
    ${fromHistory ? `<button class="back-link area-back" type="button" data-action="back-history">${icon('back')} Historial</button>` : ''}
    <article class="card diag-card area-diag" aria-labelledby="diag-name">
      ${photoUrl ? `<div class="diag-photo"><img src="${photoUrl}" alt="Foto analizada de la mazorca"></div>` : ''}
      <div class="diag-head">
        <div>
          <p class="eyebrow">${low ? 'Diagnóstico no concluyente' : 'Diagnóstico patológico'}</p>
          <h2 class="diag-name" id="diag-name" tabindex="-1" data-focus>${esc(d.nombre)}</h2>
        </div>
        <div class="conf-badge${low ? ' is-low' : ''}" role="img" aria-label="Confianza ${pct(rec.confidence)}${low ? ', baja' : ''}">
          <div class="ring-wrap">${ring(rec.confidence, 58, 6)}<span class="pct">${pct(rec.confidence)}</span></div>
          <span class="lbl">${low ? 'Confianza baja' : 'Confianza'}</span>
        </div>
      </div>
      ${banners.join('')}
      <div class="chips">
        ${agentChip}
        <span class="chip">${icon('timer')} Inferencia: ${secs(rec.inferenceMs)}</span>
        ${fromHistory ? `<span class="chip">${icon('history')} ${esc(fmtDate(rec.createdAt))}</span>` : ''}
      </div>
      <div class="mini-grid">
        <div class="mini"><span>Síntoma principal</span><strong>${esc(d.sintomaPrincipal)}</strong></div>
        <div class="mini"><span>Agente causal</span><strong>${healthy ? esc(d.agente) : `<em>${esc(d.agente)}</em>`}</strong></div>
      </div>
      <p class="diag-desc">${esc(d.descripcion)}</p>
    </article>

    <section class="treatment area-treat" aria-labelledby="treat-title">
      <div class="treatment-head">
        <span class="circle">${icon(healthy ? 'eye' : 'doc')}</span>
        <h3 id="treat-title">${esc(d.seccion)}</h3>
      </div>
      <ol class="step-list">${steps}</ol>
    </section>

    <p class="disclaimer area-disc">Resultado orientativo generado por IA. Confírmalo con un técnico agrónomo antes de tomar decisiones de manejo.</p>
    <div class="stack area-actions">${actions}</div>
  `, { layout: fromHistory ? 'result has-back' : 'result' });
}

async function saveCurrent() {
  if (!state.current || state.savedId) return;
  try {
    const thumb = await makeThumbnail(state.photo);
    state.savedId = await addDiagnosis({ ...state.current, thumb });
    renderResult(state.current, { photoUrl: state.photoUrl });
    toast('Guardado en el historial');
  } catch (err) {
    console.error(err);
    toast('No se pudo guardar. Revisa el espacio disponible del teléfono.');
  }
}

// ------------------------------------------------------------------ pantalla: historial
async function renderHistory({ focus = true } = {}) {
  let items = [];
  try { items = await listDiagnoses(); } catch (err) { console.error(err); }

  if (!items.length) {
    render(`
      <h1 class="screen-title" tabindex="-1" data-focus>Historial</h1>
      <section class="card empty">
        <svg class="art" viewBox="0 0 140 120" aria-hidden="true">
          <rect x="18" y="22" width="104" height="84" rx="16" fill="#ECEBF6"/>
          <rect x="32" y="40" width="34" height="34" rx="10" fill="#fff"/>
          <rect x="74" y="44" width="34" height="8" rx="4" fill="#fff"/>
          <rect x="74" y="58" width="24" height="8" rx="4" fill="#fff"/>
          <path d="M49 44c5 0 8 6 8 13s-3 13-8 13-8-6-8-13 3-13 8-13z" fill="#6EF2B0" stroke="#0B6B45" stroke-width="2"/>
          <path d="M49 44v26" stroke="#0B6B45" stroke-width="2"/>
          <circle cx="112" cy="26" r="14" fill="#0B6B45"/>
          <path d="M112 19v7l4.5 3" stroke="#fff" stroke-width="2.4" stroke-linecap="round" fill="none"/>
        </svg>
        <h2>Aún no tienes diagnósticos guardados</h2>
        <p>Cuando guardes un resultado aparecerá aquí, incluso sin conexión.</p>
        <button class="btn btn-primary" type="button" data-action="go-diagnose">${icon('camera')} Hacer un diagnóstico</button>
      </section>
    `, { focus });
    return;
  }

  const rows = items.map((r) => {
    const d = diseases[r.label] || { nombre: r.label };
    const low = r.confidence < LOW_CONFIDENCE;
    const thumb = r.thumb ? `<img class="hist-thumb" src="${pageUrl(r.thumb)}" alt="">` : '<span class="hist-thumb"></span>';
    return `<li class="hist-item">
      <button class="hist-open" type="button" data-action="open" data-id="${r.id}">
        ${thumb}
        <span class="hist-info">
          <span class="hist-name">${esc(d.nombre)}</span>
          <span class="hist-meta"><span class="pill${low ? ' is-low' : ''}">${pct(r.confidence)}</span>${esc(fmtDate(r.createdAt))}</span>
        </span>
      </button>
      <button class="icon-btn hist-del" type="button" data-action="delete" data-id="${r.id}"
        aria-label="Eliminar diagnóstico de ${esc(d.nombre)} del ${esc(fmtDate(r.createdAt))}">${icon('trash')}</button>
    </li>`;
  }).join('');

  render(`
    <div>
      <h1 class="screen-title" tabindex="-1" data-focus>Historial</h1>
      <p class="screen-lead">${items.length} ${items.length === 1 ? 'diagnóstico guardado' : 'diagnósticos guardados'} en este dispositivo</p>
    </div>
    <ul class="hist-list">${rows}</ul>
  `, { focus, layout: 'history' });
}

async function openHistoryItem(id) {
  const rec = await getDiagnosis(id);
  if (!rec) { renderHistory(); return; }
  renderResult(rec, { photoUrl: rec.thumb ? pageUrl(rec.thumb) : null, fromHistory: true });
}

async function removeItem(id, { thenHistory = true } = {}) {
  const rec = await getDiagnosis(id);
  if (!rec) return;
  await deleteDiagnosis(id);
  if (thenHistory) await renderHistory({ focus: false });
  toast('Diagnóstico eliminado', {
    label: 'Deshacer',
    run: async () => { await restoreDiagnosis(rec); if (state.tab === 'historial') renderHistory({ focus: false }); },
  });
}

// ------------------------------------------------------------------ navegación
function setTab(tab, { focus = true } = {}) {
  state.tab = tab;
  stopCamera();
  if (state.vfMode === 'live') state.vfMode = state.photo ? 'photo' : 'idle';
  document.querySelectorAll('.tab').forEach((b) => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  $('#subtitle').textContent = tab === 'historial' ? 'Historial' : 'Diagnóstico';
  if (tab === 'historial') renderHistory({ focus });
  else if (state.current) renderResult(state.current, { photoUrl: state.photoUrl });
  else renderCapture({ focus });
}

function takePhoto() {
  if (cameraSupported()) {
    state.vfMode = 'live';
    renderCapture();
  } else {
    fileCamera.click();
  }
}

function resetToCapture() {
  setPhoto(null);
  setTab('diagnostico');
}

// ------------------------------------------------------------------ eventos
screenEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id ? Number(btn.dataset.id) : null;
  switch (btn.dataset.action) {
    case 'take-photo': takePhoto(); break;
    case 'gallery': stopCamera(); fileGallery.click(); break;
    case 'cancel-camera':
      stopCamera();
      state.vfMode = state.photo ? 'photo' : 'idle';
      renderCapture();
      break;
    case 'capture': {
      try {
        const blob = await captureFrame($('#video'));
        stopCamera();
        setPhoto(blob);
        renderCapture();
      } catch (err) { toast(err.message); }
      break;
    }
    case 'analyze': analyze(); break;
    case 'retake': setPhoto(null); takePhoto(); break;
    case 'new': resetToCapture(); break;
    case 'save': saveCurrent(); break;
    case 'retry-models': bootModels(); break;
    case 'go-diagnose': resetToCapture(); break;
    case 'open': openHistoryItem(id); break;
    case 'delete': removeItem(id); break;
    case 'delete-current': removeItem(id); break;
    case 'back-history': renderHistory(); break;
    default: break;
  }
});

function onFile(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Ese archivo no es una imagen.'); return; }
  stopCamera();
  setPhoto(file);
  if (state.tab !== 'diagnostico') setTab('diagnostico');
  else renderCapture();
}
fileCamera.addEventListener('change', onFile);
fileGallery.addEventListener('change', onFile);

document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.tab === 'diagnostico' && state.tab === 'diagnostico' && state.current) {
    resetToCapture(); // tocar "Diagnóstico" en un resultado empieza uno nuevo
  } else {
    setTab(b.dataset.tab);
  }
}));

// Apaga la cámara si la app pasa a segundo plano.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && cameraActive()) {
    stopCamera();
    state.vfMode = state.photo ? 'photo' : 'idle';
    if (state.tab === 'diagnostico' && !state.current) renderCapture({ focus: false });
  }
});

// Ayuda
const help = $('#help');
$('#help-btn').innerHTML = icon('help');
help.querySelector('[data-close]').innerHTML = icon('close');
$('#help-btn').addEventListener('click', () => help.showModal());
help.querySelector('[data-close]').addEventListener('click', () => help.close());
help.addEventListener('click', (e) => { if (e.target === help) help.close(); });

// Iconos de la barra inferior
document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });

// Chip discreto de modo sin conexión (la app no muestra errores por falta de red).
function updateOnline() {
  const chip = $('#offline-chip');
  chip.innerHTML = `${icon('offline')} Sin conexión`;
  chip.hidden = navigator.onLine;
}
window.addEventListener('online', updateOnline);
window.addEventListener('offline', updateOnline);

// ------------------------------------------------------------------ arranque
async function init() {
  updateOnline();
  try {
    diseases = await fetch('./data/diseases.json').then((r) => r.json());
  } catch (err) {
    console.error('No se pudo leer diseases.json', err);
  }
  renderCapture({ focus: false });
  bootModels();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW no registrado', err));
  }
}

init();
