/*
 * Experimento de calibración del modo automático.
 * Procesa fotos etiquetadas (y 7 degradaciones controladas de cada una) con el mismo motor de la app
 * y guarda descriptores, calidad y parámetros en calibracion_datos_<n>.json.
 * Uso (desde una carpeta con master.csv, deepface/ y bbt/):  node calibrar.js [fragmento] [total_fragmentos]
 */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
// Identidades: deepface por unión de pares "Yes"; bbt por nombre de archivo
const padre = {}; const f = (x) => (padre[x] === undefined ? (padre[x] = x) : padre[x] === x ? x : (padre[x] = f(padre[x])));
const filas = fs.readFileSync('master.csv', 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
for (const [a, b, d] of filas) { f(a); f(b); if (d.trim() === 'Yes') padre[f(a)] = f(b); }
const imagenes = [];
for (const a of fs.readdirSync('deepface')) imagenes.push({ ruta: 'deepface/' + a, persona: 'df_' + f(a) });
for (const a of fs.readdirSync('bbt')) imagenes.push({ ruta: 'bbt/' + a, persona: 'bbt_' + a.split('_')[0] });
const DEG = [
  { id: 'original' }, { id: 'escala40', escala: 0.4 }, { id: 'escala20', escala: 0.2 }, { id: 'escala12', escala: 0.12 },
  { id: 'desenfoque', filtro: 'blur(3px)' }, { id: 'oscuro', filtro: 'brightness(0.3) contrast(0.7)' },
  { id: 'jpeg', escala: 0.5, jpeg: 0.12 }, { id: 'combinado', escala: 0.3, filtro: 'blur(1.5px) brightness(0.5)', jpeg: 0.4 },
];
const [FR, NFR] = [+(process.argv[2] || 0), +(process.argv[3] || 1)];
const mias = imagenes.filter((_, i) => i % NFR === FR);
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage();
  p.on('pageerror', (e) => console.log('ERR', e.message));
  await p.goto('file://' + path.resolve(__dirname, '../../index.html'));
  await p.waitForSelector('#estado-modelos.listo', { timeout: 300000 });
  const salida = [];
  for (const im of mias) {
    const b64 = fs.readFileSync(im.ruta).toString('base64');
    const tipo = im.ruta.endsWith('.png') ? 'image/png' : 'image/jpeg';
        const r = await p.evaluate(async ({ b64, tipo, DEG }) => {
      const img = new Image(); img.src = 'data:' + tipo + ';base64,' + b64; await img.decode();
      const res = [];
      for (const d of DEG) {
        const esc = (d.escala || 1) * Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * esc); c.height = Math.round(img.naturalHeight * esc);
        const ctx = c.getContext('2d'); if (d.filtro) ctx.filter = d.filtro; ctx.drawImage(img, 0, 0, c.width, c.height);
        const blob = await new Promise((ok) => c.toBlob(ok, d.jpeg ? 'image/jpeg' : 'image/png', d.jpeg || undefined));
        const file = new File([blob], d.id + (d.jpeg ? '.jpg' : '.png'), { type: blob.type });
        try {
          const prep = await AnalisisFacial.prepararArchivo(file);
          const rostros = await AnalisisFacial.detectarConRespaldo(prep);
          if (!rostros.length) { res.push({ deg: d.id, ok: false }); continue; }
          const a = await AnalisisFacial.analizarRostro(prep, rostros[0], { sinMiniatura: true });
          res.push({ deg: d.id, ok: true, desc: Array.from(a.descriptor), descs: a.descriptores.map((x) => Array.from(x)), q: a.puntajeCalidad.puntaje,
            fq: Object.fromEntries(a.puntajeCalidad.factores.map((x) => [x.clave, x.puntaje])), valores: a.valores, pose: a.pose, edad: a.edad, genero: a.genero, probGenero: a.probGenero });
        } catch (e) { res.push({ deg: d.id, ok: false, err: e.message }); }
      }
      return res;
    }, { b64, tipo, DEG });
    for (const x of r) salida.push({ ...x, ruta: im.ruta, persona: im.persona });
    console.log(im.ruta, im.persona, r.map((x) => x.ok ? x.deg + ':' + x.q.toFixed(0) : x.deg + ':X').join(' '));
  }
  fs.writeFileSync('calibracion_datos_' + FR + '.json', JSON.stringify(salida));
  await b.close();
})();
