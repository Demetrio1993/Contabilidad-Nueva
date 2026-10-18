// Importar el libro de Excel (saldos iniciales y transacciones) a la empresa.
// Pantalla dentro de la pestaña Datos. Lee el .xlsx en el teléfono, propone a qué
// cuenta del sistema corresponde cada cuenta del Excel, muestra una revisión y,
// solo si el usuario confirma, carga todo por lotes. Si algo falla, lo deshace.
import { db, h, toast, traducirError, fechaCorta, cargarRol } from './lib.js';
import { confirmar } from './acciones.js';
import { leerLibro } from './xlsxleer.js';
import { elegirHojas, analizarLibro, sugerirMapa, construirFilas } from './importarlogica.js';

const TAM_LOTE = 40;

export function seccionImportar(empresa) {
  const raiz = h('div', { class: 'grupo' });
  const est = {
    fase: 'inicio', archivo: '', analisis: null, cuentasApp: [], cuentasPorId: {},
    mapa: {}, mesesCerrados: new Set(), asientosExistentes: 0, previa: null,
    construido: null, excluidas: new Set(), progreso: '', resultado: null, historial: []
  };

  async function cargarHistorial() {
    const r = await db.from('importaciones')
      .select('id, archivo, filas, estado, creado_en')
      .eq('empresa_id', empresa.id).order('creado_en', { ascending: false }).limit(10);
    est.historial = r.error ? [] : r.data;
  }

  function recalcular() {
    est.construido = construirFilas(est.analisis, est.mapa, {
      cuentasPorId: est.cuentasPorId, mesesCerrados: est.mesesCerrados, contribuyente: !!empresa.contribuyente_itbms
    });
  }

  async function leerArchivo(ev) {
    const archivo = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!archivo) return;
    if (archivo.size > 20 * 1024 * 1024) { toast('El archivo es muy grande (máximo 20 MB).', 'error'); return; }
    est.fase = 'leyendo';
    est.archivo = archivo.name;
    pintar();
    try {
      const buf = await archivo.arrayBuffer();
      const nombres = (await leerLibro(buf, [])).nombres;
      const hojas = elegirHojas(nombres);
      if (!hojas.libro) throw new Error('No encontré una hoja llamada "Libro Transacciones" en este Excel. ¿Es el libro correcto?');
      const libro = await leerLibro(buf, [hojas.libro, hojas.balance, hojas.catalogo].filter(Boolean));
      est.analisis = analizarLibro(libro, hojas);
      if (!est.analisis.filas.length && !est.analisis.apertura) throw new Error('No encontré filas con movimientos en el libro.');

      const [rc, rp, ra, rh] = await Promise.all([
        db.from('cuentas').select('id, numero, nombre, tipo, acepta_movimientos').eq('empresa_id', empresa.id).order('numero'),
        db.from('periodos').select('anio, mes, estado').eq('empresa_id', empresa.id).eq('estado', 'cerrado'),
        db.from('asientos').select('id', { count: 'exact', head: true }).eq('empresa_id', empresa.id),
        db.from('importaciones').select('id, archivo, creado_en').eq('empresa_id', empresa.id).eq('archivo', archivo.name).eq('estado', 'activa').limit(1)
      ]);
      if (rc.error) throw rc.error;
      est.cuentasApp = rc.data;
      est.cuentasPorId = Object.fromEntries(rc.data.map((c) => [c.id, c]));
      est.mesesCerrados = new Set((rp.data || []).map((p) => `${p.anio}-${String(p.mes).padStart(2, '0')}`));
      est.asientosExistentes = ra.count || 0;
      est.previa = rh.data && rh.data[0] ? rh.data[0] : null;
      est.mapa = sugerirMapa(est.analisis.cuentasExcel, est.cuentasApp);
      est.excluidas = new Set();
      recalcular();
      est.fase = 'revision';
    } catch (e) {
      est.fase = 'inicio';
      toast(traducirError(e), 'error');
    }
    pintar();
  }

  function filaCuenta(c) {
    const m = est.mapa[c.codigo];
    const sel = h('select', {
      onchange: (e) => {
        est.mapa[c.codigo] = { id: e.target.value, confianza: e.target.value ? 'manual' : 'ninguna', puntaje: 1 };
        recalcular();
        pintar();
      }
    },
      h('option', { value: '' }, '(elige una cuenta)'),
      est.cuentasApp.filter((x) => x.acepta_movimientos !== false).map((x) =>
        h('option', { value: x.id, selected: x.id === m.id }, `${x.numero} · ${x.nombre}`)));
    sel.value = m.id || '';
    const etiqueta = !m.id ? 'Elige' : m.confianza === 'alta' ? 'Coincide' : m.confianza === 'manual' ? 'Elegida' : 'Revisa';
    return h('div', { class: 'tarjeta' },
      h('div', { class: 'insignias' },
        h('strong', null, `${c.codigo} · ${c.nombre}`),
        h('span', { class: 'insignia' }, `${c.usos} mov.`),
        h('span', { class: 'insignia' }, etiqueta)),
      sel);
  }

  function bloqueProblemas() {
    const filas = est.construido.filas;
    const errores = filas.filter((f) => f.estado === 'error');
    const avisos = filas.filter((f) => f.estado === 'aviso');
    if (!errores.length && !avisos.length) return h('p', { class: 'ayuda' }, 'Todas las filas se leyeron sin problemas.');
    const linea = (f, conCasilla) => h('div', { class: 'tarjeta' },
      h('div', { class: 'insignias' },
        h('strong', null, f.n === 0 ? 'Balance inicial' : `Fila ${f.n} del Excel`),
        h('span', { class: 'insignia' }, f.etiqueta)),
      f.mensajes.map((m) => h('p', { class: f.estado === 'error' ? 'error-texto' : 'ayuda' }, m)),
      conCasilla ? h('label', { class: 'fila-check' },
        h('input', {
          type: 'checkbox', checked: !est.excluidas.has(f.n),
          onchange: (e) => { if (e.target.checked) est.excluidas.delete(f.n); else est.excluidas.add(f.n); pintar(); }
        }),
        h('span', null, 'Incluir esta fila')) : null);
    const tope = 25;
    return h('div', null,
      errores.length ? h('h4', null, `Filas que NO se importarán (${errores.length})`) : null,
      errores.slice(0, tope).map((f) => linea(f, false)),
      errores.length > tope ? h('p', { class: 'ayuda' }, `… y ${errores.length - tope} más.`) : null,
      avisos.length ? h('h4', null, `Filas con aviso (${avisos.length})`) : null,
      avisos.slice(0, tope).map((f) => linea(f, true)),
      avisos.length > tope ? h('p', { class: 'ayuda' }, `… y ${avisos.length - tope} más (se importan todas).`) : null);
  }

  function seleccionadas() {
    return est.construido.filas.filter((f) => f.payload && f.estado !== 'error' && !est.excluidas.has(f.n));
  }

  async function importar() {
    const lista = seleccionadas();
    est.fase = 'importando';
    est.progreso = 'Preparando…';
    pintar();
    let id = null;
    try {
      const r = await db.rpc('iniciar_importacion', { p_empresa: empresa.id, p_archivo: est.archivo });
      if (r.error) throw r.error;
      id = r.data;
      const totales = { transacciones: 0, asientos: 0, terceros_nuevos: 0 };
      for (let i = 0; i < lista.length; i += TAM_LOTE) {
        est.progreso = `Cargando… ${Math.min(i + TAM_LOTE, lista.length)} de ${lista.length}`;
        pintar();
        const lote = lista.slice(i, i + TAM_LOTE).map((f) => f.payload);
        const rl = await db.rpc('importar_lote', { p_importacion: id, p_filas: lote });
        if (rl.error) throw rl.error;
        totales.transacciones += rl.data.transacciones;
        totales.asientos += rl.data.asientos;
        totales.terceros_nuevos += rl.data.terceros_nuevos;
      }
      est.resultado = totales;
      est.fase = 'listo';
      toast('Importación terminada.', 'ok');
    } catch (e) {
      if (id) {
        est.progreso = 'Hubo un error; deshaciendo lo que se había cargado…';
        pintar();
        await db.rpc('deshacer_importacion', { p_importacion: id });
      }
      est.fase = 'revision';
      toast('No se importó nada: ' + traducirError(e), 'error');
    }
    await cargarHistorial();
    pintar();
  }

  function bloqueHistorial() {
    if (!est.historial.length) return null;
    return h('div', null,
      h('h4', null, 'Importaciones anteriores'),
      est.historial.map((i) => h('div', { class: 'tarjeta' },
        h('div', { class: 'insignias' },
          h('strong', null, i.archivo || '(sin nombre)'),
          h('span', { class: 'insignia' }, i.estado === 'activa' ? `${i.filas} filas` : 'Deshecha')),
        h('p', { class: 'ayuda' }, fechaCorta((i.creado_en || '').slice(0, 10))),
        i.estado === 'activa' ? h('button', {
          class: 'btn btn-peligro-borde btn-peq', type: 'button',
          onclick: () => confirmar({
            titulo: 'Deshacer importación',
            mensaje: `Se borrarán todos los movimientos, asientos y contactos que cargó "${i.archivo}". Lo que registraste a mano no se toca.`,
            boton: 'Sí, deshacer la importación',
            alConfirmar: async () => {
              const r = await db.rpc('deshacer_importacion', { p_importacion: i.id });
              if (r.error) throw r.error;
              toast('Importación deshecha.', 'ok');
              await cargarHistorial();
              pintar();
            }
          })
        }, 'Deshacer esta importación') : null)));
  }

  const entrada = h('input', { type: 'file', hidden: true, onchange: leerArchivo });

  function pintar() {
    const partes = [h('h3', null, 'Importar desde Excel')];
    if (est.fase === 'inicio' || est.fase === 'listo') {
      if (est.fase === 'listo' && est.resultado) {
        partes.push(h('div', { class: 'aviso-lectura' },
          h('strong', null, 'Importación terminada.'),
          h('p', null, `Se cargaron ${est.resultado.transacciones} transacciones y ${est.resultado.asientos} asientos, y se crearon ${est.resultado.terceros_nuevos} clientes o proveedores nuevos.`),
          h('p', { class: 'ayuda' }, 'Revisa Transacciones, Informes (diario y balance de comprobación) y compáralo con tu Excel. Si algo no cuadra, puedes deshacer la importación abajo y repetirla.')));
      }
      partes.push(
        h('p', { class: 'ayuda' }, 'Carga el libro de tu Excel (hoja "Libro Transacciones", con el "Balance Inicial" y el "Catálogo de cuentas") en esta empresa. El sistema empareja cada cuenta del Excel con la del catálogo, crea los clientes y proveedores, y registra los movimientos. Antes de guardar te muestra todo para que lo revises.'),
        h('button', { class: 'btn btn-bloque', type: 'button', onclick: () => entrada.click() }, 'Elegir archivo de Excel'),
        entrada,
        bloqueHistorial());
    } else if (est.fase === 'leyendo') {
      partes.push(h('p', { class: 'cargando' }, 'Leyendo el Excel…'));
    } else if (est.fase === 'revision') {
      const r = est.construido.resumen;
      const sel = seleccionadas();
      const faltan = est.analisis.cuentasExcel.filter((c) => !est.mapa[c.codigo].id);
      const nTrx = sel.filter((f) => f.clase === 'trx').length;
      const nAs = sel.filter((f) => f.clase === 'asiento' || f.clase === 'apertura').length;
      partes.push(
        h('p', null, h('strong', null, est.archivo)),
        h('p', { class: 'ayuda' }, `Encontré ${r.filas} movimientos${est.analisis.apertura ? ' y un balance inicial con ' + est.analisis.apertura.lineas.length + ' cuentas' : ''}. Se cargarían ${nTrx} transacciones y ${nAs} asientos, con unos ${r.contactos} clientes o proveedores.`),
        est.asientosExistentes > 0 ? h('p', { class: 'error-texto' }, `Esta empresa ya tiene ${est.asientosExistentes} asientos. La importación se suma a lo que ya hay: si ya cargaste estos datos, se duplicarían.`) : null,
        est.previa ? h('p', { class: 'error-texto' }, `Ya hay una importación activa con un archivo del mismo nombre (${fechaCorta((est.previa.creado_en || '').slice(0, 10))}). Si la repites, se duplicará.`) : null,
        h('h4', null, `1. Cuentas del Excel (${est.analisis.cuentasExcel.length})`),
        h('p', { class: 'ayuda' }, 'Revisa a qué cuenta del sistema va cada una. Las que dicen "Coincide" las encontró por el nombre; corrige las que no te parezcan.'),
        est.analisis.cuentasExcel.map(filaCuenta),
        h('h4', null, '2. Revisión de las filas'),
        bloqueProblemas(),
        faltan.length ? h('p', { class: 'error-texto' }, `Falta asignar ${faltan.length} cuenta(s) para poder importar.`) : null,
        h('button', {
          class: 'btn btn-bloque', type: 'button', disabled: faltan.length > 0 || sel.length === 0,
          onclick: () => confirmar({
            titulo: 'Importar al sistema',
            mensaje: `Se cargarán ${nTrx} transacciones y ${nAs} asientos${r.errores ? ` (${r.errores} filas con error se omiten)` : ''}. Todo se carga junto: si algo falla, no queda nada. Después puedes deshacerlo.`,
            boton: 'Importar ahora', peligro: false,
            alConfirmar: async () => { importar(); }
          })
        }, `Importar ${sel.length} movimientos`),
        h('button', { class: 'btn btn-sec btn-bloque', type: 'button', onclick: () => { est.fase = 'inicio'; pintar(); } }, 'Cancelar'));
    } else if (est.fase === 'importando') {
      partes.push(h('p', { class: 'cargando' }, est.progreso || 'Importando…'),
        h('p', { class: 'ayuda' }, 'No cierres la aplicación hasta que termine.'));
    }
    raiz.replaceChildren(...partes.flat(Infinity).filter(Boolean));
  }

  // Solo administrador y contador ven esta sección
  cargarRol(empresa.id).then((r) => {
    if (r.rol === 'admin' || r.rol === 'contador') cargarHistorial().then(pintar).then(() => pintar());
  });
  return raiz;
}

// FIN DEL ARCHIVO importar.js
