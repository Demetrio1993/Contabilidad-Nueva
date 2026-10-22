// Movimientos recurrentes (alquiler, internet, cuotas…): se guardan una vez y cada mes la app
// avisa cuáles tocan; tú confirmas el monto y se registra la transacción con su asiento.
import { db, h, toast, modal, campo, texto, dinero, fechaCorta, hoy, traducirError } from './lib.js';
import { confirmar, barraAcciones, rpcOk } from './acciones.js';
import { campoAuxiliar } from './auxiliares.js';

const TIPOS = {
  venta: 'Venta', compra_mercancia: 'Compra de mercancía', costo: 'Costo', gasto: 'Gasto',
  cobro_cliente: 'Cobro a cliente', pago_proveedor: 'Pago a proveedor', otro: 'Otro movimiento'
};
const FACTURAS = ['venta', 'compra_mercancia', 'costo', 'gasto'];

export async function contarPendientes(empresaId) {
  const r = await db.from('recurrentes').select('id', { count: 'exact', head: true })
    .eq('empresa_id', empresaId).eq('activa', true).lte('proxima', hoy());
  return r.error ? 0 : (r.count || 0);
}

function formulario({ empresa, cuentas, terceros, clave, existente, alGuardar, auxDatos }) {
  const datosAux = auxDatos || { lista: [], falta: true };
  const e = existente || {};
  const st = {
    tipo: e.tipo || 'gasto', forma: e.forma || 'contado', principal: e.cuenta_principal_id || '',
    contra: e.cuenta_contrapartida_id || clave.caja || '', tercero: e.tercero_id || '',
    auxP: e.aux_principal_id || '', auxC: e.aux_contra_id || ''
  };
  const cuerpo = h('div');
  let cerrar;
  const nombre = h('input', { type: 'text', required: true, value: e.nombre || '', placeholder: 'Ej.: Alquiler del local' });
  const desc = h('input', { type: 'text', value: e.descripcion || '' });
  const monto = h('input', { type: 'number', step: '0.01', min: '0.01', inputmode: 'decimal', required: true, value: e.monto_bruto !== undefined ? String(e.monto_bruto) : '' });
  const itbms = h('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', value: e.itbms !== undefined ? Number(e.itbms).toFixed(2) : '0.00' });
  const ret = h('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', value: e.retencion !== undefined ? Number(e.retencion).toFixed(2) : '0.00' });
  const dia = h('input', { type: 'number', min: '1', max: '31', required: true, value: String(e.dia || 1) });
  const prox = h('input', { type: 'date', required: true, value: e.proxima || hoy() });

  const lista = () => {
    const f = {
      venta: (c) => c.tipo === 'ingreso', compra_mercancia: (c) => c.numero.startsWith('1.1.05.') || c.tipo === 'costo',
      costo: (c) => c.tipo === 'costo', gasto: (c) => c.tipo === 'gasto' || c.tipo === 'extraordinario',
      cobro_cliente: (c) => c.numero.startsWith('1.1.02.'), pago_proveedor: (c) => c.numero.startsWith('2.1.01.')
    }[st.tipo];
    return f ? cuentas.filter(f) : cuentas;
  };
  const opciones = (arr, vacio, sel) => [h('option', { value: '' }, vacio),
    ...arr.map((c) => h('option', { value: c.id, selected: c.id === sel }, `${c.numero} · ${c.nombre}`))];

  function pintar() {
    const esF = FACTURAS.includes(st.tipo);
    const quiere = ['venta', 'cobro_cliente'].includes(st.tipo) ? 'cliente' : 'proveedor';
    const ts = terceros.filter((t) => t.tipo === quiere || t.tipo === 'ambos');
    const credito = esF && st.forma === 'credito';
    cuerpo.replaceChildren(h('form', { onsubmit: guardar },
      campo('Nombre del movimiento', nombre),
      campo('Tipo', h('select', { onchange: (ev) => { st.tipo = ev.target.value; st.principal = ''; pintar(); } },
        Object.entries(TIPOS).map(([k, v]) => h('option', { value: k, selected: k === st.tipo }, v)))),
      st.tipo === 'otro' ? null : campo(quiere === 'cliente' ? 'Cliente' : 'Proveedor',
        h('select', { onchange: (ev) => { st.tercero = ev.target.value; } },
          h('option', { value: '' }, '(sin registrar)'),
          ts.map((t) => h('option', { value: t.id, selected: t.id === st.tercero }, t.razon_social)))),
      campo('Descripción', desc),
      campo(empresa.contribuyente_itbms && esF ? 'Monto sin ITBMS' : 'Monto', monto),
      empresa.contribuyente_itbms && esF ? campo('ITBMS', itbms, 'Monto fijo en balboas; 0 si es exento.') : null,
      empresa.contribuyente_itbms && st.tipo !== 'otro' && !credito
        ? campo('ITBMS retenido', ret, 'Solo si hay retención del impuesto en cada operación.') : null,
      esF ? campo('Forma de pago', h('select', { onchange: (ev) => { st.forma = ev.target.value; pintar(); } },
        h('option', { value: 'contado', selected: st.forma === 'contado' }, 'Al contado'),
        h('option', { value: 'credito', selected: st.forma === 'credito' }, 'A crédito'))) : null,
      campo('Cuenta principal', h('select', { required: true, onchange: (ev) => { st.principal = ev.target.value; st.auxP = ''; pintar(); } }, opciones(lista(), 'Elige una cuenta', st.principal))),
      campoAuxiliar({
        empresaId: empresa.id, rol: empresa.rol, etiqueta: 'Auxiliar de la cuenta principal', cuenta: cuentas.find((c) => c.id === st.principal),
        datos: datosAux, valor: st.auxP, alCambiar: (v) => { st.auxP = v; }, redibujar: pintar
      }),
      credito ? null : campo('Cuenta de caja, banco o contrapartida', h('select', { required: true, onchange: (ev) => { st.contra = ev.target.value; st.auxC = ''; pintar(); } }, opciones(cuentas, 'Elige una cuenta', st.contra))),
      campoAuxiliar({
        empresaId: empresa.id, rol: empresa.rol,
        etiqueta: credito ? (st.tipo === 'venta' ? 'Auxiliar de Clientes' : 'Auxiliar de Proveedores') : 'Auxiliar de la contrapartida',
        cuenta: cuentas.find((c) => c.id === (credito ? (st.tipo === 'venta' ? clave.cxc : clave.cxp) : st.contra)),
        datos: datosAux, valor: st.auxC, alCambiar: (v) => { st.auxC = v; }, redibujar: pintar
      }),
      campo('Día del mes en que se repite', dia),
      campo('Próxima fecha', prox),
      h('button', { class: 'btn btn-bloque', type: 'submit' }, 'Guardar')));
  }

  async function guardar(ev) {
    ev.preventDefault();
    const esF = FACTURAS.includes(st.tipo);
    const credito = esF && st.forma === 'credito';
    if (!st.principal) { toast('Elige la cuenta principal.', 'error'); return; }
    if (!credito && !st.contra) { toast('Elige la cuenta de caja, banco o contrapartida.', 'error'); return; }
    try {
      const idRec = await rpcOk(db, 'guardar_recurrente', {
        p_id: existente ? existente.id : null, p_empresa: empresa.id, p_nombre: nombre.value.trim(), p_tipo: st.tipo,
        p_tercero: st.tipo === 'otro' ? null : (st.tercero || null), p_descripcion: texto(desc.value),
        p_monto: Number(monto.value), p_itbms: empresa.contribuyente_itbms && esF ? Number(itbms.value || 0) : 0,
        p_retencion: empresa.contribuyente_itbms && st.tipo !== 'otro' && !credito ? Number(ret.value || 0) : 0,
        p_forma: esF ? st.forma : 'contado', p_cuenta_principal: st.principal,
        p_cuenta_contrapartida: credito ? null : (st.contra || null), p_dia: Number(dia.value), p_proxima: prox.value
      });
      if (!datosAux.falta && (st.auxP || st.auxC || existente)) {
        const fa = await db.rpc('fijar_auxiliares_recurrente', { p_id: idRec, p_aux_principal: st.auxP || null, p_aux_contra: st.auxC || null });
        if (fa.error) toast('Se guardó, pero no se pudo guardar el auxiliar: ' + traducirError(fa.error), 'error');
      }
      toast('Movimiento recurrente guardado.', 'ok');
      cerrar();
      alGuardar();
    } catch (err) { toast(traducirError(err), 'error'); }
  }
  pintar();
  cerrar = modal(existente ? 'Editar movimiento recurrente' : 'Nuevo movimiento recurrente', cuerpo);
}

function registrarAhora(r, empresa, alRegistrar) {
  const fecha = h('input', { type: 'date', required: true, value: r.proxima });
  const numero = h('input', { type: 'text', placeholder: 'Opcional' });
  const monto = h('input', { type: 'number', step: '0.01', min: '0.01', inputmode: 'decimal', required: true, value: String(r.monto_bruto) });
  const itbms = Number(r.itbms) > 0 || empresa.contribuyente_itbms
    ? h('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', value: Number(r.itbms).toFixed(2) }) : null;
  let cerrar;
  cerrar = modal(`Registrar: ${r.nombre}`, h('form', {
    onsubmit: async (ev) => {
      ev.preventDefault();
      try {
        const cambioMonto = Number(monto.value) !== Number(r.monto_bruto);
        await rpcOk(db, 'registrar_recurrente', {
          p_id: r.id, p_fecha: fecha.value, p_numero: texto(numero.value),
          p_monto: cambioMonto ? Number(monto.value) : null,
          p_itbms: itbms && (cambioMonto || Number(itbms.value) !== Number(r.itbms)) ? Number(itbms.value || 0) : null
        });
        toast('Transacción registrada con su asiento.', 'ok');
        cerrar();
        alRegistrar();
      } catch (err) { toast(traducirError(err), 'error'); }
    }
  },
  h('p', { class: 'ayuda' }, 'Confirma la fecha y el monto de este mes. Si cambias el monto, el ITBMS se ajusta en proporción salvo que lo escribas tú.'),
  campo('Fecha', fecha), campo('Número de factura o documento', numero), campo('Monto', monto),
  itbms ? campo('ITBMS', itbms) : null,
  h('button', { class: 'btn btn-bloque', type: 'submit' }, 'Registrar')));
}

export function abrirRecurrentes({ empresa, cuentas, terceros, clave, alCambiar, auxDatos }) {
  const cuerpo = h('div', null, h('p', { class: 'ayuda' }, 'Cargando…'));
  let cerrar;
  const refrescar = () => { cargar(); alCambiar && alCambiar(); };

  async function cargar() {
    const r = await db.from('recurrentes').select('*').eq('empresa_id', empresa.id).order('proxima');
    if (r.error) { cuerpo.replaceChildren(h('p', { class: 'ayuda' }, 'Falta ejecutar el archivo 66 en Supabase.')); return; }
    const lista = r.data || [];
    const hoyISO = hoy();
    cuerpo.replaceChildren(
      h('p', { class: 'ayuda' }, 'Guarda lo que se repite cada mes. Cuando llegue la fecha te aparece aquí para confirmarlo; nada se registra solo.'),
      !lista.length ? h('p', { class: 'ayuda' }, 'Todavía no hay movimientos recurrentes.') : null,
      ...lista.map((x) => {
        const toca = x.activa && x.proxima <= hoyISO;
        return h('div', { class: 'tarjeta' },
          h('p', null, h('strong', null, x.nombre), h('br'),
            h('span', { class: 'ayuda' }, `${TIPOS[x.tipo]} · ${dinero(Number(x.monto_bruto) + Number(x.itbms))}`)),
          h('p', null, !x.activa ? h('span', { class: 'insignia gris' }, 'En pausa')
            : toca ? h('span', { class: 'insignia aviso' }, `⏰ Toca registrar (${fechaCorta(x.proxima)})`)
              : h('span', { class: 'insignia gris' }, `Próxima: ${fechaCorta(x.proxima)}`)),
          h('div', { class: 'acciones' },
            x.activa ? h('button', { class: 'btn btn-peq', type: 'button', onclick: () => registrarAhora(x, empresa, refrescar) }, 'Registrar') : null,
            x.activa ? h('button', {
              class: 'btn btn-sec btn-peq', type: 'button',
              onclick: () => confirmar({
                titulo: 'Saltar este mes', mensaje: 'Pasa a la fecha del mes siguiente sin registrar nada.', boton: 'Saltar', peligro: false,
                alConfirmar: async () => { await rpcOk(db, 'saltar_recurrente', { p_id: x.id }); refrescar(); }
              })
            }, 'Saltar') : null,
            h('button', {
              class: 'btn btn-sec btn-peq', type: 'button',
              onclick: async () => { try { await rpcOk(db, 'pausar_recurrente', { p_id: x.id, p_activa: !x.activa }); refrescar(); } catch (err) { toast(traducirError(err), 'error'); } }
            }, x.activa ? 'Pausar' : 'Reanudar')),
          barraAcciones({
            editar: () => formulario({ empresa, cuentas, terceros, clave, existente: x, alGuardar: refrescar, auxDatos }),
            eliminar: () => confirmar({
              titulo: 'Eliminar movimiento recurrente', mensaje: 'Se borra solo la plantilla; lo ya registrado no cambia.', boton: 'Eliminar',
              alConfirmar: async () => { await rpcOk(db, 'eliminar_recurrente', { p_id: x.id }); toast('Eliminado.', 'ok'); refrescar(); }
            })
          }));
      }),
      h('div', { class: 'acciones' },
        h('button', { class: 'btn', type: 'button', onclick: () => formulario({ empresa, cuentas, terceros, clave, alGuardar: refrescar, auxDatos }) }, '+ Nuevo movimiento recurrente')));
  }
  cerrar = modal('Movimientos recurrentes', cuerpo);
  cargar();
  return cerrar;
}

// FIN DEL ARCHIVO recurrentes.js
