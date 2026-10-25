// Impuestos: informe de ITBMS mensual (para llenar el formulario 430) y
// anexos de la declaración de renta (DR). Cada uno se exporta a Excel y PDF.
import {
  db, h, mostrar, toast, modal, campo, traducirError, cargando,
  marcoEmpresa, cargarEmpresa, hoy, redondear
} from './lib.js';
import { barraExportar } from './informes.js';
import { n2 } from './exportar.js';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
  'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const NUM = (v) => Number(v || 0);
const nz = (v) => (NUM(v) === 0 ? '' : n2(v));

// Tabla simple para pantalla. cols: [{t, num}], filas: [{c:[...], e}]
export function tablaSimple(cols, filas, clase) {
  return h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla ' + (clase || '') },
    h('thead', null, h('tr', null, cols.map((c) => h('th', { class: c.num ? 'num' : '' }, c.t)))),
    h('tbody', null, filas.map((f) => h('tr', { class: 'fila-' + (f.e || 'normal') },
      f.c.map((v, i) => h('td', { class: cols[i] && cols[i].num ? 'num' : '' },
        typeof v === 'number' ? n2(v) : (v ?? ''))))))));
}

/* ============================ ITBMS (formulario 430) ============================ */

const E_ITBMS = { detalle: 'normal', subtotal: 'n1', total: 'total', info: 'normal', control: 'normal' };

function specItbms(rows, anio, mes) {
  return {
    titulo: 'Informe de ITBMS para el formulario 430',
    subtitulo: `Período: ${MESES[mes - 1]} ${anio}`,
    hoja: 'ITBMS',
    columnas: [{ t: 'Concepto', w: 1 }, { t: 'Monto', num: true }],
    filas: rows.map((r) => ({ c: [r.concepto, NUM(r.monto)], e: E_ITBMS[r.fila] || 'normal' })),
    notas: ['Este informe da las cifras de los libros. Pasa cada cifra a la casilla que corresponda del formulario 430 vigente de la DGI.']
  };
}

async function abrirManual(id, anio, mes, alGuardar) {
  const r = await db.from('itbms_manual').select('clave, monto').eq('empresa_id', id).eq('anio', anio).eq('mes', mes);
  if (r.error) { toast(traducirError(r.error), 'error'); return; }
  const act = Object.fromEntries((r.data || []).map((x) => [x.clave, x.monto]));
  const mk = (k) => h('input', { type: 'number', step: '0.01', inputmode: 'decimal', value: act[k] !== undefined ? String(act[k]) : '' });
  const f = { saldo_favor_anterior: mk('saldo_favor_anterior'), otros_creditos: mk('otros_creditos'), otros_debitos: mk('otros_debitos') };
  let cerrar;
  async function guardar(ev) {
    ev.preventDefault();
    const poner = []; const quitar = [];
    for (const [k, el] of Object.entries(f)) {
      const t = el.value.trim();
      if (t === '') { if (act[k] !== undefined) quitar.push(k); continue; }
      const v = Number(t);
      if (!Number.isFinite(v) || v < 0) { toast('Escribe montos de cero o más.', 'error'); return; }
      poner.push({ empresa_id: id, anio, mes, clave: k, monto: redondear(v) });
    }
    if (poner.length) {
      const u = await db.from('itbms_manual').upsert(poner, { onConflict: 'empresa_id,anio,mes,clave' });
      if (u.error) { toast(traducirError(u.error), 'error'); return; }
    }
    for (const k of quitar) {
      const d = await db.from('itbms_manual').delete().eq('empresa_id', id).eq('anio', anio).eq('mes', mes).eq('clave', k);
      if (d.error) { toast(traducirError(d.error), 'error'); return; }
    }
    toast('Cifras guardadas.', 'ok');
    cerrar();
    alGuardar();
  }
  cerrar = modal(`Cifras manuales de ${MESES[mes - 1]} ${anio}`, h('form', { onsubmit: guardar },
    campo('Saldo a favor del período anterior', f.saldo_favor_anterior, 'Lo que arrastras de la declaración anterior.'),
    campo('Otros créditos', f.otros_creditos, 'Créditos que no salen de los libros.'),
    campo('Otros débitos', f.otros_debitos, 'Débitos que no salen de los libros.'),
    h('button', { class: 'btn btn-bloque', type: 'submit' }, 'Guardar')));
}

async function seccionItbms(id, empresa, zona) {
  const est = { anio: Number(hoy().slice(0, 4)), mes: Number(hoy().slice(5, 7)), rows: [] };
  const cuerpo = h('div');
  const anio = h('input', {
    type: 'number', min: '2000', max: '2100', inputmode: 'numeric', value: String(est.anio),
    onchange: (e) => { const v = Number(e.target.value); if (v >= 2000 && v <= 2100) { est.anio = v; pintar(); } }
  });
  const mes = h('select', { onchange: (e) => { est.mes = Number(e.target.value); pintar(); } },
    MESES.map((m, i) => h('option', { value: String(i + 1), selected: i + 1 === est.mes }, m)));

  async function pintar() {
    cuerpo.replaceChildren(cargando());
    try {
      if (!empresa.contribuyente_itbms) {
        cuerpo.replaceChildren(h('div', { class: 'aviso-lectura' },
          h('strong', null, 'Esta empresa no es contribuyente de ITBMS.'),
          h('p', null, 'Actívalo en Datos de la empresa si debe declarar.')));
        est.rows = [];
        return;
      }
      const r = await db.rpc('informe_itbms', { p_empresa: id, p_anio: est.anio, p_mes: est.mes });
      if (r.error) throw r.error;
      est.rows = r.data || [];
      const control = est.rows.filter((x) => x.fila === 'control' && /Diferencia/.test(x.concepto));
      const descuadre = control.some((x) => Math.abs(NUM(x.monto)) > 0.005);
      cuerpo.replaceChildren(...[
        descuadre ? h('div', { class: 'aviso-lectura' },
          h('strong', null, 'El ITBMS de las transacciones no coincide con el mayor.'),
          h('p', null, 'Probablemente hay asientos manuales en las cuentas de ITBMS. Revisa el diario del mes.')) : null,
        tablaSimple([{ t: 'Concepto' }, { t: 'Monto', num: true }],
          est.rows.map((x) => ({ c: [x.concepto, NUM(x.monto)], e: E_ITBMS[x.fila] || 'normal' })), 'estado'),
        empresa.rol === 'lector' ? null : h('div', { class: 'acciones' },
          h('button', { class: 'btn btn-sec', type: 'button', onclick: () => abrirManual(id, est.anio, est.mes, pintar) },
            'Cifras manuales del mes'))].filter(Boolean));
    } catch (e) {
      est.rows = [];
      cuerpo.replaceChildren(h('div', { class: 'tarjeta error' }, h('p', null, traducirError(e))));
    }
  }

  zona.replaceChildren(
    h('div', { class: 'filtros' }, mes, anio),
    barraExportar({
      empresa,
      obtener: () => (est.rows.length
        ? { specs: [specItbms(est.rows, est.anio, est.mes)], archivo: `${empresa.razon_social}-itbms-${est.anio}-${String(est.mes).padStart(2, '0')}` }
        : null)
    }),
    cuerpo);
  await pintar();
}

/* ============================== anexos de la DR ============================== */

const nombreTercero = (x) => (x.ruc ? `${x.nombre_tercero} (${x.ruc}${x.dv ? '-' + x.dv : ''})` : x.nombre_tercero);

async function seccionAnexos(id, empresa, zona) {
  const est = { anio: Number(hoy().slice(0, 4)), det: [], pend: [] };
  const cuerpo = h('div');
  const anio = h('input', {
    type: 'number', min: '2000', max: '2100', inputmode: 'numeric', value: String(est.anio),
    onchange: (e) => { const v = Number(e.target.value); if (v >= 2000 && v <= 2100) { est.anio = v; pintar(); } }
  });

  async function pintar() {
    cuerpo.replaceChildren(cargando());
    try {
      const [a, p] = await Promise.all([
        db.rpc('anexos_dr', { p_empresa: id, p_anio: est.anio }),
        db.rpc('anexos_pendientes', { p_empresa: id, p_anio: est.anio })
      ]);
      if (a.error) throw a.error;
      if (p.error) throw p.error;
      est.det = a.data || []; est.pend = p.data || [];
      const faltan = est.pend.filter((x) => x.falta_config);
      const sinMarca = est.pend.filter((x) => !x.lleva_anexo && NUM(x.movimiento) !== 0);
      const bloques = [];
      if (faltan.length) {
        bloques.push(h('div', { class: 'aviso-lectura' },
          h('strong', null, `${faltan.length} cuenta(s) con anexo sin número o renglón.`),
          h('p', null, faltan.map((x) => `${x.cuenta_numero} ${x.cuenta_nombre}`).join('; ') + '. Complétalas en Catálogo.')));
      }
      if (sinMarca.length) {
        bloques.push(h('p', { class: 'ayuda' },
          `${sinMarca.length} cuenta(s) con movimiento no llevan anexo. Si deben ir en la DR, márcalas en Catálogo.`));
      }
      if (!est.det.length) {
        bloques.push(h('p', { class: 'ayuda' }, 'No hay movimientos en cuentas con anexo para este año.'));
      } else {
        const filas = []; let clave = null;
        for (const x of est.det) {
          const k = `Anexo ${x.anexo || 'sin asignar'} · renglón ${x.linea || 'sin asignar'}`;
          if (k !== clave) { clave = k; filas.push({ c: [k, '', null, null, null], e: 'grupo' }); }
          filas.push({ c: [`${x.cuenta_numero} ${x.cuenta_nombre}`, nombreTercero(x), NUM(x.facturas), NUM(x.monto), NUM(x.itbms)], e: 'normal' });
        }
        bloques.push(tablaSimple([{ t: 'Cuenta' }, { t: 'Cliente o proveedor' }, { t: 'Fact.', num: true },
          { t: 'Monto', num: true }, { t: 'ITBMS', num: true }], filas, 'ancha'));
      }
      cuerpo.replaceChildren(...bloques);
    } catch (e) {
      est.det = []; est.pend = [];
      cuerpo.replaceChildren(h('div', { class: 'tarjeta error' }, h('p', null, traducirError(e))));
    }
  }

  zona.replaceChildren(
    h('div', { class: 'filtros' }, anio),
    barraExportar({
      empresa,
      obtener: () => (est.det.length || est.pend.length
        ? { specs: specsAnexos2(est.det, est.pend, est.anio), archivo: `${empresa.razon_social}-anexos-dr-${est.anio}` }
        : null)
    }),
    cuerpo);
  await pintar();
}

// Especificación limpia (5 columnas) con subtotales por anexo y renglón
function specsAnexos2(det, pend, anio) {
  const filas = []; let clave = null; let t = [0, 0, 0];
  const cerrar = () => { if (clave !== null) filas.push({ c: ['Total ' + clave, null, String(t[0]), t[1], t[2]], e: 'n1' }); };
  for (const x of det) {
    const k = `anexo ${x.anexo || 'sin asignar'}, renglón ${x.linea || 'sin asignar'}`;
    if (k !== clave) { cerrar(); clave = k; t = [0, 0, 0]; filas.push({ c: [k.charAt(0).toUpperCase() + k.slice(1), null, null, null, null], e: 'grupo' }); }
    filas.push({ c: [`${x.cuenta_numero} ${x.cuenta_nombre}`, nombreTercero(x), String(NUM(x.facturas)), NUM(x.monto), NUM(x.itbms)], e: 'normal' });
    t[0] += NUM(x.facturas); t[1] += NUM(x.monto); t[2] += NUM(x.itbms);
  }
  cerrar();
  const out = [];
  if (filas.length) {
    out.push({
      titulo: `Anexos de la declaración de renta ${anio}`,
      subtitulo: 'Detalle por anexo y renglón, con cliente o proveedor',
      hoja: 'Anexos DR',
      columnas: [{ t: 'Cuenta', w: 1 }, { t: 'Cliente o proveedor', w: 1 }, { t: 'Facturas', num: true },
        { t: 'Monto', num: true }, { t: 'ITBMS', num: true }],
      filas,
      notas: ['Monto = base de la factura sin ITBMS. Las diferencias con el mayor aparecen como "Sin cliente o proveedor identificado".'],
      horizontal: true
    });
  }
  if (pend.length) {
    out.push({
      titulo: `Cuentas de resultado y su anexo ${anio}`,
      subtitulo: 'Revisión de configuración',
      hoja: 'Configuración',
      columnas: [{ t: 'Cuenta', w: 1 }, { t: 'Anexo' }, { t: 'Renglón' }, { t: 'Movimiento', num: true }, { t: 'Estado' }],
      filas: pend.map((p) => ({
        c: [`${p.cuenta_numero} ${p.cuenta_nombre}`, p.anexo || '', p.linea || '', NUM(p.movimiento),
          p.falta_config ? 'Falta anexo o renglón' : (p.lleva_anexo ? 'Configurada' : 'No lleva anexo')],
        e: p.falta_config ? 'total' : 'normal'
      }))
    });
  }
  return out;
}

/* ================================== pantalla ================================= */

export async function vistaImpuestos(id) {
  mostrar(marcoEmpresa({ id, razon_social: '…' }, 'impuestos', cargando()));
  const empresa = await cargarEmpresa(id);
  const zona = h('div');
  let actual = 'itbms';
  const botones = {};
  async function ir(k) {
    actual = k;
    for (const [n, b] of Object.entries(botones)) b.className = 'btn btn-peq ' + (n === k ? '' : 'btn-sec');
    if (k === 'itbms') await seccionItbms(id, empresa, zona);
    else await seccionAnexos(id, empresa, zona);
  }
  botones.itbms = h('button', { type: 'button', onclick: () => ir('itbms') }, 'ITBMS · formulario 430');
  botones.anexos = h('button', { type: 'button', onclick: () => ir('anexos') }, 'Anexos de la DR');
  mostrar(marcoEmpresa(empresa, 'impuestos', [
    h('div', { class: 'acciones' }, botones.itbms, botones.anexos), zona]));
  await ir(actual);
}

// FIN DEL ARCHIVO fiscal.js
