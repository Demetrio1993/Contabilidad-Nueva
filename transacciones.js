// Libro de transacciones: ventas, compras, costos, gastos, cobros, pagos y otros
import { db, h, mostrar, toast, modal, campo, texto, dinero, fechaCorta, traducirError, cargando, marco, marcoEmpresa, cargarEmpresa } from './lib.js';
import { abrirTercero } from './terceros.js';

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
  const [empresa, rc, rk, rt] = await Promise.all([
    cargarEmpresa(id),
    db.from('cuentas').select('id, numero, nombre, tipo, nivel, acepta_movimientos, activa')
      .eq('empresa_id', id).eq('acepta_movimientos', true).eq('activa', true)
      .order('numero').range(0, 4999),
    db.from('empresa_cuentas_clave').select('clave, cuenta_id').eq('empresa_id', id),
    db.from('terceros').select('id, razon_social, ruc, dv, tipo, activo')
      .eq('empresa_id', id).eq('activo', true).order('razon_social').range(0, 4999)
  ]);
  for (const r of [rc, rk, rt]) if (r.error) throw r.error;
  const cuentas = rc.data;
  const nombreCuenta = Object.fromEntries(cuentas.map((c) => [c.id, `${c.numero} · ${c.nombre}`]));
  const clave = Object.fromEntries(rk.data.map((k) => [k.clave, k.cuenta_id]));
  const terceros = rt.data;

  let mes = mesActual();
  let filas = [];
  const resumen = h('div', { class: 'resumen' });
  const lista = h('div', { class: 'lista-cuentas' });
  const selMes = h('input', { type: 'month', value: mes, required: true });

  async function cargarMes() {
    const [d, s] = rangoMes(mes);
    const r = await db.from('transacciones')
      .select('id, tipo, fecha, nombre_tercero, ruc, dv, numero_factura, descripcion, monto_bruto, itbms, monto_neto, forma, cuenta_principal_id, cuenta_contrapartida_id')
      .eq('empresa_id', id).gte('fecha', d).lt('fecha', s)
      .order('fecha').order('creado_en');
    if (r.error) { toast(traducirError(r.error), 'error'); return; }
    filas = r.data;
    selMes.value = mes;
    pintar();
  }

  function pintar() {
    const suma = (tipos, campoN) => filas.filter((t) => tipos.includes(t.tipo))
      .reduce((s, t) => s + Number(t[campoN]), 0);
    const chip = (titulo, valor) => h('div', { class: 'chip' }, h('span', { class: 'ayuda' }, titulo), h('strong', null, dinero(valor)));
    resumen.replaceChildren(
      chip('Ventas', suma(['venta'], 'monto_bruto')),
      empresa.contribuyente_itbms ? chip('ITBMS cobrado', suma(['venta'], 'itbms')) : null,
      chip('Compras y gastos', suma(COMPRAS, 'monto_bruto')),
      empresa.contribuyente_itbms ? chip('ITBMS pagado', suma(COMPRAS, 'itbms')) : null,
      chip('Cobros', suma(['cobro_cliente'], 'monto_neto')),
      chip('Pagos', suma(['pago_proveedor'], 'monto_neto')));
    if (filas.length === 0) {
      lista.replaceChildren(h('p', { class: 'cargando' }, 'No hay transacciones en este mes.'));
      return;
    }
    lista.replaceChildren(...filas.map((t) => h('button', { class: 'trx', type: 'button', onclick: () => detalle(t) },
      h('div', { class: 'trx-linea' },
        h('span', { class: 'insignia' }, TIPOS_TRX[t.tipo]),
        h('span', { class: 'ayuda' }, fechaCorta(t.fecha)),
        t.forma === 'credito' ? h('span', { class: 'insignia aviso' }, 'A crédito') : null),
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
    async function eliminar() {
      if (!confirm('¿Eliminar esta transacción y su asiento contable? Solo se puede si el mes está abierto.')) return;
      const { error } = await db.rpc('eliminar_transaccion', { p_transaccion: t.id });
      if (error) { toast(traducirError(error), 'error'); return; }
      toast('Transacción eliminada.', 'ok');
      cerrar();
      await cargarMes();
    }
    const dato = (etq, val) => val ? h('p', null, h('strong', null, etq + ': '), val) : null;
    cerrar = modal(TIPOS_TRX[t.tipo], h('div', null,
      dato('Fecha', fechaCorta(t.fecha)),
      dato('Cliente o proveedor', t.nombre_tercero),
      dato('RUC', t.ruc ? `${t.ruc}${t.dv ? ' DV ' + t.dv : ''}` : null),
      dato('Factura', t.numero_factura),
      dato('Descripción', t.descripcion),
      dato('Monto bruto', dinero(t.monto_bruto)),
      Number(t.itbms) > 0 ? dato('ITBMS', dinero(t.itbms)) : null,
      dato('Total', dinero(t.monto_neto)),
      dato('Forma de pago', t.forma === 'credito' ? 'A crédito' : 'Al contado'),
      dato('Cuenta principal', nombreCuenta[t.cuenta_principal_id]),
      dato('Contrapartida', nombreCuenta[t.cuenta_contrapartida_id]),
      h('p', { class: 'ayuda' }, 'Para corregirla, elimínala y regístrala de nuevo.'),
      h('button', { class: 'btn btn-peligro btn-bloque', type: 'button', onclick: eliminar }, 'Eliminar transacción')));
  }

  function abrirNueva() {
    const st = {
      tipo: 'gasto', fecha: hoyISO(), tercero: '', factura: '', descripcion: '', bruto: '',
      modoItbms: '7', itbmsManual: '', forma: 'contado', principal: '', contra: '', todas: false
    };
    const cuerpo = h('div');
    let cerrar;
    let totalEl; let itbmsEl;

    const esFactura = () => FACTURAS.includes(st.tipo);
    const llevaItbms = () => !!empresa.contribuyente_itbms && esFactura();
    const esCredito = () => esFactura() && st.forma === 'credito';

    function porDefecto() {
      st.forma = 'contado';
      st.tercero = '';
      st.principal = '';
      st.contra = clave.caja || '';
      st.modoItbms = '7';
      if (st.tipo === 'compra_mercancia') st.principal = clave.inventario || '';
      if (st.tipo === 'cobro_cliente') st.principal = clave.cxc || '';
      if (st.tipo === 'pago_proveedor') st.principal = clave.cxp || '';
      if (st.tipo === 'otro') st.contra = '';
    }
    porDefecto();

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
      boton.disabled = true;
      const { error } = await db.rpc('registrar_transaccion', {
        p_empresa: id,
        p_tipo: st.tipo,
        p_fecha: st.fecha,
        p_tercero_id: st.tercero || null,
        p_numero_factura: texto(st.factura),
        p_descripcion: texto(st.descripcion),
        p_monto_bruto: bruto,
        p_itbms: itbmsValor(),
        p_cuenta_principal: st.principal,
        p_cuenta_contrapartida: esCredito() ? null : (st.contra || null),
        p_forma: esFactura() ? st.forma : 'contado'
      });
      boton.disabled = false;
      if (error) { toast(traducirError(error), 'error'); return; }
      toast('Transacción registrada con su asiento contable.', 'ok');
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

      totalEl = h('strong', null, '0.00');
      boton = h('button', { class: 'btn btn-bloque', type: 'submit' }, 'Registrar');

      const formaSel = esFactura() ? h('select', {
        value: st.forma,
        onchange: (e) => { st.forma = e.target.value; pintarForm(); }
      }, h('option', { value: 'contado' }, 'Al contado'), h('option', { value: 'credito' }, 'A crédito')) : null;

      const terceroSel = st.tipo === 'otro' ? null : h('div', null,
        campo(['venta', 'cobro_cliente'].includes(st.tipo) ? 'Cliente' : 'Proveedor',
          h('select', { value: st.tercero, onchange: (e) => { st.tercero = e.target.value; } },
            h('option', { value: '' }, '(sin registrar)'),
            lt.map((t) => h('option', { value: t.id }, `${t.razon_social}${t.ruc ? ' · ' + t.ruc : ''}`)))),
        h('button', {
          class: 'enlace', type: 'button',
          onclick: () => abrirTercero(id, null, ['venta', 'cobro_cliente'].includes(st.tipo) ? 'cliente' : 'proveedor', (fila) => {
            terceros.push(fila);
            st.tercero = fila.id;
            pintarForm();
          })
        }, '+ Agregar cliente o proveedor'));

      cuerpo.replaceChildren(h('form', { onsubmit: guardar },
        campo('Tipo de transacción', tipoSel),
        campo('Fecha', h('input', { type: 'date', required: true, value: st.fecha, onchange: (e) => { st.fecha = e.target.value; } })),
        terceroSel,
        esFactura() || st.tipo === 'cobro_cliente' || st.tipo === 'pago_proveedor'
          ? campo('Número de factura o documento', h('input', { type: 'text', value: st.factura, oninput: (e) => { st.factura = e.target.value; } }))
          : null,
        campo('Descripción breve', h('input', { type: 'text', value: st.descripcion, oninput: (e) => { st.descripcion = e.target.value; } })),
        campo(llevaItbms() ? 'Monto bruto (sin ITBMS)' : 'Monto', brutoIn),
        bloqueItbms,
        h('p', { class: 'total-linea' }, 'Total: B/. ', totalEl),
        formaSel ? campo('Forma de pago', formaSel) : null,
        campo(etqPrincipal, h('select', { value: st.principal, onchange: (e) => { st.principal = e.target.value; } },
          opcionesCuentas(lp, 'Elige una cuenta'))),
        esCredito()
          ? h('p', { class: 'ayuda' }, 'A crédito: se registra en clientes o proveedores automáticamente.')
          : campo(etqContra, h('select', { value: st.contra, onchange: (e) => { st.contra = e.target.value; } },
            opcionesCuentas(lc, 'Elige una cuenta'))),
        st.tipo === 'otro' ? null : h('label', { class: 'fila-check' },
          h('input', { type: 'checkbox', checked: st.todas, onchange: (e) => { st.todas = e.target.checked; pintarForm(); } }),
          h('span', null, 'Mostrar todas las cuentas del catálogo')),
        boton));
      actualizarTotales();
    }

    cerrar = modal('Nueva transacción', cuerpo);
    pintarForm();
  }

  selMes.addEventListener('change', async () => { if (selMes.value) { mes = selMes.value; await cargarMes(); } });
  const anterior = h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: () => { mes = moverMes(mes, -1); cargarMes(); } }, '‹');
  const siguiente = h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: () => { mes = moverMes(mes, 1); cargarMes(); } }, '›');

  mostrar(marcoEmpresa(empresa, 'transacciones', [
    h('div', { class: 'selector-mes' }, anterior, selMes, siguiente),
    resumen,
    lista,
    h('div', { class: 'acciones' },
      h('button', { class: 'btn', type: 'button', onclick: abrirNueva }, '+ Nueva transacción'))
  ]));
  await cargarMes();
}
