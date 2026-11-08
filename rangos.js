// Rangos "desde - hasta" que usan los informes y las listas: de fechas y de cuentas.
import { db, h, toast } from './lib.js';

const pad = (n) => String(n).padStart(2, '0');
export const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Texto "01/03/2026" a partir de "2026-03-01"
export const fechaDMA = (f) => (ISO.test(f || '') ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : '');

export function primerDiaMes(hoyISO) { return `${hoyISO.slice(0, 7)}-01`; }
export function ultimoDiaMes(hoyISO) {
  const a = Number(hoyISO.slice(0, 4)); const m = Number(hoyISO.slice(5, 7));
  return `${hoyISO.slice(0, 7)}-${pad(new Date(a, m, 0).getDate())}`;
}

// Revisa un rango de fechas; devuelve el texto del problema o '' si está bien
export function problemaFechas(desde, hasta) {
  if (!ISO.test(desde || '') || !ISO.test(hasta || '')) return 'Elige las dos fechas: "Desde" y "Hasta".';
  if (desde > hasta) return 'La fecha "Desde" no puede ser posterior a la fecha "Hasta".';
  return '';
}

// Dos casillas de fecha. alCambiar(desde, hasta) se llama cuando cambia cualquiera.
export function selectorFechas({ desde, hasta, alCambiar }) {
  const d = h('input', { type: 'date', value: desde || '', 'aria-label': 'Desde' });
  const a = h('input', { type: 'date', value: hasta || '', 'aria-label': 'Hasta' });
  const avisar = () => alCambiar(d.value, a.value);
  d.addEventListener('change', avisar); a.addEventListener('change', avisar);
  return h('div', { class: 'rango-fechas' },
    h('label', { class: 'rango-campo' }, h('span', { class: 'ayuda' }, 'Desde'), d),
    h('label', { class: 'rango-campo' }, h('span', { class: 'ayuda' }, 'Hasta'), a));
}

/* ------------------------------ cuentas ------------------------------ */

// Compara números de cuenta tipo "6.1.03.001" parte por parte, como números
export function cmpCuenta(x, y) {
  const a = String(x || '').split('.'); const b = String(y || '').split('.');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const p = Number(a[i]); const q = Number(b[i]);
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

// ¿El número cae dentro del rango? desde/hasta vacíos = sin límite. "Hasta" incluye sus subcuentas.
export function enRangoCuenta(numero, desde, hasta) {
  const n = String(numero || '');
  if (desde && cmpCuenta(n, desde) < 0) return false;
  if (hasta && cmpCuenta(n, hasta) > 0 && !n.startsWith(hasta + '.')) return false;
  return true;
}

export const hayRangoCuentas = (desde, hasta) => !!(desde || hasta);

export function etiquetaCuentas(desde, hasta) {
  if (desde && hasta) return `Cuentas ${desde} a ${hasta}`;
  if (desde) return `Cuentas desde ${desde}`;
  if (hasta) return `Cuentas hasta ${hasta}`;
  return '';
}

// De una lista plana de filas con "numero", deja las del rango y los títulos (cuentas madre) de lo que queda
export function filtrarFilasCuentas(filas, desde, hasta) {
  if (!hayRangoCuentas(desde, hasta)) return filas;
  const dentro = filas.filter((f) => enRangoCuenta(f.numero, desde, hasta));
  const numeros = new Set(dentro.map((f) => String(f.numero)));
  return filas.filter((f) => {
    const n = String(f.numero);
    if (numeros.has(n)) return true;
    // madre de alguna cuenta que quedó
    for (const x of numeros) if (x.startsWith(n + '.')) return true;
    return false;
  });
}

// Dos listas para elegir la primera y la última cuenta. cuentas: [{ numero, nombre }] ordenadas por número.
export function selectorCuentas({ cuentas, desde, hasta, alCambiar }) {
  const opciones = (vacio) => (sel) => {
    sel.append(h('option', { value: '' }, vacio));
    cuentas.forEach((c) => sel.append(h('option', { value: c.numero }, `${c.numero} · ${c.nombre}`)));
    return sel;
  };
  const d = opciones('Desde: primera cuenta')(h('select', { 'aria-label': 'Cuenta desde' }));
  const a = opciones('Hasta: última cuenta')(h('select', { 'aria-label': 'Cuenta hasta' }));
  d.value = desde || ''; a.value = hasta || '';
  const avisar = () => {
    if (d.value && a.value && cmpCuenta(d.value, a.value) > 0) {
      toast('La cuenta "Desde" debe ir antes que la cuenta "Hasta".', 'error');
      a.value = ''; 
    }
    alCambiar(d.value, a.value);
  };
  d.addEventListener('change', avisar); a.addEventListener('change', avisar);
  return h('div', { class: 'rango-cuentas' },
    h('label', { class: 'rango-campo' }, h('span', { class: 'ayuda' }, 'Cuenta desde'), d),
    h('label', { class: 'rango-campo' }, h('span', { class: 'ayuda' }, 'Cuenta hasta'), a));
}

// Ids de las cuentas que tienen al menos una línea en el diario (toda la historia de la empresa)
export async function idsConMovimiento(empresaId) {
  const ids = new Set();
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await db.from('asiento_lineas').select('cuenta_id')
      .eq('empresa_id', empresaId).range(desde, desde + 999);
    if (error) throw error;
    (data || []).forEach((x) => ids.add(x.cuenta_id));
    if (!data || data.length < 1000) break;
  }
  return ids;
}

// Deja solo las cuentas con movimiento. Una cuenta madre se conserva si alguna subcuenta tiene movimiento.
export function soloConMovimiento(cuentas, ids) {
  const con = cuentas.filter((c) => ids.has(c.id));
  const numeros = con.map((c) => String(c.numero));
  return cuentas.filter((c) => ids.has(c.id) || numeros.some((n) => n.startsWith(String(c.numero) + '.')));
}

// FIN DEL ARCHIVO rangos.js
