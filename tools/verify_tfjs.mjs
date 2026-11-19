// Comprueba que un modelo convertido carga en TensorFlow.js y produce las
// mismas salidas que Keras (guardadas por convert_keras_to_tfjs.py en metadata.json).
//
// Uso (desde la carpeta tools/):
//   npm install
//   node verify_tfjs.mjs ../app/models/filtro-cacao ../app/models/estado-cacao
import * as tf from '@tensorflow/tfjs';
import fs from 'node:fs';
import path from 'node:path';

function testImages(h, w) {
  // Mismas imágenes que test_images() en convert_keras_to_tfjs.py
  const data = new Float32Array(2 * h * w * 3);
  let k = 0;
  for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) for (let c = 0; c < 3; c++)
    data[k++] = (i * 7 + j * 13 + c * 50) % 256;
  for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) for (let c = 0; c < 3; c++)
    data[k++] = (Math.abs(i - h / 2) + Math.abs(j - w / 2) * 2 + c * 80) % 256;
  return tf.tensor4d(data, [2, h, w, 3]);
}

async function verify(dir) {
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'model.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8'));
  const paths = json.weightsManifest.flatMap((g) => g.paths);
  const buf = Buffer.concat(paths.map((p) => fs.readFileSync(path.join(dir, p))));
  const model = await tf.loadLayersModel(tf.io.fromMemory({
    modelTopology: json.modelTopology,
    weightSpecs: json.weightsManifest.flatMap((g) => g.weights),
    weightData: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  }));
  const [h, w] = meta.image_size;
  const got = await model.predict(testImages(h, w)).array();
  const expected = meta.verificacion.salida_esperada;
  let maxDiff = 0;
  got.forEach((row, r) => row.forEach((v, c) => { maxDiff = Math.max(maxDiff, Math.abs(v - expected[r][c])); }));
  const ok = maxDiff < 1e-3;
  console.log(`${ok ? 'OK  ' : 'FALLA'} ${dir}  clases=${meta.clases.join(',')}  dif. máx. vs Keras=${maxDiff.toExponential(2)}`);
  return ok;
}

const dirs = process.argv.slice(2);
if (!dirs.length) { console.error('Indica una o más carpetas con model.json'); process.exit(2); }
let allOk = true;
for (const d of dirs) allOk = (await verify(d)) && allOk;
process.exit(allOk ? 0 : 1);
