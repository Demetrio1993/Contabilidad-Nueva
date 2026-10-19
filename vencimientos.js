// Calendario de vencimientos fiscales: cada empresa define sus obligaciones (día y, si es
// anual, mes). La sección muestra la próxima fecha de cada una y avisa las vencidas o cercanas.
import { db, h, toast, modal, campo, texto, traducirError, fechaCorta, hoy } from './lib.js';
import { confirmar, barraAcciones, rpcOk } from './acciones.js';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const p2 = (n) => String(n).padStart(2, '0');

// Fecha AAAA-MM-DD con el día ajustado al último del mes (31 de febrero -> 28 o 29)
export function fechaVenc(anio, mes, dia) {
  const ult = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return `${anio}-${p2(mes)}-${p2(Math.min(dia, ult))}`;
}
const aDias = (iso) => Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000);

// Próxima ocurrencia pendiente de una obligación y su estado
// cumplidos: Set de periodos ('2026-11' si es mensual, '2026' si es anual)
export function proximaOcurrencia(v, cumplidos, hoyISO) {
  const [a, m] = hoyISO.split('-').map(Number);
  const cand = [];
  if (v.periodicidad === 'mensual') {
    for (let k = -2; k <= 2; k++) {
      const d = new Date(Date.UTC(a, m - 1 + k, 1));
      const aa = d.getUTCFullYear(); const mm = d.getUTCMonth() + 1;
      cand.push({ fecha: fechaVenc(aa, mm, v.dia), periodo: `${aa}-${p2(mm)}` });
    }
  } else {
    for (let k = -1; k <= 1; k++) cand.push({ fecha: fechaVenc(a + k, v.mes, v.dia), periodo: String(a + k) });
  }
  const hoyD = aDias(hoyISO);
  const margen = v.periodicidad === 'mensual' ? 20 : 60;   // días hacia atrás en que aún se muestra como vencida
  let elegida = cand.find((c) => !cumplidos.has(c.periodo) && aDias(c.fecha) >= hoyD - margen);
  let cumplida = false;
  if (!elegida) { elegida = cand.find((c) => aDias(c.fecha) >= hoyD) || cand[cand.length - 1]; cumplida = cumplidos.has(elegida.periodo); }
  const dias = aDias(elegida.fecha) - hoyD;
  const estado = cumplida ? 'cumplido' : dias < 0 ? 'vencido' : dias <= 7 ? 'pronto' : 'proximo';
  return { ...elegida, dias, estado };
}

const ETQ = {
  vencido: (d) => `⚠ Vencido hace ${-d} día${d === -1 ? '' : 's'}`,
  pronto: (d) => (d === 0 ? '⏰ Vence hoy' : `⏰ Vence en ${d} día${d === 1 ? '' : 's'}`),
  proximo: (d) => `En ${d} días`,
  cumplido: () => '✔ Cumplido'
};
const CLASE = { vencido: 'venc-rojo', pronto: 'venc-ambar', proximo: 'venc-gris', cumplido: 'venc-verde' };

function formulario(empresa, v, alGuardar) {
  const e = v || { periodicidad: 'mensual', dia: 15, mes: 1 };
  const nombre = h('input', { type: 'text', required: true, value: e.nombre || '', placeholder: 'Ej.: Planilla de la CSS' });
  const per = h('select', { onchange: () => { filaMes.style.display = per.value === 'anual' ? '' : 'none'; } },
    h('option', { value: 'mensual', selected: e.periodicidad === 'mensual' }, 'Todos los meses'),
    h('option', { value: 'anual', selected: e.periodicidad === 'anual' }, 'Una vez al año'));
  const dia = h('input', { type: 'number', min: '1', max: '31', required: true, value: String(e.dia) });
  const mes = h('select', null, MESES.map((n, i) => h('option', { value: String(i + 1), selected: Number(e.mes) === i + 1 }, n)));
  const filaMes = campo('Mes', mes);
  filaMes.style.display = e.periodicidad === 'anual' ? '' : 'none';
  const notas = h('input', { type: 'text', value: e.notas || '', placeholder: 'Opcional' });
  let cerrar;
  async function guardar(ev) {
    ev.preventDefault();
    try {
      await rpcOk(db, 'guardar_vencimiento', {
        p_id: v ? v.id : null, p_empresa: empresa.id, p_nombre: nombre.value.trim(), p_periodicidad: per.value,
        p_dia: Number(dia.value), p_mes: per.value === 'anual' ? Number(mes.value) : null, p_notas: texto(notas.value)
      });
      toast('Obligación guardada.', 'ok'); cerrar(); alGuardar();
    } catch (err) { toast(traducirError(err), 'error'); }
  }
  cerrar = modal(v ? 'Editar obligación' : 'Nueva obligación', h('form', { onsubmit: guardar },
    campo('Nombre', nombre), campo('Cuándo se repite', per), campo('Día del mes', dia), filaMes, campo('Notas', notas),
    h('button', { class: 'btn btn-bloque', type: 'submit' }, 'Guardar')));
}

export function seccionVencimientos(empresa) {
  const puedeGestionar = empresa.rol === 'admin' || empresa.rol === 'contador';
  const caja = h('div', { class: 'tarjeta' }, h('h3', null, 'Vencimientos fiscales'), h('p', { class: 'ayuda' }, 'Cargando…'));

  async function cargar() {
    const [rv, rc] = await Promise.all([
      db.from('vencimientos').select('*').eq('empresa_id', empresa.id).eq('activo', true).order('nombre'),
      db.from('vencimientos_cumplidos').select('vencimiento_id, periodo').eq('empresa_id', empresa.id)
    ]);
    if (rv.error || rc.error) {
      caja.replaceChildren(h('h3', null, 'Vencimientos fiscales'),
        h('p', { class: 'ayuda' }, 'Falta ejecutar el archivo 66 en Supabase para usar el calendario.'));
      return;
    }
    const lista = rv.data || [];
    const hecho = {};
    for (const c of rc.data || []) (hecho[c.vencimiento_id] ||= new Set()).add(c.periodo);
    const hoyISO = hoy();
    const filas = lista.map((v) => ({ v, o: proximaOcurrencia(v, hecho[v.id] || new Set(), hoyISO) }))
      .sort((a, b) => (a.o.estado === 'cumplido') - (b.o.estado === 'cumplido') || a.o.fecha.localeCompare(b.o.fecha));
    const urgentes = filas.filter((x) => x.o.estado === 'vencido' || x.o.estado === 'pronto').length;
    caja.replaceChildren(
      h('h3', null, 'Vencimientos fiscales'),
      urgentes ? h('p', { class: 'error-texto' }, `${urgentes} obligación(es) vencida(s) o por vencer esta semana.`) : null,
      !lista.length ? h('p', { class: 'ayuda' }, 'No hay obligaciones cargadas.') : null,
      ...filas.map(({ v, o }) => h('div', { class: 'venc-fila' },
        h('div', { class: 'venc-info' },
          h('strong', null, v.nombre),
          h('span', { class: 'ayuda' }, `${fechaCorta(o.fecha)}${v.notas ? ' · ' + v.notas : ''}`)),
        h('span', { class: 'insignia ' + CLASE[o.estado] }, ETQ[o.estado](o.dias)),
        puedeGestionar ? h('button', {
          class: 'btn btn-sec btn-peq', type: 'button',
          onclick: async () => {
            try {
              await rpcOk(db, 'marcar_vencimiento', { p_id: v.id, p_periodo: o.periodo, p_cumplido: o.estado !== 'cumplido' });
              cargar();
            } catch (err) { toast(traducirError(err), 'error'); }
          }
        }, o.estado === 'cumplido' ? 'Reabrir' : 'Marcar cumplido') : null)),
      puedeGestionar ? h('div', { class: 'acciones' },
        h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: () => formulario(empresa, null, cargar) }, '+ Obligación'),
        h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: () => administrar(lista) }, 'Editar lista'),
        h('button', {
          class: 'btn btn-sec btn-peq', type: 'button',
          onclick: async () => {
            try {
              const n = await rpcOk(db, 'sembrar_vencimientos', { p_empresa: empresa.id });
              toast(n ? `Se cargaron ${n} obligaciones sugeridas. Confirma los días con la DGI.` : 'Ya estaban cargadas.', 'ok');
              cargar();
            } catch (err) { toast(traducirError(err), 'error'); }
          }
        }, 'Cargar sugeridas')) : null,
      h('p', { class: 'ayuda' }, 'Las fechas son una guía que tú defines: confirma los plazos vigentes con la DGI o la entidad que corresponda.'));
  }

  function administrar(lista) {
    let cerrar;
    cerrar = modal('Obligaciones', h('div', null, lista.map((v) => h('div', { class: 'tarjeta' },
      h('p', null, h('strong', null, v.nombre), h('br'),
        h('span', { class: 'ayuda' }, v.periodicidad === 'mensual' ? `Todos los meses, día ${v.dia}` : `Cada año, ${v.dia} de ${MESES[v.mes - 1]}`)),
      barraAcciones({
        editar: () => { cerrar(); formulario(empresa, v, cargar); },
        eliminar: () => confirmar({
          titulo: 'Eliminar obligación', mensaje: `Se quita "${v.nombre}" del calendario.`, boton: 'Eliminar',
          alConfirmar: async () => { await rpcOk(db, 'eliminar_vencimiento', { p_id: v.id }); toast('Eliminada.', 'ok'); cerrar(); cargar(); }
        })
      })))));
  }

  cargar();
  return caja;
}

// FIN DEL ARCHIVO vencimientos.js
