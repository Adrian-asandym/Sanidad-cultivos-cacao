"""
Entrena el FILTRO de BioPlant AI: ¿la imagen es una mazorca/planta de cacao o no?

Entrada : dataset/cacao/**  y  dataset/otros/**   (jpg / jpeg / png / webp)
Salida  : modelo3/modelo_cacao.keras  +  modelo3/config_cacao.json
          entrenamiento_filtro_cacao/resultados/  (métricas, curvas, errores)

Modelo: MobileNetV2 (ImageNet) + GlobalAveragePooling + Dropout + Dense(2, softmax).
La normalización (Rescaling a [-1, 1]) y los aumentos van DENTRO del modelo, así
que recibe píxeles RGB 0..255 de 224x224, igual que el modelo de enfermedades.

Uso (desde la raíz del repositorio):
    python entrenamiento_filtro_cacao/entrenar.py
"""

import argparse
import json
import os
import random
import re
import time
from collections import Counter, defaultdict
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

import numpy as np  # noqa: E402
from PIL import Image, ImageOps  # noqa: E402

import keras  # noqa: E402
from keras import layers  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
HERE = Path(__file__).resolve().parent
CLASES = ["cacao", "otros"]
NOMBRES = ["cacao", "otros"]
SIZE = 224
EXTS = {".jpg", ".jpeg", ".png", ".webp"}


# --------------------------------------------------------------------------- #
# Datos
# --------------------------------------------------------------------------- #
def cargar_imagen(path):
    """Mismo preprocesado que la app: EXIF, fondo blanco, resize bilinear PIL."""
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("RGBA")
        fondo = Image.new("RGBA", im.size, (255, 255, 255, 255))
        fondo.alpha_composite(im)
        return np.asarray(fondo.convert("RGB").resize((SIZE, SIZE), Image.BILINEAR), dtype=np.uint8)


def grupo(path):
    """
    Clave de agrupación para que fotos casi idénticas (ráfagas de la misma
    sesión de campo) no queden repartidas entre entrenamiento y prueba.
    'sano_IMG_20240928_101120590_HDR.jpg' -> 'sano_IMG_20240928'
    """
    stem = path.stem
    m = re.match(r"(.*?IMG_\d{8})", stem)
    if m:
        return m.group(1)
    return stem.replace(" - copia", "")


def subcategoria(path):
    stem = path.stem
    m = re.match(r"(.*?)(?:_IMG|_\d)", stem)
    return m.group(1) if m else stem


def listar(dataset):
    items = []
    for idx, clase in enumerate(CLASES):
        for p in sorted((dataset / clase).rglob("*")):
            if p.suffix.lower() in EXTS:
                items.append((p, idx))
    return items


def dividir(items, seed, val=0.15, test=0.15):
    """División estratificada por clase y agrupada por sesión."""
    rng = random.Random(seed)
    split = {}
    for idx in range(len(CLASES)):
        grupos = defaultdict(list)
        for p, y in items:
            if y == idx:
                grupos[grupo(p)].append(p)
        claves = sorted(grupos)
        rng.shuffle(claves)
        total = sum(len(v) for v in grupos.values())
        acum, destino = 0, {}
        for k in claves:
            frac = acum / total
            destino[k] = "test" if frac < test else ("val" if frac < test + val else "train")
            acum += len(grupos[k])
        for k, ps in grupos.items():
            for p in ps:
                split[p] = destino[k]
    return split


def cargar_arrays(items, cache):
    if cache.exists():
        z = np.load(cache, allow_pickle=False)
        if list(z["paths"]) == [str(p) for p, _ in items]:
            print(f"Usando caché {cache.name}")
            return z["X"], z["y"]
    print(f"Leyendo {len(items)} imágenes…")
    X = np.zeros((len(items), SIZE, SIZE, 3), np.uint8)
    for i, (p, _) in enumerate(items):
        X[i] = cargar_imagen(p)
        if (i + 1) % 200 == 0:
            print(f"  {i + 1}/{len(items)}")
    y = np.array([lab for _, lab in items], np.int64)
    cache.parent.mkdir(parents=True, exist_ok=True)
    np.savez(cache, X=X, y=y, paths=np.array([str(p) for p, _ in items]))
    return X, y


# --------------------------------------------------------------------------- #
# Modelo
# --------------------------------------------------------------------------- #
def construir(seed):
    keras.utils.set_random_seed(seed)
    # Aumentos fuertes: las fotos del dataset vienen de pocas fuentes, así que se
    # simulan otros encuadres (acercamientos), cámaras (color, nitidez) y luz.
    # Solo actúan al entrenar; en inferencia son la identidad.
    rango = (0, 255)
    aumentos = keras.Sequential(
        [
            layers.RandomFlip("horizontal"),
            layers.RandomRotation(0.1),
            layers.RandomZoom((-0.4, 0.1)),  # negativo = acercar
            layers.RandomTranslation(0.1, 0.1),
            layers.RandomContrast(0.3),
            layers.RandomBrightness(0.2, value_range=rango),
            layers.RandomSaturation(0.3, value_range=rango),
            layers.RandomHue(0.04, value_range=rango),
            layers.RandomGaussianBlur(0.3, kernel_size=5, sigma=1.0, value_range=rango),
        ],
        name="aumentos",
    )
    base = keras.applications.MobileNetV2(input_shape=(SIZE, SIZE, 3), include_top=False, weights="imagenet")
    base.trainable = False

    entrada = keras.Input((SIZE, SIZE, 3), name="imagen_rgb")
    x = aumentos(entrada)
    x = layers.Rescaling(1 / 127.5, offset=-1.0, name="rescaling")(x)
    x = base(x, training=False)  # BatchNorm siempre en modo inferencia
    x = layers.GlobalAveragePooling2D(name="global_average_pooling2d")(x)
    x = layers.Dropout(0.3, name="dropout")(x)
    salida = layers.Dense(len(CLASES), activation="softmax", name="clases")(x)
    return keras.Model(entrada, salida, name="filtro_cacao"), base


def compilar(model, lr):
    # label_smoothing evita que el modelo se vuelva sobreconfiado con un dataset pequeño.
    model.compile(
        optimizer=keras.optimizers.Adam(lr),
        loss=keras.losses.CategoricalCrossentropy(label_smoothing=0.1),
        metrics=["accuracy"],
    )


# --------------------------------------------------------------------------- #
# Evaluación
# --------------------------------------------------------------------------- #
def metricas(y, prob):
    pred = prob.argmax(1)
    cm = np.zeros((2, 2), int)
    for t, p in zip(y, pred):
        cm[t, p] += 1
    eps = 1e-12
    loss = float(-np.mean(np.log(prob[np.arange(len(y)), y] + eps)))
    out = {"n": int(len(y)), "accuracy": float((pred == y).mean()), "loss": loss, "matriz_confusion": cm.tolist()}
    for i, c in enumerate(CLASES):
        tp = cm[i, i]
        out[f"precision_{c}"] = float(tp / max(cm[:, i].sum(), 1))
        out[f"recall_{c}"] = float(tp / max(cm[i, :].sum(), 1))
    return out


def graficar(hist, destino):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return
    fig, ax = plt.subplots(1, 2, figsize=(10, 3.8))
    for k, a, t in (("loss", ax[0], "Pérdida (loss)"), ("accuracy", ax[1], "Exactitud")):
        a.plot(hist[k], label="entrenamiento")
        a.plot(hist["val_" + k], label="validación")
        a.axvline(hist["fin_fase1"] - 0.5, color="gray", ls="--", lw=1)
        a.set_title(t)
        a.set_xlabel("época")
        a.legend()
        a.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(destino, dpi=120)


# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default=str(ROOT / "dataset"))
    ap.add_argument("--salida", default=str(ROOT / "modelo3"))
    ap.add_argument("--epocas-cabeza", type=int, default=15)
    ap.add_argument("--epocas-ajuste", type=int, default=20)
    ap.add_argument("--capas-ajuste", type=int, default=60, help="capas finales de MobileNetV2 que se reentrenan")
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    dataset, salida = Path(args.dataset), Path(args.salida)
    resultados = HERE / "resultados"
    resultados.mkdir(exist_ok=True)

    items = listar(dataset)
    if not items:
        raise SystemExit(f"No hay imágenes en {dataset}/cacao ni {dataset}/otros")
    split = dividir(items, args.seed)
    X, y = cargar_arrays(items, HERE / "cache" / f"imagenes_{SIZE}.npz")
    paths = [p for p, _ in items]
    idx = {s: np.array([i for i, p in enumerate(paths) if split[p] == s]) for s in ("train", "val", "test")}
    for s, ii in idx.items():
        print(f"{s:5s}: {len(ii):4d} imágenes  {dict(Counter(CLASES[k] for k in y[ii]))}")

    Xtr, ytr = X[idx["train"]].astype("float32"), y[idx["train"]]
    Xva, yva = X[idx["val"]].astype("float32"), y[idx["val"]]
    Xte, yte = X[idx["test"]].astype("float32"), y[idx["test"]]

    Ytr = keras.utils.to_categorical(ytr, len(CLASES))
    Yva = keras.utils.to_categorical(yva, len(CLASES))

    model, base = construir(args.seed)
    cb = lambda: [keras.callbacks.EarlyStopping(monitor="val_loss", patience=5, restore_best_weights=True)]  # noqa: E731

    t0 = time.time()
    print("\nFase 1: solo la cabeza (MobileNetV2 congelada)")
    compilar(model, 1e-3)
    h1 = model.fit(Xtr, Ytr, validation_data=(Xva, Yva), epochs=args.epocas_cabeza,
                   batch_size=args.batch, callbacks=cb(), verbose=2)

    print(f"\nFase 2: ajuste fino de las últimas {args.capas_ajuste} capas")
    base.trainable = True
    for layer in base.layers[:-args.capas_ajuste]:
        layer.trainable = False
    for layer in base.layers:
        if isinstance(layer, layers.BatchNormalization):
            layer.trainable = False
    compilar(model, 2e-5)
    h2 = model.fit(Xtr, Ytr, validation_data=(Xva, Yva), epochs=args.epocas_ajuste,
                   batch_size=args.batch, callbacks=cb(), verbose=2)
    minutos = (time.time() - t0) / 60

    hist = {k: h1.history[k] + h2.history[k] for k in h1.history}
    hist["fin_fase1"] = len(h1.history["loss"])
    graficar(hist, resultados / "curvas.png")

    # Evaluación final en el conjunto de prueba (no visto durante el entrenamiento)
    res = {}
    errores = []
    for s, Xs, ys in (("train", Xtr, ytr), ("val", Xva, yva), ("test", Xte, yte)):
        prob = model.predict(Xs, batch_size=64, verbose=0)
        res[s] = metricas(ys, prob)
        if s == "test":
            for i, (t, p) in enumerate(zip(ys, prob)):
                if p.argmax() != t:
                    errores.append(f"{paths[idx['test'][i]].name}\treal={CLASES[t]}\tP(cacao)={p[0]:.3f}")
            por_sub = defaultdict(lambda: [0, 0])
            for i, (t, p) in enumerate(zip(ys, prob)):
                sub = subcategoria(paths[idx["test"][i]])
                por_sub[sub][0] += int(p.argmax() == t)
                por_sub[sub][1] += 1
            res["test_por_subcategoria"] = {k: f"{a}/{n}" for k, (a, n) in sorted(por_sub.items())}

    salida.mkdir(parents=True, exist_ok=True)
    model.save(salida / "modelo_cacao.keras")
    config = {
        "clases": CLASES,
        "nombres": NOMBRES,
        "image_size": [SIZE, SIZE],
        "entrada": "RGB float32, 0..255; normalización incluida en el modelo (Rescaling a [-1, 1])",
        "resize": "PIL bilinear, con orientación EXIF y fondo blanco para transparencias",
        "arquitectura": "MobileNetV2 (ImageNet) + GlobalAveragePooling2D + Dropout(0.3) + Dense(2, softmax)",
        "keras_version": keras.__version__,
        "tensorflow_version": __import__("tensorflow").__version__,
        "metricas_test": {k: res["test"][k] for k in ("accuracy", "loss", "recall_cacao", "recall_otros")},
    }
    (salida / "config_cacao.json").write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")

    reporte = {
        "semilla": args.seed,
        "minutos_entrenamiento": round(minutos, 1),
        "epocas": {"fase1": hist["fin_fase1"], "fase2": len(h2.history["loss"])},
        "division": {s: int(len(ii)) for s, ii in idx.items()},
        "resultados": res,
    }
    (resultados / "metricas.json").write_text(json.dumps(reporte, ensure_ascii=False, indent=2), encoding="utf-8")
    (resultados / "errores_test.txt").write_text("\n".join(errores) + "\n", encoding="utf-8")
    (resultados / "division.json").write_text(
        json.dumps({str(p.relative_to(dataset)): split[p] for p in paths}, ensure_ascii=False, indent=0),
        encoding="utf-8",
    )

    print(f"\nEntrenamiento: {minutos:.1f} min")
    for s in ("train", "val", "test"):
        r = res[s]
        print(f"{s:5s}  exactitud {r['accuracy']:.3f}  loss {r['loss']:.3f}  "
              f"recall cacao {r['recall_cacao']:.3f}  recall otros {r['recall_otros']:.3f}  cm {r['matriz_confusion']}")
    print("Test por subcategoría:", res["test_por_subcategoria"])
    print(f"\nModelo guardado en {salida / 'modelo_cacao.keras'}")


if __name__ == "__main__":
    main()
