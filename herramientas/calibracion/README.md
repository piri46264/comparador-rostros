# Calibración del modo automático

Estos scripts generan los coeficientes de `MODELO_BASE` en `js/certeza.js`: cómo se distribuye la distancia entre descriptores faciales para **la misma persona** y para **personas distintas**, según la **calidad** del par de fotos.

## Datos usados (no incluidos en el repositorio)

| Conjunto | Origen | Contenido |
|---|---|---|
| deepface | `serengil/deepface`, carpeta `tests/unit/dataset` (licencia MIT): `master.csv` + imágenes | 25 fotos de personas públicas con pares etiquetados como misma persona o distintas |
| bbt | `justadudewhohacks/face-api.js`, carpeta `examples/images/<nombre>/<nombre>N.png` (licencia MIT) | 35 fotos 150×150 px en escala de grises de 7 personas (5 por persona), guardadas como `bbt/<nombre>_N.png` |

Cada foto se procesa además con 7 degradaciones: reducción al 40 %, 20 % y 12 %; desenfoque; oscurecimiento; JPEG de baja calidad; y una combinación de todas. Así se cubren calidades desde buenas hasta muy deficientes.

## Pasos

```bash
npm i playwright            # o usa una instalación global
node calibrar.js 0 3 & node calibrar.js 1 3 & node calibrar.js 2 3 & wait   # 3 procesos en paralelo
node ajustar.js             # imprime tablas por calidad, EER y el JSON "AJUSTE"
node validar.js             # tasas de acierto/error/no concluyente del modo automático
```

## Resultados de la calibración incluida (30-09-2026)

- 222 rostros válidos, 2.351 pares de la misma persona y 21.575 pares de personas distintas.

| Calidad del par | Distancia misma persona | Distancia distintas | EER |
|---|---|---|---|
| 0,40 | 0,474 ± 0,077 | 0,810 ± 0,079 | 1,2 % |
| 0,52 | 0,414 ± 0,078 | 0,827 ± 0,079 | 0,4 % |
| 0,65 | 0,388 ± 0,053 | 0,833 ± 0,082 | 0,0 % |
| 0,84 | 0,376 ± 0,062 | 0,823 ± 0,083 | 0,1 % |

- **EER global:** 0,65 % con umbral en distancia 0,622. Con el umbral fijo de face-api (0,60) se obtienen 1,5 % de falsos rechazos y 0,39 % de falsas coincidencias.
- **Geometría facial (24 parámetros):** EER de 42 %. Su poder discriminante es bajo, así que en la LR su aporte se limita a ×2.
- **TTA (espejo + ecualización):** no mejoró el EER en este conjunto (0,65 % frente a 0,60 %). Se mantiene como indicador de estabilidad.
- **Validación del modo automático (dentro de la muestra, con el componente de "impostores difíciles"):**
  - pares de personas distintas: 0,00 % declarados "misma persona", 90,6 % "distintas" y 9,4 % no concluyentes;
  - pares de la misma persona: 65,6 % declarados "misma persona", 0,04 % "distintas" y 34,4 % no concluyentes.

  Sin ese componente, el 87 % de los pares de la misma persona era concluyente, pero se aceptaba un riesgo no medido de falsas coincidencias con personas parecidas.
- **Caso real de falsa coincidencia (30-09-2026):** dos hombres distintos obtuvieron una distancia de 0,52 (LR = 120, "muy probablemente la misma persona") con el modelo sin corregir. La pareja quedó más cerca que el 99,5 % de los pares de personas distintas del conjunto de calibración. Un segundo reconocedor (faceres, de la librería Human) tampoco los separó: quedó más cerca que el 99,7 %. Por eso se agregó un componente de "impostores difíciles" (N(0,58; 0,07), peso 3 %), con el que la falsa coincidencia en el umbral estándar sube ~10 veces, en línea con las diferencias demográficas documentadas por NIST (FRVT parte 3, 2019). También se exige LR ≥ 100 para concluir. El caso ahora resulta "no concluyente" (LR ≈ 19), y la diferencia de despegue de la oreja, registrada por el observador, lleva la conclusión integrada a "probable exclusión".
- **Rostros muy recortados** (tipo carné): sin margen alrededor, el detector fallaba en 26 de 35 casos. Por eso la app agrega un margen automático y vuelve a intentar, con lo que se detectaron todos.

**Limitaciones:** la muestra es pequeña (20 personas) y está compuesta sobre todo por personas de piel clara y la validación es dentro de la muestra. Por eso el modelo amplía las desviaciones en un 15 % y usa una extrapolación prudente para calidades inferiores a 0,35. Para uso institucional conviene calibrar con casos propios desde la sección "Calibración" de la app.
