// Estados financieros comparativos: balance general, estado de resultados,
// cambios en el patrimonio, flujo de efectivo (método indirecto) y notas.
// Las cifras del año anterior salen del sistema, pero se pueden escribir a mano.
import {
  db, h, mostrar, toast, modal, campo, texto, traducirError, cargando,
  marcoEmpresa, cargarEmpresa, hoy, redondear
} from './lib.js';
import { barraExportar } from './informes.js';
import { cargarCierreFiscal, tarjetaCierreFiscal, specCierreFiscal } from './cierrefiscal.js';

const TIPOS = [
  ['balance', 'Balance general'],
  ['resultados', 'Estado de resultados'],
  ['patrimonio', 'Cambios en el patrimonio'],
  ['flujo', 'Flujo de efectivo'],
  ['notas', 'Notas a los estados financieros']
];

const TITULOS = {
  balance: 'Balance general comparativo',
  resultados: 'Estado de resultados comparativo',
  patrimonio: 'Estado de cambios en el patrimonio comparativo',
  flujo: 'Estado de flujos de efectivo (método indirecto) comparativo',
  notas: 'Notas a los estados financieros'
};
const HOJAS = {
  balance: 'Balance general', resultados: 'Estado de resultados', patrimonio: 'Cambios en patrimonio',
  flujo: 'Flujo de efectivo', notas: 'Notas'
};
const FUNCIONES = {
  balance: 'estado_balance_general', resultados: 'estado_resultados',
  patrimonio: 'estado_cambios_patrimonio', flujo: 'estado_flujo_efectivo'
};

// Títulos de sección según el bloque de "orden" (orden / 1000)
const SECCIONES = {
  balance: { 1: 'ACTIVOS CORRIENTES', 2: 'ACTIVOS NO CORRIENTES', 4: 'PASIVOS CORRIENTES', 5: 'PASIVOS NO CORRIENTES', 7: 'PATRIMONIO' },
  resultados: {
    1: 'INGRESOS', 2: 'COSTOS', 4: 'GASTOS OPERATIVOS', 6: 'OTROS INGRESOS',
    7: 'GASTOS FINANCIEROS', 8: 'GASTOS Y EGRESOS EXTRAORDINARIOS', 10: 'IMPUESTOS: RENTA Y SEGURO EDUCATIVO'
  },
  patrimonio: {},
  flujo: { 1: 'ACTIVIDADES DE OPERACIÓN', 2: 'ACTIVIDADES DE INVERSIÓN', 3: 'ACTIVIDADES DE FINANCIAMIENTO' }
};

// Claves para escribir a mano las cifras del año anterior (estados sin número de cuenta)
const CLAVES = {
  patrimonio: { 1010: 'inicio', 1020: 'aportes', 1030: 'retiros', 1040: 'utilidad', 1050: 'otros' },
  flujo: {
    1010: 'util_neta', 1020: 'deprec', 1030: 'var_cxc', 1040: 'var_inv', 1050: 'var_prep', 1060: 'var_cxp',
    1070: 'var_imp', 1080: 'var_lab', 1090: 'var_otras', 2010: 'inv_ppe', 2020: 'inv_int', 2030: 'inv_otros',
    3010: 'fin_corto', 3020: 'fin_largo', 3030: 'fin_aportes', 3040: 'fin_retiros', 3050: 'fin_otros',
    4010: 'efectivo_inicio'
  }
};

const NUM = (v) => Number(v || 0);
const n2 = (v) => {
  const x = NUM(v);
  const t = Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return x < 0 ? `(${t})` : t;
};

// Clave con la que se guarda la cifra manual de una fila (o null si no se puede editar)
function claveFila(tipo, f) {
  if (f.fila !== 'detalle') return null;
  if (tipo === 'balance' || tipo === 'resultados') {
    if (f.numero) return f.numero;
    if (tipo === 'balance' && /pendiente de cierre/i.test(f.concepto || '')) return 'UTILIDAD_PENDIENTE';
    return null;
  }
  return (CLAVES[tipo] || {})[f.orden] || null;
}

// Filas listas para mostrar y exportar (sin la fila de control; con títulos de sección)
function filasEstado(tipo, rows) {
  const out = []; let secAnterior = null;
  const titulos = SECCIONES[tipo] || {};
  rows.filter((r) => r.fila !== 'control').forEach((r) => {
    const sec = Math.floor(Number(r.orden) / 1000);
    if ((r.fila === 'detalle' || r.fila === 'subtotal') && titulos[sec] && sec !== secAnterior) {
      out.push({ tipo: 'titulo', concepto: titulos[sec] });
      secAnterior = sec;
    }
    out.push({ tipo: r.fila, concepto: r.concepto, actual: NUM(r.actual), anterior: NUM(r.anterior) });
  });
  return out;
}

function controlEstado(rows) {
  const c = rows.find((r) => r.fila === 'control');
  if (!c) return null;
  return { actual: redondear(NUM(c.actual)), anterior: redondear(NUM(c.anterior)) };
}

function subtituloEstado(tipo, anio) {
  return tipo === 'balance'
    ? `Al 31 de diciembre de ${anio} y ${anio - 1}`
    : `Por los años terminados el 31 de diciembre de ${anio} y ${anio - 1}`;
}

function estiloSpec(t) {
  if (t === 'titulo') return 'n1';
  if (t === 'subtotal') return 'grupo';
  if (t === 'total') return 'total';
  return 'normal';
}

function specEstado(tipo, rows, anio) {
  return {
    titulo: TITULOS[tipo], subtitulo: subtituloEstado(tipo, anio), hoja: HOJAS[tipo],
    columnas: [{ t: 'Concepto', w: 1 }, { t: String(anio), num: true }, { t: String(anio - 1), num: true }],
    filas: filasEstado(tipo, rows).map((f) => ({
      c: f.tipo === 'titulo' ? [f.concepto, null, null]
        : [f.concepto, f.tipo === 'detalle' && f.actual === 0 ? null : f.actual, f.tipo === 'detalle' && f.anterior === 0 ? null : f.anterior],
      e: estiloSpec(f.tipo)
    }))
  };
}

function specNotas(notas, detalles, anio) {
  const filas = [];
  notas.forEach((n, i) => {
    filas.push({ c: [`Nota ${i + 1}. ${n.titulo}`, null, null], e: 'grupo' });
    filas.push({ c: [n.texto], e: 'texto' });
    (detalles[n.clave] || []).filter((r) => r.fila !== 'control').forEach((r) => {
      filas.push({
        c: [r.concepto, NUM(r.actual), NUM(r.anterior)],
        e: r.fila === 'total' ? 'total' : (r.fila === 'subtotal' ? 'grupo' : 'normal')
      });
    });
  });
  return {
    titulo: TITULOS.notas, subtitulo: `Al 31 de diciembre de ${anio} y ${anio - 1}`, hoja: HOJAS.notas,
    columnas: [{ t: 'Concepto', w: 1 }, { t: String(anio), num: true }, { t: String(anio - 1), num: true }],
    filas
  };
}

/* ------------------------------ pantalla ------------------------------ */

export async function vistaEstados(id) {
  mostrar(marcoEmpresa({ id, razon_social: '…' }, 'estados', cargando()));
  const empresa = await cargarEmpresa(id);
  const est = { anio: Number(hoy().slice(0, 4)), tipo: 'balance', actual: null };
  const barra = h('div', { class: 'filtros' });
  const zona = h('div');

  /* datos */
  async function cargarEstado(tipo) {
    const { data, error } = await db.rpc(FUNCIONES[tipo], { p_empresa: id, p_anio: est.anio });
    if (error) throw error;
    return data || [];
  }
  async function cargarNotas() {
    const { data, error } = await db.from('notas_eeff')
      .select('id, clave, orden, titulo, texto').eq('empresa_id', id).eq('anio', est.anio).order('orden');
    if (error) throw error;
    const notas = data || [];
    const detalles = {};
    await Promise.all(notas.map(async (n) => {
      try {
        const r = await db.rpc('nota_detalle', { p_empresa: id, p_anio: est.anio, p_nota: n.clave });
        detalles[n.clave] = r.error ? [] : (r.data || []);
      } catch (_e) { detalles[n.clave] = []; }
    }));
    return { notas, detalles };
  }

  /* tabla en pantalla */
  function tablaEstado(tipo, rows) {
    const filas = filasEstado(tipo, rows);
    return h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla estado' },
      h('thead', null, h('tr', null,
        h('th', null, 'Concepto'),
        h('th', { class: 'num' }, String(est.anio)),
        h('th', { class: 'num' }, String(est.anio - 1)))),
      h('tbody', null, filas.map((f) => (f.tipo === 'titulo'
        ? h('tr', { class: 'fila-titulo' }, h('td', { colspan: 3 }, f.concepto))
        : h('tr', { class: 'fila-' + f.tipo },
          h('td', null, f.concepto),
          h('td', { class: 'num' }, f.tipo === 'detalle' && f.actual === 0 ? '' : n2(f.actual)),
          h('td', { class: 'num' }, f.tipo === 'detalle' && f.anterior === 0 ? '' : n2(f.anterior))))))));
  }

  function avisoControl(rows) {
    const c = controlEstado(rows);
    if (!c) return null;
    const ok = c.actual === 0 && c.anterior === 0;
    return ok
      ? h('p', { class: 'ayuda' }, 'Control: el estado cuadra con el balance.')
      : h('div', { class: 'aviso-lectura' },
        h('strong', null, 'El estado no cuadra con el balance.'),
        h('p', null, `Diferencia año ${est.anio}: ${n2(c.actual)} · año ${est.anio - 1}: ${n2(c.anterior)}. ` +
          'Revisa que el año esté cerrado y las cifras del año anterior.'));
  }

  /* cifras del año anterior a mano */
  async function abrirAnteriores(tipo, rows) {
    const { data: manuales } = await db.from('cifras_anteriores')
      .select('numero, monto').eq('empresa_id', id).eq('anio', est.anio).eq('estado', tipo);
    const manual = new Map((manuales || []).map((m) => [m.numero, NUM(m.monto)]));
    const entradas = []; // { clave, concepto, actual, input }
    const caja = h('div');
    const agregarFila = (clave, concepto, valor) => {
      if (entradas.some((e) => e.clave === clave)) return;
      const input = h('input', { type: 'number', step: '0.01', inputmode: 'decimal', value: valor === null ? '' : String(valor) });
      const e = { clave, concepto, inicial: valor, input };
      entradas.push(e);
      caja.append(h('div', { class: 'fila-ant' },
        h('span', null, concepto, manual.has(clave) ? h('span', { class: 'insignia aviso' }, 'manual') : null),
        input));
    };
    rows.forEach((f) => {
      const clave = claveFila(tipo, f);
      if (clave) agregarFila(clave, f.numero ? `${f.numero} ${f.concepto}` : f.concepto, redondear(NUM(f.anterior)));
    });

    // cuentas que hoy no aparecen (balance y resultados)
    let extra = null;
    if (tipo === 'balance' || tipo === 'resultados') {
      const { data: cuentas } = await db.from('cuentas')
        .select('numero, nombre, tipo, clasificacion_ef').eq('empresa_id', id).eq('nivel', 3).eq('activa', true)
        .order('numero').range(0, 1999);
      const validas = (cuentas || []).filter((c) => (tipo === 'balance'
        ? ['activo', 'pasivo', 'patrimonio'].includes(c.tipo) && c.clasificacion_ef
        : ['ingreso', 'costo', 'gasto', 'extraordinario'].includes(c.tipo)));
      const sel = h('select', null, h('option', { value: '' }, 'Agregar otra cuenta…'),
        validas.map((c) => h('option', { value: c.numero }, `${c.numero} · ${c.nombre}`)));
      sel.addEventListener('change', () => {
        const c = validas.find((x) => x.numero === sel.value);
        if (c) agregarFila(c.numero, `${c.numero} ${c.nombre}`, null);
        sel.value = '';
      });
      extra = campo('Cuenta que no aparece en la lista', sel, 'Útil si esa cuenta tuvo saldo el año anterior y hoy está en cero.');
    }

    const guardar = h('button', { class: 'btn', type: 'button' }, 'Guardar cifras');
    const restablecer = h('button', { class: 'btn btn-sec', type: 'button' }, 'Quitar todas las cifras manuales');
    guardar.addEventListener('click', async () => {
      const cambios = entradas.filter((e) => {
        if (e.input.value === '') return false;
        return redondear(Number(e.input.value)) !== e.inicial;
      }).map((e) => ({
        empresa_id: id, anio: est.anio, estado: tipo, numero: e.clave, monto: redondear(Number(e.input.value))
      }));
      if (!cambios.length) { toast('No hay cambios que guardar.', 'error'); return; }
      guardar.disabled = true;
      const { error } = await db.from('cifras_anteriores').upsert(cambios, { onConflict: 'empresa_id,anio,estado,numero' });
      guardar.disabled = false;
      if (error) { toast(traducirError(error), 'error'); return; }
      cerrar(); toast('Cifras del año anterior guardadas.', 'ok'); pintar();
    });
    restablecer.addEventListener('click', async () => {
      if (!window.confirm('¿Quitar todas las cifras manuales de este estado? Volverán las que calcula el sistema.')) return;
      const { error } = await db.from('cifras_anteriores').delete()
        .eq('empresa_id', id).eq('anio', est.anio).eq('estado', tipo);
      if (error) { toast(traducirError(error), 'error'); return; }
      cerrar(); toast('Se quitaron las cifras manuales.', 'ok'); pintar();
    });
    const cerrar = modal(`Cifras del año ${est.anio - 1}`, h('div', null,
      h('p', { class: 'ayuda' }, 'Escribe solo lo que quieras cambiar. Lo que dejes igual sigue saliendo del sistema.' +
        (tipo === 'patrimonio' ? ' Los retiros van en negativo.' : '')),
      caja, extra, h('div', { class: 'acciones' }, guardar, restablecer)));
  }

  /* notas */
  function abrirNota(n) {
    const area = h('textarea', { rows: '10' }, n.texto);
    const guardar = h('button', { class: 'btn', type: 'button' }, 'Guardar nota');
    guardar.addEventListener('click', async () => {
      const t = texto(area.value);
      if (!t) { toast('La nota no puede quedar vacía.', 'error'); return; }
      guardar.disabled = true;
      const { error } = await db.from('notas_eeff').update({ texto: t }).eq('id', n.id);
      guardar.disabled = false;
      if (error) { toast(traducirError(error), 'error'); return; }
      cerrar(); toast('Nota guardada.', 'ok'); pintar();
    });
    const cerrar = modal(n.titulo, h('div', null, area, h('div', { class: 'acciones' }, guardar)));
  }

  async function construirNotas() {
    const { notas, detalles } = await cargarNotas();
    const generar = h('button', { class: 'btn btn-sec', type: 'button' }, notas.length ? 'Generar notas que falten' : 'Generar notas');
    generar.addEventListener('click', async () => {
      generar.disabled = true;
      const { data, error } = await db.rpc('generar_notas', { p_empresa: id, p_anio: est.anio });
      generar.disabled = false;
      if (error) { toast(traducirError(error), 'error'); return; }
      toast(data ? `Se crearon ${data} notas.` : 'Ya estaban todas las notas.', 'ok');
      pintar();
    });
    const tarjetas = notas.map((n, i) => {
      const det = (detalles[n.clave] || []).filter((r) => r.fila !== 'control');
      return h('div', { class: 'tarjeta' },
        h('h2', null, `Nota ${i + 1}. ${n.titulo}`),
        h('p', { class: 'nota-texto' }, n.texto),
        det.length ? h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla estado' },
          h('thead', null, h('tr', null, h('th', null, 'Concepto'), h('th', { class: 'num' }, String(est.anio)), h('th', { class: 'num' }, String(est.anio - 1)))),
          h('tbody', null, det.map((r) => h('tr', { class: 'fila-' + r.fila },
            h('td', null, r.concepto), h('td', { class: 'num' }, n2(r.actual)), h('td', { class: 'num' }, n2(r.anterior))))))) : null,
        h('div', { class: 'acciones' }, h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: () => abrirNota(n) }, 'Editar texto')));
    });
    return {
      nodo: h('div', null,
        h('div', { class: 'acciones' }, generar),
        notas.length ? tarjetas : h('p', { class: 'ayuda' }, 'Todavía no hay notas para este año. Toca "Generar notas" para crearlas con los datos de la empresa; después puedes editar el texto.')),
      spec: notas.length ? specNotas(notas, detalles, est.anio) : null
    };
  }

  async function construirEstado() {
    const rows = await cargarEstado(est.tipo);
    const tipo = est.tipo;
    const hay = rows.some((r) => r.fila === 'detalle');
    const fiscal = tipo === 'balance' ? await cargarCierreFiscal(id, est.anio) : null;
    const nodo = h('div', null,
      h('div', { class: 'acciones' },
        h('button', { class: 'btn btn-sec', type: 'button', onclick: () => abrirAnteriores(tipo, rows).catch((er) => toast(traducirError(er), 'error')) }, `Cifras del año ${est.anio - 1}`)),
      avisoControl(rows),
      hay ? tablaEstado(tipo, rows) : h('p', { class: 'ayuda' }, 'No hay cifras para este año. Registra transacciones y, si ya terminó el año, haz el cierre anual.'),
      hay ? tarjetaCierreFiscal(fiscal, est.anio) : null);
    return { nodo, spec: hay ? specEstado(tipo, rows, est.anio) : null, fiscal };
  }

  // Paquete completo: los cuatro estados y las notas en un solo archivo
  async function paqueteCompleto() {
    const specs = [];
    for (const t of ['balance', 'resultados', 'patrimonio', 'flujo']) {
      const rows = await cargarEstado(t);
      if (rows.some((r) => r.fila === 'detalle')) specs.push(specEstado(t, rows, est.anio));
      if (t === 'balance') {
        const fz = await cargarCierreFiscal(id, est.anio);
        if (fz && rows.some((r) => r.fila === 'detalle')) specs.push(specCierreFiscal(fz, est.anio, empresa.razon_social));
      }
    }
    const { notas, detalles } = await cargarNotas();
    if (notas.length) specs.push(specNotas(notas, detalles, est.anio));
    return specs.length ? { specs, archivo: `${empresa.razon_social}-estados-financieros-${est.anio}` } : null;
  }

  async function pintar() {
    zona.replaceChildren(cargando());
    try {
      const r = est.tipo === 'notas' ? await construirNotas() : await construirEstado();
      est.actual = r;
      zona.replaceChildren(
        h('div', { class: 'barra-exportar' },
          barraExportar({
            empresa,
            obtener: () => (est.actual && est.actual.spec
              ? { specs: [est.actual.spec].concat(est.actual.fiscal ? [specCierreFiscal(est.actual.fiscal, est.anio, empresa.razon_social)] : []),
                archivo: `${empresa.razon_social}-${est.tipo}-${est.anio}` } : null)
          }),
          h('p', { class: 'ayuda' }, 'Paquete completo (los cuatro estados y las notas en un solo archivo):'),
          barraExportar({ empresa, obtener: paqueteCompleto, etiquetaExcel: 'Todo en Excel', etiquetaPdf: 'Todo en PDF' })),
        r.nodo);
    } catch (e) {
      est.actual = null;
      zona.replaceChildren(h('div', { class: 'tarjeta error' }, h('p', null, traducirError(e))));
    }
  }

  function armarBarra() {
    barra.replaceChildren(
      h('select', { value: est.tipo, onchange: (e) => { est.tipo = e.target.value; pintar(); } },
        TIPOS.map(([k, t]) => h('option', { value: k }, t))),
      h('input', {
        type: 'number', min: '2000', max: '2100', step: '1', inputmode: 'numeric', value: String(est.anio),
        onchange: (e) => { const v = Number(e.target.value); if (v >= 2000 && v <= 2100) { est.anio = v; pintar(); } }
      }));
  }

  armarBarra();
  mostrar(marcoEmpresa(empresa, 'estados', [
    h('p', { class: 'ayuda' }, 'Año del estado (el comparativo es el año anterior). Si todavía no cerraste el año, la utilidad del ejercicio aparece como "pendiente de cierre".'),
    barra, zona]));
  pintar();
}

// FIN DEL ARCHIVO estados.js
