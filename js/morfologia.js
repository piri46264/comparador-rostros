/*
 * Análisis morfológico asistido (criterios FISWG) y medición manual de la oreja.
 *
 * - Visores lado a lado con zoom y desplazamiento para comparar rasgos.
 * - Lista de verificación: oreja, marcas particulares (cuello y cara) y rasgos faciales.
 * - Medición de la oreja con 2 puntos por foto, expresada como proporción del largo de la nariz
 *   (canon neoclásico: largo de oreja ≈ largo de nariz), que no depende de la escala de la foto.
 *
 * Es un juicio del observador: se informa aparte y no modifica la razón de verosimilitud automática.
 */
(function () {
  'use strict';

  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, d = 2) => v.toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  const OPCIONES = {
    rasgo: [['', 'No evaluado'], ['similar', 'Similar'], ['diferente', 'Diferente'], ['novisible', 'No visible']],
    marca: [['', 'No evaluado'], ['coincide', 'En ambas y coincide'], ['nocoincide', 'En ambas, no coincide'], ['solo1', 'Solo en foto 1'], ['solo2', 'Solo en foto 2'], ['ninguna', 'Ausente en ambas'], ['novisible', 'Zona no visible']],
  };

  const RASGOS = [
    { grupo: 'Oreja', clave: 'orejaForma', nombre: 'Forma general', ayuda: 'Ovalada, redonda, triangular o rectangular.' },
    { grupo: 'Oreja', clave: 'helix', nombre: 'Hélix (borde exterior)', ayuda: 'Enrollado o plano, grosor, muescas, tubérculo de Darwin.' },
    { grupo: 'Oreja', clave: 'antihelix', nombre: 'Antihélix y sus ramas', ayuda: 'Relieve interno en forma de "Y".' },
    { grupo: 'Oreja', clave: 'trago', nombre: 'Trago y antitrago', ayuda: 'Salientes junto a la entrada del conducto auditivo.' },
    { grupo: 'Oreja', clave: 'concha', nombre: 'Concha', ayuda: 'Profundidad y forma de la cavidad central.' },
    { grupo: 'Oreja', clave: 'lobulo', nombre: 'Lóbulo', ayuda: 'Libre o adherido, tamaño y forma. Crece con la edad.' },
    { grupo: 'Oreja', clave: 'protrusion', nombre: 'Separación de la cabeza', ayuda: 'Orejas pegadas o despegadas (depende de la pose).' },
    { grupo: 'Oreja', clave: 'orejaMarcas', nombre: 'Marcas en la oreja', ayuda: 'Perforaciones, cicatrices, deformaciones ("oreja de coliflor").' },
    { grupo: 'Marcas particulares', clave: 'cuelloTatuaje', nombre: 'Tatuajes en el cuello', tipo: 'marca' },
    { grupo: 'Marcas particulares', clave: 'cuelloCicatriz', nombre: 'Cicatrices en el cuello', tipo: 'marca' },
    { grupo: 'Marcas particulares', clave: 'cuelloLunar', nombre: 'Lunares o manchas en el cuello', tipo: 'marca' },
    { grupo: 'Marcas particulares', clave: 'caraLunar', nombre: 'Lunares o manchas en la cara', tipo: 'marca' },
    { grupo: 'Marcas particulares', clave: 'caraCicatriz', nombre: 'Cicatrices en la cara', tipo: 'marca' },
    { grupo: 'Marcas particulares', clave: 'caraTatuaje', nombre: 'Tatuajes o perforaciones en la cara', tipo: 'marca' },
    { grupo: 'Rasgos faciales', clave: 'cejas', nombre: 'Forma de las cejas', ayuda: 'Arco, grosor, extremos. Pueden depilarse o maquillarse.' },
    { grupo: 'Rasgos faciales', clave: 'nariz', nombre: 'Dorso y punta de la nariz', ayuda: 'Recto, cóncavo, convexo; punta bulbosa, fina, bífida.' },
    { grupo: 'Rasgos faciales', clave: 'labios', nombre: 'Forma de los labios', ayuda: 'Arco de Cupido, comisuras.' },
    { grupo: 'Rasgos faciales', clave: 'menton', nombre: 'Mentón', ayuda: 'Hoyuelo, forma, prominencia.' },
    { grupo: 'Rasgos faciales', clave: 'cabello', nombre: 'Línea de nacimiento del cabello', ayuda: 'Entradas, pico de viuda. Cambia con la calvicie.' },
  ];

  const TOL_OREJA = 0.08; // variación relativa esperable de la proporción oreja/nariz en una misma persona

  let estado = null;
  let visores = {};

  function nuevoEstado(img1, img2, r1, r2) {
    return { img1, img2, r1, r2, clave: claveImagenes(img1, img2), items: {}, notas: {}, lado: '', observador: '', observaciones: '', marcas: { 1: [], 2: [] } };
  }
  const claveImagenes = (a, b) => `${a.nombre}|${a.seleccion}|${a.canvas.width}|${b.nombre}|${b.seleccion}|${b.canvas.width}`;

  /* ---------------------------------------------------------------- */
  /* Visor con zoom, desplazamiento y marcado                         */
  /* ---------------------------------------------------------------- */
  class Visor {
    constructor(contenedor, n) {
      this.n = n;
      this.cont = contenedor;
      this.canvas = $('canvas', contenedor);
      this.zoom = 1; this.ox = 0; this.oy = 0; this.modo = 'mover';
      this.canvas.addEventListener('pointerdown', (e) => this.alPresionar(e));
      this.canvas.addEventListener('pointermove', (e) => this.alMover(e));
      this.canvas.addEventListener('pointerup', (e) => this.alSoltar(e));
      this.canvas.addEventListener('pointercancel', () => { this.arrastre = null; });
      this.canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const p = this.aImagen(e);
        this.aplicarZoom(this.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), p);
      }, { passive: false });
      contenedor.querySelectorAll('[data-visor]').forEach((b) => b.addEventListener('click', () => this.accion(b.dataset.visor)));
      new ResizeObserver(() => this.dibujar()).observe(this.canvas);
    }
    get img() { return estado && (this.n === 1 ? estado.img1 : estado.img2); }
    escalaBase() {
      const r = this.canvas.getBoundingClientRect();
      return Math.min(r.width / this.img.canvas.width, r.height / this.img.canvas.height);
    }
    aImagen(e) {
      const r = this.canvas.getBoundingClientRect();
      const s = this.escalaBase() * this.zoom;
      return { x: (e.clientX - r.left) / s + this.ox, y: (e.clientY - r.top) / s + this.oy };
    }
    ajustar() {
      this.zoom = 1;
      const r = this.canvas.getBoundingClientRect(), s = this.escalaBase();
      this.ox = -(r.width / s - this.img.canvas.width) / 2;
      this.oy = -(r.height / s - this.img.canvas.height) / 2;
      this.dibujar();
    }
    enfocar(x, y, ancho) {
      const r = this.canvas.getBoundingClientRect();
      this.zoom = Math.max(1, Math.min(12, (r.width / this.escalaBase()) / ancho));
      const s = this.escalaBase() * this.zoom;
      this.ox = x - r.width / s / 2; this.oy = y - r.height / s / 2;
      this.dibujar();
    }
    aplicarZoom(z, centro) {
      const r = this.canvas.getBoundingClientRect();
      const nuevo = Math.max(0.5, Math.min(16, z));
      const s0 = this.escalaBase() * this.zoom, s1 = this.escalaBase() * nuevo;
      const c = centro || { x: this.ox + r.width / s0 / 2, y: this.oy + r.height / s0 / 2 };
      const fx = (c.x - this.ox) * s0, fy = (c.y - this.oy) * s0; // posición en pantalla del centro
      this.zoom = nuevo;
      this.ox = c.x - fx / s1; this.oy = c.y - fy / s1;
      this.dibujar();
    }
    accion(a) {
      if (a === 'mas') this.aplicarZoom(this.zoom * 1.4);
      if (a === 'menos') this.aplicarZoom(this.zoom / 1.4);
      if (a === 'ajustar') this.ajustar();
      if (a === 'rostro') this.irRostro();
      if (a === 'oreja-izq') this.irOreja('izq');
      if (a === 'oreja-der') this.irOreja('der');
      if (a === 'marcar') { this.modo = this.modo === 'marcar' ? 'mover' : 'marcar'; this.actualizarBotones(); }
      if (a === 'borrar') { estado.marcas[this.n] = []; this.dibujar(); alCambiar(); }
    }
    actualizarBotones() {
      const b = $('[data-visor="marcar"]', this.cont);
      b.classList.toggle('activo', this.modo === 'marcar');
      b.textContent = this.modo === 'marcar' ? 'Marcando… (clic en la imagen)' : 'Marcar oreja';
      this.canvas.style.cursor = this.modo === 'marcar' ? 'crosshair' : 'grab';
    }
    puntos() { return this.img.rostros[this.img.seleccion].landmarks.positions; }
    irRostro() {
      const b = this.img.rostros[this.img.seleccion].detection.box;
      this.enfocar(b.x + b.width / 2, b.y + b.height / 2, b.width * 1.6);
    }
    irOreja(lado) {
      // Lado de la imagen: el punto 0 del contorno está a la izquierda de la foto, el 16 a la derecha
      // La oreja queda por fuera del contorno, entre la línea de los ojos y la base de la nariz
      const p = this.puntos(), ref = lado === 'izq' ? p[1] : p[15], nariz = dist(p[27], p[33]);
      const dx = lado === 'izq' ? -0.8 : 0.8;
      this.enfocar(ref.x + dx * nariz, ref.y + 0.1 * nariz, nariz * 3.6);
    }
    alPresionar(e) {
      this.canvas.setPointerCapture(e.pointerId);
      this.arrastre = { x: e.clientX, y: e.clientY, ox: this.ox, oy: this.oy, movido: false };
    }
    alMover(e) {
      if (!this.arrastre) return;
      const dx = e.clientX - this.arrastre.x, dy = e.clientY - this.arrastre.y;
      if (Math.hypot(dx, dy) > 4) this.arrastre.movido = true;
      if (!this.arrastre.movido) return;
      const s = this.escalaBase() * this.zoom;
      this.ox = this.arrastre.ox - dx / s; this.oy = this.arrastre.oy - dy / s;
      this.dibujar();
    }
    alSoltar(e) {
      const a = this.arrastre;
      this.arrastre = null;
      if (!a || a.movido || this.modo !== 'marcar') return;
      const p = this.aImagen(e);
      const m = estado.marcas[this.n];
      if (m.length >= 2) m.length = 0;
      m.push(p);
      if (m.length === 2) { this.modo = 'mover'; this.actualizarBotones(); }
      this.dibujar();
      alCambiar();
    }
    dibujar() {
      if (!this.img) return;
      const r = this.canvas.getBoundingClientRect();
      if (!r.width) return;
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr);
      const ctx = this.canvas.getContext('2d');
      const s = this.escalaBase() * this.zoom;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0c0f14';
      ctx.fillRect(0, 0, r.width, r.height);
      ctx.setTransform(dpr * s, 0, 0, dpr * s, -this.ox * s * dpr, -this.oy * s * dpr);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.img.canvas, 0, 0);
      const px = 1 / s; // un píxel de pantalla en unidades de imagen
      // Referencia: largo de la nariz (puntos 27–33)
      const p = this.puntos();
      ctx.strokeStyle = 'rgba(80,170,255,.95)'; ctx.lineWidth = 2 * px;
      ctx.beginPath(); ctx.moveTo(p[27].x, p[27].y); ctx.lineTo(p[33].x, p[33].y); ctx.stroke();
      // Marcas de la oreja
      const m = estado.marcas[this.n];
      ctx.strokeStyle = '#ff9f1a'; ctx.fillStyle = '#ff9f1a'; ctx.lineWidth = 2 * px;
      if (m.length === 2) { ctx.beginPath(); ctx.moveTo(m[0].x, m[0].y); ctx.lineTo(m[1].x, m[1].y); ctx.stroke(); }
      m.forEach((q, i) => {
        ctx.beginPath(); ctx.arc(q.x, q.y, 5 * px, 0, Math.PI * 2); ctx.fill();
        ctx.font = `bold ${13 * px}px sans-serif`;
        ctx.fillText(i === 0 ? 'A' : 'B', q.x + 8 * px, q.y - 6 * px);
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Cálculos                                                          */
  /* ---------------------------------------------------------------- */
  function medicionOreja() {
    if (!estado) return null;
    const medir = (n) => {
      const m = estado.marcas[n];
      if (m.length !== 2) return null;
      const img = n === 1 ? estado.img1 : estado.img2;
      const p = img.rostros[img.seleccion].landmarks.positions;
      const oreja = dist(m[0], m[1]);
      return {
        orejaPx: oreja / img.escala,
        narizPx: dist(p[27], p[33]) / img.escala,
        relNariz: oreja / dist(p[27], p[33]),
        relCara: oreja / dist(p[27], p[8]),
      };
    };
    const a = medir(1), b = medir(2);
    if (!a || !b) return { a, b, completa: false };
    const rel = Math.abs(a.relNariz - b.relNariz) / ((a.relNariz + b.relNariz) / 2);
    const similitud = 100 * Math.exp(-((rel / (2 * TOL_OREJA)) ** 2));
    const avisos = [];
    const difGiro = Math.abs(estado.r1.pose.giro - estado.r2.pose.giro);
    if (difGiro > 0.25) avisos.push('Las fotos tienen giros de cabeza distintos: la proyección de la oreja cambia y la medida es poco fiable.');
    const difEdad = Math.abs(estado.r1.edad - estado.r2.edad);
    if (difEdad > 10) avisos.push(`Diferencia de edad estimada de ${difEdad.toFixed(0)} años: la oreja (sobre todo el lóbulo) crece ~0,2 mm por año.`);
    if (Math.min(a.orejaPx, b.orejaPx) < 30) avisos.push('La oreja mide menos de 30 px en alguna foto: el error de marcado es proporcionalmente grande.');
    for (const [x, n] of [[a, 1], [b, 2]]) {
      if (x.relNariz < 0.6 || x.relNariz > 1.7) avisos.push(`Foto ${n}: proporción oreja/nariz inusual (${fmt(x.relNariz)}); revisar que los puntos A y B estén en el extremo superior del hélix y el inferior del lóbulo.`);
    }
    return { a, b, completa: true, diferencia: rel * 100, similitud, avisos };
  }

  function resumen() {
    if (!estado) return null;
    const cuenta = { concordantes: 0, discordantes: 0, unaSola: 0, noVisibles: 0, neutras: 0, evaluados: 0, orejaSimilar: 0, orejaDiferente: 0 };
    const filas = RASGOS.map((r) => {
      const v = estado.items[r.clave] || '';
      if (v) cuenta.evaluados++;
      if (v === 'similar' || v === 'coincide') cuenta.concordantes++;
      if (v === 'diferente' || v === 'nocoincide') cuenta.discordantes++;
      if (v === 'solo1' || v === 'solo2') cuenta.unaSola++;
      if (v === 'novisible') cuenta.noVisibles++;
      if (v === 'ninguna') cuenta.neutras++;
      if (r.grupo === 'Oreja' && v === 'similar') cuenta.orejaSimilar++;
      if (r.grupo === 'Oreja' && v === 'diferente') cuenta.orejaDiferente++;
      const etiqueta = (OPCIONES[r.tipo || 'rasgo'].find((o) => o[0] === v) || ['', 'No evaluado'])[1];
      return { ...r, valor: v, etiqueta, nota: estado.notas[r.clave] || '' };
    });
    const oreja = medicionOreja();
    let conclusion, nivel;
    if (!cuenta.evaluados && !(oreja && oreja.completa)) { conclusion = 'Análisis morfológico no realizado.'; nivel = 'ninguno'; }
    else if (cuenta.discordantes) {
      conclusion = `Se observan ${cuenta.discordantes} diferencia(s) morfológica(s). Una diferencia real en un rasgo estable (por ejemplo, la forma del lóbulo o un tatuaje antiguo) puede bastar para excluir; hay que verificar que no se deba a la pose, la iluminación, la resolución o el paso del tiempo.`;
      nivel = 'baja';
    } else if (cuenta.unaSola) {
      conclusion = `Rasgos concordantes, pero con ${cuenta.unaSola} marca(s) presente(s) en una sola foto. Puede explicarse por la fecha de las fotos (tatuaje o cicatriz posterior), maquillaje, pose o resolución; debe aclararse.`;
      nivel = 'dudosa';
    } else if (cuenta.concordantes >= 5 && cuenta.orejaSimilar >= 2) {
      conclusion = `Rasgos morfológicos concordantes (${cuenta.concordantes}), incluidos ${cuenta.orejaSimilar} rasgos de la oreja, sin diferencias observadas.`;
      nivel = 'alta';
    } else if (cuenta.concordantes) {
      conclusion = `Concordancia parcial (${cuenta.concordantes} rasgo(s) similar(es), sin diferencias), con información morfológica limitada.`;
      nivel = 'media';
    } else { conclusion = 'Los rasgos evaluados no fueron visibles o no aportan información.'; nivel = 'dudosa'; }
    if (oreja && oreja.completa && oreja.similitud < 40 && nivel !== 'baja') {
      conclusion += ` La proporción de la oreja difiere un ${fmt(oreja.diferencia, 1)} %; revisar el marcado y la pose.`;
    }
    return { filas, cuenta, oreja, conclusion, nivel, lado: estado.lado, observador: estado.observador, observaciones: estado.observaciones, recortes: recortesOreja() };
  }

  function recortesOreja() {
    const salida = {};
    for (const n of [1, 2]) {
      const m = estado.marcas[n];
      if (m.length !== 2) continue;
      const img = n === 1 ? estado.img1 : estado.img2;
      const c = document.createElement('canvas'), tam = 220;
      c.width = c.height = tam;
      const largo = dist(m[0], m[1]), lado = largo * 1.9;
      const cx = (m[0].x + m[1].x) / 2, cy = (m[0].y + m[1].y) / 2;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#222'; ctx.fillRect(0, 0, tam, tam);
      const s = tam / lado, x0 = cx - lado / 2, y0 = cy - lado / 2;
      ctx.drawImage(img.canvas, x0, y0, lado, lado, 0, 0, tam, tam);
      ctx.strokeStyle = '#ff9f1a'; ctx.fillStyle = '#ff9f1a'; ctx.lineWidth = 2;
      const q = m.map((p) => ({ x: (p.x - x0) * s, y: (p.y - y0) * s }));
      ctx.beginPath(); ctx.moveTo(q[0].x, q[0].y); ctx.lineTo(q[1].x, q[1].y); ctx.stroke();
      q.forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill(); });
      salida[n] = c.toDataURL('image/jpeg', 0.9);
    }
    return salida;
  }

  /* ---------------------------------------------------------------- */
  /* Interfaz                                                          */
  /* ---------------------------------------------------------------- */
  let alCambiarExterno = () => {};
  function alCambiar() { pintarResultados(); alCambiarExterno(); }

  function pintarLista() {
    const grupos = [...new Set(RASGOS.map((r) => r.grupo))];
    $('#morfo-lista').innerHTML = grupos.map((g) => `
      <fieldset class="morfo-grupo">
        <legend>${esc(g)}</legend>
        ${RASGOS.filter((r) => r.grupo === g).map((r) => `
          <div class="morfo-item">
            <label for="morfo-${r.clave}"><b>${esc(r.nombre)}</b>${r.ayuda ? `<small>${esc(r.ayuda)}</small>` : ''}</label>
            <select id="morfo-${r.clave}" data-rasgo="${r.clave}">
              ${OPCIONES[r.tipo || 'rasgo'].map(([v, t]) => `<option value="${v}" ${estado.items[r.clave] === v ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
            <input type="text" data-nota="${r.clave}" placeholder="Nota (opcional)" value="${esc(estado.notas[r.clave] || '')}">
          </div>`).join('')}
      </fieldset>`).join('');
    $('#morfo-lista').querySelectorAll('[data-rasgo]').forEach((s) => s.addEventListener('change', () => {
      estado.items[s.dataset.rasgo] = s.value;
      s.dataset.valor = s.value;
      alCambiar();
    }));
    $('#morfo-lista').querySelectorAll('[data-nota]').forEach((i) => i.addEventListener('input', () => { estado.notas[i.dataset.nota] = i.value; alCambiarExterno(); }));
    $('#morfo-lista').querySelectorAll('[data-rasgo]').forEach((s) => { s.dataset.valor = s.value; });
  }

  function pintarResultados() {
    const r = resumen();
    const o = r.oreja;
    const col = (s) => (s >= 80 ? 'var(--verde)' : s >= 60 ? 'var(--oliva)' : s >= 40 ? 'var(--ambar)' : 'var(--rojo)');
    const celda = (x) => (x ? `${fmt(x.relNariz, 3)} <small>(${fmt(x.orejaPx, 0)} px)</small>` : '<small>Faltan puntos A y B</small>');
    $('#morfo-oreja').innerHTML = `
      <table class="tabla-parametros">
        <thead><tr><th>Medida</th><th>Foto 1</th><th>Foto 2</th><th>Similitud</th></tr></thead>
        <tbody>
          <tr><td>Largo de oreja / largo de nariz<small>Referencia anatómica ≈ 1,0 en adultos</small></td><td>${celda(o && o.a)}</td><td>${celda(o && o.b)}</td>
            <td>${o && o.completa ? `<div class="barra mini"><span style="width:${o.similitud.toFixed(0)}%;background:${col(o.similitud)}"></span></div><b style="color:${col(o.similitud)}">${fmt(o.similitud, 0)} %</b> <small>dif. ${fmt(o.diferencia, 1)} %</small>` : '—'}</td></tr>
          <tr><td>Largo de oreja / altura facial<small>Nasion–mentón</small></td><td>${o && o.a ? fmt(o.a.relCara, 3) : '—'}</td><td>${o && o.b ? fmt(o.b.relCara, 3) : '—'}</td><td></td></tr>
        </tbody>
      </table>
      ${o && o.avisos && o.avisos.length ? `<ul class="avisos">${o.avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}`;
    const c = r.cuenta;
    $('#morfo-resumen').dataset.nivel = r.nivel;
    $('#morfo-resumen').innerHTML = `
      <div class="morfo-conteo">
        <span><b>${c.concordantes}</b> concordantes</span>
        <span><b>${c.discordantes}</b> diferentes</span>
        <span><b>${c.unaSola}</b> en una sola foto</span>
        <span><b>${c.noVisibles}</b> no visibles</span>
      </div>
      <p>${esc(r.conclusion)}</p>`;
  }

  function preparar(img1, img2, r1, r2, alCambiarCb) {
    alCambiarExterno = alCambiarCb || (() => {});
    const seccion = $('#morfologia');
    seccion.hidden = false;
    if (!estado || estado.clave !== claveImagenes(img1, img2)) {
      estado = nuevoEstado(img1, img2, r1, r2);
      estado.observador = $('#morfo-observador').value;
      $('#morfo-lado').value = '';
      $('#morfo-observaciones').value = '';
      pintarLista();
      requestAnimationFrame(() => { visores[1].ajustar(); visores[2].ajustar(); visores[1].actualizarBotones(); visores[2].actualizarBotones(); });
    } else {
      estado.r1 = r1; estado.r2 = r2;
    }
    pintarResultados();
  }

  function reiniciar() {
    estado = null;
    const s = $('#morfologia');
    if (s) s.hidden = true;
  }

  function iniciar() {
    visores = { 1: new Visor($('#visor-1'), 1), 2: new Visor($('#visor-2'), 2) };
    $('#morfo-lado').addEventListener('change', (e) => { if (estado) { estado.lado = e.target.value; alCambiarExterno(); } });
    $('#morfo-observador').addEventListener('input', (e) => { if (estado) { estado.observador = e.target.value; alCambiarExterno(); } });
    $('#morfo-observaciones').addEventListener('input', (e) => { if (estado) { estado.observaciones = e.target.value; alCambiarExterno(); } });
    $('#morfo-sincronizar').addEventListener('click', () => {
      for (const n of [1, 2]) visores[n].irRostro();
    });
  }

  window.Morfologia = { iniciar, preparar, reiniciar, resumen, RASGOS };
})();
