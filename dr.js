// Declaración de Renta (persona natural): formulario de la DGI con los renglones 1 a 128,
// vista anual. Cada cuenta del catálogo se asigna a un renglón (Catálogo > Renglón de la
// declaración, o desde la observación al pie de esta pantalla). Totales, renta gravable,
// impuesto, seguro educativo, CSS y partidas salen de las fórmulas de la base de datos (script 93).
// Cualquier línea se puede escribir a mano (lápiz) y las fórmulas siguientes usan ese monto.
import {
  db, h, mostrar, toast, modal, campo, texto, traducirError, cargando,
  marcoEmpresa, cargarEmpresa, hoy
} from './lib.js';
import { barraExportar } from './informes.js';
import { n2 } from './exportar.js';

const NUM = (v) => Number(v || 0);
const TITULO_DGI = 'DIRECCION GENERAL DE INGRESOS';
const TITULO_FORM = 'DECLARACIÓN JURADA DE RENTAS PERSONAS NATURALES, ASALARIADOS, PROFESIONALES INDEPENDIENTES Y COMERCIANTES';
const TITULO_VERSION = 'Formulario 1 V: 8 NATURAL';
const TIPOS = {
  activo: 'Activo', pasivo: 'Pasivo', patrimonio: 'Patrimonio', ingreso: 'Ingreso',
  costo: 'Costo', gasto: 'Gasto', extraordinario: 'Extraordinario'
};

// Especificaciones para Excel y PDF
function specsRenta({ filas, base, obs, anio, empresa }) {
  const sub = `${TITULO_DGI} · ${TITULO_FORM} · ${TITULO_VERSION} · Año ${anio}`;
  const f = filas.map((x) => {
    if (x.fila === 'seccion') return { c: [x.descripcion, null, null, null], e: 'grupo' };
    return { c: [x.descripcion + (x.manual ? ' (manual)' : ''), x.renglon == null ? '' : String(x.renglon), x.anexos || '', NUM(x.monto)], e: x.fila === 'calculo' ? 'total' : 'normal' };
  });
  const out = [{
    titulo: `Declaración de Renta ${anio}`,
    subtitulo: sub,
    hoja: 'Declaración',
    columnas: [{ t: 'Descripción', w: 6 }, { t: 'Renglón', w: 1 }, { t: 'Anexo', w: 1 }, { t: 'Monto', num: true }],
    filas: f,
    notas: ['Ingresos, costos y gastos: movimiento del año. Activo, pasivo y patrimonio: saldo al 31 de diciembre.',
      'Los renglones resaltados salen de fórmulas: totales, renta gravable, impuesto causado, seguro educativo, cuota de la CSS y partidas.',
      'Las líneas marcadas (manual) tienen un monto escrito a mano que reemplaza al calculado. Los renglones "Menos:" van en positivo.',
      'Impuesto causado (102 y 113): (renta neta gravable - 11,000.00) x 15 %. Seguro educativo: 2.75 %. CSS: línea 8 x 52 % x 13.50 %.']
  }];
  const det = base.filter((b) => b.valido && b.renglon != null)
    .sort((a, b) => a.renglon - b.renglon || String(a.numero).localeCompare(String(b.numero), 'es', { numeric: true }));
  const manuales = filas.filter((x) => x.manual);
  if (det.length || manuales.length) {
    out.push({
      titulo: `Detalle por renglón ${anio}`,
      subtitulo: 'Cuentas que forman cada renglón',
      hoja: 'Detalle por renglón',
      columnas: [{ t: 'Renglón', w: 1 }, { t: 'Cuenta', w: 6 }, { t: 'Anexo', w: 1 }, { t: 'Monto', num: true }],
      filas: [
        ...det.map((b) => ({ c: [String(b.renglon), `${b.numero} ${b.nombre}`, b.anexo || '', montoCuenta(b, filas)], e: 'normal' })),
        ...manuales.map((x) => ({ c: [x.renglon == null ? '' : String(x.renglon), `Monto manual: ${x.descripcion}${x.nota ? ' · ' + x.nota : ''}`, '', NUM(x.monto)], e: 'total' }))
      ]
    });
  }
  if (obs.length) {
    out.push({
      titulo: `Cuentas sin renglón ${anio}`,
      subtitulo: 'Observación: cuentas del catálogo por asignar o revisar',
      hoja: 'Sin renglón',
      columnas: [{ t: 'Cuenta', w: 5 }, { t: 'Tipo', w: 1.5 }, { t: 'Saldo', num: true }, { t: 'Observación', w: 4 }],
      filas: obs.map((o) => ({ c: [`${o.numero} ${o.nombre}`, TIPOS[o.tipo] || o.tipo, NUM(o.saldo), o.motivo], e: 'normal' }))
    });
  }
  return out;
}

// Monto de una cuenta dentro de su renglón (según el lado del renglón)
function montoCuenta(b, filas) {
  const r = filas.find((x) => x.renglon === b.renglon);
  const lado = r && r.lado === 'C' ? -1 : 1;
  return NUM(b.dc) * lado;
}

export async function vistaRenta(id) {
  mostrar(marcoEmpresa({ id, razon_social: '…' }, 'renta', cargando()));
  const empresa = await cargarEmpresa(id);
  const puedeAsignar = empresa.rol === 'admin' || empresa.rol === 'contador';
  const esLector = empresa.rol === 'lector';
  const est = { anio: Number(hoy().slice(0, 4)), filas: [], base: [], obs: [], sinMov: false, marcadas: new Set(), aprob: [], aprobFalta: false, confirma: false, nota: '' };
  const cuerpo = h('div');
  const anio = h('input', {
    type: 'number', min: '2000', max: '2100', inputmode: 'numeric', value: String(est.anio),
    onchange: (e) => { const v = Number(e.target.value); if (v >= 2000 && v <= 2100) { est.anio = v; est.marcadas.clear(); cargar(); } }
  });

  async function cargar() {
    cuerpo.replaceChildren(cargando());
    try {
      const [d, b, o, pl] = await Promise.all([
        db.rpc('dr_declaracion', { p_empresa: id, p_anio: est.anio }),
        db.rpc('dr_base', { p_empresa: id, p_anio: est.anio }),
        db.rpc('dr_sin_renglon', { p_empresa: id, p_anio: est.anio }),
        db.from('dr_plantilla').select('renglon, lado, tipos').eq('formulario', 'natural').not('renglon', 'is', null)
      ]);
      for (const r of [d, b, o, pl]) if (r.error) throw r.error;
      const lados = new Map((pl.data || []).map((x) => [x.renglon, x]));
      est.filas = (d.data || []).map((x) => ({ ...x, lado: lados.has(x.renglon) ? lados.get(x.renglon).lado : null }));
      est.base = b.data || [];
      est.obs = o.data || [];
      await cargarAprobaciones();
      pintar();
    } catch (e) {
      est.filas = []; est.base = []; est.obs = [];
      cuerpo.replaceChildren(h('div', { class: 'tarjeta error' }, h('p', null,
        /dr_declaracion|dr_base|dr_plantilla/.test(String(e && e.message))
          ? 'Falta ejecutar los scripts 81 y 93 en Supabase (Declaración de renta).' : traducirError(e))));
    }
  }

  // Aprobaciones del cliente (archivo 87). Si el script no se ha ejecutado, el resto de la pantalla sigue igual.
  async function cargarAprobaciones() {
    est.aprob = []; est.aprobFalta = false;
    const r = await db.from('dr_aprobaciones')
      .select('id, anio, estado, aprobado_correo, aprobado_en, nota, correo_estado, correo_detalle, leida_en, revocada_en, motivo_revocacion')
      .eq('empresa_id', id).order('aprobado_en', { ascending: false }).limit(30);
    if (r.error) { est.aprobFalta = /dr_aprobaciones/.test(String(r.error.message)); return; }
    est.aprob = r.data || [];
  }

  async function avisarCorreo(aprobId) {
    try {
      const r = await db.functions.invoke('notificar-aprobacion', { body: { aprobacion_id: aprobId } });
      if (r.error) return false;
      return !!(r.data && r.data.ok);
    } catch (e) { return false; }
  }

  function fechaHora(t) {
    const d = new Date(t);
    return d.toLocaleDateString('es-PA') + ' ' + d.toLocaleTimeString('es-PA', { hour: '2-digit', minute: '2-digit' });
  }

  async function aprobar() {
    const { data, error } = await db.rpc('dr_aprobar', { p_empresa: id, p_anio: est.anio, p_nota: texto(est.nota) });
    if (error) { toast(traducirError(error), 'error'); return; }
    est.confirma = false; est.nota = '';
    toast('Aprobada. Se avisó al administrador y al contador.', 'ok');
    const ok = await avisarCorreo(data);
    if (!ok) toast('El aviso quedó en el buzón. El correo todavía no está configurado o falló.', 'info');
    await cargar();
  }

  function textoCorreo(a) {
    if (a.correo_estado === 'enviado') return 'Correo enviado';
    if (a.correo_estado === 'error') return 'El correo falló';
    if (a.correo_estado === 'sin_configurar') return 'Correo sin configurar';
    return 'Correo pendiente';
  }

  function bloqueAprobacion() {
    if (est.aprobFalta) {
      return puedeAsignar ? h('div', { class: 'tarjeta error' }, h('p', null, 'Falta ejecutar el script 87 en Supabase (aprobación de la declaración).')) : null;
    }
    const activa = est.aprob.find((a) => a.anio === est.anio && a.estado === 'aprobada');
    if (esLector) {
      if (activa) {
        return h('div', { class: 'tarjeta dr-aprobada' },
          h('h3', null, `✔ Declaración ${est.anio} aprobada`),
          h('p', null, `Aprobaste la presentación de la Declaración de Renta y sus anexos el ${fechaHora(activa.aprobado_en)}.`),
          activa.nota ? h('p', { class: 'ayuda' }, `Tu nota: ${activa.nota}`) : null,
          h('p', { class: 'ayuda' }, 'El administrador y el contador ya tienen el aviso. Si hay que corregir algo, ellos pueden quitar la aprobación y te la vuelven a pedir.'));
      }
      const check = h('input', { type: 'checkbox', checked: est.confirma, onchange: (e) => { est.confirma = e.target.checked; boton.disabled = !est.confirma; } });
      const nota = h('textarea', { rows: '2', maxlength: '300', placeholder: 'Nota para el contador (opcional)', value: est.nota,
        oninput: (e) => { est.nota = e.target.value; } });
      nota.value = est.nota;
      const boton = h('button', { class: 'btn btn-bloque', type: 'button', disabled: !est.confirma, onclick: aprobar }, 'Enviar al Administrador/Contador');
      return h('div', { class: 'tarjeta dr-aprobar' },
        h('h3', null, `Aprobación de la declaración ${est.anio}`),
        h('p', { class: 'ayuda' }, 'Cuando hayas revisado la declaración y aclarado tus dudas, marca "Aprobado". Con eso autorizas que se presente a la DGI la Declaración de Renta con sus anexos.'),
        h('label', { class: 'fila-check' }, check, h('span', null, 'Aprobado: autorizo la presentación de la Declaración de Renta y sus anexos ante la DGI.')),
        nota,
        boton);
    }
    if (!puedeAsignar) return null;
    const sin = est.aprob.filter((a) => a.estado === 'aprobada' && !a.leida_en).length;
    const lista = est.aprob.map((a) => h('div', { class: 'dr-aviso' + (a.estado === 'aprobada' && !a.leida_en ? ' nuevo' : '') },
      h('div', null,
        h('strong', null, `Año ${a.anio} · ${a.estado === 'aprobada' ? 'Aprobada' : 'Aprobación quitada'}`),
        h('div', { class: 'ayuda' }, `${a.aprobado_correo || 'El cliente'} · ${fechaHora(a.aprobado_en)}`),
        a.nota ? h('div', null, `“${a.nota}”`) : null,
        a.estado === 'revocada' && a.motivo_revocacion ? h('div', { class: 'ayuda' }, `Motivo: ${a.motivo_revocacion}`) : null,
        a.estado === 'aprobada' ? h('div', { class: 'ayuda' }, textoCorreo(a)) : null),
      a.estado === 'aprobada' ? h('div', { class: 'dr-aviso-botones' },
        !a.leida_en ? h('button', { class: 'btn btn-sec', type: 'button', onclick: async () => {
          const r = await db.rpc('dr_marcar_leida', { p_id: a.id });
          if (r.error) toast(traducirError(r.error), 'error'); else await cargar();
        } }, 'Marcar leída') : null,
        a.correo_estado !== 'enviado' ? h('button', { class: 'btn btn-sec', type: 'button', onclick: async () => {
          const ok = await avisarCorreo(a.id);
          toast(ok ? 'Correo enviado.' : 'No se pudo enviar el correo. Revisa la configuración.', ok ? 'ok' : 'error');
          await cargar();
        } }, 'Reintentar envío') : null,
        h('button', { class: 'btn btn-sec', type: 'button', onclick: () => quitar(a) }, 'Quitar aprobación')) : null));
    return h('div', { class: 'tarjeta' },
      h('h3', null, sin ? `Buzón de aprobaciones (${sin} sin leer)` : 'Buzón de aprobaciones'),
      lista.length ? h('div', null, lista) : h('p', { class: 'ayuda' }, 'Cuando el cliente apruebe una declaración, el aviso aparece aquí y también llega por correo.'));
  }

  function quitar(a) {
    const motivo = h('input', { type: 'text', maxlength: '200', placeholder: 'Motivo (opcional)' });
    let cerrar;
    cerrar = modal(`Quitar aprobación ${a.anio}`, h('form', { onsubmit: async (ev) => {
      ev.preventDefault();
      const r = await db.rpc('dr_revocar_aprobacion', { p_id: a.id, p_motivo: texto(motivo.value) });
      if (r.error) { toast(traducirError(r.error), 'error'); return; }
      toast('Aprobación quitada. El cliente puede aprobar de nuevo.', 'ok');
      cerrar(); await cargar();
    } },
    h('p', { class: 'ayuda' }, 'El cliente podrá aprobar otra vez cuando la declaración esté corregida.'),
    campo('Motivo', motivo),
    h('button', { class: 'btn btn-bloque', type: 'submit' }, 'Quitar aprobación')));
  }

  function detalleRenglon(f) {
    const cuentas = est.base.filter((b) => b.valido && b.renglon === f.renglon)
      .sort((a, b) => String(a.numero).localeCompare(String(b.numero), 'es', { numeric: true }));
    const filas = cuentas.map((b) => h('tr', null,
      h('td', null, `${b.numero} ${b.nombre}`), h('td', null, b.anexo || ''),
      h('td', { class: 'num' }, n2(montoCuenta(b, est.filas)))));
    modal(`Renglón ${f.renglon} · ${f.descripcion}`, h('div', null,
      f.manual ? h('p', { class: 'ayuda' }, `Esta línea tiene un monto manual de ${n2(f.monto)} que reemplaza a las cuentas.`) : null,
      cuentas.length
        ? h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
          h('thead', null, h('tr', null, h('th', null, 'Cuenta'), h('th', null, 'Anexo'), h('th', { class: 'num' }, 'Monto'))),
          h('tbody', null, filas),
          h('tfoot', null, h('tr', null, h('td', null, 'Total del renglón'), h('td', null, ''), h('td', { class: 'num' }, n2(f.monto_auto))))))
        : h('p', { class: 'ayuda' }, 'Ninguna cuenta tiene este renglón todavía. Asígnalo en Catálogo o desde la observación al pie.')));
  }

  function ayudaRenglon(f) {
    const titulo = f.renglon == null ? f.descripcion : `Renglón ${f.renglon} · ${f.descripcion}`;
    modal(titulo, h('div', null,
      h('p', null, h('strong', null, 'Monto: '), n2(f.monto), f.manual ? ' (escrito a mano)' : ''),
      f.manual ? h('p', { class: 'ayuda' }, `Calculado por la fórmula: ${n2(f.monto_auto)}.${f.nota ? ' Nota: ' + f.nota : ''}`) : null,
      f.formula ? h('p', null, h('strong', null, 'Fórmula: '), f.formula) : null,
      f.ayuda ? h('p', { class: 'ayuda dr-ayuda' }, f.ayuda) : null,
      puedeAsignar ? h('button', { class: 'btn btn-sec btn-bloque', type: 'button', onclick: () => editarMonto(f) }, 'Escribir el monto a mano') : null));
  }

  function editarMonto(f) {
    const monto = h('input', { type: 'number', step: '0.01', inputmode: 'decimal', placeholder: '0.00',
      value: f.manual ? String(f.monto) : '' });
    const nota = h('input', { type: 'text', maxlength: '200', placeholder: 'Nota (opcional)', value: f.nota || '' });
    let cerrar;
    async function guardar(ev, quitar) {
      if (ev) ev.preventDefault();
      let v = null;
      if (!quitar) {
        if (monto.value === '' || !isFinite(Number(monto.value))) { toast('Escribe el monto.', 'error'); return; }
        v = Number(monto.value);
      }
      const { error } = await db.rpc('dr_guardar_manual', {
        p_empresa: id, p_anio: est.anio, p_orden: f.orden, p_monto: v, p_nota: quitar ? null : texto(nota.value)
      });
      if (error) { toast(traducirError(error), 'error'); return; }
      toast(quitar ? 'Vuelve al monto de las cuentas.' : 'Monto guardado.', 'ok');
      cerrar();
      await cargar();
    }
    cerrar = modal(f.renglon == null ? f.descripcion : `Renglón ${f.renglon} · ${f.descripcion}`,
      h('form', { onsubmit: (ev) => guardar(ev, false) },
        f.fila === 'captura'
          ? h('p', { class: 'ayuda' }, `Según las cuentas: ${n2(f.monto_auto)}. Si escribes un monto aquí, reemplaza al de las cuentas para ${est.anio}.`)
          : h('p', { class: 'ayuda' }, `Este renglón sale de una fórmula${f.formula ? ' (' + f.formula + ')' : ''}: ${n2(f.monto_auto)}. Si escribes un monto aquí, lo reemplaza para ${est.anio} y las líneas que dependen de él lo usan.`),
        campo('Monto (B/.)', monto),
        campo('Nota', nota),
        h('button', { class: 'btn btn-bloque', type: 'submit' }, 'Guardar'),
        f.manual ? h('button', { class: 'btn btn-sec btn-bloque', type: 'button', style: 'margin-top: 10px', onclick: () => guardar(null, true) },
          'Volver al monto automático') : null));
  }

  function filaTabla(f) {
    if (f.fila === 'seccion') {
      return h('tr', { class: 'dr-seccion' }, h('td', { colspan: '4' }, f.descripcion));
    }
    const clic = (f.fila === 'captura' && f.cuentas > 0) || f.fila === 'calculo';
    const hay = true;
    const lapiz = puedeAsignar
      ? h('button', { class: 'dr-lapiz' + (f.manual ? ' activo' : ''), type: 'button', 'aria-label': 'Editar monto',
        onclick: (ev) => { ev.stopPropagation(); editarMonto(f); } }, '✎')
      : null;
    return h('tr', { class: 'dr-fila' + (f.fila === 'calculo' ? ' dr-calculo' : '') + (clic ? ' dr-clic' : ''),
      onclick: clic ? () => (f.fila === 'calculo' ? ayudaRenglon(f) : detalleRenglon(f)) : null },
      h('td', null, f.descripcion,
        f.fila === 'calculo' && f.formula && f.formula !== 'A mano' ? h('div', { class: 'ayuda dr-formula' }, `= ${f.formula}`) : null,
        f.manual && f.nota ? h('div', { class: 'ayuda' }, f.nota) : null),
      h('td', { class: 'centro' }, f.renglon == null ? '' : h('span', { class: 'dr-pildora' }, String(f.renglon))),
      h('td', { class: 'centro' }, f.anexos || ''),
      h('td', { class: 'num' + (f.manual ? ' dr-manual' : '') }, hay ? n2(f.monto) : '', lapiz));
  }

  function asignar(cuentas) {
    const sugerido = cuentas.length === 1 ? sugerirRenglon(cuentas[0]) : '';
    const caps = est.filas.filter((x) => x.fila === 'captura' || x.renglon === 82);
    const secciones = [];
    for (const x of caps) {
      let g = secciones.find((s) => s.t === x.seccion);
      if (!g) { g = { t: x.seccion, items: [] }; secciones.push(g); }
      g.items.push(x);
    }
    const sel = h('select', null,
      h('option', { value: '' }, 'Elige un renglón...'),
      secciones.map((s) => h('optgroup', { label: s.t }, s.items.map((x) =>
        h('option', { value: String(x.renglon) }, `${x.renglon} · ${x.descripcion}`)))));
    if (sugerido) sel.value = String(sugerido);
    const anexo = h('input', { type: 'text', placeholder: 'Número de anexo (opcional)' });
    let cerrar;
    async function guardar(ev) {
      ev.preventDefault();
      if (!sel.value) { toast('Elige el renglón.', 'error'); return; }
      const datos = { linea_dr: sel.value };
      if (texto(anexo.value)) { datos.anexo_dr = texto(anexo.value); datos.lleva_anexo = true; }
      const { data, error } = await db.from('cuentas').update(datos).in('id', cuentas.map((c) => c.cuenta_id)).select('id');
      if (error) { toast(traducirError(error), 'error'); return; }
      if (!data || data.length === 0) { toast('No se pudo guardar: revisa tu permiso.', 'error'); return; }
      toast(`Renglón ${sel.value} asignado a ${data.length} cuenta(s).`, 'ok');
      est.marcadas.clear();
      cerrar();
      await cargar();
    }
    cerrar = modal(cuentas.length === 1 ? `${cuentas[0].numero} · Renglón` : `Asignar renglón a ${cuentas.length} cuentas`,
      h('form', { onsubmit: guardar },
        h('p', { class: 'ayuda' }, cuentas.length === 1
          ? `${cuentas[0].numero} ${cuentas[0].nombre} (${TIPOS[cuentas[0].tipo] || cuentas[0].tipo})`
          : cuentas.slice(0, 6).map((c) => c.numero).join(', ') + (cuentas.length > 6 ? '...' : '')),
        campo('Renglón de la declaración', sel),
        campo('Anexo', anexo),
        h('button', { class: 'btn btn-bloque', type: 'submit' }, 'Guardar')));
  }

  // Sugerencia sencilla según el tipo de cuenta (solo preselecciona; la persona decide)
  function sugerirRenglon(c) {
    const por = { ingreso: 14, gasto: 58, activo: 75, pasivo: 80, patrimonio: 82 };
    return por[c.tipo] || '';
  }

  function bloqueObservacion() {
    const conMov = est.obs.filter((o) => o.movimientos > 0 || NUM(o.saldo) !== 0);
    const lista = est.sinMov ? est.obs : conMov;
    const check = h('input', { type: 'checkbox', checked: est.sinMov,
      onchange: (e) => { est.sinMov = e.target.checked; pintar(); } });
    const marcadas = est.obs.filter((o) => est.marcadas.has(o.cuenta_id));
    return h('div', { class: 'tarjeta' },
      h('h3', null, est.obs.length ? `Observación: ${conMov.length} cuenta(s) con movimiento sin renglón` : 'Observación'),
      est.obs.length === 0
        ? h('p', { class: 'ayuda' }, 'Todas las cuentas del catálogo tienen un renglón válido.')
        : h('div', null,
          h('p', { class: 'ayuda' }, `Estas cuentas del catálogo no tienen un renglón de la declaración, o lo tienen mal puesto. ${puedeAsignar ? 'Toca una para asignarlo, o márcalas y asigna el mismo renglón a varias.' : 'Pídele al administrador o al contador que las asigne.'} Salen solas de esta lista cuando se les asigna.`),
          h('label', { class: 'fila-check' }, check, h('span', null, `Mostrar también las cuentas sin movimiento (${est.obs.length - conMov.length})`)),
          puedeAsignar && marcadas.length
            ? h('button', { class: 'btn btn-bloque', type: 'button', onclick: () => asignar(marcadas) }, `Asignar renglón a las ${marcadas.length} marcadas`)
            : null,
          lista.length === 0 ? h('p', { class: 'ayuda' }, 'No hay cuentas con movimiento sin renglón.') :
            h('div', { class: 'dr-obs' }, lista.map((o) => h('div', { class: 'dr-obs-fila' },
              puedeAsignar ? h('input', { type: 'checkbox', checked: est.marcadas.has(o.cuenta_id),
                onchange: (e) => { if (e.target.checked) est.marcadas.add(o.cuenta_id); else est.marcadas.delete(o.cuenta_id); pintar(); } }) : null,
              h('button', { class: 'dr-obs-dato', type: 'button', disabled: !puedeAsignar, onclick: () => asignar([o]) },
                h('span', { class: 'num' }, o.numero),
                h('span', null, o.nombre),
                h('span', { class: 'ayuda' }, `${TIPOS[o.tipo] || o.tipo} · ${n2(o.saldo)} · ${o.motivo}`)))))));
  }

  function pintar() {
    const tabla = h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla dr-tabla' },
      h('thead', null, h('tr', null, h('th', null, 'Descripción'), h('th', { class: 'centro' }, 'Renglón'),
        h('th', { class: 'centro' }, 'Anexo'), h('th', { class: 'num' }, 'Monto'))),
      h('tbody', null, est.filas.map(filaTabla))));
    cuerpo.replaceChildren(
      h('div', { class: 'tarjeta dr-encabezado' },
        h('div', { class: 'dr-dgi' }, TITULO_DGI),
        h('div', { class: 'dr-titulo-form' }, TITULO_FORM),
        h('div', { class: 'dr-version' }, TITULO_VERSION)),
      h('p', { class: 'ayuda' }, 'Ingresos, costos y gastos: movimiento del año. Activo y pasivo: saldo al 31 de diciembre. Toca un renglón con cuentas para verlas, o un renglón de fórmula para ver cómo se calcula. El lápiz ✎ permite escribir el monto a mano (reemplaza al calculado, se puede quitar y las líneas siguientes lo usan). Los renglones "Menos:" van en positivo. Los renglones sin fórmula (103, 105 a 107, 109, 119, 120 y los incentivos) se escriben a mano; el 103 se resta en la 110 y la 111.'),
      tabla,
      bloqueObservacion(),
      bloqueAprobacion());
  }

  mostrar(marcoEmpresa(empresa, 'renta', [
    h('div', { class: 'filtros' }, h('label', null, 'Año', anio)),
    barraExportar({
      empresa,
      obtener: () => (est.filas.length
        ? { specs: specsRenta({ filas: est.filas, base: est.base, obs: est.obs, anio: est.anio, empresa }),
          archivo: `${empresa.razon_social}-declaracion-renta-${est.anio}` }
        : null)
    }),
    cuerpo]));
  await cargar();
}

// FIN DEL ARCHIVO dr.js
