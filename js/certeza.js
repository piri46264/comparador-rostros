/*
 * Modo automático: umbral adaptado a la calidad y grado de certeza.
 *
 * Modelo: para un par de fotos de calidad q (0–1), la distancia entre descriptores sigue
 *   - una normal N(μg(q), σg(q)) si son la MISMA persona (pares "genuinos"),
 *   - una normal N(μi(q), σi(q)) si son personas DISTINTAS (pares "impostores").
 * Con ambas densidades se calcula la razón de verosimilitud (LR), el estándar recomendado
 * por ENFSI para expresar conclusiones forenses, las tasas de error esperables y los
 * umbrales que corresponden a cada nivel de certeza.
 *
 * Los coeficientes base se obtuvieron empíricamente con este mismo motor (descriptor TTA)
 * sobre fotos etiquetadas y sus versiones degradadas (ver herramientas/calibracion/).
 * El usuario puede reemplazarlos con una calibración propia (casos con identidad conocida).
 */
(function () {
  'use strict';

  // Coeficientes lineales: valor = a + b·q   (q = calidad del par, 0–1)
  const MODELO_BASE = {
    // Ajuste lineal sobre 222 rostros válidos (60 fotos de 20 personas + 7 degradaciones controladas),
    // 2.351 pares de la misma persona y 21.575 pares de personas distintas. Rango con datos: q ≥ 0,35.
    genuino: { mu: [0.5380, -0.2070], sigma: [0.0942, -0.0440] },
    impostor: { mu: [0.8072, 0.0263], sigma: [0.0744, 0.0106] },
    qMin: 0.35,
    // Ancla conservadora para calidad nula (extrapolación prudente, sin datos directos)
    ancla: { mg: 0.62, sg: 0.10, mi: 0.76, si: 0.09 },
    inflacion: 1.15,
    // Geometría: poder discriminante bajo (EER ≈ 42 %) → aporte a la LR acotado a ×2
    // Componente de "impostores difíciles" (parecidos entre sí, o de grupos poblacionales poco
    // representados en el entrenamiento del modelo). NIST FRVT parte 3 (2019) documentó tasas de
    // falsa coincidencia 10–100 veces mayores en algunos grupos demográficos. Con este componente la
    // falsa coincidencia en el umbral estándar (0,60) sube ~10 veces respecto de la muestra de calibración.
    impostorDificil: { mu: 0.58, sigma: 0.07, peso: 0.03 },
    geometria: { genuino: { m: 82.8, s: 10.7 }, impostor: { m: 79.3, s: 9.7 }, lrMax: 2 },
    fuente: 'calibración empírica del programa (2.351 pares misma persona / 21.575 pares distintas, fotos originales y degradadas)',
    validacion: { eerBuena: 0.001, eerMedia: 0.004, eerBaja: 0.012 },
  };

  const CLAVE_ALMACEN = 'comparador-rostros:calibracion';
  const LR_MAX = 1e6;

  /* ---------------- Estadística ---------------- */
  function erf(x) {
    // Abramowitz & Stegun 7.1.26
    const s = Math.sign(x); x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  const Phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
  const logPdf = (x, m, s) => -0.5 * ((x - m) / s) ** 2 - Math.log(s) - 0.9189385;
  function probit(p) {
    // Inversa de la normal estándar (Acklam)
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const pl = 0.02425;
    if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - pl) return -probit(1 - p);
    const q = p - 0.5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const lin = (c, q) => c[0] + c[1] * q;
  const limitar = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------------- Calibración propia ---------------- */
  function leerCalibracion() {
    try { const t = localStorage.getItem(CLAVE_ALMACEN); return t ? JSON.parse(t) : null; } catch (e) { return null; }
  }
  function guardarCalibracion(c) {
    try { if (c) localStorage.setItem(CLAVE_ALMACEN, JSON.stringify(c)); else localStorage.removeItem(CLAVE_ALMACEN); } catch (e) { /* almacenamiento no disponible */ }
  }

  /* ---------------- Modelo ---------------- */
  function calidadPar(qa, qb) {
    const a = qa / 100, b = qb / 100;
    return limitar(0.7 * Math.min(a, b) + 0.3 * (a + b) / 2, 0, 1);
  }

  function parametrosBase(q) {
    const M = MODELO_BASE;
    const ajustado = (qq) => ({
      mg: lin(M.genuino.mu, qq), sg: lin(M.genuino.sigma, qq),
      mi: lin(M.impostor.mu, qq), si: lin(M.impostor.sigma, qq),
    });
    let P;
    if (q >= M.qMin) {
      P = ajustado(q);
    } else {
      // Por debajo del rango con datos: interpolación conservadora hacia el ancla de calidad nula,
      // donde las distribuciones se acercan (fotos malas hacen parecidas a todas las personas)
      const t = q / M.qMin, A = M.ancla, B = ajustado(M.qMin);
      P = { mg: A.mg + (B.mg - A.mg) * t, sg: A.sg + (B.sg - A.sg) * t, mi: A.mi + (B.mi - A.mi) * t, si: A.si + (B.si - A.si) * t };
    }
    // Margen de seguridad por tamaño muestral limitado
    P.sg = Math.max(0.035, P.sg * M.inflacion);
    P.si = Math.max(0.035, P.si * M.inflacion);
    return P;
  }

  function parametros(q, calib) {
    const M = MODELO_BASE;
    const P = parametrosBase(q);
    let fuente = `Modelo base: ${M.fuente}`;
    if (calib) {
      // La calibración propia fija el nivel; el efecto de la calidad se toma del modelo base
      // Contracción bayesiana: con pocos pares, la calibración propia se combina con el modelo base
      const ref = parametrosBase(calib.qMedia), dq = (k) => P[k] - ref[k];
      const wg = calib.nGen / (calib.nGen + 30), wi = calib.nImp / (calib.nImp + 30);
      const mezcla = (propio, base, w) => w * propio + (1 - w) * base;
      P.mg = mezcla(calib.mg, ref.mg, wg) + dq('mg'); P.sg = Math.max(0.035, mezcla(calib.sg * M.inflacion, ref.sg, wg) + dq('sg'));
      P.mi = mezcla(calib.mi, ref.mi, wi) + dq('mi'); P.si = Math.max(0.035, mezcla(calib.si * M.inflacion, ref.si, wi) + dq('si'));
      fuente = `Calibración propia (${calib.nGen} pares misma persona, ${calib.nImp} pares distintas; peso ${(wg * 100).toFixed(0)} % frente al modelo base; ${new Date(calib.fecha).toLocaleDateString('es-CL')})`;
    }
    return { ...P, fuente };
  }

  // Densidad de impostores: mezcla del grupo general y del componente de impostores difíciles
  function logPdfImpostor(d, P) {
    const H = MODELO_BASE.impostorDificil;
    const a = Math.log(1 - H.peso) + logPdf(d, P.mi, P.si), b = Math.log(H.peso) + logPdf(d, H.mu, H.sigma);
    const m = Math.max(a, b);
    return m + Math.log(Math.exp(a - m) + Math.exp(b - m));
  }
  function cdfImpostor(d, P) {
    const H = MODELO_BASE.impostorDificil;
    return (1 - H.peso) * Phi((d - P.mi) / P.si) + H.peso * Phi((d - H.mu) / H.sigma);
  }
  // Distancia en la que la tasa de falsa coincidencia (CDF de impostores) vale fmr
  function inversaImpostor(fmr, P) {
    let lo = 0, hi = 2;
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (cdfImpostor(m, P) < fmr) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }
  const log10LRdist = (d, P) => (logPdf(d, P.mg, P.sg) - logPdfImpostor(d, P)) / Math.LN10;

  // Distancia en la que el log10(LR) alcanza un valor objetivo (búsqueda binaria entre las dos medias)
  function distanciaParaLR(objetivo, P) {
    let lo = Math.min(P.mg, P.mi) - 0.3, hi = Math.max(P.mg, P.mi) + 0.3;
    // log10LR decrece con d entre las medias; se busca en ese tramo monótono
    lo = P.mg - 3 * P.sg; hi = P.mi + 3 * P.si;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (log10LRdist(m, P) > objetivo) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  }

  function lrGeometria(g) {
    const G = MODELO_BASE.geometria;
    const l = (logPdf(g, G.genuino.m, G.genuino.s) - logPdf(g, G.impostor.m, G.impostor.s)) / Math.LN10;
    return limitar(l, -Math.log10(G.lrMax), Math.log10(G.lrMax)); // aporte acotado: la geometría es evidencia débil
  }

  const ESCALA = [
    { min: 4, texto: 'Apoyo muy fuerte', lado: 'misma' },
    { min: 3, texto: 'Apoyo fuerte', lado: 'misma' },
    { min: 2, texto: 'Apoyo moderadamente fuerte', lado: 'misma' },
    { min: 1, texto: 'Apoyo moderado', lado: 'misma' },
    { min: 0, texto: 'Apoyo débil', lado: 'misma' },
  ];
  function escalaVerbal(log10lr) {
    const a = Math.abs(log10lr);
    const lado = log10lr >= 0 ? 'a que sean la MISMA persona' : 'a que sean personas DISTINTAS';
    if (a < 0.3) return { texto: 'Sin apoyo a ninguna hipótesis (evidencia neutra)', lado: 'neutra' };
    const e = ESCALA.find((x) => a >= x.min);
    return { texto: `${e.texto} ${lado}`, lado: log10lr >= 0 ? 'misma' : 'distinta' };
  }

  function formatoRazon(p) {
    if (p <= 0) return 'prácticamente nula';
    if (p >= 0.5) return `${(p * 100).toFixed(0)} %`;
    const n = 1 / p;
    const r = n >= 1e6 ? 'más de 1.000.000' : Math.round(n).toLocaleString('es-CL');
    return `1 de cada ${r}`;
  }

  /**
   * Evalúa una comparación en modo automático.
   * @param res  resultado de AnalisisFacial.comparar
   * @param a,b  análisis de cada rostro
   */
  function evaluar(res, a, b, calib = leerCalibracion()) {
    const q = calidadPar(a.puntajeCalidad.puntaje, b.puntajeCalidad.puntaje);
    const P = parametros(q, calib);
    const d = res.distancia;
    const l10d = limitar(log10LRdist(d, P), -6, 6);
    const l10g = lrGeometria(res.simGeometria);
    const log10lr = limitar(l10d + l10g, -Math.log10(LR_MAX), Math.log10(LR_MAX));
    const lr = 10 ** log10lr;
    const certeza = lr / (1 + lr); // probabilidad de misma persona con probabilidad previa neutra (50 %)

    // Tasas de error en el valor observado
    const fmrObservada = cdfImpostor(d, P);              // P(distancia ≤ d | personas distintas)
    const fnmrObservada = 1 - Phi((d - P.mg) / P.sg);   // P(distancia ≥ d | misma persona)

    // Umbrales automáticos (en distancia y en % de similitud biométrica)
    const sim = AnalisisFacial.similitudDescriptor;
    const dCoincide = distanciaParaLR(2, P);   // LR = 100
    const dExcluye = distanciaParaLR(-2, P);   // LR = 1/100
    const dEquilibrio = distanciaParaLR(0, P); // LR = 1 (umbral de mínimo error)
    const umbrales = {
      coincidencia: { distancia: dCoincide, similitud: sim(dCoincide) },
      equilibrio: { distancia: dEquilibrio, similitud: sim(dEquilibrio) },
      exclusion: { distancia: dExcluye, similitud: sim(dExcluye) },
    };

    // Tabla de puntos de operación: "si exijo esta similitud, ¿cuánto me equivoco?"
    const puntos = [0.01, 0.001, 0.0001, 0.00001].map((fmr) => {
      const t = inversaImpostor(fmr, P);
      return { fmr, distancia: t, similitud: sim(t), fnmr: 1 - Phi((t - P.mg) / P.sg) };
    });

    const verbal = escalaVerbal(log10lr);
    let veredicto, nivel;
    if (q < 0.15) {
      veredicto = 'CALIDAD INSUFICIENTE para concluir'; nivel = 'dudosa';
    } else if (log10lr >= 3) { veredicto = 'Corresponden a la MISMA PERSONA (apoyo fuerte)'; nivel = 'alta'; }
    else if (log10lr >= 2) { veredicto = 'Muy probablemente la MISMA PERSONA'; nivel = 'alta'; }
    else if (log10lr >= 1) { veredicto = 'NO CONCLUYENTE (inclinación a misma persona)'; nivel = 'dudosa'; }
    else if (log10lr > -1) { veredicto = 'Resultado NO CONCLUYENTE'; nivel = 'dudosa'; }
    else if (log10lr > -2) { veredicto = 'NO CONCLUYENTE (inclinación a personas distintas)'; nivel = 'dudosa'; }
    else { veredicto = 'Corresponden a PERSONAS DISTINTAS'; nivel = 'baja'; }

    // Estabilidad: rango de distancias entre las variantes aumentadas de cada rostro
    let dMin = Infinity, dMax = 0;
    for (const x of a.descriptores || []) for (const y of b.descriptores || []) {
      const dd = faceapi.euclideanDistance(x, y); dMin = Math.min(dMin, dd); dMax = Math.max(dMax, dd);
    }
    const estabilidad = isFinite(dMin) ? { dMin, dMax, cruzaUmbral: dMin < dEquilibrio && dMax > dEquilibrio } : null;

    const avisos = [];
    if (q < 0.35) avisos.push('La calidad del par es baja: la franja no concluyente es más amplia y se necesita más similitud para concluir.');
    if (estabilidad && estabilidad.cruzaUmbral) avisos.push('El resultado cambia de lado del umbral según la variante de la imagen (espejo/ecualizada): resultado inestable.');
    if (Math.abs(l10g) >= 0.5 && Math.sign(l10g) !== Math.sign(l10d)) avisos.push('La geometría facial contradice al descriptor biométrico; revisar manualmente.');

    return {
      q, qA: a.puntajeCalidad.puntaje, qB: b.puntajeCalidad.puntaje, P,
      log10lr, lr, log10lrDescriptor: l10d, log10lrGeometria: l10g, certeza,
      fmrObservada, fnmrObservada, umbrales, puntos, verbal, veredicto, nivel, estabilidad, avisos,
      formatoRazon,
    };
  }

  /* ---------------- Calibración con fotos propias ---------------- */
  function ajustarCalibracion(muestras) {
    // muestras: [{ persona, archivo, descriptor, q }]
    const gen = [], imp = [], qs = [];
    for (let i = 0; i < muestras.length; i++) for (let j = i + 1; j < muestras.length; j++) {
      const a = muestras[i], b = muestras[j];
      const d = faceapi.euclideanDistance(a.descriptor, b.descriptor);
      (a.persona === b.persona ? gen : imp).push(d);
      qs.push(calidadPar(a.q, b.q));
    }
    if (gen.length < 3 || imp.length < 3) throw new Error('Se necesitan al menos 2 personas y 3 pares de la misma persona (p. ej. 2 fotos de cada una de 3 personas).');
    const est = (xs) => { const m = xs.reduce((s, x) => s + x, 0) / xs.length; return { m, s: Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1)) }; };
    const G = est(gen), I = est(imp);
    // EER empírico: umbral que iguala ambas tasas de error (centro del tramo óptimo)
    const tasas = (t) => ({ fn: gen.filter((d) => d > t).length / gen.length, fm: imp.filter((d) => d <= t).length / imp.length });
    let mejor = Infinity, tramo = [];
    for (let t = 0.2; t <= 1.2001; t += 0.0025) {
      const { fn, fm } = tasas(t), costo = Math.max(fn, fm);
      if (costo < mejor - 1e-12) { mejor = costo; tramo = [t]; } else if (Math.abs(costo - mejor) < 1e-12) tramo.push(t);
    }
    const tEER = tramo.length ? (tramo[0] + tramo[tramo.length - 1]) / 2 : 0.6;
    const r = tasas(tEER);
    const eer = { e: (r.fn + r.fm) / 2, t: tEER };
    return {
      mg: G.m, sg: Math.max(0.035, G.s), mi: I.m, si: Math.max(0.035, I.s),
      nGen: gen.length, nImp: imp.length, nFotos: muestras.length,
      personas: new Set(muestras.map((m) => m.persona)).size,
      qMedia: qs.reduce((s, x) => s + x, 0) / qs.length,
      eer: eer.e, umbralEER: eer.t, fecha: Date.now(),
      histograma: { gen, imp },
    };
  }

  window.ModeloCerteza = { evaluar, calidadPar, parametros, leerCalibracion, guardarCalibracion, ajustarCalibracion, escalaVerbal, MODELO_BASE };
})();
