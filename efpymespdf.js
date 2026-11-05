// Estados Financieros Pymes: dibujo de los documentos en PDF (carta) y en Excel.
// Un documento ("doc") es uno de estos tipos:
//   portada  { titulo, lineas: [texto], contenido: [texto], firma: [texto] }
//   estado   { titulo, subtitulo, hoja, anios: [actual, anterior], filas: [fila], firmas: [[línea, línea...]] , pie }
//            fila: { k: 'titulo'|'sub'|'det'|'subtotal'|'total'|'texto', c: texto, nota: 'n', a, p, n: sangría, m: true (B/.), f: 'pct' }
//   matriz   { titulo, subtitulo, hoja, columnas: [texto], bloques: [{ titulo, filas: [{ k, c, v: [números] }] }], firmas }
//   notas    { titulo, subtitulo, hoja, anios, notas: [{ num, titulo, ref, parrafos: [texto], tabla: [fila] }] }
//   carta    { titulo, hoja, campos: [[etiqueta, valor]], parrafos: [{ t, size, centro, negrita }], firmas: [{ lineas: [texto] }] , pie }
// Los textos aceptan **negrita**. Los números van como número; null deja la celda vacía y 0 sale como "–".
import { interno } from './exportar.js';

const { anchoTexto, literal, zip, xml, letraColumna, ahoraTexto, logosDe, MIME_XLSX } = interno;

/* ================================ formatos ================================ */

export const nf = (v, f) => {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'string') return v;
  if (f === 'pct') return Math.abs(v) < 0.005 ? '–' : `${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
  const x = Math.round(v * 100) / 100;
  if (Math.abs(x) < 0.005) return '–';
  const t = Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return x < 0 ? `(${t})` : t;
};
const sinMarcas = (t) => String(t ?? '').replace(/\*\*/g, '');
const empresaDe = (meta) => {
  const e = (meta && meta.empresa) || {};
  return { nombre: e.razon_social || '', ruc: e.ruc ? `RUC ${e.ruc}${e.dv ? ' DV ' + e.dv : ''}` : '' };
};

/* ============================ texto con negritas ============================ */

function palabras(texto) {
  const out = [];
  String(texto ?? '').split('\n').forEach((par) => {
    let b = false; let finPegado = false; // finPegado: el segmento anterior terminó sin espacio
    par.split('**').forEach((seg, i) => {
      if (i > 0) b = !b;
      const ws = seg.split(/\s+/).filter(Boolean);
      ws.forEach((w, k) => out.push({ w, b, pegar: k === 0 && finPegado && !/^\s/.test(seg) }));
      if (seg.length) finPegado = !/\s$/.test(seg) && out.length > 0 && ws.length > 0;
      else finPegado = finPegado && false;
    });
    out.push({ nl: true });
  });
  return out;
}
// Parte un texto en líneas de un ancho dado. Cada línea: { p: [{w, b}], fin }
function lineasRico(texto, ancho, tam) {
  const esp = (anchoTexto(' ', tam, false));
  const lineas = []; let act = []; let w = 0;
  const cerrar = (fin) => { lineas.push({ p: act, fin, w }); act = []; w = 0; };
  for (const t of palabras(texto)) {
    if (t.nl) { cerrar(true); continue; }
    const ww = anchoTexto(t.w, tam, t.b);
    if (t.pegar && act.length) { w += ww; act.push(t); continue; }
    if (act.length && w + esp + ww > ancho) cerrar(false);
    w += (act.length ? esp : 0) + ww; act.push(t);
  }
  if (lineas.length > 1 && lineas[lineas.length - 1].p.length === 0) lineas.pop();
  return lineas.length ? lineas : [{ p: [], fin: true, w: 0 }];
}

/* ==================================== PDF =================================== */

const W = 612; const H = 792; const ML = 54; const MR = 54; const UTIL = W - ML - MR; const TOP = 44; const BOT = 50;
const GRIS = '0.35 0.4 0.38';

export function construirPdfPymes(docs, meta) {
  const logos = logosDe(meta);
  const emp = empresaDe(meta);
  const generado = ahoraTexto();
  const paginas = [];
  let pag = null; let y = 0; let docAct = null;

  const Y = (v) => (H - v).toFixed(2);
  const T = (s, x, base, tam, neg, color) => {
    if (s === '' || s === null || s === undefined) return;
    pag.ops.push(`BT /${neg ? 'F2' : 'F1'} ${tam} Tf ${color || '0 0 0'} rg ${x.toFixed(2)} ${Y(base)} Td (${literal(s)}) Tj ET`);
  };
  const TC = (s, cx, base, tam, neg, color) => { if (s) T(s, cx - anchoTexto(s, tam, neg) / 2, base, tam, neg, color); };
  const TD = (s, xd, base, tam, neg, color) => { if (s) T(s, xd - anchoTexto(s, tam, neg), base, tam, neg, color); };
  const L = (x1, y1, x2, grosor, color) => pag.ops.push(`${color || '0 0 0'} RG ${grosor || 0.5} w ${x1.toFixed(2)} ${Y(y1)} m ${x2.toFixed(2)} ${Y(y1)} l S`);
  const nueva = () => { pag = { ops: [], doc: docAct, logo: false, logo2: false }; paginas.push(pag); y = TOP; };

  // Línea de texto con negritas; justificada si no es la última del párrafo
  const dibujarLinea = (ln, x, base, tam, ancho, justificar) => {
    const esp = anchoTexto(' ', tam, false);
    const huecos = ln.p.filter((t, i) => i > 0 && !t.pegar).length;
    let extra = 0;
    if (justificar && !ln.fin && huecos > 0) extra = Math.max(0, (ancho - ln.w) / huecos);
    let cx = x;
    ln.p.forEach((t, i) => {
      T(t.w, cx, base, tam, t.b);
      const sig = ln.p[i + 1];
      cx += anchoTexto(t.w, tam, t.b) + (sig && sig.pegar ? 0 : esp + extra);
    });
  };
  const parrafo = (texto, x, ancho, tam, opc) => {
    const o = opc || {};
    const inter = tam * 1.32;
    const ls = lineasRico(texto, ancho, tam);
    ls.forEach((ln, i) => {
      if (y + inter > H - BOT) { nueva(); cabeceraCont(); }
      const base = y + tam;
      if (o.centro) { const ww = ln.w; dibujarLinea(ln, x + (ancho - ww) / 2, base, tam, ancho, false); } else dibujarLinea(ln, x, base, tam, ancho, o.justificar !== false);
      y += inter; void i;
    });
    y += o.despues === undefined ? 4 : o.despues;
  };

  const logosArriba = (alto) => {
    const m = logos.marca; const c = logos.cliente;
    if (!m) return;
    const wm = alto * m.w / m.h;
    const wc = c ? alto * c.w / c.h : 0;
    const total = wm + (c ? wc + 14 : 0);
    let x = (W - total) / 2;
    pag.logo = true;
    if (c) { pag.logo2 = true; pag.ops.push(`q ${wc.toFixed(2)} 0 0 ${alto} ${x.toFixed(2)} ${Y(y + alto)} cm /Im2 Do Q`); x += wc + 14; }
    pag.ops.push(`q ${wm.toFixed(2)} 0 0 ${alto} ${x.toFixed(2)} ${Y(y + alto)} cm /Im1 Do Q`);
    y += alto + 6;
  };
  const cabeceraPrimera = (doc, conMoneda) => {
    logosArriba(logos.cliente ? 42 : 48);
    const cx = W / 2;
    TC(emp.nombre.toUpperCase(), cx, y + 13, 13.5, true); y += 18;
    if (emp.ruc) { TC(emp.ruc, cx, y + 9, 9, false, GRIS); y += 13; }
    y += 3;
    TC(doc.titulo, cx, y + 12, 12.5, true); y += 17;
    if (doc.subtitulo) { TC(doc.subtitulo, cx, y + 10, 9.5, false); y += 14; }
    if (conMoneda !== false) { TC('(Expresado en balboas (B/.), moneda funcional y de presentación; cifras exactas, sin redondeo)', cx, y + 8, 8, false, GRIS); y += 13; }
    y += 6;
  };
  function cabeceraCont() {
    const cx = W / 2;
    TC(emp.nombre.toUpperCase(), cx, y + 10, 10, true); y += 13;
    TC(`${String(docAct.titulo).split('\n')[0]} (continuación)`, cx, y + 9, 9, true); y += 13;
    if (docAct.subtitulo) { TC(docAct.subtitulo, cx, y + 8, 8, false, GRIS); y += 11; }
    y += 6;
    if (docAct.reponerCols) docAct.reponerCols();
  }

  /* ------------------------------- portada ------------------------------- */
  const dibujarPortada = (doc) => {
    nueva(); docAct = doc; y = 70;
    logosArriba(logos.cliente ? 78 : 96); y += 22;
    const cx = W / 2;
    TC(emp.nombre.toUpperCase(), cx, y + 18, 18, true); y += 26;
    if (emp.ruc) { TC(emp.ruc, cx, y + 10, 10.5, false, GRIS); y += 18; }
    y += 24;
    doc.lineas.forEach((l, i) => { TC(l, cx, y + 16, i === 0 ? 20 : 12.5, i === 0); y += i === 0 ? 30 : 19; });
    y += 12; L(cx - 90, y, cx + 90, 1, '0.043 0.420 0.341'); y += 26;
    if (doc.contenido && doc.contenido.length) {
      TC('Contenido', cx, y + 11, 11, true); y += 22;
      doc.contenido.forEach((l) => { TC(l, cx, y + 9, 9.5, false); y += 14.5; });
    }
    if (doc.firma && doc.firma.length) {
      y = Math.max(y + 24, 620);
      doc.firma.forEach((l, i) => { TC(l, cx, y + 9, i === 0 ? 10 : 8.5, i === 0, i === 0 ? '0 0 0' : GRIS); y += i === 0 ? 14 : 12; });
    }
  };

  /* ------------------------------- estados ------------------------------- */
  const COLW = 86; const GAP = 10;
  const dibujarFirmas = (firmas) => {
    if (!firmas || !firmas.length) return;
    const alto = 52;
    if (y + alto + 10 > H - BOT) { nueva(); cabeceraCont(); }
    y += 26;
    const n = firmas.length; const ancho = (UTIL - 30 * (n - 1)) / n;
    firmas.forEach((f, i) => {
      const x = ML + i * (ancho + 30);
      L(x, y, x + ancho, 0.7);
      f.forEach((l, k) => TC(l, x + ancho / 2, y + 10 + k * 10.5, k === 0 ? 8.5 : 8, k === 0, k === 0 ? '0 0 0' : GRIS));
    });
    y += alto - 24;
  };

  const dibujarEstado = (doc) => {
    nueva(); docAct = doc;
    const xR = W - MR; const xP = xR - COLW; const xA = xP - GAP - COLW; const xN = xA - GAP - 30;
    const anchoEt = xN - 4 - ML;
    const colsEncabezado = () => {
      const base = y + 11;
      TC('Notas', xN + 15, base, 8.5, true);
      TC(String(doc.anios[0]), xA + COLW / 2, base, 9, true);
      TC(String(doc.anios[1]), xP + COLW / 2, base, 9, true);
      y += 16; L(ML, y, xR, 0.8); y += 5;
    };
    docAct.reponerCols = colsEncabezado;
    cabeceraPrimera(doc);
    colsEncabezado();
    for (const f of doc.filas) {
      const k = f.k;
      const neg = k === 'titulo' || k === 'sub' || k === 'subtotal' || k === 'total';
      const tam = k === 'titulo' ? 9.5 : 9;
      const sang = (f.n || 0) * 11;
      if (k === 'texto') {
        const ls = lineasRico(f.c, UTIL - 6, 8.2);
        const alto = ls.length * 10.8 + 3;
        if (y + alto > H - BOT) { nueva(); cabeceraCont(); }
        ls.forEach((ln, i) => dibujarLinea(ln, ML + 3, y + 8.2 + i * 10.8, 8.2, UTIL - 6, true));
        y += alto; continue;
      }
      const ls = lineasRico(neg ? `**${sinMarcas(f.c)}**` : sinMarcas(f.c), anchoEt - sang, tam);
      const inter = tam + 3.2;
      const alto = ls.length * inter + (k === 'titulo' ? 7 : 2.6) + (k === 'total' ? 3 : 0);
      if (y + alto + (k === 'titulo' ? 12 : 0) > H - BOT) { nueva(); cabeceraCont(); }
      if (k === 'titulo') y += 5;
      const base0 = y + tam + 1.6;
      ls.forEach((ln, i) => dibujarLinea(ln, ML + sang, base0 + i * inter, tam, anchoEt - sang, false));
      const baseNum = base0 + (ls.length - 1) * inter;
      if (f.nota) TC(String(f.nota), xN + 15, baseNum, 8.5, false);
      const val = [[xA, f.a], [xP, f.p]];
      val.forEach(([x, v]) => {
        if (v === null || v === undefined || k === 'titulo') return;
        const t = nf(v, f.f);
        if (f.m && f.f !== 'pct') T('B/.', x, baseNum, tam, neg);
        TD(t, x + COLW, baseNum, tam, neg);
      });
      if ((k === 'subtotal' || k === 'total') && f.a !== null && f.a !== undefined) {
        const topY = y + 0.4;
        [xA, xP].forEach((x) => L(x, topY, x + COLW, 0.7));
        if (k === 'total') [xA, xP].forEach((x) => { L(x, y + alto - 3.2, x + COLW, 0.7); L(x, y + alto - 1.2, x + COLW, 0.7); });
      }
      y += alto;
    }
    if (doc.pie) { y += 6; parrafo(doc.pie, ML, UTIL, 8, { justificar: false, despues: 2 }); }
    dibujarFirmas(doc.firmas);
  };

  /* ------------------------------- matriz (patrimonio) ------------------------------- */
  const dibujarMatriz = (doc) => {
    nueva(); docAct = doc;
    const nc = doc.columnas.length; const wv = 74; const xs = []; for (let i = 0; i < nc; i++) xs.push(W - MR - (nc - i) * wv);
    const anchoEt = xs[0] - 6 - ML;
    const colsEncabezado = () => {
      const ls = doc.columnas.map((c) => lineasRico(`**${c}**`, wv - 4, 8));
      const mx = Math.max(...ls.map((l) => l.length));
      ls.forEach((l, i) => l.forEach((ln, k) => TC(ln.p.map((p) => p.w).join(' '), xs[i] + wv / 2, y + 9 + k * 10, 8, true)));
      y += mx * 10 + 6; L(ML, y, W - MR, 0.8); y += 5;
    };
    docAct.reponerCols = colsEncabezado;
    cabeceraPrimera(doc);
    colsEncabezado();
    doc.bloques.forEach((b, bi) => {
      if (bi > 0) y += 8;
      if (b.titulo) { if (y + 30 > H - BOT) { nueva(); cabeceraCont(); } T(b.titulo, ML, y + 10, 9.5, true); y += 16; }
      b.filas.forEach((f) => {
        const neg = f.k === 'subtotal' || f.k === 'total';
        const ls = lineasRico(neg ? `**${sinMarcas(f.c)}**` : sinMarcas(f.c), anchoEt, 8.8);
        const alto = ls.length * 12.2 + 2.6 + (f.k === 'total' ? 3 : 0);
        if (y + alto > H - BOT) { nueva(); cabeceraCont(); }
        ls.forEach((ln, i) => dibujarLinea(ln, ML, y + 10.4 + i * 12.2, 8.8, anchoEt, false));
        f.v.forEach((v, i) => { if (v !== null && v !== undefined) { if (f.m && i === 0 && f.k !== 'det') T('B/.', xs[i] + 2, y + 10.4 + (ls.length - 1) * 12.2, 8.8, neg); TD(nf(v), xs[i] + wv - 3, y + 10.4 + (ls.length - 1) * 12.2, 8.8, neg); } });
        if (neg) xs.forEach((x) => L(x + 2, y + 0.4, x + wv - 1, 0.7));
        if (f.k === 'total') xs.forEach((x) => { L(x + 2, y + alto - 3.2, x + wv - 1, 0.7); L(x + 2, y + alto - 1.2, x + wv - 1, 0.7); });
        y += alto;
      });
    });
    if (doc.pie) { y += 6; parrafo(doc.pie, ML, UTIL, 8, { justificar: false, despues: 2 }); }
    dibujarFirmas(doc.firmas);
  };

  /* ------------------------------- notas ------------------------------- */
  const dibujarNotas = (doc) => {
    nueva(); docAct = doc;
    const xR = W - MR; const xP = xR - COLW; const xA = xP - GAP - COLW;
    const anchoEt = xA - 8 - ML;
    cabeceraPrimera(doc, false);
    TC('(Expresado en balboas (B/.); las notas son parte integral de los estados financieros)', W / 2, y - 2, 8, false, GRIS); y += 10;
    doc.notas.forEach((n) => {
      if (y + 70 > H - BOT) { nueva(); cabeceraCont(); }
      y += 6;
      T(`Nota ${n.num}. ${n.titulo}`, ML, y + 11, 10.5, true); y += 16;
      L(ML, y - 2, xR, 0.6, '0.043 0.420 0.341'); y += 2;
      if (n.ref) { parrafo(n.ref, ML, UTIL, 7.8, { justificar: false, despues: 3 }); }
      (n.parrafos || []).forEach((p) => parrafo(p, ML, UTIL, 9, { despues: 5 }));
      if (n.tabla && n.tabla.length) {
        const cab = () => { TC(String(doc.anios[0]), xA + COLW / 2, y + 9, 8.5, true); TC(String(doc.anios[1]), xP + COLW / 2, y + 9, 8.5, true); y += 12; L(xA, y, xR, 0.6); y += 3; };
        if (y + 40 > H - BOT) { nueva(); cabeceraCont(); }
        cab();
        n.tabla.forEach((f) => {
          const neg = f.k === 'sub' || f.k === 'total' || f.k === 'subtotal' || f.k === 'titulo';
          const sang = (f.n || 0) * 10 + (f.k === 'det' ? 8 : 0);
          const ls = lineasRico(neg ? `**${sinMarcas(f.c)}**` : sinMarcas(f.c), anchoEt - sang, 8.6);
          const alto = ls.length * 11.6 + 2.4 + (f.k === 'total' ? 3 : 0);
          if (y + alto > H - BOT) { nueva(); cabeceraCont(); cab(); }
          ls.forEach((ln, i) => dibujarLinea(ln, ML + sang, y + 9 + i * 11.6, 8.6, anchoEt - sang, false));
          const bn = y + 9 + (ls.length - 1) * 11.6;
          [[xA, f.a], [xP, f.p]].forEach(([x, v]) => {
            if (v === null || v === undefined) return;
            if (f.m && f.f !== 'pct') T('B/.', x, bn, 8.6, neg);
            TD(nf(v, f.f), x + COLW, bn, 8.6, neg);
          });
          if ((f.k === 'total' || f.k === 'subtotal') && f.a !== null && f.a !== undefined) {
            [xA, xP].forEach((x) => L(x, y + 0.4, x + COLW, 0.7));
            if (f.k === 'total') [xA, xP].forEach((x) => { L(x, y + alto - 3.2, x + COLW, 0.7); L(x, y + alto - 1.2, x + COLW, 0.7); });
          }
          y += alto;
        });
        y += 6;
      }
      y += 6;
    });
  };

  /* ------------------------------- carta (certificaciones) ------------------------------- */
  const dibujarCarta = (doc) => {
    nueva(); docAct = doc;
    logosArriba(logos.cliente ? 46 : 56);
    const cx = W / 2;
    if (doc.membrete) doc.membrete.forEach((l, i) => { TC(l, cx, y + 10, i === 0 ? 11 : 8.5, i === 0, i === 0 ? '0 0 0' : GRIS); y += i === 0 ? 14 : 11.5; });
    y += 8; L(ML, y, W - MR, 0.8, '0.043 0.420 0.341'); y += 14;
    String(doc.titulo).split('\n').forEach((t) => { TC(t, cx, y + 12, 12.5, true); y += 16.5; });
    y += 8;
    if (doc.campos && doc.campos.length) {
      const wE = 150;
      doc.campos.forEach(([e, v]) => {
        const ls = lineasRico(String(v || '—'), UTIL - wE - 6, 9.2);
        const alto = ls.length * 12 + 3;
        if (y + alto > H - BOT) { nueva(); cabeceraCont(); }
        T(e, ML + 2, y + 10, 8.8, true);
        ls.forEach((ln, i) => dibujarLinea(ln, ML + wE, y + 10 + i * 12, 9.2, UTIL - wE - 6, false));
        y += alto; L(ML, y, W - MR, 0.3, '0.82 0.85 0.84');
      });
      y += 6;
    }
    doc.parrafos.forEach((p) => {
      if (p.salto) { y += p.salto; return; }
      parrafo(p.t, ML, UTIL, p.size || 9.1, { centro: p.centro, despues: p.despues === undefined ? 4.5 : p.despues, justificar: !p.centro });
    });
    if (doc.firmas && doc.firmas.length) {
      const alto = 78;
      if (y + alto > H - BOT) { nueva(); cabeceraCont(); }
      y += 30;
      const n = doc.firmas.length; const ancho = (UTIL - 34 * (n - 1)) / n;
      doc.firmas.forEach((f, i) => {
        const x = ML + i * (ancho + 34);
        L(x, y, x + ancho, 0.8);
        f.lineas.forEach((l, k) => {
          const ls = lineasRico(k === 0 ? `**${sinMarcas(l)}**` : sinMarcas(l), ancho, k === 0 ? 8.8 : 8);
          ls.forEach((ln, j) => { const ww = ln.w; dibujarLinea(ln, x + (ancho - ww) / 2, y + 11 + (k + j) * 10.4 + (k > 0 ? (j ? 0 : 0) : 0), k === 0 ? 8.8 : 8, ancho, false); });
        });
      });
      y += alto - 30;
    }
  };

  docs.forEach((d) => {
    if (d.tipo === 'portada') dibujarPortada(d);
    else if (d.tipo === 'estado') dibujarEstado(d);
    else if (d.tipo === 'matriz') dibujarMatriz(d);
    else if (d.tipo === 'notas') dibujarNotas(d);
    else if (d.tipo === 'carta') dibujarCarta(d);
  });

  // Pie de cada página
  const total = paginas.length;
  paginas.forEach((p, i) => {
    const base = H - 26;
    p.ops.push(`0.82 0.85 0.84 RG 0.5 w ${ML} ${(H - 36).toFixed(2)} m ${W - MR} ${(H - 36).toFixed(2)} l S`);
    const izq = (p.doc && p.doc.pie2) || (p.doc && (p.doc.tipo === 'estado' || p.doc.tipo === 'matriz') ? 'Las notas que se acompañan son parte integral de estos estados financieros.' : `Generado el ${generado} · Contabilidad para Empresas · Demetrio Dutari Castro, CPA`);
    p.ops.push(`BT /F1 7.4 Tf ${GRIS} rg ${ML} ${base.toFixed(2)} Td (${literal(izq)}) Tj ET`);
    const t = `Página ${i + 1} de ${total}`;
    p.ops.push(`BT /F1 7.4 Tf ${GRIS} rg ${(W - MR - anchoTexto(t, 7.4, false)).toFixed(2)} ${base.toFixed(2)} Td (${literal(t)}) Tj ET`);
  });

  const objetos = [];
  const agregar = (c) => { objetos.push(c); return objetos.length; };
  agregar('<< /Type /Catalog /Pages 2 0 R >>');
  agregar('');
  agregar('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  agregar('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const img = (x) => agregar(`<< /Type /XObject /Subtype /Image /Width ${x.w} /Height ${x.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${x.datos.length} >>\nstream\n${x.datos}\nendstream`);
  const idImg = logos.marca && paginas.some((p) => p.logo) ? img(logos.marca) : 0;
  const idImg2 = logos.cliente && paginas.some((p) => p.logo2) ? img(logos.cliente) : 0;
  const ids = [];
  paginas.forEach((p) => {
    const contenido = p.ops.join('\n');
    const idC = agregar(`<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`);
    const xo = (p.logo && idImg) ? ` /XObject << /Im1 ${idImg} 0 R${p.logo2 && idImg2 ? ` /Im2 ${idImg2} 0 R` : ''} >>` : '';
    ids.push(agregar(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xo} >> /Contents ${idC} 0 R >>`));
  });
  objetos[1] = `<< /Type /Pages /Kids [${ids.map((i) => `${i} 0 R`).join(' ')}] /Count ${ids.length} >>`;
  const idInfo = agregar(`<< /Title (${literal(docs.map((d) => sinMarcas(d.titulo).replace(/\n/g, ' ')).join(' / '))}) /Producer (Contabilidad-Nueva) >>`);
  let salida = '%PDF-1.4\n'; const offsets = [];
  objetos.forEach((o, i) => { offsets.push(salida.length); salida += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = salida.length;
  salida += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => { salida += `${String(o).padStart(10, '0')} 00000 n \n`; });
  salida += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R /Info ${idInfo} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(salida.length);
  for (let i = 0; i < salida.length; i++) bytes[i] = salida.charCodeAt(i) & 0xff;
  return bytes;
}

/* ==================================== EXCEL =================================== */

// Índices de cellXfs
const X = {
  base: 0, titulo: 1, negCentro: 2, centro: 3, gris: 4, cabCentro: 5, cabIzq: 6, txt: 7, txt1: 8, txt2: 9, neg: 10,
  num: 11, numM: 12, numSub: 13, numSubM: 14, numTot: 15, pct: 16, parr: 17, negNota: 18, cabDer: 19
};
const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00;\\(#,##0.00\\);&quot;–&quot;"/><numFmt numFmtId="165" formatCode="&quot;B/. &quot;#,##0.00;\\(&quot;B/. &quot;#,##0.00\\);&quot;B/. –&quot;"/><numFmt numFmtId="166" formatCode="0.00&quot; %&quot;"/></numFmts>
<fonts count="5">
<font><sz val="10"/><name val="Arial"/></font>
<font><b/><sz val="10"/><name val="Arial"/></font>
<font><b/><sz val="13"/><name val="Arial"/></font>
<font><b/><sz val="11"/><name val="Arial"/></font>
<font><sz val="9"/><color rgb="FF5B6862"/><name val="Arial"/></font>
</fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="4">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top style="thin"><color auto="1"/></top><bottom/><diagonal/></border>
<border><left/><right/><top style="thin"><color auto="1"/></top><bottom style="double"><color auto="1"/></bottom><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="20">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="3" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="3" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1" indent="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1" indent="2"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
<xf numFmtId="165" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
<xf numFmtId="165" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="justify" vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="3" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function hojaDoc(doc, meta, logos) {
  const emp = empresaDe(meta);
  const conLogos = !!logos.marca;
  const matriz = doc.tipo === 'matriz';
  const nVal = matriz ? doc.columnas.length : 2;
  const anchos = matriz ? [46].concat(doc.columnas.map(() => 17)) : (doc.tipo === 'estado' ? [62, 8, 17, 17] : [64, 17, 17]);
  const nc = anchos.length;
  const ult = letraColumna(nc - 1);
  const filas = []; const uniones = [];
  let r = conLogos ? 5 : 1;
  const celda = (c, v, s) => {
    const ref = letraColumna(c) + r;
    if (v === null || v === undefined || v === '') return `<c r="${ref}" s="${s}"/>`;
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
    return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  };
  const centrada = (texto, s, alto) => {
    filas.push(`<row r="${r}"${alto ? ` ht="${alto}" customHeight="1"` : ''}>${celda(0, texto, s)}</row>`);
    if (nc > 1) uniones.push(`A${r}:${ult}${r}`);
    r++;
  };
  centrada(emp.nombre.toUpperCase(), X.titulo, 20);
  if (emp.ruc) centrada(emp.ruc, X.gris);
  centrada(doc.titulo, X.negCentro, 17);
  if (doc.subtitulo) centrada(doc.subtitulo, X.centro);
  if (doc.tipo !== 'notas') centrada('(Expresado en balboas (B/.); cifras exactas, sin redondeo)', X.gris);
  r++;
  let filaCong;
  {
    let cel = '';
    if (doc.tipo === 'estado') {
      cel = celda(0, 'Concepto', X.cabIzq) + celda(1, 'Notas', X.cabCentro) + celda(2, String(doc.anios[0]), X.cabDer) + celda(3, String(doc.anios[1]), X.cabDer);
    } else if (matriz) {
      cel = celda(0, 'Concepto', X.cabIzq); doc.columnas.forEach((c, i) => { cel += celda(i + 1, c, X.cabDer); });
    } else {
      cel = celda(0, 'Concepto', X.cabIzq) + celda(1, String(doc.anios[0]), X.cabDer) + celda(2, String(doc.anios[1]), X.cabDer);
    }
    filas.push(`<row r="${r}" ht="30" customHeight="1">${cel}</row>`); filaCong = r; r++;
  }
  const altoTexto = (t, ancho) => Math.max(14, Math.ceil(String(t).length / (ancho * 1.05)) * 13 + 2);
  const filaNum = (f, colTxt, colVal) => {
    const k = f.k; const neg = k === 'titulo' || k === 'sub' || k === 'subtotal' || k === 'total';
    let sTxt = X.txt; if (neg) sTxt = X.neg; else if ((f.n || 0) === 1) sTxt = X.txt1; else if ((f.n || 0) >= 2) sTxt = X.txt2;
    const sNum = (v) => {
      if (f.f === 'pct') return X.pct;
      if (k === 'total') return X.numTot;
      if (k === 'subtotal') return f.m ? X.numSubM : X.numSub;
      void v; return f.m ? X.numM : X.num;
    };
    let cel = celda(0, sinMarcas(f.c), sTxt);
    if (colTxt !== null && colTxt !== undefined) cel += celda(1, f.nota ? String(f.nota) : null, X.negNota);
    colVal.forEach((v, i) => { cel += celda(i + (doc.tipo === 'estado' ? 2 : 1), (k === 'titulo' ? null : v), sNum(v)); });
    filas.push(`<row r="${r}" ht="${altoTexto(sinMarcas(f.c), anchos[0])}" customHeight="1">${cel}</row>`); r++;
  };
  if (doc.tipo === 'estado') {
    doc.filas.forEach((f) => {
      if (f.k === 'texto') {
        let cel = celda(0, sinMarcas(f.c), X.parr); for (let k = 1; k < nc; k++) cel += celda(k, null, X.parr);
        filas.push(`<row r="${r}" ht="${altoTexto(sinMarcas(f.c), 118)}" customHeight="1">${cel}</row>`); uniones.push(`A${r}:${ult}${r}`); r++; return;
      }
      filaNum(f, 1, [f.a, f.p]);
    });
  } else if (matriz) {
    doc.bloques.forEach((b) => {
      if (b.titulo) { filas.push(`<row r="${r}">${celda(0, b.titulo, X.neg)}</row>`); r++; }
      b.filas.forEach((f) => filaNum(f, null, f.v));
      r++;
    });
  } else if (doc.tipo === 'notas') {
    doc.notas.forEach((n) => {
      filas.push(`<row r="${r}" ht="18" customHeight="1">${celda(0, `Nota ${n.num}. ${n.titulo}`, X.neg)}</row>`); r++;
      if (n.ref) { let cel = celda(0, n.ref, X.gris); for (let k = 1; k < nc; k++) cel += celda(k, null, X.gris); filas.push(`<row r="${r}">${cel}</row>`); uniones.push(`A${r}:${ult}${r}`); r++; }
      (n.parrafos || []).forEach((p) => {
        const t = sinMarcas(p);
        let cel = celda(0, t, X.parr); for (let k = 1; k < nc; k++) cel += celda(k, null, X.parr);
        filas.push(`<row r="${r}" ht="${Math.max(15, t.split('\n').reduce((s, l) => s + Math.max(1, Math.ceil(l.length / 112)), 0) * 13 + 3)}" customHeight="1">${cel}</row>`);
        uniones.push(`A${r}:${ult}${r}`); r++;
      });
      if (n.tabla && n.tabla.length) n.tabla.forEach((f) => filaNum(f, null, [f.a, f.p]));
      r++;
    });
  }
  if (doc.pie) { r++; let cel = celda(0, sinMarcas(doc.pie), X.gris); for (let k = 1; k < nc; k++) cel += celda(k, null, X.gris); filas.push(`<row r="${r}" ht="${altoTexto(doc.pie, 118)}" customHeight="1">${cel}</row>`); uniones.push(`A${r}:${ult}${r}`); r++; }
  void nVal;
  const colsXml = anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const union = uniones.length ? `<mergeCells count="${uniones.length}">${uniones.map((u) => `<mergeCell ref="${u}"/>`).join('')}</mergeCells>` : '';
  const anchoPx = anchos.reduce((s, w) => s + Math.round(w * 7 + 5), 0);
  const dibujo = conLogos ? '<drawing r:id="rId1"/>' : '';
  const xmlHoja = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${ult}${r}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="${filaCong}" topLeftCell="A${filaCong + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="14"/><cols>${colsXml}</cols><sheetData>${filas.join('')}</sheetData>${union}<pageMargins left="0.6" right="0.6" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="${matriz ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>${dibujo}</worksheet>`;
  return { xml: xmlHoja, anchoPx };
}

function logosXml(logos, anchoPx) {
  const alto = 50 * 12700; const y = 3 * 12700;
  const wm = Math.round(alto * logos.marca.w / logos.marca.h);
  const wc = logos.cliente ? Math.round(alto * logos.cliente.w / logos.cliente.h) : 0;
  const gap = logos.cliente ? 14 * 9525 : 0;
  const total = wm + wc + gap;
  let x = Math.max(0, Math.round((anchoPx * 9525 - total) / 2));
  const pic = (id, nombre, rid, xx, w) => `<xdr:absoluteAnchor><xdr:pos x="${xx}" y="${y}"/><xdr:ext cx="${w}" cy="${alto}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="${nombre}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="${xx}" y="${y}"/><a:ext cx="${w}" cy="${alto}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:absoluteAnchor>`;
  let out = '';
  if (logos.cliente) { out += pic(100, 'Logo empresa', 'rId2', x, wc); x += wc + gap; }
  out += pic(101, 'Logo', 'rId1', x, wm);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${out}</xdr:wsDr>`;
}

function nombreHoja(nombre, usados) {
  const base = String(nombre || 'Hoja').replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Hoja';
  let n = base; let i = 2;
  while (usados.includes(n.toLowerCase())) { const suf = ` (${i++})`; n = base.slice(0, 31 - suf.length) + suf; }
  usados.push(n.toLowerCase());
  return n;
}

export function construirXlsxPymes(docs, meta) {
  const logos = logosDe(meta);
  const hojasDocs = docs.filter((d) => d.tipo === 'estado' || d.tipo === 'matriz' || d.tipo === 'notas');
  const usados = [];
  const nombres = hojasDocs.map((d) => nombreHoja(d.hoja || d.titulo, usados));
  const hojas = hojasDocs.map((d) => hojaDoc(d, meta, logos));
  const conLogos = !!logos.marca;
  const a = [];
  a.push(['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}${conLogos ? hojas.map((_, i) => `<Override PartName="/xl/drawings/drawing${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`).join('') : ''}</Types>`]);
  a.push(['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`]);
  a.push(['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${nombres.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`]);
  a.push(['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`]);
  a.push(['xl/styles.xml', ESTILOS]);
  hojas.forEach((hj, i) => {
    a.push([`xl/worksheets/sheet${i + 1}.xml`, hj.xml]);
    if (conLogos) {
      a.push([`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${i + 1}.xml"/></Relationships>`]);
      a.push([`xl/drawings/drawing${i + 1}.xml`, logosXml(logos, hj.anchoPx)]);
      a.push([`xl/drawings/_rels/drawing${i + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo-marca.jpg"/>${logos.cliente ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo-empresa.jpg"/>' : ''}</Relationships>`]);
    }
  });
  if (conLogos) {
    a.push(['xl/media/logo-marca.jpg', logos.marca.bytes]);
    if (logos.cliente) a.push(['xl/media/logo-empresa.jpg', logos.cliente.bytes]);
  }
  return zip(a);
}

export { MIME_XLSX };

// FIN DEL ARCHIVO efpymespdf.js
