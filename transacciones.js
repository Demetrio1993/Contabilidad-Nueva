// Libro de transacciones: ventas, compras, costos, gastos, cobros, pagos y otros
import { db, estado, h, mostrar, toast, modal, campo, texto, dinero, fechaCorta, traducirError, cargando, marco, marcoEmpresa, cargarEmpresa } from './lib.js';
import { abrirTercero } from './terceros.js';
import { panelEscaneo } from './ocr.js';
import { confirmar, pedirMotivo, barraAcciones, rpcOk } from './acciones.js';
import { panelSoportes, subirSoporte } from './soportes.js';
import { bloqueNotasCredito } from './notascredito.js';
import { abrirRecurrentes, contarPendientes } from './recurrentes.js';
import { avisoRespaldo } from './respaldo.js';
import { cargarAuxiliares, campoAuxiliar, etiquetaAux } from './auxiliares.js';
import { panelComentarios, pendientesAbiertos, contarPendientesEmpresa, abrirPendientes } from './comentarios.js';

const TIPOS_TRX = {
  venta: 'Venta',
  compra_mercancia: 'Compra de mercancía',
  costo: 'Costo',
  gasto: 'Gasto',
  cobro_cliente: 'Cobro a cliente',
  pago_proveedor: 'Pago a proveedor',
  otro: 'Otro movimiento'
};
const FACTURAS = ['venta', 'compra_mercancia', 'costo', 'gasto'];
const COMPRAS = ['compra_mercancia', 'costo', 'gasto'];

function pad(n) { return String(n).padStart(2, '0'); }
function hoyISO() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function mesActual() { return hoyISO().slice(0, 7); }
function rangoMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  const sig = m === 12 ? `${a + 1}-01` : `${a}-${pad(m + 1)}`;
  return [`${mes}-01`, `${sig}-01`];
}
function moverMes(mes, delta) {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export async function vistaTransacciones(id) {
  mostrar(marco(cargando()));
  const [empresa, rc, rk, rt, auxDatos] = await Promise.all([
    cargarEmpresa(id),
    db.from('cuentas').select('id, numero, nombre, tipo, nivel, acepta_movimientos, activa')
      .eq('empresa_id', id).eq('acepta_movimientos', true).eq('activa', true)
      .order('numero').range(0, 4999),
    db.from('empresa_cuentas_clave').select('clave, cuenta_id').eq('empresa_id', id),
    db.from('terceros').select('id, razon_social, ruc, dv, tipo, activo')
      .eq('empresa_id', id).eq('activo', true).order('razon_social').range(0, 4999),
    cargarAuxiliares(id)
  ]);
  for (const r of [rc, rk, rt]) if (r.error) throw r.error;
  const cuentas = rc.data;
  const nombreCuenta = Object.fromEntries(cuentas.map((c) => [c.id, `${c.numero} · ${c.nombre}`]));
  const clave = Object.fromEntries(rk.data.map((k) => [k.clave, k.cuenta_id]));
  const terceros = rt.data;
  const cuentaPorId = Object.fromEntries(cuentas.map((c) => [c.id, c]));
  const auxPorId = () => Object.fromEntries(auxDatos.lista.map((a) => [a.id, a]));
  const auxDe = (t) => { const m = auxPorId(); return [t.aux_principal_id, t.aux_contra_id].filter(Boolean).map((i) => m[i]).filter(Boolean); };

  const soloRegistra = empresa.rol === 'auxiliar';
  const permisos = empresa.permisos || [];
  const veTodo = true; // el auxiliar ve todas las transacciones de la empresa
  const puedeTerceros = true;
  const miId = estado.userId || null;

  let mes = mesActual();
  let filas = [];
  let soloPendientes = false;   // ver las ventas que faltan por facturar en la DGI (todos los meses)
  let hayFiscal = true;         // false si aún no se ejecutó el archivo 62
  let notasMes = [];            // notas de crédito con fecha en el mes (para los totales)
  let notasPorTrx = {};         // notas de crédito vigentes de cada transacción cargada
  let recurrentesPend = 0;      // movimientos recurrentes que ya tocan
  let pendMapa = {};            // pendientes abiertos por transacción (comentarios)
  let pendTotal = 0;            // pendientes abiertos de toda la empresa
  const puedeMarcar = empresa.rol !== 'lector';
  const resumen = h('div', { class: 'resumen' });
  const lista = h('div', { class: 'lista-cuentas' });
  const selMes = h('input', { type: 'month', value: mes, required: true });

  async function cargarMes() {
    const [d, s] = rangoMes(mes);
    const consulta = (cols) => {
      let q = db.from('transacciones').select(cols).eq('empresa_id', id);
      q = soloPendientes
        ? q.eq('tipo', 'venta').eq('fiscal_emitida', false).eq('anulada', false)
        : q.gte('fecha', d).lt('fecha', s);
      return q.order('fecha').order('creado_en');
    };
    const base = 'id, tipo, fecha, tercero_id, nombre_tercero, ruc, dv, numero_factura, descripcion, monto_bruto, itbms, monto_neto, forma, cuenta_principal_id, cuenta_contrapartida_id, creado_por';
    const fiscal = ', fiscal_emitida, fiscal_numero, fiscal_fecha';
    hayFiscal = true;
    let r = await consulta(base + ', anulada, motivo_anulacion' + fiscal + ', retencion_itbms, aux_principal_id, aux_contra_id');
    if (r.error) r = await consulta(base + ', anulada, motivo_anulacion' + fiscal + ', retencion_itbms');   // sin archivo 77
    if (r.error) r = await consulta(base + ', anulada, motivo_anulacion' + fiscal);   // sin archivo 64
    if (r.error && soloPendientes) { soloPendientes = false; toast('Falta ejecutar el archivo 62 en Supabase.', 'error'); r = await consulta(base + ', anulada, motivo_anulacion'); }
    if (r.error) { hayFiscal = false; r = await consulta(base + ', anulada, motivo_anulacion'); } // sin archivo 62
    if (r.error) r = await consulta(base); // si aún no se ejecutó el archivo 53
    if (r.error) { toast(traducirError(r.error), 'error'); return; }
    filas = r.data;
    selMes.value = mes;
    // Notas de crédito: las del mes (para los totales) y las de cada transacción (para la etiqueta)
    notasMes = []; notasPorTrx = {};
    if (!soloPendientes) {
      const nm = await db.from('notas_credito').select('fecha, monto_bruto, itbms, monto_neto, anulada, transacciones(tipo)')
        .eq('empresa_id', id).eq('anulada', false).gte('fecha', d).lt('fecha', s);
      if (!nm.error) notasMes = nm.data || [];
    }
    if (filas.length) {
      const np = await db.from('notas_credito').select('transaccion_id, monto_neto')
        .eq('empresa_id', id).eq('anulada', false).in('transaccion_id', filas.map((t) => t.id));
      if (!np.error) for (const n of np.data || []) notasPorTrx[n.transaccion_id] = (notasPorTrx[n.transaccion_id] || 0) + Number(n.monto_neto);
    }
    recurrentesPend = await contarPendientes(id);
    pendMapa = (await pendientesAbiertos(id, filas.map((t) => t.id))) || {};
    pendTotal = (await contarPendientesEmpresa(id)) || 0;
    pintar();
  }

  function pintar() {
    btnComent.textContent = pendTotal ? `Pendientes (${pendTotal})` : 'Pendientes';
    btnRec.textContent = recurrentesPend ? `⏰ Movimientos recurrentes (${recurrentesPend} por registrar)` : 'Movimientos recurrentes';
    const suma = (tipos, campoN) => filas.filter((t) => !t.anulada && tipos.includes(t.tipo))
      .reduce((s, t) => s + Number(t[campoN]), 0);
    const vigentes = (tipos) => filas.filter((t) => !t.anulada && tipos.includes(t.tipo)).length;
    const chip = (titulo, valor, n) => h('div', { class: 'chip' }, h('span', { class: 'ayuda' }, titulo + (n !== undefined ? ` (${n})` : '')), h('strong', null, dinero(valor)));
    // Las notas de crédito del mes restan de las ventas o de las compras y gastos
    const notas = (tipos, campoN) => notasMes.filter((n) => n.transacciones && tipos.includes(n.transacciones.tipo))
      .reduce((a, n) => a + Number(n[campoN]), 0);
    const ncVentas = notas(['venta'], 'monto_bruto');
    const ncCompras = notas(['compra_mercancia', 'costo'], 'monto_bruto');
    const ncGastos = notas(['gasto'], 'monto_bruto');
    resumen.replaceChildren(...[
      chip(ncVentas ? 'Ventas (menos notas de crédito)' : 'Ventas', suma(['venta'], 'monto_bruto') - ncVentas, vigentes(['venta'])),
      empresa.contribuyente_itbms ? chip('ITBMS cobrado', suma(['venta'], 'itbms') - notas(['venta'], 'itbms')) : null,
      chip('Cobros', suma(['cobro_cliente'], 'monto_neto'), vigentes(['cobro_cliente'])),
      chip(ncCompras ? 'Compras y costos (menos notas)' : 'Compras y costos', suma(['compra_mercancia', 'costo'], 'monto_bruto') - ncCompras, vigentes(['compra_mercancia', 'costo'])),
      chip(ncGastos ? 'Gastos (menos notas)' : 'Gastos', suma(['gasto'], 'monto_bruto') - ncGastos, vigentes(['gasto'])),
      empresa.contribuyente_itbms ? chip('ITBMS pagado', suma(COMPRAS, 'itbms') - notas(COMPRAS, 'itbms')) : null,
      chip('Pagos', suma(['pago_proveedor'], 'monto_neto'), vigentes(['pago_proveedor'])),
      chip('Otros movimientos', suma(['otro'], 'monto_neto'), vigentes(['otro'])),
      hayFiscal && !soloPendientes ? h('div', { class: 'chip' }, h('span', { class: 'ayuda' }, 'Sin factura fiscal DGI'), h('strong', null, String(filas.filter((t) => !t.anulada && t.tipo === 'venta' && !t.fiscal_emitida).length))) : null
    ].filter(Boolean));
    if (filas.length === 0) {
      lista.replaceChildren(h('p', { class: 'cargando' }, soloPendientes ? 'No hay ventas pendientes de factura fiscal.' : 'No hay transacciones en este mes.'));
      return;
    }
    lista.replaceChildren(...filas.map((t) => h('button', { class: 'trx' + (t.anulada ? ' anulada' : ''), type: 'button', onclick: () => detalle(t) },
      h('div', { class: 'trx-linea' },
        h('span', { class: 'insignia' }, TIPOS_TRX[t.tipo]),
        t.anulada ? h('span', { class: 'insignia aviso' }, 'Anulada') : null,
        pendMapa[t.id] ? h('span', { class: 'insignia aviso' }, 'Pendiente') : null,
        h('span', { class: 'ayuda' }, fechaCorta(t.fecha)),
        t.forma === 'credito' ? h('span', { class: 'insignia aviso' }, 'A crédito') : null,
        ...auxDe(t).map((a) => h('span', { class: 'insignia gris' }, etiquetaAux(a))),
        notasPorTrx[t.id] ? h('span', { class: 'insignia gris' }, `Nota de crédito ${dinero(notasPorTrx[t.id])}`) : null,
        Number(t.retencion_itbms) > 0 ? h('span', { class: 'insignia gris' }, `Retención ${dinero(t.retencion_itbms)}`) : null,
        hayFiscal && t.tipo === 'venta' && !t.anulada
          ? (t.fiscal_emitida
            ? h('span', { class: 'insignia' }, '✔ Fiscal' + (t.fiscal_numero ? ' ' + t.fiscal_numero : ''))
            : h('span', { class: 'insignia aviso' }, 'Falta factura fiscal'))
          : null),
      h('div', { class: 'trx-nom' }, t.nombre_tercero || t.descripcion || '—'),
      h('div', { class: 'trx-montos' },
        h('span', { class: 'ayuda' }, [
          t.numero_factura ? `Fact. ${t.numero_factura}` : null,
          Number(t.itbms) > 0 ? `ITBMS ${dinero(t.itbms)}` : null
        ].filter(Boolean).join(' · ')),
        h('strong', null, dinero(t.monto_neto))))));
  }

  function detalle(t) {
    let cerrar;
    const dato = (etq, val) => val ? h('p', null, h('strong', null, etq + ': '), val) : null;
    const recargar = async () => { cerrar(); await cargarMes(); };
    const puedeCorregir = !soloRegistra || (miId && t.creado_por === miId);
    const acciones = !puedeCorregir ? null : barraAcciones({
      editar: t.anulada ? null : () => {
        if (notasPorTrx[t.id]) { toast('Esta factura tiene notas de crédito. Elimínalas antes de editarla.', 'error'); return; }
        cerrar(); abrirNueva(t);
      },
      anular: t.anulada ? null : () => pedirMotivo({
        titulo: 'Anular transacción',
        mensaje: 'Se conserva el registro, pero deja de contar. Se crea un asiento contrario con la misma fecha. Solo se puede si el mes está abierto.',
        alConfirmar: async (motivo) => {
          await rpcOk(db, 'anular_transaccion', { p_transaccion: t.id, p_motivo: motivo });
          toast('Transacción anulada.', 'ok');
          await recargar();
        }
      }),
      eliminar: () => confirmar({
        titulo: 'Eliminar transacción',
        mensaje: 'Se borra la transacción y su asiento contable (y el de anulación, si lo tiene). Solo se puede si el mes está abierto.',
        boton: 'Eliminar',
        alConfirmar: async () => {
          await rpcOk(db, 'eliminar_transaccion', { p_transaccion: t.id });
          toast('Transacción eliminada.', 'ok');
          await recargar();
        }
      })
    });
    cerrar = modal(TIPOS_TRX[t.tipo] + (t.anulada ? ' (anulada)' : ''), h('div', null,
      t.anulada ? h('p', { class: 'ayuda' }, 'Anulada' + (t.motivo_anulacion ? ': ' + t.motivo_anulacion : '') + '. No cuenta en informes.') : null,
      dato('Fecha', fechaCorta(t.fecha)),
      dato('Cliente o proveedor', t.nombre_tercero),
      dato('RUC', t.ruc ? `${t.ruc}${t.dv ? ' DV ' + t.dv : ''}` : null),
      dato('Factura', t.numero_factura),
      dato('Descripción', t.descripcion),
      dato('Monto bruto', dinero(t.monto_bruto)),
      Number(t.itbms) > 0 ? dato('ITBMS', dinero(t.itbms)) : null,
      Number(t.retencion_itbms) > 0 ? dato('ITBMS retenido', dinero(t.retencion_itbms)) : null,
      dato('Total', dinero(t.monto_neto)),
      dato('Forma de pago', t.forma === 'credito' ? 'A crédito' : 'Al contado'),
      bloqueFiscal(t, recargar),
      bloqueNotasCredito({ t, empresa, miId, puedeRegistrar: puedeMarcar, alCambiar: recargar }),
      panelSoportes({
        empresaId: id, transaccionId: t.id, puedeSubir: puedeMarcar,
        puedeQuitar: (x) => !soloRegistra || (miId && x.creado_por === miId)
      }),
      panelComentarios({ empresaId: id, transaccionId: t.id, rol: empresa.rol, miId, alCambiar: cargarMes }),
      dato('Cuenta principal', nombreCuenta[t.cuenta_principal_id]),
      dato('Auxiliar de la cuenta principal', etiquetaAux(auxPorId()[t.aux_principal_id])),
      dato('Contrapartida', nombreCuenta[t.cuenta_contrapartida_id]),
      dato('Auxiliar de la contrapartida', etiquetaAux(auxPorId()[t.aux_contra_id])),
      acciones));
  }

  // Factura fiscal electrónica de la DGI: marca (ganchito) y número, para ventas
  function bloqueFiscal(t, recargar) {
    if (!hayFiscal || t.tipo !== 'venta' || t.anulada) return null;
    if (t.fiscal_emitida) {
      return h('div', { class: 'bloque-fiscal' },
        h('p', null, h('strong', null, '✔ Factura fiscal DGI emitida'),
          t.fiscal_numero ? ' · N.° ' + t.fiscal_numero : ' · sin número anotado',
          t.fiscal_fecha ? ' · ' + fechaCorta(t.fiscal_fecha) : ''),
        puedeMarcar ? h('div', { class: 'acciones' },
          h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: () => formularioFiscal(t, recargar) }, 'Cambiar número'),
          h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: () => confirmar({
            titulo: 'Quitar la marca fiscal',
            mensaje: 'La venta volverá a quedar como pendiente de factura fiscal y se borra el número anotado.',
            boton: 'Quitar marca', peligro: false,
            alConfirmar: async () => { await rpcOk(db, 'marcar_fiscal', { p_transaccion: t.id, p_emitida: false, p_numero: null, p_fecha: null }); toast('Marca quitada.', 'ok'); await recargar(); }
          }) }, 'Quitar marca')) : null);
    }
    return h('div', { class: 'bloque-fiscal' },
      h('p', null, h('strong', null, 'Falta la factura fiscal de la DGI'),
        ' Cuando la emitas en el sistema de la DGI, márcala aquí.'),
      puedeMarcar ? h('button', { class: 'btn btn-bloque', type: 'button', onclick: () => formularioFiscal(t, recargar) }, '✔ Ya la emití en la DGI') : null);
  }

  function formularioFiscal(t, recargar) {
    let cerrar;
    const num = h('input', { type: 'text', placeholder: 'Ej.: 0000000123', value: t.fiscal_numero || '' });
    const fec = h('input', { type: 'date', value: t.fiscal_fecha || hoyISO() });
    const ok = h('button', { class: 'btn btn-bloque', type: 'button', onclick: async () => {
      ok.disabled = true;
      try {
        await rpcOk(db, 'marcar_fiscal', { p_transaccion: t.id, p_emitida: true, p_numero: num.value.trim() || null, p_fecha: fec.value || null });
        toast('Factura fiscal marcada.', 'ok');
        cerrar();
        await recargar();
      } catch (e) { ok.disabled = false; toast(traducirError(e), 'error'); }
    } }, 'Guardar');
    cerrar = modal('Factura fiscal de la DGI', h('div', null,
      h('p', { class: 'ayuda' }, 'Anota el número que te dio la DGI. Puedes dejarlo vacío y completarlo después.'),
      campo('Número de factura fiscal', num),
      campo('Fecha de emisión', fec),
      ok,
      h('button', { class: 'btn btn-sec btn-bloque', type: 'button', onclick: () => cerrar() }, 'Cancelar')));
  }

  function abrirNueva(editando) {
    const st = {
      tipo: 'gasto', fecha: hoyISO(), tercero: '', factura: '', descripcion: '', bruto: '',
      modoItbms: '7', itbmsManual: '', forma: 'contado', principal: '', contra: '', todas: false,
      lectura: null, nuevoTercero: null, duplicada: null, retencion: '', soporte: null,
      auxP: '', auxC: ''
    };
    const cuerpo = h('div');
    let cerrar;
    let totalEl; let itbmsEl;

    const esFactura = () => FACTURAS.includes(st.tipo);
    const llevaItbms = () => !!empresa.contribuyente_itbms && esFactura();
    const esCredito = () => esFactura() && st.forma === 'credito';
    // Retención del ITBMS: solo empresas contribuyentes; en ventas y compras a crédito se anota al cobrar o pagar
    const llevaRetencion = () => !!empresa.contribuyente_itbms && st.tipo !== 'otro' && !esCredito();

    function porDefecto() {
      st.lectura = null;
      st.duplicada = null;
      st.nuevoTercero = null;
      st.retencion = '';
      st.forma = 'contado';
      st.tercero = '';
      st.principal = '';
      st.auxP = '';
      st.auxC = '';
      st.contra = clave.caja || '';
      st.modoItbms = '7';
      if (st.tipo === 'compra_mercancia') st.principal = clave.inventario || '';
      if (st.tipo === 'cobro_cliente') st.principal = clave.cxc || '';
      if (st.tipo === 'pago_proveedor') st.principal = clave.cxp || '';
      if (st.tipo === 'otro') st.contra = '';
    }
    porDefecto();
    if (editando) {
      st.tipo = editando.tipo; st.fecha = editando.fecha;
      porDefecto();
      st.tercero = editando.tercero_id || '';
      if (st.tercero && !terceros.some((x) => x.id === st.tercero)) {
        terceros.push({ id: st.tercero, razon_social: editando.nombre_tercero || '(inactivo)', ruc: editando.ruc, dv: editando.dv, tipo: 'ambos', activo: false });
      }
      st.factura = editando.numero_factura || '';
      st.descripcion = editando.descripcion || '';
      st.bruto = String(editando.monto_bruto);
      st.forma = editando.forma;
      st.principal = editando.cuenta_principal_id;
      st.contra = (editando.forma === 'credito' && FACTURAS.includes(editando.tipo)) ? '' : editando.cuenta_contrapartida_id;
      if (Number(editando.itbms) > 0) { st.modoItbms = 'm'; st.itbmsManual = String(editando.itbms); } else st.modoItbms = '0';
      st.retencion = Number(editando.retencion_itbms) > 0 ? String(editando.retencion_itbms) : '';
      st.auxP = editando.aux_principal_id || '';
      st.auxC = editando.aux_contra_id || '';
      st.todas = true;
    }

    function principales() {
      if (st.todas || st.tipo === 'otro') return cuentas;
      const filtros = {
        venta: (c) => c.tipo === 'ingreso',
        compra_mercancia: (c) => c.numero.startsWith('1.1.05.') || c.tipo === 'costo',
        costo: (c) => c.tipo === 'costo',
        gasto: (c) => c.tipo === 'gasto' || c.tipo === 'extraordinario',
        cobro_cliente: (c) => c.numero.startsWith('1.1.02.'),
        pago_proveedor: (c) => c.numero.startsWith('2.1.01.')
      };
      return cuentas.filter(filtros[st.tipo]);
    }
    function contrapartidas() {
      if (st.todas || st.tipo === 'otro') return cuentas;
      return cuentas.filter((c) => c.numero.startsWith('1.1.01.'));
    }
    // Cuenta de la contrapartida: la elegida o, si es a crédito, clientes o proveedores
    function cuentaContra() {
      if (esCredito()) return cuentaPorId[st.tipo === 'venta' ? clave.cxc : clave.cxp] || null;
      return cuentaPorId[st.contra] || null;
    }
    function tercerosVisibles() {
      const quiere = ['venta', 'cobro_cliente'].includes(st.tipo) ? 'cliente' : 'proveedor';
      return terceros.filter((t) => t.tipo === quiere || t.tipo === 'ambos');
    }

    function itbmsValor() {
      if (!llevaItbms()) return 0;
      if (st.modoItbms === 'm') return Math.max(0, Number(st.itbmsManual) || 0);
      const b = Number(st.bruto) || 0;
      return Math.round(b * Number(st.modoItbms)) / 100;
    }
    function actualizarTotales() {
      if (!totalEl) return;
      const b = Number(st.bruto) || 0;
      const i = itbmsValor();
      if (itbmsEl && st.modoItbms !== 'm') itbmsEl.value = i.toFixed(2);
      totalEl.textContent = dinero(b + i);
    }

    // Pasa lo leído de la factura al formulario; el usuario lo revisa antes de registrar
    // Averigua si una de las partes de la factura es la propia empresa (por RUC o por nombre)
    const normR = (v) => String(v || '').replace(/[\s.\-]/g, '').toUpperCase();
    const normN = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
    function esLaEmpresa(p) {
      if (!p) return false;
      if (empresa.ruc && p.ruc && normR(empresa.ruc) === normR(p.ruc)) return true;
      const a = normN(empresa.razon_social), b = normN(p.nombre);
      return a.length >= 6 && b.length >= 6 && (a === b || a.includes(b) || b.includes(a));
    }

    function aplicarLectura(d) {
      // La parte que se captura la decide el tipo de transacción elegido:
      //  - venta y cobro a cliente: el CLIENTE de la factura (receptor)
      //  - gasto, compra de mercancía, costo y pago a proveedor: el EMISOR
      //  - otro movimiento: la otra parte distinta de la propia empresa
      let avisoRol = '';
      const eE = esLaEmpresa(d.emisor), eR = esLaEmpresa(d.receptor);
      let usarReceptor;
      if (['venta', 'cobro_cliente'].includes(st.tipo)) usarReceptor = true;
      else if (st.tipo === 'otro') usarReceptor = eE && !eR;
      else usarReceptor = false;
      const otra = usarReceptor ? d.receptor : d.emisor;
      if (usarReceptor && eR && !eE) avisoRol = 'Ojo: según la factura, tu empresa es el cliente (receptor). Si es una compra o un gasto, cambia el tipo de transacción y vuelve a leer la factura.';
      if (!usarReceptor && eE && !eR && st.tipo !== 'otro') avisoRol = 'Ojo: según la factura, tu empresa es la que emitió. Si es una venta o un cobro, cambia el tipo de transacción y vuelve a leer la factura.';
      if (d.fecha) st.fecha = d.fecha;
      if (d.numero_factura) st.factura = d.numero_factura;
      if (d.descripcion) st.descripcion = d.descripcion;

      const itbms = Number(d.itbms) || 0;
      if (llevaItbms()) {
        let sub = d.subtotal;
        if (sub === null && d.total !== null) sub = Math.round((d.total - itbms) * 100) / 100;
        if (sub !== null) st.bruto = String(sub);
        if (itbms > 0) { st.modoItbms = 'm'; st.itbmsManual = itbms.toFixed(2); } else { st.modoItbms = '0'; }
      } else if (d.total !== null) {
        st.bruto = String(d.total);
      } else if (d.subtotal !== null) {
        st.bruto = String(Math.round((d.subtotal + itbms) * 100) / 100);
      }

      st.nuevoTercero = null;
      if (otra && (otra.ruc || otra.nombre)) {
        const norm = (v) => String(v || '').replace(/[\s.]/g, '').toUpperCase();
        const hallado = (st.tipo === 'otro' ? terceros : tercerosVisibles()).find((t) => t.ruc && otra.ruc && norm(t.ruc) === norm(otra.ruc) &&
          (!t.dv || !otra.dv || norm(t.dv) === norm(otra.dv)));
        if (hallado) st.tercero = hallado.id;
        else st.nuevoTercero = otra;
      }
      if (d.cuenta_sugerida) {
        const c = principales().find((x) => x.numero === d.cuenta_sugerida);
        if (c) st.principal = c.id;
      }
      if (d.forma === 'credito' && esFactura()) st.forma = 'credito';
      st.lectura = d;
      st.duplicada = null;
      pintarForm();
      if (avisoRol) toast(avisoRol, 'info');
      if (d.cufe && !editando) {
        db.rpc('cufe_existe', { p_empresa: id, p_cufe: d.cufe }).then((r) => {
          if (!r.error && r.data && st.lectura === d) { st.duplicada = r.data; pintarForm(); }
        });
      }
    }

    function bloqueLectura() {
      if (!st.lectura) return null;
      const d = st.lectura;
      const rolTercero = ['venta', 'cobro_cliente'].includes(st.tipo) ? 'cliente' : 'proveedor';
      return h('div', { class: 'aviso-lectura' },
        h('strong', null, 'Datos leídos de la factura. Revísalos antes de registrar.'),
        st.duplicada ? h('p', { class: 'error-texto' }, `Esta factura electrónica ya está registrada: ${st.duplicada}. No se puede registrar dos veces.`) : null,
        d.confianza !== 'alta' ? h('p', null, `Confianza de la lectura: ${d.confianza}.`) : null,
        d.observaciones ? h('p', null, d.observaciones) : null,
        st.nuevoTercero && !puedeTerceros ? h('p', { class: 'ayuda' }, `${st.nuevoTercero.nombre || 'Este contacto'} no está en la lista. Pídele al administrador que lo agregue, o registra sin contacto.`) : null,
        st.nuevoTercero && puedeTerceros ? h('div', null,
          h('p', null, `No encontré a ${st.nuevoTercero.nombre || 'este contacto'}${st.nuevoTercero.ruc ? ' (RUC ' + st.nuevoTercero.ruc + ')' : ''} entre tus clientes y proveedores.`),
          h('button', {
            class: 'btn btn-peq', type: 'button',
            onclick: () => abrirTercero(id, null, rolTercero, (fila) => {
              terceros.push(fila);
              st.tercero = fila.id;
              st.nuevoTercero = null;
              pintarForm();
            }, { razon_social: st.nuevoTercero.nombre, ruc: st.nuevoTercero.ruc, dv: st.nuevoTercero.dv, direccion: st.nuevoTercero.direccion })
          }, 'Crear con los datos de la factura')) : null,
        d.items && d.items.length ? h('p', { class: 'ayuda' }, `La factura tiene ${d.items.length} renglón(es) de detalle.`) : null);
    }

    const opcionesCuentas = (lista, vacio) => [
      h('option', { value: '' }, vacio),
      ...lista.map((c) => h('option', { value: c.id }, `${c.numero} · ${c.nombre}`))
    ];

    async function guardar(ev) {
      ev.preventDefault();
      const bruto = Number(st.bruto);
      if (!(bruto > 0)) { toast('Escribe un monto mayor que cero.', 'error'); return; }
      if (!st.principal) { toast('Elige la cuenta principal.', 'error'); return; }
      if (!esCredito() && !st.contra) { toast('Elige la cuenta de caja, banco o contrapartida.', 'error'); return; }
      if ((esCredito() || ['cobro_cliente', 'pago_proveedor'].includes(st.tipo)) && !st.tercero) {
        toast('Elige el cliente o proveedor.', 'error');
        return;
      }
      if (st.duplicada && !editando) { toast('Esta factura electrónica ya está registrada.', 'error'); return; }
      boton.disabled = true;
      const { data: nuevoId, error } = await db.rpc(editando ? 'editar_transaccion' : 'registrar_transaccion', {
        ...(editando ? { p_transaccion: editando.id } : { p_empresa: id }),
        p_tipo: st.tipo,
        p_fecha: st.fecha,
        p_tercero_id: st.tercero || null,
        p_numero_factura: texto(st.factura),
        p_descripcion: texto(st.descripcion),
        p_monto_bruto: bruto,
        p_itbms: itbmsValor(),
        p_cuenta_principal: st.principal,
        p_cuenta_contrapartida: esCredito() ? null : (st.contra || null),
        p_forma: esFactura() ? st.forma : 'contado',
        p_retencion: llevaRetencion() ? Math.max(0, Number(st.retencion) || 0) : 0
      });
      boton.disabled = false;
      if (error) { toast(traducirError(error), 'error'); return; }
      if (nuevoId && !auxDatos.falta && (st.auxP || st.auxC || editando)) {
        const fa = await db.rpc('fijar_auxiliares', { p_transaccion: nuevoId, p_aux_principal: st.auxP || null, p_aux_contra: st.auxC || null });
        if (fa.error) toast('Se registró, pero no se pudo guardar el auxiliar: ' + traducirError(fa.error), 'error');
      }
      if (!editando && st.lectura && st.lectura.cufe && nuevoId) {
        const c = await db.rpc('asignar_cufe', { p_transaccion: nuevoId, p_cufe: st.lectura.cufe });
        if (c.error) toast('Se registró, pero no se pudo guardar el código de la factura electrónica: ' + traducirError(c.error), 'error');
      }
      if (!editando && st.soporte && nuevoId) {
        try { await subirSoporte({ empresaId: id, transaccionId: nuevoId, archivo: st.soporte }); }
        catch (e) { toast('Se registró, pero no se pudo guardar el archivo adjunto: ' + traducirError(e), 'error'); }
      }
      toast(editando ? 'Cambios guardados.' : 'Transacción registrada con su asiento contable.', 'ok');
      cerrar();
      mes = st.fecha.slice(0, 7);
      await cargarMes();
    }

    let boton;
    function pintarForm() {
      const lp = principales();
      if (st.principal && !lp.some((c) => c.id === st.principal)) st.principal = '';
      const lc = contrapartidas();
      if (st.contra && !lc.some((c) => c.id === st.contra) && st.tipo !== 'otro') st.contra = '';
      const lt = tercerosVisibles();
      if (st.tercero && !lt.some((t) => t.id === st.tercero)) st.tercero = '';
      // El auxiliar debe ser de la cuenta que está elegida
      const cCon = cuentaContra();
      const auxOk = (idAux, cta) => !idAux || (cta && auxDatos.lista.some((a) => a.id === idAux && a.cuenta_id === cta.id));
      if (!auxOk(st.auxP, cuentaPorId[st.principal])) st.auxP = '';
      if (!auxOk(st.auxC, cCon)) st.auxC = '';

      const etqPrincipal = {
        venta: 'Cuenta de ingreso', compra_mercancia: 'Cuenta de inventario o compras',
        costo: 'Cuenta de costo', gasto: 'Cuenta de gasto',
        cobro_cliente: 'Cuenta por cobrar (clientes)', pago_proveedor: 'Cuenta por pagar (proveedores)',
        otro: 'Cuenta del DEBE'
      }[st.tipo];
      const etqContra = st.tipo === 'otro' ? 'Cuenta del HABER'
        : ['venta', 'cobro_cliente'].includes(st.tipo) ? 'Cuenta donde se cobra (caja o banco)'
        : 'Cuenta de donde se paga (caja o banco)';

      const tipoSel = h('select', {
        value: st.tipo,
        onchange: (e) => { st.tipo = e.target.value; porDefecto(); pintarForm(); }
      }, Object.entries(TIPOS_TRX).map(([v, n]) => h('option', { value: v }, n)));

      const brutoIn = h('input', {
        type: 'number', inputmode: 'decimal', step: '0.01', min: '0', required: true,
        value: st.bruto, placeholder: '0.00',
        oninput: (e) => { st.bruto = e.target.value; actualizarTotales(); }
      });

      itbmsEl = null;
      let bloqueItbms = null;
      if (llevaItbms()) {
        const modo = h('select', {
          value: st.modoItbms,
          onchange: (e) => { st.modoItbms = e.target.value; pintarForm(); }
        },
          h('option', { value: '7' }, 'Gravable 7%'),
          h('option', { value: '10' }, 'Gravable 10%'),
          h('option', { value: '15' }, 'Gravable 15%'),
          h('option', { value: '0' }, 'Exento'),
          h('option', { value: 'm' }, 'Monto manual'));
        itbmsEl = h('input', {
          type: 'number', inputmode: 'decimal', step: '0.01', min: '0',
          value: st.modoItbms === 'm' ? st.itbmsManual : itbmsValor().toFixed(2),
          readonly: st.modoItbms !== 'm',
          oninput: (e) => { st.itbmsManual = e.target.value; actualizarTotales(); }
        });
        bloqueItbms = h('div', { class: 'grupo' },
          h('h3', null, 'ITBMS'),
          campo('¿Se cobra o se paga ITBMS?', modo, 'Elige exento si la operación no lleva impuesto.'),
          campo('Monto del ITBMS', itbmsEl));
      } else if (esFactura()) {
        bloqueItbms = h('p', { class: 'ayuda' },
          'Esta empresa no es contribuyente del ITBMS: escribe el monto total de la factura.');
      }

      const etqRetencion = {
        venta: 'ITBMS que tu cliente te retuvo', compra_mercancia: 'ITBMS que tú retienes al proveedor',
        costo: 'ITBMS que tú retienes al proveedor', gasto: 'ITBMS que tú retienes al proveedor',
        cobro_cliente: 'ITBMS que el cliente te retuvo en este cobro', pago_proveedor: 'ITBMS que retienes en este pago'
      }[st.tipo];
      const bloqueRetencion = llevaRetencion() ? campo(etqRetencion + ' (opcional)',
        h('input', {
          type: 'number', inputmode: 'decimal', step: '0.01', min: '0', placeholder: '0.00', value: st.retencion,
          oninput: (e) => { st.retencion = e.target.value; }
        }),
        'Solo si hubo retención del impuesto. No puede pasar del ITBMS de la factura.') : null;

      totalEl = h('strong', null, '0.00');
      boton = h('button', { class: 'btn btn-bloque', type: 'submit' }, editando ? 'Guardar cambios' : 'Registrar');

      const formaSel = esFactura() ? h('select', {
        value: st.forma,
        onchange: (e) => { st.forma = e.target.value; pintarForm(); }
      }, h('option', { value: 'contado' }, 'Al contado'), h('option', { value: 'credito' }, 'A crédito')) : null;

      const terceroSel = st.tipo === 'otro' ? null : h('div', null,
        campo(['venta', 'cobro_cliente'].includes(st.tipo) ? 'Cliente' : 'Proveedor',
          h('select', { value: st.tercero, onchange: (e) => { st.tercero = e.target.value; } },
            h('option', { value: '' }, '(sin registrar)'),
            lt.map((t) => h('option', { value: t.id }, `${t.razon_social}${t.ruc ? ' · ' + t.ruc : ''}`)))),
        !puedeTerceros ? null : h('button', {
          class: 'enlace', type: 'button',
          onclick: () => abrirTercero(id, null, ['venta', 'cobro_cliente'].includes(st.tipo) ? 'cliente' : 'proveedor', (fila) => {
            terceros.push(fila);
            st.tercero = fila.id;
            pintarForm();
          })
        }, '+ Agregar cliente o proveedor'));

      cuerpo.replaceChildren(h('form', { onsubmit: guardar },
        campo('Tipo de transacción', tipoSel),
        esFactura() ? panelEscaneo({
          alArchivo: (a) => { if (!editando && /^(image\/|application\/pdf)/.test(a.type || '')) st.soporte = a; },
          obtenerContexto: () => ({
            rol: ['venta', 'cobro_cliente'].includes(st.tipo) ? 'cliente' : 'proveedor',
            contribuyente: !!empresa.contribuyente_itbms,
            cuentas: principales().filter((c) => c.acepta_movimientos !== false).slice(0, 150)
              .map((c) => `${c.numero} ${c.nombre}`)
          }),
          obtenerEmpresa: () => ({ ruc: empresa.ruc, dv: empresa.dv, razon_social: empresa.razon_social }),
          alLeer: aplicarLectura
        }) : null,
        bloqueLectura(),
        campo('Fecha', h('input', { type: 'date', required: true, value: st.fecha, onchange: (e) => { st.fecha = e.target.value; } })),
        terceroSel,
        esFactura() || st.tipo === 'cobro_cliente' || st.tipo === 'pago_proveedor'
          ? campo('Número de factura o documento', h('input', { type: 'text', value: st.factura, oninput: (e) => { st.factura = e.target.value; } }))
          : null,
        campo('Descripción breve', h('input', { type: 'text', value: st.descripcion, oninput: (e) => { st.descripcion = e.target.value; } })),
        campo(llevaItbms() ? 'Monto bruto (sin ITBMS)' : 'Monto', brutoIn),
        bloqueItbms,
        bloqueRetencion,
        h('p', { class: 'total-linea' }, 'Total: ', totalEl),
        formaSel ? campo('Forma de pago', formaSel) : null,
        campo(etqPrincipal, h('select', { value: st.principal, onchange: (e) => { st.principal = e.target.value; st.auxP = ''; pintarForm(); } },
          opcionesCuentas(lp, 'Elige una cuenta'))),
        campoAuxiliar({
          empresaId: id, rol: empresa.rol, etiqueta: 'Auxiliar de la cuenta principal', cuenta: cuentaPorId[st.principal],
          datos: auxDatos, valor: st.auxP, alCambiar: (v) => { st.auxP = v; }, redibujar: pintarForm
        }),
        esCredito()
          ? h('p', { class: 'ayuda' }, 'A crédito: se registra en clientes o proveedores automáticamente.')
          : campo(etqContra, h('select', { value: st.contra, onchange: (e) => { st.contra = e.target.value; st.auxC = ''; pintarForm(); } },
            opcionesCuentas(lc, 'Elige una cuenta'))),
        campoAuxiliar({
          empresaId: id, rol: empresa.rol,
          etiqueta: esCredito() ? (st.tipo === 'venta' ? 'Auxiliar de Clientes (a quién se le vende)' : 'Auxiliar de Proveedores (a quién se le compra)') : 'Auxiliar de la contrapartida',
          cuenta: cuentaContra(), datos: auxDatos, valor: st.auxC, alCambiar: (v) => { st.auxC = v; }, redibujar: pintarForm
        }),
        st.tipo === 'otro' ? null : h('label', { class: 'fila-check' },
          h('input', { type: 'checkbox', checked: st.todas, onchange: (e) => { st.todas = e.target.checked; pintarForm(); } }),
          h('span', null, 'Mostrar todas las cuentas del catálogo')),
        editando ? null : h('div', { class: 'grupo' },
          h('p', null, h('strong', null, 'Soporte de la factura (opcional)')),
          st.soporte
            ? h('p', { class: 'ayuda' }, `Se guardará con la transacción: ${st.soporte.name || 'archivo'}. `,
              h('button', { class: 'enlace', type: 'button', onclick: () => { st.soporte = null; pintarForm(); } }, 'Quitar'))
            : h('p', { class: 'ayuda' }, 'La foto o el PDF que leas con la IA se guardan solos. También puedes adjuntar uno ahora:'),
          h('input', {
            type: 'file', accept: 'image/*,application/pdf',
            onchange: (e) => { const a = e.target.files && e.target.files[0]; if (a) { st.soporte = a; pintarForm(); } }
          })),
        boton));
      actualizarTotales();
    }

    cerrar = modal(editando ? 'Editar transacción' : 'Nueva transacción', cuerpo);
    pintarForm();
  }

  selMes.addEventListener('change', async () => { if (selMes.value) { mes = selMes.value; await cargarMes(); } });
  const anterior = h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: () => { mes = moverMes(mes, -1); cargarMes(); } }, '‹');
  const siguiente = h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: () => { mes = moverMes(mes, 1); cargarMes(); } }, '›');

  const btnRec = h('button', {
    class: 'btn btn-sec btn-peq', type: 'button',
    onclick: () => abrirRecurrentes({ empresa, cuentas, terceros, clave, alCambiar: cargarMes, auxDatos })
  }, 'Movimientos recurrentes');
  const btnComent = h('button', {
    class: 'btn btn-sec btn-peq', type: 'button',
    onclick: () => abrirPendientes({
      empresa, alCambiar: cargarMes,
      abrirTransaccion: async (tid) => {
        let t = filas.find((x) => x.id === tid);
        if (!t) {
          const r = await db.from('transacciones').select('*').eq('id', tid).maybeSingle();
          if (r.error || !r.data) { toast('No se pudo abrir la transacción.', 'error'); return; }
          t = r.data;
        }
        detalle(t);
      }
    })
  }, 'Pendientes');
  const btnPend = h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: async () => {
    soloPendientes = !soloPendientes;
    btnPend.textContent = soloPendientes ? '‹ Volver al mes' : 'Ver ventas sin factura fiscal DGI';
    await cargarMes();
  } }, 'Ver ventas sin factura fiscal DGI');

  mostrar(marcoEmpresa(empresa, 'transacciones', [
    avisoRespaldo(empresa),
    soloRegistra ? h('p', { class: 'ayuda' }, 'Con tu perfil de auxiliar ves todas las transacciones y los totales del mes; solo puedes corregir las que tú registraste.') : null,
    h('div', { class: 'selector-mes' }, anterior, selMes, siguiente),
    resumen,
    h('div', { class: 'acciones' }, btnComent, btnPend, btnRec),
    lista,
    h('div', { class: 'acciones' },
      h('button', { class: 'btn', type: 'button', onclick: () => abrirNueva() }, '+ Nueva transacción'))
  ]));
  await cargarMes();
}
// FIN DEL ARCHIVO transacciones.js
