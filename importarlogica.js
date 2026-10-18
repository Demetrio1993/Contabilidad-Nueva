// Lógica (sin pantalla) de la importación del libro de Excel:
//  - encuentra la hoja del libro de transacciones, el balance inicial y el catálogo
//  - sugiere a qué cuenta del sistema corresponde cada cuenta del Excel
//  - arma las filas que se envían a la base de datos y avisa de problemas
import { serialAFecha } from './xlsxleer.js';

/* ------------------------------ utilidades ------------------------------ */
const sinAcentos = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const clave = (s) => sinAcentos(s).toLowerCase().replace(/[^a-z0-9]/g, '');

function textoCelda(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  return String(v).trim();
}
function codigoCuenta(v) {
  const t = textoCelda(v);
  return t.replace(/\.0$/, '');
}
function numeroCelda(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
function fechaCelda(v) {
  if (typeof v === 'number') return serialAFecha(v);
  const t = textoCelda(v);
  if (!t) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
const redondear2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/* ------------------------- hojas que se necesitan ------------------------ */
export function elegirHojas(nombres) {
  const busca = (...partes) => nombres.find((n) => partes.every((p) => clave(n).includes(p)));
  return {
    libro: busca('libro', 'transac') || busca('transacc'),
    balance: busca('balance', 'inicial'),
    catalogo: busca('catalogo')
  };
}

function buscarEncabezado(filas, requeridas) {
  for (let i = 0; i < Math.min(filas.length, 20); i++) {
    const celdas = (filas[i] || []).map((c) => clave(c));
    if (requeridas.every((r) => celdas.some((c) => c === r || c.startsWith(r)))) return i;
  }
  return -1;
}
function columna(celdas, ...opciones) {
  const cl = celdas.map((c) => clave(c));
  for (const op of opciones) {
    const i = cl.findIndex((c) => (op.exacto ? c === op.t : c.startsWith(op.t)));
    if (i >= 0) return i;
  }
  return -1;
}

/* ------------------------------ lectura ------------------------------ */
export function analizarLibro(libro, hojasElegidas) {
  const L = libro.hojas[hojasElegidas.libro];
  if (!L) throw new Error('No encontré la hoja "Libro Transacciones" en este Excel.');
  const ei = buscarEncabezado(L, ['fecha', 'ctadebe', 'ctahaber']);
  if (ei < 0) throw new Error('En la hoja del libro no encontré las columnas Fecha, Cta. Debe y Cta. Haber.');
  const enc = L[ei];
  const col = {
    n: columna(enc, { t: 'n', exacto: true }, { t: 'no', exacto: true }),
    fecha: columna(enc, { t: 'fecha', exacto: true }),
    tipoDoc: columna(enc, { t: 'tipodoc' }),
    factura: columna(enc, { t: 'nfactura' }, { t: 'nfacturadoc' }, { t: 'factura' }),
    tercero: columna(enc, { t: 'clienteproveedor' }, { t: 'cliente' }, { t: 'proveedor' }),
    ruc: columna(enc, { t: 'ruc', exacto: true }),
    dv: columna(enc, { t: 'dv', exacto: true }),
    desc: columna(enc, { t: 'descrip' }),
    ctaD: columna(enc, { t: 'ctadebe', exacto: true }),
    ctaH: columna(enc, { t: 'ctahaber', exacto: true }),
    montoD: columna(enc, { t: 'montodebe', exacto: true }),
    montoH: columna(enc, { t: 'montohaber', exacto: true }),
    clasif: columna(enc, { t: 'clasif' }),
    itbms: columna(enc, { t: 'itbms', exacto: true }),
    nombreD: columna(enc, { t: 'nombrecuentadebe' }),
    nombreH: columna(enc, { t: 'nombrecuentahaber' })
  };
  for (const k of ['fecha', 'ctaD', 'ctaH', 'montoD', 'montoH']) {
    if (col[k] < 0) throw new Error('En la hoja del libro falta la columna: ' + k);
  }
  const g = (fila, k) => (col[k] >= 0 ? fila[col[k]] : null);

  const filas = [];
  for (let i = ei + 1; i < L.length; i++) {
    const f = L[i] || [];
    const ctaD = codigoCuenta(g(f, 'ctaD'));
    const ctaH = codigoCuenta(g(f, 'ctaH'));
    const tieneFecha = g(f, 'fecha') !== null && g(f, 'fecha') !== undefined && g(f, 'fecha') !== '';
    if (!tieneFecha && !ctaD && !ctaH) continue;
    filas.push({
      n: i + 1,
      fechaOriginal: g(f, 'fecha'),
      fecha: fechaCelda(g(f, 'fecha')),
      tipoDoc: textoCelda(g(f, 'tipoDoc')),
      factura: textoCelda(g(f, 'factura')),
      tercero: textoCelda(g(f, 'tercero')),
      ruc: textoCelda(g(f, 'ruc')),
      dv: textoCelda(g(f, 'dv')),
      desc: textoCelda(g(f, 'desc')),
      ctaD, ctaH,
      nombreD: textoCelda(g(f, 'nombreD')),
      nombreH: textoCelda(g(f, 'nombreH')),
      montoD: redondear2(numeroCelda(g(f, 'montoD'))),
      montoH: redondear2(numeroCelda(g(f, 'montoH'))),
      clasif: textoCelda(g(f, 'clasif')),
      itbms: redondear2(numeroCelda(g(f, 'itbms')))
    });
  }

  // Catálogo del Excel (nombre y tipo de cada código)
  const catalogo = {};
  const C = libro.hojas[hojasElegidas.catalogo];
  if (C) {
    const ci = buscarEncabezado(C, ['codigo', 'nombre']);
    if (ci >= 0) {
      const ce = C[ci];
      const cc = columna(ce, { t: 'codigo' });
      const cn = columna(ce, { t: 'nombre' });
      const ct = columna(ce, { t: 'tipo', exacto: true });
      for (let i = ci + 1; i < C.length; i++) {
        const f = C[i] || [];
        const cod = codigoCuenta(f[cc]);
        if (!cod || !/^\d+$/.test(cod)) continue;
        catalogo[cod] = { nombre: textoCelda(f[cn]), tipo: ct >= 0 ? textoCelda(f[ct]) : '' };
      }
    }
  }

  // Balance inicial (asiento de apertura)
  let apertura = null;
  const B = libro.hojas[hojasElegidas.balance];
  if (B) {
    const bi = buscarEncabezado(B, ['codigo', 'saldodeudor', 'saldoacreedor']);
    if (bi >= 0) {
      const be = B[bi];
      const cc = columna(be, { t: 'codigo' });
      const cn = columna(be, { t: 'cuenta' });
      const cd = columna(be, { t: 'saldodeudor' });
      const ca = columna(be, { t: 'saldoacreedor' });
      let fecha = null;
      for (let i = 0; i < bi; i++) {
        const f = B[i] || [];
        if (clave(f[0]).startsWith('fechadeapertura')) fecha = fechaCelda(f[1]);
      }
      const lineas = [];
      for (let i = bi + 1; i < B.length; i++) {
        const f = B[i] || [];
        const cod = codigoCuenta(f[cc]);
        if (!cod || !/^\d+$/.test(cod)) continue;
        const d = redondear2(numeroCelda(f[cd]));
        const a = redondear2(numeroCelda(f[ca]));
        if (d === 0 && a === 0) continue;
        lineas.push({ codigo: cod, nombre: textoCelda(f[cn]), debe: d, haber: a, n: i + 1 });
      }
      if (lineas.length) apertura = { fecha, lineas };
    }
  }

  // Cuentas del Excel que se usan, con su nombre y cuántas veces
  const usadas = {};
  const marca = (cod, nombre, donde) => {
    if (!cod) return;
    if (!usadas[cod]) {
      const cat = catalogo[cod] || {};
      usadas[cod] = { codigo: cod, nombre: cat.nombre || nombre || cod, tipo: cat.tipo || '', usos: 0 };
    }
    if (donde) usadas[cod].usos++;
  };
  filas.forEach((f) => { marca(f.ctaD, f.nombreD, true); marca(f.ctaH, f.nombreH, true); });
  if (apertura) apertura.lineas.forEach((l) => marca(l.codigo, l.nombre, true));

  return { filas, apertura, catalogo, cuentasExcel: Object.values(usadas).sort((a, b) => a.codigo.localeCompare(b.codigo)) };
}

/* ----------------- emparejar cuentas del Excel con el catálogo ----------------- */
const VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'en', 'por', 'para', 'a', 'al', 'un', 'una', 'o', 'u', 'con', 'sobre']);
const SINONIMOS = {
  dividendo: 'retiro', retenida: 'acumulada', retenido: 'acumulada', acum: 'acumulada', acumulado: 'acumulada',
  dep: 'depreciacion', amort: 'amortizacion', amortizacion: 'amortizacion', perdida: 'perdida',
  cxc: 'cliente', cxp: 'proveedor', compra: 'compra', mercaderia: 'mercancia', computacion: 'computo',
  luz: 'electricidad', internet: 'internet', alquileres: 'alquiler', socios: 'socio', empleados: 'empleado'
};
const GENERICAS = new Set(['venta', 'ingreso', 'gasto', 'otro', 'total', 'general', 'operativo', 'operacion', 'cuenta']);

function fichas(texto) {
  const lim = sinAcentos(texto).toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
  const out = new Set();
  for (let t of lim.split(/\s+/)) {
    if (!t || VACIAS.has(t)) continue;
    if (t.length > 3 && t.endsWith('es') && !t.endsWith('ones')) t = t.slice(0, -2);
    else if (t.length > 3 && t.endsWith('s')) t = t.slice(0, -1);
    if (t.endsWith('ion') || t.endsWith('ones')) t = t.replace(/ones$/, 'ion');
    t = SINONIMOS[t] || t;
    out.add(t);
  }
  if (out.has('proveedor')) out.delete('pagar');
  if (out.has('cliente')) out.delete('cobrar');
  if (out.has('proveedor') || out.has('cliente')) out.delete('cuenta');
  return out;
}
const peso = (t) => (GENERICAS.has(t) ? 0.5 : 1);

function puntaje(a, b) {
  let comun = 0, sa = 0, sb = 0;
  for (const t of a) { sa += peso(t); if (b.has(t)) comun += peso(t); }
  for (const t of b) sb += peso(t);
  return sa + sb === 0 ? 0 : (2 * comun) / (sa + sb);
}

function tipoApp(tipoExcel, codigo) {
  const t = clave(tipoExcel);
  if (t === 'activo') return 'activo';
  if (t === 'pasivo') return 'pasivo';
  if (t === 'capital' || t === 'patrimonio') return 'patrimonio';
  if (t === 'ingreso' || t === 'ingresoextraordinario') return 'ingreso';
  if (t === 'costo') return 'costo';
  if (t === 'gasto') return 'gasto';
  if (t === 'gastoextraordinario') return 'extraordinario';
  const d = String(codigo).charAt(0);
  return { 1: 'activo', 2: 'pasivo', 3: 'patrimonio', 4: 'ingreso', 5: 'costo', 6: 'gasto', 7: 'extraordinario' }[d] || null;
}

// cuentasApp: [{id, numero, nombre, tipo, acepta_movimientos}]
export function sugerirMapa(cuentasExcel, cuentasApp) {
  const destinos = cuentasApp.filter((c) => c.acepta_movimientos !== false)
    .map((c) => ({ c, f: fichas(c.nombre), tipo: c.tipo }));
  const mapa = {};
  for (const ex of cuentasExcel) {
    const fe = fichas(ex.nombre);
    const tipoEsperado = tipoApp(ex.tipo, ex.codigo);
    const lista = destinos.map((d) => {
      let p = puntaje(fe, d.f);
      if (tipoEsperado && d.tipo !== tipoEsperado) p *= 0.25;
      return { id: d.c.id, p };
    }).sort((a, b) => b.p - a.p);
    const mejor = lista[0];
    const segundo = lista[1] ? lista[1].p : 0;
    let confianza = 'ninguna';
    if (mejor && mejor.p >= 0.6 && mejor.p - segundo >= 0.1) confianza = 'alta';
    else if (mejor && mejor.p >= 0.4) confianza = 'media';
    mapa[ex.codigo] = { id: confianza === 'ninguna' ? '' : mejor.id, confianza, puntaje: mejor ? mejor.p : 0 };
  }
  return mapa;
}

/* ------------------------ filas que se envían a la base ------------------------ */
// ctx: { cuentasPorId: {id: cuenta}, mesesCerrados: Set('AAAA-MM'), contribuyente: bool }
export function construirFilas(analisis, mapa, ctx) {
  const cuenta = (cod) => ctx.cuentasPorId[(mapa[cod] || {}).id] || null;
  const num = (c) => (c ? c.numero : '');
  const esEfectivo = (c) => !!c && num(c).startsWith('1.1.01.');
  const esPorPagar = (c) => !!c && num(c).startsWith('2.1.01.');
  const esPorCobrar = (c) => !!c && num(c).startsWith('1.1.02.');

  const vistas = new Map();
  const salida = [];

  // Asiento de apertura
  let apertura = null;
  if (analisis.apertura) {
    const ap = analisis.apertura;
    const mensajes = [];
    let estado = 'ok';
    const lineas = [];
    let d = 0, h = 0;
    for (const l of ap.lineas) {
      const c = cuenta(l.codigo);
      if (!c) { mensajes.push('Cuenta sin asignar: ' + l.codigo + ' ' + l.nombre); estado = 'error'; continue; }
      lineas.push({ cuenta_id: c.id, debito: l.debe, credito: l.haber, descripcion: l.nombre });
      d += l.debe; h += l.haber;
    }
    if (!ap.fecha) { mensajes.push('El balance inicial no tiene fecha de apertura válida.'); estado = 'error'; }
    if (Math.abs(d - h) > 0.005) { mensajes.push(`El balance inicial no cuadra: debe ${redondear2(d)} y haber ${redondear2(h)}.`); estado = 'error'; }
    else if (ap.fecha && ctx.mesesCerrados.has(ap.fecha.slice(0, 7))) { mensajes.push('El mes de la apertura está cerrado.'); estado = 'error'; }
    apertura = {
      n: 0, estado, mensajes, etiqueta: 'Balance inicial (apertura)', fecha: ap.fecha,
      monto: redondear2(d),
      payload: { n: 'apertura', clase: 'apertura', fecha: ap.fecha, descripcion: 'Asiento de apertura (importado de Excel)',
        referencia: 'APERTURA', asiento: { lineas } }
    };
    salida.push(apertura);
  }

  for (const f of analisis.filas) {
    const mensajes = [];
    let estado = 'ok';
    const error = (m) => { mensajes.push(m); estado = 'error'; };
    const aviso = (m) => { mensajes.push(m); if (estado === 'ok') estado = 'aviso'; };

    if (!f.fecha) error('La fecha no es válida: "' + textoCelda(f.fechaOriginal) + '"');
    else if (ctx.mesesCerrados.has(f.fecha.slice(0, 7))) error('El mes ' + f.fecha.slice(0, 7) + ' está cerrado en el sistema.');
    if (!f.ctaD || !f.ctaH) error('Falta la cuenta del debe o del haber.');
    if (Math.abs(f.montoD - f.montoH) > 0.005) error(`El monto del debe (${f.montoD}) y del haber (${f.montoH}) no coinciden.`);
    const monto = f.montoD || f.montoH;
    if (!(monto > 0)) error('El monto debe ser mayor que cero.');
    if (f.itbms > 0) error('La fila tiene ITBMS (' + f.itbms + '): regístrala a mano en Transacciones para que el impuesto quede separado.');

    const A = cuenta(f.ctaD);
    const B = cuenta(f.ctaH);
    if (f.ctaD && !A) error('Cuenta del debe sin asignar: ' + f.ctaD);
    if (f.ctaH && !B) error('Cuenta del haber sin asignar: ' + f.ctaH);
    if (A && B && A.id === B.id) error('El debe y el haber usan la misma cuenta.');

    const llave = [f.fecha, f.factura, f.ctaD, f.ctaH, monto, f.desc].join('|');
    vistas.set(llave, (vistas.get(llave) || 0) + 1);

    const cl = clave(f.clasif);
    let tipo = null;
    if (cl === 'compra') tipo = 'compra_mercancia';
    else if (cl === 'gasto') tipo = 'gasto';
    else if (cl === 'costo') tipo = 'costo';
    else if (cl === 'venta' || cl === 'ingreso') tipo = 'venta';
    else if (cl.startsWith('pago')) tipo = 'pago_proveedor';
    else if (cl.startsWith('cobro')) tipo = 'cobro_cliente';

    let trx = null;
    if (estado !== 'error' && tipo) {
      if (['compra_mercancia', 'gasto', 'costo'].includes(tipo)) {
        if (esEfectivo(B) && !esEfectivo(A) && !esPorPagar(A)) trx = { tipo, principal: A.id, contra: B.id, forma: 'contado' };
        else if (esPorPagar(B) && !esEfectivo(A) && !esPorPagar(A)) trx = { tipo, principal: A.id, contra: B.id, forma: 'credito' };
      } else if (tipo === 'venta') {
        if (esEfectivo(A) && !esEfectivo(B) && !esPorCobrar(B)) trx = { tipo, principal: B.id, contra: A.id, forma: 'contado' };
        else if (esPorCobrar(A) && !esEfectivo(B) && !esPorCobrar(B)) trx = { tipo, principal: B.id, contra: A.id, forma: 'credito' };
      } else if (tipo === 'pago_proveedor') {
        if (esPorPagar(A) && esEfectivo(B)) trx = { tipo, principal: A.id, contra: B.id, forma: 'contado' };
      } else if (tipo === 'cobro_cliente') {
        if (esPorCobrar(B) && esEfectivo(A)) trx = { tipo, principal: B.id, contra: A.id, forma: 'contado' };
      }
      if (!trx) aviso('No sigue el esquema de ' + f.clasif + ' (caja o banco contra la cuenta): se carga como asiento manual y no aparecerá en Transacciones.');
    }
    if (estado !== 'error' && !tipo && /factura/i.test(f.tipoDoc) && !/ajuste|diario/i.test(f.clasif)) {
      aviso('Es una factura sin clasificación reconocida ("' + f.clasif + '"): se carga como asiento manual.');
    }

    const nombreTercero = f.tercero || '';
    const rucTercero = f.ruc || '';
    const tipoTercero = (trx && ['venta', 'cobro_cliente'].includes(trx.tipo)) ? 'cliente' : 'proveedor';
    const tercero = trx && (nombreTercero || rucTercero)
      ? { nombre: nombreTercero, ruc: rucTercero, dv: f.dv, tipo: tipoTercero } : null;
    if (trx && (trx.forma === 'credito' || ['pago_proveedor', 'cobro_cliente'].includes(trx.tipo)) && !tercero) {
      aviso('A crédito o cobro/pago sin cliente o proveedor: no saldrá en cuentas por cobrar o por pagar por persona.');
    }

    let payload = null;
    if (estado !== 'error') {
      const base = { n: f.n, fecha: f.fecha, descripcion: f.desc || f.clasif || 'Importado de Excel', referencia: f.factura || null };
      if (trx) payload = { ...base, clase: 'trx', tercero, trx: { ...trx, monto, itbms: 0 } };
      else {
        payload = {
          ...base, clase: 'asiento',
          asiento: {
            origen: /ajuste/i.test(f.clasif) ? 'ajuste' : 'manual',
            lineas: [
              { cuenta_id: A.id, debito: monto, credito: 0, descripcion: f.desc || null },
              { cuenta_id: B.id, debito: 0, credito: monto, descripcion: f.desc || null }
            ]
          }
        };
      }
    }
    salida.push({ n: f.n, estado, mensajes, etiqueta: `${f.fecha || '?'} · ${f.clasif || f.tipoDoc || ''} ${f.factura ? '#' + f.factura : ''}`.trim(),
      fecha: f.fecha, monto, descripcion: f.desc, llave, clase: payload ? payload.clase : null, payload });
  }

  // Filas repetidas dentro del archivo (pueden ser legítimas)
  for (const s of salida) {
    // Solo se avisa en facturas y movimientos con documento; los ajustes repetidos (p. ej. depreciaciones iguales) son normales
    if (s.llave && s.clase === 'trx' && vistas.get(s.llave) > 1 && s.estado !== 'error') {
      s.mensajes.push('Hay ' + vistas.get(s.llave) + ' filas idénticas en el Excel (fecha, documento, cuentas, monto y descripción). Si no es legítimo, desmárcala.');
      if (s.estado === 'ok') s.estado = 'aviso';
      s.repetida = true;
    }
  }

  const resumen = {
    filas: analisis.filas.length,
    ok: salida.filter((s) => s.estado === 'ok').length,
    avisos: salida.filter((s) => s.estado === 'aviso').length,
    errores: salida.filter((s) => s.estado === 'error').length,
    transacciones: salida.filter((s) => s.clase === 'trx').length,
    asientos: salida.filter((s) => s.clase === 'asiento' || s.clase === 'apertura').length
  };
  const claves = new Set();
  salida.forEach((s) => {
    const t = s.payload && s.payload.tercero;
    if (t) claves.add(clave(t.ruc) ? 'r:' + clave(t.ruc) + '|' + clave(t.dv) : 'n:' + clave(t.nombre));
  });
  resumen.contactos = claves.size;
  return { filas: salida, resumen };
}

// FIN DEL ARCHIVO importarlogica.js
