// Extracto bancario: lee el archivo del banco (Excel o CSV), lo compara con los movimientos de
// libros de la cuenta y propone cuáles ya fueron procesados por el banco. Nada se marca
// hasta que tú confirmes.
import { db, h, toast, modal, dinero, fechaCorta, traducirError } from './lib.js';
import { leerLibro, serialAFecha } from './xlsxleer.js';

const sinAcentos = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const clave = (s) => sinAcentos(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/* ------------------------------ lectura ------------------------------ */
// CSV con comillas; el separador (coma, punto y coma o tabulador) se detecta solo
export function parsearCsv(texto) {
  const t = String(texto).replace(/^﻿/, '');
  const primera = t.split(/\r?\n/).find((l) => l.trim()) || '';
  const sep = [';', '\t', ','].map((c) => [c, primera.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const filas = []; let fila = []; let celda = ''; let comillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (comillas) {
      if (c === '"' && t[i + 1] === '"') { celda += '"'; i++; } else if (c === '"') comillas = false; else celda += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(celda); celda = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      fila.push(celda); celda = '';
      if (fila.some((x) => x.trim() !== '')) filas.push(fila);
      fila = [];
    } else celda += c;
  }
  fila.push(celda);
  if (fila.some((x) => x.trim() !== '')) filas.push(fila);
  return filas;
}

export function numeroTexto(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let t = String(v).trim();
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (/-\s*$/.test(t)) { neg = true; t = t.replace(/-\s*$/, ''); }
  if (/^-/.test(t)) { neg = true; t = t.slice(1); }
  t = t.replace(/[^0-9.,]/g, '');
  if (!t) return null;
  const c = t.lastIndexOf(','); const p = t.lastIndexOf('.');
  if (c >= 0 && p >= 0) t = c > p ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (c >= 0) t = /,\d{1,2}$/.test(t) && t.split(',').length === 2 ? t.replace(',', '.') : t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

export function fechaTexto(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v > 20000 && v < 80000 ? serialAFecha(v) : null;
  const t = String(v).trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})/.exec(t);
  if (m) {
    const a = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;     // día/mes/año
  }
  return null;
}

// Busca la fila de títulos y qué columna es cada cosa
export function detectarColumnas(filas) {
  const claves = {
    fecha: ['fecha', 'date', 'fechadeoperacion', 'fechaoperacion', 'fechatransaccion'],
    desc: ['descripcion', 'detalle', 'concepto', 'description', 'movimiento', 'referencia', 'transaccion'],
    debito: ['debito', 'debitos', 'retiro', 'retiros', 'cargo', 'cargos', 'egreso', 'salida', 'debit'],
    credito: ['credito', 'creditos', 'deposito', 'depositos', 'abono', 'abonos', 'ingreso', 'entrada', 'credit'],
    monto: ['monto', 'importe', 'valor', 'amount'],
    saldo: ['saldo', 'balance', 'saldodisponible']
  };
  for (let i = 0; i < Math.min(filas.length, 25); i++) {
    const cols = {};
    filas[i].forEach((c, j) => {
      const k = clave(c);
      if (!k) return;
      for (const [campo, lista] of Object.entries(claves)) if (cols[campo] === undefined && lista.includes(k)) cols[campo] = j;
    });
    const tieneImporte = cols.monto !== undefined || cols.debito !== undefined || cols.credito !== undefined;
    if (cols.fecha !== undefined && tieneImporte) return { fila: i, cols };
  }
  return null;
}

// Movimientos del banco: monto positivo = entra dinero (depósito), negativo = sale (retiro)
export function normalizarMovimientos(filas, det) {
  const { fila, cols } = det;
  const out = [];
  for (const r of filas.slice(fila + 1)) {
    const fecha = fechaTexto(r[cols.fecha]);
    if (!fecha) continue;
    let monto = null;
    if (cols.debito !== undefined || cols.credito !== undefined) {
      const d = numeroTexto(cols.debito !== undefined ? r[cols.debito] : null);
      const c = numeroTexto(cols.credito !== undefined ? r[cols.credito] : null);
      if (d !== null || c !== null) monto = (c || 0) - Math.abs(d || 0);
    }
    if ((monto === null || monto === 0) && cols.monto !== undefined) monto = numeroTexto(r[cols.monto]);
    if (monto === null || Math.abs(monto) < 0.005) continue;
    out.push({
      fecha, monto: Math.round(monto * 100) / 100,
      desc: String(cols.desc !== undefined ? (r[cols.desc] ?? '') : '').trim(),
      saldo: cols.saldo !== undefined ? numeroTexto(r[cols.saldo]) : null
    });
  }
  return out;
}

const dias = (a, b) => Math.abs(Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000));

// Empareja cada movimiento del banco con uno de libros del mismo monto y fecha cercana
export function conciliar(banco, libros, tolerancia = 7) {
  const libres = libros.filter((m) => !m.conciliado).map((m) => ({
    ...m, monto: Math.round((Number(m.ingreso || 0) - Number(m.egreso || 0)) * 100) / 100, usado: false
  }));
  const pares = []; const sinPar = [];
  for (const b of [...banco].sort((x, y) => x.fecha.localeCompare(y.fecha))) {
    let mejor = null;
    for (const l of libres) {
      if (l.usado || Math.abs(l.monto - b.monto) > 0.004) continue;
      const d = dias(l.fecha, b.fecha);
      if (d <= tolerancia && (!mejor || d < mejor.d)) mejor = { l, d };
    }
    if (mejor) { mejor.l.usado = true; pares.push({ banco: b, libro: mejor.l, dias: mejor.d }); } else sinPar.push(b);
  }
  return { pares, sinPar, libroSinPar: libres.filter((l) => !l.usado) };
}

export async function leerArchivoExtracto(archivo) {
  let filas;
  if (/\.xlsx$/i.test(archivo.name || '')) {
    const buf = await archivo.arrayBuffer();
    const libro = await leerLibro(buf, null);
    const nombre = libro.nombres[0];
    filas = (libro.hojas[nombre] || []);
  } else if (/\.xls$/i.test(archivo.name || '')) {
    throw new Error('Los archivos .xls antiguos no se pueden leer. Guárdalo como .xlsx o como CSV.');
  } else {
    filas = parsearCsv(await archivo.text());
  }
  const det = detectarColumnas(filas);
  if (!det) throw new Error('No encontré las columnas del extracto. Debe haber una fila de títulos con Fecha y Débito/Crédito (o Monto).');
  const mov = normalizarMovimientos(filas, det);
  if (!mov.length) throw new Error('El archivo no tiene movimientos con fecha e importe.');
  return mov;
}

/* ------------------------------- pantalla ------------------------------ */
export function abrirExtracto({ movimientos, corte, alAplicar, alSaldo, alNota }) {
  const cuerpo = h('div');
  const estadoEl = h('p', { class: 'ayuda' });
  const entrada = h('input', {
    type: 'file', accept: '.xlsx,.csv,.txt,text/csv', hidden: true,
    onchange: async (ev) => {
      const a = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!a) return;
      estadoEl.textContent = 'Leyendo el extracto…';
      try { propuesta(await leerArchivoExtracto(a)); estadoEl.textContent = ''; }
      catch (e) { estadoEl.textContent = ''; toast(traducirError(e), 'error'); }
    }
  });
  let cerrar;

  function propuesta(banco) {
    const r = conciliar(banco, movimientos);
    const marcas = r.pares.map(() => true);
    const ultimoSaldo = [...banco].reverse().find((x) => x.saldo !== null);
    const lista = h('div', { class: 'lista-cuentas' });
    const resumen = h('p', null);
    const actualizar = () => {
      const n = marcas.filter(Boolean).length;
      resumen.textContent = `Se marcarán ${n} movimiento(s) como procesados por el banco.`;
    };
    lista.replaceChildren(...r.pares.map((p, i) => h('label', { class: 'trx' },
      h('div', { class: 'trx-linea' },
        h('input', { type: 'checkbox', checked: true, onchange: (e) => { marcas[i] = e.target.checked; actualizar(); } }),
        h('span', { class: 'ayuda' }, `Banco ${fechaCorta(p.banco.fecha)} · Libros ${fechaCorta(p.libro.fecha)}`),
        p.dias > 3 ? h('span', { class: 'insignia aviso' }, `${p.dias} días de diferencia`) : null),
      h('div', { class: 'trx-nom' }, p.banco.desc || p.libro.descripcion || p.libro.documento || '—'),
      h('div', { class: 'trx-montos' }, h('span', { class: 'ayuda' }, p.banco.monto >= 0 ? 'Depósito' : 'Retiro'), h('strong', null, dinero(Math.abs(p.banco.monto)))))));
    actualizar();

    cuerpo.replaceChildren(
      h('p', null, `El extracto trae ${banco.length} movimientos: ${r.pares.length} coinciden con tus libros, ${r.sinPar.length} no tienen pareja.`),
      r.pares.length ? h('h3', null, 'Coincidencias') : null,
      r.pares.length ? h('p', { class: 'ayuda' }, 'Mismo monto y fecha cercana (hasta 7 días). Desmarca las que no sean la misma operación.') : null,
      lista, resumen,
      r.pares.length ? h('button', {
        class: 'btn btn-bloque', type: 'button',
        onclick: async (e) => {
          e.target.disabled = true;
          let ok = 0; let fallo = null;
          for (let i = 0; i < r.pares.length; i++) {
            if (!marcas[i]) continue;
            const x = await db.rpc('marcar_conciliado', { p_linea: r.pares[i].libro.linea_id, p_fecha_banco: r.pares[i].banco.fecha });
            if (x.error) { fallo = x.error; break; }
            ok++;
          }
          e.target.disabled = false;
          if (fallo) toast(`Se marcaron ${ok}; luego falló: ${traducirError(fallo)}`, 'error');
          else toast(`${ok} movimiento(s) marcados como conciliados.`, 'ok');
          cerrar(); alAplicar();
        }
      }, 'Marcar las coincidencias') : null,
      ultimoSaldo ? h('div', { class: 'grupo' },
        h('p', null, `El último saldo del extracto es ${dinero(ultimoSaldo.saldo)} (${fechaCorta(ultimoSaldo.fecha)}).`),
        h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: () => { alSaldo(ultimoSaldo.saldo); cerrar(); } },
          `Usar ese saldo como saldo del banco al ${fechaCorta(corte)}`),
        h('p', { class: 'ayuda' }, 'Úsalo solo si el extracto termina en la fecha de corte.')) : null,
      r.sinPar.length ? h('div', { class: 'grupo' },
        h('h3', null, 'Del banco sin pareja en libros'),
        h('p', { class: 'ayuda' }, 'Pueden ser intereses, comisiones, o movimientos que aún no registras. Los de abajo se pueden anotar como nota del banco.'),
        h('div', { class: 'lista-cuentas' }, r.sinPar.map((b) => h('div', { class: 'trx' },
          h('div', { class: 'trx-linea' }, h('span', { class: 'ayuda' }, fechaCorta(b.fecha))),
          h('div', { class: 'trx-nom' }, b.desc || '—'),
          h('div', { class: 'trx-montos' },
            h('strong', null, (b.monto >= 0 ? '+ ' : '− ') + dinero(Math.abs(b.monto))),
            h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: () => alNota(b) }, 'Nota del banco')))))) : null,
      r.libroSinPar.length ? h('p', { class: 'ayuda' }, `${r.libroSinPar.length} movimiento(s) de libros sin pareja en el extracto: quedan en tránsito o en circulación.`) : null);
  }

  cerrar = modal('Importar extracto del banco', h('div', null,
    h('p', { class: 'ayuda' }, 'Sube el estado de cuenta del banco en Excel (.xlsx) o CSV. Debe tener una fila de títulos con Fecha y Débito/Crédito (o Monto). El archivo se lee en tu teléfono y no se guarda.'),
    h('button', { class: 'btn btn-bloque', type: 'button', onclick: () => entrada.click() }, 'Elegir archivo del banco'),
    entrada, estadoEl, cuerpo));
}

// FIN DEL ARCHIVO extracto.js
