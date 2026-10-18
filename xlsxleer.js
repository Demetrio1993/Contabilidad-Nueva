// Lector de archivos Excel (.xlsx) sin librerías externas.
// Un .xlsx es un ZIP con XML dentro; se descomprime con DecompressionStream
// (disponible en Chrome y en los navegadores actuales del teléfono).
// leerLibro(buffer, ['Hoja1', 'Hoja2']) -> { nombres: [...], hojas: { Hoja1: [[celdas de la fila 1], ...] } }
// Cada fila es un arreglo por columna (A = 0); las celdas vacías son null.
// Las fechas llegan como número de serie de Excel; usa serialAFecha() para convertirlas.

const dec = new TextDecoder('utf-8');

async function inflar(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const flujo = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

// Lee el directorio central del ZIP y devuelve { nombre: { metodo, tam, offset } }
function directorioZip(u8) {
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let fin = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error('El archivo no es un Excel válido (.xlsx).');
  const total = v.getUint16(fin + 10, true);
  let pos = v.getUint32(fin + 16, true);
  const mapa = {};
  for (let n = 0; n < total; n++) {
    if (v.getUint32(pos, true) !== 0x02014b50) break;
    const metodo = v.getUint16(pos + 10, true);
    const tam = v.getUint32(pos + 20, true);
    const lnom = v.getUint16(pos + 28, true);
    const lextra = v.getUint16(pos + 30, true);
    const lcom = v.getUint16(pos + 32, true);
    const offset = v.getUint32(pos + 42, true);
    const nombre = dec.decode(u8.subarray(pos + 46, pos + 46 + lnom));
    mapa[nombre] = { metodo, tam, offset };
    pos += 46 + lnom + lextra + lcom;
  }
  return mapa;
}

async function extraer(u8, mapa, nombre) {
  const e = mapa[nombre];
  if (!e) return null;
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const lnom = v.getUint16(e.offset + 26, true);
  const lextra = v.getUint16(e.offset + 28, true);
  const ini = e.offset + 30 + lnom + lextra;
  const datos = u8.subarray(ini, ini + e.tam);
  const bytes = e.metodo === 0 ? datos : await inflar(datos);
  return dec.decode(bytes);
}

function entidades(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, g) => {
    if (g === 'amp') return '&';
    if (g === 'lt') return '<';
    if (g === 'gt') return '>';
    if (g === 'quot') return '"';
    if (g === 'apos') return "'";
    const cod = g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
    return String.fromCodePoint(cod);
  });
}

function textosCompartidos(xml) {
  const lista = [];
  if (!xml) return lista;
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml))) {
    let t = '';
    const rt = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let x;
    while ((x = rt.exec(m[1]))) t += x[1];
    lista.push(entidades(t));
  }
  return lista;
}

function colANumero(ref) {
  const letras = /^[A-Z]+/.exec(ref)[0];
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

function leerHoja(xml, compartidos) {
  const filas = [];
  const reFila = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let m;
  while ((m = reFila.exec(xml))) {
    const rn = /\br="(\d+)"/.exec(m[1]);
    if (!rn || !m[2]) continue;
    const idx = parseInt(rn[1], 10) - 1;
    const fila = [];
    const reCelda = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let c;
    while ((c = reCelda.exec(m[2]))) {
      const ref = /\br="([A-Z]+\d+)"/.exec(c[1]);
      if (!ref || !c[2]) continue;
      const tipo = (/\bt="(\w+)"/.exec(c[1]) || [])[1] || 'n';
      let valor = null;
      if (tipo === 'inlineStr') {
        let t = '';
        const rt = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let x;
        while ((x = rt.exec(c[2]))) t += x[1];
        valor = entidades(t);
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(c[2]);
        if (v) {
          const crudo = v[1];
          if (tipo === 's') valor = compartidos[parseInt(crudo, 10)] ?? null;
          else if (tipo === 'str') valor = entidades(crudo);
          else if (tipo === 'b') valor = crudo === '1';
          else if (tipo === 'e') valor = null;
          else valor = crudo === '' ? null : Number(crudo);
        }
      }
      fila[colANumero(ref[1])] = valor;
    }
    filas[idx] = fila;
  }
  for (let i = 0; i < filas.length; i++) if (!filas[i]) filas[i] = [];
  return filas;
}

export async function leerLibro(buffer, nombresPedidos) {
  const u8 = new Uint8Array(buffer);
  const mapa = directorioZip(u8);
  const wb = await extraer(u8, mapa, 'xl/workbook.xml');
  const rels = await extraer(u8, mapa, 'xl/_rels/workbook.xml.rels');
  if (!wb || !rels) throw new Error('El archivo no es un Excel válido (.xlsx).');
  const destinos = {};
  const reRel = /<Relationship\b([^>]*)\/?>/g;
  let m;
  while ((m = reRel.exec(rels))) {
    const id = /\bId="([^"]+)"/.exec(m[1]);
    const tg = /\bTarget="([^"]+)"/.exec(m[1]);
    if (id && tg) destinos[id[1]] = tg[1].replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/');
  }
  const hojasXml = [];
  const reSheet = /<sheet\b([^>]*)\/?>/g;
  while ((m = reSheet.exec(wb))) {
    const nom = /\bname="([^"]*)"/.exec(m[1]);
    const rid = /\br:id="([^"]+)"/.exec(m[1]);
    if (nom && rid) hojasXml.push({ nombre: entidades(nom[1]), ruta: destinos[rid[1]] });
  }
  const compartidos = textosCompartidos(await extraer(u8, mapa, 'xl/sharedStrings.xml'));
  const hojas = {};
  for (const h of hojasXml) {
    if (nombresPedidos && !nombresPedidos.includes(h.nombre)) continue;
    const xml = await extraer(u8, mapa, h.ruta);
    if (xml) hojas[h.nombre] = leerHoja(xml, compartidos);
  }
  return { nombres: hojasXml.map((h) => h.nombre), hojas };
}

// Número de serie de Excel -> 'AAAA-MM-DD'
export function serialAFecha(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 1) return null;
  const ms = Math.round((n - 25569) * 86400000);
  const d = new Date(ms);
  return d.toISOString().slice(0, 10);
}

// FIN DEL ARCHIVO xlsxleer.js
