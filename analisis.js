// Análisis financiero: razones financieras, análisis vertical y análisis
// horizontal, a partir del balance general y el estado de resultados
// comparativos. Exporta a Excel y PDF.
import {
  db, h, mostrar, toast, traducirError, cargando, marcoEmpresa, cargarEmpresa, hoy
} from './lib.js';
import { barraExportar } from './informes.js';
import { tablaSimple } from './fiscal.js';
import { n2 } from './exportar.js';

const NUM = (v) => Number(v || 0);

/* ------------------------- datos y cálculos (compartidos) ------------------------- */

// Trae balance y resultados del año y del anterior
export async function cargarEstados(id, anio) {
  const [b, r] = await Promise.all([
    db.rpc('estado_balance_general', { p_empresa: id, p_anio: anio }),
    db.rpc('estado_resultados', { p_empresa: id, p_anio: anio })
  ]);
  if (b.error) throw b.error;
  if (r.error) throw r.error;
  return { balance: b.data || [], resultados: r.data || [] };
}

function indice(rows) {
  const por = new Map(rows.map((x) => [x.orden, x]));
  return {
    // [actual, anterior] de una fila por su orden (0 si no existe)
    v: (o) => [NUM((por.get(o) || {}).actual), NUM((por.get(o) || {}).anterior)],
    // suma de las cuentas de detalle cuyo número empieza con el prefijo
    pref: (p) => rows.filter((x) => x.fila === 'detalle' && x.numero && x.numero.startsWith(p))
      .reduce((s, x) => [s[0] + NUM(x.actual), s[1] + NUM(x.anterior)], [0, 0])
  };
}

const div = (a, b) => (Math.abs(b) < 0.005 ? null : a / b);
const por = (a, b) => { const d = div(a, b); return d === null ? null : d * 100; };

// Devuelve las razones con valor del año (i=0) y del año anterior (i=1)
export function calcularRazones(balance, resultados) {
  const B = indice(balance); const R = indice(resultados);
  const dos = (f) => [f(0), f(1)];
  const AC = B.v(1950), PC = B.v(4950), TA = B.v(3000), TP = B.v(6000), PAT = B.v(7950);
  const ING = R.v(1950), COS = R.v(2950), UB = R.v(3000), UO = R.v(5000), UN = R.v(11000);
  const INV = B.pref('1.1.05'), CXC = B.pref('1.1.02'), CXP = B.pref('2.1.01');
  const f = (nombre, formula, valores, tipo) => ({ nombre, formula, a: valores[0], b: valores[1], tipo });
  return [
    { grupo: 'Liquidez' },
    f('Razón corriente', 'Activo corriente ÷ Pasivo corriente', dos((i) => div(AC[i], PC[i])), 'x'),
    f('Prueba ácida', '(Activo corriente - Inventario) ÷ Pasivo corriente', dos((i) => div(AC[i] - INV[i], PC[i])), 'x'),
    f('Capital de trabajo', 'Activo corriente - Pasivo corriente', dos((i) => AC[i] - PC[i]), 'b'),
    { grupo: 'Endeudamiento' },
    f('Pasivo total sobre activo total', 'Pasivo total ÷ Activo total', dos((i) => por(TP[i], TA[i])), '%'),
    f('Pasivo sobre patrimonio', 'Pasivo total ÷ Patrimonio', dos((i) => div(TP[i], PAT[i])), 'x'),
    { grupo: 'Rentabilidad' },
    f('Margen bruto', 'Utilidad bruta ÷ Ingresos', dos((i) => por(UB[i], ING[i])), '%'),
    f('Margen operativo', 'Utilidad operativa ÷ Ingresos', dos((i) => por(UO[i], ING[i])), '%'),
    f('Margen neto', 'Utilidad neta ÷ Ingresos', dos((i) => por(UN[i], ING[i])), '%'),
    f('Rendimiento sobre activos', 'Utilidad neta ÷ Activo total', dos((i) => por(UN[i], TA[i])), '%'),
    f('Rendimiento sobre patrimonio', 'Utilidad neta ÷ Patrimonio', dos((i) => por(UN[i], PAT[i])), '%'),
    { grupo: 'Actividad (con saldos al cierre)' },
    f('Rotación de inventario', 'Costo de ventas ÷ Inventario', dos((i) => div(COS[i], INV[i])), 'x'),
    f('Días de cuentas por cobrar', 'Cuentas por cobrar ÷ Ingresos × 365', dos((i) => { const d = div(CXC[i], ING[i]); return d === null ? null : d * 365; }), 'd'),
    f('Días de cuentas por pagar', 'Cuentas por pagar ÷ Costo de ventas × 365', dos((i) => { const d = div(CXP[i], COS[i]); return d === null ? null : d * 365; }), 'd')
  ];
}

export function textoValor(v, tipo) {
  if (v === null || v === undefined) return '—';
  if (tipo === '%') return v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %';
  if (tipo === 'x') return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' veces';
  if (tipo === 'd') return Math.round(v).toLocaleString('en-US') + ' días';
  return 'B/. ' + n2(v);
}

const pct = (v) => (v === null ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %');
const E = { detalle: 'normal', subtotal: 'n1', total: 'total' };

// Filas del estado sin la fila de control ni las que están en cero en ambos años
function filasUtiles(rows) {
  return rows.filter((x) => x.fila !== 'control' && !(x.fila === 'detalle' && NUM(x.actual) === 0 && NUM(x.anterior) === 0));
}

export function filasVertical(rows, baseOrden, anio) {
  const base = indice(rows).v(baseOrden);
  return filasUtiles(rows).map((x) => ({
    c: [x.concepto, NUM(x.actual), pct(por(NUM(x.actual), base[0])), NUM(x.anterior), pct(por(NUM(x.anterior), base[1]))],
    e: E[x.fila] || 'normal'
  }));
}

export function filasHorizontal(rows) {
  return filasUtiles(rows).map((x) => {
    const a = NUM(x.actual); const b = NUM(x.anterior);
    const v = a - b;
    return { c: [x.concepto, a, b, v, pct(Math.abs(b) < 0.005 ? null : (v / Math.abs(b)) * 100)], e: E[x.fila] || 'normal' };
  });
}

/* ----------------------------- especificaciones ----------------------------- */

function specRazones(razones, anio) {
  const filas = [];
  for (const r of razones) {
    if (r.grupo) filas.push({ c: [r.grupo, null, null, null], e: 'grupo' });
    else filas.push({ c: [r.nombre, r.formula, textoValor(r.a, r.tipo), textoValor(r.b, r.tipo)], e: 'normal' });
  }
  return {
    titulo: 'Razones financieras', subtitulo: `${anio} comparado con ${anio - 1}`, hoja: 'Razones', horizontal: true,
    columnas: [{ t: 'Razón', w: 1 }, { t: 'Cómo se calcula', w: 2 }, { t: String(anio), num: true }, { t: String(anio - 1), num: true }],
    filas,
    notas: ['Las razones de actividad usan los saldos al cierre, no promedios. "—" significa que el divisor es cero.']
  };
}

function specVertical(rows, baseOrden, titulo, hoja, anio) {
  return {
    titulo, subtitulo: `Cada línea como porcentaje de ${baseOrden === 3000 ? 'los activos totales' : 'los ingresos'} · ${anio} y ${anio - 1}`, hoja,
    columnas: [{ t: 'Concepto', w: 1 }, { t: String(anio), num: true }, { t: '%', num: true }, { t: String(anio - 1), num: true }, { t: '%', num: true }],
    filas: filasVertical(rows, baseOrden, anio)
  };
}

function specHorizontal(rows, titulo, hoja, anio) {
  return {
    titulo, subtitulo: `Variación de ${anio} contra ${anio - 1}`, hoja,
    columnas: [{ t: 'Concepto', w: 1 }, { t: String(anio), num: true }, { t: String(anio - 1), num: true }, { t: 'Variación', num: true }, { t: '%', num: true }],
    filas: filasHorizontal(rows)
  };
}

/* ---------------------------------- pantalla --------------------------------- */

export async function vistaAnalisis(id) {
  mostrar(marcoEmpresa({ id, razon_social: '…' }, 'analisis', cargando()));
  const empresa = await cargarEmpresa(id);
  const est = { anio: Number(hoy().slice(0, 4)), vista: 'razones', estado: 'balance', datos: null };
  const filtros = h('div', { class: 'filtros' });
  const zona = h('div');

  function armar() {
    filtros.replaceChildren(...[
      h('select', { onchange: (e) => { est.vista = e.target.value; armar(); pintar(); } },
        [['razones', 'Razones financieras'], ['vertical', 'Análisis vertical'], ['horizontal', 'Análisis horizontal']]
          .map(([k, n]) => h('option', { value: k, selected: k === est.vista }, n))),
      est.vista === 'razones' ? null : h('select', { onchange: (e) => { est.estado = e.target.value; pintar(); } },
        h('option', { value: 'balance', selected: est.estado === 'balance' }, 'Balance general'),
        h('option', { value: 'resultados', selected: est.estado === 'resultados' }, 'Estado de resultados')),
      h('input', {
        type: 'number', min: '2000', max: '2100', inputmode: 'numeric', value: String(est.anio),
        onchange: (e) => { const v = Number(e.target.value); if (v >= 2000 && v <= 2100) { est.anio = v; pintar(); } }
      })].filter(Boolean));
  }

  function exportar() {
    const d = est.datos;
    if (!d) return null;
    const base = `${empresa.razon_social}-`;
    if (est.vista === 'razones') {
      return { specs: [specRazones(calcularRazones(d.balance, d.resultados), est.anio)], archivo: `${base}razones-${est.anio}` };
    }
    if (est.vista === 'vertical') {
      return {
        specs: [specVertical(d.balance, 3000, 'Análisis vertical del balance general', 'Vertical balance', est.anio),
          specVertical(d.resultados, 1950, 'Análisis vertical del estado de resultados', 'Vertical resultados', est.anio)],
        archivo: `${base}analisis-vertical-${est.anio}`
      };
    }
    return {
      specs: [specHorizontal(d.balance, 'Análisis horizontal del balance general', 'Horizontal balance', est.anio),
        specHorizontal(d.resultados, 'Análisis horizontal del estado de resultados', 'Horizontal resultados', est.anio)],
      archivo: `${base}analisis-horizontal-${est.anio}`
    };
  }

  async function pintar() {
    zona.replaceChildren(cargando());
    try {
      est.datos = await cargarEstados(id, est.anio);
      const d = est.datos;
      const hayDatos = d.balance.some((x) => x.fila === 'detalle') || d.resultados.some((x) => x.fila === 'detalle');
      let cuerpo;
      if (!hayDatos) {
        cuerpo = h('p', { class: 'ayuda' }, 'No hay cifras para ese año. Registra transacciones y revisa que el año esté al día.');
      } else if (est.vista === 'razones') {
        const rz = calcularRazones(d.balance, d.resultados);
        const tarjetas = [];
        let actual = null;
        for (const r of rz) {
          if (r.grupo) { actual = { titulo: r.grupo, filas: [] }; tarjetas.push(actual); continue; }
          actual.filas.push({ c: [r.nombre, textoValor(r.a, r.tipo), textoValor(r.b, r.tipo)] });
        }
        cuerpo = h('div', null, ...tarjetas.map((t) => h('div', { class: 'tarjeta' }, h('h3', null, t.titulo),
          tablaSimple([{ t: 'Razón' }, { t: String(est.anio), num: true }, { t: String(est.anio - 1), num: true }], t.filas))),
        h('p', { class: 'ayuda' }, 'En el Excel y el PDF cada razón lleva su fórmula.'));
      } else if (est.vista === 'vertical') {
        const rows = est.estado === 'balance' ? d.balance : d.resultados;
        const f = filasVertical(rows, est.estado === 'balance' ? 3000 : 1950, est.anio);
        cuerpo = tablaSimple([{ t: 'Concepto' }, { t: String(est.anio), num: true }, { t: '%', num: true }, { t: String(est.anio - 1), num: true }, { t: '%', num: true }], f, 'ancha');
      } else {
        const rows = est.estado === 'balance' ? d.balance : d.resultados;
        cuerpo = tablaSimple([{ t: 'Concepto' }, { t: String(est.anio), num: true }, { t: String(est.anio - 1), num: true }, { t: 'Variación', num: true }, { t: '%', num: true }],
          filasHorizontal(rows), 'ancha');
      }
      zona.replaceChildren(barraExportar({ empresa, obtener: exportar }), cuerpo);
    } catch (e) {
      est.datos = null;
      zona.replaceChildren(h('div', { class: 'tarjeta error' }, h('p', null, traducirError(e))));
    }
  }

  armar();
  mostrar(marcoEmpresa(empresa, 'analisis', [filtros, zona]));
  pintar();
}

// FIN DEL ARCHIVO analisis.js
