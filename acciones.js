// Botones y ventanas comunes para corregir registros: Editar, Anular y Eliminar.
import { h, modal, campo, toast, traducirError } from './lib.js';

// Pide confirmación. alConfirmar puede ser async; si lanza error se muestra.
export function confirmar({ titulo, mensaje, boton = 'Confirmar', peligro = true, alConfirmar }) {
  let cerrar;
  const ok = h('button', {
    class: 'btn btn-bloque' + (peligro ? ' btn-peligro' : ''), type: 'button',
    onclick: async () => {
      ok.disabled = true;
      try {
        await alConfirmar();
        cerrar();
      } catch (e) {
        ok.disabled = false;
        toast(traducirError(e), 'error');
      }
    }
  }, boton);
  cerrar = modal(titulo, h('div', null,
    h('p', null, mensaje),
    ok,
    h('button', { class: 'btn btn-sec btn-bloque', type: 'button', onclick: () => cerrar() }, 'Cancelar')));
}

// Igual que confirmar, pero pide un motivo (opcional) que recibe alConfirmar(motivo)
export function pedirMotivo({ titulo, mensaje, boton = 'Anular', alConfirmar }) {
  let cerrar;
  const motivo = h('input', { type: 'text', placeholder: 'Ej.: factura repetida' });
  const ok = h('button', {
    class: 'btn btn-bloque btn-peligro', type: 'button',
    onclick: async () => {
      ok.disabled = true;
      try {
        await alConfirmar(motivo.value.trim() || null);
        cerrar();
      } catch (e) {
        ok.disabled = false;
        toast(traducirError(e), 'error');
      }
    }
  }, boton);
  cerrar = modal(titulo, h('div', null,
    h('p', null, mensaje),
    campo('Motivo (opcional)', motivo),
    ok,
    h('button', { class: 'btn btn-sec btn-bloque', type: 'button', onclick: () => cerrar() }, 'Cancelar')));
}

// Fila de botones. Solo se muestran los que reciben una función.
export function barraAcciones({ editar, anular, eliminar, extra }) {
  return h('div', { class: 'acciones barra-correccion' },
    editar ? h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: editar }, 'Editar') : null,
    anular ? h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: anular }, 'Anular') : null,
    eliminar ? h('button', { class: 'btn btn-sec btn-peq btn-peligro-borde', type: 'button', onclick: eliminar }, 'Eliminar') : null,
    extra || null);
}

// Llama a una función de la base de datos y lanza el error si falla
export async function rpcOk(db, nombre, args) {
  const r = await db.rpc(nombre, args);
  if (r.error) throw r.error;
  return r.data;
}

// FIN DEL ARCHIVO acciones.js
