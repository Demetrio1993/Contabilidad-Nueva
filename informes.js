// Informes contables: diario (con asientos de ajuste), mayor,
// balance de comprobación (mensual o anual) y hoja de trabajo.
import {
  db, estado, h, mostrar, toast, modal, campo, texto, dinero, fechaCorta,
  traducirError, cargando, marcoEmpresa, cargarEmpresa, hoy, redondear
} from './lib.js';
import { exportarExcel, exportarPdf, compartirArchivoInforme } from './exportar.js';
import { confirmar, pedirMotivo, barraAcciones, rpcOk } from './acciones.js';
import { cargarAuxiliares, campoAuxiliar, etiquetaAux, formularioAuxiliar, informeAuxiliares, puedeCrearAux } from './auxiliares.js';

const ORIGENES = {
  manual: 'Manual', ajuste: 'Ajuste', apertura: 'Apertura', transaccion: 'Transacción',
  depreciacion: 'Depreciación', amortizacion: 'Amortización', inventario: 'Inventario',
  conciliacion: 'Conciliación', cierre: 'Cierre', impuestos: 'Impuestos'
};

const INFORMES = [
  ['diario', 'Diario general'],
  ['mayor', 'Mayor general'],
  ['balance', 'Balance de comprobación'],
  ['hoja', 'Hoja de trabajo'],
  ['auxiliares', 'Auxiliares (saldos por auxiliar)']
];

const n2 = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nz = (v) => (Number(v || 0) === 0 ? '' : n2(v));
const pad = (n) => String(n).padStart(2, '0');

function celda(texto_, clase) { return h('td', { class: clase || null }, texto_); }

function tablaScroll(tabla) {
  return h('div', { class: 'tabla-scroll' }, tabla);
}

function chip(etiqueta, valor) {
  return h('div', { class: 'chip' }, h('span', { class: 'ayuda' }, etiqueta), h('strong', null, valor));
}

/* --------------- botones "Descargar Excel" y "Descargar PDF" --------------- */

// obtener() devuelve { specs: [...], archivo } o null si aún no hay nada que exportar.
export function barraExportar({ empresa, obtener, etiquetaExcel, etiquetaPdf }) {
  const hacer = (tipo) => async (ev) => {
    const boton = ev && ev.target;
    if (boton) boton.disabled = true;
    try {
      const r = await obtener();
      if (!r) { toast('No hay datos para exportar. Elige un informe con información.', 'error'); return; }
      const meta = { empresa: { razon_social: empresa.razon_social, ruc: empresa.ruc, dv: empresa.dv } };
      const nombre = tipo === 'xlsx' ? exportarExcel(r.specs, meta, r.archivo) : exportarPdf(r.specs, meta, r.archivo);
      toast(`Se descargó ${nombre}`, 'ok');
    } catch (e) {
      toast('No se pudo crear el archivo: ' + traducirError(e), 'error');
    } finally {
      if (boton) boton.disabled = false;
    }
  };
  // Compartir: abre el menú del teléfono (correo, WhatsApp...) con el archivo adjunto
  const compartir = (tipo) => async (ev) => {
    const boton = ev && ev.target;
    if (boton) boton.disabled = true;
    try {
      const r = await obtener();
      if (!r) { toast('No hay datos para compartir. Elige un informe con información.', 'error'); return; }
      const meta = { empresa: { razon_social: empresa.razon_social, ruc: empresa.ruc, dv: empresa.dv } };
      const res = await compartirArchivoInforme(r.specs, meta, r.archivo, tipo);
      if (res === 'compartido') toast('Listo para enviar.', 'ok');
      else if (res === 'descargado') toast('Este aparato no puede compartir archivos; se descargó para que lo adjuntes en tu correo.', 'info');
    } catch (e) {
      toast('No se pudo compartir: ' + traducirError(e), 'error');
    } finally {
      if (boton) boton.disabled = false;
    }
  };
  return h('div', { class: 'acciones' },
    h('button', { class: 'btn btn-sec', type: 'button', onclick: hacer('xlsx') }, etiquetaExcel || 'Descargar Excel'),
    h('button', { class: 'btn btn-sec', type: 'button', onclick: hacer('pdf') }, etiquetaPdf || 'Descargar PDF'),
    h('button', { class: 'btn btn-sec', type: 'button', onclick: compartir('pdf') }, 'Compartir PDF'),
    h('button', { class: 'btn btn-sec', type: 'button', onclick: compartir('xlsx') }, 'Compartir Excel'));
}

/* ------------------------- asiento de ajuste manual ------------------------ */

export function abrirAjuste(id, cuentas, fechaInicial, alGuardar, existente) {
  const fecha = h('input', { type: 'date', value: existente ? existente.fecha : fechaInicial });
  const desc = h('input', { type: 'text', placeholder: 'Ej.: Ajuste por gasto acumulado', value: existente ? existente.descripcion : '' });
  const ref = h('input', { type: 'text', placeholder: 'Opcional', value: existente ? (existente.referencia || '') : '' });
  const filas = [];
  const caja = h('div');
  const tot = h('p', { class: 'total-neto' });
  const auxDatos = { lista: [], falta: true };
  const guardar = h('button', { class: 'btn', type: 'button' }, existente ? 'Guardar cambios' : 'Guardar asiento de ajuste');

  function sumas() {
    let d = 0; let c = 0;
    filas.forEach((f) => { d += Number(f.debito.value || 0); c += Number(f.credito.value || 0); });
    return [redondear(d), redondear(c)];
  }
  function recalcular() {
    const [d, c] = sumas();
    const dif = redondear(d - c);
    tot.textContent = `Débitos ${dinero(d)} · Créditos ${dinero(c)}` +
      (dif === 0 ? (d > 0 ? ' · Cuadrado' : '') : ` · Diferencia ${dinero(Math.abs(dif))}`);
  }
  function agregar(pre) {
    const f = {
      auxId: '',
      cuenta: h('select', { onchange: () => { f.auxId = ''; f.pintarAux(); } },
        h('option', { value: '' }, 'Elegir cuenta…'),
        cuentas.map((c) => h('option', { value: c.id }, `${c.numero} · ${c.nombre}`))),
      auxCaja: h('div'),
      debito: h('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', placeholder: 'Débito', oninput: recalcular }),
      credito: h('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', placeholder: 'Crédito', oninput: recalcular })
    };
    f.pintarAux = () => {
      const cta = cuentas.find((c) => c.id === f.cuenta.value);
      const nodoAux = campoAuxiliar({
        empresaId: id, rol: (estado.roles[id] || {}).rol || 'contador', etiqueta: 'Auxiliar (opcional)', cuenta: cta, datos: auxDatos,
        valor: f.auxId, alCambiar: (v) => { f.auxId = v; }, redibujar: () => f.pintarAux()
      });
      f.auxCaja.replaceChildren(...(nodoAux ? [nodoAux] : []));
    };
    f.caja = h('div', { class: 'linea-ajuste' },
      f.cuenta,
      f.auxCaja,
      h('div', { class: 'par-montos' }, f.debito, f.credito),
      h('button', {
        class: 'btn btn-sec btn-peq', type: 'button',
        onclick: () => {
          if (filas.length <= 2) { toast('Un asiento necesita al menos dos líneas.', 'error'); return; }
          filas.splice(filas.indexOf(f), 1); f.caja.remove(); recalcular();
        }
      }, 'Quitar línea'));
    if (pre && pre.cuenta_id) {
      f.cuenta.value = pre.cuenta_id;
      f.auxId = pre.auxiliar_id || '';
      if (Number(pre.debito) > 0) f.debito.value = String(pre.debito);
      if (Number(pre.credito) > 0) f.credito.value = String(pre.credito);
    }
    filas.push(f);
    caja.append(f.caja);
    f.pintarAux();
  }
  cargarAuxiliares(id).then((r) => {
    auxDatos.lista = r.lista; auxDatos.falta = r.falta;
    filas.forEach((f) => f.pintarAux());
  });
  if (existente && existente.lineas && existente.lineas.length) existente.lineas.forEach((l) => agregar(l));
  else { agregar(); agregar(); }
  recalcular();

  guardar.addEventListener('click', async () => {
    const usadas = filas.filter((f) => f.cuenta.value || f.debito.value || f.credito.value);
    if (!fecha.value) { toast('Pon la fecha del asiento.', 'error'); return; }
    if (!texto(desc.value)) { toast('Escribe una descripción.', 'error'); return; }
    if (usadas.length < 2) { toast('Un asiento necesita al menos dos líneas.', 'error'); return; }
    for (const f of usadas) {
      const d = Number(f.debito.value || 0); const c = Number(f.credito.value || 0);
      if (!f.cuenta.value) { toast('Hay una línea sin cuenta.', 'error'); return; }
      if ((d > 0) === (c > 0)) { toast('Cada línea lleva débito o crédito, no los dos ni ninguno.', 'error'); return; }
    }
    const [d, c] = sumas();
    if (d !== c) { toast(`El asiento no cuadra: débitos ${dinero(d)} y créditos ${dinero(c)}.`, 'error'); return; }
    guardar.disabled = true;
    const lineas = usadas.map((f) => ({
      cuenta_id: f.cuenta.value,
      auxiliar_id: f.auxId || null,
      debito: Number(f.debito.value || 0),
      credito: Number(f.credito.value || 0)
    }));
    const { error } = existente
      ? await db.rpc('editar_asiento', {
        p_asiento: existente.id, p_fecha: fecha.value, p_descripcion: texto(desc.value),
        p_referencia: texto(ref.value), p_lineas: lineas
      })
      : await db.rpc('crear_asiento', {
        p_empresa: id,
        p_fecha: fecha.value,
        p_descripcion: texto(desc.value),
        p_referencia: texto(ref.value),
        p_origen: 'ajuste',
        p_lineas: lineas
      });
    guardar.disabled = false;
    if (error) { toast(traducirError(error), 'error'); return; }
    cerrar();
    toast(existente ? 'Asiento corregido.' : 'Asiento de ajuste registrado.', 'ok');
    alGuardar();
  });

  const cerrar = modal(existente ? 'Editar asiento' : 'Asiento de ajuste', h('div', null,
    campo('Fecha', fecha),
    campo('Descripción', desc),
    campo('Referencia', ref),
    h('div', { class: 'grupo' }, h('h3', null, 'Líneas'), caja,
      h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: agregar }, '+ Agregar línea')),
    tot, guardar));
}

/* ================================ pantalla ================================ */

export async function vistaInformes(id) {
  mostrar(marcoEmpresa({ id, razon_social: '…' }, 'informes', cargando()));
  const empresa = await cargarEmpresa(id);
  const { data: cuentas, error: errC } = await db.from('cuentas')
    .select('id, numero, nombre, nivel')
    .eq('empresa_id', id).eq('acepta_movimientos', true).eq('activa', true)
    .order('numero').range(0, 4999);
  if (errC) throw errC;

  const auxDatos = await cargarAuxiliares(id);
  const est = {
    informe: 'diario', modo: 'mes', mes: hoy().slice(0, 7),
    anio: Number(hoy().slice(0, 4)), cuentaId: '', nivel: '4', version: 'despues',
    cuentaAux: '', verCeros: false
  };
  const barra = h('div', { class: 'filtros' });
  const zona = h('div');

  function rango() {
    if (est.modo === 'anio') return [`${est.anio}-01-01`, `${est.anio}-12-31`];
    const [a, m] = est.mes.split('-').map(Number);
    return [`${est.mes}-01`, `${est.mes}-${pad(new Date(a, m, 0).getDate())}`];
  }
  const etiquetaPeriodo = () => (est.modo === 'anio'
    ? `Año ${est.anio}`
    : `Mes ${est.mes.split('-')[1]}/${est.mes.split('-')[0]}`);

  const ORIENTE = (o) => ORIGENES[o] || o;
  const nulo0 = (v) => (Number(v || 0) === 0 ? null : Number(v));
  const archivoDe = (informe) => `${empresa.razon_social}-${informe}-${est.modo === 'anio' ? est.anio : est.mes}`;

  /* ---- diario ---- */
  function accionesAsiento(a, ls) {
    const manual = ['manual', 'ajuste', 'apertura'].includes(a.origen);
    const esAnulacion = a.origen === 'ajuste' && String(a.referencia || '').startsWith('ANULA-');
    if (!manual) {
      return h('p', { class: 'ayuda' }, a.origen === 'transaccion'
        ? 'Para corregirlo, ve a Transacciones.'
        : 'Lo generó otro proceso: deshazlo desde su pantalla (Activos, Inventario, Conciliación o Cierre).');
    }
    if (esAnulacion) {
      return barraAcciones({
        eliminar: () => confirmar({
          titulo: 'Eliminar la anulación',
          mensaje: 'Se borra este asiento y el asiento original vuelve a estar vigente.',
          boton: 'Eliminar',
          alConfirmar: async () => { await rpcOk(db, 'eliminar_asiento', { p_asiento: a.id }); toast('Anulación eliminada.', 'ok'); pintar(); }
        })
      });
    }
    return barraAcciones({
      editar: a.anulado ? null : () => abrirAjuste(id, cuentas, a.fecha, pintar, {
        id: a.id, fecha: a.fecha, descripcion: a.descripcion, referencia: a.referencia,
        lineas: ls.map((l) => ({ cuenta_id: l.cuenta_id, auxiliar_id: l.auxiliar_id || null, debito: l.debito, credito: l.credito }))
      }),
      anular: a.anulado ? null : () => pedirMotivo({
        titulo: 'Anular asiento',
        mensaje: 'Se conserva el asiento y se crea otro contrario con la misma fecha. Solo se puede si el mes está abierto.',
        alConfirmar: async (motivo) => { await rpcOk(db, 'anular_asiento', { p_asiento: a.id, p_motivo: motivo }); toast('Asiento anulado.', 'ok'); pintar(); }
      }),
      eliminar: () => confirmar({
        titulo: 'Eliminar asiento',
        mensaje: a.anulado ? 'Se borra el asiento y también su anulación.' : 'Se borra el asiento. Solo se puede si el mes está abierto.',
        boton: 'Eliminar',
        alConfirmar: async () => { await rpcOk(db, 'eliminar_asiento', { p_asiento: a.id }); toast('Asiento eliminado.', 'ok'); pintar(); }
      })
    });
  }

  async function diario() {
    const [d, hasta] = rango();
    let r = await db.from('asientos')
      .select('id, consecutivo, fecha, descripcion, referencia, origen, anulado, motivo_anulacion, asiento_lineas(cuenta_id, auxiliar_id, debito, credito, descripcion, cuentas(numero, nombre), auxiliares(codigo, nombre))')
      .eq('empresa_id', id).gte('fecha', d).lte('fecha', hasta)
      .order('fecha').order('consecutivo').range(0, 4999);
    if (r.error && /auxiliar/.test(r.error.message || '')) {   // sin archivo 77
      r = await db.from('asientos')
        .select('id, consecutivo, fecha, descripcion, referencia, origen, anulado, motivo_anulacion, asiento_lineas(cuenta_id, debito, credito, descripcion, cuentas(numero, nombre))')
        .eq('empresa_id', id).gte('fecha', d).lte('fecha', hasta)
        .order('fecha').order('consecutivo').range(0, 4999);
    }
    if (r.error && /anulado|motivo_anulacion/.test(r.error.message || '')) {
      r = await db.from('asientos')
        .select('id, consecutivo, fecha, descripcion, referencia, origen, asiento_lineas(cuenta_id, debito, credito, descripcion, cuentas(numero, nombre))')
        .eq('empresa_id', id).gte('fecha', d).lte('fecha', hasta)
        .order('fecha').order('consecutivo').range(0, 4999);
    }
    const { data, error } = r;
    if (error) throw error;
    let td = 0; let tc = 0;
    const filasSpec = [];
    const tarjetas = data.map((a) => {
      const ls = (a.asiento_lineas || []).slice().sort((x, y) =>
        (Number(y.debito) > 0) - (Number(x.debito) > 0) ||
        String((x.cuentas || {}).numero).localeCompare(String((y.cuentas || {}).numero)));
      ls.forEach((l, i) => {
        td += Number(l.debito); tc += Number(l.credito);
        filasSpec.push({
          c: [i === 0 ? fechaCorta(a.fecha) : '', i === 0 ? String(a.consecutivo) : '',
            l.cuentas ? `${l.cuentas.numero} ${l.cuentas.nombre}` + (l.auxiliares ? ` · ${l.auxiliares.codigo} ${l.auxiliares.nombre}` : '') : '',
            i === 0 ? a.descripcion + (a.referencia ? ` · ${a.referencia}` : '') : '',
            nulo0(l.debito), nulo0(l.credito)],
          e: i === 0 ? 'normal' : 'normal'
        });
      });
      return h('div', { class: 'tarjeta' + (a.anulado ? ' anulada' : '') },
        h('div', { class: 'trx-linea' },
          h('strong', null, `N.º ${a.consecutivo}`),
          h('span', { class: 'ayuda' }, fechaCorta(a.fecha)),
          h('span', { class: 'insignia' + (a.origen === 'ajuste' ? ' aviso' : ' gris') }, ORIENTE(a.origen)),
          a.anulado ? h('span', { class: 'insignia aviso' }, 'Anulado') : null),
        h('p', { class: 'trx-nom' }, a.descripcion + (a.referencia ? ` · ${a.referencia}` : '')),
        h('div', { class: 'linea-asiento cab' }, h('span', null, 'Cuenta'), h('span', { class: 'monto' }, 'Débito'), h('span', { class: 'monto' }, 'Crédito')),
        ls.map((l) => h('div', { class: 'linea-asiento' },
          h('span', null, l.cuentas ? `${l.cuentas.numero} ${l.cuentas.nombre}` + (l.auxiliares ? ` · ${l.auxiliares.codigo} ${l.auxiliares.nombre}` : '') : ''),
          h('span', { class: 'monto' }, nz(l.debito)),
          h('span', { class: 'monto' }, nz(l.credito)))),
        accionesAsiento(a, ls));
    });
    filasSpec.push({ c: ['', '', 'Totales', '', redondear(td), redondear(tc)], e: 'total' });
    const nodo = h('div', null,
      h('div', { class: 'resumen' },
        chip('Asientos', String(data.length)),
        chip('Débitos = Créditos', redondear(td) === redondear(tc) ? 'Cuadrado' : 'Descuadrado'),
        chip('Total débitos', dinero(td)),
        chip('Total créditos', dinero(tc))),
      h('div', { class: 'acciones' },
        h('button', { class: 'btn', type: 'button', onclick: () => abrirAjuste(id, cuentas, rango()[1], pintar) }, '+ Asiento de ajuste')),
      data.length ? tarjetas : h('p', { class: 'ayuda' }, 'No hay asientos en este período.'));
    const spec = data.length ? {
      titulo: 'Diario general', subtitulo: etiquetaPeriodo(), hoja: 'Diario general',
      columnas: [{ t: 'Fecha', w: 1 }, { t: 'N.º', w: 0.7 }, { t: 'Cuenta', w: 2.6 }, { t: 'Descripción', w: 2.6 },
        { t: 'Débito', num: true }, { t: 'Crédito', num: true }],
      filas: filasSpec
    } : null;
    return { nodo, spec, archivo: archivoDe('diario') };
  }

  /* ---- mayor ---- */
  async function mayor() {
    if (!est.cuentaId) {
      return { nodo: h('p', { class: 'ayuda' }, 'Elige una cuenta para ver su mayor. Aquí aparecen las cuentas que reciben movimientos.'), spec: null };
    }
    const [d, hasta] = rango();
    const { data, error } = await db.from('v_mayor')
      .select('fecha, consecutivo, descripcion, referencia, debito, credito, saldo')
      .eq('empresa_id', id).eq('cuenta_id', est.cuentaId).lte('fecha', hasta)
      .order('fecha').order('consecutivo').range(0, 4999);
    if (error) throw error;
    const cuenta = cuentas.find((c) => c.id === est.cuentaId) || { numero: '', nombre: '' };
    // las cuentas de ingresos, costos y gastos empiezan en cero cada 1 de enero
    const nominal = /^[4-9]/.test(String(cuenta.numero));
    const antes = data.filter((m) => m.fecha < d && (!nominal || m.fecha.slice(0, 4) === d.slice(0, 4)));
    const saldoIni = antes.length ? Number(antes[antes.length - 1].saldo) : 0;
    const movs = data.filter((m) => m.fecha >= d);
    const td = movs.reduce((s, m) => s + Number(m.debito), 0);
    const tc = movs.reduce((s, m) => s + Number(m.credito), 0);
    const saldoFin = movs.length ? Number(movs[movs.length - 1].saldo) : saldoIni;
    const nodo = h('div', null,
      h('div', { class: 'resumen' },
        chip('Saldo anterior', dinero(saldoIni)), chip('Saldo final', dinero(saldoFin)),
        chip('Débitos', dinero(td)), chip('Créditos', dinero(tc))),
      movs.length
        ? tablaScroll(h('table', { class: 'tabla' },
          h('thead', null, h('tr', null,
            h('th', null, 'Fecha'), h('th', null, 'Descripción'),
            h('th', { class: 'num' }, 'Débito'), h('th', { class: 'num' }, 'Crédito'), h('th', { class: 'num' }, 'Saldo'))),
          h('tbody', null, movs.map((m) => h('tr', null,
            celda(fechaCorta(m.fecha)),
            celda(m.descripcion + (m.referencia ? ` · ${m.referencia}` : '')),
            celda(nz(m.debito), 'num'), celda(nz(m.credito), 'num'), celda(n2(m.saldo), 'num'))))))
        : h('p', { class: 'ayuda' }, 'Esta cuenta no tiene movimientos en el período.'));
    const spec = {
      titulo: `Mayor general · ${cuenta.numero} ${cuenta.nombre}`, subtitulo: etiquetaPeriodo(), hoja: 'Mayor general',
      columnas: [{ t: 'Fecha', w: 1 }, { t: 'Descripción', w: 4 }, { t: 'Débito', num: true }, { t: 'Crédito', num: true }, { t: 'Saldo', num: true }],
      filas: [
        { c: ['', 'Saldo anterior', null, null, redondear(saldoIni)], e: 'grupo' },
        ...movs.map((m) => ({ c: [fechaCorta(m.fecha), m.descripcion + (m.referencia ? ` · ${m.referencia}` : ''), nulo0(m.debito), nulo0(m.credito), Number(m.saldo)] })),
        { c: ['', 'Totales y saldo final', redondear(td), redondear(tc), redondear(saldoFin)], e: 'total' }]
    };
    return { nodo, spec, archivo: archivoDe(`mayor-${cuenta.numero}`) };
  }

  /* ---- balance de comprobación (antes y después de ajustes) ---- */
  const VERSIONES = {
    antes: 'antes de ajustes',
    despues: 'después de ajustes',
    cierre: 'después del cierre del año'
  };

  async function datosBalance(modo, d, hasta) {
    // "después de ajustes" es el balance de siempre; las otras versiones usan la función del archivo 68
    if (modo === 'despues') {
      const r = await db.rpc('balance_comprobacion', { p_empresa: id, p_desde: d, p_hasta: hasta });
      if (r.error) throw r.error;
      return r.data;
    }
    const r = await db.rpc('balance_comprobacion_ajustes', { p_empresa: id, p_desde: d, p_hasta: hasta, p_modo: modo });
    if (r.error) {
      if (r.error.code === 'PGRST202' || r.error.code === '42883' || /could not find the function/i.test(r.error.message || '')) {
        throw new Error('Falta ejecutar el archivo 68 en Supabase para ver el balance antes de ajustes o después del cierre.');
      }
      throw r.error;
    }
    return r.data;
  }

  function construirBalance(modo, data) {
    const maxNivel = Number(est.nivel);
    const filas = data.filter((r) => Number(r.nivel) <= maxNivel);
    const raiz = data.filter((r) => Number(r.nivel) === 1);
    const suma = (arr, k) => arr.reduce((s, r) => s + Number(r[k] || 0), 0);
    const sd = redondear(suma(raiz, 'saldo_final_deudor'));
    const sa = redondear(suma(raiz, 'saldo_final_acreedor'));
    const sant = (v) => (Number(v) < 0 ? `${n2(-v)} A` : nz(v));
    const etiqueta = VERSIONES[modo];
    const nodo = h('div', null,
      h('h3', null, `Balance de comprobación ${etiqueta}`),
      h('div', { class: 'resumen' },
        chip('Saldos deudores', dinero(sd)), chip('Saldos acreedores', dinero(sa)),
        chip('Resultado', sd === sa ? 'Cuadrado' : 'Descuadrado'),
        chip('Período', etiquetaPeriodo())),
      h('p', { class: 'ayuda' }, 'Saldo anterior: sin letra es deudor y con "A" es acreedor. Saldo actual = saldo anterior + débitos − créditos. Los totales suman solo las cuentas mayores (nivel 1) para no contar dos veces.'),
      filas.length
        ? tablaScroll(h('table', { class: 'tabla' },
          h('thead', null, h('tr', null,
            h('th', null, 'Cuenta'), h('th', { class: 'num' }, 'Saldo ant.'),
            h('th', { class: 'num' }, 'Débitos'), h('th', { class: 'num' }, 'Créditos'),
            h('th', { class: 'num' }, 'Actual deudor'), h('th', { class: 'num' }, 'Actual acreedor'))),
          h('tbody', null, filas.map((r) => h('tr', { class: 'nivel-' + r.nivel },
            celda(`${r.numero} ${r.nombre}`),
            celda(sant(r.saldo_anterior), 'num'), celda(nz(r.debitos), 'num'), celda(nz(r.creditos), 'num'),
            celda(nz(r.saldo_final_deudor), 'num'), celda(nz(r.saldo_final_acreedor), 'num'))),
          ),
          h('tfoot', null, h('tr', null,
            celda('Totales (nivel 1)'), celda(''),
            celda(n2(suma(raiz, 'debitos')), 'num'), celda(n2(suma(raiz, 'creditos')), 'num'),
            celda(n2(sd), 'num'), celda(n2(sa), 'num')))))
        : h('p', { class: 'ayuda' }, 'No hay movimientos en el período.'));
    const notaVersion = {
      antes: 'Sin los asientos de ajuste (depreciación, impuesto sobre la renta y otros asientos de tipo Ajuste). Las anulaciones de transacciones sí se incluyen.',
      despues: 'Con los asientos de ajuste y sin los asientos de cierre del año: son los saldos de cierre fiscal antes de cerrar las cuentas de resultado.',
      cierre: 'Con los asientos de ajuste y con el cierre del año: las cuentas de resultado quedan en cero y solo permanecen las de balance.'
    }[modo];
    const spec = filas.length ? {
      titulo: `Balance de comprobación ${etiqueta}`, subtitulo: etiquetaPeriodo(), hoja: `Comprobación ${modo === 'antes' ? 'antes' : (modo === 'cierre' ? 'cierre' : 'después')}`,
      columnas: [{ t: 'Cuenta', w: 1 }, { t: 'Saldo anterior', num: true }, { t: 'Débitos', num: true },
        { t: 'Créditos', num: true }, { t: 'Saldo actual deudor', num: true }, { t: 'Saldo actual acreedor', num: true }],
      filas: [
        ...filas.map((r) => ({
          c: [`${r.numero} ${r.nombre}`, nulo0(r.saldo_anterior), nulo0(r.debitos), nulo0(r.creditos),
            nulo0(r.saldo_final_deudor), nulo0(r.saldo_final_acreedor)],
          e: Number(r.nivel) === 1 ? 'n1' : (Number(r.nivel) === 2 ? 'n2' : 'normal')
        })),
        { c: ['Totales (cuentas de nivel 1)', null, redondear(suma(raiz, 'debitos')), redondear(suma(raiz, 'creditos')), sd, sa], e: 'total' }],
      notas: [notaVersion, 'Saldo anterior: positivo = deudor, negativo = acreedor. Los totales suman solo las cuentas de nivel 1 para no contar dos veces.']
    } : null;
    return { nodo, spec };
  }

  async function balance() {
    const [d, hasta] = rango();
    const modos = est.version === 'ambos' ? ['antes', 'despues'] : [est.version];
    const partes = [];
    for (const m of modos) partes.push(construirBalance(m, await datosBalance(m, d, hasta)));
    const specs = partes.map((x) => x.spec).filter(Boolean);
    const nodo = h('div', null, ...partes.map((x) => x.nodo));
    const nombre = { antes: 'antes-de-ajustes', despues: 'despues-de-ajustes', cierre: 'despues-del-cierre', ambos: 'antes-y-despues-de-ajustes' }[est.version];
    return { nodo, spec: specs[0] || null, specs, archivo: archivoDe(`balance-comprobacion-${nombre}`) };
  }

  /* ---- hoja de trabajo ---- */
  async function hoja() {
    const [d, hasta] = rango();
    const { data, error } = await db.rpc('hoja_trabajo', { p_empresa: id, p_desde: d, p_hasta: hasta });
    if (error) throw error;
    const claves = ['comp_debe', 'comp_haber', 'aj_debe', 'aj_haber', 'ajust_debe', 'ajust_haber', 'er_debe', 'er_haber', 'bg_debe', 'bg_haber'];
    const tot = {};
    claves.forEach((k) => { tot[k] = redondear(data.reduce((s, r) => s + Number(r[k] || 0), 0)); });
    const utilidad = redondear(tot.er_haber - tot.er_debe);
    const cols = [['Comprobación', 'comp'], ['Ajustes', 'aj'], ['Ajustada', 'ajust'], ['Resultados', 'er'], ['Balance', 'bg']];
    const nodo = h('div', null,
      h('div', { class: 'resumen' },
        chip('Comprobación', tot.comp_debe === tot.comp_haber ? 'Cuadrada' : 'Descuadrada'),
        chip(utilidad >= 0 ? 'Utilidad del período' : 'Pérdida del período', dinero(Math.abs(utilidad))),
        chip('Ajustes (débitos)', dinero(tot.aj_debe)), chip('Período', etiquetaPeriodo())),
      h('p', { class: 'ayuda' }, 'Cada par de columnas es Debe / Haber. Los asientos de ajuste que registres en el Diario aparecen en la columna Ajustes.'),
      data.length
        ? tablaScroll(h('table', { class: 'tabla ancha' },
          h('thead', null,
            h('tr', null, h('th', { rowspan: 2 }, 'Cuenta'), cols.map(([t]) => h('th', { colspan: 2, class: 'centro' }, t))),
            h('tr', null, cols.map(() => [h('th', { class: 'num' }, 'Debe'), h('th', { class: 'num' }, 'Haber')]))),
          h('tbody', null, data.map((r) => h('tr', null,
            celda(`${r.numero} ${r.nombre}`),
            claves.map((k) => celda(nz(r[k]), 'num'))))),
          h('tfoot', null, h('tr', null, celda('Totales'), claves.map((k) => celda(n2(tot[k]), 'num'))))))
        : h('p', { class: 'ayuda' }, 'No hay movimientos en el período.'));
    const spec = data.length ? {
      titulo: 'Hoja de trabajo', subtitulo: etiquetaPeriodo(), hoja: 'Hoja de trabajo', horizontal: true,
      grupos: [{ t: 'Cuenta', n: 1, r: 2 }, ...cols.map(([t]) => ({ t, n: 2 }))],
      columnas: [{ t: 'Cuenta', w: 1 }, ...claves.map((k) => ({ t: k.endsWith('debe') ? 'Debe' : 'Haber', num: true }))],
      filas: [
        ...data.map((r) => ({ c: [`${r.numero} ${r.nombre}`, ...claves.map((k) => nulo0(r[k]))] })),
        { c: ['Totales', ...claves.map((k) => tot[k])], e: 'total' }],
      notas: [`${utilidad >= 0 ? 'Utilidad' : 'Pérdida'} del período: ${n2(Math.abs(utilidad))}`]
    } : null;
    return { nodo, spec, archivo: archivoDe('hoja-de-trabajo') };
  }

  /* ---- auxiliares ---- */
  async function auxiliares() {
    if (auxDatos.falta) throw new Error('Falta ejecutar el archivo 77 en Supabase para usar auxiliares.');
    return informeAuxiliares({
      empresa, id, rango, etiquetaPeriodo, archivoDe, barraExportar,
      cuentaId: est.cuentaAux, verCeros: est.verCeros,
      alCambiar: async () => { const r = await cargarAuxiliares(id); auxDatos.lista = r.lista; auxDatos.falta = r.falta; armarBarra(); pintar(); }
    });
  }

  const construir = { diario, mayor, balance, hoja, auxiliares };

  async function pintar() {
    zona.replaceChildren(cargando());
    try {
      const r = await construir[est.informe]();
      est.actual = r;
      zona.replaceChildren(
        h('div', { class: 'barra-exportar' }, barraExportar({
          empresa,
          obtener: () => (est.actual && est.actual.spec ? { specs: est.actual.specs || [est.actual.spec], archivo: est.actual.archivo } : null)
        })),
        r.nodo);
    } catch (e) {
      est.actual = null;
      zona.replaceChildren(h('div', { class: 'tarjeta error' }, h('p', null, traducirError(e))));
    }
  }

  function armarBarra() {
    const selInforme = h('select', { value: est.informe, onchange: (e) => { est.informe = e.target.value; armarBarra(); pintar(); } },
      INFORMES.map(([k, t]) => h('option', { value: k }, t)));
    const selModo = h('select', { value: est.modo, onchange: (e) => { est.modo = e.target.value; armarBarra(); pintar(); } },
      h('option', { value: 'mes' }, 'Mensual'), h('option', { value: 'anio' }, 'Anual'));
    const periodo = est.modo === 'anio'
      ? h('input', {
        type: 'number', min: '2000', max: '2100', step: '1', inputmode: 'numeric', value: String(est.anio),
        onchange: (e) => { const v = Number(e.target.value); if (v >= 2000 && v <= 2100) { est.anio = v; pintar(); } }
      })
      : h('input', {
        type: 'month', value: est.mes,
        onchange: (e) => { if (e.target.value) { est.mes = e.target.value; pintar(); } }
      });
    const extra = [];
    if (est.informe === 'mayor') {
      extra.push(h('select', { value: est.cuentaId, onchange: (e) => { est.cuentaId = e.target.value; pintar(); } },
        h('option', { value: '' }, 'Elegir cuenta…'),
        cuentas.map((c) => h('option', { value: c.id }, `${c.numero} · ${c.nombre}`))));
    }
    if (est.informe === 'balance') {
      extra.push(h('select', { value: est.version, onchange: (e) => { est.version = e.target.value; pintar(); } },
        h('option', { value: 'antes' }, 'Antes de ajustes'),
        h('option', { value: 'despues' }, 'Después de ajustes (cierre fiscal)'),
        h('option', { value: 'ambos' }, 'Antes y después (los dos)'),
        h('option', { value: 'cierre' }, 'Después del cierre del año')));
      extra.push(h('select', { value: est.nivel, onchange: (e) => { est.nivel = e.target.value; pintar(); } },
        h('option', { value: '1' }, 'Solo cuentas mayores (nivel 1)'),
        h('option', { value: '2' }, 'Hasta nivel 2'),
        h('option', { value: '3' }, 'Hasta nivel 3'),
        h('option', { value: '4' }, 'Todas las cuentas (nivel 4)')));
    }
    if (est.informe === 'auxiliares') {
      const conAux = [...new Set(auxDatos.lista.map((a) => a.cuenta_id))];
      extra.push(h('select', { value: est.cuentaAux, onchange: (e) => { est.cuentaAux = e.target.value; pintar(); } },
        h('option', { value: '' }, 'Todas las cuentas con auxiliares'),
        cuentas.filter((c) => conAux.includes(c.id)).map((c) => h('option', { value: c.id }, `${c.numero} · ${c.nombre}`))));
      extra.push(h('label', { class: 'fila-check' },
        h('input', { type: 'checkbox', checked: est.verCeros, onchange: (e) => { est.verCeros = e.target.checked; pintar(); } }),
        h('span', null, 'Mostrar auxiliares sin movimiento ni saldo')));
      if (puedeCrearAux(empresa.rol)) {
        extra.push(h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: nuevoAuxiliar }, '+ Nuevo auxiliar'));
      }
    }
    barra.replaceChildren(selInforme, selModo, periodo, ...extra);
  }

  // Crear un auxiliar eligiendo primero la cuenta
  function nuevoAuxiliar() {
    const sel = h('select', { value: est.cuentaAux },
      h('option', { value: '' }, 'Elegir cuenta…'),
      cuentas.map((c) => h('option', { value: c.id }, `${c.numero} · ${c.nombre}`)));
    let cerrar;
    cerrar = modal('Nuevo auxiliar', h('div', null,
      campo('¿En qué cuenta?', sel, 'Las cuentas que reciben movimientos. Ej.: 1.1.02.001 Clientes locales.'),
      h('button', {
        class: 'btn btn-bloque', type: 'button',
        onclick: () => {
          const c = cuentas.find((x) => x.id === sel.value);
          if (!c) { toast('Elige la cuenta.', 'error'); return; }
          cerrar();
          formularioAuxiliar({
            empresaId: id, rol: empresa.rol, cuenta: c,
            alGuardar: (fila) => { if (fila) { auxDatos.lista.push(fila); auxDatos.falta = false; est.cuentaAux = c.id; armarBarra(); pintar(); } }
          });
        }
      }, 'Continuar')));
  }

  armarBarra();
  mostrar(marcoEmpresa(empresa, 'informes', [barra, zona]));
  pintar();
}

// FIN DEL ARCHIVO informes.js
