# BioPlant AI · Diagnóstico de cacao

Aplicación web progresiva (PWA) que identifica, a partir de una foto de una mazorca de cacao, si está **sana** o tiene **Moniliasis**, **Fitoftora (mazorca negra)** o **Escoba de bruja**.

- **Funciona sin internet.** Tras la primera visita, la app y los modelos quedan guardados en el teléfono.
- **Privada.** Las fotos se analizan en el propio dispositivo con TensorFlow.js. No se envía nada a ningún servidor.
- **Instalable.** Se puede añadir a la pantalla de inicio como si fuera una app nativa.

> ⚠️ Es una herramienta de apoyo. Los resultados son orientativos y deben confirmarse con un técnico agrónomo. Las recomendaciones son de manejo cultural; la app no indica productos químicos ni dosis.

---

## Cómo funciona

```
 Foto (cámara o galería)
        │
        ▼
 ┌─────────────────────────┐   no es cacao   ┌──────────────────────────────┐
 │ 1. Filtro               │ ──────────────▶ │ "No se puede analizar esta   │
 │    models/filtro-cacao  │                 │  imagen: no es un cacao"     │
 │    (desde modelo3/)     │                 └──────────────────────────────┘
 └───────────┬─────────────┘
             │ es cacao
             ▼
 ┌─────────────────────────┐
 │ 2. Estado de la mazorca │  → sano · moniliasis · fitoftora · escoba_de_bruja
 │    models/estado-cacao  │
 │    (modelo_cacao_estado)│
 └───────────┬─────────────┘
             ▼
  Resultado + recomendaciones  →  Guardar en Historial (IndexedDB, solo local)
```

- Si la confianza del diagnóstico es **menor al 60 %**, el resultado se marca como *no concluyente* (insignia ámbar) y la app pide repetir la foto.
- Si el filtro decide que la foto no es de cacao, la app muestra **"No se puede analizar esta imagen. No es un cacao."** y no hace el diagnóstico. Solo ofrece tomar otra foto o elegir otra de la galería.

## Estructura del repositorio

```
app/                         ← la PWA (esto es lo que se publica)
  index.html
  manifest.webmanifest
  sw.js                      ← service worker (caché sin conexión)
  css/styles.css
  js/
    app.js                   ← pantallas y navegación
    model-adapter.js         ← ÚNICO módulo que conoce los modelos
    camera.js                ← cámara en vivo + miniaturas
    history-db.js            ← historial en IndexedDB
    icons.js                 ← iconos SVG locales
  data/diseases.json         ← textos por enfermedad (editar aquí, no en el código)
  models/
    filtro-cacao/            ← modelo 1: ¿es cacao? (convertido desde modelo3/)
    estado-cacao/            ← modelo 2: enfermedad (convertido desde modelo_cacao_estado/)
  vendor/tf.min.js           ← TensorFlow.js 4.22.0 (local, sin CDN)
  fonts/                     ← Outfit (local, licencia OFL)
  icons/                     ← logo e iconos de la PWA

modelo3/                     ← filtro ¿es cacao? reentrenado (.keras) — el que usa la app
modelo1/                     ← filtro anterior en .bin (sin tocar; ver "modelo1 vs modelo2")
modelo2/                     ← filtro anterior en .keras (no filtra; ver advertencia)
modelo_cacao_estado/         ← original del modelo de enfermedades en .keras

entrenamiento_filtro_cacao/
  entrenar.py                ← entrena el filtro con dataset/ y guarda modelo3/
  evaluar.py                 ← evalúa un filtro con cualquier carpeta cacao/ + otros/
  resultados/                ← métricas, curvas, errores y división train/val/test
dataset/                     ← imágenes de entrenamiento (no se versiona: .gitignore)

tools/
  convert_keras_to_tfjs.py   ← convierte un .keras a formato TF.js y verifica
  verify_tfjs.mjs            ← comprueba que el modelo convertido da lo mismo en TF.js
  make_icons.py              ← regenera los iconos PNG
Cacao disease ui-v1/         ← skill de diseño de la interfaz
```

## Puesta en marcha

La app es HTML + CSS + JavaScript sin compilación. Solo hay que servir la carpeta `app/` con cualquier servidor estático:

```bash
python -m http.server 8080 -d app
# abre http://localhost:8080
```

**Cámara y modo sin conexión requieren HTTPS** (o `localhost`). Para probar en un teléfono, publica `app/` en un hosting con HTTPS, por ejemplo:

- **GitHub Pages:** en *Settings → Pages*, publica desde una rama con el contenido de `app/` (o usa una GitHub Action que suba `app/`).
- **Netlify / Vercel / Cloudflare Pages:** arrastra la carpeta `app/` o configura `app` como directorio de publicación, sin comando de build.

La primera carga descarga unos 21 MB (dos modelos de ~9.5 MB, más TensorFlow.js). Después todo queda en caché.

### Actualizar la app publicada

El service worker sirve primero lo que tiene en caché. Cada vez que cambies archivos de `app/` (código, textos o modelos), **sube la constante `VERSION` en `app/sw.js`** (por ejemplo `'v2'` → `'v3'`) para que los teléfonos descarguen la versión nueva.

## Los modelos

| Carpeta en `app/models/` | Origen | Clases | Entrada |
|---|---|---|---|
| `filtro-cacao/` | `modelo3/modelo_cacao.keras` | `cacao`, `otros` | RGB 224×224, píxeles 0..255 (normalización incluida) |
| `estado-cacao/` | `modelo_cacao_estado/modelo_cacao.keras` | `cacao_sano`, `escoba_de_bruja`, `fitoftora`, `monilia` | RGB 224×224, píxeles 0..255 (normalización incluida) |

Ambos son MobileNetV2 con una cabeza de clasificación. Pesan ~9.5 MB cada uno en float32 (sin cuantizar).

### Por qué hubo que convertirlos

El navegador no puede leer archivos `.keras`. El conversor oficial de TensorFlow.js tampoco entiende el formato de Keras 3, y el `model.json` de `modelo1/` está en formato Keras 3, por lo que **TF.js no lo puede cargar**:

```
An InputLayer should be passed either a `batchInputShape` or an `inputShape`.
```

`tools/convert_keras_to_tfjs.py` resuelve esto:

1. "Aplana" el modelo: integra el submodelo MobileNetV2 en un solo grafo.
2. Quita las capas que solo actúan al entrenar (aumentos aleatorios y Dropout).
3. Copia los pesos **tal cual** (float32, sin cuantizar).
4. Comprueba que el modelo aplanado da **exactamente** las mismas salidas que el original, y se detiene si no es así.

Verificación hecha sobre los modelos incluidos:

| Comprobación | Filtro | Estado |
|---|---|---|
| Keras original vs. modelo aplanado | diferencia 0.0 | diferencia 0.0 |
| Keras vs. TensorFlow.js (`verify_tfjs.mjs`) | 3.0e-7 | 8.8e-7 |
| App en Chrome vs. Keras+PIL, 20 fotos reales | — | clase igual 20/20 (dif. media de probabilidad 0.006) |

La app redimensiona las fotos con el mismo filtro *bilinear* de PIL que se usó al entrenar (implementado en `model-adapter.js`). Con el redimensionado por defecto del navegador, la probabilidad se desviaba en promedio 0.056 (hasta 0.22).

### modelo1 (.bin) vs. modelo2 (.keras)

Se compararon los pesos de ambos: **son idénticos bit a bit** (262 tensores, 2 260 546 valores, diferencia máxima = 0.0).

Por eso **no hay diferencia de precisión ni de *loss* entre el `.bin` y el `.keras`**. Un formato de archivo no cambia lo que el modelo aprendió: con los mismos pesos y la misma entrada, las predicciones son las mismas. Una diferencia solo aparecería si una conversión fuera defectuosa o con cuantización, o si se preprocesara la imagen de otra forma. En la práctica:

- `modelo1/` no carga en TF.js tal como está, así que no sirve como respaldo directo.
- Si en el futuro quieres usar otro modelo, conviértelo desde el `.keras` con `tools/convert_keras_to_tfjs.py`.

### ⚠️ Advertencia: el filtro anterior (modelo1/ y modelo2/) no filtra

Por eso se reentrenó el filtro en `modelo3/` (ver la sección siguiente). Con las pruebas, **el modelo de `modelo2/` responde "cacao" para cualquier imagen** con más de 99 % de probabilidad:

- 11 fotos que no son cacao (coches, un perro, bananos, mangos, papayas): P(cacao) ≥ 0.997.
- Imágenes sintéticas negras, blancas, grises, de ruido y azul puro: P(cacao) ≥ 0.998.
- Ocurre con cualquier escala de entrada (0..255, [-1, 1] y [0, 1]).

Es un problema del **entrenamiento**, no de la app ni de la conversión: el original en Keras da lo mismo, y `modelo1/` tiene los mismos pesos. Causas típicas:

- Muchas más imágenes de `cacao` que de `otros`.
- Etiquetas mal asignadas.
- Muy pocas épocas con la base congelada.

Además, el modelo **no incluye capa de normalización**, aunque `config_cacao.json` diga *"normalización incluida en el modelo"*. Al reentrenar, conviene añadir `Rescaling(1/127.5, offset=-1)` dentro del modelo, como en `modelo_cacao_estado`.

## Filtro reentrenado (modelo3/)

`entrenamiento_filtro_cacao/entrenar.py` entrena el filtro con las imágenes de `dataset/` y guarda el resultado en `modelo3/`:

```bash
python entrenamiento_filtro_cacao/entrenar.py      # ~10 min en CPU
```

Luego hay que convertirlo para la app, verificarlo y subir `VERSION` en `app/sw.js` (ver "Reemplazar un modelo").

### Datos

`dataset/cacao/` y `dataset/otros/` tienen 600 imágenes cada uno. Dentro de cada carpeta las imágenes pueden estar en subcarpetas.

- **cacao:** fotos de campo de mazorcas sanas, con moniliasis, con fitoftora y con escoba de bruja, más algunas del árbol.
- **otros:** 450 de frutas y plantas, 120 de vegetación, 15 de carros y 15 de lentes.

La división es 70 % entrenamiento, 15 % validación y 15 % prueba. Es **por sesión de fotos**: las ráfagas del mismo día (`IMG_20240928_…`) quedan todas en el mismo grupo, para que no haya fotos casi idénticas a ambos lados. La división exacta está en `resultados/division.json`.

### Modelo

- MobileNetV2 preentrenada en ImageNet → GlobalAveragePooling → Dropout(0.3) → Dense(2, softmax).
- La normalización (`Rescaling` a [-1, 1]) va **dentro** del modelo.
- Aumentos fuertes (solo al entrenar): volteo, rotación, acercamiento, desplazamiento, contraste, brillo, saturación, tono y desenfoque.
- Entrenamiento en dos fases: primero solo la cabeza, luego ajuste fino de las últimas 60 capas.
- *Label smoothing* 0.1.

### Resultados

| Conjunto | Imágenes | Exactitud | Cacao aceptado | Otros rechazado |
|---|---|---|---|---|
| Prueba (del dataset, no visto al entrenar) | 180 | 98.9 % | 90/90 | 88/90 |
| **Externas** (Wikimedia Commons, otras fuentes) | 82 | **87.8 %** | 12/17 | 60/65 |
| Imágenes sintéticas (negra, blanca, gris, ruido, azul) | 5 | — | — | 5/5 (P(cacao) ≤ 0.10) |

Las imágenes externas son las que mejor representan el uso real, porque vienen de cámaras y lugares distintos a los del dataset. Una primera versión con aumentos suaves llegaba al 100 % en la prueba del dataset, pero solo al 81.7 % con las externas (aceptaba 9/17 cacao). Por eso se usaron los aumentos fuertes.

Fallos que quedan con las imágenes externas:

- **Hojarasca de bosque → "cacao"** (3 fotos). El dataset tiene fotos de hojarasca y ramas del cacaotal etiquetadas como `cacao`, y el modelo aprende que "hojas secas en el suelo" es cacao.
- **Cafeto y jaca en el árbol → "cacao"** (2 fotos). Son frutos parecidos colgando del tronco o de ramas.
- **Cacao rechazado** (5 fotos): mazorcas abiertas, granos secos, un primer plano muy cercano y fotos de estilo muy distinto al del dataset.

### Cómo mejorarlo

1. **Quitar de `cacao` las fotos donde no se ve ninguna mazorca** (solo ramas u hojarasca), o pasarlas a `otros`. Es lo que más ayudaría contra el falso "cacao" en hojarasca.
2. **Añadir a `otros` negativos difíciles de campo:** hojarasca, troncos, cafeto, jaca, aguacate, papaya y mango en el árbol, manos, personas y herramientas.
3. **Añadir a `cacao` fotos de otros teléfonos y lugares:** mazorcas cortadas, primeros planos y distintas variedades y colores.
4. Volver a entrenar y medir siempre con fotos que no vengan de las mismas sesiones:

   ```bash
   python entrenamiento_filtro_cacao/evaluar.py modelo3/modelo_cacao.keras CARPETA_CON_cacao_Y_otros --detalle
   ```

## Reemplazar un modelo

1. Convierte el `.keras` (requiere Python con `keras` 3 y TensorFlow):

   ```bash
   python tools/convert_keras_to_tfjs.py RUTA/modelo.keras app/models/filtro-cacao --config RUTA/config.json
   ```

   El `config.json` debe tener `clases` e `image_size`, como los actuales.
   Usa `--add-rescaling` **solo** si el modelo no trae su normalización y se entrenó con `preprocess_input` de MobileNetV2.

2. Verifica en TensorFlow.js:

   ```bash
   cd tools && npm install && npm run verify
   ```

3. Si cambian los nombres de las clases, ajusta `CONFIG` en `app/js/model-adapter.js`:
   - `claseCacao` para el filtro;
   - `etiquetas` para el modelo de estado.

4. Sube `VERSION` en `app/sw.js`.

### Contrato con la interfaz

La interfaz no conoce TensorFlow.js. Solo llama a dos funciones de `app/js/model-adapter.js`:

```js
isCacao(imagen: Blob | ImageBitmap) -> Promise<{ isCacao: boolean, confidence: number, inferenceMs: number }>
predict(imagen: Blob | ImageBitmap) -> Promise<{
  label: "moniliasis" | "fitoftora" | "escoba_de_bruja" | "sano",
  confidence: number,   // 0 a 1
  inferenceMs: number
}>
```

### Ajustes

| Qué | Dónde | Valor actual |
|---|---|---|
| Probabilidad mínima para aceptar una foto como cacao | `CONFIG.filtro.umbral` en `app/js/model-adapter.js` | `0.5` |
| Confianza bajo la cual el resultado es "no concluyente" | `LOW_CONFIDENCE` en `app/js/app.js` | `0.6` |
| Textos, síntomas y recomendaciones | `app/data/diseases.json` | — |

## Diseño

La interfaz sigue la skill `Cacao disease ui-v1/skills/cacao-disease-ui/SKILL.md`:

- Mobile-first (máximo 430 px) y tipografía Outfit.
- Verde `#0B6B45` y menta `#6EF2B0`.
- Tarjeta de diagnóstico con anillo de confianza.
- Tres pasos de manejo cultural.
- Historial local.
- Estados de carga, de confianza baja, sin conexión y de error de cámara.
- Accesibilidad: contraste AA, áreas táctiles de 44 px y respeto de `prefers-reduced-motion`.

## Licencias

- Código del proyecto: GPL-3.0 (ver `LICENSE`).
- TensorFlow.js: Apache-2.0.
- Fuente Outfit: SIL Open Font License 1.1 (`app/fonts/OFL.txt`).
