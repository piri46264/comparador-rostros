/* Generación del reporte en HTML autocontenido (descargable e imprimible como PDF). */
(function () {
  'use strict';

  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, d = 2) => (typeof v === 'number' && isFinite(v) ? v.toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d }) : esc(v));
  const pct = (v, d = 1) => `${num(v, d)} %`;
  const bytes = (b) => (b > 1048576 ? `${num(b / 1048576, 2)} MB` : `${num(b / 1024, 1)} KB`);
  const fecha = (f) => (f ? f.toLocaleString('es-CL', { dateStyle: 'long', timeStyle: 'medium' }) : '—');

  function colorSimilitud(s) {
    if (s === null || s === undefined) return '#8a8f98';
    if (s >= 80) return '#1a7f4b';
    if (s >= 60) return '#6b8e23';
    if (s >= 40) return '#b7791f';
    return '#c0392b';
  }

  function barra(s) {
    if (s === null || s === undefined) return '<span class="na">No se compara</span>';
    return `<div class="barra"><span style="width:${Math.max(2, s).toFixed(1)}%;background:${colorSimilitud(s)}"></span></div><b style="color:${colorSimilitud(s)}">${pct(s)}</b>`;
  }

  function reducirImagen(canvas, max = 520) {
    const e = Math.min(1, max / Math.max(canvas.width, canvas.height));
    const c = document.createElement('canvas');
    c.width = Math.round(canvas.width * e);
    c.height = Math.round(canvas.height * e);
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  }

  function valorParam(def, v) {
    if (def.categorica) return esc(v);
    if (def.unidad === '°') return `${num(v, 1)}°`;
    if (def.unidad === 'px') return `${num(v, 1)} px`;
    if (def.unidad === '%') return `${num(v, 2)} %`;
    return num(v, 3);
  }

  function fichaArchivo(titulo, img, r) {
    return `
    <div class="ficha">
      <h3>${esc(titulo)}</h3>
      <div class="imgs">
        <figure><img src="${reducirImagen(img.canvas)}" alt="Imagen ${esc(titulo)}"><figcaption>Imagen completa</figcaption></figure>
        <figure><img src="${r.miniatura}" alt="Rostro ${esc(titulo)}"><figcaption>Rostro analizado (68 puntos)</figcaption></figure>
      </div>
      <table class="kv">
        <tr><th>Archivo</th><td class="mono">${esc(img.nombre)}</td></tr>
        <tr><th>Formato / tamaño</th><td>${esc(img.tipo)} · ${bytes(img.bytes)}</td></tr>
        <tr><th>Dimensiones</th><td>${img.anchoOriginal} × ${img.altoOriginal} px</td></tr>
        <tr><th>Última modificación</th><td>${fecha(img.modificado)}</td></tr>
        <tr><th>SHA-256</th><td class="mono hash">${esc(img.sha256 || 'No disponible en este navegador')}</td></tr>
        <tr><th>Rostros detectados</th><td>${img.rostros.length} (analizado: n.º ${img.seleccion + 1})</td></tr>
        <tr><th>Confianza de detección</th><td>${pct(r.confianza * 100)}</td></tr>
        <tr><th>Ancho del rostro</th><td>${r.tamRostro} px</td></tr>
        <tr><th>Inclinación (roll)</th><td>${num(r.pose.roll, 1)}° ${r.rollCorregido ? '(corregida automáticamente)' : ''}</td></tr>
        <tr><th>Giro horizontal (índice)</th><td>${num(r.pose.giro, 2)} <small>(0 = frontal; ±1 = perfil)</small></td></tr>
        <tr><th>Edad estimada</th><td>${num(r.edad, 0)} años <small>(margen aprox. ± 6)</small></td></tr>
        <tr><th>Sexo estimado</th><td>${esc(r.genero)} (${pct(r.probGenero * 100, 0)})</td></tr>
        <tr><th>Expresión</th><td>${esc(r.expresion)} (${pct(r.probExpresion * 100, 0)})</td></tr>
        <tr><th>Puntaje de calidad</th><td><b>${num(r.puntajeCalidad.puntaje, 0)}/100</b> (${esc(r.puntajeCalidad.nivel)})</td></tr>
        <tr><th>Calidad</th><td>Brillo ${num(r.calidad.brillo, 0)}/255 · Contraste ${num(r.calidad.contraste, 0)} · Nitidez ${num(r.calidad.nitidez, 0)}</td></tr>
      </table>
      ${r.avisos.length ? `<ul class="avisos">${r.avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : '<p class="ok">Sin observaciones de calidad.</p>'}
    </div>`;
  }

  function formatoLR(l10) {
    const lr = 10 ** Math.abs(l10);
    const t = lr >= 1e6 ? '> 1.000.000' : lr >= 100 ? Math.round(lr).toLocaleString('es-CL') : num(lr, 1);
    return l10 >= 0 ? t : `1/${t}`;
  }

  function seccionCerteza(r1, r2, res, aut, n) {
    const u = aut.umbrales;
    const tablaCalidad = (r, t) => `<div class="ficha"><h3>${t}: ${num(r.puntajeCalidad.puntaje, 0)}/100 (${esc(r.puntajeCalidad.nivel)})</h3>
      <table class="kv">${r.puntajeCalidad.factores.map((f) => `<tr><th>${esc(f.nombre)}</th><td>${esc(f.valor)}</td><td>${barra(f.puntaje * 100)}</td></tr>`).join('')}</table></div>`;
    return `
  <h2>${n}. Certeza estadística y umbral automático</h2>
  <p style="margin-top:0">El umbral se ajusta a la calidad de las imágenes. Con el modelo estadístico de distancias (misma persona vs. personas distintas) para una calidad de par de <b>${num(aut.q * 100, 0)}/100</b> se obtiene:</p>
  <table class="componentes">
    <tr><th>Indicador</th><th>Valor</th><th>Interpretación</th></tr>
    <tr><td><b>Razón de verosimilitud (LR)</b></td><td><b>${formatoLR(aut.log10lr)}</b></td><td>${esc(aut.verbal.texto)} (escala verbal ENFSI). Descriptor: ${formatoLR(aut.log10lrDescriptor)} · geometría: ${formatoLR(aut.log10lrGeometria)}.</td></tr>
    <tr><td><b>Grado de certeza (misma persona)</b></td><td><b>${pct(Math.min(99.99, Math.max(0.01, aut.certeza * 100)), 2)}</b></td><td>Probabilidad posterior asumiendo 50 % previo (sin otra información del caso).</td></tr>
    ${aut.log10lr >= 0
      ? `<tr><td><b>Riesgo de falsa coincidencia</b></td><td>${aut.formatoRazon(aut.fmrObservada)}</td><td>Pares de personas distintas que alcanzarían una similitud igual o mayor a la observada.</td></tr>`
      : `<tr><td><b>Riesgo de que sí sea la misma persona</b></td><td>${aut.formatoRazon(aut.fnmrObservada)}</td><td>Pares de la misma persona que tendrían una similitud igual o menor a la observada.</td></tr>`}
    <tr><td><b>Zonas de decisión</b></td><td style="white-space:nowrap">Distintas: &lt; ${pct(u.exclusion.similitud)}<br>No concluyente: ${pct(u.exclusion.similitud)}–${pct(u.coincidencia.similitud)}<br>Misma persona: ≥ ${pct(u.coincidencia.similitud)}</td><td>Zonas en similitud biométrica, calculadas para esta calidad: personas distintas si LR ≤ 1/100, misma persona si LR ≥ 100. Observada: <b>${pct(res.simDescriptor)}</b>.</td></tr>
    ${aut.estabilidad ? `<tr><td><b>Estabilidad</b></td><td>${pct(AnalisisFacial.similitudDescriptor(aut.estabilidad.dMax))}–${pct(AnalisisFacial.similitudDescriptor(aut.estabilidad.dMin))}</td><td>Rango de similitud entre variantes (original, espejo, ecualizada). ${aut.estabilidad.cruzaUmbral ? 'Cruza el umbral: resultado inestable.' : 'No cruza el umbral: resultado estable.'}</td></tr>` : ''}
  </table>
  <h3 style="margin-top:16px">¿Con qué porcentaje de similitud se puede tener certeza? (fotos de esta calidad)</h3>
  <table class="componentes">
    <tr><th>Similitud biométrica mínima</th><th>Riesgo de aceptar a una persona distinta</th><th>Riesgo de rechazar a la misma persona</th><th>¿Esta comparación la supera?</th></tr>
    ${aut.puntos.map((p) => `<tr><td><b>≥ ${pct(p.similitud)}</b> (distancia ≤ ${num(p.distancia, 3)})</td><td>${aut.formatoRazon(p.fmr)}</td><td>${pct(p.fnmr * 100)}</td><td>${res.simDescriptor >= p.similitud ? '<b style="color:#1a7f4b">Sí</b>' : 'No'}</td></tr>`).join('')}
  </table>
  <h3 style="margin-top:16px">Calidad de las imágenes</h3>
  <div class="fichas">${tablaCalidad(r1, 'Foto 1')}${tablaCalidad(r2, 'Foto 2')}</div>
  <p style="font-size:11.5px;color:#5b6475">Fuente del modelo: ${esc(aut.P.fuente)}. Parámetros para esta calidad: misma persona ${num(aut.P.mg, 3)} ± ${num(aut.P.sg, 3)}; personas distintas ${num(aut.P.mi, 3)} ± ${num(aut.P.si, 3)}.</p>`;
  }

  function seccionMorfologia(m, n) {
    const o = m.oreja;
    const colorN = { alta: '#1a7f4b', media: '#6b8e23', dudosa: '#b7791f', baja: '#c0392b' }[m.nivel] || '#5b6475';
    const colorV = (v) => ({ similar: '#1a7f4b', coincide: '#1a7f4b', diferente: '#c0392b', nocoincide: '#c0392b', solo1: '#b7791f', solo2: '#b7791f' }[v] || '#5b6475');
    const evaluados = m.filas.filter((f) => f.valor);
    const medida = (x) => (x ? `${num(x.relNariz, 3)} (${num(x.orejaPx, 0)} px; nariz ${num(x.narizPx, 0)} px)` : 'Sin marcar');
    return `
  <h2>${n}. Análisis morfológico asistido y orejas</h2>
  <p style="margin-top:0;font-size:12px;color:#5b6475">Juicio del observador${m.observador ? ` <b>${esc(m.observador)}</b>` : ''}, con comparación visual lado a lado según los componentes faciales de FISWG. Complementa al análisis automático y no modifica la razón de verosimilitud.</p>
  ${o && (o.a || o.b) ? `
  <h3>Medición de la oreja${m.lado ? ` (${esc(m.lado)})` : ''}</h3>
  ${m.recortes && (m.recortes[1] || m.recortes[2]) ? `<div class="imgs" style="max-width:480px">${[1, 2].map((k) => m.recortes[k] ? `<figure><img src="${m.recortes[k]}" alt="Oreja foto ${k}"><figcaption>Oreja foto ${k} (A–B)</figcaption></figure>` : '').join('')}</div>` : ''}
  <table class="componentes">
    <tr><th>Medida</th><th>Foto 1</th><th>Foto 2</th><th>Similitud</th></tr>
    <tr><td><b>Largo de oreja / largo de nariz</b></td><td>${medida(o.a)}</td><td>${medida(o.b)}</td><td>${o.completa ? `${barra(o.similitud)} <small>dif. ${pct(o.diferencia)}</small>` : '—'}</td></tr>
    <tr><td><b>Largo de oreja / altura facial</b></td><td>${o.a ? num(o.a.relCara, 3) : '—'}</td><td>${o.b ? num(o.b.relCara, 3) : '—'}</td><td></td></tr>
  </table>
  ${o.avisos && o.avisos.length ? `<ul class="avisos">${o.avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}` : ''}
  <h3 style="margin-top:14px">Lista de verificación</h3>
  ${evaluados.length ? `<table class="componentes">
    <tr><th>Grupo</th><th>Rasgo</th><th>Resultado</th><th>Nota</th></tr>
    ${evaluados.map((f) => `<tr><td>${esc(f.grupo)}</td><td><b>${esc(f.nombre)}</b></td><td style="color:${colorV(f.valor)};font-weight:700">${esc(f.etiqueta)}</td><td>${esc(f.nota)}</td></tr>`).join('')}
  </table>
  <p style="font-size:11.5px;color:#5b6475">${m.filas.length - evaluados.length} rasgo(s) no evaluado(s).</p>` : '<p>No se evaluaron rasgos de la lista.</p>'}
  ${m.observaciones ? `<p><b>Observaciones:</b> ${esc(m.observaciones)}</p>` : ''}
  <div class="nota" style="border-left-color:${colorN}"><b style="color:${colorN}">Conclusión morfológica:</b> ${esc(m.conclusion)}
    (${m.cuenta.concordantes} concordantes · ${m.cuenta.discordantes} diferentes · ${m.cuenta.unaSola} en una sola foto · ${m.cuenta.noVisibles} no visibles)</div>`;
  }

  function generarHTML({ img1, img2, r1, r2, res, aut, modo = 'manual', backend, morfologia }) {
    const hayMorfo = morfologia && morfologia.nivel !== 'ninguno';
    const auto = modo === 'auto' && aut;
    const ahora = new Date();
    const id = `CR-${ahora.getFullYear()}${String(ahora.getMonth() + 1).padStart(2, '0')}${String(ahora.getDate()).padStart(2, '0')}-${String(ahora.getHours()).padStart(2, '0')}${String(ahora.getMinutes()).padStart(2, '0')}${String(ahora.getSeconds()).padStart(2, '0')}`;
    const nivel = auto ? aut.nivel : res.nivel;
    const veredicto = auto ? aut.veredicto : res.veredicto;
    const color = { alta: '#1a7f4b', media: '#6b8e23', dudosa: '#b7791f', baja: '#c0392b' }[nivel];
    let n = 1;

    const grupos = [];
    for (const p of res.parametros) {
      let g = grupos.find((x) => x.nombre === p.grupo);
      if (!g) grupos.push((g = { nombre: p.grupo, filas: [] }));
      g.filas.push(p);
    }
    const filas = grupos.map((g) => `
      <tr class="grupo"><td colspan="6">${esc(g.nombre)}</td></tr>
      ${g.filas.map((p) => `
      <tr>
        <td><b>${esc(p.nombre)}</b><br><small>${esc(p.descripcion)}</small></td>
        <td class="num">${valorParam(p, p.valorA)}</td>
        <td class="num">${valorParam(p, p.valorB)}</td>
        <td class="num">${p.similitud === null ? '—' : p.categorica ? esc(p.diferencia) : pct(p.diferencia)}</td>
        <td class="unidad">${esc(p.unidad)}</td>
        <td class="sim">${barra(p.similitud)}</td>
      </tr>`).join('')}`).join('');

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reporte de comparación facial ${id}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1d2330;background:#fff;margin:0;padding:28px;line-height:1.45;font-size:13.5px}
  .hoja{max-width:1000px;margin:0 auto}
  header{border-bottom:3px solid #1d3557;padding-bottom:12px;margin-bottom:18px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
  h1{font-size:22px;margin:0 0 4px;color:#1d3557}
  h2{font-size:16px;color:#1d3557;border-bottom:1px solid #d5dae3;padding-bottom:4px;margin:26px 0 12px}
  h3{margin:0 0 10px;font-size:15px}
  .meta{font-size:12px;color:#5b6475;text-align:right}
  .resumen{display:grid;grid-template-columns:200px 1fr;gap:20px;align-items:center;border:2px solid ${color};border-radius:10px;padding:18px;background:${color}0d}
  .porcentaje{font-size:46px;font-weight:800;color:${color};text-align:center;line-height:1}
  .porcentaje small{display:block;font-size:12px;font-weight:600;color:#5b6475;margin-top:6px}
  .veredicto{font-size:19px;font-weight:700;color:${color};margin:0 0 8px}
  .fichas{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  .ficha{border:1px solid #d5dae3;border-radius:8px;padding:14px;break-inside:avoid}
  .imgs{display:flex;gap:10px;margin-bottom:10px}
  .imgs figure{margin:0;flex:1;text-align:center}
  .imgs img{width:100%;height:170px;object-fit:contain;background:#f1f3f7;border-radius:6px}
  figcaption{font-size:11px;color:#5b6475}
  table{width:100%;border-collapse:collapse}
  .kv th{text-align:left;font-weight:600;color:#5b6475;width:42%;padding:3px 6px 3px 0;vertical-align:top;font-size:12px}
  .kv td{padding:3px 0;font-size:12px}
  .mono{font-family:Consolas,"Courier New",monospace;word-break:break-all}
  .hash{font-size:10.5px}
  .tabla th{background:#1d3557;color:#fff;text-align:left;padding:7px 8px;font-size:12px}
  .tabla td{border-bottom:1px solid #e5e8ee;padding:6px 8px;vertical-align:middle}
  .tabla td small{color:#6b7385}
  .tabla .grupo td{background:#eef2f8;font-weight:700;color:#1d3557;text-transform:uppercase;font-size:11px;letter-spacing:.05em}
  .tabla tr{break-inside:avoid}
  .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
  .unidad{color:#6b7385;font-size:11px;white-space:nowrap}
  .sim{width:170px;white-space:nowrap}
  .barra{display:inline-block;width:95px;height:8px;background:#e5e8ee;border-radius:4px;overflow:hidden;vertical-align:middle;margin-right:6px}
  .barra span{display:block;height:100%}
  .na{color:#8a8f98;font-size:11px}
  .componentes td,.componentes th{padding:7px 8px;border-bottom:1px solid #e5e8ee;text-align:left}
  .componentes td:last-child{white-space:nowrap}
  .avisos{margin:10px 0 0;padding-left:18px;color:#8a5a00;font-size:12px}
  .ok{color:#1a7f4b;font-size:12px;margin:10px 0 0}
  .nota{font-size:11.5px;color:#5b6475;background:#f6f7fa;border-left:4px solid #1d3557;padding:10px 14px;border-radius:4px}
  footer{margin-top:28px;font-size:11px;color:#8a8f98;text-align:center;border-top:1px solid #e5e8ee;padding-top:10px}
  @media (max-width:720px){body{padding:14px}.fichas,.resumen{grid-template-columns:1fr}.tabla{font-size:12px}.sim{width:auto}}
  @media print{body{padding:0;font-size:11.5px}h2{break-after:avoid}.resumen,.ficha{break-inside:avoid}@page{size:A4;margin:14mm}}
</style>
</head>
<body>
<div class="hoja">
  <header>
    <div>
      <h1>Reporte de comparación facial</h1>
      <div>Análisis biométrico automatizado de dos fotografías</div>
    </div>
    <div class="meta">
      <div><b>N.º de reporte:</b> ${id}</div>
      <div><b>Fecha:</b> ${fecha(ahora)}</div>
      <div><b>Procesamiento:</b> local en el navegador (${esc(backend)})</div>
    </div>
  </header>

  <h2>${n++}. Resultado general</h2>
  <div class="resumen">
    ${auto
      ? `<div class="porcentaje">${num(Math.min(99.99, Math.max(0.01, aut.certeza * 100)), aut.certeza > 0.99 || aut.certeza < 0.01 ? 2 : 1)}%<small>Grado de certeza (misma persona)</small></div>`
      : `<div class="porcentaje">${num(res.total, 1)}%<small>Similitud global</small></div>`}
    <div>
      <p class="veredicto">${esc(veredicto)}</p>
      <div>${auto
        ? `Modo <b>automático</b>: umbral ajustado a la calidad de las fotos (${num(aut.q * 100, 0)}/100). LR = <b>${formatoLR(aut.log10lr)}</b> — ${esc(aut.verbal.texto)}. Similitud global: <b>${pct(res.total)}</b>.`
        : `Modo <b>manual</b>. Umbral de decisión configurado: <b>${num(res.umbral, 0)} %</b>.`}
      Distancia euclidiana entre descriptores: <b>${num(res.distancia, 4)}</b>
      (${res.coincideDescriptor ? 'por debajo' : 'por encima'} del umbral estándar 0,60 de face-api → ${res.coincideDescriptor ? 'coincidencia' : 'no coincidencia'} biométrica).</div>
      ${[...(auto ? aut.avisos : []), ...res.avisos].length ? `<ul class="avisos">${[...(auto ? aut.avisos : []), ...res.avisos].map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
    </div>
  </div>

  ${aut ? seccionCerteza(r1, r2, res, aut, n++) : ''}

  <h2>${n++}. Archivos analizados</h2>
  <div class="fichas">
    ${fichaArchivo('Foto 1', img1, r1)}
    ${fichaArchivo('Foto 2', img2, r2)}
  </div>

  <h2>${n++}. Componentes de la similitud</h2>
  <table class="componentes">
    <tr><th>Componente</th><th>Detalle</th><th>Peso</th><th>Similitud</th></tr>
    <tr><td><b>Descriptor biométrico (red neuronal)</b></td><td>Vector de 128 dimensiones (ResNet-34). Distancia ${num(res.distancia, 4)} · similitud coseno ${num(res.coseno, 4)}</td><td>${pct(res.pesos.descriptor * 100, 0)}</td><td>${barra(res.simDescriptor)}</td></tr>
    <tr><td><b>Geometría facial (antropometría)</b></td><td>${res.parametros.filter((p) => p.similitud !== null).length} parámetros normalizados por la distancia interpupilar</td><td>${pct(res.pesos.geometria * 100, 0)}</td><td>${barra(res.simGeometria)}</td></tr>
    <tr><td><b>Rasgos demográficos estimados</b></td><td>Edad: diferencia ${num(res.difEdad, 0)} años (${pct(res.simEdad, 0)}) · Sexo: ${r1.genero === r2.genero ? 'coincide' : 'no coincide'} (${pct(res.simGenero, 0)})</td><td>${pct(res.pesos.demografia * 100, 0)}</td><td>${barra(res.simDemografia)}</td></tr>
  </table>

  <h2>${n++}. Parámetros faciales y comparación individual</h2>
  <p style="margin-top:0;font-size:12px;color:#5b6475">Las medidas se expresan en múltiplos de la distancia interpupilar (DIO) tras alinear los ojos horizontalmente, de modo que no dependen del tamaño de la foto. "Dif." es la diferencia relativa entre ambos valores.</p>
  <table class="tabla">
    <thead><tr><th>Parámetro</th><th class="num">Foto 1</th><th class="num">Foto 2</th><th class="num">Dif.</th><th>Unidad</th><th>Similitud</th></tr></thead>
    <tbody>${filas}</tbody>
  </table>

  ${hayMorfo ? seccionMorfologia(morfologia, n++) : ''}

  <h2>${n++}. Conclusión</h2>
  <p>${auto
    ? `Con una razón de verosimilitud de <b>${formatoLR(aut.log10lr)}</b> (${esc(aut.verbal.texto.toLowerCase())}) y un grado de certeza de <b>${pct(Math.min(99.99, Math.max(0.01, aut.certeza * 100)), 2)}</b>, evaluados con un umbral adaptado a la calidad de las imágenes, el sistema concluye:`
    : `Con una similitud global de <b>${pct(res.total)}</b> frente a un umbral de <b>${num(res.umbral, 0)} %</b>, el sistema concluye:`}
  <b style="color:${color}">${esc(veredicto.toLowerCase())}</b>.
  ${nivel === 'dudosa' ? 'La evidencia no permite afirmar ni descartar que las fotografías correspondan a la misma persona.' : (nivel === 'alta' || nivel === 'media')
    ? 'Las fotografías "' + esc(img1.nombre) + '" y "' + esc(img2.nombre) + '" presentan rasgos biométricos compatibles con corresponder a la misma persona.'
    : 'Las fotografías "' + esc(img1.nombre) + '" y "' + esc(img2.nombre) + '" no alcanzan el umbral de similitud requerido para afirmar que corresponden a la misma persona.'}</p>
  ${hayMorfo ? `<p><b>Análisis morfológico (observador):</b> ${esc(morfologia.conclusion)}</p>` : ''}

  <h2>${n++}. Metodología y limitaciones</h2>
  <div class="nota">
    <p><b>Metodología.</b> Detección de rostros con SSD MobileNet v1; localización de 68 puntos faciales; enderezado automático del rostro según la línea de los ojos; extracción de un descriptor de 128 dimensiones con una red ResNet-34 entrenada para reconocimiento facial (face-api.js sobre TensorFlow.js), promediado sobre variantes de la imagen (original, espejo y ecualizada; técnica TTA) para reducir el efecto de la iluminación y la asimetría; cálculo de ${res.parametros.length - 1} parámetros antropométricos normalizados y estimación de edad, sexo y expresión. La similitud global combina los tres componentes con los pesos indicados. La similitud de cada parámetro se calcula con una función gaussiana sobre la diferencia relativa, escalada según la variación esperable en una misma persona.</p>
    <p><b>Modo automático y certeza.</b> Cada imagen recibe un puntaje de calidad (resolución interpupilar, nitidez, iluminación, contraste, pose, inclinación, expresión y confianza de detección, con criterios inspirados en ISO/IEC 29794-5). Según la calidad del par, se modelan las distancias esperables entre fotos de la misma persona y de personas distintas (distribuciones obtenidas empíricamente con fotografías etiquetadas y versiones degradadas). Con ellas se calcula la razón de verosimilitud (LR), forma de expresar conclusiones recomendada por ENFSI y FISWG, las tasas de error esperables y los umbrales de decisión: misma persona si LR ≥ 100 y personas distintas si LR ≤ 1/100. Las fotos de peor calidad producen umbrales más exigentes y una franja no concluyente más amplia.</p>
    <p><b>Análisis morfológico y orejas.</b> La comparación de rasgos (oreja, marcas particulares y rasgos faciales) la realiza el observador de forma visual, según los componentes de FISWG. La oreja es muy individual y estable, aunque crece levemente con la edad (unos 0,2 mm por año, sobre todo el lóbulo); su largo se mide con dos puntos marcados manualmente y se expresa como proporción del largo de la nariz, para no depender de la escala. La forma del cuello no se usa como rasgo identificador porque varía con el peso, la postura y la edad; sí se consideran sus marcas particulares (tatuajes, cicatrices, lunares).</p>
    <p><b>Limitaciones.</b> El resultado es probabilístico y orientativo; no constituye por sí solo una identificación pericial. La iluminación, la resolución, la pose, la expresión, el uso de anteojos, barba o maquillaje, el paso del tiempo y la compresión de la imagen afectan los resultados. Las estimaciones de edad y sexo tienen margen de error. Ante decisiones relevantes, el resultado debe ser validado por un perito en identificación facial.</p>
    <p><b>Privacidad.</b> Las imágenes fueron procesadas íntegramente en el navegador del usuario; no se enviaron a ningún servidor. Los hashes SHA-256 permiten verificar la integridad de los archivos originales.</p>
  </div>

  <footer>Reporte generado por "Comparador de Rostros" · ${fecha(ahora)} · ${id}</footer>
</div>
</body>
</html>`;
  }

  window.GeneradorReporte = { generarHTML };
})();
