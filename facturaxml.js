// Lectura del XML de la factura electrónica de la DGI (Panamá) -> datos para el formulario
// No usa librerías ni el DOM: lee el texto del archivo directamente.

function decodificar(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

// Árbol simple: { n: nombre sin prefijo, t: texto, h: hijos }
export function parsearXml(src) {
  const raiz = { n: '#raiz', t: '', h: [] };
  const pila = [raiz];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w:.\-]*)([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[1] !== undefined) { pila[pila.length - 1].t += m[1]; continue; }
    if (m[3]) {
      const nombre = m[3].split(':').pop();
      if (m[2]) {
        if (pila.length > 1) pila.pop();
      } else {
        const nodo = { n: nombre, t: '', h: [] };
        pila[pila.length - 1].h.push(nodo);
        if (!m[5]) pila.push(nodo);
      }
    } else if (m[6] !== undefined) {
      pila[pila.length - 1].t += decodificar(m[6]);
    }
  }
  return raiz;
}

// Primer descendiente (en profundidad) con ese nombre
function buscar(nodo, nombre) {
  if (!nodo) return null;
  for (const hijo of nodo.h) {
    if (hijo.n === nombre) return hijo;
    const r = buscar(hijo, nombre);
    if (r) return r;
  }
  return null;
}

function buscarTodos(nodo, nombre, salida = []) {
  if (!nodo) return salida;
  for (const hijo of nodo.h) {
    if (hijo.n === nombre) salida.push(hijo);
    buscarTodos(hijo, nombre, salida);
  }
  return salida;
}

function valor(nodo, nombre) {
  const n = buscar(nodo, nombre);
  const t = n ? n.t.trim() : '';
  return t === '' ? null : t;
}

function numero(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

const norm = (v) => String(v || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();

function persona(grupo, grupoRuc, nombreTag) {
  if (!grupo) return { nombre: null, ruc: null, dv: null, direccion: null };
  return {
    nombre: valor(grupo, nombreTag),
    ruc: valor(buscar(grupo, grupoRuc), 'dRuc'),
    dv: valor(buscar(grupo, grupoRuc), 'dDV'),
    direccion: valor(grupo, 'dDirecEm') || valor(grupo, 'dDirecRec') || null
  };
}

function buscarCufe(raiz, texto, emisor, pto, nro) {
  const dCufe = valor(raiz, 'dCUFE');
  if (dCufe) return dCufe;
  const dId = valor(raiz, 'dId');
  if (dId && /^FE/i.test(dId)) return dId;
  const m = /\bFE[0-9A-Za-z\-]{30,}/.exec(texto);
  if (m) return m[0];
  return 'SIN-CUFE:' + norm(emisor.ruc) + '|' + norm(pto) + '|' + norm(nro);
}

// empresa: { ruc, dv } de la empresa activa
export function leerFacturaXml(texto, empresa) {
  const raiz = parsearXml(String(texto || '').replace(/^﻿/, ''));
  const rfe = buscar(raiz, 'rFE') || buscar(raiz, 'rFe');
  const gDGen = buscar(rfe || raiz, 'gDGen');
  if (!gDGen) {
    throw new Error('Este archivo no parece una factura electrónica de la DGI (no encontré los datos generales). Si es un PDF o una foto, usa "Elegir imagen o PDF".');
  }
  const base = rfe || raiz;

  const nro = valor(gDGen, 'dNroDF');
  const pto = valor(gDGen, 'dPtoFacDF');
  const fechaTxt = valor(gDGen, 'dFechaEm');
  const fecha = fechaTxt && /^\d{4}-\d{2}-\d{2}/.test(fechaTxt) ? fechaTxt.slice(0, 10) : null;

  const emisor = persona(buscar(gDGen, 'gEmis'), 'gRucEmi', 'dNombEm');
  const receptor = persona(buscar(gDGen, 'gDatRec'), 'gRucRec', 'dNombRec');

  const gTot = buscar(base, 'gTot');
  let total = numero(valor(gTot, 'dVTot'));
  if (total === null) total = numero(valor(gTot, 'dTotRec'));
  const itbms = numero(valor(gTot, 'dTotITBMS')) ?? 0;
  let subtotal = numero(valor(gTot, 'dTotNeto'));
  const avisos = [];
  if (total !== null) {
    const calc = Math.round((total - itbms) * 100) / 100;
    if (subtotal === null) subtotal = calc;
    else if (Math.abs(subtotal + itbms - total) > 0.011) {
      avisos.push('El subtotal más el ITBMS no suma el total de la factura (puede haber otros impuestos o descuentos). Se usó el total menos el ITBMS como monto bruto.');
      subtotal = calc;
    }
  }
  if (total === null && subtotal === null) {
    throw new Error('No encontré los totales de la factura en el archivo.');
  }

  const items = buscarTodos(base, 'gItem').map((it) => ({
    descripcion: valor(it, 'dDescProd'),
    cantidad: numero(valor(it, 'dCantCodInt')),
    precio_unitario: numero(valor(it, 'dPrUnit')),
    total: numero(valor(it, 'dValTotItem'))
  }));
  const nombres = items.map((i) => i.descripcion).filter(Boolean);
  let descripcion = nombres.slice(0, 3).join(', ');
  if (nombres.length > 3) descripcion += ' y otros';
  if (descripcion.length > 120) descripcion = descripcion.slice(0, 117) + '...';

  const rucEmp = norm(empresa && empresa.ruc);
  let rol = null;
  if (rucEmp) {
    if (norm(emisor.ruc) === rucEmp) rol = 'emisor';
    else if (norm(receptor.ruc) === rucEmp) rol = 'receptor';
  }
  if (!rol) {
    avisos.push(rucEmp
      ? 'El RUC de la factura no coincide con el de esta empresa. Revisa el tipo de transacción y el contacto antes de guardar.'
      : 'La empresa no tiene RUC registrado, así que no pude saber si es compra o venta. Revisa el tipo de transacción.');
  }

  const iDoc = valor(gDGen, 'iDoc');
  if (iDoc && iDoc !== '01') {
    avisos.push('El tipo de documento de este XML es ' + iDoc + ' (no es una factura de operación interna). Si es una nota de crédito, anula o corrige la factura original en lugar de registrarla como compra o venta.');
  }

  const formaCodigo = valor(buscar(gTot, 'gFormaPago'), 'iFormaPago');
  const forma = formaCodigo === '01' ? 'credito' : 'contado';
  if (formaCodigo === '01') avisos.push('La factura indica pago a crédito.');

  const cufe = buscarCufe(base, String(texto), emisor, pto, nro);

  return {
    emisor, receptor,
    numero_factura: nro,
    fecha,
    subtotal, itbms, total,
    descripcion: descripcion || null,
    items,
    cuenta_sugerida: null,
    confianza: 'alta',
    observaciones: ['Leída del XML de la DGI (sin IA).', ...avisos].join(' '),
    cufe,
    rol,
    forma
  };
}

// FIN DEL ARCHIVO facturaxml.js
