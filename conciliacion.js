// Conciliación bancaria: saldo del banco, movimientos procesados, notas del
// banco (intereses, comisiones) y cuadro de conciliación. Exporta a Excel y PDF.
import {
  db, h, mostrar, toast, modal, campo, texto, traducirError, cargando,
  marcoEmpresa, cargarEmpresa, hoy, redondear, fechaCorta
} from './lib.js';
import { barraExportar } from './informes.js';
import { tablaSimple } from './fiscal.js';

const NUM = (v) => Number(v || 0);
const E = { detalle: 'normal', total: 'total', control: 'n1', info: 'normal', subtotal: 'n1' };

function finDeMes(f) {
  const [a, m] = f.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

function specResumen(rows, banco, corte) {
  return {
    titulo: 'Conciliación bancaria',
    subtitulo: `${banco} · al ${fechaCorta(corte)}`,
    hoja: 'Conciliación',
    columnas: [{ t: 'Concepto', w: 1 }, { t: 'Monto', num: true }],
    filas: rows.map((r) => ({ c: [r.concepto, NUM(r.monto)], e: E[r.fila] || 'normal' }))
  };
}

function specTransito(rows, corte) {
  const filas = rows.map((r) => ({
    c: [r.tipo, fechaCorta(r.fecha), r.documento || '', r.descripcion || '', r.nombre_tercero || '', NUM(r.monto), String(NUM(r.dias))],
    e: 'normal'
  }));
  return {
    titulo: 'Depósitos en tránsito y cheques en circulación',
    subtitulo: `Al ${fechaCorta(corte)}`,
    hoja: 'Tránsito',
    horizontal: true,
    columnas: [{ t: 'Tipo' }, { t: 'Fecha' }, { t: 'Documento' }, { t: 'Descripción', w: 1 }, { t: 'Tercero' },
      { t: 'Monto', num: true }, { t: 'Días', num: true }],
    filas
  };
}

function abrirNota(id, cuentaId, cuentas, alGuardar) {
  const f = {
    tipo: h('select', null,
      h('option', { value: 'nota_credito' }, 'Nota de crédito (el banco te acreditó, ej. intereses)'),
      h('option', { value: 'nota_debito' }, 'Nota de débito (el banco te cobró, ej. comisión)')),
    fecha: h('input', { type: 'date', required: true, value: hoy() }),
    desc: h('input', { type: 'text', placeholder: 'Ej. Comisión bancaria' }),
    monto: h('input', { type: 'number', step: '0.01', min: '0.01', inputmode: 'decimal', required: true }),
    contra: h('select', { required: true }, h('option', { value: '' }, 'Cuenta de contrapartida…'),
      cuentas.map((c) => h('option', { value: c.id }, `${c.numero} ${c.nombre}`)))
  };
  let cerrar;
  async function guardar(ev) {
    ev.preventDefault();
    const m = Number(f.monto.value);
    if (!(m > 0)) { toast('Escribe un monto mayor que cero.', 'error'); return; }
    if (!f.contra.value) { toast('Elige la cuenta de contrapartida.', 'error'); return; }
    const r = await db.from('partidas_banco').insert({
      empresa_id: id, cuenta_id: cuentaId, fecha: f.fecha.value, tipo: f.tipo.value,
      descripcion: texto(f.desc.value), monto: redondear(m), cuenta_contrapartida_id: f.contra.value
    });
    if (r.error) { toast(traducirError(r.error), 'error'); return; }
    toast('Nota guardada. Falta contabilizarla.', 'ok');
    cerrar();
    alGuardar();
  }
  cerrar = modal('Nota del banco', h('form', { onsubmit: guardar },
    campo('Tipo', f.tipo), campo('Fecha', f.fecha), campo('Descripción', f.desc), campo('Monto', f.monto),
    campo('Contrapartida', f.contra, 'Ejemplo: intereses ganados o comisiones bancarias.'),
    h('button', { class: 'btn btn-bloque', type: 'submit' }, 'Guardar')));
}

export async function vistaConciliacion(id) {
  mostrar(marcoEmpresa({ id, razon_social: '…' }, 'conciliacion', cargando()));
  const empresa = await cargarEmpresa(id);
  const est = { cuenta: '', corte: finDeMes(hoy()), bancos: [], todas: [], resumen: [], transito: [], saldo: '' };
  const filtros = h('div', { class: 'filtros' });
  const zona = h('div');

  try {
    const r = await db.from('cuentas').select('id, numero, nombre').eq('empresa_id', id)
      .eq('acepta_movimientos', true).eq('activa', true).order('numero').range(0, 4999);
    if (r.error) throw r.error;
    est.todas = r.data || [];
    est.bancos = est.todas.filter((c) => c.numero.startsWith('1.1.01'));
    est.cuenta = est.bancos.length ? est.bancos[0].id : '';
  } catch (e) { toast(traducirError(e), 'error'); }

  const nombreCuenta = () => {
    const c = est.bancos.find((x) => x.id === est.cuenta);
    return c ? `${c.numero} ${c.nombre}` : '';
  };

  function armar() {
    filtros.replaceChildren(
      h('select', { onchange: (e) => { est.cuenta = e.target.value; pintar(); } },
        est.bancos.length ? est.bancos.map((c) => h('option', { value: c.id, selected: c.id === est.cuenta }, `${c.numero} ${c.nombre}`))
          : [h('option', { value: '' }, 'No hay cuentas de banco')]),
      h('label', { class: 'campo' }, h('span', { class: 'etiqueta' }, 'Fecha de corte'),
        h('input', { type: 'date', value: est.corte, onchange: (e) => { est.corte = e.target.value; pintar(); } })));
  }

  async function guardarSaldo(valor) {
    const v = Number(valor);
    if (!Number.isFinite(v)) { toast('Escribe el saldo del estado de cuenta del banco.', 'error'); return; }
    const r = await db.from('conciliaciones').upsert(
      { empresa_id: id, cuenta_id: est.cuenta, fecha_corte: est.corte, saldo_banco: redondear(v) },
      { onConflict: 'empresa_id,cuenta_id,fecha_corte' });
    if (r.error) { toast(traducirError(r.error), 'error'); return; }
    toast('Saldo del banco guardado.', 'ok');
    pintar();
  }

  async function pintar() {
    if (!est.cuenta) { zona.replaceChildren(h('p', { class: 'ayuda' }, 'Crea una cuenta de banco en el catálogo, dentro de 1.1.01.')); return; }
    zona.replaceChildren(cargando());
    try {
      const p = { p_empresa: id, p_cuenta: est.cuenta };
      const [conc, res, tra, mov, notas] = await Promise.all([
        db.from('conciliaciones').select('saldo_banco').eq('empresa_id', id).eq('cuenta_id', est.cuenta).eq('fecha_corte', est.corte).maybeSingle(),
        db.rpc('conciliacion_resumen', { ...p, p_fecha_corte: est.corte }),
        db.rpc('conciliacion_transito', { ...p, p_fecha_corte: est.corte }),
        db.rpc('conciliacion_movimientos', { ...p, p_hasta: est.corte, p_solo_pendientes: false }),
        db.from('partidas_banco').select('*').eq('empresa_id', id).eq('cuenta_id', est.cuenta).order('fecha').range(0, 999)
      ]);
      for (const x of [conc, res, tra, mov, notas]) if (x.error) throw x.error;
      est.resumen = res.data || []; est.transito = tra.data || [];
      const saldo = h('input', {
        type: 'number', step: '0.01', inputmode: 'decimal', placeholder: 'Saldo según el banco',
        value: conc.data ? String(conc.data.saldo_banco) : ''
      });
      const dif = est.resumen.find((x) => x.fila === 'control');
      const cuadra = dif && Math.abs(NUM(dif.monto)) < 0.005;

      const movs = (mov.data || []).filter((m) => m.fecha <= est.corte);
      const bloqueMov = movs.length
        ? h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla ancha' },
          h('thead', null, h('tr', null, ['Banco', 'Fecha', 'Descripción', 'Ingreso', 'Egreso'].map((t, i) =>
            h('th', { class: i > 2 ? 'num' : '' }, t)))),
          h('tbody', null, movs.map((m) => h('tr', null,
            h('td', null, h('input', {
              type: 'checkbox', checked: !!m.conciliado,
              onchange: async (e) => {
                const r = e.target.checked
                  ? await db.rpc('marcar_conciliado', { p_linea: m.linea_id, p_fecha_banco: est.corte })
                  : await db.rpc('desmarcar_conciliado', { p_linea: m.linea_id });
                if (r.error) { toast(traducirError(r.error), 'error'); e.target.checked = !e.target.checked; return; }
                pintar();
              }
            })),
            h('td', null, fechaCorta(m.fecha)),
            h('td', null, m.descripcion || m.documento || ''),
            h('td', { class: 'num' }, NUM(m.ingreso) ? NUM(m.ingreso).toLocaleString('en-US', { minimumFractionDigits: 2 }) : ''),
            h('td', { class: 'num' }, NUM(m.egreso) ? NUM(m.egreso).toLocaleString('en-US', { minimumFractionDigits: 2 }) : ''))))))
        : h('p', { class: 'ayuda' }, 'No hay movimientos de libros en esta cuenta hasta la fecha de corte.');

      const bloqueNotas = (notas.data || []).map((n) => h('div', { class: 'fila-mes-cierre' },
        h('span', null, `${fechaCorta(n.fecha)} · ${n.tipo === 'nota_credito' ? 'Crédito' : 'Débito'} · ${n.descripcion || ''} · B/. ${NUM(n.monto).toLocaleString('en-US', { minimumFractionDigits: 2 })}`),
        n.asiento_id
          ? h('button', {
            class: 'btn btn-sec btn-peq', type: 'button', onclick: async () => {
              const r = await db.rpc('revertir_partida_banco', { p_partida: n.id });
              if (r.error) { toast(traducirError(r.error), 'error'); return; }
              toast('Asiento deshecho.', 'ok'); pintar();
            }
          }, 'Deshacer')
          : h('button', {
            class: 'btn btn-sec btn-peq', type: 'button', onclick: async () => {
              const r = await db.rpc('contabilizar_partida_banco', { p_partida: n.id, p_fecha: null });
              if (r.error) { toast(traducirError(r.error), 'error'); return; }
              toast('Nota contabilizada.', 'ok'); pintar();
            }
          }, 'Contabilizar'),
        h('span')));

      zona.replaceChildren(...[
        barraExportar({
          empresa,
          obtener: () => (est.resumen.length
            ? { specs: [specResumen(est.resumen, nombreCuenta(), est.corte), ...(est.transito.length ? [specTransito(est.transito, est.corte)] : [])],
              archivo: `${empresa.razon_social}-conciliacion-${est.corte}` } : null)
        }),
        h('div', { class: 'tarjeta' },
          h('h3', null, 'Saldo según el banco'),
          h('div', { class: 'acciones' }, saldo,
            h('button', { class: 'btn', type: 'button', onclick: () => guardarSaldo(saldo.value) }, 'Guardar'))),
        est.resumen.length
          ? tablaSimple([{ t: 'Concepto' }, { t: 'Monto', num: true }],
            est.resumen.map((x) => ({ c: [x.concepto, NUM(x.monto)], e: E[x.fila] || 'normal' })), 'estado')
          : null,
        dif ? (cuadra ? h('p', { class: 'ayuda' }, 'La conciliación cuadra.')
          : h('div', { class: 'aviso-lectura' }, h('strong', null, 'Todavía no cuadra.'),
            h('p', null, 'Marca los movimientos que el banco ya procesó y registra intereses o comisiones que falten en libros.'))) : null,
        h('h3', null, 'Movimientos de libros'),
        h('p', { class: 'ayuda' }, 'Marca los que ya aparecen en el estado de cuenta del banco. Los no marcados quedan en tránsito o en circulación.'),
        bloqueMov,
        h('h3', null, 'Notas del banco sin registrar en libros'),
        h('div', { class: 'acciones' },
          h('button', { class: 'btn btn-sec', type: 'button', onclick: () => abrirNota(id, est.cuenta, est.todas, pintar) }, '+ Nota del banco')),
        ...bloqueNotas].filter(Boolean));
    } catch (e) {
      zona.replaceChildren(h('div', { class: 'tarjeta error' }, h('p', null, traducirError(e))));
    }
  }

  armar();
  mostrar(marcoEmpresa(empresa, 'conciliacion', [filtros, zona]));
  pintar();
}

// FIN DEL ARCHIVO conciliacion.js
