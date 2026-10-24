// Cuadro "Asiento de cierre fiscal": el asiento sugerido de fin de año (persona natural) que se registra a mano
// en el Diario. Se calcula solo con lo registrado y se compara con lo que ya se asentó.
import { db, h, dinero } from './lib.js';

const NUM = (v) => Number(v || 0);

// Devuelve las filas o null (empresa que no aplica, o falta ejecutar el archivo 89)
export async function cargarCierreFiscal(id, anio) {
  try {
    const r = await db.rpc('cierre_fiscal', { p_empresa: id, p_anio: anio });
    if (r.error) return null;
    return r.data && r.data.length ? r.data : null;
  } catch (e) { return null; }
}

export function specCierreFiscal(filas, anio, razon) {
  return {
    titulo: `Asiento de cierre fiscal ${anio}`, subtitulo: `${razon} · sugerido al 31 de diciembre de ${anio}`, hoja: `Cierre fiscal ${anio}`,
    columnas: [{ t: 'Cuenta', w: 5 }, { t: 'Número' }, { t: 'Débito', num: true }, { t: 'Crédito', num: true }, { t: 'Ya registrado', num: true }, { t: 'Pendiente', num: true }],
    filas: filas.map((f) => ({
      c: [f.concepto, f.cuenta_numero || '', f.lado === 'D' ? NUM(f.sugerido) : '', f.lado === 'C' ? NUM(f.sugerido) : '', f.lado ? NUM(f.registrado) : '', NUM(f.pendiente)],
      e: f.orden === 5 ? 'total' : 'normal'
    }))
  };
}

export function tarjetaCierreFiscal(filas, anio) {
  if (!filas || !filas.length) return null;
  const resto = filas.filter((f) => f.orden !== 5);
  const dif = filas.find((f) => f.orden === 5);
  const pend = resto.some((f) => Math.abs(NUM(f.pendiente)) >= 0.005);
  const hay = Math.abs(NUM(dif && dif.pendiente)) >= 0.005;
  return h('div', { class: 'tarjeta' + (pend || hay ? ' dr-aviso-fiscal' : '') },
    h('h3', null, pend || hay ? `Falta el asiento de cierre fiscal de ${anio}` : `Cierre fiscal de ${anio} registrado`),
    h('p', { class: 'ayuda' }, pend || hay
      ? 'El balance general toma la utilidad del año antes de impuestos. Falta registrar a mano, en un asiento del Diario con fecha 31 de diciembre, el cierre fiscal con la utilidad y sus componentes. Este cuadro se actualiza solo con cada proceso que registres; si ya lo registraste parcialmente, la columna Pendiente muestra lo que falta.'
      : 'El asiento manual coincide con lo calculado. Si registras más procesos del año, este cuadro cambia y vuelve a mostrar lo pendiente.'),
    h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla estado' },
      h('thead', null, h('tr', null,
        h('th', null, 'Cuenta'), h('th', { class: 'num' }, 'Débito'), h('th', { class: 'num' }, 'Crédito'), h('th', { class: 'num' }, 'Pendiente'))),
      h('tbody', null,
        resto.map((f) => h('tr', null,
          h('td', null, f.concepto, h('div', { class: 'ayuda' }, f.cuenta_numero)),
          h('td', { class: 'num' }, f.lado === 'D' ? dinero(f.sugerido) : ''),
          h('td', { class: 'num' }, f.lado === 'C' ? dinero(f.sugerido) : ''),
          h('td', { class: 'num' }, dinero(f.pendiente)))),
        dif ? h('tr', { class: 'fila-total' },
          h('td', null, 'Diferencia por compensar'), h('td', { class: 'num' }, ''), h('td', { class: 'num' }, ''),
          h('td', { class: 'num' }, dinero(dif.pendiente))) : null))),
    h('p', { class: 'ayuda' }, 'Al cerrar el año en la pestaña Cierre, si ya registraste este asiento, desmarca "Trasladar la utilidad del ejercicio a utilidades acumuladas": el asiento ya la pasa a utilidades acumuladas con el impuesto descontado.'));
}

// FIN DEL ARCHIVO cierrefiscal.js
