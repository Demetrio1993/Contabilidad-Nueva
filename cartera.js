// Cuentas por cobrar y por pagar: morosidad, detalle de facturas pendientes
// y estado de cuenta de un cliente o proveedor. Todo se exporta a Excel y PDF.
import {
  db, h, mostrar, cargando, traducirError, marcoEmpresa, cargarEmpresa, hoy, fechaCorta
} from './lib.js';
import { barraExportar } from './informes.js';
import { tablaSimple } from './fiscal.js';

const NUM = (v) => Number(v || 0);
const TRAMOS = [['hasta_30', 'Hasta 30'], ['d31_60', '31-60'], ['d61_90', '61-90'], ['d91_120', '91-120'],
  ['d121_150', '121-150'], ['d151_180', '151-180'], ['mas_180', 'Más de 180']];
const TRAMO_TXT = Object.fromEntries(TRAMOS.map(([k, t]) => [k, t]));
const rucTxt = (x) => (x.ruc ? `${x.ruc}${x.dv ? '-' + x.dv : ''}` : '');
const dias = (d) => new Date(d + 'T00:00:00');
function primerDiaAnio() { return hoy().slice(0, 4) + '-01-01'; }

/* ------------------------------ especificaciones ----------------------------- */

function specMorosidad(rows, tipo, fecha, uno) {
  const quien = tipo === 'cliente' ? 'Cuentas por cobrar' : 'Cuentas por pagar';
  return {
    titulo: `${quien}: morosidad${uno ? ' de ' + uno : ''}`,
    subtitulo: `Saldos pendientes al ${fechaCorta(fecha)}, por días de atraso`,
    hoja: 'Morosidad',
    horizontal: true,
    columnas: [{ t: tipo === 'cliente' ? 'Cliente' : 'Proveedor', w: 1 }, { t: 'RUC' }, { t: 'Total', num: true },
      ...TRAMOS.map(([, t]) => ({ t, num: true }))],
    filas: rows.map((r) => ({
      c: [r.nombre_tercero, rucTxt(r), NUM(r.total), NUM(r.hasta_30), NUM(r.d31_60), NUM(r.d61_90),
        NUM(r.d91_120), NUM(r.d121_150), NUM(r.d151_180), NUM(r.mas_180)],
      e: r.orden === 2 ? 'total' : 'normal'
    })),
    notas: ['Los cobros o pagos se aplican primero a las facturas más antiguas.']
  };
}

function specDetalle(rows, tipo, fecha) {
  const quien = tipo === 'cliente' ? 'Facturas por cobrar' : 'Facturas por pagar';
  const filas = rows.map((r) => ({
    c: [r.nombre_tercero, r.numero_factura || '', fechaCorta(r.fecha), NUM(r.monto_original), NUM(r.aplicado),
      NUM(r.saldo), String(NUM(r.dias)), TRAMO_TXT[r.tramo] || r.tramo],
    e: 'normal'
  }));
  filas.push({
    c: ['TOTAL', null, null, rows.reduce((s, r) => s + NUM(r.monto_original), 0), rows.reduce((s, r) => s + NUM(r.aplicado), 0),
      rows.reduce((s, r) => s + NUM(r.saldo), 0), null, null], e: 'total'
  });
  return {
    titulo: `${quien} pendientes`,
    subtitulo: `Al ${fechaCorta(fecha)}`,
    hoja: 'Facturas pendientes',
    horizontal: true,
    columnas: [{ t: tipo === 'cliente' ? 'Cliente' : 'Proveedor', w: 1 }, { t: 'Factura' }, { t: 'Fecha' },
      { t: 'Original', num: true }, { t: 'Aplicado', num: true }, { t: 'Saldo', num: true },
      { t: 'Días', num: true }, { t: 'Tramo' }],
    filas
  };
}

function specEstadoCuenta(enc, rows, tipo, desde, hasta) {
  const fil = rows.map((r) => ({
    c: [fechaCorta(r.fecha), r.tipo_mov, r.documento || '', r.descripcion || '',
      r.orden === 0 ? null : NUM(r.cargo), r.orden === 0 ? null : NUM(r.abono), NUM(r.saldo)],
    e: r.orden === 0 ? 'n1' : 'normal'
  }));
  const ult = rows.length ? NUM(rows[rows.length - 1].saldo) : 0;
  fil.push({ c: ['Saldo final', null, null, null, null, null, ult], e: 'total' });
  const contacto = [enc.tercero_direccion, enc.tercero_telefono, enc.tercero_correo].filter(Boolean).join(' · ');
  return {
    titulo: `Estado de cuenta: ${enc.tercero_nombre}`,
    subtitulo: `${tipo === 'cliente' ? 'Cliente' : 'Proveedor'}${enc.tercero_ruc ? ' · RUC ' + enc.tercero_ruc + (enc.tercero_dv ? ' DV ' + enc.tercero_dv : '') : ''}` +
      `${contacto ? ' · ' + contacto : ''} · Del ${fechaCorta(desde)} al ${fechaCorta(hasta)}`,
    hoja: 'Estado de cuenta',
    horizontal: true,
    columnas: [{ t: 'Fecha' }, { t: 'Movimiento' }, { t: 'Documento' }, { t: 'Descripción', w: 1 },
      { t: tipo === 'cliente' ? 'Facturado' : 'Facturado por el proveedor', num: true },
      { t: tipo === 'cliente' ? 'Cobrado' : 'Pagado', num: true }, { t: 'Saldo', num: true }],
    filas: fil
  };
}

/* ---------------------------------- pantalla --------------------------------- */

export async function vistaCartera(id) {
  mostrar(marcoEmpresa({ id, razon_social: '…' }, 'cartera', cargando()));
  const empresa = await cargarEmpresa(id);
  const est = { tipo: 'cliente', vista: 'morosidad', fecha: hoy(), desde: primerDiaAnio(), hasta: hoy(), tercero: '',
    mor: [], det: [], ec: null, terceros: [] };
  const zona = h('div');
  const filtros = h('div', { class: 'filtros' });

  async function listaTerceros() {
    const r = await db.from('terceros').select('id, razon_social, tipo').eq('empresa_id', id)
      .order('razon_social').range(0, 4999);
    if (r.error) throw r.error;
    est.terceros = (r.data || []).filter((t) => t.tipo === est.tipo || t.tipo === 'ambos');
    if (!est.terceros.some((t) => t.id === est.tercero)) est.tercero = est.terceros.length ? est.terceros[0].id : '';
  }

  function armarFiltros() {
    const tipo = h('select', { onchange: async (e) => { est.tipo = e.target.value; await listaTerceros(); armarFiltros(); pintar(); } },
      h('option', { value: 'cliente', selected: est.tipo === 'cliente' }, 'Por cobrar (clientes)'),
      h('option', { value: 'proveedor', selected: est.tipo === 'proveedor' }, 'Por pagar (proveedores)'));
    const vista = h('select', { onchange: (e) => { est.vista = e.target.value; armarFiltros(); pintar(); } },
      h('option', { value: 'morosidad', selected: est.vista === 'morosidad' }, 'Morosidad'),
      h('option', { value: 'detalle', selected: est.vista === 'detalle' }, 'Facturas pendientes'),
      h('option', { value: 'estado', selected: est.vista === 'estado' }, 'Estado de cuenta'));
    const f = [tipo, vista];
    if (est.vista === 'estado') {
      f.push(h('select', { onchange: (e) => { est.tercero = e.target.value; pintar(); } },
        est.terceros.length ? est.terceros.map((t) => h('option', { value: t.id, selected: t.id === est.tercero }, t.razon_social))
          : [h('option', { value: '' }, 'Sin registros')]));
      f.push(h('label', { class: 'campo' }, h('span', { class: 'etiqueta' }, 'Desde'),
        h('input', { type: 'date', value: est.desde, onchange: (e) => { est.desde = e.target.value; pintar(); } })));
      f.push(h('label', { class: 'campo' }, h('span', { class: 'etiqueta' }, 'Hasta'),
        h('input', { type: 'date', value: est.hasta, onchange: (e) => { est.hasta = e.target.value; pintar(); } })));
    } else {
      f.push(h('label', { class: 'campo' }, h('span', { class: 'etiqueta' }, 'Al'),
        h('input', { type: 'date', value: est.fecha, onchange: (e) => { est.fecha = e.target.value; pintar(); } })));
    }
    filtros.replaceChildren(...f);
  }

  function obtenerExport() {
    const base = `${empresa.razon_social}-${est.tipo === 'cliente' ? 'cobrar' : 'pagar'}`;
    if (est.vista === 'morosidad') {
      return est.mor.length ? { specs: [specMorosidad(est.mor, est.tipo, est.fecha)], archivo: `${base}-morosidad-${est.fecha}` } : null;
    }
    if (est.vista === 'detalle') {
      return est.det.length ? { specs: [specDetalle(est.det, est.tipo, est.fecha)], archivo: `${base}-facturas-${est.fecha}` } : null;
    }
    if (!est.ec) return null;
    const specs = [specEstadoCuenta(est.ec.enc, est.ec.rows, est.tipo, est.desde, est.hasta)];
    const m = est.ec.mor.filter((r) => r.tercero_id === est.tercero);
    if (m.length) specs.push(specMorosidad(m, est.tipo, est.hasta, est.ec.enc.tercero_nombre));
    return { specs, archivo: `${base}-estado-cuenta-${est.ec.enc.tercero_nombre}-${est.hasta}` };
  }

  async function pintar() {
    zona.replaceChildren(cargando());
    try {
      let cuerpo;
      if (est.vista === 'morosidad') {
        const r = await db.rpc('cartera_morosidad', { p_empresa: id, p_tipo: est.tipo, p_fecha: est.fecha });
        if (r.error) throw r.error;
        est.mor = r.data && r.data.length > 1 ? r.data : [];
        cuerpo = est.mor.length
          ? tablaSimple([{ t: est.tipo === 'cliente' ? 'Cliente' : 'Proveedor' }, { t: 'Total', num: true },
            ...TRAMOS.map(([, t]) => ({ t, num: true }))],
          est.mor.map((x) => ({
            c: [x.nombre_tercero, NUM(x.total), NUM(x.hasta_30), NUM(x.d31_60), NUM(x.d61_90), NUM(x.d91_120),
              NUM(x.d121_150), NUM(x.d151_180), NUM(x.mas_180)],
            e: x.orden === 2 ? 'total' : 'normal'
          })), 'ancha')
          : h('p', { class: 'ayuda' }, 'No hay saldos pendientes a esa fecha. Solo cuentan las operaciones a crédito.');
      } else if (est.vista === 'detalle') {
        const r = await db.rpc('cartera_detalle', { p_empresa: id, p_tipo: est.tipo, p_fecha: est.fecha });
        if (r.error) throw r.error;
        est.det = (r.data || []).filter((x) => NUM(x.saldo) !== 0);
        cuerpo = est.det.length
          ? tablaSimple([{ t: est.tipo === 'cliente' ? 'Cliente' : 'Proveedor' }, { t: 'Factura' }, { t: 'Fecha' },
            { t: 'Original', num: true }, { t: 'Aplicado', num: true }, { t: 'Saldo', num: true }, { t: 'Días', num: true }, { t: 'Tramo' }],
          est.det.map((x) => ({
            c: [x.nombre_tercero, x.numero_factura || '', fechaCorta(x.fecha), NUM(x.monto_original), NUM(x.aplicado),
              NUM(x.saldo), NUM(x.dias), TRAMO_TXT[x.tramo] || x.tramo], e: 'normal'
          })), 'ancha')
          : h('p', { class: 'ayuda' }, 'No hay facturas pendientes a esa fecha.');
      } else {
        est.ec = null;
        if (!est.tercero) {
          cuerpo = h('p', { class: 'ayuda' }, 'Primero registra un ' + (est.tipo === 'cliente' ? 'cliente.' : 'proveedor.'));
        } else if (est.desde > est.hasta) {
          cuerpo = h('p', { class: 'ayuda' }, 'La fecha inicial no puede ser posterior a la final.');
        } else {
          const [e, m, mo] = await Promise.all([
            db.rpc('estado_cuenta_encabezado', { p_empresa: id, p_tercero: est.tercero }),
            db.rpc('estado_cuenta', { p_empresa: id, p_tipo: est.tipo, p_tercero: est.tercero, p_desde: est.desde, p_hasta: est.hasta }),
            db.rpc('cartera_morosidad', { p_empresa: id, p_tipo: est.tipo, p_fecha: est.hasta })
          ]);
          for (const x of [e, m, mo]) if (x.error) throw x.error;
          const enc = (e.data || [])[0];
          if (!enc) throw new Error('No se encontró el cliente o proveedor.');
          const rows = m.data || [];
          est.ec = { enc, rows, mor: mo.data || [] };
          const ult = rows.length ? NUM(rows[rows.length - 1].saldo) : 0;
          cuerpo = h('div', null,
            h('p', { class: 'ayuda' }, `${enc.tercero_nombre}${enc.tercero_ruc ? ' · RUC ' + enc.tercero_ruc : ''}`),
            tablaSimple([{ t: 'Fecha' }, { t: 'Movimiento' }, { t: 'Documento' }, { t: 'Cargo', num: true },
              { t: 'Abono', num: true }, { t: 'Saldo', num: true }],
            rows.map((x) => ({
              c: [fechaCorta(x.fecha), x.tipo_mov, x.documento || '', x.orden === 0 ? '' : NUM(x.cargo),
                x.orden === 0 ? '' : NUM(x.abono), NUM(x.saldo)],
              e: x.orden === 0 ? 'n1' : 'normal'
            })).concat([{ c: ['Saldo final', '', '', '', '', ult], e: 'total' }]), 'ancha'));
        }
      }
      zona.replaceChildren(barraExportar({ empresa, obtener: obtenerExport }), cuerpo);
    } catch (e) {
      zona.replaceChildren(h('div', { class: 'tarjeta error' }, h('p', null, traducirError(e))));
    }
  }

  try { await listaTerceros(); } catch (e) { toastError(e); }
  armarFiltros();
  mostrar(marcoEmpresa(empresa, 'cartera', [filtros, zona]));
  pintar();
}

function toastError(e) { console.error(e); }

// FIN DEL ARCHIVO cartera.js
