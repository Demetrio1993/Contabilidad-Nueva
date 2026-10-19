// Respaldo de la empresa (pestaña Datos): descarga todos sus datos en un archivo JSON completo
// y en un Excel legible (catálogo, diario, transacciones, clientes y proveedores).
// Los archivos adjuntos (fotos y PDF) no van dentro: el respaldo incluye solo su lista.
import { db, h, toast, traducirError, hoy, fechaCorta } from './lib.js';
import { construirXlsx, descargar } from './exportar.js';

// [tabla, columna del filtro]
const TABLAS = [
  ['cuentas', 'empresa_id'], ['empresa_cuentas_clave', 'empresa_id'], ['terceros', 'empresa_id'], ['periodos', 'empresa_id'],
  ['asientos', 'empresa_id'], ['asiento_lineas', 'empresa_id'], ['transacciones', 'empresa_id'], ['notas_credito', 'empresa_id'],
  ['soportes', 'empresa_id'], ['activos_fijos', 'empresa_id'], ['depreciacion_registrada', 'empresa_id'],
  ['inventario_items', 'empresa_id'], ['inventario_movimientos', 'empresa_id'], ['inventario_cierres', 'empresa_id'],
  ['conciliaciones', 'empresa_id'], ['partidas_conciliadas', 'empresa_id'], ['partidas_banco', 'empresa_id'],
  ['cierres_anuales', 'empresa_id'], ['cifras_anteriores', 'empresa_id'], ['itbms_manual', 'empresa_id'],
  ['notas_eeff', 'empresa_id'], ['notas_eeff_anterior', 'empresa_id'], ['notas_detalle', 'empresa_id'],
  ['recurrentes', 'empresa_id'], ['vencimientos', 'empresa_id'], ['vencimientos_cumplidos', 'empresa_id'],
  ['importaciones', 'empresa_id'], ['bitacora', 'empresa_id']
];
const PAGINA = 1000;

async function leerTodo(tabla, columna, id) {
  const filas = [];
  for (let desde = 0; ; desde += PAGINA) {
    const r = await db.from(tabla).select('*').eq(columna, id).range(desde, desde + PAGINA - 1);
    if (r.error) return { error: r.error };
    filas.push(...(r.data || []));
    if (!r.data || r.data.length < PAGINA) break;
  }
  return { filas };
}

export async function reunirDatos(id, progreso) {
  const emp = await db.from('empresas').select('*').eq('id', id).single();
  if (emp.error) throw emp.error;
  const tablas = {}; const omitidas = [];
  for (let i = 0; i < TABLAS.length; i++) {
    const [t, c] = TABLAS[i];
    if (progreso) progreso(i, TABLAS.length, t);
    const r = await leerTodo(t, c, id);
    if (r.error) omitidas.push(`${t}: ${r.error.message || r.error}`);
    else tablas[t] = r.filas;
  }
  return { empresa: emp.data, tablas, omitidas };
}

const n = (v) => Number(v || 0);

// Hojas legibles del Excel
export function armarSpecs(d) {
  const t = d.tablas;
  const cuentas = t.cuentas || [];
  const porCuenta = Object.fromEntries(cuentas.map((c) => [c.id, c]));
  const porTercero = Object.fromEntries((t.terceros || []).map((x) => [x.id, x]));
  const asientos = Object.fromEntries((t.asientos || []).map((a) => [a.id, a]));
  const specs = [];
  specs.push({
    titulo: 'Catálogo de cuentas', subtitulo: d.empresa.razon_social, hoja: 'Catálogo',
    columnas: [{ t: 'Número' }, { t: 'Nombre', w: 1 }, { t: 'Tipo' }, { t: 'Naturaleza' }, { t: 'Nivel', num: true }],
    filas: [...cuentas].sort((a, b) => String(a.numero).localeCompare(String(b.numero), undefined, { numeric: true }))
      .map((c) => ({ c: [c.numero, c.nombre, c.tipo, c.naturaleza, n(c.nivel)], e: 'normal' }))
  });
  const lineas = (t.asiento_lineas || []).map((l) => ({ l, a: asientos[l.asiento_id] })).filter((x) => x.a)
    .sort((x, y) => String(x.a.fecha).localeCompare(String(y.a.fecha)) || n(x.a.consecutivo) - n(y.a.consecutivo));
  specs.push({
    titulo: 'Diario general', subtitulo: d.empresa.razon_social, hoja: 'Diario', horizontal: true,
    columnas: [{ t: 'Fecha' }, { t: 'Asiento', num: true }, { t: 'Origen' }, { t: 'Descripción', w: 1 }, { t: 'Cuenta' }, { t: 'Débito', num: true }, { t: 'Crédito', num: true }],
    filas: lineas.map(({ l, a }) => {
      const c = porCuenta[l.cuenta_id];
      return { c: [fechaCorta(a.fecha), n(a.consecutivo), a.origen, a.descripcion, c ? `${c.numero} ${c.nombre}` : '', n(l.debito), n(l.credito)], e: 'normal' };
    })
  });
  specs.push({
    titulo: 'Transacciones', subtitulo: d.empresa.razon_social, hoja: 'Transacciones', horizontal: true,
    columnas: [{ t: 'Fecha' }, { t: 'Tipo' }, { t: 'Factura' }, { t: 'Cliente o proveedor', w: 1 }, { t: 'RUC' }, { t: 'Bruto', num: true },
      { t: 'ITBMS', num: true }, { t: 'Retención', num: true }, { t: 'Total', num: true }, { t: 'Forma' }, { t: 'Estado' }, { t: 'Factura fiscal' }],
    filas: [...(t.transacciones || [])].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
      .map((x) => ({
        c: [fechaCorta(x.fecha), x.tipo, x.numero_factura || '', x.nombre_tercero || (porTercero[x.tercero_id] || {}).razon_social || '',
          x.ruc ? `${x.ruc}${x.dv ? '-' + x.dv : ''}` : '', n(x.monto_bruto), n(x.itbms), n(x.retencion_itbms), n(x.monto_neto),
          x.forma, x.anulada ? 'Anulada' : 'Vigente', x.fiscal_emitida ? (x.fiscal_numero || 'Sí') : ''],
        e: 'normal'
      }))
  });
  if ((t.notas_credito || []).length) {
    specs.push({
      titulo: 'Notas de crédito', subtitulo: d.empresa.razon_social, hoja: 'Notas de crédito',
      columnas: [{ t: 'Fecha' }, { t: 'Número' }, { t: 'Motivo', w: 1 }, { t: 'Bruto', num: true }, { t: 'ITBMS', num: true }, { t: 'Total', num: true }, { t: 'Estado' }],
      filas: t.notas_credito.map((x) => ({ c: [fechaCorta(x.fecha), x.numero || '', x.motivo || '', n(x.monto_bruto), n(x.itbms), n(x.monto_neto), x.anulada ? 'Anulada' : 'Vigente'], e: 'normal' }))
    });
  }
  specs.push({
    titulo: 'Clientes y proveedores', subtitulo: d.empresa.razon_social, hoja: 'Clientes y prov.',
    columnas: [{ t: 'Nombre', w: 1 }, { t: 'Tipo' }, { t: 'RUC' }, { t: 'DV' }, { t: 'Teléfono' }, { t: 'Correo' }],
    filas: (t.terceros || []).map((x) => ({ c: [x.razon_social, x.tipo, x.ruc || '', x.dv || '', x.telefono || '', x.correo || ''], e: 'normal' }))
  });
  return specs;
}

export function seccionRespaldo(empresa) {
  const puede = empresa.rol === 'admin' || empresa.rol === 'contador';
  if (!puede) return null;
  const estado = h('p', { class: 'ayuda' });
  const botones = [];
  const nombre = () => String(empresa.razon_social).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'empresa';

  async function hacer(tipo) {
    botones.forEach((b) => { b.disabled = true; });
    try {
      const d = await reunirDatos(empresa.id, (i, total, t) => { estado.textContent = `Reuniendo datos… ${i + 1} de ${total} (${t})`; });
      const fecha = hoy();
      if (tipo === 'json') {
        const cuerpo = JSON.stringify({ formato: 'respaldo-contabilidad-pymes', version: 1, fecha, ...d }, null, 1);
        descargar(new TextEncoder().encode(cuerpo), `respaldo-${nombre()}-${fecha}.json`, 'application/json');
      } else {
        const meta = { empresa: { razon_social: empresa.razon_social, ruc: empresa.ruc, dv: empresa.dv } };
        descargar(construirXlsx(armarSpecs(d), meta), `respaldo-${nombre()}-${fecha}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      }
      estado.textContent = '';
      toast(d.omitidas.length ? `Respaldo descargado. No se pudieron leer: ${d.omitidas.length} tabla(s) (ejecuta los archivos pendientes de Supabase).` : 'Respaldo descargado. Guárdalo en un lugar seguro.', d.omitidas.length ? 'info' : 'ok');
    } catch (e) {
      estado.textContent = '';
      toast('No se pudo crear el respaldo: ' + traducirError(e), 'error');
    } finally { botones.forEach((b) => { b.disabled = false; }); }
  }

  const bj = h('button', { class: 'btn btn-sec', type: 'button', onclick: () => hacer('json') }, 'Respaldo completo (JSON)');
  const bx = h('button', { class: 'btn btn-sec', type: 'button', onclick: () => hacer('xlsx') }, 'Respaldo legible (Excel)');
  botones.push(bj, bx);
  return h('div', { class: 'grupo' },
    h('h3', null, 'Respaldo de la empresa'),
    h('p', { class: 'ayuda' }, 'Descarga todos los datos de esta empresa. Hazlo cada mes y guarda el archivo fuera de la app (correo, Drive o tu computadora). El JSON tiene todo; el Excel sirve para consultar. Las fotos y PDF adjuntos no se incluyen.'),
    h('div', { class: 'acciones' }, bj, bx), estado);
}

// FIN DEL ARCHIVO respaldo.js
