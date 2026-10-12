// Inventario PEPS: artículos, movimientos, valoración, tarjeta (kardex) y
// cierre mensual contra los libros. Exporta a Excel y PDF.
import {
  db, h, mostrar, toast, modal, campo, texto, traducirError, cargando,
  marcoEmpresa, cargarEmpresa, hoy, redondear, fechaCorta
} from './lib.js';
import { barraExportar } from './informes.js';
import { tablaSimple } from './fiscal.js';
import { confirmar, barraAcciones } from './acciones.js';

const NUM = (v) => Number(v || 0);
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
  'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const cant = (v) => NUM(v).toLocaleString('en-US', { maximumFractionDigits: 4 });
const E = { detalle: 'normal', total: 'total', control: 'n1', info: 'normal', subtotal: 'n1' };

function specValoracion(rows, fecha) {
  const filas = rows.map((r) => ({
    c: r.orden === 2 ? [null, 'TOTAL', null, null, null, NUM(r.valor)]
      : [r.codigo || '', r.nombre, r.unidad || '', cant(r.cantidad), NUM(r.costo_promedio), NUM(r.valor)],
    e: r.orden === 2 ? 'total' : 'normal'
  }));
  return {
    titulo: 'Valoración del inventario (PEPS)',
    subtitulo: `Existencias al ${fechaCorta(fecha)}`,
    hoja: 'Valoración',
    columnas: [{ t: 'Código' }, { t: 'Artículo', w: 1 }, { t: 'Unidad' }, { t: 'Cantidad', num: true },
      { t: 'Costo unitario', num: true }, { t: 'Valor', num: true }],
    filas
  };
}

function specTarjeta(item, rows, desde, hasta) {
  const v = (x) => (x === null || x === undefined ? null : NUM(x));
  return {
    titulo: `Tarjeta de inventario: ${item.codigo} ${item.nombre}`,
    subtitulo: `Método PEPS · del ${fechaCorta(desde)} al ${fechaCorta(hasta)}`,
    hoja: 'Tarjeta',
    horizontal: true,
    grupos: [{ t: 'Movimiento', n: 3 }, { t: 'Entradas', n: 3 }, { t: 'Salidas', n: 3 }, { t: 'Saldo', n: 3 }],
    columnas: [{ t: 'Fecha' }, { t: 'Movimiento' }, { t: 'Documento' },
      { t: 'Cant.', num: true }, { t: 'Costo', num: true }, { t: 'Total', num: true },
      { t: 'Cant.', num: true }, { t: 'Costo', num: true }, { t: 'Total', num: true },
      { t: 'Cant.', num: true }, { t: 'Valor', num: true }, { t: 'Costo', num: true }],
    filas: rows.map((r) => ({
      c: [fechaCorta(r.fecha), r.tipo_mov, r.documento || '', v(r.ent_cantidad), v(r.ent_costo_unitario), v(r.ent_total),
        v(r.sal_cantidad), v(r.sal_costo_unitario), v(r.sal_total), v(r.saldo_cantidad), v(r.saldo_valor), v(r.saldo_costo_unitario)],
      e: r.orden === 0 ? 'n1' : 'normal'
    }))
  };
}

function abrirArticulo(id, alGuardar, existente) {
  const f = {
    codigo: h('input', { type: 'text', required: true, value: existente ? existente.codigo : '' }),
    nombre: h('input', { type: 'text', required: true, value: existente ? existente.nombre : '' }),
    unidad: h('input', { type: 'text', value: existente ? (existente.unidad || 'unidad') : 'unidad' })
  };
  let cerrar;
  async function guardar(ev) {
    ev.preventDefault();
    if (!texto(f.codigo.value) || !texto(f.nombre.value)) { toast('Escribe el código y el nombre.', 'error'); return; }
    const datos = { codigo: texto(f.codigo.value), nombre: texto(f.nombre.value), unidad: texto(f.unidad.value) || 'unidad' };
    const r = existente
      ? await db.from('inventario_items').update(datos).eq('id', existente.id)
      : await db.from('inventario_items').insert({ empresa_id: id, ...datos });
    if (r.error) {
      toast(r.error.code === '23505' ? 'Ya existe un artículo con ese código.' : traducirError(r.error), 'error'); return;
    }
    toast(existente ? 'Cambios guardados.' : 'Artículo guardado.', 'ok'); cerrar(); alGuardar();
  }
  cerrar = modal(existente ? 'Editar artículo' : 'Nuevo artículo', h('form', { onsubmit: guardar },
    campo('Código', f.codigo), campo('Nombre', f.nombre), campo('Unidad de medida', f.unidad),
    h('button', { class: 'btn btn-bloque', type: 'submit' }, 'Guardar')));
}

function abrirMovimiento(id, items, itemInicial, alGuardar, existente) {
  const f = {
    item: h('select', { required: true }, items.map((i) => h('option', { value: i.id, selected: i.id === (existente ? existente.item_id : itemInicial) }, `${i.codigo} ${i.nombre}`))),
    tipo: h('select', null, h('option', { value: 'entrada', selected: !existente || existente.tipo === 'entrada' }, 'Entrada (compra)'), h('option', { value: 'salida', selected: !!existente && existente.tipo === 'salida' }, 'Salida (venta o consumo)')),
    fecha: h('input', { type: 'date', required: true, value: existente ? existente.fecha : hoy() }),
    cantidad: h('input', { type: 'number', step: '0.0001', min: '0.0001', inputmode: 'decimal', required: true, value: existente ? String(existente.cantidad) : '' }),
    costo: h('input', { type: 'number', step: '0.0001', min: '0', inputmode: 'decimal', value: existente ? String(existente.costo_unitario) : '0' }),
    doc: h('input', { type: 'text', value: existente ? (existente.documento || '') : '' })
  };
  let cerrar;
  async function guardar(ev) {
    ev.preventDefault();
    const c = Number(f.cantidad.value); const k = Number(f.costo.value || 0);
    if (!(c > 0)) { toast('La cantidad debe ser mayor que cero.', 'error'); return; }
    if (f.tipo.value === 'entrada' && !(k > 0)) { toast('Escribe el costo de cada unidad de la entrada.', 'error'); return; }
    const datos = {
      item_id: f.item.value, fecha: f.fecha.value, tipo: f.tipo.value, cantidad: c,
      costo_unitario: f.tipo.value === 'entrada' ? k : 0, documento: texto(f.doc.value)
    };
    const r = existente
      ? await db.from('inventario_movimientos').update(datos).eq('id', existente.id)
      : await db.from('inventario_movimientos').insert({ empresa_id: id, ...datos });
    if (r.error) { toast(traducirError(r.error), 'error'); return; }
    toast(existente ? 'Cambios guardados.' : 'Movimiento guardado.', 'ok'); cerrar(); alGuardar();
  }
  cerrar = modal(existente ? 'Editar movimiento' : 'Movimiento de inventario', h('form', { onsubmit: guardar },
    campo('Artículo', f.item), campo('Tipo', f.tipo), campo('Fecha', f.fecha), campo('Cantidad', f.cantidad),
    campo('Costo unitario (solo entradas)', f.costo, 'En las salidas el sistema calcula el costo por PEPS.'),
    campo('Documento', f.doc),
    h('button', { class: 'btn btn-bloque', type: 'submit' }, 'Guardar')));
}

export async function vistaInventario(id) {
  mostrar(marcoEmpresa({ id, razon_social: '…' }, 'inventario', cargando()));
  const empresa = await cargarEmpresa(id);
  const t = hoy();
  const est = { vista: 'valoracion', fecha: t, desde: t.slice(0, 4) + '-01-01', hasta: t, item: '', anio: Number(t.slice(0, 4)),
    mes: Number(t.slice(5, 7)), items: [], val: [], tar: null };
  const filtros = h('div', { class: 'filtros' });
  const zona = h('div');

  async function cargarItems() {
    const r = await db.from('inventario_items').select('id, codigo, nombre, unidad, activo').eq('empresa_id', id)
      .order('codigo').range(0, 4999);
    if (r.error) throw r.error;
    est.items = (r.data || []).filter((i) => i.activo);
    if (!est.items.some((i) => i.id === est.item)) est.item = est.items.length ? est.items[0].id : '';
  }

  function armar() {
    const f = [h('select', { onchange: (e) => { est.vista = e.target.value; armar(); pintar(); } },
      [['valoracion', 'Existencias y valor'], ['tarjeta', 'Tarjeta de un artículo'], ['movimientos', 'Artículos y movimientos (corregir)'], ['cierre', 'Cierre mensual']]
        .map(([k, n]) => h('option', { value: k, selected: k === est.vista }, n)))];
    if (est.vista === 'valoracion') {
      f.push(h('label', { class: 'campo' }, h('span', { class: 'etiqueta' }, 'Al'),
        h('input', { type: 'date', value: est.fecha, onchange: (e) => { est.fecha = e.target.value; pintar(); } })));
    } else if (est.vista === 'tarjeta' || est.vista === 'movimientos') {
      f.push(h('select', { onchange: (e) => { est.item = e.target.value; pintar(); } },
        est.items.length ? est.items.map((i) => h('option', { value: i.id, selected: i.id === est.item }, `${i.codigo} ${i.nombre}`))
          : [h('option', { value: '' }, 'Sin artículos')]));
      f.push(h('label', { class: 'campo' }, h('span', { class: 'etiqueta' }, 'Desde'),
        h('input', { type: 'date', value: est.desde, onchange: (e) => { est.desde = e.target.value; pintar(); } })));
      f.push(h('label', { class: 'campo' }, h('span', { class: 'etiqueta' }, 'Hasta'),
        h('input', { type: 'date', value: est.hasta, onchange: (e) => { est.hasta = e.target.value; pintar(); } })));
    } else {
      f.push(h('select', { onchange: (e) => { est.mes = Number(e.target.value); pintar(); } },
        MESES.map((m, i) => h('option', { value: String(i + 1), selected: i + 1 === est.mes }, m))));
      f.push(h('input', {
        type: 'number', min: '2000', max: '2100', inputmode: 'numeric', value: String(est.anio),
        onchange: (e) => { const v = Number(e.target.value); if (v >= 2000 && v <= 2100) { est.anio = v; pintar(); } }
      }));
    }
    filtros.replaceChildren(...f);
  }

  const botones = () => h('div', { class: 'acciones' },
    h('button', { class: 'btn', type: 'button', onclick: () => abrirArticulo(id, async () => { await cargarItems(); armar(); pintar(); }) }, '+ Artículo'),
    h('button', {
      class: 'btn btn-sec', type: 'button',
      onclick: () => (est.items.length ? abrirMovimiento(id, est.items, est.item, pintar) : toast('Primero crea un artículo.', 'error'))
    }, '+ Movimiento'));

  async function pintar() {
    zona.replaceChildren(cargando());
    try {
      const base = `${empresa.razon_social}-inventario`;
      if (est.vista === 'valoracion') {
        const r = await db.rpc('inventario_valoracion', { p_empresa: id, p_fecha: est.fecha });
        if (r.error) throw r.error;
        est.val = r.data || [];
        zona.replaceChildren(...[
          barraExportar({ empresa, obtener: () => (est.val.length ? { specs: [specValoracion(est.val, est.fecha)], archivo: `${base}-valoracion-${est.fecha}` } : null) }),
          botones(),
          est.val.length
            ? tablaSimple([{ t: 'Artículo' }, { t: 'Cantidad', num: true }, { t: 'Costo', num: true }, { t: 'Valor', num: true }],
              est.val.map((x) => ({ c: [x.orden === 2 ? 'TOTAL' : `${x.codigo} ${x.nombre}`, x.orden === 2 ? '' : cant(x.cantidad),
                x.orden === 2 ? '' : NUM(x.costo_promedio), NUM(x.valor)], e: x.orden === 2 ? 'total' : 'normal' })))
            : h('p', { class: 'ayuda' }, 'Todavía no hay artículos con existencias.')
        ]);
      } else if (est.vista === 'tarjeta') {
        est.tar = null;
        const item = est.items.find((i) => i.id === est.item);
        if (!item) { zona.replaceChildren(botones(), h('p', { class: 'ayuda' }, 'Crea un artículo para ver su tarjeta.')); return; }
        if (est.desde > est.hasta) { zona.replaceChildren(h('p', { class: 'ayuda' }, 'La fecha inicial no puede ser posterior a la final.')); return; }
        const r = await db.rpc('inventario_tarjeta', { p_empresa: id, p_item: est.item, p_desde: est.desde, p_hasta: est.hasta });
        if (r.error) throw r.error;
        const rows = r.data || [];
        est.tar = { item, rows };
        zona.replaceChildren(
          barraExportar({ empresa, obtener: () => (est.tar ? { specs: [specTarjeta(item, rows, est.desde, est.hasta)], archivo: `${base}-tarjeta-${item.codigo}-${est.hasta}` } : null) }),
          botones(),
          tablaSimple([{ t: 'Fecha' }, { t: 'Mov.' }, { t: 'Entra', num: true }, { t: 'Sale', num: true }, { t: 'Saldo', num: true }, { t: 'Valor', num: true }],
            rows.map((x) => ({
              c: [fechaCorta(x.fecha), x.tipo_mov, x.ent_cantidad === null ? '' : cant(x.ent_cantidad), x.sal_cantidad === null ? '' : cant(x.sal_cantidad),
                cant(x.saldo_cantidad), NUM(x.saldo_valor)], e: x.orden === 0 ? 'n1' : 'normal'
            })), 'ancha'));
      } else if (est.vista === 'movimientos') {
        const recargarTodo = async () => { await cargarItems(); armar(); pintar(); };
        const item = est.items.find((i) => i.id === est.item);
        const lista = [];
        if (item) {
          const r = await db.from('inventario_movimientos')
            .select('id, item_id, fecha, tipo, cantidad, costo_unitario, documento')
            .eq('empresa_id', id).eq('item_id', est.item).gte('fecha', est.desde).lte('fecha', est.hasta)
            .order('fecha', { ascending: false }).order('creado_en', { ascending: false }).range(0, 499);
          if (r.error) throw r.error;
          for (const m of (r.data || [])) {
            lista.push(h('div', { class: 'tarjeta' },
              h('div', { class: 'trx-linea' },
                h('strong', null, m.tipo === 'entrada' ? 'Entrada' : 'Salida'),
                h('span', { class: 'ayuda' }, fechaCorta(m.fecha)),
                m.documento ? h('span', { class: 'ayuda' }, m.documento) : null),
              h('p', null, `${cant(m.cantidad)} ${item.unidad || ''}` + (m.tipo === 'entrada' ? ` a B/. ${NUM(m.costo_unitario).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : ' (costo por PEPS)')),
              barraAcciones({
                editar: () => abrirMovimiento(id, est.items, est.item, pintar, m),
                eliminar: () => confirmar({
                  titulo: 'Eliminar movimiento',
                  mensaje: 'Se borra este movimiento de la tarjeta. No se puede si el mes ya está cerrado o si deja existencias negativas.',
                  boton: 'Eliminar',
                  alConfirmar: async () => {
                    const d = await db.from('inventario_movimientos').delete().eq('id', m.id);
                    if (d.error) throw d.error;
                    toast('Movimiento eliminado.', 'ok'); pintar();
                  }
                })
              })));
          }
        }
        zona.replaceChildren(...[
          botones(),
          item ? h('div', { class: 'tarjeta' },
            h('strong', null, `${item.codigo} ${item.nombre}`),
            h('p', { class: 'ayuda' }, `Unidad: ${item.unidad || 'unidad'}`),
            barraAcciones({
              editar: () => abrirArticulo(id, recargarTodo, item),
              eliminar: () => confirmar({
                titulo: 'Eliminar artículo',
                mensaje: 'Si el artículo tiene movimientos no se borra: queda desactivado y deja de aparecer. Si no tiene, se borra.',
                boton: 'Eliminar',
                alConfirmar: async () => {
                  const c = await db.from('inventario_movimientos').select('id', { count: 'exact', head: true }).eq('item_id', item.id);
                  if (c.error) throw c.error;
                  const u = (c.count || 0) > 0
                    ? await db.from('inventario_items').update({ activo: false }).eq('id', item.id)
                    : await db.from('inventario_items').delete().eq('id', item.id);
                  if (u.error) throw u.error;
                  toast((c.count || 0) > 0 ? 'Artículo desactivado.' : 'Artículo eliminado.', 'ok');
                  await recargarTodo();
                }
              })
            })) : h('p', { class: 'ayuda' }, 'Crea un artículo para empezar.'),
          item ? h('h3', null, 'Movimientos del período') : null,
          item && !lista.length ? h('p', { class: 'ayuda' }, 'No hay movimientos entre esas fechas.') : null,
          ...lista
        ].filter(Boolean));
      } else {
        const [ctl, cie] = await Promise.all([
          db.rpc('inventario_control_mes', { p_empresa: id, p_anio: est.anio, p_mes: est.mes }),
          db.from('inventario_cierres').select('anio, mes, saldo_eliminado, inventario_final, costo_mercancia_vendida').eq('empresa_id', id).order('anio').order('mes')
        ]);
        if (ctl.error) throw ctl.error;
        if (cie.error) throw cie.error;
        const rows = ctl.data || []; const cierres = cie.data || [];
        const actual = cierres.find((c) => c.anio === est.anio && c.mes === est.mes);
        const dif = rows.find((x) => x.orden === 1030);
        const cuadra = dif && Math.abs(NUM(dif.monto)) < 0.005;
        const specs = () => {
          const out = [{
            titulo: 'Control del inventario del mes', subtitulo: `${MESES[est.mes - 1]} ${est.anio}`, hoja: 'Control',
            columnas: [{ t: 'Concepto', w: 1 }, { t: 'Monto', num: true }],
            filas: rows.map((x) => ({ c: [x.concepto, NUM(x.monto)], e: E[x.fila] || 'normal' }))
          }];
          if (cierres.length) {
            out.push({
              titulo: 'Cierres mensuales de inventario', subtitulo: 'Meses cerrados', hoja: 'Cierres',
              columnas: [{ t: 'Mes', w: 1 }, { t: 'Inventario eliminado', num: true }, { t: 'Inventario final', num: true }, { t: 'Costo de ventas', num: true }],
              filas: cierres.map((c) => ({ c: [`${MESES[c.mes - 1]} ${c.anio}`, NUM(c.saldo_eliminado), NUM(c.inventario_final), NUM(c.costo_mercancia_vendida)], e: 'normal' }))
            });
          }
          return out;
        };
        zona.replaceChildren(...[
          barraExportar({ empresa, obtener: () => (rows.length ? { specs: specs(), archivo: `${base}-cierre-${est.anio}-${String(est.mes).padStart(2, '0')}` } : null) }),
          h('p', { class: 'ayuda' }, 'El inventario de cada mes se cierra antes del período. Se elimina el saldo del inventario contra compras y se deja el valor PEPS; lo que queda en compras es el costo de ventas.'),
          rows.length ? tablaSimple([{ t: 'Concepto' }, { t: 'Monto', num: true }], rows.map((x) => ({ c: [x.concepto, NUM(x.monto)], e: E[x.fila] || 'normal' })), 'estado') : null,
          actual
            ? h('div', { class: 'tarjeta' }, h('p', null, `${MESES[est.mes - 1]} ${est.anio} ya está cerrado: costo de ventas B/. ${NUM(actual.costo_mercancia_vendida).toLocaleString('en-US', { minimumFractionDigits: 2 })}.`),
              h('button', {
                class: 'btn btn-sec', type: 'button', onclick: async () => {
                  const r = await db.rpc('revertir_cierre_inventario', { p_empresa: id, p_anio: est.anio, p_mes: est.mes });
                  if (r.error) { toast(traducirError(r.error), 'error'); return; }
                  toast('Cierre deshecho.', 'ok'); pintar();
                }
              }, 'Deshacer cierre'))
            : h('div', { class: 'tarjeta' },
              cuadra ? null : h('p', { class: 'ayuda' }, 'La diferencia debe ser cero antes de cerrar: revisa que las entradas de las tarjetas coincidan con las compras de mercancía.'),
              h('button', {
                class: 'btn', type: 'button', disabled: !cuadra, onclick: async (ev) => {
                  ev.target.disabled = true;
                  const r = await db.rpc('cierre_inventario_mensual', { p_empresa: id, p_anio: est.anio, p_mes: est.mes });
                  if (r.error) { toast(traducirError(r.error), 'error'); ev.target.disabled = false; return; }
                  toast('Inventario del mes cerrado.', 'ok'); pintar();
                }
              }, `Cerrar inventario de ${MESES[est.mes - 1]} ${est.anio}`))
        ].filter(Boolean));
      }
    } catch (e) {
      zona.replaceChildren(h('div', { class: 'tarjeta error' }, h('p', null, traducirError(e))));
    }
  }

  try { await cargarItems(); } catch (e) { toast(traducirError(e), 'error'); }
  armar();
  mostrar(marcoEmpresa(empresa, 'inventario', [filtros, zona]));
  pintar();
}

// FIN DEL ARCHIVO inventario.js
