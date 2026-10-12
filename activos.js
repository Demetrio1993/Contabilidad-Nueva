// Activos fijos y diferidos: lista con depreciación o amortización, alta de
// activos, contabilización mensual, venta o baja, y matriz anual. Exporta a Excel y PDF.
import {
  db, h, mostrar, toast, modal, campo, texto, traducirError, cargando,
  marcoEmpresa, cargarEmpresa, hoy, redondear, fechaCorta
} from './lib.js';
import { barraExportar } from './informes.js';
import { tablaSimple } from './fiscal.js';

const NUM = (v) => Number(v || 0);
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
  'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const TIPOS = { depreciacion: 'Activos fijos (depreciación)', amortizacion: 'Diferidos e intangibles (amortización)' };

function finDeMes(f) {
  const [a, m] = f.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

/* ---------------------------- especificaciones ---------------------------- */

function specResumen(rows, tipo, fecha) {
  const dep = tipo === 'depreciacion';
  const filas = rows.map((r) => ({
    c: [r.nombre, fechaCorta(r.fecha_adquisicion), NUM(r.valor_inicial), NUM(r.valor_residual),
      `${NUM(r.vida_util_anios)} años (${NUM(r.porcentaje)}%)`, NUM(r.cuota_mensual),
      NUM(r.depreciacion_acumulada), NUM(r.valor_actual), NUM(r.por_depreciar), r.estado + (r.fecha_baja ? ' ' + fechaCorta(r.fecha_baja) : '')],
    e: 'normal'
  }));
  const s = (k) => rows.reduce((t, r) => t + NUM(r[k]), 0);
  filas.push({ c: ['TOTAL', null, s('valor_inicial'), s('valor_residual'), null, s('cuota_mensual'),
    s('depreciacion_acumulada'), s('valor_actual'), s('por_depreciar'), null], e: 'total' });
  return {
    titulo: dep ? 'Cuadro de activos fijos y depreciación' : 'Cuadro de diferidos e intangibles y amortización',
    subtitulo: `Al ${fechaCorta(fecha)}`,
    hoja: dep ? 'Depreciación' : 'Amortización',
    horizontal: true,
    columnas: [{ t: 'Activo', w: 1 }, { t: 'Adquisición' }, { t: 'Valor inicial', num: true }, { t: 'Residual', num: true },
      { t: 'Vida útil' }, { t: 'Cuota mensual', num: true }, { t: dep ? 'Deprec. acumulada' : 'Amort. acumulada', num: true },
      { t: 'Valor en libros', num: true }, { t: 'Por depreciar', num: true }, { t: 'Estado' }],
    filas,
    notas: ['Línea recta. Comienza el mes siguiente a la adquisición, salvo que se indique otro mes.']
  };
}

function specMatriz(rows, tipo, anio) {
  const dep = tipo === 'depreciacion';
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const filas = rows.map((r) => ({
    c: [r.nombre, NUM(r.valor_inicial), ...meses.map((m) => NUM(r[m])), NUM(r.total_anio), NUM(r.acumulada_al_cierre), NUM(r.valor_actual)],
    e: 'normal'
  }));
  const tot = (k) => rows.reduce((t, r) => t + NUM(r[k]), 0);
  filas.push({ c: ['TOTAL', tot('valor_inicial'), ...meses.map(tot), tot('total_anio'), tot('acumulada_al_cierre'), tot('valor_actual')], e: 'total' });
  return {
    titulo: `${dep ? 'Depreciación' : 'Amortización'} mensual ${anio}`,
    subtitulo: 'Cuota de cada mes por activo',
    hoja: `Matriz ${anio}`,
    horizontal: true,
    columnas: [{ t: 'Activo', w: 1 }, { t: 'Valor', num: true }, ...MES_CORTO.map((m) => ({ t: m[0].toUpperCase() + m.slice(1), num: true })),
      { t: 'Total año', num: true }, { t: 'Acumulada', num: true }, { t: 'Valor en libros', num: true }],
    filas
  };
}

/* ------------------------------- formularios ------------------------------- */

function selectCuentas(cuentas, filtro, valor, vacio) {
  const lista = cuentas.filter(filtro);
  return h('select', { value: valor || '' },
    h('option', { value: '' }, vacio || 'Elegir…'),
    lista.map((c) => h('option', { value: c.id }, `${c.numero} ${c.nombre}`)));
}

function abrirActivo(id, tipo, cuentas, alGuardar) {
  const f = {
    nombre: h('input', { type: 'text', required: true }),
    fecha: h('input', { type: 'date', required: true, value: hoy() }),
    valor: h('input', { type: 'number', step: '0.01', min: '0.01', inputmode: 'decimal', required: true }),
    residual: h('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', value: '0' }),
    vida: h('input', { type: 'number', step: '0.01', min: '0.01', inputmode: 'decimal', required: true }),
    inicio: h('input', { type: 'date' }),
    cActivo: selectCuentas(cuentas, (c) => c.numero.startsWith('1.'), '', 'Cuenta del activo'),
    cAcum: selectCuentas(cuentas, (c) => c.numero.startsWith('1.'), '', 'Cuenta de depreciación o amortización acumulada'),
    cGasto: selectCuentas(cuentas, (c) => /^[5-7]\./.test(c.numero), '', 'Usar la cuenta de gasto estándar')
  };
  let cerrar;
  async function guardar(ev) {
    ev.preventDefault();
    const valor = Number(f.valor.value); const res = Number(f.residual.value || 0); const vida = Number(f.vida.value);
    if (!texto(f.nombre.value)) { toast('Escribe el nombre del activo.', 'error'); return; }
    if (!(valor > 0) || !(vida > 0)) { toast('El valor y la vida útil deben ser mayores que cero.', 'error'); return; }
    if (res < 0 || res >= valor) { toast('El valor residual debe ser menor que el valor del activo.', 'error'); return; }
    if (!f.cActivo.value || !f.cAcum.value) { toast('Elige la cuenta del activo y la de depreciación acumulada.', 'error'); return; }
    const ini = f.inicio.value ? f.inicio.value.slice(0, 7) + '-01' : null;
    const r = await db.from('activos_fijos').insert({
      empresa_id: id, tipo, nombre: texto(f.nombre.value), fecha_adquisicion: f.fecha.value,
      inicio_dep: ini, valor_inicial: redondear(valor), valor_residual: redondear(res), vida_util_anios: vida,
      cuenta_activo_id: f.cActivo.value, cuenta_acumulada_id: f.cAcum.value, cuenta_gasto_id: f.cGasto.value || null
    });
    if (r.error) { toast(traducirError(r.error), 'error'); return; }
    toast('Activo guardado.', 'ok');
    cerrar();
    alGuardar();
  }
  cerrar = modal(tipo === 'depreciacion' ? 'Nuevo activo fijo' : 'Nuevo diferido o intangible', h('form', { onsubmit: guardar },
    campo('Nombre', f.nombre),
    campo('Fecha de adquisición', f.fecha),
    campo('Valor de compra', f.valor),
    campo('Valor residual', f.residual),
    campo('Vida útil en años', f.vida, 'Ejemplo: 5 años = 20% anual.'),
    campo('Empezar a depreciar en (opcional)', f.inicio, 'Si lo dejas vacío empieza el mes siguiente a la adquisición.'),
    campo('Cuenta del activo', f.cActivo),
    campo('Cuenta acumulada', f.cAcum),
    campo('Cuenta de gasto', f.cGasto),
    h('button', { class: 'btn btn-bloque', type: 'submit' }, 'Guardar')));
}

function abrirBaja(a, cuentas, alGuardar) {
  const f = {
    fecha: h('input', { type: 'date', required: true, value: hoy() }),
    monto: h('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', value: '0' }),
    cobro: selectCuentas(cuentas, (c) => c.numero.startsWith('1.1'), '', 'Caja, banco o cuenta por cobrar')
  };
  let cerrar;
  async function guardar(ev) {
    ev.preventDefault();
    const m = Number(f.monto.value || 0);
    if (m < 0) { toast('El monto no puede ser negativo.', 'error'); return; }
    if (m > 0 && !f.cobro.value) { toast('Elige dónde se cobró la venta.', 'error'); return; }
    const r = await db.rpc('dar_baja_activo', {
      p_activo: a.activo_id, p_fecha: f.fecha.value, p_monto_venta: redondear(m), p_cuenta_cobro: f.cobro.value || null
    });
    if (r.error) { toast(traducirError(r.error), 'error'); return; }
    toast(m > 0 ? 'Venta registrada.' : 'Baja registrada.', 'ok');
    cerrar();
    alGuardar();
  }
  cerrar = modal(`Vender o dar de baja: ${a.nombre}`, h('form', { onsubmit: guardar },
    h('p', { class: 'ayuda' }, 'Antes de esto, contabiliza la depreciación de todos los meses hasta el mes de la baja. Con monto 0 es una baja sin venta.'),
    campo('Fecha', f.fecha),
    campo('Monto de la venta (sin ITBMS)', f.monto),
    campo('Se cobró en', f.cobro),
    h('button', { class: 'btn btn-bloque', type: 'submit' }, 'Registrar')));
}

/* --------------------------------- pantalla -------------------------------- */

export async function vistaActivos(id) {
  mostrar(marcoEmpresa({ id, razon_social: '…' }, 'activos', cargando()));
  const empresa = await cargarEmpresa(id);
  const hoyF = hoy();
  const est = { tipo: 'depreciacion', fecha: finDeMes(hoyF), anio: Number(hoyF.slice(0, 4)), mes: Number(hoyF.slice(5, 7)),
    vista: 'lista', resumen: [], matriz: [], cuentas: [] };
  const filtros = h('div', { class: 'filtros' });
  const zona = h('div');

  async function cargarCuentas() {
    const r = await db.from('cuentas').select('id, numero, nombre').eq('empresa_id', id)
      .eq('acepta_movimientos', true).eq('activa', true).order('numero').range(0, 4999);
    if (r.error) throw r.error;
    est.cuentas = r.data || [];
  }

  function armar() {
    filtros.replaceChildren(
      h('select', { onchange: (e) => { est.tipo = e.target.value; pintar(); } },
        Object.entries(TIPOS).map(([k, t]) => h('option', { value: k, selected: k === est.tipo }, t))),
      h('select', { onchange: (e) => { est.vista = e.target.value; armar(); pintar(); } },
        h('option', { value: 'lista', selected: est.vista === 'lista' }, 'Lista y saldos'),
        h('option', { value: 'matriz', selected: est.vista === 'matriz' }, 'Cuota por mes'),
        h('option', { value: 'mes', selected: est.vista === 'mes' }, 'Contabilizar un mes')),
      est.vista === 'lista'
        ? h('label', { class: 'campo' }, h('span', { class: 'etiqueta' }, 'Al'),
          h('input', { type: 'date', value: est.fecha, onchange: (e) => { est.fecha = e.target.value; pintar(); } }))
        : h('label', { class: 'campo' }, h('span', { class: 'etiqueta' }, 'Año'),
          h('input', {
            type: 'number', min: '2000', max: '2100', inputmode: 'numeric', value: String(est.anio),
            onchange: (e) => { const v = Number(e.target.value); if (v >= 2000 && v <= 2100) { est.anio = v; pintar(); } }
          })));
  }

  function exportar() {
    const base = `${empresa.razon_social}-${est.tipo === 'depreciacion' ? 'depreciacion' : 'amortizacion'}`;
    if (est.vista === 'lista') {
      return est.resumen.length ? { specs: [specResumen(est.resumen, est.tipo, est.fecha)], archivo: `${base}-${est.fecha}` } : null;
    }
    if (est.vista === 'matriz') {
      return est.matriz.length ? { specs: [specMatriz(est.matriz, est.tipo, est.anio)], archivo: `${base}-mensual-${est.anio}` } : null;
    }
    return null;
  }

  async function pintar() {
    zona.replaceChildren(cargando());
    try {
      if (est.vista === 'lista') {
        const r = await db.rpc('activos_resumen', { p_empresa: id, p_tipo: est.tipo, p_fecha: est.fecha });
        if (r.error) throw r.error;
        est.resumen = r.data || [];
        const items = est.resumen.map((a) => h('div', { class: 'tarjeta' },
          h('strong', null, a.nombre),
          h('p', { class: 'ayuda' }, `Adquirido el ${fechaCorta(a.fecha_adquisicion)} · ${a.estado}${a.fecha_baja ? ' el ' + fechaCorta(a.fecha_baja) : ''}`),
          tablaSimple([{ t: 'Concepto' }, { t: 'Monto', num: true }], [
            { c: ['Valor de compra', NUM(a.valor_inicial)] },
            { c: ['Cuota mensual', NUM(a.cuota_mensual)] },
            { c: [est.tipo === 'depreciacion' ? 'Depreciación acumulada' : 'Amortización acumulada', NUM(a.depreciacion_acumulada)] },
            { c: ['Valor en libros', NUM(a.valor_actual)], e: 'n1' },
            { c: ['Registrado en contabilidad', NUM(a.registrado_contabilidad)] }
          ]),
          a.estado === 'En uso'
            ? h('div', { class: 'acciones' },
              h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: () => abrirBaja(a, est.cuentas, pintar) }, 'Vender o dar de baja'))
            : null));
        zona.replaceChildren(
          barraExportar({ empresa, obtener: exportar }),
          h('div', { class: 'acciones' },
            h('button', { class: 'btn', type: 'button', onclick: () => abrirActivo(id, est.tipo, est.cuentas, pintar) }, '+ Nuevo')),
          ...(items.length ? items : [h('p', { class: 'ayuda' }, 'Todavía no hay registros de este tipo.')]));
      } else if (est.vista === 'matriz') {
        const r = await db.rpc('depreciacion_matriz', { p_empresa: id, p_tipo: est.tipo, p_anio: est.anio });
        if (r.error) throw r.error;
        est.matriz = r.data || [];
        zona.replaceChildren(
          barraExportar({ empresa, obtener: exportar }),
          est.matriz.length
            ? tablaSimple([{ t: 'Activo' }, { t: 'Total año', num: true }, { t: 'Acumulada', num: true }, { t: 'Valor en libros', num: true }],
              est.matriz.map((m) => ({ c: [m.nombre, NUM(m.total_anio), NUM(m.acumulada_al_cierre), NUM(m.valor_actual)] })))
            : h('p', { class: 'ayuda' }, 'No hay cuotas en ese año. En el Excel y el PDF salen los doce meses.'));
      } else {
        const filas = [];
        for (let m = 1; m <= 12; m++) {
          const per = `${est.anio}-${String(m).padStart(2, '0')}-01`;
          const p = await db.rpc('depreciacion_pendiente', { p_empresa: id, p_tipo: est.tipo, p_periodo: per });
          if (p.error) throw p.error;
          filas.push({ m, per, pend: (p.data || []).reduce((t, x) => t + NUM(x.monto), 0), n: (p.data || []).length });
        }
        zona.replaceChildren(
          h('p', { class: 'ayuda' }, 'Cada mes se contabiliza con un asiento: débito al gasto y crédito a la cuenta acumulada. Se puede repetir sin duplicar.'),
          ...filas.map((x) => h('div', { class: 'fila-mes-cierre' },
            h('span', null, `${MESES[x.m - 1]} · pendiente ${x.n ? 'B/. ' + x.pend.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'}`),
            h('button', {
              class: 'btn btn-sec btn-peq', type: 'button', disabled: x.n === 0,
              onclick: async (ev) => {
                ev.target.disabled = true;
                const r = await db.rpc('generar_depreciacion', { p_empresa: id, p_anio: est.anio, p_mes: x.m });
                if (r.error) { toast(traducirError(r.error), 'error'); ev.target.disabled = false; return; }
                toast(r.data ? 'Depreciación contabilizada.' : 'No había nada pendiente.', 'ok');
                pintar();
              }
            }, 'Contabilizar'),
            h('button', {
              class: 'btn btn-sec btn-peq', type: 'button',
              onclick: async () => {
                const r = await db.rpc('revertir_depreciacion', { p_empresa: id, p_anio: est.anio, p_mes: x.m });
                if (r.error) { toast(traducirError(r.error), 'error'); return; }
                toast(r.data ? 'Asientos del mes borrados.' : 'No había asientos de ese mes.', 'ok');
                pintar();
              }
            }, 'Deshacer'))));
      }
    } catch (e) {
      zona.replaceChildren(h('div', { class: 'tarjeta error' }, h('p', null, traducirError(e))));
    }
  }

  try { await cargarCuentas(); } catch (e) { toast(traducirError(e), 'error'); }
  armar();
  mostrar(marcoEmpresa(empresa, 'activos', [filtros, zona]));
  pintar();
}

// FIN DEL ARCHIVO activos.js
