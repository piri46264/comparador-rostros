#!/usr/bin/env python3
"""Convierte los modelos de face-api (manifest .json + .bin) en archivos .js.

Los navegadores bloquean fetch() cuando la página se abre como file://, por lo
que los pesos se incrustan en base64 dentro de scripts normales. Así la
aplicación funciona con doble clic sobre index.html, sin servidor.

Uso:
    python3 herramientas/empaquetar_modelos.py <carpeta_model_de_face-api> modelos/
"""
import base64
import json
import pathlib
import sys

MODELOS = [
    "ssd_mobilenetv1_model",
    "face_landmark_68_model",
    "face_recognition_model",
    "age_gender_model",
    "face_expression_model",
]


def main(origen: str, destino: str) -> None:
    origen_p, destino_p = pathlib.Path(origen), pathlib.Path(destino)
    destino_p.mkdir(parents=True, exist_ok=True)
    for nombre in MODELOS:
        manifest = json.loads((origen_p / f"{nombre}-weights_manifest.json").read_text())
        binario = b"".join(
            (origen_p / ruta).read_bytes() for grupo in manifest for ruta in grupo["paths"]
        )
        especificaciones = [peso for grupo in manifest for peso in grupo["weights"]]
        contenido = (
            "window.MODELOS_FACIALES = window.MODELOS_FACIALES || {};\n"
            f"window.MODELOS_FACIALES[{json.dumps(nombre)}] = {{\n"
            f"  pesos: {json.dumps(especificaciones, separators=(',', ':'))},\n"
            f"  datos: \"{base64.b64encode(binario).decode()}\"\n"
            "};\n"
        )
        (destino_p / f"{nombre}.js").write_text(contenido)
        print(f"{nombre}: {len(binario):,} bytes")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
