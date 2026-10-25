// Análisis financiero: razones financieras, análisis vertical y análisis
// horizontal, a partir del balance general y el estado de resultados
// comparativos. Exporta a Excel y PDF.
import {
  db, h, mostrar, toast, traducirError, cargando, marcoEmpresa, cargarEmpresa, hoy
} from './lib.js';
import { barraExportar } from './informes.js';
import { tablaSimple } from './fiscal.js';
import { n2 } from './exportar.js';
import { graficaDeSpec } from './graficas.js';

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


/* ------------------------ interpretación escrita y gráficas ------------------------ */

const AZUL = '#2a78d6'; const NARANJA = '#eb6834'; const VERDE = '#1baf7a'; const AMBAR = '#eda100'; const ROSA = '#e87ba4'; const VIOLETA = '#6250d6';
const num2 = (v) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const bal = (v) => 'B/. ' + n2(v);
const veces = (v) => num2(v) + ' veces';

// "sube", "baja" o "se mantiene" frente al año anterior, con las dos cifras
function frente(a, b, anio, txt) {
  if (a === null || b === null) return '';
  if (Math.abs(a - b) < 0.005) return ` Es igual al de ${anio - 1}.`;
  return ` ${a > b ? 'Subió' : 'Bajó'} frente a ${anio - 1} (${txt(b)}).`;
}

export function interpretarRazones(razones, anio) {
  const R = Object.fromEntries(razones.filter((x) => !x.grupo).map((x) => [x.nombre, x]));
  const out = [];
  const tit = (t) => out.push({ titulo: t, parrafos: [] });
  const p = (t) => out[out.length - 1].parrafos.push(t);
  const rc = R['Razón corriente']; const pa = R['Prueba ácida']; const ct = R['Capital de trabajo'];
  tit('Liquidez');
  if (rc && rc.a !== null) {
    p(`La razón corriente es ${veces(rc.a)}: por cada B/. 1.00 de deudas a corto plazo hay B/. ${num2(rc.a)} en activos corrientes. `
      + (rc.a < 1 ? 'Es menor que 1, así que las deudas de corto plazo superan a lo que se puede convertir en efectivo en el mismo plazo.'
        : rc.a < 1.5 ? 'Alcanza para cubrir las deudas de corto plazo, con poco margen.' : 'Cubre las deudas de corto plazo con margen.')
      + frente(rc.a, rc.b, anio, (v) => veces(v)));
  } else p('La razón corriente no se puede calcular porque no hay pasivo corriente registrado.');
  if (pa && pa.a !== null) p(`La prueba ácida es ${veces(pa.a)}. Es la misma razón sin contar el inventario.` + (rc && rc.a !== null && Math.abs(rc.a - pa.a) < 0.005 ? ' Coincide con la razón corriente porque no hay inventario.' : '') + frente(pa.a, pa.b, anio, (v) => veces(v)));
  if (ct) p(`El capital de trabajo (activo corriente menos pasivo corriente) es ${bal(ct.a)}` + (ct.a < 0 ? ', negativo: el pasivo corriente es mayor que el activo corriente.' : '.') + frente(ct.a, ct.b, anio, bal));

  const pt = R['Pasivo total sobre activo total']; const ps = R['Pasivo sobre patrimonio'];
  tit('Endeudamiento');
  if (pt && pt.a !== null) {
    p(`Los pasivos financian el ${textoValor(pt.a, '%')} de los activos` + (pt.a <= 100 ? `; el ${textoValor(100 - pt.a, '%')} restante es patrimonio.` : '; como pasa de 100 %, el patrimonio es negativo.') + frente(pt.a, pt.b, anio, (v) => textoValor(v, '%')));
  } else p('No hay activos registrados, por eso no se calcula el endeudamiento.');
  if (ps && ps.a !== null) p(`Por cada B/. 1.00 de patrimonio se debe B/. ${num2(ps.a)}.` + frente(ps.a, ps.b, anio, (v) => veces(v)));
  else if (pt && pt.a !== null) p('La razón de pasivo sobre patrimonio no se calcula porque el patrimonio es cero.');

  const mb = R['Margen bruto']; const mo = R['Margen operativo']; const mn = R['Margen neto']; const ra = R['Rendimiento sobre activos']; const rp = R['Rendimiento sobre patrimonio'];
  tit('Rentabilidad');
  if (mn && mn.a !== null) {
    p(`Por cada B/. 100.00 de ingresos, la utilidad bruta es B/. ${num2(mb.a ?? 0)}, la operativa B/. ${num2(mo.a ?? 0)} y la neta B/. ${num2(mn.a)}.`
      + (mn.a < 0 ? ' El año tiene pérdida neta.' : '') + frente(mn.a, mn.b, anio, (v) => 'margen neto ' + textoValor(v, '%')));
  } else p('No hay ingresos en el año, por eso no se calculan los márgenes.');
  if (ra && ra.a !== null) p(`Los activos generaron una utilidad neta equivalente al ${textoValor(ra.a, '%')} de su valor.` + frente(ra.a, ra.b, anio, (v) => textoValor(v, '%')));
  if (rp && rp.a !== null) p(`Sobre el patrimonio, la utilidad neta equivale al ${textoValor(rp.a, '%')}` + (rp.a < 0 ? ' (negativo por la pérdida o por patrimonio negativo).' : '.') + frente(rp.a, rp.b, anio, (v) => textoValor(v, '%')));

  const ri = R['Rotación de inventario']; const dc = R['Días de cuentas por cobrar']; const dp = R['Días de cuentas por pagar'];
  tit('Actividad');
  if (ri && ri.a !== null) p(`El inventario rota ${veces(ri.a)} en el año (costo de ventas entre inventario al cierre).` + frente(ri.a, ri.b, anio, (v) => veces(v)));
  else p('No se calcula la rotación de inventario porque no hay inventario o costo de ventas.');
  if (dc && dc.a !== null) p(`Con los saldos al cierre, los clientes tardan unos ${Math.round(dc.a)} días en pagar.` + frente(dc.a, dc.b, anio, (v) => Math.round(v) + ' días'));
  if (dp && dp.a !== null) p(`A los proveedores se les paga en unos ${Math.round(dp.a)} días.` + frente(dp.a, dp.b, anio, (v) => Math.round(v) + ' días')
    + (dc && dc.a !== null ? (dc.a > dp.a ? ' Se cobra más lento de lo que se paga, lo que consume efectivo.' : ' Se cobra más rápido de lo que se paga.') : ''));
  p('Las razones de actividad usan saldos al cierre y no promedios del año.');
  return out;
}

export function graficasRazones(razones, anio) {
  const R = Object.fromEntries(razones.filter((x) => !x.grupo).map((x) => [x.nombre, x]));
  const v = (n, i) => { const x = R[n]; const z = x ? (i ? x.b : x.a) : null; return z === null || z === undefined ? 0 : Math.round(z * 100) / 100; };
  const par = (nombres, nota, titulo, etiquetas, tipo) => ({
    tipo: 'barras', titulo, etiquetas, nota,
    series: [{ nombre: String(anio), valores: nombres.map((n) => v(n, 0)), color: AZUL }, { nombre: String(anio - 1), valores: nombres.map((n) => v(n, 1)), color: AMBAR }]
  });
  return [
    par(['Razón corriente', 'Prueba ácida'], 'Veces.', 'Liquidez', ['Razón corriente', 'Prueba ácida']),
    par(['Pasivo total sobre activo total', 'Margen bruto', 'Margen operativo', 'Margen neto', 'Rendimiento sobre activos', 'Rendimiento sobre patrimonio'], 'Porcentajes.',
      'Endeudamiento y rentabilidad', ['Pasivo/activo', 'Margen bruto', 'Margen oper.', 'Margen neto', 'Rend. activos', 'Rend. patrim.']),
    par(['Días de cuentas por cobrar', 'Días de cuentas por pagar'], 'Días, con saldos al cierre.', 'Días de cobro y de pago', ['Días por cobrar', 'Días por pagar'])
  ];
}

// Estructura del balance o del estado de resultados: porcentajes y cifras clave
const absMayores = (rows, k, medida) => filasUtiles(rows).filter((x) => x.fila === 'detalle')
  .map((x) => ({ x, v: medida(x) })).filter((o) => o.v !== null).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, k);

export function interpretarVertical(rows, estado, anio) {
  const I = indice(rows); const out = []; const p = (t) => out.push(t);
  if (estado === 'balance') {
    const [ta, taA] = I.v(3000); const [ac, acA] = I.v(1950); const [pc] = I.v(4950); const [tp] = I.v(6000); const [pat] = I.v(7950);
    if (Math.abs(ta) < 0.005) return ['No hay activos registrados en el año; el análisis vertical del balance no se puede calcular.'];
    p(`El activo total es ${bal(ta)}. El activo corriente es el ${pct(por(ac, ta))} y el no corriente el ${pct(por(ta - ac, ta))}.`
      + (Math.abs(taA) > 0.005 ? ` En ${anio - 1} el corriente era el ${pct(por(acA, taA))}.` : ''));
    p(`Del lado del financiamiento, los pasivos son el ${pct(por(tp, ta))} del activo (corrientes ${pct(por(pc, ta))}) y el patrimonio el ${pct(por(pat, ta))}.`);
    const top = absMayores(rows, 3, (x) => (x.numero && /^1/.test(x.numero) ? por(NUM(x.actual), ta) : null));
    if (top.length) p('Las cuentas de activo con más peso son ' + top.map((o) => `${o.x.concepto} (${pct(o.v)})`).join(', ') + '.');
    const topP = absMayores(rows, 3, (x) => (x.numero && /^[23]/.test(x.numero) ? por(NUM(x.actual), ta) : null));
    if (topP.length) p('En pasivo y patrimonio pesan más ' + topP.map((o) => `${o.x.concepto} (${pct(o.v)})`).join(', ') + '.');
  } else {
    const [ing, ingA] = I.v(1950); const [cos] = I.v(2950); const [ub] = I.v(3000); const [go] = I.v(4950); const [uo] = I.v(5000); const [un, unA] = I.v(11000);
    if (Math.abs(ing) < 0.005) return ['No hay ingresos en el año; el análisis vertical del estado de resultados no se puede calcular.'];
    p(`Sobre ingresos de ${bal(ing)}: los costos consumen el ${pct(por(cos, ing))}, lo que deja una utilidad bruta del ${pct(por(ub, ing))}.`);
    p(`Los gastos operativos son el ${pct(por(go, ing))} de los ingresos y la utilidad operativa queda en ${pct(por(uo, ing))}.`);
    p(un >= 0 ? `La utilidad neta es ${bal(un)}, el ${pct(por(un, ing))} de los ingresos` + (Math.abs(ingA) > 0.005 && Math.abs(unA) > 0.005 ? ` (en ${anio - 1}: ${pct(por(unA, ingA))}).` : '.')
      : `El año termina con pérdida neta de ${bal(Math.abs(un))}, el ${pct(Math.abs(por(un, ing)))} de los ingresos.`);
    const top = absMayores(rows, 3, (x) => (x.numero && /^[56]/.test(x.numero) ? por(NUM(x.actual), ing) : null));
    if (top.length) p('Los gastos con más peso son ' + top.map((o) => `${o.x.concepto} (${pct(o.v)} de los ingresos)`).join(', ') + '.');
  }
  return out;
}

export function graficasVertical(rows, estado, anio) {
  const I = indice(rows);
  const par = (titulo, etiquetas, ords, base, nota) => ({
    tipo: 'barras', titulo, etiquetas, nota,
    series: [0, 1].map((i) => ({ nombre: String(anio - i), color: i ? AMBAR : AZUL,
      valores: ords.map((f) => { const b = base(i); const z = Math.abs(b) < 0.005 ? 0 : (f(i) / b) * 100; return Math.round(z * 100) / 100; }) }))
  });
  if (estado === 'balance') {
    const ta = (i) => I.v(3000)[i];
    return [par('Estructura del balance (% del activo total)', ['Activo corriente', 'Activo no corr.', 'Pasivo corriente', 'Pasivo no corr.', 'Patrimonio'],
      [(i) => I.v(1950)[i], (i) => ta(i) - I.v(1950)[i], (i) => I.v(4950)[i], (i) => I.v(6000)[i] - I.v(4950)[i], (i) => I.v(7950)[i]], ta, 'Porcentaje del activo total.')];
  }
  const ing = (i) => I.v(1950)[i];
  return [par('Estado de resultados (% de los ingresos)', ['Costos', 'Utilidad bruta', 'Gastos op.', 'Utilidad operativa', 'Utilidad neta'],
    [2950, 3000, 4950, 5000, 11000].map((o) => (i) => I.v(o)[i]), ing, 'Porcentaje de los ingresos.')];
}

export function interpretarHorizontal(rows, estado, anio) {
  const I = indice(rows); const out = [];
  const lineas = estado === 'balance'
    ? [['El activo total', 3000], ['El pasivo total', 6000], ['El patrimonio', 7950]]
    : [['Los ingresos', 1950], ['Los costos', 2950], ['Los gastos operativos', 4950], ['La utilidad neta', 11000]];
  const hay = lineas.some(([, o]) => Math.abs(I.v(o)[1]) > 0.005);
  if (!hay) out.push(`No hay cifras de ${anio - 1} para comparar; se muestran las de ${anio}.`);
  for (const [nombre, o] of lineas) {
    const [a, b] = I.v(o); const v = a - b;
    if (Math.abs(b) < 0.005) { out.push(`${nombre} ${nombre.startsWith('Los') ? 'son' : 'es'} ${bal(a)}; no hay cifra del año anterior para calcular la variación.`); continue; }
    if (Math.abs(v) < 0.005) { out.push(`${nombre} no cambió: ${bal(a)}.`); continue; }
    const plural = nombre.startsWith('Los');
    out.push(`${nombre} ${a > b ? (plural ? 'subieron' : 'subió') : (plural ? 'bajaron' : 'bajó')} ${bal(Math.abs(v))} (${pct(Math.abs((v / Math.abs(b)) * 100))}), de ${bal(b)} en ${anio - 1} a ${bal(a)} en ${anio}.`);
  }
  const mov = filasUtiles(rows).filter((x) => x.fila === 'detalle').map((x) => ({ x, v: NUM(x.actual) - NUM(x.anterior) }))
    .filter((o) => Math.abs(o.v) > 0.004).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 3);
  if (mov.length) out.push('Los cambios más grandes por cuenta fueron ' + mov.map((o) => `${o.x.concepto} (${o.v > 0 ? '+' : '-'}${bal(Math.abs(o.v))})`).join(', ') + '.');
  return out;
}

export function graficasHorizontal(rows, estado, anio) {
  const I = indice(rows);
  const [et, ords] = estado === 'balance'
    ? [['Activo total', 'Pasivo total', 'Patrimonio'], [3000, 6000, 7950]]
    : [['Ingresos', 'Costos', 'Gastos op.', 'Utilidad neta'], [1950, 2950, 4950, 11000]];
  return [{ tipo: 'barras', titulo: estado === 'balance' ? 'Balance general: año contra año' : 'Estado de resultados: año contra año', etiquetas: et, nota: 'Montos en balboas.',
    series: [{ nombre: String(anio), valores: ords.map((o) => I.v(o)[0]), color: AZUL }, { nombre: String(anio - 1), valores: ords.map((o) => I.v(o)[1]), color: AMBAR }] }];
}

// Añade las gráficas e interpretación a una especificación de exportación
function conExtras(spec, graficas, interp) {
  const filas = spec.filas.slice();
  filas.push({ c: ['Interpretación', ...spec.columnas.slice(1).map(() => null)], e: 'grupo' });
  for (const t of interp) filas.push({ c: [t], e: 'texto' });
  return { ...spec, filas, graficas };
}

/* ---------------------------------- pantalla --------------------------------- */

function tarjetaInterp(bloques) {
  return h('div', { class: 'tarjeta interp' }, h('h3', null, 'Interpretación de resultados'),
    ...bloques.flatMap((b) => [bloques.length > 1 ? h('h4', null, b.titulo) : null, ...b.parrafos.map((t) => h('p', null, t))]));
}


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
      const rz = calcularRazones(d.balance, d.resultados);
      const inter = interpretarRazones(rz, est.anio).flatMap((b) => [b.titulo + ':'].concat(b.parrafos));
      return { specs: [conExtras(specRazones(rz, est.anio), graficasRazones(rz, est.anio), inter)], archivo: `${base}razones-${est.anio}` };
    }
    if (est.vista === 'vertical') {
      return {
        specs: [['balance', d.balance, 3000, 'Análisis vertical del balance general', 'Vertical balance'], ['resultados', d.resultados, 1950, 'Análisis vertical del estado de resultados', 'Vertical resultados']]
          .map(([e, rows, b, t, hoja]) => conExtras(specVertical(rows, b, t, hoja, est.anio), graficasVertical(rows, e, est.anio), interpretarVertical(rows, e, est.anio))),
        archivo: `${base}analisis-vertical-${est.anio}`
      };
    }
    return {
      specs: [['balance', d.balance, 'Análisis horizontal del balance general', 'Horizontal balance'], ['resultados', d.resultados, 'Análisis horizontal del estado de resultados', 'Horizontal resultados']]
        .map(([e, rows, t, hoja]) => conExtras(specHorizontal(rows, t, hoja, est.anio), graficasHorizontal(rows, e, est.anio), interpretarHorizontal(rows, e, est.anio))),
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
        h('p', { class: 'ayuda' }, 'En el Excel y el PDF cada razón lleva su fórmula.'),
        ...graficasRazones(rz, est.anio).map(graficaDeSpec),
        tarjetaInterp(interpretarRazones(rz, est.anio)));
      } else if (est.vista === 'vertical') {
        const rows = est.estado === 'balance' ? d.balance : d.resultados;
        const f = filasVertical(rows, est.estado === 'balance' ? 3000 : 1950, est.anio);
        const e = est.estado;
        cuerpo = h('div', null,
          tablaSimple([{ t: 'Concepto' }, { t: String(est.anio), num: true }, { t: '%', num: true }, { t: String(est.anio - 1), num: true }, { t: '%', num: true }], f, 'ancha'),
          ...graficasVertical(rows, e, est.anio).map(graficaDeSpec),
          tarjetaInterp([{ titulo: 'Qué dicen los números', parrafos: interpretarVertical(rows, e, est.anio) }]));
      } else {
        const rows = est.estado === 'balance' ? d.balance : d.resultados;
        const e = est.estado;
        cuerpo = h('div', null,
          tablaSimple([{ t: 'Concepto' }, { t: String(est.anio), num: true }, { t: String(est.anio - 1), num: true }, { t: 'Variación', num: true }, { t: '%', num: true }],
            filasHorizontal(rows), 'ancha'),
          ...graficasHorizontal(rows, e, est.anio).map(graficaDeSpec),
          tarjetaInterp([{ titulo: 'Qué dicen los números', parrafos: interpretarHorizontal(rows, e, est.anio) }]));
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
