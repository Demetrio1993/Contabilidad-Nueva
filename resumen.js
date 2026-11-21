// Datos de cada empresa: resumen semanal por correo.
// El correo sale solo los lunes a las 7:00 a. m. (hora de Panamá) hacia el correo del contador, que lo reenvía al cliente.
// Aquí se puede mandar al momento (para revisar cómo se ve) y se ven los últimos envíos.
import { db, h, toast, traducirError } from './lib.js';

function fechaHora(t) {
  const d = new Date(t);
  return d.toLocaleDateString('es-PA') + ' ' + d.toLocaleTimeString('es-PA', { hour: '2-digit', minute: '2-digit' });
}

export function seccionResumenSemanal(empresa) {
  const puede = empresa.rol === 'admin' || empresa.rol === 'contador';
  const lista = h('div', null);
  const caja = h('div', { class: 'tarjeta' },
    h('h2', null, 'Resumen semanal por correo'),
    h('p', { class: 'ayuda' }, 'Todos los lunes a las 7:00 a. m. llega al correo del contador un resumen de esta empresa: lo de la semana, lo que va del mes y del año, efectivo, por cobrar y por pagar, y los vencimientos que vienen. Él lo reenvía al cliente.'));
  if (!puede) {
    caja.append(h('p', { class: 'ayuda' }, 'Solo el administrador o el contador pueden mandarlo desde aquí.'));
    return caja;
  }

  async function cargar() {
    const r = await db.from('resumen_envios').select('semana_desde,semana_hasta,origen,estado,detalle,enviado_en')
      .eq('empresa_id', empresa.id).order('enviado_en', { ascending: false }).limit(5);
    if (r.error) {
      lista.replaceChildren(h('p', { class: 'ayuda' }, /resumen_envios|schema cache/i.test(r.error.message || '')
        ? 'Falta ejecutar el script 124 en Supabase.' : traducirError(r.error)));
      return;
    }
    const filas = r.data || [];
    lista.replaceChildren(filas.length
      ? h('div', { class: 'lista-cuentas' }, filas.map((f) => h('div', { class: 'trx' },
        h('div', { class: 'trx-nom' }, fechaHora(f.enviado_en) + (f.origen === 'manual' ? ' · manual' : ' · programado')),
        h('div', { class: 'trx-montos' }, h('span', { class: 'ayuda' }, f.estado === 'enviado' ? 'Enviado' : 'Error: ' + (f.detalle || 'sin detalle'))))))
      : h('p', { class: 'ayuda' }, 'Todavía no se ha enviado ninguno.'));
  }

  const enviar = h('button', { class: 'btn btn-sec', type: 'button' }, 'Enviar resumen ahora');
  enviar.addEventListener('click', async () => {
    enviar.disabled = true;
    try {
      // Supabase pone a la función el nombre que le sale al crearla (aquí 'clever-responder'); se prueban los dos
      let data = null, error = null;
      for (const nombre of ['resumen-semanal', 'clever-responder']) {
        const x = await db.functions.invoke(nombre, { body: { empresa_id: empresa.id } });
        data = x.data; error = x.error;
        if (!error || !/not found|404/i.test(String(error.message || '') + String((error.context && error.context.status) || ''))) break;
      }
      if (error) throw error;
      if (!data || !data.ok) {
        const r0 = data && data.resultados && data.resultados[0];
        toast('No se pudo enviar: ' + ((r0 && r0.error) || (data && data.error) || 'sin detalle'), 'error');
      } else toast('Resumen enviado a tu correo.', 'ok');
    } catch (e) {
      toast(/not found|404|Failed to send/i.test(String(e && e.message)) ? 'La función resumen-semanal todavía no está creada en Supabase.' : 'No se pudo enviar: ' + traducirError(e), 'error');
    }
    enviar.disabled = false;
    cargar();
  });
  caja.append(h('div', { class: 'acciones' }, enviar), h('h3', null, 'Últimos envíos'), lista);
  cargar();
  return caja;
}
// FIN DEL ARCHIVO resumen.js
