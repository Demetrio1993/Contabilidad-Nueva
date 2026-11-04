// Formato DR/DGI: archivo de carga masiva de gastos por proveedor (Anexo 72 de la declaración de renta).
// Toma los gastos del año desde gastos_formato_dgi (script 108), los junta por proveedor y concepto,
// deja revisarlos en pantalla y los baja como .txt separado por tabulaciones (para la DGI) o como Excel.
import { db, h, toast, modal, traducirError, dinero } from './lib.js';
import { descargar, exportarExcel } from './exportar.js';

const NUM = (v) => Number(v || 0);

export const CONCEPTOS = {
  3: 'Dieta', 4: 'Alquileres', 5: 'Honorarios y comisiones', 6: 'Electricidad, agua y teléfonos', 7: 'Seguros',
  8: 'Transporte', 9: 'Gastos de representación', 11: 'Gastos de factoring', 12: 'Mantenimiento'
};

const TITULOS = ['Tipo de Persona', 'RUC', 'D.V.', 'Nombre o Razón Social', 'Tipo de Pago', 'Concepto', 'Monto(B/.)', 'Periodo de Aplicación'];

// 1 = natural, 2 = jurídica. Cédula (8-123-456, PE-1-23, N-12-345, E-8-99...) es natural; RUC con número largo es jurídica.
export function tipoPersonaDeRuc(ruc) {
  const p = String(ruc || '').trim().toUpperCase().split('-');
  if (!p[0]) return '';
  if (/^(\d{1,2}|N|PE|E|AV|PI|NT)$/.test(p[0])) return '1';
  return '2';
}

const limpia = (s) => String(s ?? '').replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
const dos = (v) => (Math.round((NUM(v) + Number.EPSILON) * 100) / 100).toFixed(2);

// filas del RPC -> filas del formato (una por proveedor y concepto) + las que no pueden ir
export function armarFilas(datos) {
  const mapa = new Map(); const fuera = []; const sinProv = [];
  for (const x of datos) {
    const monto = NUM(x.monto);
    if (!monto) continue;
    if (!x.tercero_id && !x.ruc) { sinProv.push(x); continue; }
    const ruc = limpia(x.ruc); const dv = limpia(x.dv);
    if (!ruc || !dv) { fuera.push({ nombre: limpia(x.nombre_tercero) || 'Sin nombre', ruc, dv, concepto: x.concepto, monto, motivo: !ruc ? 'sin RUC' : 'sin DV' }); continue; }
    const k = `${ruc}|${dv}|${x.concepto}`;
    const f = mapa.get(k) || { tipoPersona: tipoPersonaDeRuc(ruc), ruc, dv: dv.length === 1 ? '0' + dv : dv, nombre: limpia(x.nombre_tercero).slice(0, 100),
      tipoPago: '2', concepto: String(x.concepto), monto: 0, periodo: '1' };
    f.monto += monto;
    mapa.set(k, f);
  }
  const filas = [...mapa.values()].map((f) => ({ ...f, monto: Math.round(f.monto * 100) / 100 }))
    .filter((f) => f.monto !== 0)
    .sort((a, b) => Number(a.concepto) - Number(b.concepto) || a.nombre.localeCompare(b.nombre));
  return { filas, fuera, sinProv };
}

export function textoDgi(filas, conTitulos) {
  const lineas = filas.map((f) => [f.tipoPersona, f.ruc.slice(0, 20), f.dv, f.nombre, f.tipoPago, f.concepto, dos(f.monto), f.periodo].join('\t'));
  if (conTitulos) lineas.unshift(TITULOS.join('\t'));
  return lineas.join('\r\n') + '\r\n';
}

function specExcel(filas, anio) {
  return [{
    titulo: `Formato DR/DGI · gastos ${anio}`,
    subtitulo: 'Carga masiva a la declaración de renta: gastos por proveedor y concepto',
    hoja: 'Formato DR',
    columnas: TITULOS.map((t, i) => (i === 6 ? { t, num: true } : { t, w: i === 3 ? 2 : 1 })),
    filas: filas.map((f) => ({ c: [f.tipoPersona, f.ruc, f.dv, f.nombre, f.tipoPago, f.concepto, f.monto, f.periodo], e: 'normal' })),
    notas: ['Tipo de persona: 1 natural, 2 jurídica, 3 extranjero. Tipo de pago: 2 gastos. Periodo: 1 actual pagado, 2 actual por pagar.'],
    horizontal: true
  }];
}

export async function abrirFormatoDgi({ empresa, anio }) {
  const cuerpo = h('div', null, h('p', { class: 'ayuda' }, 'Preparando el formato…'));
  modal(`Formato DR/DGI ${anio}`, cuerpo);
  let r;
  try {
    r = await db.rpc('gastos_formato_dgi', { p_empresa: empresa.id, p_anio: anio });
    if (r.error) throw r.error;
  } catch (e) {
    cuerpo.replaceChildren(h('div', { class: 'tarjeta error' }, h('p', null,
      /gastos_formato_dgi/.test(String(e && e.message)) ? 'Falta ejecutar el archivo 108 en Supabase.' : traducirError(e))));
    return;
  }
  const { filas, fuera, sinProv } = armarFilas(r.data || []);
  const conTitulos = h('input', { type: 'checkbox' });

  function descargarTxt() {
    if (!filas.length) { toast('No hay gastos para el formato.', 'error'); return; }
    const bytes = new TextEncoder().encode(textoDgi(filas, conTitulos.checked));
    const nombre = `formato-dr-dgi-${anio}-${(empresa.ruc || 'empresa').replace(/[^A-Za-z0-9]+/g, '')}.txt`;
    descargar(bytes, nombre, 'text/plain;charset=utf-8');
    toast(`Se descargó ${nombre}`, 'ok');
  }
  function descargarXlsx() {
    if (!filas.length) { toast('No hay gastos para el formato.', 'error'); return; }
    const meta = { empresa: { razon_social: empresa.razon_social, ruc: empresa.ruc, dv: empresa.dv } };
    toast(`Se descargó ${exportarExcel(specExcel(filas, anio), meta, `${empresa.razon_social}-formato-dr-dgi-${anio}`)}`, 'ok');
  }

  const sel = (valor, opciones, alCambiar) => h('select', { value: valor, onchange: (e) => alCambiar(e.target.value) },
    opciones.map(([v, n]) => h('option', { value: v, selected: v === valor }, n)));
  const total = filas.reduce((s, f) => s + f.monto, 0);
  const totalEl = h('strong', null, dinero(total));

  const avisos = [];
  if (fuera.length) {
    avisos.push(h('div', { class: 'aviso-lectura' },
      h('strong', null, `${fuera.length} proveedor(es) no entran al archivo por falta de RUC o DV (${dinero(fuera.reduce((s, f) => s + f.monto, 0))}).`),
      h('p', null, fuera.map((f) => `${f.nombre} (${f.motivo}, concepto ${f.concepto}, ${dinero(f.monto)})`).join('; ') + '. Complétalos en Clientes y proveedores y vuelve a descargar.')));
  }
  if (sinProv.length) {
    avisos.push(h('div', { class: 'aviso-lectura' },
      h('strong', null, `${dinero(sinProv.reduce((s, f) => s + NUM(f.monto), 0))} en gastos sin proveedor identificado.`),
      h('p', null, 'Son movimientos de esas cuentas hechos con asientos manuales o transacciones sin proveedor. No van en el archivo.')));
  }

  cuerpo.replaceChildren(...[
    h('p', { class: 'ayuda' }, 'Gastos del año por proveedor y concepto de la DGI, tomados de las cuentas del catálogo. Los costos no se incluyen. Revisa el tipo de persona y el periodo antes de descargar.'),
    ...avisos,
    !filas.length ? h('p', { class: 'ayuda' }, 'No hay gastos de estos conceptos con proveedor identificado en ' + anio + '.') : null,
    ...filas.map((f) => h('div', { class: 'tarjeta' },
      h('p', null, h('strong', null, f.nombre), h('br'),
        h('span', { class: 'ayuda' }, `RUC ${f.ruc} DV ${f.dv} · ${f.concepto} = ${CONCEPTOS[f.concepto] || ''}`)),
      h('p', null, h('strong', null, dinero(f.monto))),
      h('div', { class: 'filtros' },
        sel(f.tipoPersona, [['1', 'Persona natural'], ['2', 'Persona jurídica'], ['3', 'Extranjero']], (v) => { f.tipoPersona = v; }),
        sel(f.periodo, [['1', 'Actual pagado'], ['2', 'Actual por pagar']], (v) => { f.periodo = v; })))),
    filas.length ? h('p', null, 'Total del archivo: ', totalEl) : null,
    filas.length ? h('label', { class: 'fila-check' }, conTitulos, h('span', null, 'Incluir fila de títulos en el .txt')) : null,
    filas.length ? h('div', { class: 'acciones' },
      h('button', { class: 'btn', type: 'button', onclick: descargarTxt }, 'Descargar .txt para la DGI'),
      h('button', { class: 'btn btn-sec', type: 'button', onclick: descargarXlsx }, 'Descargar Excel')) : null
  ].filter(Boolean));
}

// FIN DEL ARCHIVO formatodgi.js
