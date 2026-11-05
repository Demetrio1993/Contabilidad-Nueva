// Estados Financieros Pymes: arma los cuatro estados y las notas con las MISMAS cifras de los estados
// financieros actuales (estado_balance_general, estado_resultados, estado_cambios_patrimonio y
// estado_flujo_efectivo, con las cifras manuales del año anterior ya aplicadas). No calcula nada nuevo:
// solo ordena, rotula, enlaza cada línea con su nota y reparte los saldos por cuenta en las notas.
import { DEFS, NOTA_DE_CUENTA, NOTA_DE_BANDA_RESULTADOS, NOTA_DE_FLUJO } from './efpymesnotas.js';

const NUM = (v) => Number(v || 0);
const r2 = (v) => Math.round(NUM(v) * 100) / 100;
const banda = (r) => Math.floor(NUM(r.orden) / 1000);
const oracion = (s) => {
  const t = String(s || '');
  return /[A-ZÁÉÍÓÚÑ]/.test(t) && t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t;
};
const sumaCol = (rows, col) => rows.reduce((s, r) => s + NUM(r[col]), 0);

export const PATRON_PENDIENTE = /\[(Completar|Confirmar)[^\]]*\]/g;

/* ------------------------- datos de la empresa para los textos ------------------------- */
export function datosTexto(ctx) {
  const e = ctx.empresa || {};
  const nombre = e.razon_social || '';
  return {
    nombre,
    ruc: e.ruc ? `RUC ${e.ruc}${e.dv ? ' DV ' + e.dv : ''}` : '',
    natural: e.tipo_persona !== 'juridica',
    anio: ctx.anio, ant: ctx.anio - 1,
    itbms: !!e.contribuyente_itbms,
    actividad: e.actividad_economica || '[Completar: actividad económica]',
    dir: e.direccion || '[Completar: dirección]',
    marco: e.marco_contable || 'NIIF para las PYMES',
    manual: !!ctx.hayManuales,
    agro: [...(ctx.res || []), ...(ctx.bal || [])].some((r) => String(r.numero || '').startsWith('4.1.04') && (NUM(r.actual) || NUM(r.anterior))),
    propietario: e.representante_legal || nombre
  };
}

/* ------------------------------ tablas de las notas ------------------------------ */

function detalleDe(ctx, numero) {
  return (ctx.det || []).filter((d) => d.prefijo === `${numero}.`);
}

function filasGrupo(g, ctx, etiquetaAjuste) {
  const out = [];
  const hijos = detalleDe(ctx, g.numero);
  const nombre = `${g.numero} ${g.concepto}`;
  if (!hijos.length) {
    out.push({ k: 'det', c: nombre, a: r2(g.actual), p: r2(g.anterior) });
    return out;
  }
  out.push({ k: 'sub', c: nombre, a: r2(g.actual), p: r2(g.anterior) });
  let ha = 0; let hp = 0;
  hijos.forEach((d) => {
    out.push({ k: 'det', n: 1, c: `${d.numero} ${d.nombre}`, a: r2(d.actual), p: r2(d.anterior) });
    ha += NUM(d.actual); hp += NUM(d.anterior);
  });
  if (Math.abs(NUM(g.actual) - ha) > 0.004 || Math.abs(NUM(g.anterior) - hp) > 0.004) {
    out.push({ k: 'det', n: 1, c: etiquetaAjuste, a: r2(NUM(g.actual) - ha), p: r2(NUM(g.anterior) - hp) });
  }
  return out;
}

function tablaBalance(def, ctx) {
  const grupos = ctx.bal.filter((r) => r.fila === 'detalle' && def.n3.includes(r.numero));
  const extra = def.conSinNumero ? ctx.bal.filter((r) => r.fila === 'detalle' && !r.numero && banda(r) === 7) : [];
  const out = [];
  grupos.forEach((g) => out.push(...filasGrupo(g, ctx, 'Otras partidas y ajustes (cifras manuales del período anterior)')));
  extra.forEach((x) => out.push({ k: 'det', c: oracion(x.concepto), a: r2(x.actual), p: r2(x.anterior) }));
  if (grupos.length + extra.length > 1) {
    out.push({ k: 'total', c: 'Total', a: r2(sumaCol(grupos, 'actual') + sumaCol(extra, 'actual')), p: r2(sumaCol(grupos, 'anterior') + sumaCol(extra, 'anterior')), m: true });
  }
  if (def.clave === 'ppe') {
    const neto = (col) => sumaCol(grupos, col);
    const dep = (col) => (ctx.det || []).filter((d) => d.prefijo === '6.1.06.' && /deprec/i.test(d.nombre)).reduce((s, d) => s + NUM(d[col]), 0);
    const iniA = neto('anterior');
    const iniP = sumaCol((ctx.balPrev || []).filter((r) => r.fila === 'detalle' && def.n3.includes(r.numero)), 'anterior');
    const finA = neto('actual'); const finP = neto('anterior');
    out.push({ k: 'titulo', c: 'Conciliación del valor en libros neto' });
    out.push({ k: 'det', c: 'Valor en libros neto al inicio del año', a: r2(iniA), p: r2(iniP) });
    out.push({ k: 'det', c: 'Adquisiciones netas de bajas (calculadas por diferencia)', a: r2(finA - iniA + dep('actual')), p: r2(finP - iniP + dep('anterior')) });
    out.push({ k: 'det', c: '(−) Depreciación del año', a: r2(-dep('actual')), p: r2(-dep('anterior')) });
    out.push({ k: 'total', c: 'Valor en libros neto al final del año', a: r2(finA), p: r2(finP), m: true });
  }
  return out;
}

function tablaResultado(def, ctx) {
  const rows = ctx.res.filter((r) => def.bandas.includes(banda(r)) && (r.fila === 'detalle' || (r.fila === 'subtotal' && NUM(r.orden) % 1000 !== 950)));
  const totales = ctx.res.filter((r) => r.fila === 'subtotal' && def.bandas.includes(banda(r)) && NUM(r.orden) % 1000 === 950);
  const out = [];
  const etiqueta = def.clave === 'costos' ? 'Efecto del inventario inicial, final y compras (ver estado de resultados)' : 'Otras partidas y ajustes';
  rows.forEach((g) => {
    if (g.numero) out.push(...filasGrupo(g, ctx, etiqueta));
    else out.push({ k: g.fila === 'subtotal' ? 'subtotal' : 'det', c: oracion(g.concepto), a: r2(g.actual), p: r2(g.anterior) });
  });
  if (rows.length > 1 && totales.length) out.push({ k: 'total', c: 'Total', a: r2(sumaCol(totales, 'actual')), p: r2(sumaCol(totales, 'anterior')), m: true });
  if (def.clave === 'impuestos_renta') {
    const ut = ctx.res.find((r) => NUM(r.orden) === 9000);
    const tot = totales.length ? { a: sumaCol(totales, 'actual'), p: sumaCol(totales, 'anterior') } : { a: 0, p: 0 };
    if (ut) {
      out.push({ k: 'det', c: 'Utilidad antes del impuesto sobre la renta', a: r2(ut.actual), p: r2(ut.anterior) });
      out.push({ k: 'det', c: 'Tasa efectiva (impuestos entre utilidad antes del impuesto sobre la renta)', a: NUM(ut.actual) > 0 ? tot.a / NUM(ut.actual) * 100 : null, p: NUM(ut.anterior) > 0 ? tot.p / NUM(ut.anterior) * 100 : null, f: 'pct' });
    }
  }
  return out;
}

const sumaN3 = (ctx, lista, col) => sumaCol(ctx.bal.filter((r) => r.fila === 'detalle' && lista.includes(r.numero)), col);

function tablaEspecial(def, ctx) {
  if (def.clave === 'partes') {
    const ap = ctx.pat.find((r) => NUM(r.orden) === 1020); const re = ctx.pat.find((r) => NUM(r.orden) === 1030);
    return [
      { k: 'det', c: 'Aportes de capital del propietario', a: r2(ap && ap.actual), p: r2(ap && ap.anterior) },
      { k: 'det', c: 'Retiros del propietario', a: r2(re && re.actual), p: r2(re && re.anterior) }
    ];
  }
  if (def.clave === 'riesgos') {
    const efA = sumaN3(ctx, ['1.1.01'], 'actual'); const efP = sumaN3(ctx, ['1.1.01'], 'anterior');
    const cxA = sumaN3(ctx, ['1.1.02', '1.1.03', '1.1.04'], 'actual'); const cxP = sumaN3(ctx, ['1.1.02', '1.1.03', '1.1.04'], 'anterior');
    const pcA = sumaN3(ctx, ['2.1.01'], 'actual'); const pcP = sumaN3(ctx, ['2.1.01'], 'anterior');
    const obA = sumaN3(ctx, ['2.1.02', '2.2.01'], 'actual'); const obP = sumaN3(ctx, ['2.1.02', '2.2.01'], 'anterior');
    const otA = sumaN3(ctx, ['2.1.05'], 'actual'); const otP = sumaN3(ctx, ['2.1.05'], 'anterior');
    const corr = ctx.bal.filter((r) => r.fila === 'detalle' && banda(r) === 4); const nocorr = ctx.bal.filter((r) => r.fila === 'detalle' && banda(r) === 5);
    return [
      { k: 'titulo', c: 'Activos financieros' },
      { k: 'det', c: 'Efectivo y equivalentes de efectivo', a: r2(efA), p: r2(efP) },
      { k: 'det', c: 'Cuentas por cobrar comerciales y otras, neto de provisión', a: r2(cxA), p: r2(cxP) },
      { k: 'total', c: 'Total activos financieros', a: r2(efA + cxA), p: r2(efP + cxP), m: true },
      { k: 'titulo', c: 'Pasivos financieros' },
      { k: 'det', c: 'Cuentas por pagar comerciales', a: r2(pcA), p: r2(pcP) },
      { k: 'det', c: 'Obligaciones financieras', a: r2(obA), p: r2(obP) },
      { k: 'det', c: 'Otras cuentas por pagar y acumulaciones', a: r2(otA), p: r2(otP) },
      { k: 'total', c: 'Total pasivos financieros', a: r2(pcA + obA + otA), p: r2(pcP + obP + otP), m: true },
      { k: 'titulo', c: 'Vencimiento de los pasivos' },
      { k: 'det', c: 'Dentro de los doce meses siguientes (pasivos corrientes)', a: r2(sumaCol(corr, 'actual')), p: r2(sumaCol(corr, 'anterior')) },
      { k: 'det', c: 'Después de doce meses (pasivos no corrientes)', a: r2(sumaCol(nocorr, 'actual')), p: r2(sumaCol(nocorr, 'anterior')) }
    ];
  }
  if (def.clave === 'flujo_comp') {
    return [
      { k: 'det', c: 'Efectivo y equivalentes al final del año (igual al estado de situación financiera)', a: r2(sumaN3(ctx, ['1.1.01'], 'actual')), p: r2(sumaN3(ctx, ['1.1.01'], 'anterior')) },
      { k: 'det', c: 'Impuestos sobre la renta pagados en el año', a: null, p: null },
      { k: 'det', c: 'Intereses pagados en el año', a: null, p: null },
      { k: 'det', c: 'Transacciones de inversión y de financiamiento que no usaron efectivo', a: null, p: null }
    ];
  }
  return [];
}

function tablaSistema(def, ctx) {
  if (def.tipo === 'balance') return tablaBalance(def, ctx);
  if (def.tipo === 'resultado') return tablaResultado(def, ctx);
  if (def.tipo === 'especial') return tablaEspecial(def, ctx);
  return [];
}

function conTablaUtil(def, ctx) {
  if (def.tipo === 'balance') {
    const g = ctx.bal.filter((r) => r.fila === 'detalle' && (def.n3.includes(r.numero) || (def.conSinNumero && !r.numero && banda(r) === 7)));
    return g.some((r) => NUM(r.actual) || NUM(r.anterior));
  }
  if (def.tipo === 'resultado') return ctx.res.some((r) => r.fila === 'detalle' && def.bandas.includes(banda(r)) && (NUM(r.actual) || NUM(r.anterior)));
  return true;
}

/* ----------------------------------- notas ----------------------------------- */

// Devuelve la lista de notas con su número, texto y cuadro (del sistema o editados) y el mapa clave -> número.
export function modeloNotas(ctx) {
  const c = datosTexto(ctx);
  const over = ctx.over || new Map();
  const incl = DEFS.filter((d) => ['texto', 'especial'].includes(d.tipo) || over.has(d.clave) || conTablaUtil(d, ctx));
  const numNota = {};
  incl.forEach((d, i) => { numNota[d.clave] = i + 1; });
  const lista = incl.map((d) => {
    const o = over.get(d.clave) || {};
    const sistema = tablaSistema(d, ctx);
    const textoInicial = d.texto(c);
    return {
      clave: d.clave, num: numNota[d.clave], tipo: d.tipo,
      titulo: o.titulo || d.titulo, ref: d.ref,
      texto: o.texto != null ? o.texto : textoInicial,
      textoInicial,
      tabla: o.tabla ? o.tabla : sistema,
      tablaSistema: sistema,
      editadaTexto: o.texto != null, editadaTabla: !!o.tabla, tituloInicial: d.titulo
    };
  });
  return { lista, numNota };
}

export function pendientesPorCompletar(lista) {
  let n = 0;
  lista.forEach((x) => { n += (String(x.texto).match(PATRON_PENDIENTE) || []).length; });
  return n;
}

/* ---------------------------------- estados ---------------------------------- */

const ref = (numNota, clave) => (clave && numNota[clave] ? String(numNota[clave]) : null);

export function docBalance(ctx, numNota) {
  const filas = []; let ultima = null; let primero = true;
  const ENC = { 1: [['titulo', 'ACTIVOS'], ['sub', 'Activos corrientes']], 2: [['sub', 'Activos no corrientes']], 4: [['titulo', 'PASIVOS'], ['sub', 'Pasivos corrientes']], 5: [['sub', 'Pasivos no corrientes']], 7: [['titulo', 'PATRIMONIO']] };
  ctx.bal.filter((r) => r.fila !== 'control').forEach((r) => {
    const b = banda(r);
    if ((r.fila === 'detalle' || r.fila === 'subtotal') && ENC[b] && b !== ultima) { ENC[b].forEach(([k, t]) => filas.push({ k, c: t })); ultima = b; }
    if (r.fila === 'detalle') {
      const clave = r.numero ? NOTA_DE_CUENTA[r.numero] : (/pendiente de cierre/i.test(r.concepto || '') ? 'patrimonio' : null);
      filas.push({ k: 'det', n: 1, c: oracion(r.concepto), a: r2(r.actual), p: r2(r.anterior), nota: ref(numNota, clave), m: primero, numero: r.numero || null, orden: r.orden });
      primero = false;
    } else if (r.fila === 'subtotal') filas.push({ k: 'subtotal', c: oracion(r.concepto), a: r2(r.actual), p: r2(r.anterior) });
    else filas.push({ k: NUM(r.orden) === 6000 ? 'subtotal' : 'total', c: oracion(r.concepto), a: r2(r.actual), p: r2(r.anterior), m: NUM(r.orden) !== 6000 });
  });
  return {
    tipo: 'estado', clave: 'balance', hoja: 'Situación financiera', titulo: 'Estado de situación financiera',
    subtitulo: `Al 31 de diciembre de ${ctx.anio} y de ${ctx.anio - 1}`, anios: [ctx.anio, ctx.anio - 1], filas
  };
}

const RES_ENC = { 1: 'Ingresos de actividades ordinarias', 2: 'Costos', 4: 'Gastos de operación', 6: 'Otros ingresos', 7: 'Gastos financieros', 8: 'Otros gastos y egresos', 10: 'Impuesto sobre la renta y seguro educativo' };
const RES_TOT = { 1950: 'Total ingresos de actividades ordinarias', 2950: 'Total costos', 4950: 'Total gastos de operación', 6950: 'Total otros ingresos', 7950: 'Total gastos financieros', 8950: 'Total otros gastos y egresos', 10950: 'Total impuesto sobre la renta y seguro educativo' };

export function docResultados(ctx, numNota) {
  const filas = []; let ultima = null; let primero = true;
  ctx.res.filter((r) => r.fila !== 'control').forEach((r) => {
    const b = banda(r); const o = NUM(r.orden);
    if ((r.fila === 'detalle' || r.fila === 'subtotal') && RES_ENC[b] && b !== ultima && o % 1000 !== 950) {
      filas.push({ k: 'sub', c: RES_ENC[b], nota: null }); ultima = b;
    }
    if (r.fila === 'detalle') {
      filas.push({ k: 'det', n: 1, c: oracion(r.concepto), a: r2(r.actual), p: r2(r.anterior), nota: ref(numNota, NOTA_DE_BANDA_RESULTADOS[b]), m: primero, numero: r.numero || null, orden: r.orden });
      primero = false;
    } else if (r.fila === 'subtotal') {
      filas.push({ k: 'subtotal', c: RES_TOT[o] || oracion(r.concepto), a: r2(r.actual), p: r2(r.anterior) });
    } else {
      const neta = o === 11000;
      filas.push({ k: neta ? 'total' : 'subtotal', c: neta ? 'Utilidad neta del año' : oracion(r.concepto), a: r2(r.actual), p: r2(r.anterior), m: neta });
    }
  });
  filas.push({ k: 'texto', c: `Resultado integral total: es igual a la utilidad neta del año, porque la entidad no tiene partidas de otro resultado integral (Nota ${numNota.bases || '2'}).` });
  return {
    tipo: 'estado', clave: 'resultados', hoja: 'Resultados', titulo: 'Estado de resultados',
    subtitulo: `Por el año terminado el 31 de diciembre de ${ctx.anio} (con cifras comparativas de ${ctx.anio - 1})`, anios: [ctx.anio, ctx.anio - 1], filas
  };
}

export function docFlujo(ctx, numNota) {
  const filas = []; let ultima = null;
  const ENC = { 1: 'Flujos de efectivo de las actividades de operación', 2: 'Flujos de efectivo de las actividades de inversión', 3: 'Flujos de efectivo de las actividades de financiamiento' };
  ctx.flu.filter((r) => r.fila !== 'control').forEach((r) => {
    const o = NUM(r.orden); const b = banda(r);
    if (ENC[b] && b !== ultima && r.fila === 'detalle') { filas.push({ k: 'titulo', c: ENC[b] }); ultima = b; }
    if (r.fila === 'detalle') {
      filas.push({ k: 'det', n: b === 4 ? 0 : 1, c: oracion(r.concepto), a: r2(r.actual), p: r2(r.anterior), nota: ref(numNota, NOTA_DE_FLUJO[o]), orden: o });
    } else if (r.fila === 'subtotal') filas.push({ k: 'subtotal', c: oracion(r.concepto), a: r2(r.actual), p: r2(r.anterior) });
    else if (o === 4020) filas.push({ k: 'total', c: oracion(r.concepto), a: r2(r.actual), p: r2(r.anterior), m: true, nota: ref(numNota, 'efectivo') });
    else filas.push({ k: 'subtotal', c: oracion(r.concepto), a: r2(r.actual), p: r2(r.anterior) });
  });
  return {
    tipo: 'estado', clave: 'flujo', hoja: 'Flujos de efectivo', titulo: 'Estado de flujos de efectivo (método indirecto)',
    subtitulo: `Por el año terminado el 31 de diciembre de ${ctx.anio} (con cifras comparativas de ${ctx.anio - 1})`, anios: [ctx.anio, ctx.anio - 1], filas,
    pie: numNota.flujo_comp ? `Información complementaria: Nota ${numNota.flujo_comp}.` : ''
  };
}

function compPatrimonio(rows, col) {
  const det = rows.filter((r) => r.fila === 'detalle');
  const g = (n) => det.filter((r) => r.numero === n).reduce((s, r) => s + NUM(r[col]), 0);
  const pend = det.filter((r) => !r.numero && /pendiente/i.test(r.concepto || '')).reduce((s, r) => s + NUM(r[col]), 0);
  return { cap: g('3.1.01'), ret: g('3.2.01'), ut: g('3.3.01') + pend };
}

export function docPatrimonio(ctx, numNota) {
  const mov = (col) => {
    const f = (o) => NUM((ctx.pat.find((r) => NUM(r.orden) === o) || {})[col]);
    return { ap: f(1020), re: f(1030), ut: f(1040), ot: f(1050) };
  };
  const bloque = (anio, ini, m, fin) => {
    const f = [];
    const tot = (c) => c.cap + c.ret + c.ut;
    f.push({ k: 'subtotal', c: `Saldos al 1 de enero de ${anio}`, v: [r2(ini.cap), r2(ini.ret), r2(ini.ut), r2(tot(ini))], m: true });
    if (m.ap) f.push({ k: 'det', c: 'Aportes del propietario', v: [r2(m.ap), null, null, r2(m.ap)] });
    if (m.re) f.push({ k: 'det', c: 'Retiros del propietario', v: [null, r2(m.re), null, r2(m.re)] });
    f.push({ k: 'det', c: 'Utilidad neta del año', v: [null, null, r2(m.ut), r2(m.ut)] });
    if (m.ot) f.push({ k: 'det', c: 'Otros movimientos del patrimonio', v: [null, null, r2(m.ot), r2(m.ot)] });
    const resCap = fin.cap - ini.cap - m.ap;
    const T = fin.ret - ini.ret - m.re;
    const resUt = fin.ut - (ini.ut + m.ut + m.ot - T);
    if (Math.abs(resCap) > 0.004) f.push({ k: 'det', c: 'Otros cambios en el capital', v: [r2(resCap), null, null, r2(resCap)] });
    if (Math.abs(T) > 0.004) f.push({ k: 'det', c: 'Traslado de los retiros a utilidades acumuladas (cierre anual)', v: [null, r2(T), r2(-T), 0] });
    if (Math.abs(resUt) > 0.004) f.push({ k: 'det', c: 'Otros ajustes (cifras manuales del período anterior)', v: [null, null, r2(resUt), r2(resUt)] });
    f.push({ k: 'total', c: `Saldos al 31 de diciembre de ${anio}`, v: [r2(fin.cap), r2(fin.ret), r2(fin.ut), r2(tot(fin))], m: true });
    return { titulo: `Ejercicio ${anio}`, filas: f };
  };
  const finY = compPatrimonio(ctx.bal, 'actual'); const finA = compPatrimonio(ctx.bal, 'anterior'); const iniA = compPatrimonio(ctx.balPrev || [], 'anterior');
  return {
    tipo: 'matriz', clave: 'patrimonio', hoja: 'Cambios en el patrimonio', titulo: 'Estado de cambios en el patrimonio',
    subtitulo: `Por los años terminados el 31 de diciembre de ${ctx.anio - 1} y de ${ctx.anio}`,
    columnas: ['Capital del propietario', 'Retiros del propietario', 'Utilidades acumuladas y resultado del ejercicio', 'Total patrimonio'],
    bloques: [bloque(ctx.anio - 1, iniA, mov('anterior'), finA), bloque(ctx.anio, finA, mov('actual'), finY)],
    pie: numNota.patrimonio ? `Véase la Nota ${numNota.patrimonio} (Patrimonio) y la Nota ${numNota.partes || ''} (Partes relacionadas).` : ''
  };
}

/* ------------------------- paquete completo de documentos ------------------------- */

export function nombreContador(ctx) {
  const c = ctx.contador || {};
  return { nombre: c.nombre || 'Demetrio Dutari Castro', idoneidad: c.idoneidad ? `Idoneidad N.º ${c.idoneidad}` : 'Idoneidad N.º [Completar]' };
}

export function construirTodo(ctx) {
  const { lista, numNota } = modeloNotas(ctx);
  const cont = nombreContador(ctx);
  const prop = (ctx.empresa && ctx.empresa.representante_legal) || (ctx.empresa && ctx.empresa.razon_social) || '';
  const firmas = [[prop, ctx.empresa && ctx.empresa.tipo_persona === 'juridica' ? 'Representante legal' : 'Propietario'], [cont.nombre, 'Contador Público Autorizado', cont.idoneidad]];
  const balance = docBalance(ctx, numNota); balance.firmas = firmas;
  const resultados = docResultados(ctx, numNota);
  const patrimonio = docPatrimonio(ctx, numNota);
  const flujo = docFlujo(ctx, numNota); flujo.firmas = firmas;
  const notas = {
    tipo: 'notas', clave: 'notas', hoja: 'Notas', titulo: 'Notas a los estados financieros',
    subtitulo: `Por el año terminado el 31 de diciembre de ${ctx.anio} (con cifras comparativas de ${ctx.anio - 1})`, anios: [ctx.anio, ctx.anio - 1],
    notas: lista.map((n) => ({ num: n.num, titulo: n.titulo, ref: n.ref ? `Referencia: ${n.ref}` : '', parrafos: String(n.texto).split(/\n{2,}/).filter((x) => x.trim()), tabla: n.tabla }))
  };
  const portada = {
    tipo: 'portada', clave: 'portada', titulo: 'Estados financieros',
    lineas: ['Estados financieros', `Al 31 de diciembre de ${ctx.anio}`, `con cifras comparativas de ${ctx.anio - 1}`, 'Preparados de conformidad con la NIIF para las PYMES'],
    contenido: ['Estado de situación financiera', 'Estado de resultados', 'Estado de cambios en el patrimonio', 'Estado de flujos de efectivo (método indirecto)', `Notas a los estados financieros (Notas 1 a ${lista.length})`],
    firma: [cont.nombre, `Contador Público Autorizado · ${cont.idoneidad}`]
  };
  return { lista, numNota, docs: { portada, balance, resultados, patrimonio, flujo, notas } };
}

// FIN DEL ARCHIVO efpymesdatos.js
