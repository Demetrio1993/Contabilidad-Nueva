// Bitácora de cambios: quién creó, modificó, anuló o eliminó qué y cuándo.
// Es de solo lectura (la base de datos no permite alterarla). Exporta a Excel y PDF.
import {
  db, h, mostrar, modal, campo, traducirError, cargando, marcoEmpresa, cargarEmpresa, fechaCorta
} from './lib.js';
import { barraExportar } from './informes.js';

const ACCIONES = {
  crear: 'Creó',
  modificar: 'Modificó',
  anular: 'Anuló',
  eliminar: 'Eliminó',
  'editar-antes': 'Editó (valor anterior)',
  'editar-despues': 'Editó (valor nuevo)'
};

const TABLAS = {
  transacciones: 'Transacción',
  asientos: 'Asiento',
  cuentas: 'Cuenta',
  terceros: 'Cliente o proveedor',
  activos_fijos: 'Activo fijo',
  inventario_items: 'Artículo de inventario',
  inventario_movimientos: 'Movimiento de inventario',
  periodos: 'Período',
  cierres_anuales: 'Cierre anual',
  partidas_banco: 'Nota del banco',
  conciliaciones: 'Conciliación',
  empresa_usuarios: 'Usuario de la empresa',
  empresas: 'Empresa'
};

const LIMITE = 500;
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function fechaHora(s) {
  const d = new Date(s);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function valorTexto(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function verDetalle(fila) {
  const antes = fila.antes || {};
  const despues = fila.despues || {};
  const claves = [...new Set([...Object.keys(antes), ...Object.keys(despues)])]
    .filter((k) => !['empresa_id', 'creado_por', 'creado_en'].includes(k));
  const cuerpo = claves.length === 0
    ? h('p', { class: 'ayuda' }, 'Sin más detalle.')
    : h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
      h('thead', null, h('tr', null, h('th', null, 'Campo'), h('th', null, 'Antes'), h('th', null, 'Después'))),
      h('tbody', null, claves.map((k) => h('tr', null,
        h('td', null, k), h('td', null, valorTexto(antes[k])), h('td', null, valorTexto(despues[k])))))));
  modal('Detalle del cambio', h('div', null,
    h('p', null, h('strong', null, `${ACCIONES[fila.accion] || fila.accion} · ${TABLAS[fila.tabla] || fila.tabla}`)),
    h('p', { class: 'ayuda' }, `${fechaHora(fila.creado_en)} · ${fila.usuario_correo || 'usuario desconocido'}`),
    fila.resumen ? h('p', null, fila.resumen) : null,
    cuerpo));
}

function specBitacora(filas, desde, hasta) {
  return {
    titulo: 'Bitácora de cambios',
    subtitulo: `Del ${fechaCorta(desde)} al ${fechaCorta(hasta)}`,
    hoja: 'Bitácora',
    horizontal: true,
    columnas: [
      { t: 'Fecha y hora', w: 1.2 }, { t: 'Usuario', w: 1.6 }, { t: 'Acción', w: 1.2 },
      { t: 'Módulo', w: 1.3 }, { t: 'Detalle', w: 3.2 }
    ],
    filas: filas.map((f) => ({
      c: [fechaHora(f.creado_en), f.usuario_correo || '', ACCIONES[f.accion] || f.accion,
        TABLAS[f.tabla] || f.tabla, f.resumen || ''],
      e: 'normal'
    })),
    notas: ['La bitácora la llena la base de datos sola y no se puede modificar ni borrar.']
  };
}

export async function vistaBitacora(id) {
  mostrar(marcoEmpresa({ id, razon_social: '…' }, 'bitacora', cargando()));
  const empresa = await cargarEmpresa(id);
  const hoyD = new Date();
  const ini = new Date(hoyD.getFullYear(), hoyD.getMonth(), 1);
  const f = { desde: iso(ini), hasta: iso(hoyD), tabla: '', accion: '' };
  let filas = [];
  const zona = h('div');

  const inDesde = h('input', { type: 'date', value: f.desde, onchange: (e) => { f.desde = e.target.value; cargar(); } });
  const inHasta = h('input', { type: 'date', value: f.hasta, onchange: (e) => { f.hasta = e.target.value; cargar(); } });
  const selTabla = h('select', { onchange: (e) => { f.tabla = e.target.value; cargar(); } },
    h('option', { value: '' }, 'Todo'),
    ...Object.entries(TABLAS).map(([k, v]) => h('option', { value: k }, v)));
  const selAccion = h('select', { onchange: (e) => { f.accion = e.target.value; cargar(); } },
    h('option', { value: '' }, 'Todas'),
    ...Object.entries(ACCIONES).map(([k, v]) => h('option', { value: k }, v)));

  const filtros = h('div', { class: 'tarjeta' },
    campo('Desde', inDesde), campo('Hasta', inHasta),
    campo('Módulo', selTabla), campo('Acción', selAccion));

  function exportar() {
    if (filas.length === 0) return null;
    return { specs: [specBitacora(filas, f.desde, f.hasta)], archivo: `${empresa.razon_social}-bitacora-${f.desde}-a-${f.hasta}` };
  }

  async function cargar() {
    zona.replaceChildren(cargando());
    if (!f.desde || !f.hasta || f.desde > f.hasta) {
      zona.replaceChildren(h('p', { class: 'ayuda' }, 'Revisa las fechas: la inicial debe ser anterior a la final.'));
      return;
    }
    const fin = new Date(f.hasta + 'T00:00:00');
    fin.setDate(fin.getDate() + 1);
    let q = db.from('bitacora').select('*').eq('empresa_id', id)
      .gte('creado_en', new Date(f.desde + 'T00:00:00').toISOString())
      .lt('creado_en', fin.toISOString())
      .order('creado_en', { ascending: false }).limit(LIMITE);
    if (f.tabla) q = q.eq('tabla', f.tabla);
    if (f.accion) q = q.eq('accion', f.accion);
    const r = await q;
    if (r.error) {
      zona.replaceChildren(h('div', { class: 'tarjeta error' }, h('p', null, traducirError(r.error))));
      return;
    }
    filas = r.data || [];
    if (filas.length === 0) {
      zona.replaceChildren(h('p', { class: 'ayuda' }, 'No hay cambios registrados en ese período.'));
      return;
    }
    zona.replaceChildren(...[
      barraExportar({ empresa, obtener: exportar }),
      filas.length >= LIMITE ? h('p', { class: 'ayuda' }, `Se muestran los ${LIMITE} cambios más recientes. Acorta el período para ver los anteriores.`) : null,
      h('div', { class: 'lista-cuentas' }, filas.map((fila) => h('button', {
        class: 'trx' + (fila.accion === 'eliminar' || fila.accion === 'anular' ? ' anulada' : ''),
        type: 'button', onclick: () => verDetalle(fila)
      },
      h('div', { class: 'trx-linea' },
        h('span', { class: 'insignia' }, ACCIONES[fila.accion] || fila.accion),
        h('span', { class: 'insignia gris' }, TABLAS[fila.tabla] || fila.tabla),
        h('span', { class: 'ayuda' }, fechaHora(fila.creado_en))),
      h('div', { class: 'trx-nom' }, fila.resumen || '—'),
      h('div', { class: 'trx-montos' }, h('span', { class: 'ayuda' }, fila.usuario_correo || '')))))
    ].filter(Boolean));
  }

  mostrar(marcoEmpresa(empresa, 'bitacora', [
    h('p', { class: 'ayuda' }, 'Registro automático de lo que se crea, modifica, anula o elimina. No se puede alterar.'),
    filtros, zona]));
  cargar();
}

// FIN DEL ARCHIVO bitacora.js
