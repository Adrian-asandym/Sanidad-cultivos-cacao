// model-adapter — ÚNICO módulo que conoce los modelos de IA.
//
// La interfaz solo usa:
//   isCacao(imagen)  -> Promise<{ isCacao, confidence, inferenceMs }>   (filtro, paso 1)
//   predict(imagen)  -> Promise<{ label, confidence, inferenceMs }>     (enfermedad, paso 2)
//     label: "moniliasis" | "fitoftora" | "escoba_de_bruja" | "sano"
//     confidence: 0..1
//
// Para cambiar un modelo: reemplaza los archivos de la carpeta en app/models/
// (generados con tools/convert_keras_to_tfjs.py) y, si cambian las clases,
// ajusta CONFIG aquí. Nada más de la interfaz tiene que cambiar.
/* global tf */

const CONFIG = {
  filtro: {
    dir: './models/filtro-cacao/',
    claseCacao: 'cacao',
    // P(cacao) mínima para dejar pasar la foto al diagnóstico.
    umbral: 0.5,
  },
  estado: {
    dir: './models/estado-cacao/',
    // clase del modelo -> etiqueta del contrato de la interfaz
    etiquetas: {
      cacao_sano: 'sano',
      escoba_de_bruja: 'escoba_de_bruja',
      fitoftora: 'fitoftora',
      monilia: 'moniliasis',
    },
  },
};

let loading = null;
const models = {};

async function loadOne(key) {
  const { dir } = CONFIG[key];
  const [model, meta] = await Promise.all([
    tf.loadLayersModel(dir + 'model.json'),
    fetch(dir + 'metadata.json').then((r) => {
      if (!r.ok) throw new Error(`No se encontró ${dir}metadata.json`);
      return r.json();
    }),
  ]);
  const [h, w] = meta.image_size || [224, 224];
  // Primera inferencia en vacío: compila los shaders de WebGL para que la
  // primera foto real no tarde varios segundos más.
  tf.tidy(() => model.predict(tf.zeros([1, h, w, 3])));
  models[key] = { model, classes: meta.clases, size: [h, w] };
}

/** Carga ambos modelos una sola vez. Se puede llamar muchas veces. */
export function loadModels() {
  if (!loading) {
    loading = (async () => {
      if (typeof tf === 'undefined') throw new Error('TensorFlow.js no está disponible.');
      await tf.ready();
      await Promise.all([loadOne('filtro'), loadOne('estado')]);
      return tf.getBackend();
    })().catch((err) => {
      loading = null; // permite reintentar
      throw err;
    });
  }
  return loading;
}

// Lado máximo con el que se lee la foto antes del redimensionado final
// (una foto de 12 MP ocuparía ~48 MB en memoria).
const MAX_SIDE = 2048;

/**
 * Prepara la imagen igual que en el entrenamiento: orientación EXIF aplicada,
 * fondo blanco para transparencias y redimensionado directo (sin recorte) con
 * el mismo filtro "bilinear" de PIL. Devuelve un tensor [1, h, w, 3] 0..255.
 */
async function toInput(imagen, [h, w]) {
  let source = imagen;
  if (imagen instanceof Blob) {
    source = await createImageBitmap(imagen, { imageOrientation: 'from-image' }).catch(
      () => blobToImage(imagen),
    );
  }
  const sw0 = source.naturalWidth || source.videoWidth || source.width;
  const sh0 = source.naturalHeight || source.videoHeight || source.height;
  const k = Math.min(1, MAX_SIDE / Math.max(sw0, sh0));
  const sw = Math.max(1, Math.round(sw0 * k));
  const sh = Math.max(1, Math.round(sh0 * k));

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, sw, sh);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, sw, sh);
  if (source !== imagen && typeof source.close === 'function') source.close();

  const rgba = ctx.getImageData(0, 0, sw, sh).data;
  const rgb = resizeBilinearPIL(rgba, sw, sh, w, h);
  return tf.tensor4d(rgb, [1, h, w, 3], 'float32');
}

/** Coeficientes del filtro triangular de PIL (Image.resize BILINEAR, con antialias). */
function pilCoeffs(inSize, outSize) {
  const scale = inSize / outSize;
  const fs = Math.max(scale, 1);
  const support = fs;
  const out = [];
  for (let i = 0; i < outSize; i++) {
    const center = (i + 0.5) * scale;
    const xmin = Math.max(Math.trunc(center - support + 0.5), 0);
    const xmax = Math.min(Math.trunc(center + support + 0.5), inSize);
    const ws = [];
    let sum = 0;
    for (let x = xmin; x < xmax; x++) {
      const t = Math.abs((x - center + 0.5) / fs);
      const v = t < 1 ? 1 - t : 0;
      ws.push(v);
      sum += v;
    }
    out.push({ start: xmin, ws: ws.map((v) => (sum ? v / sum : 0)) });
  }
  return out;
}

/** RGBA (sw×sh) -> RGB float32 (dw×dh): pasada horizontal y luego vertical, como PIL. */
function resizeBilinearPIL(rgba, sw, sh, dw, dh) {
  const cx = pilCoeffs(sw, dw);
  const cy = pilCoeffs(sh, dh);
  const tmp = new Uint8ClampedArray(sh * dw * 3); // PIL redondea a 8 bits entre pasadas
  for (let y = 0; y < sh; y++) {
    const row = y * sw * 4;
    for (let x = 0; x < dw; x++) {
      const { start, ws } = cx[x];
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < ws.length; k++) {
        const p = row + (start + k) * 4;
        r += rgba[p] * ws[k]; g += rgba[p + 1] * ws[k]; b += rgba[p + 2] * ws[k];
      }
      const o = (y * dw + x) * 3;
      tmp[o] = Math.round(r); tmp[o + 1] = Math.round(g); tmp[o + 2] = Math.round(b);
    }
  }
  const out = new Float32Array(dh * dw * 3);
  for (let y = 0; y < dh; y++) {
    const { start, ws } = cy[y];
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < ws.length; k++) {
        const p = ((start + k) * dw + x) * 3;
        r += tmp[p] * ws[k]; g += tmp[p + 1] * ws[k]; b += tmp[p + 2] * ws[k];
      }
      const o = (y * dw + x) * 3;
      out[o] = Math.min(255, Math.max(0, Math.round(r)));
      out[o + 1] = Math.min(255, Math.max(0, Math.round(g)));
      out[o + 2] = Math.min(255, Math.max(0, Math.round(b)));
    }
  }
  return out;
}

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen.')); };
    img.src = url;
  });
}

async function run(key, imagen) {
  await loadModels();
  const { model, classes, size } = models[key];
  // Píxeles RGB 0..255 en float32: la normalización va dentro del modelo.
  const x = await toInput(imagen, size);
  const t0 = performance.now();
  const output = model.predict(x);
  const probs = await output.data();
  x.dispose();
  output.dispose();
  const inferenceMs = performance.now() - t0;
  return { probs: Array.from(probs), classes, inferenceMs };
}

/** Paso 1: ¿la imagen es una mazorca de cacao? */
export async function isCacao(imagen) {
  const { probs, classes, inferenceMs } = await run('filtro', imagen);
  const i = classes.indexOf(CONFIG.filtro.claseCacao);
  const confidence = probs[i];
  return { isCacao: confidence >= CONFIG.filtro.umbral, confidence, inferenceMs };
}

/** Paso 2: estado de la mazorca (contrato de la interfaz). */
export async function predict(imagen) {
  const { probs, classes, inferenceMs } = await run('estado', imagen);
  let best = 0;
  for (let i = 1; i < probs.length; i++) if (probs[i] > probs[best]) best = i;
  const label = CONFIG.estado.etiquetas[classes[best]];
  if (!label) throw new Error(`Clase desconocida del modelo: ${classes[best]}`);
  return { label, confidence: probs[best], inferenceMs };
}
