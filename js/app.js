/* Interfaz de usuario del comparador de rostros. */
(function () {
  'use strict';

  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const estado = { modelosListos: false, backend: '', fotos: { 1: null, 2: null }, panelActivo: 1, ultimo: null, modo: 'auto', calibracion: null };
  const paneles = { 1: $('.panel[data-foto="1"]'), 2: $('.panel[data-foto="2"]') };

  /* ---------------- Utilidades de UI ---------------- */
  let temporizadorToast;
  function aviso(mensaje, tipo = 'error') {
    const t = $('#toast');
    t.textContent = mensaje;
    t.className = `toast ${tipo}`;
    t.hidden = false;
    clearTimeout(temporizadorToast);
    temporizadorToast = setTimeout(() => { t.hidden = true; }, 6000);
  }

  const fmt = (v, d = 2) => v.toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d });
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const colorSim = (s) => (s >= 80 ? 'var(--verde)' : s >= 60 ? 'var(--oliva)' : s >= 40 ? 'var(--ambar)' : 'var(--rojo)');

  function actualizarBoton() {
    const f1 = estado.fotos[1], f2 = estado.fotos[2];
    $('#btn-comparar').disabled = !(estado.modelosListos && f1 && f2 && f1.rostros && f2.rostros && f1.rostros.length && f2.rostros.length);
  }

  /* ---------------- Carga de modelos ---------------- */
  async function iniciar() {
    const barra = $('#progreso-modelos');
    const texto = $('#estado-modelos .estado-texto');
    try {
      estado.backend = await CargadorModelos.cargarModelos((p) => { barra.style.width = `${Math.round(p * 100)}%`; });
      estado.modelosListos = true;
      $('#btn-calibrar').disabled = !archivosCal.length;
      texto.textContent = `Modelos listos (motor: ${estado.backend === 'webgl' ? 'aceleración GPU / WebGL' : 'CPU'}). Carga dos fotografías para comenzar.`;
      $('#estado-modelos').classList.add('listo');
      // Procesar imágenes que se hayan cargado antes de terminar los modelos
      for (const n of [1, 2]) if (estado.fotos[n] && !estado.fotos[n].rostros) await detectar(n);
    } catch (e) {
      console.error(e);
      texto.textContent = `Error al cargar los modelos: ${e.message}`;
      $('#estado-modelos').classList.add('error');
    }
    actualizarBoton();
  }

  /* ---------------- Carga de imágenes ---------------- */
  async function cargarArchivo(n, archivo) {
    if (!archivo) return;
    const panel = paneles[n];
    panel.classList.add('ocupado');
    try {
      const img = await AnalisisFacial.prepararArchivo(archivo);
      img.rostros = null;
      img.seleccion = 0;
      img.analisis = {};
      estado.fotos[n] = img;
      $('#resultado').hidden = true;
      dibujarVista(n);
      mostrarInfo(n);
      if (estado.modelosListos) await detectar(n);
    } catch (e) {
      aviso(e.message);
    } finally {
      panel.classList.remove('ocupado');
      actualizarBoton();
    }
  }

  async function detectar(n) {
    const img = estado.fotos[n];
    const panel = paneles[n];
    panel.classList.add('ocupado');
    try {
      img.rostros = await AnalisisFacial.detectarConRespaldo(img);
      if (!img.rostros.length) aviso(`No se detectó ningún rostro en la Foto ${n}. Prueba con una imagen más nítida, frontal y bien iluminada.`);
    } catch (e) {
      console.error(e);
      img.rostros = [];
      aviso(`Error al analizar la Foto ${n}: ${e.message}`);
    } finally {
      panel.classList.remove('ocupado');
    }
    dibujarVista(n);
    mostrarInfo(n);
    actualizarBoton();
  }

  function dibujarVista(n) {
    const img = estado.fotos[n];
    const panel = paneles[n];
    const lienzo = $('.vista', panel);
    lienzo.width = img.canvas.width;
    lienzo.height = img.canvas.height;
    const ctx = lienzo.getContext('2d');
    ctx.drawImage(img.canvas, 0, 0);
    const grosor = Math.max(2, Math.round(Math.max(lienzo.width, lienzo.height) / 300));
    (img.rostros || []).forEach((r, i) => {
      const b = r.detection.box;
      const elegido = i === img.seleccion;
      ctx.lineWidth = elegido ? grosor * 1.6 : grosor;
      ctx.strokeStyle = elegido ? '#00d4a0' : 'rgba(255,255,255,0.8)';
      ctx.setLineDash(elegido ? [] : [grosor * 3, grosor * 2]);
      ctx.strokeRect(b.x, b.y, b.width, b.height);
      if (img.rostros.length > 1) {
        const tam = Math.max(16, grosor * 8);
        ctx.setLineDash([]);
        ctx.fillStyle = elegido ? '#00d4a0' : 'rgba(0,0,0,0.65)';
        ctx.fillRect(b.x, b.y - tam, tam * 1.3, tam);
        ctx.fillStyle = elegido ? '#00241b' : '#fff';
        ctx.font = `bold ${Math.round(tam * 0.75)}px sans-serif`;
        ctx.fillText(String(i + 1), b.x + tam * 0.3, b.y - tam * 0.22);
      }
      if (elegido) {
        ctx.fillStyle = '#ffd400';
        for (const p of r.landmarks.positions) { ctx.beginPath(); ctx.arc(p.x, p.y, grosor * 0.7, 0, Math.PI * 2); ctx.fill(); }
      }
    });
    lienzo.hidden = false;
    $('.zona-vacia', panel).hidden = true;
    $('.zona-carga', panel).classList.add('con-imagen');
  }

  function mostrarInfo(n) {
    const img = estado.fotos[n];
    const panel = paneles[n];
    const info = $('.info-archivo', panel);
    const tam = img.bytes > 1048576 ? `${fmt(img.bytes / 1048576)} MB` : `${fmt(img.bytes / 1024, 1)} KB`;
    let rostros = '<span class="etiqueta gris">Detectando rostros…</span>';
    if (img.rostros) {
      rostros = img.rostros.length
        ? `<span class="etiqueta verde">${img.rostros.length} rostro${img.rostros.length > 1 ? 's' : ''} detectado${img.rostros.length > 1 ? 's' : ''}</span>`
        : '<span class="etiqueta roja">Sin rostros detectados</span>';
    } else if (!estado.modelosListos) {
      rostros = '<span class="etiqueta gris">Esperando modelos…</span>';
    }
    info.innerHTML = `
      <div class="nombre" title="${esc(img.nombre)}">${esc(img.nombre)}</div>
      <div class="datos">${img.anchoOriginal} × ${img.altoOriginal} px · ${tam} ${rostros}</div>
      <button type="button" class="btn pequeno" data-cambiar>Cambiar imagen</button>`;
    info.hidden = false;
    $('[data-cambiar]', info).onclick = () => $('input[type=file]', panel).click();

    const selector = $('.selector-rostros', panel);
    if (img.rostros && img.rostros.length > 1) {
      selector.innerHTML = '<span>Rostro a comparar:</span>' + img.rostros.map((_, i) =>
        `<button type="button" class="chip ${i === img.seleccion ? 'activo' : ''}" data-rostro="${i}">${i + 1}</button>`).join('') +
        '<small>También puedes hacer clic sobre el rostro en la imagen.</small>';
      selector.hidden = false;
      selector.querySelectorAll('[data-rostro]').forEach((b) => { b.onclick = () => seleccionarRostro(n, +b.dataset.rostro); });
    } else {
      selector.hidden = true;
    }
  }

  function seleccionarRostro(n, i) {
    const img = estado.fotos[n];
    if (!img || !img.rostros || i === img.seleccion) return;
    img.seleccion = i;
    $('#resultado').hidden = true;
    dibujarVista(n);
    mostrarInfo(n);
  }

  function configurarPanel(n) {
    const panel = paneles[n];
    const zona = $('.zona-carga', panel);
    const entrada = $('input[type=file]', panel);
    const lienzo = $('.vista', panel);

    entrada.addEventListener('change', () => { cargarArchivo(n, entrada.files[0]); entrada.value = ''; });
    zona.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); entrada.click(); } });
    panel.addEventListener('pointerdown', () => { estado.panelActivo = n; });
    ['dragenter', 'dragover'].forEach((ev) => zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add('arrastrando'); }));
    ['dragleave', 'drop'].forEach((ev) => zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.remove('arrastrando'); }));
    zona.addEventListener('drop', (e) => {
      const archivos = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
      if (!archivos.length) return aviso('Suelta un archivo de imagen.');
      cargarArchivo(n, archivos[0]);
      // Si se sueltan dos imágenes a la vez, la segunda va al otro panel
      if (archivos[1]) cargarArchivo(n === 1 ? 2 : 1, archivos[1]);
    });

    // Clic en la vista: elegir rostro (sin abrir el selector de archivos)
    lienzo.addEventListener('click', (e) => {
      e.preventDefault();
      const img = estado.fotos[n];
      if (!img || !img.rostros || !img.rostros.length) return;
      const r = lienzo.getBoundingClientRect();
      const x = (e.clientX - r.left) * (lienzo.width / r.width);
      const y = (e.clientY - r.top) * (lienzo.height / r.height);
      const i = img.rostros.findIndex((f) => {
        const b = f.detection.box;
        return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
      });
      if (i >= 0) seleccionarRostro(n, i);
    });
  }

  document.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith('image/'));
    if (!item) return;
    const archivo = item.getAsFile();
    const nombre = new File([archivo], `imagen-pegada-${Date.now()}.${(archivo.type.split('/')[1] || 'png')}`, { type: archivo.type, lastModified: Date.now() });
    const destino = !estado.fotos[1] ? 1 : !estado.fotos[2] ? 2 : estado.panelActivo;
    cargarArchivo(destino, nombre);
  });

  /* ---------------- Comparación ---------------- */
  async function obtenerAnalisis(n) {
    const img = estado.fotos[n];
    if (!img.analisis[img.seleccion]) {
      img.analisis[img.seleccion] = await AnalisisFacial.analizarRostro(img, img.rostros[img.seleccion]);
    }
    return img.analisis[img.seleccion];
  }

  async function comparar() {
    const boton = $('#btn-comparar');
    boton.disabled = true;
    boton.classList.add('cargando');
    boton.textContent = 'Analizando…';
    try {
      const r1 = await obtenerAnalisis(1);
      const r2 = await obtenerAnalisis(2);
      const umbral = +$('#umbral').value;
      const res = AnalisisFacial.comparar(r1, r2, umbral);
      const aut = ModeloCerteza.evaluar(res, r1, r2, estado.calibracion);
      estado.ultimo = { img1: estado.fotos[1], img2: estado.fotos[2], r1, r2, res, aut, modo: estado.modo, backend: estado.backend };
      mostrarResultado(estado.ultimo, true);
    } catch (e) {
      console.error(e);
      aviso(`No se pudo completar la comparación: ${e.message}`);
    } finally {
      boton.classList.remove('cargando');
      boton.textContent = 'Comparar rostros';
      actualizarBoton();
    }
  }

  const fmtLR = (l10) => {
    const lr = 10 ** Math.abs(l10);
    const txt = lr >= 1e6 ? '> 1.000.000' : lr >= 100 ? Math.round(lr).toLocaleString('es-CL') : fmt(lr, 1);
    return l10 >= 0 ? txt : `1/${txt}`;
  };
  const colorQ = (q) => (q >= 75 ? 'var(--verde)' : q >= 50 ? 'var(--oliva)' : q >= 30 ? 'var(--ambar)' : 'var(--rojo)');

  function htmlCerteza({ r1, r2, res, aut }) {
    const u = aut.umbrales;
    const sObs = res.simDescriptor;
    const pos = (v) => Math.max(0, Math.min(100, v));
    const calidad = (r, n) => `
      <details class="calidad-foto">
        <summary><span>Calidad foto ${n}</span><span class="barra"><span style="width:${r.puntajeCalidad.puntaje.toFixed(0)}%;background:${colorQ(r.puntajeCalidad.puntaje)}"></span></span><b style="color:${colorQ(r.puntajeCalidad.puntaje)}">${r.puntajeCalidad.puntaje.toFixed(0)}/100 · ${r.puntajeCalidad.nivel}</b></summary>
        <table>${r.puntajeCalidad.factores.map((f) => `<tr><td>${esc(f.nombre)}</td><td>${esc(f.valor)}</td><td><span class="barra mini"><span style="width:${(f.puntaje * 100).toFixed(0)}%;background:${colorQ(f.puntaje * 100)}"></span></span>${(f.puntaje * 100).toFixed(0)}</td></tr>`).join('')}</table>
      </details>`;
    const zonaRoja = pos(u.exclusion.similitud), zonaVerde = pos(u.coincidencia.similitud);
    return `
      <h3>Certeza estadística y umbral automático</h3>
      <div class="certeza-grid">
        <div class="certeza-calidad">
          ${calidad(r1, 1)}
          ${calidad(r2, 2)}
          <p class="nota-mini">Calidad del par: <b>${(aut.q * 100).toFixed(0)}/100</b>. ${esc(aut.P.fuente)}.</p>
        </div>
        <div class="certeza-datos">
          <div class="dato"><small>Razón de verosimilitud (LR)</small><b>${fmtLR(aut.log10lr)}</b><span>${esc(aut.verbal.texto)}</span></div>
          ${aut.log10lr >= 0
            ? `<div class="dato"><small>Riesgo de falsa coincidencia</small><b>${aut.formatoRazon(aut.fmrObservada)}</b><span>pares de personas distintas alcanzarían una similitud igual o mayor</span></div>`
            : `<div class="dato"><small>Riesgo de que sí sea la misma persona</small><b>${aut.formatoRazon(aut.fnmrObservada)}</b><span>pares de la misma persona tendrían una similitud igual o menor</span></div>`}
          ${aut.estabilidad ? `<div class="dato"><small>Estabilidad de la medición</small><b>${fmt(AnalisisFacial.similitudDescriptor(aut.estabilidad.dMax), 1)}–${fmt(AnalisisFacial.similitudDescriptor(aut.estabilidad.dMin), 1)} %</b><span>${aut.estabilidad.cruzaUmbral ? 'la similitud cruza el umbral según la variante de imagen: resultado inestable' : 'rango de similitud entre variantes (original, espejo, ecualizada): resultado estable'}</span></div>` : ''}
        </div>
      </div>

      <div class="zonas">
        <div class="zonas-titulo">Similitud biométrica observada: <b>${fmt(sObs, 1)} %</b> · zonas de decisión para esta calidad de imagen</div>
        <div class="zonas-barra">
          <span class="z-roja" style="width:${zonaRoja}%"></span>
          <span class="z-ambar" style="width:${Math.max(0, zonaVerde - zonaRoja)}%"></span>
          <span class="z-verde" style="width:${100 - zonaVerde}%"></span>
          <i class="marcador" style="left:${pos(sObs)}%"></i>
        </div>
        <div class="zonas-leyenda">
          <span><i class="z-roja"></i>Personas distintas &lt; ${fmt(u.exclusion.similitud, 1)} %</span>
          <span><i class="z-ambar"></i>No concluyente</span>
          <span><i class="z-verde"></i>Misma persona ≥ ${fmt(u.coincidencia.similitud, 1)} %</span>
        </div>
      </div>

      <h4>¿Con qué porcentaje de similitud puedo tener certeza? <small>(para fotos de esta calidad)</small></h4>
      <div class="tabla-envoltorio">
        <table class="tabla-parametros tabla-puntos">
          <thead><tr><th>Similitud biométrica mínima exigida</th><th>Riesgo de aceptar a una persona distinta</th><th>Riesgo de rechazar a la misma persona</th></tr></thead>
          <tbody>${aut.puntos.map((p) => `<tr class="${sObs >= p.similitud ? 'cumple' : ''}"><td><b>≥ ${fmt(p.similitud, 1)} %</b> <small>distancia ≤ ${fmt(p.distancia, 3)}</small></td><td>${aut.formatoRazon(p.fmr)}</td><td>${fmt(p.fnmr * 100, 1)} %</td></tr>`).join('')}</tbody>
        </table>
      </div>
      <p class="nota-mini">Las filas marcadas son los niveles de exigencia que esta comparación <b>sí</b> supera.</p>`;
  }

  function mostrarResultado({ r1, r2, res, aut }, desplazar) {
    const seccion = $('#resultado');
    const auto = estado.modo === 'auto';
    seccion.hidden = false;
    seccion.dataset.nivel = auto ? aut.nivel : res.nivel;
    const valorMedidor = auto ? aut.certeza * 100 : res.total;
    const arco = $('#medidor-arco');
    const circ = 2 * Math.PI * 52;
    arco.style.strokeDasharray = `${circ}`;
    arco.style.strokeDashoffset = `${circ}`;
    requestAnimationFrame(() => { arco.style.strokeDashoffset = `${circ * (1 - valorMedidor / 100)}`; });
    const decimales = auto && (valorMedidor > 99 || valorMedidor < 1) ? 2 : 1;
    $('#porcentaje').textContent = `${fmt(Math.min(99.99, Math.max(0.01, valorMedidor)), decimales)}%`;
    if (!auto) $('#porcentaje').textContent = `${fmt(res.total, 1)}%`;
    $('#medidor-etiqueta').textContent = auto ? 'certeza' : 'similitud';
    $('#porcentaje').classList.toggle('largo', $('#porcentaje').textContent.length > 5);
    $('#veredicto').textContent = auto ? aut.veredicto : res.veredicto;
    $('#detalle-veredicto').innerHTML = auto
      ? `${esc(aut.verbal.texto)} · LR = <b>${fmtLR(aut.log10lr)}</b> · Similitud global <b>${fmt(res.total, 1)} %</b> · Umbral automático: similitud biométrica ≥ <b>${fmt(aut.umbrales.coincidencia.similitud, 1)} %</b> (calidad del par ${(aut.q * 100).toFixed(0)}/100)`
      : `Umbral: <b>${res.umbral} %</b> · Distancia biométrica: <b>${fmt(res.distancia, 3)}</b> (${res.coincideDescriptor ? 'coincide' : 'no coincide'} según el criterio estándar &lt; 0,60) · Modo automático diría: <b>${esc(aut.veredicto.toLowerCase())}</b>`;
    const avisos = [...(auto ? aut.avisos : []), ...res.avisos, ...r1.avisos.map((a) => `Foto 1: ${a}`), ...r2.avisos.map((a) => `Foto 2: ${a}`)];
    $('#avisos-resultado').innerHTML = avisos.map((a) => `<li>${esc(a)}</li>`).join('');
    $('#bloque-certeza').innerHTML = htmlCerteza({ r1, r2, res, aut });

    const comp = [
      ['Descriptor biométrico', res.simDescriptor, res.pesos.descriptor, 'Red neuronal de 128 dimensiones'],
      ['Geometría facial', res.simGeometria, res.pesos.geometria, `${res.parametros.filter((p) => p.similitud !== null).length} parámetros antropométricos`],
      ['Edad y sexo estimados', res.simDemografia, res.pesos.demografia, `${Math.round(r1.edad)} vs ${Math.round(r2.edad)} años · ${r1.genero} / ${r2.genero}`],
    ];
    $('#componentes').innerHTML = comp.map(([nombre, s, peso, det]) => `
      <div class="componente">
        <div class="componente-cab"><b>${nombre}</b><span>peso ${Math.round(peso * 100)} %</span></div>
        <div class="barra"><span style="width:${s.toFixed(1)}%;background:${colorSim(s)}"></span></div>
        <div class="componente-pie"><small>${esc(det)}</small><b style="color:${colorSim(s)}">${fmt(s, 1)} %</b></div>
      </div>`).join('');

    $('#rostros-analizados').innerHTML = [r1, r2].map((r, i) => `
      <figure>
        <img src="${r.miniatura}" alt="Rostro analizado de la foto ${i + 1}">
        <figcaption>Foto ${i + 1} · ${esc(r.valores.formaRostro)} · ${esc(r.expresion)}</figcaption>
      </figure>`).join('');

    const valor = (p, v) => (p.categorica ? esc(v) : p.unidad === '°' ? `${fmt(v, 1)}°` : p.unidad === 'px' ? `${fmt(v, 1)} px` : fmt(v, 3));
    $('#tabla-parametros').innerHTML = res.parametros.map((p) => `
      <tr>
        <td><span title="${esc(p.descripcion)}">${esc(p.nombre)}</span><small>${esc(p.grupo)}${p.unidad && !p.categorica ? ` · ${esc(p.unidad)}` : ''}</small></td>
        <td>${valor(p, p.valorA)}</td>
        <td>${valor(p, p.valorB)}</td>
        <td>${p.similitud === null ? '<small>Referencia</small>' : `<div class="barra mini"><span style="width:${p.similitud.toFixed(1)}%;background:${colorSim(p.similitud)}"></span></div><b style="color:${colorSim(p.similitud)}">${fmt(p.similitud, 0)} %</b>`}</td>
      </tr>`).join('');

    if (desplazar) seccion.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------------- Reporte ---------------- */
  function nombreReporte(ext) {
    const base = (n) => n.replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_').slice(0, 30);
    return `reporte_comparacion_${base(estado.ultimo.img1.nombre)}_vs_${base(estado.ultimo.img2.nombre)}.${ext}`;
  }

  const htmlReporte = () => GeneradorReporte.generarHTML(estado.ultimo);

  function descargarHTML() {
    if (!estado.ultimo) return;
    const blob = new Blob([htmlReporte()], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombreReporte('html');
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function cargarEnMarco() {
    const marco = $('#marco-reporte');
    return new Promise((resolver) => {
      marco.onload = () => resolver(marco);
      marco.srcdoc = htmlReporte();
    });
  }

  async function verReporte() {
    if (!estado.ultimo) return;
    const dialogo = $('#dialogo-reporte');
    if (!dialogo.open) dialogo.showModal();
    await cargarEnMarco();
  }

  async function imprimir() {
    if (!estado.ultimo) return;
    const dialogo = $('#dialogo-reporte');
    if (!dialogo.open) dialogo.showModal();
    const marco = await cargarEnMarco();
    marco.contentDocument.title = nombreReporte('pdf').replace(/\.pdf$/, '');
    marco.contentWindow.focus();
    marco.contentWindow.print();
  }

  function limpiar() {
    for (const n of [1, 2]) {
      estado.fotos[n] = null;
      const panel = paneles[n];
      $('.vista', panel).hidden = true;
      $('.zona-vacia', panel).hidden = false;
      $('.zona-carga', panel).classList.remove('con-imagen');
      $('.info-archivo', panel).hidden = true;
      $('.selector-rostros', panel).hidden = true;
    }
    estado.ultimo = null;
    $('#resultado').hidden = true;
    actualizarBoton();
  }

  /* ---------------- Modo de decisión ---------------- */
  function aplicarModo(modo) {
    estado.modo = modo;
    try { localStorage.setItem('comparador-rostros:modo', modo); } catch (e) { /* sin almacenamiento */ }
    document.querySelectorAll('input[name=modo]').forEach((r) => { r.checked = r.value === modo; });
    $('#panel-auto').hidden = modo !== 'auto';
    $('#panel-manual').hidden = modo === 'auto';
    if (estado.ultimo) { estado.ultimo.modo = modo; mostrarResultado(estado.ultimo, false); }
  }

  /* ---------------- Calibración propia ---------------- */
  let archivosCal = [];
  function etiquetaPersona(f) {
    const partes = (f.webkitRelativePath || '').split('/');
    if (partes.length >= 3) return partes[partes.length - 2];
    const base = f.name.replace(/\.[^.]+$/, '');
    const m = base.match(/^(.+?)[_\-\s]/);
    return (m ? m[1] : base).toLowerCase();
  }
  function mostrarEstadoCalibracion() {
    const c = estado.calibracion;
    $('#estado-calibracion').innerHTML = c
      ? `Usando <b>calibración propia</b>: ${c.personas} personas, ${c.nFotos} fotos (EER ${fmt(c.eer * 100, 1)} %).`
      : 'Usando el <b>modelo base</b> calibrado empíricamente por el programa. <a href="#seccion-calibracion" id="ir-calibracion">Calibrar con casos propios</a>';
    const enlace = $('#ir-calibracion');
    if (enlace) enlace.onclick = () => { $('#seccion-calibracion').open = true; };
    $('#cal-resultado').innerHTML = c ? htmlCalibracion(c) : '';
  }
  function htmlCalibracion(c) {
    const ancho = 520, alto = 120, x = (d) => ((d - 0.1) / 1.1) * ancho;
    const hist = (xs) => { const h = new Array(44).fill(0); for (const d of xs) h[Math.max(0, Math.min(43, Math.floor((d - 0.1) / 0.025)))]++; const m = Math.max(...h); return h.map((v) => v / (m || 1)); };
    const barras = (h, cls) => h.map((v, i) => `<rect class="${cls}" x="${(i * ancho) / 44}" y="${alto - v * (alto - 10)}" width="${ancho / 44 - 1}" height="${v * (alto - 10)}"/>`).join('');
    const hg = c.histograma ? hist(c.histograma.gen) : null, hi = c.histograma ? hist(c.histograma.imp) : null;
    return `
      <div class="cal-resumen">
        <div><small>Personas / fotos</small><b>${c.personas} / ${c.nFotos}</b></div>
        <div><small>Pares misma persona</small><b>${c.nGen}</b></div>
        <div><small>Pares distintas</small><b>${c.nImp}</b></div>
        <div><small>Error igual (EER)</small><b>${fmt(c.eer * 100, 1)} %</b></div>
        <div><small>Distancia misma persona</small><b>${fmt(c.mg, 3)} ± ${fmt(c.sg, 3)}</b></div>
        <div><small>Distancia distintas</small><b>${fmt(c.mi, 3)} ± ${fmt(c.si, 3)}</b></div>
      </div>
      <p class="nota-mini">Peso de esta calibración frente al modelo base: <b>${Math.round((c.nGen / (c.nGen + 30)) * 100)} %</b>${c.nGen < 30 ? ' (pocos pares de la misma persona: se combina con el modelo base para no sobreajustar; agrega más fotos por persona para aumentar su peso)' : ''}.</p>
      ${hg ? `<svg class="histograma" viewBox="0 0 ${ancho} ${alto + 18}" role="img" aria-label="Histograma de distancias">
        ${barras(hi, 'h-imp')}${barras(hg, 'h-gen')}
        <line x1="${x(c.umbralEER)}" x2="${x(c.umbralEER)}" y1="0" y2="${alto}" class="h-umbral"/>
        <text x="0" y="${alto + 14}">0,1</text><text x="${x(0.6) - 8}" y="${alto + 14}">0,6</text><text x="${ancho - 20}" y="${alto + 14}">1,2</text>
      </svg>
      <div class="zonas-leyenda"><span><i class="h-gen"></i>Misma persona</span><span><i class="h-imp"></i>Personas distintas</span><span>Línea: umbral EER (${fmt(c.umbralEER, 3)})</span></div>` : ''}`;
  }
  async function calibrar() {
    const boton = $('#btn-calibrar');
    const est = $('#cal-estado');
    boton.disabled = true;
    const muestras = [];
    try {
      for (let i = 0; i < archivosCal.length; i++) {
        const f = archivosCal[i];
        est.textContent = `Analizando ${i + 1} de ${archivosCal.length}: ${f.name}…`;
        try {
          const img = await AnalisisFacial.prepararArchivo(f);
          const rostros = await AnalisisFacial.detectarConRespaldo(img);
          if (!rostros.length) continue;
          const a = await AnalisisFacial.analizarRostro(img, rostros[0], { sinMiniatura: true });
          muestras.push({ persona: etiquetaPersona(f), archivo: f.name, descriptor: a.descriptor, q: a.puntajeCalidad.puntaje });
        } catch (e) { console.warn(f.name, e); }
      }
      const c = ModeloCerteza.ajustarCalibracion(muestras);
      estado.calibracion = c;
      ModeloCerteza.guardarCalibracion(c);
      est.textContent = `Calibración completada con ${muestras.length} rostros válidos de ${archivosCal.length} archivos. Queda guardada en este navegador.`;
      mostrarEstadoCalibracion();
      if (estado.ultimo) { estado.ultimo.aut = ModeloCerteza.evaluar(estado.ultimo.res, estado.ultimo.r1, estado.ultimo.r2, c); mostrarResultado(estado.ultimo, false); }
    } catch (e) {
      est.textContent = `No se pudo calibrar: ${e.message}`;
    } finally {
      boton.disabled = !archivosCal.length || !estado.modelosListos;
    }
  }
  function elegirArchivosCal(lista) {
    archivosCal = [...lista].filter((f) => f.type.startsWith('image/'));
    const personas = new Set(archivosCal.map(etiquetaPersona));
    $('#cal-estado').textContent = `${archivosCal.length} fotos de ${personas.size} personas: ${[...personas].slice(0, 12).join(', ')}${personas.size > 12 ? '…' : ''}`;
    $('#btn-calibrar').disabled = !archivosCal.length || !estado.modelosListos;
  }

  /* ---------------- Eventos ---------------- */
  configurarPanel(1);
  configurarPanel(2);
  $('#btn-comparar').addEventListener('click', comparar);
  $('#btn-limpiar').addEventListener('click', limpiar);
  $('#btn-ver').addEventListener('click', verReporte);
  $('#btn-pdf').addEventListener('click', imprimir);
  $('#btn-html').addEventListener('click', descargarHTML);
  document.querySelectorAll('input[name=modo]').forEach((r) => r.addEventListener('change', () => aplicarModo(r.value)));
  $('#cal-archivos').addEventListener('change', (e) => elegirArchivosCal(e.target.files));
  $('#cal-carpeta').addEventListener('change', (e) => elegirArchivosCal(e.target.files));
  $('#btn-calibrar').addEventListener('click', calibrar);
  $('#btn-borrar-cal').addEventListener('click', () => {
    estado.calibracion = null;
    ModeloCerteza.guardarCalibracion(null);
    $('#cal-estado').textContent = 'Se volvió al modelo base.';
    mostrarEstadoCalibracion();
    if (estado.ultimo) { estado.ultimo.aut = ModeloCerteza.evaluar(estado.ultimo.res, estado.ultimo.r1, estado.ultimo.r2, null); mostrarResultado(estado.ultimo, false); }
  });
  estado.calibracion = ModeloCerteza.leerCalibracion();
  mostrarEstadoCalibracion();
  try { aplicarModo(localStorage.getItem('comparador-rostros:modo') || 'auto'); } catch (e) { aplicarModo('auto'); }
  $('#umbral').addEventListener('input', (e) => {
    $('#umbral-valor').textContent = `${e.target.value} %`;
    if (estado.ultimo) {
      const { r1, r2 } = estado.ultimo;
      estado.ultimo.res = AnalisisFacial.comparar(r1, r2, +e.target.value);
      estado.ultimo.aut = ModeloCerteza.evaluar(estado.ultimo.res, r1, r2, estado.calibracion);
      mostrarResultado(estado.ultimo, false);
    }
  });
  $('#dialogo-reporte').addEventListener('click', (e) => {
    const accion = e.target.closest('[data-accion]')?.dataset.accion;
    if (accion === 'cerrar' || e.target.id === 'dialogo-reporte') $('#dialogo-reporte').close();
    if (accion === 'pdf') imprimir();
    if (accion === 'html') descargarHTML();
  });

  iniciar();
})();
