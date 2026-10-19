// Panel de control y resumen ejecutivo: cifras clave, gráficos de barras y un
// resumen escrito con los datos del año. El resumen se exporta a Excel y PDF.
import {
  db, h, mostrar, traducirError, cargando, marcoEmpresa, cargarEmpresa, hoy
} from './lib.js';
import { barraExportar } from './informes.js';
import { cargarEstados, calcularRazones, textoValor } from './analisis.js';
import { n2 } from './exportar.js';
import { barrasAgrupadas, dona } from './graficas.js';
import { seccionVencimientos } from './vencimientos.js';

const NUM = (v) => Number(v || 0);
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const dinero = (v) => 'B/. ' + n2(v);
const valor = (rows, orden) => {
  const f = rows.find((x) => x.orden === orden);
  return [NUM(f && f.actual), NUM(f && f.anterior)];
};
const variacion = (a, b) => (Math.abs(b) < 0.005 ? null : ((a - b) / Math.abs(b)) * 100);
const pctTxt = (v) => v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %';

// Ingresos y gastos de cada mes del año, desde el balance de comprobación
async function cargarMensual(id, anio) {
  const meses = Array.from({ length: 12 }, (_, i) => i + 1);
  const res = await Promise.all(meses.map((m) => {
    const ult = new Date(Date.UTC(anio, m, 0)).getUTCDate();
    const mm = String(m).padStart(2, '0');
    return db.rpc('balance_comprobacion', { p_empresa: id, p_desde: `${anio}-${mm}-01`, p_hasta: `${anio}-${mm}-${String(ult).padStart(2, '0')}` });
  }));
  return res.map((r) => {
    if (r.error) throw r.error;
    let ing = 0; let gas = 0;
    for (const x of (r.data || [])) {
      if (Number(x.nivel) !== 1) continue;
      if (x.tipo === 'ingreso') ing += NUM(x.creditos) - NUM(x.debitos);
      else if (['costo', 'gasto', 'extraordinario'].includes(x.tipo)) gas += NUM(x.debitos) - NUM(x.creditos);
    }
    return { ingresos: ing, gastos: gas };
  });
}

// Cartera pendiente: total y lo que lleva más de 90 días
async function cargarCartera(id, tipo, fecha) {
  const r = await db.rpc('cartera_morosidad', { p_empresa: id, p_tipo: tipo, p_fecha: fecha });
  if (r.error) throw r.error;
  const t = (r.data || []).find((x) => x.orden === 2);
  if (!t) return { total: 0, vencida: 0, tramos: [0, 0, 0, 0] };
  const mas90 = NUM(t.d91_120) + NUM(t.d121_150) + NUM(t.d151_180) + NUM(t.mas_180);
  return { total: NUM(t.total), vencida: mas90, tramos: [NUM(t.hasta_30), NUM(t.d31_60), NUM(t.d61_90), mas90] };
}

// Gastos y costos del año por rubro (nivel 2 del catálogo; si no hay variedad, nivel 3)
async function cargarGastosRubro(id, anio) {
  const r = await db.rpc('balance_comprobacion', { p_empresa: id, p_desde: `${anio}-01-01`, p_hasta: `${anio}-12-31` });
  if (r.error) throw r.error;
  const filas = (r.data || []).filter((x) => ['costo', 'gasto', 'extraordinario'].includes(x.tipo));
  const por = (nivel) => filas.filter((x) => Number(x.nivel) === nivel)
    .map((x) => ({ nombre: String(x.nombre).replace(/^gastos? (de |del )?/i, '').trim() || x.nombre, valor: NUM(x.debitos) - NUM(x.creditos) }))
    .filter((x) => x.valor > 0.004).sort((a, b) => b.valor - a.valor);
  let lista = por(2);
  if (lista.length < 2) lista = por(3);
  if (lista.length > 6) {
    const resto = lista.slice(5).reduce((a, x) => a + x.valor, 0);
    lista = lista.slice(0, 5).concat([{ nombre: 'Otros', valor: resto }]);
  }
  return lista;
}

// Frases del resumen. Solo se escribe lo que los números permiten afirmar.
function redactar(anio, d, razones, cxc, cxp) {
  const [ing, ingA] = valor(d.resultados, 1950);
  const [un, unA] = valor(d.resultados, 11000);
  const [ta] = valor(d.balance, 3000);
  const [tp] = valor(d.balance, 6000);
  const [pat] = valor(d.balance, 7950);
  const ctl = d.balance.find((x) => x.fila === 'control');
  const frases = [];
  const vi = variacion(ing, ingA);
  frases.push(`Los ingresos de ${anio} fueron ${dinero(ing)}` + (vi === null
    ? (ingA === 0 ? '; no hay cifra del año anterior para comparar.' : '.')
    : `, ${vi >= 0 ? 'un ' + pctTxt(vi) + ' más' : 'un ' + pctTxt(Math.abs(vi)) + ' menos'} que en ${anio - 1} (${dinero(ingA)}).`));
  frases.push(un >= 0
    ? `La utilidad neta fue ${dinero(un)}` + (ing ? `, un margen de ${pctTxt((un / ing) * 100)} sobre los ingresos` : '') + (unA ? ` (año anterior: ${dinero(unA)}).` : '.')
    : `El año cerró con una pérdida neta de ${dinero(Math.abs(un))}` + (unA ? ` (año anterior: ${dinero(unA)}).` : '.'));
  frases.push(`Al cierre el activo total es ${dinero(ta)}, con pasivos de ${dinero(tp)} y patrimonio de ${dinero(pat)}.`);
  const rc = razones.find((x) => x.nombre === 'Razón corriente');
  if (rc && rc.a !== null) {
    frases.push(`La razón corriente es ${textoValor(rc.a, 'x')}` + (rc.a < 1 ? ': los pasivos corrientes superan a los activos corrientes.' : '.'));
  }
  if (cxc.total > 0) {
    frases.push(`Los clientes deben ${dinero(cxc.total)}` + (cxc.vencida > 0 ? `, de los cuales ${dinero(cxc.vencida)} llevan más de 90 días.` : ', y nada pasa de 90 días.'));
  }
  if (cxp.total > 0) {
    frases.push(`Se debe a proveedores ${dinero(cxp.total)}` + (cxp.vencida > 0 ? `, de los cuales ${dinero(cxp.vencida)} llevan más de 90 días.` : ', y nada pasa de 90 días.'));
  }
  if (ctl && (Math.abs(NUM(ctl.actual)) > 0.005 || Math.abs(NUM(ctl.anterior)) > 0.005)) {
    frases.push('Atención: el balance general no cuadra. Revisa los asientos antes de usar estas cifras.');
  }
  return frases;
}

function specResumen(empresa, anio, d, razones, frases) {
  const ind = [
    ['Ingresos', ...valor(d.resultados, 1950)], ['Utilidad bruta', ...valor(d.resultados, 3000)],
    ['Utilidad operativa', ...valor(d.resultados, 5000)], ['Utilidad neta', ...valor(d.resultados, 11000)],
    ['Activo total', ...valor(d.balance, 3000)], ['Pasivo total', ...valor(d.balance, 6000)], ['Patrimonio', ...valor(d.balance, 7950)]
  ];
  const filas = ind.map(([n, a, b]) => ({ c: [n, a, b, a - b], e: 'normal' }));
  filas.push({ c: ['Razones', null, null, null], e: 'grupo' });
  for (const r of razones.filter((x) => !x.grupo && ['Razón corriente', 'Margen neto', 'Pasivo total sobre activo total', 'Rendimiento sobre patrimonio'].includes(x.nombre))) {
    filas.push({ c: [r.nombre, textoValor(r.a, r.tipo), textoValor(r.b, r.tipo), null], e: 'normal' });
  }
  return {
    titulo: 'Resumen ejecutivo', subtitulo: `Año ${anio}`, hoja: 'Resumen ejecutivo',
    columnas: [{ t: 'Indicador', w: 1 }, { t: String(anio), num: true }, { t: String(anio - 1), num: true }, { t: 'Variación', num: true }],
    filas,
    notas: frases
  };
}

export async function vistaPanel(id) {
  mostrar(marcoEmpresa({ id, razon_social: '…' }, 'panel', cargando()));
  const empresa = await cargarEmpresa(id);
  const est = { anio: Number(hoy().slice(0, 4)), exp: null };
  const zona = h('div');
  const selAnio = h('input', {
    type: 'number', min: '2000', max: '2100', inputmode: 'numeric', value: String(est.anio),
    onchange: (e) => { const v = Number(e.target.value); if (v >= 2000 && v <= 2100) { est.anio = v; pintar(); } }
  });

  async function pintar() {
    zona.replaceChildren(cargando());
    try {
      const corte = est.anio === Number(hoy().slice(0, 4)) ? hoy() : `${est.anio}-12-31`;
      const [d, mensual, cxc, cxp, rubros] = await Promise.all([
        cargarEstados(id, est.anio), cargarMensual(id, est.anio),
        cargarCartera(id, 'cliente', corte), cargarCartera(id, 'proveedor', corte),
        cargarGastosRubro(id, est.anio)
      ]);
      const hay = d.balance.some((x) => x.fila === 'detalle') || d.resultados.some((x) => x.fila === 'detalle');
      if (!hay) {
        est.exp = null;
        zona.replaceChildren(h('p', { class: 'ayuda' }, 'No hay cifras para ese año todavía.'));
        return;
      }
      const razones = calcularRazones(d.balance, d.resultados);
      const frases = redactar(est.anio, d, razones, cxc, cxp);
      est.exp = { specs: [specResumen(empresa, est.anio, d, razones, frases)], archivo: `${empresa.razon_social}-resumen-ejecutivo-${est.anio}` };

      const [ing] = valor(d.resultados, 1950); const [un] = valor(d.resultados, 11000);
      const [ta] = valor(d.balance, 3000); const [tp] = valor(d.balance, 6000);
      const chip = (t, v) => h('div', { class: 'chip' }, h('span', { class: 'ayuda' }, t), h('strong', null, v));
      const rc = razones.find((x) => x.nombre === 'Razón corriente');

      zona.replaceChildren(
        barraExportar({ empresa, obtener: () => est.exp, etiquetaExcel: 'Resumen en Excel', etiquetaPdf: 'Resumen en PDF' }),
        h('div', { class: 'resumen' },
          chip('Ingresos', dinero(ing)), chip('Utilidad neta', dinero(un)),
          chip('Activos', dinero(ta)), chip('Pasivos', dinero(tp)),
          chip('Razón corriente', rc ? textoValor(rc.a, 'x') : '—'),
          chip('Por cobrar', dinero(cxc.total)), chip('Por pagar', dinero(cxp.total))),
        h('div', { class: 'tarjeta' }, h('h3', null, 'Resumen ejecutivo'),
          ...frases.map((x) => h('p', null, x))),
        barrasAgrupadas({
          titulo: `Ingresos, gastos y utilidad por mes, ${est.anio}`,
          etiquetas: MESES,
          series: [{ nombre: 'Ingresos', valores: mensual.map((m) => m.ingresos), color: 'var(--g1)' },
            { nombre: 'Gastos y costos', valores: mensual.map((m) => m.gastos), color: 'var(--g2)' }],
          linea: { nombre: 'Utilidad del mes', valores: mensual.map((m) => m.ingresos - m.gastos), color: 'var(--g3)' },
          nota: 'Montos en balboas. La línea baja de cero cuando el mes tuvo pérdida.'
        }),
        dona({ titulo: `En qué se van los gastos y costos, ${est.anio}`, items: rubros, centro: 'Total' }),
        dona({
          titulo: 'Cómo se financia el activo',
          items: [{ nombre: 'Pasivos', valor: tp }, { nombre: 'Patrimonio', valor: Math.max(0, valor(d.balance, 7950)[0]) }],
          centro: 'Activo', nota: `Activo total: ${dinero(ta)}.`
        }),
        barrasAgrupadas({
          titulo: 'Antigüedad de lo que se cobra y se paga',
          etiquetas: ['Hasta 30 días', '31 a 60', '61 a 90', 'Más de 90'],
          series: [{ nombre: 'Por cobrar', valores: cxc.tramos, color: 'var(--g1)' },
            { nombre: 'Por pagar', valores: cxp.tramos, color: 'var(--g2)' }],
          nota: `Al ${corte.split('-').reverse().join('/')}.`
        }),
        barrasAgrupadas({
          titulo: 'Año contra año',
          etiquetas: ['Ingresos', 'Costos', 'Gastos op.', 'Utilidad neta'],
          series: [{ nombre: String(est.anio), valores: [1950, 2950, 4950, 11000].map((o) => valor(d.resultados, o)[0]), color: 'var(--g1)' },
            { nombre: String(est.anio - 1), valores: [1950, 2950, 4950, 11000].map((o) => valor(d.resultados, o)[1]), color: 'var(--g4)' }]
        }));
    } catch (e) {
      est.exp = null;
      zona.replaceChildren(h('div', { class: 'tarjeta error' }, h('p', null, traducirError(e))));
    }
  }

  mostrar(marcoEmpresa(empresa, 'panel', [seccionVencimientos(empresa), h('div', { class: 'filtros' }, selAnio), zona]));
  pintar();
}

// FIN DEL ARCHIVO panel.js
