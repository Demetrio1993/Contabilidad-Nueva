// Respaldo de la empresa (pestaña Datos): descarga todos sus datos en un archivo JSON completo
// y en un Excel legible: catálogo, diario, transacciones, clientes y proveedores, estados financieros, declaración de renta,
// impuestos, anexos, cartera, activos, inventario, conciliación, presupuesto y el resto de las tablas.
// Los archivos adjuntos (fotos y PDF) no van dentro: el respaldo incluye solo su lista.
import { db, h, toast, traducirError, hoy, fechaCorta, irA } from './lib.js';
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
  ['importaciones', 'empresa_id'], ['bitacora', 'empresa_id'],
  ['auxiliares', 'empresa_id'], ['impuestos_config', 'empresa_id'], ['impuestos_anio', 'empresa_id'], ['dr_manual', 'empresa_id'], ['dr_opciones', 'empresa_id'], ['inventario_estado', 'empresa_id'], ['facturas_dgi', 'empresa_id'],
  ['dr_aprobaciones', 'empresa_id'], ['presupuestos', 'empresa_id'], ['comentarios_transaccion', 'empresa_id'], ['empresa_usuarios', 'empresa_id']
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

// Respaldo de una sola llamada (archivo 74): toda la empresa en el mismo instante.
// Si el archivo 74 aún no se ejecutó o la empresa es muy grande, lee tabla por tabla como antes.
export async function obtenerRespaldo(id, progreso) {
  const r = await db.rpc('exportar_empresa', { p_empresa: id });
  if (!r.error && r.data && r.data.tablas) return { empresa: r.data.empresa, tablas: r.data.tablas, informes: r.data.informes || null, omitidas: [], completo: true };
  const d = await reunirDatos(id, progreso);
  return { ...d, completo: false };
}

async function anotar(id, tipo, detalle) {
  try { await db.rpc('registrar_respaldo', { p_empresa: id, p_tipo: tipo, p_detalle: detalle || null }); } catch (e) { /* sin el archivo 74 no se anota */ }
}

const DIAS_AVISO = 7;
const diasDesde = (f) => Math.floor((Date.now() - new Date(f).getTime()) / 86400000);

// Aviso para el Panel y Transacciones: hace cuánto no se descarga un respaldo (solo administrador y contador)
export function avisoRespaldo(empresa) {
  const caja = h('div');
  if (!(empresa.rol === 'admin' || empresa.rol === 'contador')) return caja;
  (async () => {
    const r = await db.rpc('ultimo_respaldo', { p_empresa: empresa.id });
    if (r.error) return;
    const dias = r.data ? diasDesde(r.data) : null;
    if (dias !== null && dias < DIAS_AVISO) return;
    caja.append(h('div', { class: 'tarjeta aviso-respaldo' },
      h('strong', null, dias === null ? 'Esta empresa todavía no tiene un respaldo descargado.' : `Hace ${dias} días que no descargas un respaldo de esta empresa.`),
      h('p', { class: 'ayuda' }, 'Descárgalo desde la pestaña Datos y guárdalo fuera de la app. Es tu copia si algo sale mal.'),
      h('a', { class: 'btn btn-sec btn-peq', href: `#/empresa/${empresa.id}/datos` }, 'Ir a Datos')));
  })();
  return caja;
}

const n = (v) => Number(v || 0);

// ---------- Hojas adicionales del Excel: informes y el resto de las tablas ----------
const TITULOS_COL = { fecha: 'Fecha', numero: 'Número', nombre: 'Nombre', descripcion: 'Descripción', concepto: 'Concepto', monto: 'Monto', actual: 'Actual', anterior: 'Anterior',
  debito: 'Débito', credito: 'Crédito', saldo: 'Saldo', tipo: 'Tipo', estado: 'Estado', anio: 'Año', mes: 'Mes', renglon: 'Renglón', anexo: 'Anexo', anexos: 'Anexos' };
const titCol = (k) => TITULOS_COL[k] || (k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' '));

// Convierte una lista de filas (objetos) en una hoja: resuelve cuentas y terceros y omite ids y datos anidados
export function hojaGenerica(hoja, titulo, filas, d, sub) {
  if (!Array.isArray(filas) || !filas.length) return null;
  const t = (d && d.tablas) || {};
  const porCuenta = Object.fromEntries((t.cuentas || []).map((c) => [c.id, `${c.numero} ${c.nombre}`]));
  const porTercero = Object.fromEntries((t.terceros || []).map((x) => [x.id, x.razon_social]));
  const porAsiento = Object.fromEntries((t.asientos || []).map((a) => [a.id, a.consecutivo]));
  const claves = [];
  for (const f of filas.slice(0, 20000)) for (const k of Object.keys(f)) {
    if (!claves.includes(k) && k !== 'id' && k !== 'empresa_id' && k !== 'error') claves.push(k);
  }
  const PREF = ['fecha', 'mes', 'consecutivo', 'numero', 'codigo', 'renglon', 'cuenta', 'cuenta_id', 'nombre', 'concepto', 'descripcion', 'anexo', 'anexos', 'tercero', 'tercero_id',
    'tipo', 'documento', 'debito', 'credito', 'ingreso', 'egreso', 'monto', 'actual', 'anterior', 'saldo_anterior', 'saldo'];
  const peso = (k) => { const i = PREF.indexOf(k); return k === 'fila' ? 1000 : (i < 0 ? 500 : i); };
  claves.sort((a, b) => peso(a) - peso(b));
  const cols = [];
  for (const k of claves) {
    if (k === 'orden') continue;
    const muestra = filas.map((f) => f[k]).find((v) => v !== null && v !== undefined);
    if (muestra !== undefined && typeof muestra === 'object') continue;
    if (/_id$/.test(k) && !['cuenta_id', 'tercero_id', 'asiento_id'].includes(k) && !/^(cuenta|tercero|asiento)/.test(k)) continue;
    cols.push(k);
  }
  if (!cols.length) return null;
  const esNum = (k) => filas.every((f) => f[k] === null || f[k] === undefined || typeof f[k] === 'number');
  const valor = (f, k) => {
    const v = f[k];
    if (v === null || v === undefined) return '';
    if (k === 'cuenta_id') return porCuenta[v] || '';
    if (k === 'tercero_id') return porTercero[v] || '';
    if (k === 'asiento_id') return porAsiento[v] === undefined ? '' : porAsiento[v];
    if (typeof v === 'boolean') return v ? 'Sí' : '';
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return fechaCorta(v);
    return v;
  };
  return {
    titulo, subtitulo: sub || d.empresa.razon_social, hoja, horizontal: cols.length > 5,
    columnas: cols.map((k) => ({ t: k === 'cuenta_id' ? 'Cuenta' : k === 'tercero_id' ? 'Cliente o proveedor' : k === 'asiento_id' ? 'Asiento' : titCol(k), num: esNum(k) && !/(^|_)(numero|codigo|anio|renglon)$/.test(k) })),
    filas: filas.slice(0, 20000).map((f) => ({ c: cols.map((k) => valor(f, k)), e: 'normal' }))
  };
}

const INFORMES_ANIO = [
  ['estado_resultados', 'Resultados', 'Estado de resultados'], ['estado_balance_general', 'Balance', 'Balance general'],
  ['estado_cambios_patrimonio', 'Patrimonio', 'Cambios en el patrimonio'], ['estado_flujo_efectivo', 'Flujo', 'Flujo de efectivo'],
  ['balance_comprobacion', 'Comprobación', 'Balance de comprobación'], ['libro_ingresos_egresos', 'Libro Ing-Egr', 'Libro de Ingresos y Egresos'],
  ['impuestos_calculo', 'Impuestos', 'Seguro educativo e impuesto sobre la renta'], ['cierre_fiscal', 'Cierre fiscal', 'Asiento de cierre fiscal sugerido'],
  ['declaracion_renta', 'Decl. renta', 'Declaración de renta'], ['declaracion_renta_cuentas', 'Renta cuentas', 'Declaración de renta: cuentas por renglón'],
  ['declaracion_renta_sin_renglon', 'Renta sin renglón', 'Declaración de renta: cuentas sin renglón'], ['anexos_dr', 'Anexos DR', 'Anexos de la declaración'],
  ['anexos_dr_pendientes', 'Anexos pend.', 'Anexos pendientes'], ['depreciacion_matriz', 'Depreciación', 'Depreciación del año'],
  ['amortizacion_matriz', 'Amortización', 'Amortización del año'], ['presupuesto_vs_real', 'Presupuesto', 'Presupuesto contra real'],
  ['auxiliares_saldos', 'Auxiliares', 'Saldos de auxiliares']
];
const INFORMES_FECHA = [
  ['cartera_cxc_detalle', 'CxC detalle', 'Cuentas por cobrar: facturas'], ['cartera_cxp_detalle', 'CxP detalle', 'Cuentas por pagar: facturas'],
  ['cartera_cxc_morosidad', 'CxC morosidad', 'Cuentas por cobrar: morosidad'], ['cartera_cxp_morosidad', 'CxP morosidad', 'Cuentas por pagar: morosidad'],
  ['cartera_cxc_control', 'CxC control', 'Cuentas por cobrar: control'], ['cartera_cxp_control', 'CxP control', 'Cuentas por pagar: control'],
  ['activos_depreciacion', 'Activos', 'Activos fijos'], ['activos_amortizacion', 'Intangibles', 'Activos intangibles'],
  ['inventario_valoracion', 'Inventario', 'Valoración del inventario'], ['pendientes', 'Pendientes', 'Pendientes y comentarios']
];
// Otras tablas de datos que el Excel no mostraba
const TABLAS_EXTRA = [
  ['auxiliares', 'Datos auxiliares', 'Auxiliares'], ['activos_fijos', 'Datos activos', 'Activos fijos y su depreciación'],
  ['depreciacion_registrada', 'Datos deprec.', 'Depreciaciones registradas'], ['inventario_items', 'Datos inventario', 'Artículos de inventario'],
  ['inventario_movimientos', 'Datos mov. inv.', 'Movimientos de inventario'], ['inventario_cierres', 'Datos cierres inv.', 'Cierres de inventario'],
  ['conciliaciones', 'Datos conciliación', 'Conciliaciones bancarias'], ['partidas_banco', 'Datos partidas banco', 'Partidas del extracto'],
  ['partidas_conciliadas', 'Datos partidas conc.', 'Partidas conciliadas'], ['recurrentes', 'Datos recurrentes', 'Movimientos recurrentes'],
  ['vencimientos', 'Datos vencimientos', 'Vencimientos'], ['vencimientos_cumplidos', 'Datos venc. cumplidos', 'Vencimientos cumplidos'],
  ['presupuestos', 'Datos presupuesto', 'Presupuestos'], ['cierres_anuales', 'Datos cierres anuales', 'Cierres anuales'],
  ['cifras_anteriores', 'Datos cifras ant.', 'Cifras de años anteriores'], ['itbms_manual', 'Datos ITBMS manual', 'ITBMS escrito a mano'],
  ['notas_eeff', 'Datos notas EEFF', 'Notas a los estados financieros'], ['notas_detalle', 'Datos notas detalle', 'Detalle de notas'],
  ['impuestos_config', 'Datos impuestos conf.', 'Configuración de impuestos'], ['impuestos_anio', 'Datos ISR por año', 'Impuesto sobre la renta por año'],
  ['dr_manual', 'Datos renta manual', 'Montos escritos a mano en la declaración'], ['dr_aprobaciones', 'Datos aprobaciones', 'Aprobaciones de la declaración'], ['dr_opciones', 'Datos renta opciones', 'Opciones de la declaración (edad para la CSS)'], ['inventario_estado', 'Datos inventario EEFF', 'Inventario inicial y final del estado de resultados'], ['facturas_dgi', 'Datos facturas DGI', 'Facturas de la DGI por revisar'],
  ['periodos', 'Datos períodos', 'Períodos cerrados'], ['empresa_usuarios', 'Datos usuarios', 'Usuarios de la empresa'],
  ['soportes', 'Datos soportes', 'Lista de soportes adjuntos'], ['importaciones', 'Datos importaciones', 'Importaciones'],
  ['comentarios_transaccion', 'Datos comentarios', 'Comentarios'], ['bitacora', 'Bitácora', 'Bitácora de cambios']
];

function hojasAdicionales(d) {
  const out = [];
  const inf = d.informes;
  if (inf && inf.por_anio) {
    for (const anio of Object.keys(inf.por_anio).sort()) {
      const bloque = inf.por_anio[anio];
      const vacio = (!Array.isArray(bloque.estado_resultados) || !bloque.estado_resultados.length)
        && (!Array.isArray(bloque.estado_balance_general) || !bloque.estado_balance_general.length);
      if (vacio) continue;
      for (const [k, corto, largo] of INFORMES_ANIO) {
        const x = hojaGenerica(`${corto} ${anio}`, `${largo} ${anio}`, bloque[k], d, `${d.empresa.razon_social} · Año ${anio}`);
        if (x) out.push(x);
      }
      const itbms = [];
      for (const m of Object.keys(bloque.informe_itbms || {})) {
        const f = bloque.informe_itbms[m];
        if (Array.isArray(f)) f.forEach((r) => itbms.push({ mes: Number(m), ...r }));
      }
      const xi = hojaGenerica(`ITBMS ${anio}`, `Informe de ITBMS ${anio}`, itbms, d, `${d.empresa.razon_social} · Año ${anio}`);
      if (xi) out.push(xi);
    }
    const f = inf.a_la_fecha || {};
    for (const [k, corto, largo] of INFORMES_FECHA) {
      const x = hojaGenerica(corto, largo, f[k], d, `${d.empresa.razon_social} · al ${fechaCorta(f.fecha)}`);
      if (x) out.push(x);
    }
    for (const c of f.conciliaciones || []) {
      const x = hojaGenerica(`Conciliación ${out.length}`, 'Conciliación bancaria: resumen', c.resumen, d, `${d.empresa.razon_social} · al ${fechaCorta(f.fecha)}`);
      if (x) out.push(x);
    }
  }
  for (const [k, corto, largo] of TABLAS_EXTRA) {
    const x = hojaGenerica(corto, largo, (d.tablas || {})[k], d);
    if (x) out.push(x);
  }
  return out;
}

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
  return specs.concat(hojasAdicionales(d));
}

export function seccionRespaldo(empresa) {
  const puede = empresa.rol === 'admin' || empresa.rol === 'contador';
  if (!puede) return null;
  const estado = h('p', { class: 'ayuda' });
  const ultimo = h('p', { class: 'ayuda' });
  const historial = h('div');
  const botones = [];
  const nombre = () => String(empresa.razon_social).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'empresa';

  async function cargarHistorial() {
    const r = await db.from('respaldos_log').select('tipo, usuario_correo, detalle, creado_en')
      .eq('empresa_id', empresa.id).order('creado_en', { ascending: false }).limit(6);
    if (r.error) { ultimo.textContent = 'Para llevar el historial de respaldos falta ejecutar el archivo 74 en Supabase.'; historial.replaceChildren(); return; }
    const filas = r.data || [];
    const compl = filas.find((x) => x.tipo === 'json' || x.tipo === 'restauracion');
    ultimo.textContent = compl ? `Último respaldo completo: ${new Date(compl.creado_en).toLocaleDateString('es-PA')} (hace ${diasDesde(compl.creado_en)} días).` : 'Todavía no hay un respaldo completo descargado de esta empresa.';
    const ETQ = { json: 'Respaldo completo', excel: 'Respaldo Excel', restauracion: 'Restauración' };
    historial.replaceChildren(...filas.map((x) => h('p', { class: 'ayuda' },
      `${new Date(x.creado_en).toLocaleDateString('es-PA')} · ${ETQ[x.tipo] || x.tipo} · ${x.usuario_correo || ''}`)));
  }

  async function hacer(tipo) {
    botones.forEach((b) => { b.disabled = true; });
    try {
      const d = await obtenerRespaldo(empresa.id, (i, total, t) => { estado.textContent = `Reuniendo datos… ${i + 1} de ${total} (${t})`; });
      const fecha = hoy();
      if (tipo === 'json') {
        const cuerpo = JSON.stringify({ formato: 'respaldo-contabilidad-pymes', version: d.completo ? (d.informes ? 3 : 2) : 1, fecha: new Date().toISOString(), empresa: d.empresa, tablas: d.tablas, informes: d.informes || undefined });
        descargar(new TextEncoder().encode(cuerpo), `respaldo-${nombre()}-${fecha}.json`, 'application/json');
      } else {
        const meta = { empresa: { razon_social: empresa.razon_social, ruc: empresa.ruc, dv: empresa.dv } };
        descargar(construirXlsx(armarSpecs(d), meta), `respaldo-${nombre()}-${fecha}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      }
      await anotar(empresa.id, tipo === 'json' ? 'json' : 'excel', d.completo ? null : 'versión 1 (sin restauración automática)');
      estado.textContent = '';
      toast(d.omitidas.length ? `Respaldo descargado. No se pudieron leer: ${d.omitidas.length} tabla(s) (ejecuta los archivos pendientes de Supabase).` : 'Respaldo descargado. Guárdalo en un lugar seguro.', d.omitidas.length ? 'info' : 'ok');
      cargarHistorial();
    } catch (e) {
      estado.textContent = '';
      toast('No se pudo crear el respaldo: ' + traducirError(e), 'error');
    } finally { botones.forEach((b) => { b.disabled = false; }); }
  }

  const bj = h('button', { class: 'btn btn-sec', type: 'button', onclick: () => hacer('json') }, 'Respaldo completo (JSON)');
  const bx = h('button', { class: 'btn btn-sec', type: 'button', onclick: () => hacer('xlsx') }, 'Respaldo legible (Excel)');
  botones.push(bj, bx);
  cargarHistorial();
  return h('div', { class: 'grupo' },
    h('h3', null, 'Respaldo de la empresa'),
    h('p', { class: 'ayuda' }, 'Descarga todos los datos de esta empresa. Hazlo cada semana o antes de cualquier cambio grande y guarda el archivo fuera de la app (correo, Drive o tu computadora). El JSON tiene todo y sirve para restaurar la empresa; el Excel sirve para consultar. Las fotos y PDF adjuntos no se incluyen.'),
    ultimo,
    h('div', { class: 'acciones' }, bj, bx), estado,
    historial,
    empresa.rol === 'admin' ? seccionRestaurar(empresa, nombre) : null);
}

// Restaurar la empresa desde un archivo JSON (solo administrador)
function seccionRestaurar(empresa, nombre) {
  const zona = h('div');
  const archivo = h('input', { type: 'file', accept: '.json,application/json' });
  archivo.addEventListener('change', async () => {
    const f = archivo.files && archivo.files[0];
    if (!f) return;
    zona.replaceChildren(h('p', { class: 'cargando' }, 'Leyendo el archivo…'));
    let j;
    try { j = JSON.parse(await f.text()); } catch (e) { zona.replaceChildren(h('p', { class: 'ayuda' }, 'Ese archivo no se puede leer. Elige un respaldo JSON de esta aplicación.')); return; }
    if (!j || j.formato !== 'respaldo-contabilidad-pymes' || !j.empresa) { zona.replaceChildren(h('p', { class: 'ayuda' }, 'Ese archivo no es un respaldo de esta aplicación.')); return; }
    if (Number(j.version) < 2) { zona.replaceChildren(h('p', { class: 'ayuda' }, 'Este respaldo es de una versión anterior y no trae todo lo necesario para restaurar. Descarga un respaldo nuevo (con el archivo 74 ejecutado) y guárdalo.')); return; }
    const cuenta = (t) => ((j.tablas || {})[t] || []).length;
    const ex = await db.from('empresas').select('id').eq('id', j.empresa.id).maybeSingle();
    const existe = !!(ex.data && ex.data.id);
    const resumen = h('div', { class: 'tarjeta' },
      h('strong', null, j.empresa.razon_social),
      h('p', { class: 'ayuda' }, `Respaldo del ${j.fecha ? new Date(j.fecha).toLocaleDateString('es-PA') : '—'}: ${cuenta('transacciones')} transacciones, ${cuenta('asientos')} asientos, ${cuenta('cuentas')} cuentas, ${cuenta('terceros')} clientes y proveedores.`),
      h('p', { class: 'ayuda' }, existe
        ? 'Esta empresa existe ahora mismo. Si sigues, se borra lo que tiene hoy y se deja exactamente como estaba en el respaldo. Antes de hacerlo la app te descarga una copia de lo actual.'
        : 'Esta empresa ya no existe. Se reconstruye igual que estaba, con los mismos números de asiento.'));
    const confirmacion = h('input', { type: 'text', placeholder: 'Escribe el nombre de la empresa' });
    const ok = h('button', { class: 'btn btn-bloque btn-peligro', type: 'button' }, existe ? 'Reemplazar con este respaldo' : 'Restaurar la empresa');
    ok.addEventListener('click', async () => {
      if (existe && confirmacion.value.trim().toLowerCase() !== String(j.empresa.razon_social).trim().toLowerCase()) { toast('Escribe el nombre de la empresa para confirmar.', 'error'); return; }
      ok.disabled = true;
      try {
        if (existe) {
          const actual = await obtenerRespaldo(empresa.id);
          const cuerpo = JSON.stringify({ formato: 'respaldo-contabilidad-pymes', version: actual.completo ? (actual.informes ? 3 : 2) : 1, fecha: new Date().toISOString(), empresa: actual.empresa, tablas: actual.tablas, informes: actual.informes || undefined });
          descargar(new TextEncoder().encode(cuerpo), `antes-de-restaurar-${nombre()}-${hoy()}.json`, 'application/json');
        }
        const r = await db.rpc('restaurar_empresa', { p_json: j, p_reemplazar: existe });
        if (r.error) throw r.error;
        toast('Empresa restaurada.', 'ok');
        irA(`#/empresa/${r.data.empresa_id}/transacciones`);
      } catch (e) {
        ok.disabled = false;
        toast('No se pudo restaurar: ' + traducirError(e), 'error');
      }
    });
    zona.replaceChildren(resumen, existe ? h('label', { class: 'campo' }, h('span', { class: 'etiqueta' }, 'Para confirmar'), confirmacion) : null, ok);
  });
  return h('div', { class: 'grupo' },
    h('h3', null, 'Restaurar desde un respaldo'),
    h('p', { class: 'ayuda' }, 'Sirve si se borró una empresa o si se dañaron datos. Elige un archivo JSON descargado con "Respaldo completo". Las fotos y PDF adjuntos no van en el archivo: siguen guardados aparte.'),
    archivo, zona);
}

// FIN DEL ARCHIVO respaldo.js
