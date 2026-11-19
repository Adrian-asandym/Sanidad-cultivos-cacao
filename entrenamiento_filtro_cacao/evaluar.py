"""
Evalúa un modelo filtro (.keras) con una carpeta de imágenes etiquetadas:

    CARPETA/cacao/...   imágenes que SÍ son cacao
    CARPETA/otros/...   imágenes que NO son cacao

Uso:
    python entrenamiento_filtro_cacao/evaluar.py modelo3/modelo_cacao.keras CARPETA [--umbral 0.5] [--detalle]

Aplica el mismo preprocesado que la app y que el entrenamiento.
"""

import argparse
import os
import sys
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402
import keras  # noqa: E402

from entrenar import CLASES, EXTS, cargar_imagen  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("modelo")
    ap.add_argument("carpeta")
    ap.add_argument("--umbral", type=float, default=0.5, help="P(cacao) mínima para aceptar la imagen")
    ap.add_argument("--detalle", action="store_true", help="muestra la probabilidad de cada imagen")
    args = ap.parse_args()

    model = keras.saving.load_model(args.modelo, compile=False)
    carpeta = Path(args.carpeta)
    filas = []
    for y, clase in enumerate(CLASES):
        for p in sorted((carpeta / clase).rglob("*")):
            if p.suffix.lower() in EXTS:
                filas.append((p, y))
    if not filas:
        raise SystemExit(f"No hay imágenes en {carpeta}/cacao ni {carpeta}/otros")

    X = np.stack([cargar_imagen(p) for p, _ in filas]).astype("float32")
    p_cacao = model.predict(X, batch_size=32, verbose=0)[:, CLASES.index("cacao")]
    y = np.array([t for _, t in filas])
    es_cacao = p_cacao >= args.umbral
    real_cacao = y == CLASES.index("cacao")

    if args.detalle:
        for (p, t), pc, ok in zip(filas, p_cacao, es_cacao == real_cacao):
            print(f"{'  ' if ok else 'XX'} {CLASES[t]:5s} P(cacao)={pc:.3f}  {p.name}")
        print()

    acc = float((es_cacao == real_cacao).mean())
    tp = int((es_cacao & real_cacao).sum())
    fn = int((~es_cacao & real_cacao).sum())
    tn = int((~es_cacao & ~real_cacao).sum())
    fp = int((es_cacao & ~real_cacao).sum())
    print(f"Imágenes: {len(filas)}   umbral P(cacao) >= {args.umbral}")
    print(f"Exactitud: {acc:.3f}")
    print(f"Cacao aceptado:  {tp}/{tp + fn}   (cacao rechazado por error: {fn})")
    print(f"Otros rechazado: {tn}/{tn + fp}   (otros aceptado por error: {fp})")


if __name__ == "__main__":
    main()
