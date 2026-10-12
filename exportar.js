// Exportar informes a Excel (.xlsx) y PDF, sin librerías externas.
// Cada informe se describe con una "especificación":
//   { titulo, subtitulo, columnas: [{ t, num, w }], grupos: [{ t, n, r }],
//     filas: [{ c: [valores], e: 'normal' | 'n1' | 'n2' | 'grupo' | 'total' }],
//     notas: [texto], horizontal: true|false, hoja: 'Nombre de la hoja' }
// Los valores numéricos van como número; null deja la celda vacía.

const enc = new TextEncoder();

/* ================================ utilidades ============================== */

const pad2 = (n) => String(n).padStart(2, '0');
function ahoraTexto() {
  const d = new Date();
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
export function n2(v) {
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function fmt(v) {
  const t = n2(Math.abs(v));
  return v < 0 && t !== '0.00' ? `(${t})` : t;
}
function celdaTexto(v) {
  if (v === null || v === undefined || v === '') return '';
  return typeof v === 'number' ? fmt(v) : String(v);
}
function encabezadoEmpresa(meta) {
  const e = (meta && meta.empresa) || {};
  const ruc = e.ruc ? `RUC ${e.ruc}${e.dv ? ' DV ' + e.dv : ''}` : '';
  return { nombre: e.razon_social || '', ruc };
}

/* ==================================== ZIP ================================= */

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function unir(partes) {
  let total = 0;
  partes.forEach((p) => { total += p.length; });
  const out = new Uint8Array(total);
  let pos = 0;
  partes.forEach((p) => { out.set(p, pos); pos += p.length; });
  return out;
}
function zip(archivos) {
  const d = new Date();
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const fecha = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const locales = []; const centrales = []; let pos = 0;
  for (const [nombre, contenido] of archivos) {
    const nom = enc.encode(nombre);
    const datos = typeof contenido === 'string' ? enc.encode(contenido) : contenido;
    const crc = crc32(datos);
    const loc = new DataView(new ArrayBuffer(30));
    loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(6, 0x0800, true);
    loc.setUint16(8, 0, true); loc.setUint16(10, hora, true); loc.setUint16(12, fecha, true);
    loc.setUint32(14, crc, true); loc.setUint32(18, datos.length, true); loc.setUint32(22, datos.length, true);
    loc.setUint16(26, nom.length, true); loc.setUint16(28, 0, true);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true); cen.setUint16(12, hora, true);
    cen.setUint16(14, fecha, true); cen.setUint32(16, crc, true); cen.setUint32(20, datos.length, true);
    cen.setUint32(24, datos.length, true); cen.setUint16(28, nom.length, true);
    cen.setUint32(42, pos, true);
    locales.push(new Uint8Array(loc.buffer), nom, datos);
    centrales.push(new Uint8Array(cen.buffer), nom);
    pos += 30 + nom.length + datos.length;
  }
  const tamCentral = centrales.reduce((s, p) => s + p.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, archivos.length, true);
  fin.setUint16(10, archivos.length, true); fin.setUint32(12, tamCentral, true); fin.setUint32(16, pos, true);
  return unir([...locales, ...centrales, new Uint8Array(fin.buffer)]);
}

/* =================================== XLSX ================================= */

const xml = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function letraColumna(i) {
  let s = ''; let n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// Estilos (índices de cellXfs)
const XF = {
  base: 0, titulo: 1, negrita: 2, nota: 3, cabCentro: 4, cabIzq: 5,
  num: 6, numNeg: 7, numTotal: 8, txtTotal: 9, txtGrupo: 10, numGrupo: 11, txtAjuste: 12,
  txtNegrita: 13, cabDer: 14
};
const ESTILOS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00;\(#,##0.00\)"/></numFmts>
<fonts count="5">
<font><sz val="10"/><name val="Arial"/></font>
<font><b/><sz val="10"/><name val="Arial"/></font>
<font><b/><sz val="14"/><name val="Arial"/></font>
<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
<font><i/><sz val="9"/><color rgb="FF5B6862"/><name val="Arial"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF0B6B57"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEEF3F1"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top style="thin"><color auto="1"/></top><bottom/><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="15">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
<xf numFmtId="164" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="164" fontId="1" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function estiloFila(e, esNum) {
  if (e === 'total') return esNum ? XF.numTotal : XF.txtTotal;
  if (e === 'grupo') return esNum ? XF.numGrupo : XF.txtGrupo;
  if (e === 'n1' || e === 'n2') return esNum ? XF.numNeg : XF.txtNegrita;
  return esNum ? XF.num : XF.txtAjuste;
}

function nombreHoja(nombre, usados) {
  let base = String(nombre || 'Hoja').replace(/[\[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Hoja';
  let n = base; let i = 2;
  while (usados.includes(n.toLowerCase())) { const suf = ` (${i++})`; n = base.slice(0, 31 - suf.length) + suf; }
  usados.push(n.toLowerCase());
  return n;
}

function hojaXml(spec, meta) {
  const emp = encabezadoEmpresa(meta);
  const cols = spec.columnas;
  const nc = cols.length;
  const filas = []; const uniones = [];
  let r = 1;
  const celda = (c, v, s) => {
    const ref = letraColumna(c) + r;
    if (v === null || v === undefined || v === '') return `<c r="${ref}" s="${s}"/>`;
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
    return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  };
  const filaSimple = (texto, s) => { filas.push(`<row r="${r}">${celda(0, texto, s)}</row>`); r++; };

  filaSimple(emp.nombre, XF.titulo);
  if (emp.ruc) filaSimple(emp.ruc, XF.nota);
  filaSimple(spec.titulo, XF.negrita);
  if (spec.subtitulo) filaSimple(spec.subtitulo, XF.base);
  filaSimple('Cifras expresadas en balboas (B/.)', XF.nota);
  r++; // fila en blanco

  let filaCongelar;
  if (spec.grupos) {
    const f1 = r; let c = 0; let cel = '';
    const cubiertas = new Set();
    for (const g of spec.grupos) {
      for (let k = 0; k < g.n; k++) { cel += celda(c + k, k === 0 ? g.t : null, g.n > 1 ? XF.cabCentro : XF.cabIzq); if (g.r === 2) cubiertas.add(c + k); }
      if (g.n > 1) uniones.push(`${letraColumna(c)}${f1}:${letraColumna(c + g.n - 1)}${f1}`);
      if (g.r === 2) uniones.push(`${letraColumna(c)}${f1}:${letraColumna(c)}${f1 + 1}`);
      c += g.n;
    }
    filas.push(`<row r="${f1}" ht="20" customHeight="1">${cel}</row>`); r++;
    let cel2 = '';
    cols.forEach((col, i) => { cel2 += celda(i, cubiertas.has(i) ? null : col.t, col.num ? XF.cabDer : XF.cabIzq); });
    filas.push(`<row r="${r}" ht="20" customHeight="1">${cel2}</row>`); filaCongelar = r; r++;
  } else {
    let cel = '';
    cols.forEach((col, i) => { cel += celda(i, col.t, col.num ? XF.cabDer : XF.cabIzq); });
    filas.push(`<row r="${r}" ht="20" customHeight="1">${cel}</row>`); filaCongelar = r; r++;
  }

  for (const f of spec.filas) {
    if (f.e === 'texto') {
      const sumaAnchos = cols.reduce((sm, col) => sm + (col.num ? 15 : 46), 0);
      const lineas = String(f.c[0] ?? '').split('\n').reduce((sm, p) => sm + Math.max(1, Math.ceil(p.length / (sumaAnchos * 0.95))), 0);
      let cel = celda(0, f.c[0], XF.txtAjuste);
      for (let k = 1; k < nc; k++) cel += celda(k, null, XF.txtAjuste);
      filas.push(`<row r="${r}" ht="${Math.max(14, lineas * 13 + 2)}" customHeight="1">${cel}</row>`);
      if (nc > 1) uniones.push(`A${r}:${letraColumna(nc - 1)}${r}`);
      r++;
      continue;
    }
    let cel = '';
    cols.forEach((col, i) => {
      const v = f.c[i];
      const esNum = !!col.num && typeof v !== 'string';
      cel += celda(i, v, estiloFila(f.e, esNum));
    });
    filas.push(`<row r="${r}">${cel}</row>`); r++;
  }
  if (spec.notas && spec.notas.length) {
    r++;
    spec.notas.forEach((t) => filaSimple(t, XF.nota));
  }

  const anchos = cols.map((col, i) => {
    if (col.num) return 15;
    const maxTxt = Math.max(String(col.t || '').length,
      ...spec.filas.slice(0, 200).filter((f) => f.e !== 'texto').map((f) => String(f.c[i] ?? '').length));
    return Math.max(12, Math.min(i === 0 ? 52 : 44, maxTxt + 2));
  });
  const colsXml = anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const union = uniones.length ? `<mergeCells count="${uniones.length}">${uniones.map((u) => `<mergeCell ref="${u}"/>`).join('')}</mergeCells>` : '';
  const ultima = `${letraColumna(nc - 1)}${r - 1}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${ultima}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="${filaCongelar}" topLeftCell="A${filaCongelar + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="14"/><cols>${colsXml}</cols><sheetData>${filas.join('')}</sheetData>${union}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="${spec.horizontal ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}

export function construirXlsx(specs, meta) {
  const usados = [];
  const nombres = specs.map((s) => nombreHoja(s.hoja || s.titulo, usados));
  const archivos = [];
  archivos.push(['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${specs.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`]);
  archivos.push(['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`]);
  archivos.push(['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${nombres.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`]);
  archivos.push(['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${specs.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${specs.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`]);
  archivos.push(['xl/styles.xml', ESTILOS_XML]);
  specs.forEach((s, i) => archivos.push([`xl/worksheets/sheet${i + 1}.xml`, hojaXml(s, meta)]));
  return zip(archivos);
}

/* ==================================== PDF ================================= */

const ANCHO_N = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,761,556,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500];
const ANCHO_B = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,761,556,0,278,556,500,1000,556,556,333,1000,667,333,1000,0,611,0,0,278,278,500,500,350,556,1000,333,1000,556,333,944,0,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556];
const CP1252 = { 8364: 0x80, 8218: 0x82, 402: 0x83, 8222: 0x84, 8230: 0x85, 8224: 0x86, 8225: 0x87, 710: 0x88, 8240: 0x89, 352: 0x8a, 8249: 0x8b, 338: 0x8c, 381: 0x8e, 8216: 0x91, 8217: 0x92, 8220: 0x93, 8221: 0x94, 8226: 0x95, 8211: 0x96, 8212: 0x97, 732: 0x98, 8482: 0x99, 353: 0x9a, 8250: 0x9b, 339: 0x9c, 382: 0x9e, 376: 0x9f };

function codigo(ch) {
  const c = ch.charCodeAt(0);
  if (c >= 32 && c < 127) return c;
  if (c >= 160 && c <= 255) return c;
  if (CP1252[c]) return CP1252[c];
  if (c === 9 || c === 10 || c === 13) return 32;
  return 63; // ?
}
function anchoTexto(s, tam, negrita) {
  const tabla = negrita ? ANCHO_B : ANCHO_N;
  let w = 0;
  for (const ch of String(s)) { const c = codigo(ch); w += tabla[c - 32] || 0; }
  return (w * tam) / 1000;
}
function literal(s) {
  let o = '';
  for (const ch of String(s)) {
    const c = codigo(ch);
    if (c === 40 || c === 41 || c === 92) o += '\\' + String.fromCharCode(c);
    else if (c < 127) o += String.fromCharCode(c);
    else o += '\\' + c.toString(8).padStart(3, '0');
  }
  return o;
}
function partirLineas(texto, ancho, tam, negrita) {
  const out = [];
  for (const parrafo of String(texto).split(/\n/)) {
    const palabras = parrafo.split(/\s+/).filter(Boolean);
    let linea = '';
    for (let p of palabras) {
      while (anchoTexto(p, tam, negrita) > ancho && p.length > 1) {
        let k = p.length - 1;
        while (k > 1 && anchoTexto(p.slice(0, k), tam, negrita) > ancho) k--;
        if (linea) { out.push(linea); linea = ''; }
        out.push(p.slice(0, k)); p = p.slice(k);
      }
      const prueba = linea ? `${linea} ${p}` : p;
      if (anchoTexto(prueba, tam, negrita) <= ancho) linea = prueba;
      else { if (linea) out.push(linea); linea = p; }
    }
    out.push(linea);
  }
  return out.length ? out : [''];
}

const VERDE = '0.043 0.420 0.341';
const GRIS_FONDO = '0.933 0.953 0.945';
const GRIS_LINEA = '0.82 0.85 0.84';

export function construirPdf(specs, meta) {
  const emp = encabezadoEmpresa(meta);
  const generado = ahoraTexto();
  const paginas = [];

  specs.forEach((spec) => {
    const horiz = !!spec.horizontal;
    const W = horiz ? 841.89 : 595.28; const H = horiz ? 595.28 : 841.89;
    const M = 36; const util = W - 2 * M; const pie = 34;
    let pag = null; let y = 0;
    const nueva = () => { pag = { W, H, ops: [] }; paginas.push(pag); y = M; };
    const Y = (v) => (H - v).toFixed(2);
    const texto = (s, x, base, tam, neg, color) => {
      if (s === '' || s === null || s === undefined) return;
      pag.ops.push(`BT /${neg ? 'F2' : 'F1'} ${tam} Tf ${color || '0 0 0'} rg ${x.toFixed(2)} ${Y(base)} Td (${literal(s)}) Tj ET`);
    };
    const rect = (x, top, w, h, color) => pag.ops.push(`${color} rg ${x.toFixed(2)} ${Y(top + h)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
    const linea = (x1, y1, x2, color, grosor) => pag.ops.push(`${color} RG ${grosor || 0.5} w ${x1.toFixed(2)} ${Y(y1)} m ${x2.toFixed(2)} ${Y(y1)} l S`);

    nueva();
    // Bloque de encabezado del informe
    texto(emp.nombre, M, y + 11, 13, true); y += 16;
    if (emp.ruc) { texto(emp.ruc, M, y + 8, 8, false, '0.35 0.4 0.38'); y += 11; }
    texto(spec.titulo, M, y + 11, 11.5, true); y += 15;
    if (spec.subtitulo) { texto(spec.subtitulo, M, y + 9, 9); y += 12; }
    texto('Cifras expresadas en balboas (B/.)', M, y + 8, 8, false, '0.35 0.4 0.38'); y += 16;

    const cols = spec.columnas;
    let tam = horiz ? 7.5 : 8;
    let anchos;
    for (;;) {
      const fijos = cols.map((c) => {
        if (!c.num) return 0;
        let mx = anchoTexto('(9,999,999.99)', tam, true);
        spec.filas.forEach((f) => { const v = f.c[cols.indexOf(c)]; if (typeof v === 'string') mx = Math.max(mx, Math.min(anchoTexto(v, tam, true), 90)); });
        return mx + 8;
      });
      const sumaFijos = fijos.reduce((s, v) => s + v, 0);
      const libres = cols.filter((c) => !c.num);
      const resto = util - sumaFijos;
      const pesos = libres.map((c) => c.w || 1);
      const sp = pesos.reduce((s, v) => s + v, 0) || 1;
      anchos = cols.map((c, i) => (c.num ? fijos[i] : (resto * (c.w || 1)) / sp));
      if (libres.length === 0 || resto / sp >= 38 || tam <= 6) {
        if (libres.length === 0) { const k = util / sumaFijos; anchos = fijos.map((v) => v * k); }
        break;
      }
      tam -= 0.5;
    }
    const xs = []; { let x = M; anchos.forEach((a) => { xs.push(x); x += a; }); }
    const pad = 3; const interlinea = tam + 2.5;

    const pintarCabecera = (celdas, top, alto) => celdas.forEach((c) => {
      if (c.t === null) return;
      rect(c.x, top, c.w, alto, VERDE);
      const ls = partirLineas(c.t, c.w - 2 * pad, tam, true);
      let by = top + (alto - ls.length * interlinea) / 2 + tam;
      ls.forEach((l) => {
        const w = anchoTexto(l, tam, true);
        texto(l, c.der ? c.x + c.w - pad - w : (c.centro ? c.x + (c.w - w) / 2 : c.x + pad), by, tam, true, '1 1 1'); by += interlinea;
      });
    });
    const altoCab = (txts) => Math.max(interlinea + 6, ...txts.map((t, i) => (t === null ? 0 : partirLineas(t, anchos[i] - 2 * pad, tam, true).length * interlinea + 5)));
    const dibujarCabeceraSegura = () => {
      if (!spec.grupos) {
        const alto = altoCab(cols.map((c) => c.t));
        if (y + alto > H - pie) nueva();
        pintarCabecera(cols.map((c, i) => ({ t: c.t, x: xs[i], w: anchos[i], der: !!c.num })), y, alto);
        y += alto;
        return;
      }
      let ci = 0; const g1 = []; const cubiertas = new Set();
      spec.grupos.forEach((g) => {
        const w = anchos.slice(ci, ci + g.n).reduce((sum, v) => sum + v, 0);
        g1.push({ t: g.t, x: xs[ci], w, centro: g.n > 1, r: g.r });
        if (g.r === 2) for (let k = 0; k < g.n; k++) cubiertas.add(ci + k);
        ci += g.n;
      });
      const alto1 = interlinea + 6;
      const alto2 = altoCab(cols.map((c, i) => (cubiertas.has(i) ? null : c.t)));
      if (y + alto1 + alto2 > H - pie) nueva();
      pintarCabecera(g1.filter((g) => g.r !== 2), y, alto1);
      pintarCabecera(g1.filter((g) => g.r === 2), y, alto1 + alto2);
      pintarCabecera(cols.map((c, i) => ({ t: cubiertas.has(i) ? null : c.t, x: xs[i], w: anchos[i], der: !!c.num })), y + alto1, alto2);
      g1.forEach((g) => pag.ops.push(`1 1 1 RG 0.6 w ${g.x.toFixed(2)} ${Y(y)} m ${g.x.toFixed(2)} ${Y(y + alto1 + alto2)} l S`));
      y += alto1 + alto2;
    };

    dibujarCabeceraSegura();

    for (const f of spec.filas) {
      if (f.e === 'texto') {
        const ls = partirLineas(celdaTexto(f.c[0]), util - 2 * pad, tam, false);
        const altoT = ls.length * interlinea + 6;
        if (y + altoT > H - pie) { nueva(); dibujarCabeceraSegura(); }
        ls.forEach((l, k) => texto(l, M + pad, y + 3 + tam + k * interlinea, tam, false));
        y += altoT;
        linea(M, y, M + util, GRIS_LINEA, 0.4);
        continue;
      }
      const neg = f.e === 'n1' || f.e === 'n2' || f.e === 'grupo' || f.e === 'total';
      const lineasCelda = cols.map((c, i) => {
        const t = celdaTexto(f.c[i]);
        if (c.num || typeof f.c[i] === 'number') return [t];
        return partirLineas(t, anchos[i] - 2 * pad, tam, neg);
      });
      const alto = Math.max(...lineasCelda.map((l) => l.length)) * interlinea + 4;
      if (y + alto > H - pie) { nueva(); dibujarCabeceraSegura(); }
      if (f.e === 'grupo' || f.e === 'total') rect(M, y, util, alto, GRIS_FONDO);
      if (f.e === 'total') linea(M, y, M + util, '0.2 0.2 0.2', 0.8);
      lineasCelda.forEach((ls, i) => {
        const esNum = cols[i].num || typeof f.c[i] === 'number';
        ls.forEach((l, k) => {
          const base = y + 2 + tam + k * interlinea;
          if (esNum) texto(l, xs[i] + anchos[i] - pad - anchoTexto(l, tam, neg), base, tam, neg);
          else texto(l, xs[i] + pad, base, tam, neg);
        });
      });
      y += alto;
      linea(M, y, M + util, GRIS_LINEA, 0.4);
    }

    if (spec.notas && spec.notas.length) {
      y += 8;
      spec.notas.forEach((n) => {
        partirLineas(n, util, 7.5, false).forEach((l) => {
          if (y + 10 > H - pie) nueva();
          texto(l, M, y + 7.5, 7.5, false, '0.35 0.4 0.38'); y += 10;
        });
      });
    }
  });

  // Pie de página con numeración
  const total = paginas.length;
  paginas.forEach((p, i) => {
    const base = p.H - 22;
    p.ops.push(`0.82 0.85 0.84 RG 0.5 w 36 ${(p.H - 30).toFixed(2)} m ${(p.W - 36).toFixed(2)} ${(p.H - 30).toFixed(2)} l S`);
    p.ops.push(`BT /F1 7.5 Tf 0.35 0.4 0.38 rg 36 ${base.toFixed(2)} Td (${literal(`Generado el ${generado}`)}) Tj ET`);
    const t = `Página ${i + 1} de ${total}`;
    p.ops.push(`BT /F1 7.5 Tf 0.35 0.4 0.38 rg ${(p.W - 36 - anchoTexto(t, 7.5, false)).toFixed(2)} ${base.toFixed(2)} Td (${literal(t)}) Tj ET`);
  });

  // Estructura del PDF
  const objetos = [];
  const agregar = (cuerpo) => { objetos.push(cuerpo); return objetos.length; };
  agregar('<< /Type /Catalog /Pages 2 0 R >>');
  agregar(''); // se llena con las páginas
  agregar('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  agregar('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const ids = [];
  paginas.forEach((p) => {
    const contenido = p.ops.join('\n');
    const idC = agregar(`<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`);
    const idP = agregar(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.W.toFixed(2)} ${p.H.toFixed(2)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${idC} 0 R >>`);
    ids.push(idP);
  });
  objetos[1] = `<< /Type /Pages /Kids [${ids.map((i) => `${i} 0 R`).join(' ')}] /Count ${ids.length} >>`;
  const titulo = specs.map((s) => s.titulo).join(' / ');
  const idInfo = agregar(`<< /Title (${literal(titulo)}) /Producer (Contabilidad-Nueva) >>`);

  let salida = '%PDF-1.4\n';
  const offsets = [];
  objetos.forEach((o, i) => { offsets.push(salida.length); salida += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = salida.length;
  salida += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => { salida += `${String(o).padStart(10, '0')} 00000 n \n`; });
  salida += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R /Info ${idInfo} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(salida.length);
  for (let i = 0; i < salida.length; i++) bytes[i] = salida.charCodeAt(i) & 0xff;
  return bytes;
}

/* ================================ descargar ================================ */

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function descargar(bytes, nombre, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre; a.style.display = 'none';
  document.body.append(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
}

function nombreSeguro(s) {
  return String(s || 'informe').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60) || 'informe';
}

export function exportarExcel(specs, meta, archivo) {
  const nombre = nombreSeguro(archivo) + '.xlsx';
  descargar(construirXlsx(specs, meta), nombre, MIME_XLSX);
  return nombre;
}

export function exportarPdf(specs, meta, archivo) {
  const nombre = nombreSeguro(archivo) + '.pdf';
  descargar(construirPdf(specs, meta), nombre, 'application/pdf');
  return nombre;
}

// FIN DEL ARCHIVO exportar.js
