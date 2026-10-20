// Presupuesto contra real: se carga un presupuesto mensual por cuenta de ingresos, costos y gastos
// y la app lo compara con lo registrado (mes elegido y acumulado del año).
import {
  db, h, mostrar, toast, modal, campo, dinero, traducirError, cargando,
  marcoEmpresa, cargarEmpresa, hoy, redondear
} from './lib.js';
import { confirmar, rpcOk } from './acciones.js';
import { barraExportar } from './informes.js';
import { barrasAgrupadas } from './graficas.js';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
  'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const GRUPOS = [
  { clave: 'ingreso', nombre: 'Ingresos' },
  { clave: 'costo', nombre: 'Costos' },
  { clave: 'gasto', nombre: 'Gastos' },
  { clave: 'extraordinario', nombre: 'Otros (extraordinarios)' }
];
const NUM = (v) => Number(v || 0);
const MENSAJE_FALTA = 'Falta ejecutar el archivo 72 en Supabase para usar el presupuesto.';

// Una diferencia es favorable si en ingresos el real supera lo presupuestado y en costos y gastos queda por debajo
const favorable = (tipo, dif) => (tipo === 'ingreso' ? dif >= 0 : dif <= 0);
const pct = (real, pres) => (Math.abs(pres) < 0.005 ? '—' : `${(real / pres * 100).toFixed(0)} %`);

export async function vistaPresupuesto(id) {
  mostrar(marcoEmpresa({ id, razon_social: '…' }, 'presupuesto', cargando()));
  const empresa = await cargarEmpresa(id);
  const puedeEditar = ['administrador', 'contador'].includes(empresa.rol);
  const hoyD = hoy();
  const est = { anio: Number(hoyD.slice(0, 4)), mes: Number(hoyD.slice(5, 7)), datos: null, presup: [], cuentas: [] };
  const zona = h('div');
  const barra = h('div', { class: 'filtros' });

  async function cargar() {
    const [v, p, c] = await Promise.all([
      db.rpc('presupuesto_vs_real', { p_empresa: id, p_anio: est.anio, p_mes: est.mes }),
      db.from('presupuestos').select('id, cuenta_id, montos').eq('empresa_id', id).eq('anio', est.anio),
      db.from('cuentas').select('id, numero, nombre, tipo')
        .eq('empresa_id', id).eq('acepta_movimientos', true).eq('activa', true)
        .in('tipo', ['ingreso', 'costo', 'gasto', 'extraordinario']).order('numero').range(0, 4999)
    ]);
    for (const r of [v, p, c]) if (r.error) throw r.error;
    est.datos = v.data || []; est.presup = p.data || []; est.cuentas = c.data || [];
  }

  function totales() {
    const t = {};
    for (const g of GRUPOS) t[g.clave] = { pm: 0, rm: 0, pa: 0, ra: 0 };
    for (const f of est.datos) {
      const x = t[f.tipo]; if (!x) continue;
      x.pm += NUM(f.pres_mes); x.rm += NUM(f.real_mes); x.pa += NUM(f.pres_acum); x.ra += NUM(f.real_acum);
    }
    const u = { pm: 0, rm: 0, pa: 0, ra: 0 };
    for (const k of ['pm', 'rm', 'pa', 'ra']) {
      u[k] = t.ingreso[k] - t.costo[k] - t.gasto[k] - t.extraordinario[k];
    }
    return { t, u };
  }

  /* ------------------------------ exportación ------------------------------ */
  function specs() {
    const { t, u } = totales();
    const cols = [{ t: 'Cuenta', w: 3 }, { t: `Pres. ${CORTOS[est.mes - 1]}`, num: true }, { t: `Real ${CORTOS[est.mes - 1]}`, num: true },
      { t: 'Diferencia', num: true }, { t: 'Pres. acum.', num: true }, { t: 'Real acum.', num: true }, { t: 'Diferencia', num: true }, { t: '% real', num: true }];
    const filas = [];
    for (const g of GRUPOS) {
      const fs = est.datos.filter((f) => f.tipo === g.clave);
      if (!fs.length) continue;
      filas.push({ c: [g.nombre, null, null, null, null, null, null, ''], e: 'seccion' });
      for (const f of fs) {
        filas.push({ c: [`${f.numero} ${f.nombre}`, redondear(NUM(f.pres_mes)), redondear(NUM(f.real_mes)), redondear(NUM(f.real_mes) - NUM(f.pres_mes)),
          redondear(NUM(f.pres_acum)), redondear(NUM(f.real_acum)), redondear(NUM(f.real_acum) - NUM(f.pres_acum)), pct(NUM(f.real_acum), NUM(f.pres_acum))] });
      }
      const x = t[g.clave];
      filas.push({ c: [`Total ${g.nombre.toLowerCase()}`, redondear(x.pm), redondear(x.rm), redondear(x.rm - x.pm), redondear(x.pa), redondear(x.ra), redondear(x.ra - x.pa), pct(x.ra, x.pa)], e: 'total' });
    }
    filas.push({ c: ['Utilidad (pérdida)', redondear(u.pm), redondear(u.rm), redondear(u.rm - u.pm), redondear(u.pa), redondear(u.ra), redondear(u.ra - u.pa), pct(u.ra, u.pa)], e: 'total' });
    return [{
      titulo: `Presupuesto contra real ${est.anio}`,
      subtitulo: `${MESES[est.mes - 1]} y acumulado de enero a ${MESES[est.mes - 1].toLowerCase()}`,
      hoja: 'Presupuesto vs real',
      horizontal: true,
      columnas: cols, filas,
      notas: ['La diferencia es real menos presupuesto. En ingresos, una diferencia positiva es favorable; en costos y gastos, favorable es lo negativo.'],
      graficas: [graficaDatos(t, u, 'pdf')]
    }];
  }

  function graficaDatos(t, u, modo) {
    const etiquetas = ['Ingresos', 'Costos', 'Gastos', 'Utilidad'];
    const pres = [t.ingreso.pa, t.costo.pa, t.gasto.pa + t.extraordinario.pa, u.pa].map((v) => redondear(v));
    const real = [t.ingreso.ra, t.costo.ra, t.gasto.ra + t.extraordinario.ra, u.ra].map((v) => redondear(v));
    const c1 = modo === 'pdf' ? '#8aa39b' : 'var(--g2)';
    const c2 = modo === 'pdf' ? '#0b6b57' : 'var(--g1)';
    const titulo = `Acumulado a ${MESES[est.mes - 1].toLowerCase()}: presupuesto y real`;
    if (modo === 'pdf') {
      return { tipo: 'barras', titulo, etiquetas, series: [{ nombre: 'Presupuesto', valores: pres, color: c1 }, { nombre: 'Real', valores: real, color: c2 }] };
    }
    return barrasAgrupadas({ titulo, etiquetas, series: [{ nombre: 'Presupuesto', valores: pres, color: c1 }, { nombre: 'Real', valores: real, color: c2 }] });
  }

  /* ------------------------------ pantalla ------------------------------ */
  function vistaComparacion() {
    if (!est.datos.length) {
      return h('div', { class: 'tarjeta' },
        h('p', null, `No hay presupuesto ni movimientos de ingresos, costos o gastos en ${est.anio}.`),
        puedeEditar ? h('p', { class: 'ayuda' }, 'Agrega una cuenta con "+ Cuenta al presupuesto" o copia lo real de otro año.') : null);
    }
    const { t, u } = totales();
    const chip = (titulo, x, tipo) => h('div', { class: 'chip' },
      h('span', { class: 'ayuda' }, titulo),
      h('strong', null, dinero(x.ra)),
      h('span', { class: 'ayuda' }, `Presupuesto ${dinero(x.pa)} · `,
        h('span', { class: favorable(tipo, x.ra - x.pa) ? 'pos' : 'neg' }, `${x.ra - x.pa >= 0 ? '+' : '−'}${dinero(Math.abs(x.ra - x.pa))}`)));
    const gasto = { pa: t.gasto.pa + t.extraordinario.pa, ra: t.gasto.ra + t.extraordinario.ra };
    const dif = (tipo, p, r) => h('td', { class: 'num ' + (Math.abs(r - p) < 0.005 ? '' : favorable(tipo, r - p) ? 'pos' : 'neg') },
      (r - p >= 0 ? '+' : '−') + dinero(Math.abs(r - p)));
    const cuerpo = [];
    for (const g of GRUPOS) {
      const fs = est.datos.filter((f) => f.tipo === g.clave);
      if (!fs.length) continue;
      cuerpo.push(h('tr', null, h('td', { colspan: 8, class: 'seccion' }, h('strong', null, g.nombre))));
      for (const f of fs) {
        const pr = est.presup.find((x) => x.cuenta_id === f.cuenta_id);
        cuerpo.push(h('tr', puedeEditar ? { class: 'fila-click', onclick: () => editarCuenta(f.cuenta_id) } : null,
          h('td', null, `${f.numero} ${f.nombre}`, !pr ? h('span', { class: 'insignia gris' }, 'Sin presupuesto') : null),
          h('td', { class: 'num' }, dinero(f.pres_mes)), h('td', { class: 'num' }, dinero(f.real_mes)), dif(g.clave, NUM(f.pres_mes), NUM(f.real_mes)),
          h('td', { class: 'num' }, dinero(f.pres_acum)), h('td', { class: 'num' }, dinero(f.real_acum)), dif(g.clave, NUM(f.pres_acum), NUM(f.real_acum)),
          h('td', { class: 'num' }, pct(NUM(f.real_acum), NUM(f.pres_acum)))));
      }
      const x = t[g.clave];
      cuerpo.push(h('tr', { class: 'total' }, h('td', null, `Total ${g.nombre.toLowerCase()}`),
        h('td', { class: 'num' }, dinero(x.pm)), h('td', { class: 'num' }, dinero(x.rm)), dif(g.clave, x.pm, x.rm),
        h('td', { class: 'num' }, dinero(x.pa)), h('td', { class: 'num' }, dinero(x.ra)), dif(g.clave, x.pa, x.ra),
        h('td', { class: 'num' }, pct(x.ra, x.pa))));
    }
    cuerpo.push(h('tr', { class: 'total' }, h('td', null, 'Utilidad (pérdida)'),
      h('td', { class: 'num' }, dinero(u.pm)), h('td', { class: 'num' }, dinero(u.rm)), dif('ingreso', u.pm, u.rm),
      h('td', { class: 'num' }, dinero(u.pa)), h('td', { class: 'num' }, dinero(u.ra)), dif('ingreso', u.pa, u.ra),
      h('td', { class: 'num' }, pct(u.ra, u.pa))));
    return h('div', null,
      h('div', { class: 'resumen' },
        chip('Ingresos (acumulado)', t.ingreso, 'ingreso'),
        chip('Costos (acumulado)', t.costo, 'costo'),
        chip('Gastos (acumulado)', gasto, 'gasto'),
        chip('Utilidad (acumulado)', u, 'ingreso')),
      graficaDatos(t, u, 'web'),
      h('div', { class: 'tarjeta' },
        h('h3', null, `${MESES[est.mes - 1]} ${est.anio} y acumulado del año`),
        h('p', { class: 'ayuda' }, 'Diferencia = real menos presupuesto. En verde lo favorable, en rojo lo desfavorable.' + (puedeEditar ? ' Toca una cuenta para editar su presupuesto.' : '')),
        h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla-pres' },
          h('thead', null, h('tr', null, h('th', null, 'Cuenta'), h('th', null, `Pres. ${CORTOS[est.mes - 1]}`), h('th', null, `Real ${CORTOS[est.mes - 1]}`), h('th', null, 'Dif.'),
            h('th', null, 'Pres. acum.'), h('th', null, 'Real acum.'), h('th', null, 'Dif.'), h('th', null, '% real'))),
          h('tbody', null, cuerpo)))));
  }

  async function pintar() {
    zona.replaceChildren(cargando());
    try {
      await cargar();
    } catch (e) {
      est.datos = null;
      const falta = /presupuesto_vs_real|presupuestos|function|relation/i.test(e.message || '');
      zona.replaceChildren(h('div', { class: 'tarjeta error' }, h('p', null, falta ? MENSAJE_FALTA : traducirError(e))));
      return;
    }
    zona.replaceChildren(
      h('div', { class: 'barra-exportar' }, barraExportar({
        empresa,
        obtener: () => (est.datos && est.datos.length ? { specs: specs(), archivo: `${empresa.razon_social}-presupuesto-${est.anio}-${String(est.mes).padStart(2, '0')}` } : null)
      })),
      puedeEditar ? h('div', { class: 'acciones' },
        h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: () => editarCuenta(null) }, '+ Cuenta al presupuesto'),
        h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: copiarReal }, 'Copiar lo real de otro año')) : null,
      vistaComparacion());
  }

  /* ------------------------------ editar una cuenta ------------------------------ */
  function editarCuenta(cuentaId) {
    const existente = cuentaId ? est.presup.find((x) => x.cuenta_id === cuentaId) : null;
    const montos = existente ? existente.montos.map(NUM) : Array(12).fill(0);
    const sel = h('select', { required: true },
      h('option', { value: '' }, 'Elige una cuenta…'),
      est.cuentas.map((c) => h('option', { value: c.id }, `${c.numero} · ${c.nombre}`)));
    if (cuentaId) { sel.value = cuentaId; sel.disabled = true; }
    const fijo = h('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', placeholder: 'Ej.: 1500.00' });
    const campos = montos.map((m, i) => h('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', value: String(m) }));
    const repartir = h('button', {
      class: 'btn btn-sec btn-peq', type: 'button',
      onclick: () => { const v = Number(fijo.value); if (!(v >= 0) || fijo.value === '') { toast('Escribe el monto mensual.', 'error'); return; } campos.forEach((c) => { c.value = v.toFixed(2); }); }
    }, 'Repetir en los 12 meses');
    let cerrar;
    const guardar = h('button', {
      class: 'btn btn-bloque', type: 'button',
      onclick: async () => {
        if (!sel.value) { toast('Elige la cuenta.', 'error'); return; }
        const arr = campos.map((c) => Number(c.value || 0));
        if (arr.some((v) => !(v >= 0))) { toast('Los montos no pueden ser negativos.', 'error'); return; }
        guardar.disabled = true;
        try {
          await rpcOk(db, 'guardar_presupuesto', { p_empresa: id, p_anio: est.anio, p_cuenta: sel.value, p_montos: arr });
          cerrar(); toast('Presupuesto guardado.', 'ok'); pintar();
        } catch (e) { guardar.disabled = false; toast(traducirError(e), 'error'); }
      }
    }, 'Guardar');
    const quitar = existente ? h('button', {
      class: 'btn btn-sec btn-bloque btn-peligro-borde', type: 'button',
      onclick: () => confirmar({
        titulo: 'Quitar del presupuesto', mensaje: 'Se borra el presupuesto de esta cuenta para el año. Lo registrado no cambia.', boton: 'Quitar',
        alConfirmar: async () => { await rpcOk(db, 'eliminar_presupuesto', { p_id: existente.id }); cerrar(); pintar(); }
      })
    }, 'Quitar de este presupuesto') : null;
    cerrar = modal(`Presupuesto ${est.anio}`, h('div', null,
      campo('Cuenta', sel),
      h('div', { class: 'acciones' }, campo('Monto mensual fijo', fijo), repartir),
      h('div', { class: 'pres-meses' }, MESES.map((n, i) => campo(n, campos[i]))),
      guardar, quitar));
  }

  /* ------------------------------ copiar lo real ------------------------------ */
  function copiarReal() {
    const origen = h('input', { type: 'number', min: '2000', max: '2100', step: '1', inputmode: 'numeric', value: String(est.anio - 1) });
    const factor = h('input', { type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: '1.00' });
    let cerrar;
    const ok = h('button', {
      class: 'btn btn-bloque', type: 'button',
      onclick: () => {
        const o = Number(origen.value); const f = Number(factor.value);
        if (!(o >= 2000 && o <= 2100)) { toast('Escribe un año válido.', 'error'); return; }
        if (!(f >= 0)) { toast('El factor no puede ser negativo.', 'error'); return; }
        confirmar({
          titulo: 'Reemplazar el presupuesto',
          mensaje: `Se borra el presupuesto actual de ${est.anio} y se arma con lo registrado en ${o}${f !== 1 ? ` multiplicado por ${f}` : ''}. ¿Continuar?`,
          boton: 'Reemplazar',
          alConfirmar: async () => {
            const n = await rpcOk(db, 'copiar_real_a_presupuesto', { p_empresa: id, p_anio_origen: o, p_anio_destino: est.anio, p_factor: f });
            cerrar(); toast(n ? `Se cargaron ${n} cuentas.` : `No había movimientos en ${o}.`, n ? 'ok' : 'info'); pintar();
          }
        });
      }
    }, 'Copiar');
    cerrar = modal('Copiar lo real de otro año', h('div', null,
      h('p', { class: 'ayuda' }, `Toma mes por mes lo registrado en el año de origen y lo deja como presupuesto de ${est.anio}. Con un factor de 1.05 queda un 5 % más; con 0.90, un 10 % menos.`),
      campo('Año de origen', origen), campo('Factor', factor), ok));
  }

  const inAnio = h('input', {
    type: 'number', min: '2000', max: '2100', step: '1', inputmode: 'numeric', value: String(est.anio),
    onchange: (e) => { const v = Number(e.target.value); if (v >= 2000 && v <= 2100) { est.anio = v; pintar(); } }
  });
  const selMes = h('select', { onchange: (e) => { est.mes = Number(e.target.value); pintar(); } },
    MESES.map((n, i) => h('option', { value: String(i + 1) }, n)));
  selMes.value = String(est.mes);
  barra.replaceChildren(inAnio, selMes);
  mostrar(marcoEmpresa(empresa, 'presupuesto', [barra, zona]));
  pintar();
}

// FIN DEL ARCHIVO presupuesto.js
