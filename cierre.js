// Cierre mensual y cierre anual (con vista previa, asientos de cierre,
// saldos de apertura del año siguiente y exportación a Excel y PDF).
import {
  db, h, mostrar, toast, dinero, fechaCorta, traducirError, cargando,
  marcoEmpresa, cargarEmpresa, hoy, redondear
} from './lib.js';
import { barraExportar, abrirAjuste } from './informes.js';
import { tarjetaVerificacion } from './verificacion.js';
import { cargarCierreFiscal, tarjetaCierreFiscal, specCierreFiscal } from './cierrefiscal.js';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
  'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const NUM = (v) => Number(v || 0);
const dia = (ts) => (ts ? fechaCorta(String(ts).slice(0, 10)) : '');

export async function vistaCierre(id) {
  mostrar(marcoEmpresa({ id, razon_social: '…' }, 'cierre', cargando()));
  const empresa = await cargarEmpresa(id);
  const est = { anio: Number(hoy().slice(0, 4)), datos: null };
  const zona = h('div');
  const barra = h('div', { class: 'filtros' });

  /* ------------------------------ datos ------------------------------ */
  async function cargar() {
    const anio = est.anio;
    const [per, cie, prev, cierre, cuentas, imp] = await Promise.all([
      db.from('periodos').select('mes, estado, cerrado_en').eq('empresa_id', id).eq('anio', anio),
      db.from('cierres_anuales').select('total_ingresos, total_costos_gastos, utilidad_neta, retiros_cerrados, cerrado_en')
        .eq('empresa_id', id).eq('anio', anio).maybeSingle(),
      db.rpc('vista_previa_cierre', { p_empresa: id, p_anio: anio }),
      db.from('asientos')
        .select('id, consecutivo, fecha, descripcion, referencia, asiento_lineas(debito, credito, descripcion, cuentas(numero, nombre))')
        .eq('empresa_id', id).eq('origen', 'cierre').eq('referencia', `CIERRE-${anio}`)
        .order('consecutivo').range(0, 999),
      db.from('cuentas').select('id, numero, nombre, nivel')
        .eq('empresa_id', id).eq('acepta_movimientos', true).eq('activa', true)
        .order('numero').range(0, 4999),
      db.rpc('impuestos_calculo', { p_empresa: id, p_anio: anio })
    ]);
    for (const r of [per, cie, prev, cierre, cuentas, imp]) if (r.error) throw r.error;
    const cerrado = cie.data || null;
    let apertura = [];
    if (cerrado) {
      const ap = await db.rpc('saldos_apertura', { p_empresa: id, p_anio: anio + 1 });
      if (ap.error) throw ap.error;
      apertura = ap.data || [];
    }
    const fiscal = await cargarCierreFiscal(id, anio);
    return {
      fiscal,
      periodos: new Map((per.data || []).map((p) => [Number(p.mes), p])),
      cerrado, impuestos: (imp.data || [])[0] || null, preview: prev.data || [], asientos: cierre.data || [], cuentas: cuentas.data || [], apertura
    };
  }

  /* ------------------------- especificaciones de exportación ------------------------- */
  function specs(d) {
    const out = [];
    const anio = est.anio;
    out.push({
      titulo: `Cierre anual ${anio}`,
      subtitulo: d.cerrado ? `Año cerrado el ${dia(d.cerrado.cerrado_en)}` : 'Vista previa (el año todavía no está cerrado)',
      hoja: 'Resumen del cierre',
      columnas: [{ t: 'Concepto', w: 1 }, { t: 'Monto', num: true }],
      filas: d.preview.map((r) => ({
        c: [r.concepto, redondear(NUM(r.monto))],
        e: Number(r.orden) === 6 ? 'total' : 'normal'
      }))
    });
    if (d.asientos.length) {
      const filas = []; let td = 0; let tc = 0;
      d.asientos.forEach((a) => {
        const ls = (a.asiento_lineas || []).slice().sort((x, y) => (NUM(y.debito) > 0) - (NUM(x.debito) > 0));
        ls.forEach((l, i) => {
          td += NUM(l.debito); tc += NUM(l.credito);
          filas.push({
            c: [i === 0 ? fechaCorta(a.fecha) : '', i === 0 ? String(a.consecutivo) : '',
              l.cuentas ? `${l.cuentas.numero} ${l.cuentas.nombre}` : '', i === 0 ? a.descripcion : '',
              NUM(l.debito) || null, NUM(l.credito) || null]
          });
        });
      });
      filas.push({ c: ['', '', 'Totales', '', redondear(td), redondear(tc)], e: 'total' });
      out.push({
        titulo: `Asientos de cierre ${anio}`, subtitulo: `Referencia CIERRE-${anio}`, hoja: 'Asientos de cierre',
        columnas: [{ t: 'Fecha', w: 1 }, { t: 'N.º', w: 0.7 }, { t: 'Cuenta', w: 2.6 }, { t: 'Descripción', w: 2.6 },
          { t: 'Débito', num: true }, { t: 'Crédito', num: true }],
        filas
      });
    }
    if (d.cerrado && d.apertura.length) {
      const td = d.apertura.reduce((s, r) => s + NUM(r.saldo_deudor), 0);
      const tc = d.apertura.reduce((s, r) => s + NUM(r.saldo_acreedor), 0);
      out.push({
        titulo: `Saldos de apertura al 1 de enero de ${anio + 1}`, subtitulo: 'Traslado de saldos del balance', hoja: 'Saldos de apertura',
        columnas: [{ t: 'Cuenta', w: 1 }, { t: 'Saldo deudor', num: true }, { t: 'Saldo acreedor', num: true }],
        filas: [
          ...d.apertura.map((r) => ({ c: [`${r.numero} ${r.nombre}`, NUM(r.saldo_deudor) || null, NUM(r.saldo_acreedor) || null] })),
          { c: ['Totales', redondear(td), redondear(tc)], e: 'total' }]
      });
    }
    out.push({
      titulo: `Cierres mensuales ${anio}`, subtitulo: 'Estado de cada mes', hoja: 'Cierres mensuales',
      columnas: [{ t: 'Mes', w: 1 }, { t: 'Estado', w: 1 }, { t: 'Fecha de cierre', w: 1 }],
      filas: MESES.map((m, i) => {
        const p = d.periodos.get(i + 1);
        return { c: [m, p && p.estado === 'cerrado' ? 'Cerrado' : 'Abierto', p && p.estado === 'cerrado' ? dia(p.cerrado_en) : ''] };
      })
    });
    if (d.fiscal) out.push(specCierreFiscal(d.fiscal, anio, empresa.razon_social));
    return out;
  }

  /* ----------------------------- cierre mensual ----------------------------- */
  function seccionMensual(d) {
    return h('div', { class: 'tarjeta' },
      h('h2', null, `Cierre mensual ${est.anio}`),
      h('p', { class: 'ayuda' }, 'Un mes cerrado no permite crear, editar ni borrar asientos. Solo el administrador puede reabrirlo.'),
      MESES.map((nombre, i) => {
        const mes = i + 1; const p = d.periodos.get(mes);
        const cerrado = !!p && p.estado === 'cerrado';
        const accion = h('button', {
          class: 'btn btn-sec btn-peq', type: 'button',
          onclick: async (ev) => {
            const msg = cerrado
              ? `¿Reabrir ${nombre} ${est.anio}?`
              : `¿Cerrar ${nombre} ${est.anio}? Después no se podrán registrar ni cambiar asientos en ese mes.`;
            if (!window.confirm(msg)) return;
            ev.target.disabled = true;
            const { error } = await db.rpc(cerrado ? 'reabrir_periodo' : 'cerrar_periodo',
              { p_empresa: id, p_anio: est.anio, p_mes: mes });
            ev.target.disabled = false;
            if (error) { toast(traducirError(error), 'error'); return; }
            toast(cerrado ? `${nombre} reabierto.` : `${nombre} cerrado.`, 'ok');
            pintar();
          }
        }, cerrado ? 'Reabrir' : 'Cerrar mes');
        return h('div', { class: 'fila-mes-cierre' },
          h('span', null, nombre),
          h('span', { class: 'insignia' + (cerrado ? '' : ' gris') }, cerrado ? `Cerrado ${dia(p.cerrado_en)}` : 'Abierto'),
          accion);
      }));
  }

  /* ------------------------ impuestos del año (automático) ------------------------ */
  function tarjetaImpuestos(d) {
    const x = d.impuestos;
    if (!x) return h('div');
    const anio = est.anio;
    const fila = (t, v, fuerte) => h('tr', { class: fuerte ? 'fila-total' : null },
      h('td', null, t), h('td', { class: 'num' }, dinero(v)));
    const tabla = h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla estado' },
      h('thead', null, h('tr', null, h('th', null, 'Concepto'), h('th', { class: 'num' }, 'Monto'))),
      h('tbody', null,
        fila('Renta gravable (utilidad antes de impuestos)', x.utilidad_antes),
        fila(`Seguro educativo (${(NUM(x.tasa) * 100).toFixed(2)} % de la renta gravable${NUM(x.tope) > 0 ? ', base máxima ' + dinero(x.tope) : ''})`, NUM(x.se_manual) + NUM(x.se_auto)),
        fila(x.isr_es_manual ? 'Impuesto sobre la renta (monto escrito a mano)' : 'Impuesto sobre la renta (tabla de persona natural)', NUM(x.isr_manual) + NUM(x.isr_auto)),
        fila('Utilidad neta', x.utilidad_neta, true))));
    const nodos = [h('h2', null, `Impuestos del año ${anio}`)];
    if (!x.aplica) {
      nodos.push(h('p', { class: 'ayuda' }, x.tipo_persona === 'natural'
        ? 'El cálculo de impuestos está apagado para esta empresa.'
        : 'El cálculo del seguro educativo y del impuesto sobre la renta solo aplica a personas naturales.'));
    } else {
      nodos.push(h('p', { class: 'ayuda' },
        'El seguro educativo y el impuesto sobre la renta se calculan para el estado de resultados, pero no se registran solos en la contabilidad: el cierre fiscal se registra a mano al final del año (cuadro de abajo). ISR: hasta 11,000.00 exento; de 11,000.01 a 50,000.00, 15 % del excedente de 11,000.00; más de 50,000.00, 5,850.00 más 25 % del excedente de 50,000.00.'));
    }
    nodos.push(tabla);
    if (x.aplica && !x.cerrado) {
      const isr = h('input', { type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: String(NUM(x.isr_objetivo)) });
      const guardar = h('button', { class: 'btn btn-sec btn-peq', type: 'button' }, 'Guardar monto escrito');
      guardar.addEventListener('click', async () => {
        const v = Number(isr.value);
        if (!(v >= 0)) { toast('Escribe un monto válido.', 'error'); return; }
        guardar.disabled = true;
        const { error } = await db.rpc('impuestos_guardar_isr', { p_empresa: id, p_anio: anio, p_isr: v, p_nota: null });
        guardar.disabled = false;
        if (error) { toast(traducirError(error), 'error'); return; }
        toast('Impuesto sobre la renta guardado.', 'ok');
        pintar();
      });
      const volverAuto = h('button', { class: 'btn btn-sec btn-peq', type: 'button' }, 'Volver al cálculo automático');
      volverAuto.addEventListener('click', async () => {
        volverAuto.disabled = true;
        const { error } = await db.rpc('impuestos_guardar_isr', { p_empresa: id, p_anio: anio, p_isr: null, p_nota: null });
        volverAuto.disabled = false;
        if (error) { toast(traducirError(error), 'error'); return; }
        toast('Impuesto sobre la renta automático.', 'ok');
        pintar();
      });
      nodos.push(
        h('label', { class: 'campo' }, h('span', null, `Impuesto sobre la renta de ${anio} (B/.): escribe un monto solo si quieres cambiar el cálculo automático`), isr),
        h('div', { class: 'acciones' }, guardar, x.isr_es_manual ? volverAuto : null));
    }
    return h('div', { class: 'tarjeta' }, nodos);
  }

  /* ------------------------------ cierre anual ------------------------------ */
  function tablaPrevia(d) {
    return h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla estado' },
      h('thead', null, h('tr', null, h('th', null, 'Concepto'), h('th', { class: 'num' }, 'Monto'))),
      h('tbody', null, d.preview.map((r) => h('tr', { class: Number(r.orden) === 6 ? 'fila-total' : null },
        h('td', null, r.concepto), h('td', { class: 'num' }, dinero(r.monto)))))));
  }

  function seccionAnual(d) {
    const anio = est.anio;
    if (d.cerrado) {
      const reabrir = h('button', { class: 'btn btn-peligro', type: 'button' }, 'Reabrir el cierre anual');
      reabrir.addEventListener('click', async () => {
        if (!window.confirm(`¿Reabrir el cierre de ${anio}? Se borrarán los asientos de cierre y se reabrirá diciembre. Solo lo puede hacer el administrador.`)) return;
        reabrir.disabled = true;
        const { error } = await db.rpc('reabrir_cierre_anual', { p_empresa: id, p_anio: anio });
        reabrir.disabled = false;
        if (error) { toast(traducirError(error), 'error'); return; }
        toast(`Cierre de ${anio} reabierto.`, 'ok');
        pintar();
      });
      const apertura = d.apertura.length ? h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla estado' },
        h('thead', null, h('tr', null, h('th', null, 'Cuenta'), h('th', { class: 'num' }, 'Deudor'), h('th', { class: 'num' }, 'Acreedor'))),
        h('tbody', null, d.apertura.map((r) => h('tr', null,
          h('td', null, `${r.numero} ${r.nombre}`),
          h('td', { class: 'num' }, NUM(r.saldo_deudor) ? dinero(r.saldo_deudor) : ''),
          h('td', { class: 'num' }, NUM(r.saldo_acreedor) ? dinero(r.saldo_acreedor) : '')))))) : h('p', { class: 'ayuda' }, 'No hay saldos que trasladar.');
      return h('div', { class: 'tarjeta' },
        h('h2', null, `Cierre anual ${anio}`),
        h('div', { class: 'insignias' }, h('span', { class: 'insignia' }, `Año cerrado el ${dia(d.cerrado.cerrado_en)}`)),
        h('div', { class: 'resumen' },
          h('div', { class: 'chip' }, h('span', { class: 'ayuda' }, 'Ingresos'), h('strong', null, dinero(d.cerrado.total_ingresos))),
          h('div', { class: 'chip' }, h('span', { class: 'ayuda' }, 'Costos y gastos'), h('strong', null, dinero(d.cerrado.total_costos_gastos))),
          h('div', { class: 'chip' }, h('span', { class: 'ayuda' }, 'Utilidad (pérdida) neta'), h('strong', null, dinero(d.cerrado.utilidad_neta))),
          h('div', { class: 'chip' }, h('span', { class: 'ayuda' }, 'Retiros cerrados'), h('strong', null, dinero(d.cerrado.retiros_cerrados)))),
        h('h3', null, `Saldos de apertura al 1 de enero de ${anio + 1}`),
        h('p', { class: 'ayuda' }, 'Los saldos del balance pasan solos al año siguiente; no hace falta un asiento de apertura.'),
        apertura,
        h('p', { class: 'ayuda' }, `Los asientos de cierre quedaron en el Diario con la referencia CIERRE-${anio}. Ya puedes preparar los estados financieros de ${anio}.`),
        h('div', { class: 'acciones' }, reabrir));
    }

    const retiros = h('input', { type: 'checkbox', checked: true });
    const trasladar = h('input', { type: 'checkbox', checked: true });
    const confirmo = h('input', { type: 'checkbox' });
    const cerrar = h('button', { class: 'btn', type: 'button', disabled: true }, `Cerrar el año ${anio}`);
    confirmo.addEventListener('change', () => { cerrar.disabled = !confirmo.checked; });
    cerrar.addEventListener('click', async () => {
      if (!window.confirm(`¿Cerrar el año ${anio}? Se crean los asientos de cierre y se cierran los 12 meses. Solo el administrador puede deshacerlo.`)) return;
      cerrar.disabled = true;
      const { error } = await db.rpc('cerrar_anio', {
        p_empresa: id, p_anio: anio, p_cerrar_retiros: retiros.checked, p_trasladar_utilidad: trasladar.checked
      });
      if (error) { cerrar.disabled = false; toast(traducirError(error), 'error'); return; }
      toast(`Año ${anio} cerrado.`, 'ok');
      pintar();
    });
    return h('div', { class: 'tarjeta' },
      h('h2', null, `Cierre anual ${anio}`),
      h('p', { class: 'ayuda' }, 'Orden de trabajo: 1) registra todos los ajustes del año; el seguro educativo y el impuesto sobre la renta los asienta el sistema al 31 de diciembre (el ISR sale de la tabla de persona natural y se puede cambiar en la tarjeta de arriba); 2) revisa la vista previa; 3) imprime los informes; 4) cierra el año. Al cerrar, ingresos, costos y gastos empiezan el año siguiente en cero y activos, pasivos y capital pasan con su saldo.'),
      h('div', { class: 'acciones' },
        h('button', {
          class: 'btn btn-sec', type: 'button',
          onclick: () => abrirAjuste(id, d.cuentas, `${anio}-12-31`, pintar)
        }, '+ Asiento de ajuste (otros)')),
      h('h3', null, 'Vista previa de lo que se cierra'),
      tablaPrevia(d),
      h('label', { class: 'fila-check' }, retiros, h('span', null, 'Cerrar los retiros del propietario contra utilidades acumuladas')),
      h('label', { class: 'fila-check' }, trasladar, h('span', null, 'Trasladar la utilidad del ejercicio a utilidades acumuladas')),
      h('label', { class: 'fila-check' }, confirmo, h('span', null, `Confirmo que ya registré todos los ajustes de ${anio}, revisé el impuesto sobre la renta e imprimí los informes.`)),
      h('div', { class: 'acciones' }, cerrar));
  }

  /* ------------------------------ pantalla ------------------------------ */
  async function pintar() {
    zona.replaceChildren(cargando());
    try {
      const d = await cargar();
      est.datos = d;
      zona.replaceChildren(
        h('div', { class: 'barra-exportar' }, barraExportar({
          empresa,
          obtener: () => (est.datos ? { specs: specs(est.datos), archivo: `${empresa.razon_social}-cierre-${est.anio}` } : null)
        })),
        tarjetaVerificacion({ empresa, anio: est.anio }), tarjetaImpuestos(d), tarjetaCierreFiscal(d.fiscal, est.anio), seccionAnual(d), seccionMensual(d));
    } catch (e) {
      est.datos = null;
      zona.replaceChildren(h('div', { class: 'tarjeta error' }, h('p', null, traducirError(e))));
    }
  }

  barra.replaceChildren(h('input', {
    type: 'number', min: '2000', max: '2100', step: '1', inputmode: 'numeric', value: String(est.anio),
    onchange: (e) => { const v = Number(e.target.value); if (v >= 2000 && v <= 2100) { est.anio = v; pintar(); } }
  }));
  mostrar(marcoEmpresa(empresa, 'cierre', [barra, zona]));
  pintar();
}

// FIN DEL ARCHIVO cierre.js
