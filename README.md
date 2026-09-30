# Comparador de Rostros

Aplicación web que compara dos fotografías de rostros y estima si corresponden a la misma persona. Entrega un porcentaje de similitud y un reporte detallado en español que se puede ver, imprimir como PDF o descargar como HTML.

**Todo se procesa en el navegador.** Las imágenes no se envían a ningún servidor. La librería y los modelos de IA vienen incluidos en el repositorio, así que la aplicación funciona sin conexión.

## Uso

1. Abre `index.html` con doble clic en un navegador moderno (Chrome, Edge, Firefox o Safari). No necesita servidor ni instalación.
2. Espera a que termine la carga de modelos, que toma unos segundos.
3. Carga la **Foto 1** y la **Foto 2**: haz clic, arrastra el archivo o pega la imagen con Ctrl + V. Si una foto tiene varios rostros, elige cuál comparar con los botones numerados o haciendo clic sobre la cara.
4. Ajusta el **umbral de coincidencia** (por defecto 60 %) y pulsa **Comparar rostros**.
5. Usa **Ver reporte**, **Imprimir / guardar PDF** o **Descargar HTML**.

## Cómo se calcula la similitud

| Componente | Peso | Detalle |
|---|---|---|
| Descriptor biométrico | 70 % | Vector de 128 dimensiones (ResNet-34, face-api.js). Se usa la distancia euclidiana, con el criterio estándar < 0,60 = misma persona. |
| Geometría facial | 25 % | 24 parámetros antropométricos calculados sobre 68 puntos faciales y normalizados por la distancia interpupilar: ojos, cejas, nariz, boca, mentón, proporciones, índices facial y mandibular, ángulos, asimetría y forma del rostro. |
| Edad y sexo estimados | 5 % | Diferencia de edad estimada y coincidencia de sexo. |

Antes de extraer el descriptor, el rostro se endereza automáticamente según la línea de los ojos. La aplicación también mide la calidad de cada imagen (tamaño del rostro, nitidez, brillo, contraste, pose y expresión) y muestra avisos cuando algo afecta la fiabilidad.

Veredictos: **alta probabilidad** (≥ umbral + 20), **probable** (≥ umbral), **no concluyente** (entre umbral − 15 y el umbral) y **personas distintas** (por debajo).

El reporte incluye, para cada archivo, el nombre, las dimensiones, la fecha y el hash **SHA-256** (para verificar la integridad del original).

> ⚠️ El resultado es probabilístico y orientativo. No reemplaza un peritaje de identificación facial.

## Estructura

```
index.html                 Interfaz
css/estilos.css            Estilos (responsivo, modo claro/oscuro)
js/modelos.js              Carga de modelos incrustados (compatible con file://)
js/analisis.js             Detección, parámetros faciales y comparación
js/reporte.js              Generación del reporte HTML/PDF
js/app.js                  Lógica de la interfaz
vendor/face-api.js         @vladmandic/face-api 1.7.15 (incluye TensorFlow.js), licencia MIT
modelos/*.js               Pesos de los modelos en base64
herramientas/empaquetar_modelos.py   Regenera modelos/*.js a partir de los archivos originales
```

Los pesos van incrustados en archivos `.js` porque los navegadores bloquean `fetch()` en páginas abiertas como `file://`. Así la app funciona con doble clic. Ocupan unos 17 MB en total.

También se puede publicar tal cual en GitHub Pages o en cualquier hosting estático.
