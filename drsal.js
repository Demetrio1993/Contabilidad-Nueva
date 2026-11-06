// DR Cálculos Asalariados: cuadro mensual de salarios y retenciones que alimenta
// el renglón 1 (salarios y otras remuneraciones con retenciones) y el renglón 106
// (retenciones de salarios) de la Declaración de Renta. Datos: tablas dr_asalariados
// y dr_retenciones_salarios (script 114).
import { db, h, mostrar, toast, traducirError, cargando, marcoEmpresa, cargarEmpresa, hoy, irA } from './lib.js';
import { barraExportar } from './informes.js';
import { n2 } from './exportar.js';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const CONCEPTOS = [
  ['salario_base', 'Salario base'], ['horas_extras', 'Horas extras'], ['vacaciones', 'Vacaciones'],
  ['decimo_tercer_mes', 'Décimo tercer mes'], ['comisiones', 'Comisiones'], ['bonificaciones', 'Bonificaciones'],
  ['otras', 'Otras remuneraciones']
];
const NUM = (v) => Number(v || 0);
const r2 = (v) => Math.round((NUM(v) + Number.EPSILON) * 100) / 100;

export async function vistaDrAsalariados(id) {
  mostrar(marcoEmpresa({ id, razon_social: '…' }, 'drsal', cargando()));
  const empresa = await cargarEmpresa(id);
  const puedeEditar = empresa.rol === 'admin' || empresa.rol === 'contador';
  const est = { anio: Number(hoy().slice(0, 4)), sal: {}, ret: {}, r1: null, r106: null, cambios: false };
  const cuerpo = h('div');
  const anio = h('input', {
    type: 'number', min: '2000', max: '2100', inputmode: 'numeric', value: String(est.anio),
    onchange: (e) => {
      const v = Number(e.target.value);
      if (v < 2000 || v > 2100) return;
      if (est.cambios && !confirm('Hay cambios sin guardar. ¿Cambiar de año y descartarlos?')) { e.target.value = String(est.anio); return; }
      est.anio = v; cargar();
    }
  });

  async function cargar() {
    cuerpo.replaceChildren(cargando());
    try {
      const [s, r, d] = await Promise.all([
        db.from('dr_asalariados').select('mes, concepto, monto').eq('empresa_id', id).eq('anio', est.anio),
        db.from('dr_retenciones_salarios').select('mes, monto').eq('empresa_id', id).eq('anio', est.anio),
        db.rpc('dr_declaracion', { p_empresa: id, p_anio: est.anio })
      ]);
      for (const x of [s, r, d]) if (x.error) throw x.error;
      est.sal = {}; est.ret = {};
      for (const x of s.data || []) est.sal[`${x.mes}|${x.concepto}`] = NUM(x.monto);
      for (const x of r.data || []) est.ret[x.mes] = NUM(x.monto);
      est.r1 = (d.data || []).find((x) => x.renglon === 1) || null;
      est.r106 = (d.data || []).find((x) => x.renglon === 106) || null;
      est.cambios = false;
      pintar();
    } catch (e) {
      cuerpo.replaceChildren(h('div', { class: 'tarjeta error' }, h('p', null,
        /dr_asalariados|dr_retenciones/.test(String(e && e.message)) ? 'Falta ejecutar el script 114 en Supabase (DR Cálculos Asalariados).' : traducirError(e))));
    }
  }

  const totMes = (m) => r2(CONCEPTOS.reduce((a, [k]) => a + NUM(est.sal[`${m}|${k}`]), 0));
  const totConcepto = (k) => r2(MESES.reduce((a, _x, i) => a + NUM(est.sal[`${i + 1}|${k}`]), 0));
  const granSal = () => r2(MESES.reduce((a, _x, i) => a + totMes(i + 1), 0));
  const granRet = () => r2(MESES.reduce((a, _x, i) => a + NUM(est.ret[i + 1]), 0));

  function celda(valor, alCambiar) {
    if (!puedeEditar) return h('td', { class: 'num' }, valor ? n2(valor) : '');
    const i = h('input', {
      type: 'number', step: '0.01', min: '0', inputmode: 'decimal', class: 'drsal-in', value: valor ? String(valor) : '',
      onchange: (e) => { const v = e.target.value === '' ? 0 : Number(e.target.value); if (!isFinite(v) || v < 0) { toast('Escribe un monto de 0 o más.', 'error'); e.target.value = valor ? String(valor) : ''; return; } alCambiar(r2(v)); est.cambios = true; setTimeout(pintar, 0); }
    });
    return h('td', { class: 'num' }, i);
  }

  async function guardar(ev) {
    const b = ev.target; b.disabled = true;
    try {
      const filasS = []; const filasR = [];
      MESES.forEach((_x, i) => {
        CONCEPTOS.forEach(([k]) => filasS.push({ mes: i + 1, concepto: k, monto: NUM(est.sal[`${i + 1}|${k}`]) }));
        filasR.push({ mes: i + 1, monto: NUM(est.ret[i + 1]) });
      });
      const a = await db.rpc('dr_asalariados_guardar', { p_empresa: id, p_anio: est.anio, p_filas: filasS });
      if (a.error) throw a.error;
      const c = await db.rpc('dr_retenciones_guardar', { p_empresa: id, p_anio: est.anio, p_filas: filasR });
      if (c.error) throw c.error;
      toast('Guardado. La declaración de renta ya usa estos totales.', 'ok');
      await cargar();
    } catch (e) { toast(traducirError(e), 'error'); } finally { b.disabled = false; }
  }

  function specs() {
    const cab = [{ t: 'Mes', w: 2 }, ...CONCEPTOS.map(([, t]) => ({ t, num: true })), { t: 'Total', num: true }];
    const filas = MESES.map((m, i) => ({ c: [m, ...CONCEPTOS.map(([k]) => NUM(est.sal[`${i + 1}|${k}`])), totMes(i + 1)], e: 'normal' }));
    filas.push({ c: ['Total', ...CONCEPTOS.map(([k]) => totConcepto(k)), granSal()], e: 'total' });
    return [{
      titulo: `DR Cálculos Asalariados ${est.anio}`, subtitulo: 'Salarios y otras remuneraciones con retenciones (renglón 1)',
      hoja: 'Salarios', columnas: cab, filas,
      notas: ['El gran total pasa al renglón 1 de la Declaración de Renta.']
    }, {
      titulo: `Retenciones de salarios ${est.anio}`, subtitulo: 'Impuesto sobre la renta retenido en la fuente por el empleador (renglón 106)',
      hoja: 'Retenciones', columnas: [{ t: 'Mes', w: 3 }, { t: 'ISR retenido', num: true }],
      filas: [...MESES.map((m, i) => ({ c: [m, NUM(est.ret[i + 1])], e: 'normal' })), { c: ['Total', granRet()], e: 'total' }],
      notas: ['El gran total pasa al renglón 106 de la Declaración de Renta.']
    }];
  }

  function enlace(f, n) {
    if (!f) return null;
    return h('p', { class: 'ayuda' }, `Renglón ${n} de la declaración ${est.anio}: ${n2(f.monto)}${f.manual ? ' (hay un monto escrito a mano que reemplaza al cuadro)' : ''}. `,
      h('a', { href: `#/empresa/${id}/renta`, onclick: (ev) => { ev.preventDefault(); irA(`#/empresa/${id}/renta`); } }, 'Ver declaración'));
  }

  function pintar() {
    const tabS = h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
      h('thead', null, h('tr', null, h('th', null, 'Mes'), CONCEPTOS.map(([, t]) => h('th', { class: 'num' }, t)), h('th', { class: 'num' }, 'Total'))),
      h('tbody', null, MESES.map((m, i) => h('tr', null, h('td', null, m),
        CONCEPTOS.map(([k]) => celda(NUM(est.sal[`${i + 1}|${k}`]), (v) => { est.sal[`${i + 1}|${k}`] = v; })),
        h('td', { class: 'num' }, n2(totMes(i + 1)))))),
      h('tfoot', null, h('tr', null, h('td', null, 'Total'), CONCEPTOS.map(([k]) => h('td', { class: 'num' }, n2(totConcepto(k)))),
        h('td', { class: 'num' }, n2(granSal()))))));
    const tabR = h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla drsal-ret' },
      h('thead', null, h('tr', null, h('th', null, 'Mes'), h('th', { class: 'num' }, 'ISR retenido'))),
      h('tbody', null, MESES.map((m, i) => h('tr', null, h('td', null, m), celda(NUM(est.ret[i + 1]), (v) => { est.ret[i + 1] = v; })))),
      h('tfoot', null, h('tr', null, h('td', null, 'Total'), h('td', { class: 'num' }, n2(granRet()))))));
    cuerpo.replaceChildren(
      h('div', { class: 'tarjeta' },
        h('h3', null, 'Salarios y otras remuneraciones con retenciones'),
        h('p', { class: 'ayuda' }, `El gran total (${n2(granSal())}) pasa solo al renglón 1 de la declaración de renta ${est.anio}.`),
        tabS, enlace(est.r1, 1)),
      h('div', { class: 'tarjeta' },
        h('h3', null, 'Retenciones de salarios'),
        h('p', { class: 'ayuda' }, `Impuesto sobre la renta retenido en la fuente por tu empleador. El gran total (${n2(granRet())}) pasa solo al renglón 106.`),
        tabR, enlace(est.r106, 106)),
      puedeEditar ? h('button', { class: 'btn btn-bloque', type: 'button', onclick: guardar }, est.cambios ? 'Guardar cambios' : 'Guardar') : null,
      h('p', { class: 'ayuda' }, 'Si el año tiene datos aquí, los renglones 1 y 106 usan estos totales en lugar de las cuentas. Una celda en blanco o en 0 no cuenta. Para cambiar el monto solo en la declaración, usa el lápiz ✎ de ese renglón.'));
  }

  mostrar(marcoEmpresa(empresa, 'drsal', [
    h('div', { class: 'filtros' }, h('label', null, 'Año', anio)),
    barraExportar({ empresa, obtener: () => ({ specs: specs(), archivo: `${empresa.razon_social}-dr-calculos-asalariados-${est.anio}` }) }),
    cuerpo]));
  await cargar();
}

// FIN DEL ARCHIVO drsal.js
