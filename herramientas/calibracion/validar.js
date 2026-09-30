/* Valida las decisiones del modo automático sobre pares.json (generado por ajustar.js). Uso: node validar.js */
const fs = require('fs'), vm = require('vm');
const ctx = { window: {}, document: {}, Math, console, localStorage: { getItem: () => null } };
ctx.faceapi = { euclideanDistance: () => 0 };
vm.createContext(ctx);
for (const f of ['analisis.js', 'certeza.js']) vm.runInContext(fs.readFileSync(require('path').resolve(__dirname, '../../js', f), 'utf8'), ctx);
ctx.AnalisisFacial = ctx.window.AnalisisFacial;
vm.runInContext('AnalisisFacial = window.AnalisisFacial', ctx);
const MC = ctx.window.ModeloCerteza;
const pares = JSON.parse(fs.readFileSync('pares.json'));
const r = { gen: { si: 0, no: 0, inc: 0 }, imp: { si: 0, no: 0, inc: 0 } };
for (const [gen, d, g, q] of pares) {
  const res = { distancia: d, simGeometria: g, simDescriptor: ctx.window.AnalisisFacial.similitudDescriptor(d) };
  const a = { puntajeCalidad: { puntaje: q * 100 } };
  const e = MC.evaluar(res, a, a, null);
  const k = e.log10lr >= 2 ? 'si' : e.log10lr <= -2 ? 'no' : 'inc';
  r[gen ? 'gen' : 'imp'][k]++;
}
const pc = (o) => { const n = o.si + o.no + o.inc; return `misma ${(o.si / n * 100).toFixed(2)}% | distintas ${(o.no / n * 100).toFixed(2)}% | no concluyente ${(o.inc / n * 100).toFixed(2)}% (n=${n})`; };
console.log('Pares MISMA persona  →', pc(r.gen));
console.log('Pares DISTINTAS      →', pc(r.imp));
for (const q of [0.1, 0.3, 0.5, 0.7, 0.9]) {
  const P = MC.parametros(q, null);
  const a = { puntajeCalidad: { puntaje: q * 100 } };
  const e = MC.evaluar({ distancia: 0.5, simGeometria: 80, simDescriptor: 50 }, a, a, null);
  console.log(`q=${q}: misma ≥ ${e.umbrales.coincidencia.similitud.toFixed(1)}% (d≤${e.umbrales.coincidencia.distancia.toFixed(3)}) | distintas < ${e.umbrales.exclusion.similitud.toFixed(1)}% (d≥${e.umbrales.exclusion.distancia.toFixed(3)}) | FMR1e-3 → ≥${e.puntos[1].similitud.toFixed(1)}% FNMR ${(e.puntos[1].fnmr*100).toFixed(1)}%`);
}
