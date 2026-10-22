// Auxiliares por cuenta: dentro de una cuenta del catálogo se separan los saldos por cliente,
// proveedor u otro concepto (ej. Clientes locales: A0001 Luis Atencio, A0002 Freddy Rodríguez).
// Este archivo trae: carga de auxiliares, selector para los formularios, ventana para crear o
// corregir un auxiliar, bloque del catálogo, informe de saldos y mayor de un auxiliar.
import { db, h, toast, modal, campo, texto, dinero, fechaCorta, traducirError, redondear } from './lib.js';
import { confirmar } from './acciones.js';

const n2 = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nz = (v) => (Number(v || 0) === 0 ? '' : n2(v));
const nulo0 = (v) => (Number(v || 0) === 0 ? null : Number(v));
const chip = (etiqueta, valor) => h('div', { class: 'chip' }, h('span', { class: 'ayuda' }, etiqueta), h('strong', null, valor));
const celda = (t, clase) => h('td', { class: clase || null }, t);

export const etiquetaAux = (a) => (a ? `${a.codigo} · ${a.nombre}` : '');
export const puedeCrearAux = (rol) => !!rol && rol !== 'lector';
export const puedeEditarAux = (rol) => rol === 'admin' || rol === 'contador';

// Devuelve { lista, falta }. falta = true si todavía no se ejecutó el archivo 77 en Supabase.
export async function cargarAuxiliares(empresaId) {
  const r = await db.from('auxiliares').select('id, cuenta_id, codigo, nombre, activo')
    .eq('empresa_id', empresaId).order('codigo').range(0, 9999);
  if (r.error) return { lista: [], falta: true };
  return { lista: r.data || [], falta: false };
}

/* ----------------------- crear o corregir un auxiliar ---------------------- */

// cuenta = { id, numero, nombre }. existente = fila de auxiliares (para corregir).
export function formularioAuxiliar({ empresaId, rol, cuenta, existente, alGuardar }) {
  let cerrar;
  const nombre = h('input', { type: 'text', required: true, maxlength: '120', value: existente ? existente.nombre : '', placeholder: 'Ej.: Luis Atencio' });
  const codigo = h('input', { type: 'text', maxlength: '20', value: existente ? existente.codigo : '', placeholder: existente ? '' : 'Vacío = automático (A0001, A0002…)' });
  const activo = h('input', { type: 'checkbox', checked: existente ? existente.activo : true });

  async function guardar(ev) {
    ev.preventDefault();
    if (!texto(nombre.value)) { toast('Escribe el nombre del auxiliar.', 'error'); return; }
    boton.disabled = true;
    try {
      if (!existente) {
        const r = await db.rpc('crear_auxiliar', {
          p_empresa: empresaId, p_cuenta: cuenta.id, p_nombre: texto(nombre.value), p_codigo: texto(codigo.value)
        });
        if (r.error) throw r.error;
        const g = await db.from('auxiliares').select('id, cuenta_id, codigo, nombre, activo').eq('id', r.data).single();
        if (g.error) throw g.error;
        toast(`Auxiliar ${g.data.codigo} creado.`, 'ok');
        cerrar();
        alGuardar(g.data);
      } else {
        if (!texto(codigo.value)) { toast('Escribe el código.', 'error'); boton.disabled = false; return; }
        const g = await db.from('auxiliares')
          .update({ nombre: texto(nombre.value), codigo: texto(codigo.value), activo: activo.checked })
          .eq('id', existente.id).select('id, cuenta_id, codigo, nombre, activo');
        if (g.error) throw g.error;
        if (!g.data || !g.data.length) throw new Error('No tienes permiso para corregir este auxiliar.');
        toast('Auxiliar guardado.', 'ok');
        cerrar();
        alGuardar(g.data[0]);
      }
    } catch (e) {
      boton.disabled = false;
      toast(traducirError(e), 'error');
    }
  }

  async function eliminar() {
    confirmar({
      titulo: 'Eliminar auxiliar',
      mensaje: `¿Eliminar ${etiquetaAux(existente)}? Solo se puede si no tiene movimientos. Si ya tiene movimientos, desactívalo.`,
      boton: 'Eliminar',
      alConfirmar: async () => {
        const g = await db.from('auxiliares').delete().eq('id', existente.id).select('id');
        if (g.error) {
          if (g.error.code === '23503') throw new Error('Este auxiliar ya tiene movimientos y no se puede eliminar. Desactívalo para que no aparezca al registrar.');
          throw g.error;
        }
        if (!g.data || !g.data.length) throw new Error('No se pudo eliminar el auxiliar.');
        toast('Auxiliar eliminado.', 'ok');
        cerrar();
        alGuardar(null, existente.id);
      }
    });
  }

  const boton = h('button', { class: 'btn btn-bloque', type: 'submit' }, existente ? 'Guardar' : 'Crear auxiliar');
  cerrar = modal(existente ? 'Corregir auxiliar' : 'Nuevo auxiliar', h('form', { onsubmit: guardar },
    h('p', { class: 'ayuda' }, `Cuenta: ${cuenta.numero} · ${cuenta.nombre}`),
    campo('Nombre', nombre),
    campo('Código', codigo, existente ? 'El código identifica al auxiliar dentro de la cuenta.' : 'Puedes escribir el tuyo (ej. A0001) o dejarlo vacío para que se asigne solo.'),
    existente ? h('label', { class: 'fila-check' }, activo, h('span', null, 'Activo (aparece al registrar transacciones)')) : null,
    boton,
    existente && puedeEditarAux(rol)
      ? h('button', { class: 'btn btn-peligro btn-bloque', type: 'button', style: 'margin-top: 10px', onclick: eliminar }, 'Eliminar auxiliar')
      : null));
  return cerrar;
}

/* -------------------- selector para los formularios -------------------- */

// Devuelve el campo del auxiliar para una cuenta, o null si no hay cuenta elegida.
// datos = { lista: [...] } se comparte y se actualiza al crear un auxiliar nuevo.
export function campoAuxiliar({ empresaId, rol, etiqueta, cuenta, datos, valor, alCambiar, redibujar }) {
  if (!cuenta || datos.falta) return null;
  const propios = datos.lista.filter((a) => a.cuenta_id === cuenta.id && (a.activo || a.id === valor));
  const crear = puedeCrearAux(rol);
  if (!propios.length && !crear) return null;
  const sel = h('select', {
    value: valor || '',
    onchange: (e) => {
      if (e.target.value === '__nuevo') {
        e.target.value = valor || '';
        formularioAuxiliar({
          empresaId, rol, cuenta,
          alGuardar: (fila) => { if (!fila) return; datos.lista.push(fila); alCambiar(fila.id); redibujar(); }
        });
        return;
      }
      alCambiar(e.target.value);
    }
  },
  h('option', { value: '' }, '(sin auxiliar)'),
  propios.map((a) => h('option', { value: a.id }, etiquetaAux(a) + (a.activo ? '' : ' (inactivo)'))),
  crear ? h('option', { value: '__nuevo' }, '+ Crear auxiliar nuevo…') : null);
  return campo(etiqueta, sel, 'Opcional. Separa el saldo de la cuenta por cliente, proveedor u otro concepto.');
}

/* ------------------------ bloque dentro del catálogo ------------------------ */

export function bloqueAuxiliaresCuenta({ empresaId, rol, cuenta }) {
  const cont = h('div', { class: 'grupo' }, h('h3', null, 'Auxiliares de esta cuenta'), h('p', { class: 'ayuda' }, 'Cargando…'));
  if (!cuenta.acepta_movimientos) {
    return h('div', { class: 'grupo' }, h('h3', null, 'Auxiliares'),
      h('p', { class: 'ayuda' }, 'Los auxiliares se crean en las cuentas que reciben movimientos (las de último nivel).'));
  }
  async function pintar() {
    const r = await db.from('auxiliares').select('id, cuenta_id, codigo, nombre, activo')
      .eq('empresa_id', empresaId).eq('cuenta_id', cuenta.id).order('codigo');
    if (r.error) {
      cont.replaceChildren(h('h3', null, 'Auxiliares de esta cuenta'),
        h('p', { class: 'ayuda' }, 'Falta ejecutar el archivo 77 en Supabase para usar auxiliares.'));
      return;
    }
    cont.replaceChildren(
      h('h3', null, 'Auxiliares de esta cuenta'),
      h('p', { class: 'ayuda' }, 'Sirven para separar los montos de esta cuenta, por ejemplo por cliente. Se eligen al registrar la transacción.'),
      r.data.length
        ? h('div', { class: 'lista-cuentas' }, r.data.map((a) => h('button', {
          class: 'cuenta' + (a.activo ? '' : ' inactiva'), type: 'button',
          onclick: () => formularioAuxiliar({ empresaId, rol, cuenta, existente: a, alGuardar: pintar })
        }, h('span', { class: 'num' }, a.codigo), h('span', null, a.nombre),
        a.activo ? null : h('span', { class: 'insignia gris' }, 'Inactivo'))))
        : h('p', { class: 'ayuda' }, 'Esta cuenta todavía no tiene auxiliares.'),
      puedeCrearAux(rol)
        ? h('button', { class: 'btn btn-sec btn-bloque', type: 'button', onclick: () => formularioAuxiliar({ empresaId, rol, cuenta, alGuardar: pintar }) }, '+ Nuevo auxiliar')
        : null);
  }
  pintar();
  return cont;
}

/* ---------------- informe: saldo anterior, débitos, créditos, saldo actual ---------------- */

// ctx = { empresa, id, rango: () => [desde, hasta], etiquetaPeriodo, archivoDe, barraExportar, cuentaId, verCeros, alCambiar }
export async function informeAuxiliares(ctx) {
  const { empresa, id } = ctx;
  const [d, hasta] = ctx.rango();
  const r = await db.rpc('auxiliares_saldos', { p_empresa: id, p_desde: d, p_hasta: hasta, p_cuenta: ctx.cuentaId || null });
  if (r.error) {
    if (r.error.code === 'PGRST202' || r.error.code === '42883' || /could not find the function/i.test(r.error.message || '')) {
      throw new Error('Falta ejecutar el archivo 77 en Supabase para ver el informe de auxiliares.');
    }
    throw r.error;
  }
  const filas = r.data || [];
  // Agrupar por cuenta
  const grupos = [];
  const porCuenta = new Map();
  for (const f of filas) {
    if (!porCuenta.has(f.cuenta_id)) { const g = { cuenta: f, filas: [] }; porCuenta.set(f.cuenta_id, g); grupos.push(g); }
    porCuenta.get(f.cuenta_id).filas.push(f);
  }
  const vacia = (f) => Number(f.saldo_anterior) === 0 && Number(f.debitos) === 0 && Number(f.creditos) === 0 && Number(f.saldo_final) === 0;
  const suma = (arr, k) => redondear(arr.reduce((s, f) => s + Number(f[k] || 0), 0));
  const visibles = grupos.map((g) => ({
    cuenta: g.cuenta,
    todas: g.filas,
    filas: g.filas.filter((f) => ctx.verCeros || !vacia(f))
  }));

  const spec = grupos.length ? {
    titulo: 'Auxiliares por cuenta', subtitulo: ctx.etiquetaPeriodo(), hoja: 'Auxiliares',
    columnas: [{ t: 'Código', w: 1 }, { t: 'Auxiliar', w: 3 }, { t: 'Saldo anterior', num: true }, { t: 'Débitos', num: true },
      { t: 'Créditos', num: true }, { t: 'Saldo actual', num: true }],
    filas: [],
    notas: ['Los saldos van en el sentido natural de cada cuenta (deudora: débitos menos créditos; acreedora: créditos menos débitos).',
      'La fila (Sin auxiliar) es lo que se registró en la cuenta sin elegir auxiliar.']
  } : null;

  const bloques = visibles.map((g) => {
    const todas = g.todas;
    const tot = { ant: suma(todas, 'saldo_anterior'), d: suma(todas, 'debitos'), c: suma(todas, 'creditos'), fin: suma(todas, 'saldo_final') };
    if (spec) {
      spec.filas.push({ c: ['', `${g.cuenta.cuenta_numero} ${g.cuenta.cuenta_nombre}`, tot.ant, tot.d, tot.c, tot.fin], e: 'grupo' });
      g.filas.forEach((f) => spec.filas.push({
        c: [f.auxiliar_codigo || '', f.auxiliar_nombre + (f.activo ? '' : ' (inactivo)'),
          nulo0(f.saldo_anterior), nulo0(f.debitos), nulo0(f.creditos), nulo0(f.saldo_final)]
      }));
    }
    const cifras = (v) => h('div', { class: 'aux-cifras' },
      [['Saldo ant.', v.ant], ['Débitos', v.d], ['Créditos', v.c], ['Saldo act.', v.fin]].map(([t, n]) =>
        h('div', null, h('span', { class: 'ayuda' }, t), h('strong', null, n2(n)))));
    const tabla = g.filas.length
      ? h('div', null,
        g.filas.map((f) => h(f.auxiliar_id ? 'button' : 'div', {
          class: 'aux-fila' + (f.auxiliar_id ? ' aux-click' : ''), type: f.auxiliar_id ? 'button' : null,
          onclick: f.auxiliar_id ? () => mayorAuxiliar({ ...ctx, fila: f, alCambiar: ctx.alCambiar }) : null
        },
        h('div', { class: 'aux-nombre' }, f.auxiliar_id ? `${f.auxiliar_codigo} · ${f.auxiliar_nombre}${f.activo ? '' : ' (inactivo)'}` : f.auxiliar_nombre),
        cifras({ ant: f.saldo_anterior, d: f.debitos, c: f.creditos, fin: f.saldo_final }))),
        h('div', { class: 'aux-fila aux-total' }, h('div', { class: 'aux-nombre' }, 'Total de la cuenta'), cifras(tot)))
      : h('p', { class: 'ayuda' }, 'Sin movimientos ni saldo en este período.');
    return h('div', { class: 'tarjeta' }, h('h3', null, `${g.cuenta.cuenta_numero} · ${g.cuenta.cuenta_nombre}`), tabla);
  });

  const nodo = h('div', null,
    h('p', { class: 'ayuda' }, 'Toca un auxiliar para ver sus movimientos. Saldo actual = saldo anterior + movimientos del período, en el sentido natural de la cuenta.'),
    grupos.length ? bloques : h('div', { class: 'tarjeta' },
      h('p', null, 'Todavía no hay auxiliares. Créalos con el botón + Nuevo auxiliar, desde el Catálogo o al registrar una transacción.')));
  return { nodo, spec, archivo: ctx.archivoDe('auxiliares') };
}

/* ---------------------------- mayor de un auxiliar ---------------------------- */

export async function mayorAuxiliar(ctx) {
  const { fila } = ctx;
  const [d, hasta] = ctx.rango();
  const cont = h('div', null, h('p', { class: 'cargando' }, 'Cargando…'));
  const cerrar = modal(`${fila.auxiliar_codigo} · ${fila.auxiliar_nombre}`, cont);
  const r = await db.from('v_mayor_auxiliar')
    .select('fecha, consecutivo, descripcion, referencia, debito, credito, saldo')
    .eq('empresa_id', ctx.id).eq('auxiliar_id', fila.auxiliar_id).lte('fecha', hasta)
    .order('fecha').order('consecutivo').range(0, 4999);
  if (r.error) { cont.replaceChildren(h('p', { class: 'error-texto' }, traducirError(r.error))); return; }
  const data = r.data;
  const antes = data.filter((m) => m.fecha < d);
  const saldoIni = antes.length ? Number(antes[antes.length - 1].saldo) : 0;
  const movs = data.filter((m) => m.fecha >= d);
  const td = movs.reduce((s, m) => s + Number(m.debito), 0);
  const tc = movs.reduce((s, m) => s + Number(m.credito), 0);
  const saldoFin = movs.length ? Number(movs[movs.length - 1].saldo) : saldoIni;
  const spec = {
    titulo: `Mayor del auxiliar · ${fila.auxiliar_codigo} ${fila.auxiliar_nombre}`,
    subtitulo: `${fila.cuenta_numero} ${fila.cuenta_nombre} · ${ctx.etiquetaPeriodo()}`, hoja: 'Auxiliar',
    columnas: [{ t: 'Fecha', w: 1 }, { t: 'Descripción', w: 4 }, { t: 'Débito', num: true }, { t: 'Crédito', num: true }, { t: 'Saldo', num: true }],
    filas: [
      { c: ['', 'Saldo anterior', null, null, redondear(saldoIni)], e: 'grupo' },
      ...movs.map((m) => ({ c: [fechaCorta(m.fecha), m.descripcion + (m.referencia ? ` · ${m.referencia}` : ''), nulo0(m.debito), nulo0(m.credito), Number(m.saldo)] })),
      { c: ['', 'Totales y saldo actual', redondear(td), redondear(tc), redondear(saldoFin)], e: 'total' }]
  };
  cont.replaceChildren(
    h('p', { class: 'ayuda' }, `${fila.cuenta_numero} · ${fila.cuenta_nombre} · ${ctx.etiquetaPeriodo()}`),
    h('div', { class: 'resumen' }, chip('Saldo anterior', dinero(saldoIni)), chip('Débitos', dinero(td)),
      chip('Créditos', dinero(tc)), chip('Saldo actual', dinero(saldoFin))),
    movs.length
      ? h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
        h('thead', null, h('tr', null, h('th', null, 'Fecha'), h('th', null, 'Descripción'),
          h('th', { class: 'num' }, 'Débito'), h('th', { class: 'num' }, 'Crédito'), h('th', { class: 'num' }, 'Saldo'))),
        h('tbody', null, movs.map((m) => h('tr', null, celda(fechaCorta(m.fecha)),
          celda(m.descripcion + (m.referencia ? ` · ${m.referencia}` : '')),
          celda(nz(m.debito), 'num'), celda(nz(m.credito), 'num'), celda(n2(m.saldo), 'num'))))))
      : h('p', { class: 'ayuda' }, 'Este auxiliar no tiene movimientos en el período.'),
    ctx.barraExportar({
      empresa: ctx.empresa,
      obtener: () => ({ specs: [spec], archivo: ctx.archivoDe(`auxiliar-${fila.auxiliar_codigo}`) })
    }),
    puedeCrearAux(ctx.empresa.rol)
      ? h('button', {
        class: 'btn btn-sec btn-bloque', type: 'button',
        onclick: () => {
          cerrar();
          formularioAuxiliar({
            empresaId: ctx.id, rol: ctx.empresa.rol,
            cuenta: { id: fila.cuenta_id, numero: fila.cuenta_numero, nombre: fila.cuenta_nombre },
            existente: { id: fila.auxiliar_id, codigo: fila.auxiliar_codigo, nombre: fila.auxiliar_nombre, activo: fila.activo },
            alGuardar: () => ctx.alCambiar && ctx.alCambiar()
          });
        }
      }, 'Corregir datos del auxiliar')
      : null);
}

// FIN DEL ARCHIVO auxiliares.js
