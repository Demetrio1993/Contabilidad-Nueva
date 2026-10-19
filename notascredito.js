// Notas de crédito ligadas a una factura: venta (la emites tú) o compra, costo o gasto (la recibes).
// Reducen el ingreso o el gasto, el ITBMS y lo que se cobra o se paga. Cada una se puede
// editar, anular y eliminar, adjuntar su soporte y, si es de una venta, marcar su nota fiscal de la DGI.
import { db, h, toast, modal, campo, texto, dinero, fechaCorta, hoy, traducirError } from './lib.js';
import { confirmar, pedirMotivo, barraAcciones, rpcOk } from './acciones.js';
import { panelSoportes } from './soportes.js';

const TIPOS_CON_NC = ['venta', 'compra_mercancia', 'costo', 'gasto'];

function formularioNota({ t, empresa, existente, alGuardar }) {
  const e = existente || {};
  const llevaItbms = !!empresa.contribuyente_itbms && Number(t.itbms) > 0;
  const tasa = llevaItbms ? Number(t.itbms) / Number(t.monto_bruto) : 0;
  const fecha = h('input', { type: 'date', required: true, min: t.fecha, value: e.fecha || hoy() });
  const numero = h('input', { type: 'text', value: e.numero || '', placeholder: t.tipo === 'venta' ? 'Número de la nota fiscal' : 'Número de la nota del proveedor' });
  const motivo = h('input', { type: 'text', value: e.motivo || '', placeholder: 'Ej.: devolución de mercancía' });
  const bruto = h('input', {
    type: 'number', step: '0.01', min: '0.01', inputmode: 'decimal', required: true,
    value: e.monto_bruto !== undefined ? String(e.monto_bruto) : '',
    oninput: () => { if (itbms && !itbms.dataset.manual) itbms.value = (Math.round(Number(bruto.value || 0) * tasa * 100) / 100).toFixed(2); }
  });
  const itbms = llevaItbms ? h('input', {
    type: 'number', step: '0.01', min: '0', inputmode: 'decimal',
    value: e.itbms !== undefined ? Number(e.itbms).toFixed(2) : '0.00',
    oninput: () => { itbms.dataset.manual = '1'; }
  }) : null;
  if (itbms && existente) itbms.dataset.manual = '1';
  let cerrar;
  async function guardar(ev) {
    ev.preventDefault();
    const m = Number(bruto.value);
    if (!(m > 0)) { toast('Escribe el monto de la nota.', 'error'); return; }
    try {
      const args = {
        p_fecha: fecha.value, p_numero: texto(numero.value), p_motivo: texto(motivo.value),
        p_monto_bruto: m, p_itbms: itbms ? Number(itbms.value || 0) : 0
      };
      if (existente) await rpcOk(db, 'editar_nota_credito', { p_nota: existente.id, ...args });
      else await rpcOk(db, 'crear_nota_credito', { p_transaccion: t.id, ...args });
      toast(existente ? 'Cambios guardados.' : 'Nota de crédito registrada con su asiento.', 'ok');
      cerrar();
      alGuardar();
    } catch (err) { toast(traducirError(err), 'error'); }
  }
  cerrar = modal(existente ? 'Editar nota de crédito' : 'Nueva nota de crédito', h('form', { onsubmit: guardar },
    h('p', { class: 'ayuda' }, `Factura ${t.numero_factura || ''} · ${fechaCorta(t.fecha)} · base ${dinero(t.monto_bruto)}${Number(t.itbms) > 0 ? ' + ITBMS ' + dinero(t.itbms) : ''}.`),
    campo('Fecha de la nota', fecha), campo('Número', numero), campo('Motivo', motivo),
    campo(llevaItbms ? 'Monto sin ITBMS' : 'Monto', bruto),
    itbms ? campo('ITBMS de la nota', itbms, 'Se calcula con la misma tasa de la factura; puedes cambiarlo.') : null,
    h('button', { class: 'btn btn-bloque', type: 'submit' }, 'Guardar')));
}

function formularioFiscalNota(n, alGuardar) {
  const num = h('input', { type: 'text', value: n.fiscal_numero || '', placeholder: 'Número de la nota de crédito fiscal' });
  const fec = h('input', { type: 'date', value: n.fiscal_fecha || hoy() });
  let cerrar;
  cerrar = modal('Nota de crédito fiscal de la DGI', h('div', null,
    h('p', { class: 'ayuda' }, 'Anota el número que te dio la DGI al emitir la nota de crédito.'),
    campo('Número', num), campo('Fecha de emisión', fec),
    h('button', {
      class: 'btn btn-bloque', type: 'button',
      onclick: async () => {
        try {
          await rpcOk(db, 'marcar_fiscal_nc', { p_nota: n.id, p_emitida: true, p_numero: num.value.trim() || null, p_fecha: fec.value || null });
          toast('Marcada.', 'ok'); cerrar(); alGuardar();
        } catch (err) { toast(traducirError(err), 'error'); }
      }
    }, 'Guardar')));
}

export function bloqueNotasCredito({ t, empresa, miId, puedeRegistrar, alCambiar }) {
  if (!TIPOS_CON_NC.includes(t.tipo) || t.anulada) return null;
  const caja = h('div', { class: 'bloque-fiscal' }, h('p', { class: 'ayuda' }, 'Cargando notas de crédito…'));
  const esAdmin = empresa.rol === 'admin' || empresa.rol === 'contador';
  const emitida = t.tipo === 'venta';

  async function cargar() {
    const r = await db.from('notas_credito').select('*').eq('transaccion_id', t.id).order('fecha').order('creado_en');
    if (r.error) { caja.replaceChildren(); return; }   // aún sin el archivo 64
    const lista = r.data || [];
    const vigentes = lista.filter((n) => !n.anulada);
    const acreditado = vigentes.reduce((a, n) => a + Number(n.monto_bruto), 0);
    caja.replaceChildren(
      h('p', null, h('strong', null, emitida ? 'Notas de crédito emitidas' : 'Notas de crédito recibidas'),
        vigentes.length ? ` · acreditado ${dinero(acreditado)} de ${dinero(t.monto_bruto)}` : ''),
      ...lista.map((n) => {
        const puedeCorregir = esAdmin || (puedeRegistrar && miId && n.creado_por === miId);
        return h('div', { class: 'tarjeta' + (n.anulada ? ' anulada' : '') },
          h('p', null, `${fechaCorta(n.fecha)} · ${n.numero ? 'N.º ' + n.numero + ' · ' : ''}${dinero(n.monto_neto)}${n.anulada ? ' · ANULADA' : ''}`),
          n.motivo ? h('p', { class: 'ayuda' }, n.motivo) : null,
          emitida && !n.anulada ? h('p', { class: 'ayuda' },
            n.fiscal_emitida ? `✔ Nota fiscal DGI${n.fiscal_numero ? ' N.º ' + n.fiscal_numero : ''}` : 'Falta la nota de crédito fiscal de la DGI') : null,
          emitida && !n.anulada && puedeRegistrar ? h('div', { class: 'acciones' },
            h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: () => formularioFiscalNota(n, alCambiar) },
              n.fiscal_emitida ? 'Cambiar número fiscal' : '✔ Ya la emití en la DGI'),
            n.fiscal_emitida ? h('button', {
              class: 'btn btn-sec btn-peq', type: 'button',
              onclick: async () => {
                try { await rpcOk(db, 'marcar_fiscal_nc', { p_nota: n.id, p_emitida: false, p_numero: null, p_fecha: null }); alCambiar(); }
                catch (err) { toast(traducirError(err), 'error'); }
              }
            }, 'Quitar marca') : null) : null,
          h('details', null, h('summary', null, 'Soporte'),
            panelSoportes({
              empresaId: empresa.id, notaId: n.id, puedeSubir: puedeRegistrar,
              puedeQuitar: (s) => esAdmin || (miId && s.creado_por === miId)
            })),
          !puedeCorregir ? null : barraAcciones({
            editar: n.anulada ? null : () => formularioNota({ t, empresa, existente: n, alGuardar: alCambiar }),
            anular: n.anulada ? null : () => pedirMotivo({
              titulo: 'Anular nota de crédito', mensaje: 'Se conserva la nota, pero deja de contar. Se crea un asiento contrario.',
              alConfirmar: async (motivo) => { await rpcOk(db, 'anular_nota_credito', { p_nota: n.id, p_motivo: motivo }); toast('Nota anulada.', 'ok'); alCambiar(); }
            }),
            eliminar: () => confirmar({
              titulo: 'Eliminar nota de crédito', mensaje: 'Se borra la nota y su asiento. Solo se puede si el mes está abierto.', boton: 'Eliminar',
              alConfirmar: async () => { await rpcOk(db, 'eliminar_nota_credito', { p_nota: n.id }); toast('Nota eliminada.', 'ok'); alCambiar(); }
            })
          }));
      }),
      puedeRegistrar ? h('div', { class: 'acciones' },
        h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: () => formularioNota({ t, empresa, alGuardar: alCambiar }) }, '+ Nota de crédito')) : null);
  }
  cargar();
  return caja;
}

// FIN DEL ARCHIVO notascredito.js
