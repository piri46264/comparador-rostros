# Comparador de Rostros

Aplicación web que compara dos fotografías de rostros y estima si corresponden a la misma persona. Entrega un porcentaje de similitud y un reporte detallado en español que se puede ver, imprimir como PDF o descargar como HTML.

**Todo se procesa en el navegador.** Las imágenes no se envían a ningún servidor. La librería y los modelos de IA vienen incluidos en el repositorio, así que la aplicación funciona sin conexión.

## Uso

1. Abre `index.html` con doble clic en un navegador moderno (Chrome, Edge, Firefox o Safari). No necesita servidor ni instalación.
2. Espera a que termine la carga de modelos, que toma unos segundos.
3. Carga la **Foto 1** y la **Foto 2**: haz clic, arrastra el archivo o pega la imagen con Ctrl + V. Si una foto tiene varios rostros, elige cuál comparar con los botones numerados o haciendo clic sobre la cara.
4. Elige el **modo de decisión**:
   - **Automático (recomendado):** el programa mide la calidad de cada foto y calcula el umbral, el grado de certeza y la probabilidad de error.
   - **Manual:** tú fijas el umbral de similitud global (por defecto 60 %).
5. Pulsa **Comparar rostros**.
6. Usa **Ver reporte**, **Imprimir / guardar PDF** o **Descargar HTML**.

## Cómo se calcula la similitud

| Componente | Peso | Detalle |
|---|---|---|
| Descriptor biométrico | 80 % | Vector de 128 dimensiones (ResNet-34, face-api.js). Se usa la distancia euclidiana, con el criterio estándar < 0,60 = misma persona. |
| Geometría facial | 15 % | 24 parámetros antropométricos calculados sobre 68 puntos faciales y normalizados por la distancia interpupilar: ojos, cejas, nariz, boca, mentón, proporciones, índices facial y mandibular, ángulos, asimetría y forma del rostro. |
| Edad y sexo estimados | 5 % | Diferencia de edad estimada y coincidencia de sexo. |

Antes de extraer el descriptor, el rostro se endereza automáticamente según la línea de los ojos. La aplicación también mide la calidad de cada imagen (tamaño del rostro, nitidez, brillo, contraste, pose y expresión) y muestra avisos cuando algo afecta la fiabilidad.

### Modo automático: ¿con qué porcentaje hay certeza?

No existe un porcentaje fijo que garantice certeza. El umbral correcto depende de la calidad de las fotos: con buenas fotos, una similitud moderada ya es concluyente; con fotos pequeñas, borrosas u oscuras, incluso las fotos de personas distintas se parecen más y la de una misma persona se parece menos. El modo automático:

1. **Mide la calidad** de cada foto de 0 a 100 (resolución interpupilar, nitidez, iluminación, contraste, pose, inclinación, expresión y confianza de detección), con criterios inspirados en ISO/IEC 29794-5.
2. **Modela estadísticamente** las distancias entre descriptores esperables para la misma persona y para personas distintas *a esa calidad*. El modelo base se obtuvo empíricamente con este mismo motor sobre fotos etiquetadas y sus versiones degradadas (ver `herramientas/calibracion/`).
3. Calcula la **razón de verosimilitud (LR)**, la forma de expresar conclusiones recomendada por ENFSI y FISWG, con su escala verbal (apoyo débil, moderado, moderadamente fuerte, fuerte, muy fuerte).
4. Informa el **grado de certeza** (probabilidad de misma persona con un 50 % previo) y los riesgos de error: cuántos pares de personas distintas alcanzarían esa similitud y cuántos pares de la misma persona saldrían más bajos.
5. Dibuja las **zonas de decisión** para esa calidad (distintas / no concluyente / misma persona) y la tabla **"¿Con qué % puedo tener certeza?"**, con el porcentaje mínimo exigido para riesgos de 1 en 100, 1 en 1.000, 1 en 10.000 y 1 en 100.000.

Decisión automática: *misma persona* si LR ≥ 100, *personas distintas* si LR ≤ 1/100 y *no concluyente* entre ambos. Con calidad del par inferior a 15/100 se declara "calidad insuficiente".

**Calibración con casos propios (opcional):** en la sección "Calibración", carga fotos de identidad conocida similares a las que comparas (una carpeta por persona, o nombres `persona_1.jpg`). El programa recalcula las distribuciones, el EER y los umbrales, y guarda la calibración en el navegador.

**Otras mejoras de precisión:**
- **TTA (aumentación en tiempo de prueba):** el descriptor se promedia sobre la imagen original, su espejo y su versión ecualizada, lo que reduce el efecto de la iluminación y de la asimetría de pose. El rango entre variantes se informa como *estabilidad*.
- **Geometría como evidencia secundaria:** la geometría aporta a la LR con un peso acotado (máx. ×5), porque es una evidencia débil frente al descriptor.

### Modo manual

Veredictos: **alta probabilidad** (≥ umbral + 20), **probable** (≥ umbral), **no concluyente** (entre umbral − 15 y el umbral) y **personas distintas** (por debajo).

El reporte incluye, para cada archivo, el nombre, las dimensiones, la fecha y el hash **SHA-256** (para verificar la integridad del original).

> ⚠️ El resultado es probabilístico y orientativo. No reemplaza un peritaje de identificación facial.

## Estructura

```
index.html                 Interfaz
css/estilos.css            Estilos (responsivo, modo claro/oscuro)
js/modelos.js              Carga de modelos incrustados (compatible con file://)
js/certeza.js              Modo automático: calidad, LR, umbrales y calibración
js/analisis.js             Detección, parámetros faciales y comparación
js/reporte.js              Generación del reporte HTML/PDF
js/app.js                  Lógica de la interfaz
vendor/face-api.js         @vladmandic/face-api 1.7.15 (incluye TensorFlow.js), licencia MIT
modelos/*.js               Pesos de los modelos en base64
herramientas/empaquetar_modelos.py   Regenera modelos/*.js a partir de los archivos originales
```

Los pesos van incrustados en archivos `.js` porque los navegadores bloquean `fetch()` en páginas abiertas como `file://`. Así la app funciona con doble clic. Ocupan unos 17 MB en total.

También se puede publicar tal cual en GitHub Pages o en cualquier hosting estático.
