"""
Convierte un modelo Keras 3 (.keras) a un "layers-model" de TensorFlow.js
que el navegador puede cargar con tf.loadLayersModel().

Por qué existe este script:
  - El conversor oficial (tensorflowjs_converter) no entiende el formato de
    configuración de Keras 3, y un model.json con formato Keras 3 falla en
    TF.js con "An InputLayer should be passed either a batchInputShape or an
    inputShape" (le pasaba al filtro anterior, ya eliminado).
  - Aquí se "aplana" el modelo (los submodelos anidados como MobileNetV2 se
    integran en un solo grafo), se eliminan las capas que solo actúan durante
    el entrenamiento (aumentos aleatorios y Dropout) y se escribe la topología
    en el formato que TF.js sí entiende.

La conversión NO cambia los pesos: se copian tal cual (float32, sin cuantizar).
Al final se comparan las salidas del modelo original y del aplanado; si
difieren más de 1e-4 el script se detiene.

Uso:
  python tools/convert_keras_to_tfjs.py MODELO.keras CARPETA_SALIDA \
      [--config config.json] [--add-rescaling]

  --config         JSON con "clases"/"nombres"/"image_size" (se copia como metadata.json)
  --add-rescaling  Antepone Rescaling(1/127.5, -1) para que el modelo reciba
                   píxeles 0..255. Úsalo solo si el modelo NO trae su propia
                   normalización y fue entrenado con preprocess_input de MobileNetV2.
"""

import argparse
import json
import os
import sys

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

import numpy as np  # noqa: E402
import keras  # noqa: E402

SHARD_BYTES = 4 * 1024 * 1024
TRAINING_ONLY_PREFIXES = ("Random",)  # RandomFlip, RandomRotation, RandomZoom...


# --------------------------------------------------------------------------- #
# 1. Aplanar el modelo
# --------------------------------------------------------------------------- #
def is_training_only(layer):
    if isinstance(layer, keras.layers.Dropout):
        return True
    if layer.__class__.__name__.startswith(TRAINING_ONLY_PREFIXES):
        return True
    if isinstance(layer, keras.Model):
        return all(is_training_only(l) for l in layer.layers if not isinstance(l, keras.layers.InputLayer))
    return False


def clone_and_call(layer, args, kwargs):
    new = layer.__class__.from_config(layer.get_config())
    out = new(*args, **kwargs)
    new.set_weights(layer.get_weights())
    return out


def flatten_call(model, x):
    """Aplica `model` a x reconstruyendo cada capa como capa de primer nivel."""
    if isinstance(model, keras.Sequential):
        for layer in model.layers:
            if isinstance(layer, keras.layers.InputLayer):
                continue
            x = call_layer(layer, x)
        return x
    # Functional: recorremos su grafo sustituyendo cada operación.
    def operation_fn(op):
        def fn(*args, **kwargs):
            if isinstance(op, keras.Model):
                return flatten_call(op, args[0])
            if is_training_only(op):
                return args[0]
            return clone_and_call(op, args, kwargs)
        return fn
    return model._run_through_graph(x, operation_fn=operation_fn)


def call_layer(layer, x):
    if is_training_only(layer):
        return x
    if isinstance(layer, keras.Model):
        return flatten_call(layer, x)
    return clone_and_call(layer, (x,), {})


def build_flat_model(model, add_rescaling):
    shape = model.inputs[0].shape[1:]
    inp = keras.Input(shape=shape, name="imagen_rgb")
    x = inp
    if add_rescaling:
        x = keras.layers.Rescaling(1 / 127.5, offset=-1.0, name="rescaling_0_255")(x)
    out = flatten_call(model, x)
    return keras.Model(inp, out, name="modelo_tfjs")


# --------------------------------------------------------------------------- #
# 2. Convertir la configuración Keras 3 -> formato que lee TF.js (Keras 2)
# --------------------------------------------------------------------------- #
def k2(value):
    if isinstance(value, dict):
        if "class_name" in value and "module" in value:
            if value["class_name"] == "DTypePolicy":
                return value["config"]["name"]
            return {"class_name": value["class_name"], "config": k2(value.get("config", {}))}
        return {k: k2(v) for k, v in value.items() if k not in ("module", "registered_name")}
    if isinstance(value, (list, tuple)):
        return [k2(v) for v in value]
    return value


def layer_json(layer):
    cfg = k2(layer.get_config())
    cfg["dtype"] = "float32"
    if isinstance(layer, keras.layers.InputLayer):
        cfg = {
            "batch_input_shape": list(cfg.get("batch_shape")),
            "dtype": "float32",
            "sparse": False,
            "name": layer.name,
        }
    inbound = []
    for node in layer._inbound_nodes:
        if not node.input_tensors:
            continue
        refs = []
        for t in node.input_tensors:
            op, node_index, tensor_index = t._keras_history
            refs.append([op.name, node_index, tensor_index, {}])
        inbound.append(refs)
    return {"class_name": layer.__class__.__name__, "name": layer.name, "config": cfg, "inbound_nodes": inbound}


def history_ref(t):
    op, node_index, tensor_index = t._keras_history
    return [op.name, node_index, tensor_index]


def weight_name(layer, w):
    short = w.name.split("/")[-1].split(":")[0]
    if isinstance(layer, keras.layers.DepthwiseConv2D) and short == "kernel":
        short = "depthwise_kernel"
    return f"{layer.name}/{short}"


# --------------------------------------------------------------------------- #
# 3. Escribir model.json + shards
# --------------------------------------------------------------------------- #
def write_tfjs(flat, out_dir, metadata):
    os.makedirs(out_dir, exist_ok=True)
    names = [l.name for l in flat.layers]
    if len(names) != len(set(names)):
        sys.exit("ERROR: hay capas con nombres repetidos tras aplanar el modelo.")

    specs, blobs = [], []
    for layer in flat.layers:
        for w in layer.weights:
            arr = np.asarray(w.numpy(), dtype=np.float32)
            specs.append({"name": weight_name(layer, w), "shape": list(arr.shape), "dtype": "float32"})
            blobs.append(arr.tobytes(order="C"))
    data = b"".join(blobs)

    for f in os.listdir(out_dir):
        if f.startswith("group1-shard") and f.endswith(".bin"):
            os.remove(os.path.join(out_dir, f))
    n_shards = max(1, -(-len(data) // SHARD_BYTES))
    paths = []
    for i in range(n_shards):
        p = f"group1-shard{i + 1}of{n_shards}.bin"
        with open(os.path.join(out_dir, p), "wb") as fh:
            fh.write(data[i * SHARD_BYTES:(i + 1) * SHARD_BYTES])
        paths.append(p)

    topology = {
        "class_name": "Model",
        "config": {
            "name": flat.name,
            "layers": [layer_json(l) for l in flat.layers],
            "input_layers": [history_ref(t) for t in flat.inputs],
            "output_layers": [history_ref(t) for t in flat.outputs],
        },
        "keras_version": "2.15.0",
        "backend": "tensorflow",
    }
    model_json = {
        "format": "layers-model",
        "generatedBy": f"keras {keras.__version__}",
        "convertedBy": "tools/convert_keras_to_tfjs.py",
        "modelTopology": topology,
        "weightsManifest": [{"paths": paths, "weights": specs}],
    }
    with open(os.path.join(out_dir, "model.json"), "w", encoding="utf-8") as fh:
        json.dump(model_json, fh, separators=(",", ":"))
    with open(os.path.join(out_dir, "metadata.json"), "w", encoding="utf-8") as fh:
        json.dump(metadata, fh, ensure_ascii=False, indent=2)
    return len(data), paths


# --------------------------------------------------------------------------- #
# 4. Verificación
# --------------------------------------------------------------------------- #
def test_images(size):
    """Imágenes deterministas (0..255) que tools/verify_tfjs.mjs recrea igual."""
    h, w = size
    i = np.arange(h).reshape(h, 1, 1)
    j = np.arange(w).reshape(1, w, 1)
    c = np.arange(3).reshape(1, 1, 3)
    a = (i * 7 + j * 13 + c * 50) % 256
    b = (np.abs(i - h / 2) + np.abs(j - w / 2) * 2 + c * 80) % 256
    return np.stack([a, b]).astype(np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("keras_path")
    ap.add_argument("out_dir")
    ap.add_argument("--config")
    ap.add_argument("--add-rescaling", action="store_true")
    args = ap.parse_args()

    original = keras.saving.load_model(args.keras_path, compile=False)
    flat = build_flat_model(original, args.add_rescaling)

    imgs = test_images(tuple(original.inputs[0].shape[1:3]))
    ref_in = imgs / 127.5 - 1.0 if args.add_rescaling else imgs
    y_orig = original.predict(ref_in, verbose=0)
    y_flat = flat.predict(imgs, verbose=0)
    diff = float(np.abs(y_orig - y_flat).max())
    print(f"Capas tras aplanar: {len(flat.layers)} | diferencia máx. original vs aplanado: {diff:.2e}")
    if diff > 1e-4:
        sys.exit("ERROR: el modelo aplanado no reproduce al original.")

    metadata = {}
    if args.config:
        with open(args.config, encoding="utf-8") as fh:
            metadata = json.load(fh)
    metadata["entrada_tfjs"] = "RGB float32 0..255, 224x224 (la normalización va dentro del modelo)"
    metadata["origen"] = os.path.basename(args.keras_path)
    metadata["rescaling_agregado_en_conversion"] = bool(args.add_rescaling)
    metadata["verificacion"] = {"imagenes": "tools/convert_keras_to_tfjs.py:test_images", "salida_esperada": y_flat.tolist()}

    n_bytes, paths = write_tfjs(flat, args.out_dir, metadata)
    print(f"Escrito {args.out_dir}/model.json + {len(paths)} shard(s), {n_bytes / 1e6:.1f} MB de pesos float32.")


if __name__ == "__main__":
    main()
