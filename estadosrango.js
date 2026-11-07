// Balance general y estado de resultados por rango: fechas "desde - hasta" y cuentas "desde - hasta".
// Usan las mismas funciones de la base que los estados anuales (saldos_balance, saldos_resultados,
// utilidad_pendiente), así que no hace falta ejecutar nada nuevo en Supabase.
import { db } from './lib.js';
import { enRangoCuenta, hayRangoCuentas, etiquetaCuentas, fechaDMA } from './rangos.js';

const NUM = (v) => Number(v || 0);
const r2 = (v) => Math.round((NUM(v) + Number.EPSILON) * 100) / 100;

const GRUPOS_RES = [
  ['ingresos', 'INGRESOS', 'Total ingresos'],
  ['costos', 'COSTOS', 'Total costos'],
  ['gastos_operativos', 'GASTOS OPERATIVOS', 'Total gastos operativos'],
  ['otros_ingresos', 'OTROS INGRESOS', 'Total otros ingresos'],
  ['gastos_financieros', 'GASTOS FINANCIEROS', 'Total gastos financieros'],
  ['extraordinarios', 'GASTOS Y EGRESOS EXTRAORDINARIOS', 'Total extraordinarios'],
  ['impuesto', 'IMPUESTOS REGISTRADOS', 'Total impuestos registrados']
];

const GRUPOS_BAL = [
  ['activo_corriente', 'ACTIVOS CORRIENTES', 'Total activos corrientes'],
  ['activo_no_corriente', 'ACTIVOS NO CORRIENTES', 'Total activos no corrientes'],
  ['pasivo_corriente', 'PASIVOS CORRIENTES', 'Total pasivos corrientes'],
  ['pasivo_no_corriente', 'PASIVOS NO CORRIENTES', 'Total pasivos no corrientes'],
  ['patrimonio', 'PATRIMONIO', 'Total patrimonio']
];

// Cada fila: { tipo: 'titulo'|'detalle'|'subtotal'|'total', concepto, monto }
export async function estadoResultadosRango(empresaId, desde, hasta, ctaDesde, ctaHasta) {
  const { data, error } = await db.rpc('saldos_resultados', { p_empresa: empresaId, p_desde: desde, p_hasta: hasta });
  if (error) throw error;
  const filtradas = (data || []).filter((r) => r.grupo && enRangoCuenta(r.numero, ctaDesde, ctaHasta));
  const filas = [];
  const t = {};
  GRUPOS_RES.forEach(([g, titulo, totalTxt]) => {
    const rs = filtradas.filter((r) => r.grupo === g).sort((a, b) => a.numero.localeCompare(b.numero, 'en', { numeric: true }));
    t[g] = r2(rs.reduce((s, r) => s + NUM(r.monto), 0));
    if (!rs.length) return;
    filas.push({ tipo: 'titulo', concepto: titulo });
    rs.forEach((r) => filas.push({ tipo: 'detalle', concepto: `${r.numero} ${r.nombre}`, monto: r2(r.monto) }));
    filas.push({ tipo: 'subtotal', concepto: totalTxt, monto: t[g] });
  });
  const utilidad = r2(t.ingresos - t.costos - t.gastos_operativos + t.otros_ingresos
    - t.gastos_financieros - t.extraordinarios - t.impuesto);
  if (filas.length) filas.push({ tipo: 'total', concepto: hayRangoCuentas(ctaDesde, ctaHasta) ? 'RESULTADO DE LAS CUENTAS DEL RANGO' : 'UTILIDAD (PÉRDIDA) DEL PERÍODO', monto: utilidad });
  return { filas, utilidad };
}

export async function balanceRango(empresaId, hasta, ctaDesde, ctaHasta) {
  const [sb, up] = await Promise.all([
    db.rpc('saldos_balance', { p_empresa: empresaId, p_hasta: hasta }),
    db.rpc('utilidad_pendiente', { p_empresa: empresaId, p_hasta: hasta })
  ]);
  if (sb.error) throw sb.error;
  if (up.error) throw up.error;
  const conRango = hayRangoCuentas(ctaDesde, ctaHasta);
  const rs = (sb.data || []).filter((r) => enRangoCuenta(r.numero, ctaDesde, ctaHasta));
  const filas = [];
  const t = {};
  GRUPOS_BAL.forEach(([g, titulo, totalTxt]) => {
    const del = rs.filter((r) => (g === 'patrimonio' ? r.tipo === 'patrimonio' : r.clasificacion === g))
      .sort((a, b) => a.numero.localeCompare(b.numero, 'en', { numeric: true }));
    const extra = g === 'patrimonio' && !conRango ? r2(up.data) : 0;
    t[g] = r2(del.reduce((s, r) => s + NUM(r.monto), 0) + extra);
    if (!del.length && !extra) return;
    filas.push({ tipo: 'titulo', concepto: titulo });
    del.forEach((r) => filas.push({ tipo: 'detalle', concepto: `${r.numero} ${r.nombre}`, monto: r2(r.monto) }));
    if (extra) filas.push({ tipo: 'detalle', concepto: 'Utilidad del ejercicio pendiente de cierre', monto: extra });
    filas.push({ tipo: 'subtotal', concepto: totalTxt, monto: t[g] });
  });
  const activos = r2((t.activo_corriente || 0) + (t.activo_no_corriente || 0));
  const pasivos = r2((t.pasivo_corriente || 0) + (t.pasivo_no_corriente || 0));
  const patrimonio = t.patrimonio || 0;
  if (filas.length) {
    filas.push({ tipo: 'total', concepto: conRango ? 'TOTAL ACTIVOS DEL RANGO' : 'TOTAL ACTIVOS', monto: activos });
    filas.push({ tipo: 'total', concepto: conRango ? 'TOTAL PASIVOS + PATRIMONIO DEL RANGO' : 'TOTAL PASIVOS + PATRIMONIO', monto: r2(pasivos + patrimonio) });
  }
  return { filas, diferencia: conRango ? null : r2(activos - pasivos - patrimonio) };
}

export function subtituloRango(tipo, desde, hasta, ctaDesde, ctaHasta) {
  const base = tipo === 'balance' ? `Al ${fechaDMA(hasta)}` : `Del ${fechaDMA(desde)} al ${fechaDMA(hasta)}`;
  return hayRangoCuentas(ctaDesde, ctaHasta) ? `${base} · ${etiquetaCuentas(ctaDesde, ctaHasta)}` : base;
}

// FIN DEL ARCHIVO estadosrango.js
