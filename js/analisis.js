/* Motor de análisis facial: detección, extracción de parámetros y comparación. */
(function () {
  'use strict';

  const LADO_MAXIMO = 1600;          // px: las imágenes grandes se reducen para agilizar el análisis
  const CORRECCION_ROLL_MIN = 3;     // grados de inclinación a partir de los cuales se endereza el rostro
  const OPCIONES_SSD = () => new faceapi.SsdMobilenetv1Options({ minConfidence: 0.35, maxResults: 20 });

  // Pesos basados en la capacidad discriminante medida (EER descriptor ≈ 0,2 %; geometría ≈ 40 %)
  const PESOS_GLOBALES = { descriptor: 0.80, geometria: 0.15, demografia: 0.05 };

  /* ------------------------------------------------------------------ */
  /* Utilidades geométricas                                              */
  /* ------------------------------------------------------------------ */
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const media = (pts) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });
  const puntoMedio = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const grados = (rad) => rad * 180 / Math.PI;
  function angulo(a, vertice, b) {
    const v1 = { x: a.x - vertice.x, y: a.y - vertice.y };
    const v2 = { x: b.x - vertice.x, y: b.y - vertice.y };
    const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y));
    return grados(Math.acos(Math.max(-1, Math.min(1, cos))));
  }
  const limitar = (v, min, max) => Math.max(min, Math.min(max, v));

  /* ------------------------------------------------------------------ */
  /* Preparación de archivos                                             */
  /* ------------------------------------------------------------------ */
  function leerComoDataURL(archivo) {
    return new Promise((resolver, rechazar) => {
      const lector = new FileReader();
      lector.onload = () => resolver(lector.result);
      lector.onerror = () => rechazar(new Error('No se pudo leer el archivo.'));
      lector.readAsDataURL(archivo);
    });
  }

  function cargarImagen(src) {
    return new Promise((resolver, rechazar) => {
      const img = new Image();
      img.onload = () => resolver(img);
      img.onerror = () => rechazar(new Error('El archivo no es una imagen válida o su formato no es compatible con el navegador.'));
      img.src = src;
    });
  }

  async function hashSHA256(archivo) {
    try {
      if (!(window.crypto && crypto.subtle)) return null;
      const buffer = await archivo.arrayBuffer();
      const hash = await crypto.subtle.digest('SHA-256', buffer);
      return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      return null;
    }
  }

  async function prepararArchivo(archivo) {
    if (!archivo.type.startsWith('image/')) throw new Error(`"${archivo.name}" no es un archivo de imagen.`);
    const dataURL = await leerComoDataURL(archivo);
    const img = await cargarImagen(dataURL);
    const escala = Math.min(1, LADO_MAXIMO / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * escala);
    canvas.height = Math.round(img.naturalHeight * escala);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return {
      nombre: archivo.name,
      tipo: archivo.type,
      bytes: archivo.size,
      modificado: archivo.lastModified ? new Date(archivo.lastModified) : null,
      anchoOriginal: img.naturalWidth,
      altoOriginal: img.naturalHeight,
      escala,
      sha256: await hashSHA256(archivo),
      dataURL,
      canvas,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Detección                                                           */
  /* ------------------------------------------------------------------ */
  async function detectarRostros(canvas) {
    const resultados = await faceapi
      .detectAllFaces(canvas, OPCIONES_SSD())
      .withFaceLandmarks()
      .withFaceDescriptors()
      .withAgeAndGender()
      .withFaceExpressions();
    return resultados.sort((a, b) => b.detection.box.area - a.detection.box.area);
  }

  /**
   * Detección con respaldo: si no se encuentra ningún rostro (típico de fotos muy recortadas,
   * tipo carné, o muy pequeñas), se agrega un margen alrededor y se amplía la imagen antes de
   * reintentar. Si funciona, la imagen de trabajo se reemplaza por la versión con margen.
   */
  async function detectarConRespaldo(imagen) {
    let rostros = await detectarRostros(imagen.canvas);
    if (rostros.length) return rostros;
    const c0 = imagen.canvas;
    const margen = 0.4;
    const ampl = Math.max(1, 480 / Math.min(c0.width, c0.height));
    const w = Math.round(c0.width * (1 + 2 * margen) * ampl), h = Math.round(c0.height * (1 + 2 * margen) * ampl);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    // Fondo: la propia imagen muy ampliada y desenfocada (evita bordes artificiales)
    ctx.filter = 'blur(12px)';
    ctx.drawImage(c0, 0, 0, w, h);
    ctx.filter = 'none';
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c0, c0.width * margen * ampl, c0.height * margen * ampl, c0.width * ampl, c0.height * ampl);
    rostros = await detectarRostros(c);
    if (rostros.length) {
      imagen.canvas = c;
      imagen.escala = imagen.escala * ampl;
      imagen.conMargen = true;
    }
    return rostros;
  }

  function ojos(puntos) {
    return { derecho: media(puntos.slice(36, 42)), izquierdo: media(puntos.slice(42, 48)) };
  }

  /**
   * Endereza el rostro (corrige la inclinación lateral) recortándolo y rotándolo,
   * y vuelve a extraer descriptor y puntos. Mejora la precisión del descriptor 128-D.
   */
  async function enderezar(canvas, deteccion) {
    const puntos = deteccion.landmarks.positions;
    const o = ojos(puntos);
    const roll = grados(Math.atan2(o.izquierdo.y - o.derecho.y, o.izquierdo.x - o.derecho.x));
    if (Math.abs(roll) < CORRECCION_ROLL_MIN) return { resultado: deteccion, lienzo: canvas, roll, corregido: false };

    const caja = deteccion.detection.box;
    const lado = Math.round(Math.max(caja.width, caja.height) * 2.2);
    const centro = { x: caja.x + caja.width / 2, y: caja.y + caja.height / 2 };
    const recorte = document.createElement('canvas');
    recorte.width = recorte.height = lado;
    const ctx = recorte.getContext('2d');
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, lado, lado);
    ctx.translate(lado / 2, lado / 2);
    ctx.rotate(-roll * Math.PI / 180);
    ctx.drawImage(canvas, -centro.x, -centro.y);

    const nuevo = await faceapi
      .detectSingleFace(recorte, OPCIONES_SSD())
      .withFaceLandmarks()
      .withFaceDescriptor()
      .withAgeAndGender()
      .withFaceExpressions();
    if (!nuevo) return { resultado: deteccion, lienzo: canvas, roll, corregido: false };
    return { resultado: nuevo, lienzo: recorte, roll, corregido: true };
  }

  /* ------------------------------------------------------------------ */
  /* Calidad de imagen                                                   */
  /* ------------------------------------------------------------------ */
  function medirCalidad(lienzo, caja) {
    const tam = 192;
    const c = document.createElement('canvas');
    c.width = c.height = tam;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(lienzo, caja.x, caja.y, caja.width, caja.height, 0, 0, tam, tam);
    const { data } = ctx.getImageData(0, 0, tam, tam);
    const gris = new Float32Array(tam * tam);
    let suma = 0;
    for (let i = 0; i < gris.length; i++) {
      gris[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
      suma += gris[i];
    }
    const brillo = suma / gris.length;
    let varianza = 0;
    for (let i = 0; i < gris.length; i++) varianza += (gris[i] - brillo) ** 2;
    const contraste = Math.sqrt(varianza / gris.length);

    // Nitidez: varianza del laplaciano
    let sumaL = 0, sumaL2 = 0, n = 0;
    for (let y = 1; y < tam - 1; y++) {
      for (let x = 1; x < tam - 1; x++) {
        const i = y * tam + x;
        const l = gris[i - 1] + gris[i + 1] + gris[i - tam] + gris[i + tam] - 4 * gris[i];
        sumaL += l; sumaL2 += l * l; n++;
      }
    }
    const nitidez = sumaL2 / n - (sumaL / n) ** 2;
    return { brillo, contraste, nitidez };
  }

  /* ------------------------------------------------------------------ */
  /* Parámetros faciales a partir de los 68 puntos                       */
  /* ------------------------------------------------------------------ */
  // Definición de cada parámetro: tolerancia = variación relativa esperable para una misma persona.
  const DEFINICIONES = [
    { clave: 'dioPx', nombre: 'Distancia interpupilar (DIO)', grupo: 'Ojos', unidad: 'px', comparable: false,
      descripcion: 'Distancia entre los centros de ambos ojos en píxeles. Es la unidad de referencia con que se normalizan las demás medidas.' },
    { clave: 'anchoOjos', nombre: 'Ancho de ojo', grupo: 'Ojos', unidad: '× DIO', tol: 0.08, peso: 1,
      descripcion: 'Promedio del ancho de ambos ojos (comisura externa a interna).' },
    { clave: 'intercantal', nombre: 'Distancia intercantal', grupo: 'Ojos', unidad: '× DIO', tol: 0.08, peso: 1,
      descripcion: 'Separación entre los lagrimales (comisuras internas).' },
    { clave: 'biocular', nombre: 'Anchura biocular', grupo: 'Ojos', unidad: '× DIO', tol: 0.04, peso: 1,
      descripcion: 'Distancia entre las comisuras externas de ambos ojos.' },
    { clave: 'aperturaOjos', nombre: 'Apertura palpebral', grupo: 'Ojos', unidad: 'alto/ancho', tol: 0.22, peso: 0.3,
      descripcion: 'Relación alto/ancho del ojo. Varía con la expresión (peso reducido).' },
    { clave: 'cejaOjo', nombre: 'Distancia ceja–ojo', grupo: 'Cejas', unidad: '× DIO', tol: 0.18, peso: 0.4,
      descripcion: 'Altura de las cejas sobre los ojos. Varía con la expresión (peso reducido).' },
    { clave: 'anchoNariz', nombre: 'Ancho de nariz', grupo: 'Nariz', unidad: '× DIO', tol: 0.08, peso: 1.2,
      descripcion: 'Anchura de las alas nasales.' },
    { clave: 'largoNariz', nombre: 'Largo de nariz', grupo: 'Nariz', unidad: '× DIO', tol: 0.08, peso: 1.2,
      descripcion: 'Distancia vertical del nasion (entrecejo) a la base de la nariz.' },
    { clave: 'indiceNasal', nombre: 'Índice nasal', grupo: 'Nariz', unidad: 'ancho/largo', tol: 0.09, peso: 1.2,
      descripcion: 'Relación ancho/largo de la nariz.' },
    { clave: 'posNariz', nombre: 'Posición vertical de la nariz', grupo: 'Nariz', unidad: 'fracción', tol: 0.05, peso: 1,
      descripcion: 'Ubicación de la base nasal a lo largo de la altura nasion–mentón.' },
    { clave: 'anchoBoca', nombre: 'Ancho de boca', grupo: 'Boca', unidad: '× DIO', tol: 0.10, peso: 0.8,
      descripcion: 'Distancia entre las comisuras labiales. Afectado por la sonrisa.' },
    { clave: 'grosorLabios', nombre: 'Grosor labial', grupo: 'Boca', unidad: '× DIO', tol: 0.22, peso: 0.5,
      descripcion: 'Suma del grosor de labio superior e inferior.' },
    { clave: 'narizBoca', nombre: 'Distancia nariz–boca', grupo: 'Boca', unidad: '× DIO', tol: 0.13, peso: 0.9,
      descripcion: 'Altura del filtrum: base de la nariz al borde del labio superior.' },
    { clave: 'posBoca', nombre: 'Posición vertical de la boca', grupo: 'Boca', unidad: 'fracción', tol: 0.05, peso: 1,
      descripcion: 'Ubicación del centro de la boca a lo largo de la altura nasion–mentón.' },
    { clave: 'bocaMenton', nombre: 'Distancia boca–mentón', grupo: 'Barbilla', unidad: '× DIO', tol: 0.12, peso: 0.9,
      descripcion: 'Del labio inferior al punto más bajo del mentón.' },
    { clave: 'anguloMenton', nombre: 'Ángulo del mentón', grupo: 'Barbilla', unidad: '°', tol: 0.07, peso: 1,
      descripcion: 'Apertura del contorno en el mentón: agudo = barbilla puntiaguda; obtuso = barbilla ancha.' },
    { clave: 'alturaFacial', nombre: 'Altura facial (nasion–mentón)', grupo: 'Rostro', unidad: '× DIO', tol: 0.07, peso: 1.2,
      descripcion: 'Distancia del entrecejo al mentón.' },
    { clave: 'anchoFacial', nombre: 'Ancho facial (bicigomático aprox.)', grupo: 'Rostro', unidad: '× DIO', tol: 0.06, peso: 1.2,
      descripcion: 'Ancho del contorno facial a la altura de los ojos (puntos extremos del óvalo).' },
    { clave: 'anchoMandibula', nombre: 'Ancho mandibular', grupo: 'Rostro', unidad: '× DIO', tol: 0.07, peso: 1.2,
      descripcion: 'Ancho del contorno a la altura de la boca (ángulos de la mandíbula).' },
    { clave: 'indiceFacial', nombre: 'Índice facial', grupo: 'Rostro', unidad: 'alto/ancho', tol: 0.06, peso: 1.4,
      descripcion: 'Relación entre altura y ancho del rostro: define si es alargado o ancho.' },
    { clave: 'indiceMandibular', nombre: 'Índice mandibular', grupo: 'Rostro', unidad: 'fracción', tol: 0.05, peso: 1.4,
      descripcion: 'Ancho mandibular respecto del ancho facial: define si el rostro es cuadrado o afinado.' },
    { clave: 'anguloGonial', nombre: 'Ángulo mandibular', grupo: 'Rostro', unidad: '°', tol: 0.05, peso: 1,
      descripcion: 'Ángulo promedio del contorno en la zona de la mandíbula.' },
    { clave: 'tercios', nombre: 'Proporción tercio medio / inferior', grupo: 'Proporciones', unidad: 'razón', tol: 0.09, peso: 1.2,
      descripcion: 'Altura cejas→base nasal dividida por base nasal→mentón.' },
    { clave: 'asimetria', nombre: 'Índice de asimetría', grupo: 'Proporciones', unidad: '%', tol: 0.6, peso: 0.3, absoluta: 2.5,
      descripcion: 'Diferencia media entre ambos lados del rostro respecto de la línea media. Sensible a la pose.' },
    { clave: 'formaRostro', nombre: 'Forma del rostro', grupo: 'Rostro', unidad: '', categorica: true, peso: 0.8,
      descripcion: 'Clasificación orientativa según índices facial y mandibular.' },
  ];

  function clasificarForma(indiceFacial, indiceMandibular, anguloMenton) {
    if (indiceFacial >= 1.02) return indiceMandibular >= 0.80 ? 'Rectangular' : 'Alargado';
    if (indiceFacial <= 0.86) return indiceMandibular >= 0.80 ? 'Cuadrado' : 'Redondo';
    if (indiceMandibular < 0.74 || anguloMenton < 100) return 'Corazón / triangular';
    if (indiceMandibular >= 0.83) return 'Cuadrado';
    return 'Ovalado';
  }

  function extraerParametros(puntosOriginales) {
    const o = ojos(puntosOriginales);
    const dio = dist(o.derecho, o.izquierdo);
    const ang = Math.atan2(o.izquierdo.y - o.derecho.y, o.izquierdo.x - o.derecho.x);
    const centro = puntoMedio(o.derecho, o.izquierdo);
    const cos = Math.cos(-ang), sin = Math.sin(-ang);
    // Puntos alineados (ojos horizontales) y escalados: DIO = 1
    const p = puntosOriginales.map((q) => {
      const x = q.x - centro.x, y = q.y - centro.y;
      return { x: (x * cos - y * sin) / dio, y: (x * sin + y * cos) / dio };
    });
    const oj = ojos(p);
    const dy = (a, b) => Math.abs(p[b].y - p[a].y);

    const anchoOjoD = dist(p[36], p[39]);
    const anchoOjoI = dist(p[42], p[45]);
    const altoOjoD = (dist(p[37], p[41]) + dist(p[38], p[40])) / 2;
    const altoOjoI = (dist(p[43], p[47]) + dist(p[44], p[46])) / 2;
    const cejaD = media(p.slice(17, 22)), cejaI = media(p.slice(22, 27));
    const cejaOjo = ((oj.derecho.y - cejaD.y) + (oj.izquierdo.y - cejaI.y)) / 2;

    const nasion = p[27], baseNariz = p[33], menton = p[8];
    const alturaFacial = menton.y - nasion.y;
    const anchoFacial = dist(p[0], p[16]);
    const anchoMandibula = dist(p[4], p[12]);
    const lineaCejas = (cejaD.y + cejaI.y) / 2;
    const centroBoca = puntoMedio(p[51], p[57]);

    // Asimetría: pares simétricos respecto de la línea media (27–8)
    const pares = [[0, 16], [2, 14], [4, 12], [6, 10], [17, 26], [19, 24], [21, 22], [36, 45], [39, 42], [31, 35], [48, 54]];
    const ejeX = (nasion.x + menton.x) / 2;
    let asim = 0;
    for (const [a, b] of pares) {
      asim += Math.abs(Math.abs(p[a].x - ejeX) - Math.abs(p[b].x - ejeX)) + Math.abs(p[a].y - p[b].y);
    }
    asim = (asim / pares.length) * 100;

    // Pose (estimaciones aproximadas)
    const dIzq = Math.abs(p[30].x - p[0].x), dDer = Math.abs(p[16].x - p[30].x);
    const giro = (dDer - dIzq) / (dDer + dIzq);                   // -1..1: giro horizontal (yaw)
    const cabeceo = (p[30].y - 0) / (alturaFacial || 1);           // posición de la punta nasal bajo la línea de ojos

    const valores = {
      dioPx: dio,
      anchoOjos: (anchoOjoD + anchoOjoI) / 2,
      intercantal: dist(p[39], p[42]),
      biocular: dist(p[36], p[45]),
      aperturaOjos: (altoOjoD / anchoOjoD + altoOjoI / anchoOjoI) / 2,
      cejaOjo,
      anchoNariz: dist(p[31], p[35]),
      largoNariz: dy(27, 33),
      indiceNasal: dist(p[31], p[35]) / dy(27, 33),
      posNariz: (baseNariz.y - nasion.y) / alturaFacial,
      anchoBoca: dist(p[48], p[54]),
      grosorLabios: dist(p[51], p[62]) + dist(p[66], p[57]),
      narizBoca: p[51].y - baseNariz.y,
      posBoca: (centroBoca.y - nasion.y) / alturaFacial,
      bocaMenton: menton.y - p[57].y,
      anguloMenton: angulo(p[6], p[8], p[10]),
      alturaFacial,
      anchoFacial,
      anchoMandibula,
      indiceFacial: alturaFacial / anchoFacial,
      indiceMandibular: anchoMandibula / anchoFacial,
      anguloGonial: (angulo(p[1], p[4], p[7]) + angulo(p[15], p[12], p[9])) / 2,
      tercios: (baseNariz.y - lineaCejas) / (menton.y - baseNariz.y),
      asimetria: asim,
    };
    valores.formaRostro = clasificarForma(valores.indiceFacial, valores.indiceMandibular, valores.anguloMenton);

    const aberturaBoca = dist(p[62], p[66]);
    return {
      valores,
      pose: { roll: grados(ang), giro, cabeceo, bocaAbierta: aberturaBoca > 0.12 },
    };
  }

  /* ------------------------------------------------------------------ */
  /* Imagen del rostro con puntos para el reporte                        */
  /* ------------------------------------------------------------------ */
  function miniaturaRostro(lienzo, resultado, tam = 280) {
    const caja = resultado.detection.box;
    const margen = Math.max(caja.width, caja.height) * 0.25;
    const lado = Math.max(caja.width, caja.height) + margen * 2;
    const x0 = caja.x + caja.width / 2 - lado / 2;
    const y0 = caja.y + caja.height / 2 - lado / 2;
    const c = document.createElement('canvas');
    c.width = c.height = tam;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, tam, tam);
    ctx.drawImage(lienzo, x0, y0, lado, lado, 0, 0, tam, tam);
    const esc = tam / lado;
    const pts = resultado.landmarks.positions.map((q) => ({ x: (q.x - x0) * esc, y: (q.y - y0) * esc }));
    const tramos = [[0, 16], [17, 21], [22, 26], [27, 30], [31, 35], [36, 41, true], [42, 47, true], [48, 59, true], [60, 67, true]];
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(0, 220, 180, 0.85)';
    for (const [a, b, cerrar] of tramos) {
      ctx.beginPath();
      ctx.moveTo(pts[a].x, pts[a].y);
      for (let i = a + 1; i <= b; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (cerrar) ctx.closePath();
      ctx.stroke();
    }
    ctx.fillStyle = '#ffd400';
    for (const q of pts) { ctx.beginPath(); ctx.arc(q.x, q.y, 1.6, 0, Math.PI * 2); ctx.fill(); }
    // Línea interpupilar
    const o = ojos(pts);
    ctx.strokeStyle = 'rgba(255, 80, 80, 0.9)';
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(o.derecho.x, o.derecho.y); ctx.lineTo(o.izquierdo.x, o.izquierdo.y); ctx.stroke();
    return c.toDataURL('image/jpeg', 0.9);
  }

  /* ------------------------------------------------------------------ */
  /* Análisis completo de un rostro elegido                              */
  /* ------------------------------------------------------------------ */
  const EXPRESIONES = { neutral: 'Neutral', happy: 'Alegría', sad: 'Tristeza', angry: 'Enojo', fearful: 'Miedo', disgusted: 'Desagrado', surprised: 'Sorpresa' };

  /* ------------------------------------------------------------------ */
  /* Aumentación en tiempo de prueba (TTA)                               */
  /* ------------------------------------------------------------------ */
  function recortarRostro(lienzo, caja, factor = 1.8) {
    const lado = Math.round(Math.max(caja.width, caja.height) * factor);
    const c = document.createElement('canvas');
    c.width = c.height = Math.max(lado, 160);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, c.width, c.height);
    const x0 = caja.x + caja.width / 2 - lado / 2, y0 = caja.y + caja.height / 2 - lado / 2;
    ctx.drawImage(lienzo, x0, y0, lado, lado, 0, 0, c.width, c.height);
    return c;
  }

  function voltear(c) {
    const v = document.createElement('canvas');
    v.width = c.width; v.height = c.height;
    const ctx = v.getContext('2d');
    ctx.translate(c.width, 0); ctx.scale(-1, 1);
    ctx.drawImage(c, 0, 0);
    return v;
  }

  // Ecualización de histograma de la luminancia: compensa iluminación pobre o dispareja
  function ecualizar(c) {
    const v = document.createElement('canvas');
    v.width = c.width; v.height = c.height;
    const ctx = v.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(c, 0, 0);
    const im = ctx.getImageData(0, 0, v.width, v.height);
    const d = im.data, n = d.length / 4;
    const hist = new Uint32Array(256), lum = new Uint8Array(n);
    for (let i = 0; i < n; i++) { lum[i] = Math.round(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]); hist[lum[i]]++; }
    const cdf = new Float32Array(256);
    let acum = 0;
    for (let i = 0; i < 256; i++) { acum += hist[i]; cdf[i] = acum / n; }
    for (let i = 0; i < n; i++) {
      const y = lum[i] || 1, nuevo = cdf[lum[i]] * 255, f = nuevo / y;
      d[i * 4] = Math.min(255, d[i * 4] * f); d[i * 4 + 1] = Math.min(255, d[i * 4 + 1] * f); d[i * 4 + 2] = Math.min(255, d[i * 4 + 2] * f);
    }
    ctx.putImageData(im, 0, 0);
    return v;
  }

  async function descriptoresAumentados(lienzo, resultado) {
    const base = recortarRostro(lienzo, resultado.detection.box);
    const eq = ecualizar(base);
    const variantes = [voltear(base), eq, voltear(eq)];
    const lista = [resultado.descriptor];
    for (const v of variantes) {
      const r = await faceapi.detectSingleFace(v, OPCIONES_SSD()).withFaceLandmarks().withFaceDescriptor();
      if (r) lista.push(r.descriptor);
    }
    const promedio = new Float32Array(lista[0].length);
    for (const d of lista) for (let i = 0; i < d.length; i++) promedio[i] += d[i] / lista.length;
    return { promedio, lista };
  }

  /* ------------------------------------------------------------------ */
  /* Puntaje de calidad (inspirado en ISO/IEC 29794-5 y 19794-5)         */
  /* ------------------------------------------------------------------ */
  function evaluarCalidad({ dioPx, calidad, giro, roll, confianza, neutral, bocaAbierta }) {
    const f = [
      { clave: 'resolucion', nombre: 'Resolución (distancia interpupilar)', valor: `${dioPx.toFixed(0)} px`, puntaje: limitar((dioPx - 18) / (60 - 18), 0, 1), peso: 1.4 },
      { clave: 'nitidez', nombre: 'Nitidez / enfoque', valor: calidad.nitidez.toFixed(0), puntaje: limitar((calidad.nitidez - 8) / (90 - 8), 0, 1), peso: 1.2 },
      { clave: 'iluminacion', nombre: 'Iluminación', valor: `${calidad.brillo.toFixed(0)}/255`, puntaje: 1 - limitar((Math.abs(calidad.brillo - 125) - 45) / 70, 0, 1), peso: 0.8 },
      { clave: 'contraste', nombre: 'Contraste', valor: calidad.contraste.toFixed(0), puntaje: limitar((calidad.contraste - 12) / (42 - 12), 0, 1), peso: 0.7 },
      { clave: 'pose', nombre: 'Pose frontal (giro)', valor: giro.toFixed(2), puntaje: limitar(1 - (Math.abs(giro) - 0.08) / 0.5, 0, 1), peso: 1.2 },
      { clave: 'inclinacion', nombre: 'Inclinación lateral', valor: `${roll.toFixed(0)}°`, puntaje: limitar(1 - (Math.abs(roll) - 10) / 35, 0, 1), peso: 0.3 },
      { clave: 'expresion', nombre: 'Expresión neutra', valor: `${(neutral * 100).toFixed(0)} %`, puntaje: limitar(0.5 + neutral * 0.5 - (bocaAbierta ? 0.2 : 0), 0, 1), peso: 0.5 },
      { clave: 'deteccion', nombre: 'Confianza de detección', valor: `${(confianza * 100).toFixed(0)} %`, puntaje: limitar((confianza - 0.4) / 0.55, 0, 1), peso: 0.6 },
    ];
    const sumaPesos = f.reduce((s, x) => s + x.peso, 0);
    const mediaPonderada = f.reduce((s, x) => s + x.peso * x.puntaje, 0) / sumaPesos;
    const minimo = Math.min(...f.filter((x) => x.peso >= 1).map((x) => x.puntaje));
    const puntaje = 100 * (0.7 * mediaPonderada + 0.3 * minimo);
    const nivel = puntaje >= 75 ? 'Buena' : puntaje >= 50 ? 'Aceptable' : puntaje >= 30 ? 'Deficiente' : 'Muy deficiente';
    return { puntaje, nivel, factores: f };
  }

  async function analizarRostro(imagen, deteccion, opciones = {}) {
    const { resultado, lienzo, roll, corregido } = await enderezar(imagen.canvas, deteccion);
    const { valores, pose } = extraerParametros(resultado.landmarks.positions);
    valores.dioPx = valores.dioPx / imagen.escala; // en píxeles de la imagen original
    const caja = resultado.detection.box;
    const calidad = medirCalidad(lienzo, caja);
    const expr = Object.entries(resultado.expressions).sort((a, b) => b[1] - a[1])[0];
    const tamRostro = Math.round(deteccion.detection.box.width / imagen.escala);
    const tta = opciones.sinTTA ? { promedio: resultado.descriptor, lista: [resultado.descriptor] } : await descriptoresAumentados(lienzo, resultado);
    const puntajeCalidad = evaluarCalidad({
      dioPx: valores.dioPx, calidad, giro: pose.giro, roll,
      confianza: deteccion.detection.score, neutral: resultado.expressions.neutral || 0, bocaAbierta: pose.bocaAbierta,
    });

    const avisos = [];
    if (tamRostro < 90) avisos.push(`Rostro pequeño (${tamRostro}px de ancho): la precisión disminuye.`);
    if (calidad.nitidez < 25) avisos.push('Imagen poco nítida o desenfocada.');
    if (calidad.brillo < 60) avisos.push('Iluminación insuficiente (rostro oscuro).');
    if (calidad.brillo > 205) avisos.push('Rostro sobreexpuesto.');
    if (calidad.contraste < 25) avisos.push('Contraste bajo.');
    if (Math.abs(pose.giro) > 0.25) avisos.push('Rostro girado lateralmente: las medidas horizontales pierden fiabilidad.');
    if (pose.bocaAbierta) avisos.push('Boca abierta: se afectan las medidas de boca y mentón.');
    if (expr[0] !== 'neutral' && expr[1] > 0.6) avisos.push(`Expresión no neutra (${EXPRESIONES[expr[0]]}).`);
    if (deteccion.detection.score < 0.7) avisos.push('Detección con confianza moderada.');

    return {
      descriptor: tta.promedio,
      descriptores: tta.lista,
      valores,
      pose: { ...pose, roll },
      rollCorregido: corregido,
      confianza: deteccion.detection.score,
      tamRostro,
      calidad,
      puntajeCalidad,
      edad: resultado.age,
      genero: resultado.gender === 'male' ? 'Masculino' : 'Femenino',
      probGenero: resultado.genderProbability,
      expresion: EXPRESIONES[expr[0]] || expr[0],
      probExpresion: expr[1],
      miniatura: opciones.sinMiniatura ? null : miniaturaRostro(lienzo, resultado),
      avisos,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Comparación                                                         */
  /* ------------------------------------------------------------------ */
  function similitudDescriptor(d) {
    // Curva logística centrada en el umbral de error igual medido empíricamente (d ≈ 0,62 → 50 %).
    return 100 / (1 + Math.exp((d - 0.62) / 0.06));
  }

  function compararParametros(a, b) {
    return DEFINICIONES.map((def) => {
      const va = a.valores[def.clave], vb = b.valores[def.clave];
      const fila = { ...def, valorA: va, valorB: vb };
      if (def.comparable === false) return { ...fila, similitud: null };
      if (def.categorica) return { ...fila, similitud: va === vb ? 100 : 40, diferencia: va === vb ? 'Igual' : 'Distinta' };
      const escala = def.absoluta ? Math.max(def.absoluta, (Math.abs(va) + Math.abs(vb)) / 2) : (Math.abs(va) + Math.abs(vb)) / 2;
      const rel = Math.abs(va - vb) / (escala || 1);
      const sim = 100 * Math.exp(-((rel / (2 * def.tol)) ** 2));
      return { ...fila, diferencia: rel * 100, similitud: sim };
    });
  }

  function comparar(a, b, umbral) {
    const distancia = faceapi.euclideanDistance(a.descriptor, b.descriptor);
    let punto = 0, na = 0, nb = 0;
    for (let i = 0; i < a.descriptor.length; i++) { punto += a.descriptor[i] * b.descriptor[i]; na += a.descriptor[i] ** 2; nb += b.descriptor[i] ** 2; }
    const coseno = punto / Math.sqrt(na * nb);
    const simDescriptor = similitudDescriptor(distancia);

    const parametros = compararParametros(a, b);
    const comparables = parametros.filter((p) => p.similitud !== null);
    // Si la pose difiere mucho, se atenúa el peso de medidas horizontales dependientes del giro
    const difGiro = Math.abs(a.pose.giro - b.pose.giro);
    let sumaP = 0, sumaS = 0;
    for (const p of comparables) {
      let peso = p.peso;
      if (difGiro > 0.2 && ['anchoFacial', 'anchoMandibula', 'asimetria', 'indiceFacial'].includes(p.clave)) peso *= 0.5;
      sumaP += peso; sumaS += peso * p.similitud;
    }
    const simGeometria = sumaS / sumaP;

    const difEdad = Math.abs(a.edad - b.edad);
    const simEdad = 100 * Math.exp(-((difEdad / 14) ** 2));
    const simGenero = a.genero === b.genero ? 100 : 100 * (1 - Math.min(a.probGenero, b.probGenero));
    const simDemografia = (simEdad + simGenero) / 2;

    const total = PESOS_GLOBALES.descriptor * simDescriptor + PESOS_GLOBALES.geometria * simGeometria + PESOS_GLOBALES.demografia * simDemografia;

    let veredicto, nivel;
    if (total >= Math.min(95, umbral + 20)) { veredicto = 'Alta probabilidad de que sean la MISMA PERSONA'; nivel = 'alta'; }
    else if (total >= umbral) { veredicto = 'Probablemente se trata de la MISMA PERSONA'; nivel = 'media'; }
    else if (total >= umbral - 15) { veredicto = 'Resultado NO CONCLUYENTE'; nivel = 'dudosa'; }
    else { veredicto = 'Probablemente se trata de PERSONAS DISTINTAS'; nivel = 'baja'; }

    const avisos = [];
    if (difGiro > 0.2) avisos.push('Las fotos tienen orientaciones de cabeza muy distintas; las medidas geométricas son menos fiables.');
    if (difEdad > 15) avisos.push(`Diferencia de edad estimada de ${difEdad.toFixed(0)} años: puede deberse a fotos de épocas distintas.`);
    const coincideDescriptor = distancia < 0.6;
    if (coincideDescriptor !== (total >= umbral)) {
      avisos.push('El descriptor biométrico y el porcentaje global discrepan respecto del umbral; se recomienda revisión pericial.');
    }

    return {
      distancia, coseno, simDescriptor, simGeometria, simEdad, simGenero, simDemografia, difEdad,
      total, umbral, veredicto, nivel, coincideDescriptor, parametros, avisos,
      pesos: PESOS_GLOBALES,
    };
  }

  window.AnalisisFacial = { prepararArchivo, detectarRostros, detectarConRespaldo, analizarRostro, comparar, compararParametros, similitudDescriptor, DEFINICIONES };
})();
