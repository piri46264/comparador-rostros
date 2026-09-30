/* Ajusta las distribuciones de distancia vs. calidad (coeficientes de MODELO_BASE en js/certeza.js). Uso: node ajustar.js */
const fs = require('fs'), vm = require('vm');
const datos = fs.readdirSync('.').filter((f) => /^calibracion_datos_\d+\.json$/.test(f)).flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8'))).filter((x) => x.ok);
const ctx = { window: {}, document: {}, faceapi: {}, Math, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').resolve(__dirname, '../../js/analisis.js'), 'utf8'), ctx);
const AF = ctx.window.AnalisisFacial;
const dist = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s); };
function geo(a, b) {
  const ps = AF.compararParametros(a, b).filter((p) => p.similitud !== null);
  const difGiro = Math.abs(a.pose.giro - b.pose.giro); let sp = 0, ss = 0;
  for (const p of ps) { let w = p.peso; if (difGiro > 0.2 && ['anchoFacial', 'anchoMandibula', 'asimetria', 'indiceFacial'].includes(p.clave)) w *= 0.5; sp += w; ss += w * p.similitud; }
  return ss / sp;
}
const pares = [];
for (let i = 0; i < datos.length; i++) for (let j = i + 1; j < datos.length; j++) {
  const a = datos[i], b = datos[j];
  if (a.ruta === b.ruta) continue;
  const q = (Math.min(a.q, b.q) * 0.7 + (a.q + b.q) / 2 * 0.3) / 100;
  pares.push({ gen: a.persona === b.persona, d: dist(a.desc, b.desc), d1: dist(a.descs[0], b.descs[0]), g: geo(a, b), q, degs: a.deg + '|' + b.deg,
    edad: Math.abs(a.edad - b.edad), sexo: a.genero === b.genero });
}
const est = (xs) => { const m = xs.reduce((s, x) => s + x, 0) / xs.length; return { n: xs.length, m, s: Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)) }; };
console.log('muestras', datos.length, 'pares', pares.length, 'genuinos', pares.filter((p) => p.gen).length);
console.log('calidad por degradación:'); const porDeg = {};
for (const x of datos) (porDeg[x.deg] ||= []).push(x.q);
for (const k in porDeg) console.log('  ', k.padEnd(12), est(porDeg[k]).m.toFixed(1), 'n=' + porDeg[k].length);
function eer(xs, key, menorEsGen = true) {
  let best = { e: 1 };
  const vals = [...new Set(xs.map((p) => +p[key].toFixed(3)))].sort((a, b) => a - b);
  for (const t of vals) {
    const g = xs.filter((p) => p.gen), im = xs.filter((p) => !p.gen);
    const fnmr = g.filter((p) => (menorEsGen ? p[key] > t : p[key] < t)).length / g.length;
    const fmr = im.filter((p) => (menorEsGen ? p[key] <= t : p[key] >= t)).length / im.length;
    const e = (fnmr + fmr) / 2; if (Math.abs(fnmr - fmr) < 0.03 && e < best.e) best = { e, t, fnmr, fmr };
  }
  return best;
}
const bins = [[0, 0.3], [0.3, 0.45], [0.45, 0.6], [0.6, 0.75], [0.75, 1.01]];
console.log('\nbin q | gen d (m±s) | imp d (m±s) | gen d1 | imp d1 | gen geo | imp geo | EER d | EER d1');
const filasAjuste = [];
for (const [lo, hi] of bins) {
  const xs = pares.filter((p) => p.q >= lo && p.q < hi); if (xs.length < 30) continue;
  const g = xs.filter((p) => p.gen), im = xs.filter((p) => !p.gen);
  if (g.length < 5) continue;
  const qm = est(xs.map((p) => p.q)).m;
  const G = est(g.map((p) => p.d)), I = est(im.map((p) => p.d)), G1 = est(g.map((p) => p.d1)), I1 = est(im.map((p) => p.d1));
  const GG = est(g.map((p) => p.g)), IG = est(im.map((p) => p.g));
  filasAjuste.push({ q: qm, G, I, GG, IG });
  const E = eer(xs, 'd'), E1 = eer(xs, 'd1');
  console.log(`${lo}-${hi} q=${qm.toFixed(2)} ng=${g.length} ni=${im.length} | ${G.m.toFixed(3)}±${G.s.toFixed(3)} | ${I.m.toFixed(3)}±${I.s.toFixed(3)} | ${G1.m.toFixed(3)}±${G1.s.toFixed(3)} | ${I1.m.toFixed(3)}±${I1.s.toFixed(3)} | ${GG.m.toFixed(1)}±${GG.s.toFixed(1)} | ${IG.m.toFixed(1)}±${IG.s.toFixed(1)} | ${(E.e * 100).toFixed(1)}%@${E.t} | ${(E1.e * 100).toFixed(1)}%@${E1.t}`);
}
// Ajuste lineal ponderado de mu y sigma vs q
function lin(pts) { const n = pts.length, mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  const b = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0); return [my - b * mx, b]; }
const ajuste = {
  genuino: { mu: lin(filasAjuste.map((f) => [f.q, f.G.m])), sigma: lin(filasAjuste.map((f) => [f.q, f.G.s])) },
  impostor: { mu: lin(filasAjuste.map((f) => [f.q, f.I.m])), sigma: lin(filasAjuste.map((f) => [f.q, f.I.s])) },
  geoGenuino: est(pares.filter((p) => p.gen).map((p) => p.g)), geoImpostor: est(pares.filter((p) => !p.gen).map((p) => p.g)),
};
console.log('\nAJUSTE', JSON.stringify(ajuste));
const Eall = eer(pares, 'd'), E1all = eer(pares, 'd1'), Egeo = eer(pares, 'g', false);
console.log('EER global: TTA', (Eall.e * 100).toFixed(2), '% umbral', Eall.t, '| sin TTA', (E1all.e * 100).toFixed(2), '% umbral', E1all.t, '| geometría', (Egeo.e * 100).toFixed(1), '%');
// Tasa de error con umbral fijo 0.6
const g = pares.filter((p) => p.gen), im = pares.filter((p) => !p.gen);
for (const t of [0.5, 0.55, 0.6]) console.log(`umbral fijo ${t}: FNMR ${(g.filter((p) => p.d > t).length / g.length * 100).toFixed(1)}% FMR ${(im.filter((p) => p.d <= t).length / im.length * 100).toFixed(2)}%`);
fs.writeFileSync('pares.json', JSON.stringify(pares.map((p) => [p.gen ? 1 : 0, +p.d.toFixed(4), +p.g.toFixed(2), +p.q.toFixed(3)])));
