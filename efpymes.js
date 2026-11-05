// Pestaña "Estados Financieros Pymes": situación financiera, resultados, cambios en el patrimonio,
// flujos de efectivo, notas editables y certificaciones del contador (elaboración y entrega).
// Las cifras salen de las mismas funciones que alimentan la pestaña "Estados financieros"; aquí solo se
// ordenan, se enlazan con sus notas y se exportan. Las cifras del año anterior se pueden escribir a mano
// con el lápiz (se guardan en cifras_anteriores, igual que en la otra pestaña).
import {
  db, h, mostrar, toast, modal, campo, texto, traducirError, cargando, marcoEmpresa, cargarEmpresa, hoy, redondear
} from './lib.js';
import { descargar } from './exportar.js';
import { construirPdfPymes, construirXlsxPymes, MIME_XLSX } from './efpymespdf.js';
import { construirTodo, pendientesPorCompletar } from './efpymesdatos.js';
import {
  CAMPOS, GENERALES_CONTADOR, TEXTO_DEFECTO, camposPorDefecto, generalesPorDefecto, construirCarta
} from './efpymescert.js';

const TIPOS = [
  ['balance', 'Situación financiera'],
  ['resultados', 'Resultados'],
  ['patrimonio', 'Cambios en el patrimonio'],
  ['flujo', 'Flujos de efectivo'],
  ['notas', 'Notas'],
  ['certificaciones', 'Certificaciones']
];
const FUNCIONES = {
  balance: 'estado_balance_general', resultados: 'estado_resultados',
  patrimonio: 'estado_cambios_patrimonio', flujo: 'estado_flujo_efectivo'
};
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
  if (v === null || v === undefined) return '';
  const x = redondear(NUM(v));
  if (Math.abs(x) < 0.005) return '–';
  const t = Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return x < 0 ? `(${t})` : t;
};
const celdaNum = (f, v) => (v === null || v === undefined ? '' : (f && f.f === 'pct' ? `${NUM(v).toFixed(2)} %` : n2(v)));

// Clave con la que se guarda la cifra manual del año anterior de una fila (o null si no se puede editar)
function claveFila(tipo, f) {
  if (f.k !== 'det') return null;
  if (tipo === 'balance' || tipo === 'resultados') {
    if (f.numero) return f.numero;
    if (tipo === 'resultados' && /^seguro educativo$/i.test(f.c || '')) return 'SEGURO_EDUCATIVO';
    if (tipo === 'resultados' && /^impuesto sobre la renta$/i.test(f.c || '')) return 'ISR_RENTA';
    if (tipo === 'balance' && /pendiente de cierre/i.test(f.c || '')) return 'UTILIDAD_PENDIENTE';
    return null;
  }
  if (tipo === 'flujo') return CLAVES.flujo[f.orden] || null;
  return null;
}

// Texto con **negrita** y los avisos [Completar: …] resaltados
function rico(t) {
  return String(t || '').split(/(\*\*[^*]+\*\*|\[(?:Completar|Confirmar)[^\]]*\])/g).filter((x) => x !== '').map((x) => {
    if (x.startsWith('**')) return h('strong', null, x.slice(2, -2));
    if (/^\[(Completar|Confirmar)/.test(x)) return h('mark', { style: 'background:#fff1b8;padding:0 2px;border-radius:3px' }, x);
    return x;
  });
}

const nombreArchivo = (s) => String(s || 'estados').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60) || 'estados';

export async function vistaEstadosPymes(id) {
  mostrar(marcoEmpresa({ id, razon_social: '…' }, 'efpymes', cargando()));
  const empresa = await cargarEmpresa(id);
  const puede = empresa.rol === 'admin' || empresa.rol === 'contador';
  const est = { anio: Number(hoy().slice(0, 4)), tipo: 'balance', modelo: null, ctx: null, certs: {}, manuales: new Set() };
  const barra = h('div', { class: 'filtros' });
  const zona = h('div');
  const meta = () => ({ empresa: { razon_social: empresa.razon_social, ruc: empresa.ruc, dv: empresa.dv } });

  /* ------------------------------- datos ------------------------------- */
  const falta = (e) => e && (e.code === 'PGRST202' || e.code === '42P01' || e.code === 'PGRST205' || /efpymes/.test(e.message || ''));

  async function cargarDatos() {
    const anio = est.anio;
    const rpc = (t, a) => db.rpc(FUNCIONES[t], { p_empresa: id, p_anio: a });
    const [bal, res, pat, flu, balPrev] = await Promise.all([rpc('balance', anio), rpc('resultados', anio), rpc('patrimonio', anio), rpc('flujo', anio), rpc('balance', anio - 1)]);
    for (const r of [bal, res, pat, flu, balPrev]) if (r.error) throw r.error;
    const prefijos = new Set(['6.1.06.']);
    [...(bal.data || []), ...(res.data || [])].forEach((r) => { if (r.numero) prefijos.add(`${r.numero}.`); });
    const [det, notas, cifras, cont, certs] = await Promise.all([
      db.rpc('efpymes_detalle', { p_empresa: id, p_anio: anio, p_prefijos: [...prefijos] }),
      db.from('efpymes_notas').select('clave, titulo, texto, tabla').eq('empresa_id', id).eq('anio', anio),
      db.from('cifras_anteriores').select('estado, numero').eq('empresa_id', id).eq('anio', anio),
      db.from('efpymes_contador').select('datos').maybeSingle(),
      db.from('efpymes_certificados').select('tipo, datos').eq('empresa_id', id).eq('anio', anio)
    ]);
    for (const r of [det, notas, cont, certs]) if (r.error) throw r.error;
    const over = new Map((notas.data || []).map((n) => [n.clave, { titulo: n.titulo, texto: n.texto, tabla: n.tabla }]));
    est.manuales = new Set((cifras.data || []).map((c) => `${c.estado}|${c.numero}`));
    est.certs = {};
    (certs.data || []).forEach((c) => { est.certs[c.tipo] = c.datos || {}; });
    est.ctx = {
      empresa, anio, bal: bal.data || [], res: res.data || [], pat: pat.data || [], flu: flu.data || [], balPrev: balPrev.data || [],
      det: det.data || [], over, hayManuales: est.manuales.size > 0, contador: (cont.data && cont.data.datos) || {}
    };
    est.modelo = construirTodo(est.ctx);
  }

  const hayCifras = () => est.ctx.bal.some((r) => r.fila === 'detalle');
  const cartas = () => ({
    elaboracion: construirCarta('elaboracion', est.ctx, est.certs.elaboracion),
    entrega: construirCarta('entrega', est.ctx, est.certs.entrega)
  });

  /* ------------------------- cifras del año anterior ------------------------- */
  function abrirCifras(tipo, items) {
    const entradas = items.map((it) => {
      const input = h('input', { type: 'number', step: '0.01', inputmode: 'decimal', value: String(redondear(NUM(it.valor))) });
      return { ...it, input, inicial: redondear(NUM(it.valor)) };
    });
    const hayManual = entradas.some((e) => est.manuales.has(`${tipo}|${e.clave}`));
    const guardar = h('button', { class: 'btn', type: 'button' }, 'Guardar');
    guardar.addEventListener('click', async () => {
      const cambios = entradas.filter((e) => e.input.value !== '' && redondear(Number(e.input.value)) !== e.inicial)
        .map((e) => ({ empresa_id: id, anio: est.anio, estado: tipo, numero: e.clave, monto: redondear(Number(e.input.value)) }));
      if (!cambios.length) { toast('No hay cambios que guardar.', 'error'); return; }
      guardar.disabled = true;
      const { error } = await db.from('cifras_anteriores').upsert(cambios, { onConflict: 'empresa_id,anio,estado,numero' });
      guardar.disabled = false;
      if (error) { toast(traducirError(error), 'error'); return; }
      cerrar(); toast(`Cifra del año ${est.anio - 1} guardada.`, 'ok'); pintar(true);
    });
    const quitar = hayManual ? h('button', { class: 'btn btn-sec', type: 'button' }, 'Volver a la cifra del sistema') : null;
    if (quitar) {
      quitar.addEventListener('click', async () => {
        const { error } = await db.from('cifras_anteriores').delete().eq('empresa_id', id).eq('anio', est.anio).eq('estado', tipo)
          .in('numero', entradas.map((e) => e.clave));
        if (error) { toast(traducirError(error), 'error'); return; }
        cerrar(); toast('Se quitó la cifra manual.', 'ok'); pintar(true);
      });
    }
    const cerrar = modal(`Cifras del año ${est.anio - 1}`, h('div', null,
      h('p', { class: 'ayuda' }, 'Escribe la cifra del año anterior. Es la misma que se usa en la pestaña "Estados financieros", así que ambas quedan iguales.' + (tipo === 'patrimonio' ? ' Los retiros van en negativo.' : '')),
      entradas.map((e) => h('div', { class: 'fila-ant' }, h('span', null, e.concepto, est.manuales.has(`${tipo}|${e.clave}`) ? h('span', { class: 'insignia aviso' }, 'manual') : null), e.input)),
      h('div', { class: 'acciones' }, guardar, quitar)));
  }

  const lapiz = (tipo, clave, concepto, valor) => (!puede || !clave ? null : h('button', {
    class: 'btn-icono', type: 'button', title: `Escribir a mano la cifra de ${est.anio - 1}`, 'aria-label': 'Editar cifra del año anterior',
    style: est.manuales.has(`${tipo}|${clave}`) ? 'color:#b45309' : '',
    onclick: () => abrirCifras(tipo, [{ clave, concepto, valor }])
  }, '✎'));

  /* ------------------------------ estados en pantalla ------------------------------ */
  function tablaEstado(doc) {
    const tipo = doc.clave;
    const [A, P] = doc.anios;
    return h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla estado' },
      h('thead', null, h('tr', null, h('th', null, 'Concepto'), h('th', null, 'Nota'), h('th', { class: 'num' }, String(A)), h('th', { class: 'num' }, String(P)))),
      h('tbody', null, doc.filas.map((f) => {
        if (f.k === 'titulo' || f.k === 'sub') return h('tr', { class: 'fila-titulo' }, h('td', { colspan: 4 }, f.k === 'sub' ? h('em', null, f.c) : f.c));
        if (f.k === 'texto') return h('tr', null, h('td', { colspan: 4, class: 'ayuda' }, f.c));
        const clase = f.k === 'det' ? 'fila-detalle' : 'fila-' + f.k;
        const clave = claveFila(tipo, f);
        return h('tr', { class: clase },
          h('td', { style: f.n ? `padding-left:${8 + 14 * f.n}px` : '' }, f.c),
          h('td', null, f.nota || ''),
          h('td', { class: 'num' }, celdaNum(f, f.a)),
          h('td', { class: 'num' }, celdaNum(f, f.p), ' ', lapiz(tipo, clave, f.numero ? `${f.numero} ${f.c}` : f.c, f.p)));
      }))));
  }

  function tablaMatriz(doc) {
    const bloques = doc.bloques.map((b) => h('div', null,
      h('h3', null, b.titulo),
      h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla estado' },
        h('thead', null, h('tr', null, h('th', null, 'Concepto'), doc.columnas.map((c) => h('th', { class: 'num' }, c)))),
        h('tbody', null, b.filas.map((f) => h('tr', { class: f.k === 'det' ? 'fila-detalle' : 'fila-' + f.k },
          h('td', null, f.c), f.v.map((v) => h('td', { class: 'num' }, celdaNum(null, v))))))))));
    const items = est.ctx.pat.filter((r) => CLAVES.patrimonio[NUM(r.orden)]).map((r) => ({ clave: CLAVES.patrimonio[NUM(r.orden)], concepto: r.concepto, valor: r.anterior }));
    return h('div', null,
      puede ? h('div', { class: 'acciones' }, h('button', { class: 'btn btn-sec', type: 'button', onclick: () => abrirCifras('patrimonio', items) }, `✎ Cifras del año ${est.anio - 1}`)) : null,
      bloques, doc.pie ? h('p', { class: 'ayuda' }, doc.pie) : null);
  }

  function pantallaEstado(tipo) {
    const doc = est.modelo.docs[tipo];
    if (!hayCifras()) return h('p', { class: 'ayuda' }, 'No hay cifras para este año. Registra transacciones y, si ya terminó el año, haz el cierre anual.');
    if (doc.tipo === 'matriz') return tablaMatriz(doc);
    return h('div', null,
      h('p', { class: 'ayuda' }, `${doc.subtitulo}. Cifras en balboas (B/.). La columna "Nota" indica qué nota explica cada partida.` + (puede ? ` El lápiz ✎ permite escribir a mano la cifra de ${est.anio - 1}.` : '')),
      tablaEstado(doc), doc.pie ? h('p', { class: 'ayuda' }, doc.pie) : null);
  }

  /* ------------------------------------ notas ------------------------------------ */
  function abrirNota(n) {
    const titulo = h('input', { type: 'text', value: n.titulo });
    const area = h('textarea', { rows: '14' }, n.texto);
    let filas = (n.tabla || []).map((f) => ({ ...f }));
    let tablaEditada = n.editadaTabla;
    const caja = h('div');
    const pintarFilas = () => {
      caja.replaceChildren(...filas.map((f, i) => {
        const inp = (col) => h('input', {
          type: 'number', step: '0.01', inputmode: 'decimal', value: f[col] === null || f[col] === undefined ? '' : String(f[col]),
          oninput: (e) => { f[col] = e.target.value === '' ? null : Number(e.target.value); tablaEditada = true; }
        });
        return h('div', { class: 'fila-ant', style: 'display:grid;grid-template-columns:1fr 90px 90px auto;gap:6px;align-items:center' },
          h('input', { type: 'text', value: f.c || '', oninput: (e) => { f.c = e.target.value; tablaEditada = true; } }),
          inp('a'), inp('p'),
          h('button', { class: 'btn-icono', type: 'button', title: 'Quitar fila', onclick: () => { filas.splice(i, 1); tablaEditada = true; pintarFilas(); } }, '✕'));
      }));
    };
    pintarFilas();
    const agregar = h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: () => { filas.push({ k: 'det', c: '', a: null, p: null }); tablaEditada = true; pintarFilas(); } }, 'Agregar fila');
    const restSistema = h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: () => { filas = n.tablaSistema.map((f) => ({ ...f })); tablaEditada = false; pintarFilas(); toast('Cuadro con las cifras del sistema. Guarda para confirmar.', 'info'); } }, 'Volver a las cifras del sistema');
    const restTexto = h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: () => { area.value = n.textoInicial; titulo.value = n.tituloInicial; } }, 'Restaurar el texto original');
    const guardar = h('button', { class: 'btn', type: 'button' }, 'Guardar nota');
    guardar.addEventListener('click', async () => {
      const t = texto(area.value);
      if (!t) { toast('La nota no puede quedar vacía.', 'error'); return; }
      const reg = {
        empresa_id: id, anio: est.anio, clave: n.clave,
        titulo: titulo.value.trim() && titulo.value.trim() !== n.tituloInicial ? titulo.value.trim() : null,
        texto: t !== n.textoInicial ? t : null,
        tabla: tablaEditada ? filas.filter((f) => (f.c || '').trim() || f.a !== null || f.p !== null) : null,
        actualizado_en: new Date().toISOString()
      };
      guardar.disabled = true;
      let error;
      if (reg.titulo === null && reg.texto === null && reg.tabla === null) {
        ({ error } = await db.from('efpymes_notas').delete().eq('empresa_id', id).eq('anio', est.anio).eq('clave', n.clave));
      } else {
        ({ error } = await db.from('efpymes_notas').upsert(reg, { onConflict: 'empresa_id,anio,clave' }));
      }
      guardar.disabled = false;
      if (error) { toast(traducirError(error), 'error'); return; }
      cerrar(); toast('Nota guardada.', 'ok'); pintar(true);
    });
    const cerrar = modal(`Nota ${n.num}`, h('div', null,
      campo('Título', titulo),
      campo('Texto', area, 'Separa los párrafos con una línea en blanco. Usa **así** para negritas. Los avisos [Completar: …] se reemplazan con tu información.'),
      h('div', { class: 'acciones' }, restTexto),
      n.tablaSistema.length || filas.length ? h('div', null,
        h('h3', null, 'Cuadro de cifras'),
        h('p', { class: 'ayuda' }, 'Columnas: concepto, ' + est.anio + ' y ' + (est.anio - 1) + '. Si cambias una cifra, el cuadro queda como lo escribiste y ya no sigue al sistema hasta que lo restaures.'),
        caja, h('div', { class: 'acciones' }, agregar, restSistema)) : h('div', null, h('div', { class: 'acciones' }, agregar), caja),
      h('div', { class: 'acciones' }, guardar)));
  }

  function pantallaNotas() {
    const { lista } = est.modelo;
    const pend = pendientesPorCompletar(lista);
    const tarjetas = lista.map((n) => h('div', { class: 'tarjeta' },
      h('h2', null, `Nota ${n.num}. ${n.titulo}`, n.editadaTexto || n.editadaTabla ? h('span', { class: 'insignia aviso' }, 'editada') : null),
      n.ref ? h('p', { class: 'ayuda' }, `Referencia: ${n.ref}`) : null,
      String(n.texto).split(/\n{2,}/).filter((x) => x.trim()).map((p) => h('p', { class: 'nota-texto' }, rico(p))),
      n.tabla && n.tabla.length ? h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla estado' },
        h('thead', null, h('tr', null, h('th', null, 'Concepto'), h('th', { class: 'num' }, String(est.anio)), h('th', { class: 'num' }, String(est.anio - 1)))),
        h('tbody', null, n.tabla.map((f) => (f.k === 'titulo' || f.k === 'sub' && f.a === undefined
          ? h('tr', { class: 'fila-titulo' }, h('td', { colspan: 3 }, f.c))
          : h('tr', { class: f.k === 'det' ? 'fila-detalle' : 'fila-' + f.k },
            h('td', { style: f.n ? `padding-left:${8 + 14 * f.n}px` : '' }, f.c),
            h('td', { class: 'num' }, celdaNum(f, f.a)), h('td', { class: 'num' }, celdaNum(f, f.p)))))))) : null,
      puede ? h('div', { class: 'acciones' }, h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: () => abrirNota(n) }, '✎ Editar nota')) : null));
    return h('div', null,
      pend ? h('div', { class: 'aviso-lectura' }, h('strong', null, `Faltan ${pend} dato${pend === 1 ? '' : 's'} por completar en las notas.`),
        h('p', null, 'Están marcados como [Completar: …] o [Confirmar: …] (resaltados en amarillo). Edita la nota y escribe la información real antes de entregar los estados.'))
        : h('p', { class: 'ayuda' }, 'No quedan avisos por completar en las notas.'),
      tarjetas);
  }

  /* ----------------------------- certificaciones ----------------------------- */
  function abrirGenerales() {
    const g = generalesPorDefecto(est.ctx.contador);
    const inputs = GENERALES_CONTADOR.map(([k, e]) => ({ k, input: h('input', { type: 'text', value: g[k] || '' }), e }));
    const guardar = h('button', { class: 'btn', type: 'button' }, 'Guardar mis generales');
    guardar.addEventListener('click', async () => {
      const datos = {}; inputs.forEach(({ k, input }) => { datos[k] = input.value.trim(); });
      guardar.disabled = true;
      try {
        const { data: u } = await db.auth.getUser();
        const { error } = await db.from('efpymes_contador').upsert({ user_id: u.user.id, datos, actualizado_en: new Date().toISOString() }, { onConflict: 'user_id' });
        if (error) throw error;
        cerrar(); toast('Tus generales quedaron guardados para todas tus empresas.', 'ok'); pintar(true);
      } catch (e) { toast(traducirError(e), 'error'); }
      guardar.disabled = false;
    });
    const cerrar = modal('Mis generales (contador)', h('div', null,
      h('p', { class: 'ayuda' }, 'Se escriben una sola vez y se usan en las certificaciones, en la portada y en la firma de los estados de todas tus empresas.'),
      inputs.map(({ e, input }) => campo(e, input)), h('div', { class: 'acciones' }, guardar)));
  }

  function tarjetaCert(tipo, titulo, ayuda) {
    const guardado = est.certs[tipo] || {};
    const valores = camposPorDefecto(tipo, est.ctx, guardado.campos);
    const inputs = CAMPOS[tipo].map(([k, e]) => ({ k, e, input: h('input', { type: 'text', value: valores[k] || '', disabled: !puede }) }));
    const area = h('textarea', { rows: '18', disabled: !puede }, guardado.texto || TEXTO_DEFECTO[tipo]);
    const reunir = () => {
      const campos = {}; inputs.forEach(({ k, input }) => { campos[k] = input.value.trim(); });
      return { campos, texto: area.value.trim() === TEXTO_DEFECTO[tipo].trim() ? '' : area.value };
    };
    const guardar = h('button', { class: 'btn', type: 'button' }, 'Guardar');
    guardar.addEventListener('click', async () => {
      guardar.disabled = true;
      const { error } = await db.from('efpymes_certificados').upsert(
        { empresa_id: id, anio: est.anio, tipo, datos: reunir(), actualizado_en: new Date().toISOString() },
        { onConflict: 'empresa_id,anio,tipo' });
      guardar.disabled = false;
      if (error) { toast(traducirError(error), 'error'); return; }
      est.certs[tipo] = reunir(); toast('Certificación guardada.', 'ok');
    });
    const rest = h('button', { class: 'btn btn-sec', type: 'button', onclick: () => { area.value = TEXTO_DEFECTO[tipo]; } }, 'Restaurar texto original');
    const docActual = () => construirCarta(tipo, { ...est.ctx }, reunir());
    const salida = (modo) => async (ev) => {
      const b = ev && ev.target; if (b) b.disabled = true;
      try { await emitir([docActual()], 'pdf', modo, `${empresa.razon_social}-${tipo === 'elaboracion' ? 'certificacion-contador' : 'recibido-conforme'}-${est.anio}`); } catch (e) { toast('No se pudo crear el archivo: ' + traducirError(e), 'error'); }
      if (b) b.disabled = false;
    };
    return h('div', { class: 'tarjeta' },
      h('h2', null, titulo), h('p', { class: 'ayuda' }, ayuda),
      inputs.map(({ e, input }) => campo(e, input)),
      campo('Texto de la certificación', area, 'Las marcas entre llaves, como {entidad} o {fecha}, se reemplazan con los datos de arriba al generar el PDF. Los párrafos se separan con una línea en blanco; **así** va en negrita; "# Título" va centrado.'),
      h('div', { class: 'acciones' }, puede ? guardar : null, puede ? rest : null,
        h('button', { class: 'btn btn-sec', type: 'button', onclick: salida('descargar') }, 'Descargar PDF'),
        h('button', { class: 'btn btn-sec', type: 'button', onclick: salida('compartir') }, 'Compartir PDF')));
  }

  function pantallaCerts() {
    const g = generalesPorDefecto(est.ctx.contador);
    return h('div', null,
      h('p', { class: 'ayuda' }, 'Dos documentos en PDF, con tu logo y el de la empresa si lo tiene, firmados por ti como contador idóneo. Todo el texto es editable.'),
      puede ? h('div', { class: 'acciones' }, h('button', { class: 'btn btn-sec', type: 'button', onclick: abrirGenerales }, 'Mis generales (idoneidad, cédula, contacto)')) : null,
      !g.idoneidad ? h('div', { class: 'aviso-lectura' }, h('strong', null, 'Falta tu número de idoneidad.'), h('p', null, 'Escríbelo en "Mis generales" una sola vez y saldrá en todas las certificaciones y firmas.')) : null,
      tarjetaCert('elaboracion', 'Certificación de elaboración de la contabilidad y de los estados financieros', 'Certifica que llevaste la contabilidad y preparaste los estados financieros, con el alcance de tu trabajo y la responsabilidad de la administración.'),
      tarjetaCert('entrega', 'Acta de entrega y recibido conforme', 'Deja constancia de la entrega de los documentos, con las generales del cliente, su firma y la fecha y hora en que los recibe.'));
  }

  /* ------------------------------------ salida ------------------------------------ */
  async function emitir(docs, formato, modo, archivo) {
    const pdf = formato === 'pdf';
    const bytes = pdf ? construirPdfPymes(docs, meta()) : construirXlsxPymes(docs, meta());
    const nombre = nombreArchivo(archivo) + (pdf ? '.pdf' : '.xlsx');
    const mime = pdf ? 'application/pdf' : MIME_XLSX;
    if (modo === 'compartir') {
      const f = new File([bytes], nombre, { type: mime });
      try {
        if (navigator.canShare && navigator.canShare({ files: [f] })) {
          await navigator.share({ files: [f], title: docs[0].titulo || 'Estados financieros', text: `${docs[0].titulo || 'Estados financieros'} · ${empresa.razon_social}` });
          toast('Listo para enviar.', 'ok'); return;
        }
      } catch (e) { if (e && e.name === 'AbortError') return; }
      descargar(bytes, nombre, mime);
      toast('Este aparato no puede compartir archivos; se descargó para que lo adjuntes.', 'info'); return;
    }
    descargar(bytes, nombre, mime);
    toast(`Se descargó ${nombre}`, 'ok');
  }

  function docsDeSeccion() {
    const d = est.modelo.docs;
    if (est.tipo === 'certificaciones') { const c = cartas(); return [c.elaboracion, c.entrega]; }
    return [d[est.tipo]];
  }
  const paquete = (conCerts) => {
    const d = est.modelo.docs; const c = cartas();
    return conCerts ? [d.portada, c.elaboracion, d.balance, d.resultados, d.patrimonio, d.flujo, d.notas, c.entrega]
      : [d.portada, d.balance, d.resultados, d.patrimonio, d.flujo, d.notas];
  };

  function barraSalida() {
    const boton = (txt, fn) => h('button', {
      class: 'btn btn-sec', type: 'button',
      onclick: async (ev) => {
        const b = ev.target; b.disabled = true;
        try { await fn(); } catch (e) { toast('No se pudo crear el archivo: ' + traducirError(e), 'error'); }
        b.disabled = false;
      }
    }, txt);
    const base = `${empresa.razon_social}-${est.tipo}-${est.anio}`;
    const seccion = est.tipo !== 'certificaciones' ? h('div', { class: 'acciones' },
      boton('Descargar PDF', () => emitir(docsDeSeccion(), 'pdf', 'descargar', base)),
      boton('Descargar Excel', () => emitir(docsDeSeccion(), 'xlsx', 'descargar', base)),
      boton('Compartir PDF', () => emitir(docsDeSeccion(), 'pdf', 'compartir', base)),
      boton('Compartir Excel', () => emitir(docsDeSeccion(), 'xlsx', 'compartir', base))) : null;
    const todo = `${empresa.razon_social}-estados-financieros-pymes-${est.anio}`;
    return h('div', { class: 'barra-exportar' }, seccion,
      h('p', { class: 'ayuda' }, 'Paquete completo (portada, los cuatro estados y las notas en un solo archivo):'),
      h('div', { class: 'acciones' },
        boton('Todo en PDF', () => emitir(paquete(false), 'pdf', 'descargar', todo)),
        boton('Todo en Excel', () => emitir(paquete(false), 'xlsx', 'descargar', todo)),
        boton('PDF con certificaciones', () => emitir(paquete(true), 'pdf', 'descargar', todo + '-con-certificaciones')),
        boton('Compartir todo (PDF)', () => emitir(paquete(true), 'pdf', 'compartir', todo))));
  }

  /* ------------------------------------ pantalla ------------------------------------ */
  async function pintar(recargar) {
    if (recargar || !est.ctx || est.ctx.anio !== est.anio) {
      zona.replaceChildren(cargando());
      try { await cargarDatos(); } catch (e) {
        est.ctx = null;
        zona.replaceChildren(h('div', { class: 'tarjeta error' }, h('p', null, falta(e) ? 'Falta ejecutar el archivo 110 en Supabase.' : traducirError(e))));
        return;
      }
    }
    let cuerpo;
    try {
      cuerpo = est.tipo === 'notas' ? pantallaNotas() : est.tipo === 'certificaciones' ? pantallaCerts() : pantallaEstado(est.tipo);
    } catch (e) { cuerpo = h('div', { class: 'tarjeta error' }, h('p', null, traducirError(e))); }
    zona.replaceChildren(hayCifras() || est.tipo === 'certificaciones' ? barraSalida() : '', cuerpo);
  }

  function armarBarra() {
    barra.replaceChildren(
      h('select', { value: est.tipo, onchange: (e) => { est.tipo = e.target.value; pintar(false); } },
        TIPOS.map(([k, t]) => h('option', { value: k, selected: k === est.tipo }, t))),
      h('input', {
        type: 'number', min: '2000', max: '2100', step: '1', inputmode: 'numeric', value: String(est.anio),
        onchange: (e) => { const v = Number(e.target.value); if (v >= 2000 && v <= 2100) { est.anio = v; pintar(true); } }
      }));
  }

  armarBarra();
  mostrar(marcoEmpresa(empresa, 'efpymes', [
    h('p', { class: 'ayuda' }, 'Estados financieros preparados con la NIIF para las PYMES, con las mismas cifras de la pestaña "Estados financieros". Año del estado (el comparativo es el año anterior).'),
    barra, zona]));
  pintar(true);
}

// FIN DEL ARCHIVO efpymes.js
