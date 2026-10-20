// Lista de verificación del cierre mensual: revisa el mes con la función verificacion_cierre
// y muestra qué está listo, qué conviene resolver antes de cerrar y qué es solo un aviso.
import { db, h, cargando, traducirError } from './lib.js';
import { barraExportar } from './informes.js';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
  'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const ETIQ = { ok: 'Listo', pendiente: 'Pendiente', aviso: 'Aviso', no_aplica: 'No aplica' };
const CLASE = { ok: 'ok', pendiente: 'aviso', aviso: 'gris', no_aplica: 'gris' };

export function tarjetaVerificacion({ empresa, anio }) {
  const hoyD = new Date();
  let mesInicial = hoyD.getFullYear() === anio ? hoyD.getMonth() : (anio < hoyD.getFullYear() ? 12 : 1);
  if (mesInicial < 1) mesInicial = 1;
  const sel = h('select', null, MESES.map((n, i) => h('option', { value: String(i + 1) }, n)));
  sel.value = String(mesInicial);
  const zona = h('div');
  let datos = null;

  function resumen(filas) {
    const p = filas.filter((f) => f.estado === 'pendiente').length;
    const a = filas.filter((f) => f.estado === 'aviso').length;
    if (p) return `Hay ${p} punto${p === 1 ? '' : 's'} por resolver antes de cerrar el mes.`;
    if (a) return `Nada bloquea el cierre, pero hay ${a} aviso${a === 1 ? '' : 's'} para revisar.`;
    return 'Todo está en orden para cerrar el mes.';
  }

  async function revisar() {
    const mes = Number(sel.value);
    zona.replaceChildren(cargando());
    const r = await db.rpc('verificacion_cierre', { p_empresa: empresa.id, p_anio: anio, p_mes: mes });
    if (r.error) {
      datos = null;
      const falta = /verificacion_cierre|function/i.test(r.error.message || '') && !/permis/i.test(r.error.message || '');
      zona.replaceChildren(h('p', { class: 'ayuda' }, falta
        ? 'Falta ejecutar el archivo 72 en Supabase para usar la lista de verificación.'
        : traducirError(r.error)));
      return;
    }
    const filas = (r.data || []).slice().sort((x, y) => x.orden - y.orden);
    datos = { filas, mes };
    zona.replaceChildren(
      h('p', null, h('strong', null, `${MESES[mes - 1]} ${anio}: `), resumen(filas)),
      ...filas.map((f) => h('div', { class: 'verif' },
        h('div', { class: 'trx-linea' },
          h('span', { class: 'insignia ' + CLASE[f.estado] }, ETIQ[f.estado] || f.estado),
          h('strong', null, f.titulo)),
        f.detalle ? h('p', { class: 'ayuda' }, f.detalle) : null)),
      h('div', { class: 'barra-exportar' }, barraExportar({
        empresa,
        obtener: () => (datos ? {
          archivo: `${empresa.razon_social}-verificacion-cierre-${anio}-${String(datos.mes).padStart(2, '0')}`,
          specs: [{
            titulo: `Lista de verificación del cierre de ${MESES[datos.mes - 1]} ${anio}`,
            subtitulo: resumen(datos.filas),
            hoja: 'Verificación',
            columnas: [{ t: 'Revisión', w: 2 }, { t: 'Estado', w: 1 }, { t: 'Detalle', w: 3 }],
            filas: datos.filas.map((f) => ({ c: [f.titulo, ETIQ[f.estado] || f.estado, f.detalle || ''] }))
          }]
        } : null)
      })));
  }

  return h('div', { class: 'tarjeta' },
    h('h2', null, 'Lista de verificación del mes'),
    h('p', { class: 'ayuda' }, 'Antes de cerrar un mes, revisa que no queden pendientes: movimientos sin asiento, ventas sin factura fiscal, recurrentes por registrar, depreciación, conciliación, inventario, ITBMS y que el balance cuadre.'),
    h('div', { class: 'acciones' }, sel,
      h('button', { class: 'btn btn-sec', type: 'button', onclick: revisar }, 'Revisar el mes')),
    zona);
}

// FIN DEL ARCHIVO verificacion.js
