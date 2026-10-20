// Comentarios y pendientes por transacción.
// Cualquier comentario puede marcarse como "pendiente" (algo que falta: la factura, un dato, una aclaración)
// y se cierra cuando alguien lo resuelve. Administrador, contador y auxiliar escriben; el lector solo ve.
import { db, h, modal, toast, texto, dinero, fechaCorta, traducirError } from './lib.js';
import { confirmar, rpcOk } from './acciones.js';

const MENSAJE_FALTA = 'Falta ejecutar el archivo 70 en Supabase para usar comentarios y pendientes.';

function fechaHora(f) {
  if (!f) return '';
  const d = new Date(f);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('es-PA', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
    d.toLocaleTimeString('es-PA', { hour: '2-digit', minute: '2-digit' });
}

// Cuenta los pendientes abiertos de una lista de transacciones: { transaccion_id: cantidad }.
// Devuelve null si la tabla aún no existe (no se ejecutó el archivo 70).
export async function pendientesAbiertos(empresaId, ids) {
  if (!ids || !ids.length) return {};
  const r = await db.from('comentarios_transaccion').select('transaccion_id')
    .eq('empresa_id', empresaId).eq('pendiente', true).eq('resuelto', false).in('transaccion_id', ids);
  if (r.error) return null;
  const mapa = {};
  for (const c of r.data || []) mapa[c.transaccion_id] = (mapa[c.transaccion_id] || 0) + 1;
  return mapa;
}

export async function contarPendientesEmpresa(empresaId) {
  const r = await db.from('comentarios_transaccion').select('id', { count: 'exact', head: true })
    .eq('empresa_id', empresaId).eq('pendiente', true).eq('resuelto', false);
  return r.error ? null : (r.count || 0);
}

// Panel que va dentro del detalle de una transacción
export function panelComentarios({ empresaId, transaccionId, rol, miId, alCambiar }) {
  const puedeEscribir = ['administrador', 'contador', 'auxiliar'].includes(rol);
  const puedeBorrarTodo = ['administrador', 'contador'].includes(rol);
  const caja = h('div', { class: 'bloque-fiscal' });
  const lista = h('div');
  let aviso = null;

  async function cargar() {
    const r = await db.from('comentarios_transaccion')
      .select('id, texto, pendiente, resuelto, resuelto_correo, resuelto_en, creado_por, autor_correo, creado_en')
      .eq('transaccion_id', transaccionId).order('creado_en', { ascending: true });
    if (r.error) { aviso = MENSAJE_FALTA; pintar([]); return; }
    aviso = null;
    pintar(r.data || []);
  }

  async function cambiar() { await cargar(); if (alCambiar) alCambiar(); }

  function pintar(filas) {
    lista.replaceChildren(...filas.map((c) => {
      const mio = miId && c.creado_por === miId;
      const puedeBorrar = puedeBorrarTodo || (puedeEscribir && mio);
      return h('div', { class: 'comentario' + (c.pendiente && !c.resuelto ? ' abierto' : '') },
        h('div', { class: 'trx-linea' },
          c.pendiente
            ? h('span', { class: 'insignia ' + (c.resuelto ? '' : 'aviso') }, c.resuelto ? '✔ Resuelto' : 'Pendiente')
            : h('span', { class: 'insignia gris' }, 'Comentario'),
          h('span', { class: 'ayuda' }, `${c.autor_correo || 'Alguien'} · ${fechaHora(c.creado_en)}`)),
        h('p', { class: 'comentario-texto' }, c.texto),
        c.pendiente && c.resuelto
          ? h('p', { class: 'ayuda' }, `Resuelto por ${c.resuelto_correo || '—'} · ${fechaHora(c.resuelto_en)}`) : null,
        (puedeEscribir && c.pendiente) || puedeBorrar
          ? h('div', { class: 'acciones' },
            puedeEscribir && c.pendiente
              ? h('button', {
                class: 'btn btn-sec btn-peq', type: 'button',
                onclick: async (e) => {
                  e.target.disabled = true;
                  try { await rpcOk(db, 'resolver_comentario', { p_id: c.id, p_resuelto: !c.resuelto }); await cambiar(); }
                  catch (er) { e.target.disabled = false; toast(traducirError(er), 'error'); }
                }
              }, c.resuelto ? 'Reabrir' : 'Marcar como resuelto') : null,
            puedeBorrar
              ? h('button', {
                class: 'btn btn-sec btn-peq btn-peligro-borde', type: 'button',
                onclick: () => confirmar({
                  titulo: 'Borrar comentario', mensaje: '¿Borrar este comentario?', boton: 'Borrar',
                  alConfirmar: async () => { await rpcOk(db, 'eliminar_comentario', { p_id: c.id }); await cambiar(); }
                })
              }, 'Borrar') : null)
          : null);
    }));
    const vacio = !filas.length && !aviso ? h('p', { class: 'ayuda' }, 'Sin comentarios todavía.') : null;
    caja.replaceChildren(
      h('strong', null, 'Comentarios y pendientes'),
      aviso ? h('p', { class: 'ayuda' }, aviso) : null,
      vacio, lista,
      puedeEscribir && !aviso ? formulario() : null);
  }

  function formulario() {
    const area = h('textarea', { rows: 2, maxlength: 1000, placeholder: 'Ej.: falta la factura del proveedor' });
    const marca = h('input', { type: 'checkbox' });
    const ok = h('button', {
      class: 'btn btn-peq', type: 'button',
      onclick: async () => {
        const t = texto(area.value);
        if (!t) { toast('Escribe el comentario.', 'error'); return; }
        ok.disabled = true;
        try {
          await rpcOk(db, 'agregar_comentario', { p_transaccion: transaccionId, p_texto: t, p_pendiente: marca.checked });
          await cambiar();
        } catch (e) { ok.disabled = false; toast(traducirError(e), 'error'); }
      }
    }, 'Agregar');
    return h('div', { class: 'form-comentario' },
      area,
      h('label', { class: 'check' }, marca, ' Dejarlo como pendiente'),
      ok);
  }

  cargar();
  return caja;
}

// Ventana con todos los pendientes de la empresa
export async function abrirPendientes({ empresa, abrirTransaccion, alCambiar }) {
  const puedeResolver = ['administrador', 'contador', 'auxiliar'].includes(empresa.rol);
  const cuerpo = h('div', null, h('p', { class: 'cargando' }, 'Cargando…'));
  let verResueltos = false;
  const cerrar = modal('Pendientes', cuerpo);

  async function pintar() {
    const r = await db.rpc('pendientes_empresa', { p_empresa: empresa.id, p_incluir_resueltos: verResueltos });
    if (r.error) { cuerpo.replaceChildren(h('p', { class: 'ayuda' }, MENSAJE_FALTA)); return; }
    const filas = r.data || [];
    const check = h('input', { type: 'checkbox', checked: verResueltos, onchange: (e) => { verResueltos = e.target.checked; pintar(); } });
    cuerpo.replaceChildren(
      h('label', { class: 'check' }, check, ' Mostrar también los resueltos'),
      filas.length ? null : h('p', { class: 'ayuda' }, verResueltos ? 'No hay pendientes.' : 'No hay pendientes abiertos.'),
      ...filas.map((p) => h('div', { class: 'comentario' + (p.resuelto ? '' : ' abierto') },
        h('div', { class: 'trx-linea' },
          h('span', { class: 'insignia' + (p.resuelto ? '' : ' aviso') }, p.resuelto ? '✔ Resuelto' : 'Pendiente'),
          h('span', { class: 'ayuda' }, fechaCorta(p.fecha)),
          h('strong', null, dinero(p.monto_bruto))),
        h('div', { class: 'trx-nom' }, (p.nombre_tercero || '—') + (p.numero_factura ? ` · Fact. ${p.numero_factura}` : '')),
        h('p', { class: 'comentario-texto' }, p.texto),
        h('p', { class: 'ayuda' }, `${p.autor_correo || ''} · ${fechaHora(p.creado_en)}`),
        h('div', { class: 'acciones' },
          abrirTransaccion
            ? h('button', {
              class: 'btn btn-sec btn-peq', type: 'button',
              onclick: () => { cerrar(); abrirTransaccion(p.transaccion_id); }
            }, 'Abrir la transacción') : null,
          puedeResolver
            ? h('button', {
              class: 'btn btn-sec btn-peq', type: 'button',
              onclick: async (e) => {
                e.target.disabled = true;
                try {
                  await rpcOk(db, 'resolver_comentario', { p_id: p.id, p_resuelto: !p.resuelto });
                  await pintar(); if (alCambiar) alCambiar();
                } catch (er) { e.target.disabled = false; toast(traducirError(er), 'error'); }
              }
            }, p.resuelto ? 'Reabrir' : 'Marcar como resuelto') : null))));
  }
  await pintar();
}

// FIN DEL ARCHIVO comentarios.js
