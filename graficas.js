// Gráficas con color (SVG, sin librerías): barras por mes, dona y barras horizontales.
// Los colores salen de variables CSS (--g1 … --g6) que cambian solos en modo oscuro.
// Cada gráfica trae su leyenda y una tabla con los mismos datos (accesibilidad).
import { h } from './lib.js';

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs, ...hijos) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  for (const c of hijos.flat()) if (c) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

export const COLORES = ['var(--g1)', 'var(--g2)', 'var(--g3)', 'var(--g4)', 'var(--g5)', 'var(--g6)'];
const fmt = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const corto = (v) => {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(1) + ' M';
  if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + ' mil';
  return String(Math.round(v));
};

// Escala "bonita" para el eje vertical
function escala(min, max) {
  if (min > 0) min = 0;
  if (max < 0) max = 0;
  if (max === min) max = min + 1;
  const paso0 = (max - min) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(paso0)));
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= paso0) || mag * 10;
  const lo = Math.floor(min / paso) * paso;
  const hi = Math.ceil(max / paso) * paso;
  const marcas = [];
  for (let v = lo; v <= hi + paso / 2; v += paso) marcas.push(Math.round(v * 1e6) / 1e6);
  return { lo, hi, marcas };
}

function leyenda(series) {
  return h('div', { class: 'g-leyenda' }, series.map((x) =>
    h('span', { class: 'g-item' }, h('i', { class: 'g-punto', style: `background:${x.color}` }), x.nombre)));
}

function tabla(etiquetas, series) {
  return h('details', { class: 'g-tabla' },
    h('summary', null, 'Ver datos en tabla'),
    h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
      h('thead', null, h('tr', null, h('th', null, ''), series.map((x) => h('th', { class: 'num' }, x.nombre)))),
      h('tbody', null, etiquetas.map((e, i) => h('tr', null, h('td', null, e),
        series.map((x) => h('td', { class: 'num' }, fmt(x.valores[i])))))))));
}

// Barras agrupadas por categoría y, opcionalmente, una serie de línea en el mismo eje.
// series: [{ nombre, valores, color }]   linea: { nombre, valores, color } | null
export function barrasAgrupadas({ titulo, etiquetas, series, linea, nota }) {
  const W = 340; const H = 190; const m = { i: 40, d: 8, s: 10, b: 22 };
  const todos = series.flatMap((x) => x.valores).concat(linea ? linea.valores : []);
  const { lo, hi, marcas } = escala(Math.min(0, ...todos), Math.max(0, ...todos));
  const y = (v) => m.s + (1 - (v - lo) / (hi - lo)) * (H - m.s - m.b);
  const ancho = (W - m.i - m.d) / etiquetas.length;
  const k = series.length;
  const bw = Math.max(3, Math.min(16, (ancho - 4) / k - 2));
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'g-svg', role: 'img', 'aria-label': titulo });
  for (const v of marcas) {
    svg.append(s('line', { x1: m.i, x2: W - m.d, y1: y(v), y2: y(v), class: v === 0 ? 'g-cero' : 'g-rejilla' }));
    svg.append(s('text', { x: m.i - 4, y: y(v) + 3, class: 'g-eje', 'text-anchor': 'end' }, corto(v)));
  }
  etiquetas.forEach((e, i) => {
    const x0 = m.i + ancho * i + ancho / 2 - (k * (bw + 2)) / 2;
    svg.append(s('text', { x: m.i + ancho * i + ancho / 2, y: H - 6, class: 'g-eje', 'text-anchor': 'middle' }, e));
    series.forEach((ser, j) => {
      const v = ser.valores[i] || 0;
      if (!v) return;
      const yy = y(Math.max(v, 0)); const hh = Math.max(1, Math.abs(y(v) - y(0)));
      svg.append(s('rect', { x: x0 + j * (bw + 2), y: v >= 0 ? yy : y(0), width: bw, height: hh, rx: 2, fill: ser.color },
        s('title', null, `${e} · ${ser.nombre}: B/. ${fmt(v)}`)));
    });
  });
  if (linea) {
    const pts = etiquetas.map((_, i) => [m.i + ancho * i + ancho / 2, y(linea.valores[i] || 0)]);
    svg.append(s('polyline', { points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke: linea.color, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    pts.forEach((p, i) => svg.append(s('circle', { cx: p[0], cy: p[1], r: 3.5, fill: linea.color, class: 'g-anillo' },
      s('title', null, `${etiquetas[i]} · ${linea.nombre}: B/. ${fmt(linea.valores[i])}`))));
  }
  const todas = linea ? series.concat([linea]) : series;
  return h('div', { class: 'tarjeta g-tarjeta' }, h('h3', null, titulo), nota ? h('p', { class: 'ayuda' }, nota) : null,
    leyenda(todas), svg, tabla(etiquetas, todas));
}

// Dona con leyenda de montos y porcentajes. items: [{ nombre, valor }]
export function dona({ titulo, items, centro, nota }) {
  const lista = items.filter((x) => x.valor > 0.004);
  const total = lista.reduce((a, x) => a + x.valor, 0);
  if (!lista.length) return h('div', { class: 'tarjeta g-tarjeta' }, h('h3', null, titulo), h('p', { class: 'ayuda' }, 'Sin datos para mostrar.'));
  const dat = lista.map((x, i) => ({ ...x, color: COLORES[i % COLORES.length] }));
  const R = 62; const r = 38; const C = 80;
  const svg = s('svg', { viewBox: '0 0 160 160', class: 'g-dona', role: 'img', 'aria-label': titulo });
  let ang = -Math.PI / 2;
  const pt = (rad, a) => [C + rad * Math.cos(a), C + rad * Math.sin(a)];
  if (dat.length === 1) {
    svg.append(s('circle', { cx: C, cy: C, r: (R + r) / 2, fill: 'none', stroke: dat[0].color, 'stroke-width': R - r },
      s('title', null, `${dat[0].nombre}: B/. ${fmt(dat[0].valor)} (100 %)`)));
  } else {
    for (const x of dat) {
      const a2 = ang + (x.valor / total) * Math.PI * 2;
      const grande = a2 - ang > Math.PI ? 1 : 0;
      const [x1, y1] = pt(R, ang); const [x2, y2] = pt(R, a2); const [x3, y3] = pt(r, a2); const [x4, y4] = pt(r, ang);
      svg.append(s('path', {
        d: `M${x1},${y1} A${R},${R} 0 ${grande} 1 ${x2},${y2} L${x3},${y3} A${r},${r} 0 ${grande} 0 ${x4},${y4} Z`,
        fill: x.color, class: 'g-sector'
      }, s('title', null, `${x.nombre}: B/. ${fmt(x.valor)} (${((x.valor / total) * 100).toFixed(1)} %)`)));
      ang = a2;
    }
  }
  svg.append(s('text', { x: C, y: C - 2, class: 'g-centro-t', 'text-anchor': 'middle' }, centro || 'Total'));
  svg.append(s('text', { x: C, y: C + 14, class: 'g-centro-v', 'text-anchor': 'middle' }, corto(total)));
  return h('div', { class: 'tarjeta g-tarjeta' }, h('h3', null, titulo), nota ? h('p', { class: 'ayuda' }, nota) : null,
    h('div', { class: 'g-dona-fila' }, svg,
      h('div', { class: 'g-lista' }, dat.map((x) => h('div', { class: 'g-fila' },
        h('i', { class: 'g-punto', style: `background:${x.color}` }),
        h('span', { class: 'g-nom' }, x.nombre),
        h('span', { class: 'g-val' }, fmt(x.valor)),
        h('span', { class: 'g-pct' }, ((x.valor / total) * 100).toFixed(0) + ' %'))))),
    tabla(dat.map((x) => x.nombre), [{ nombre: 'Monto', valores: dat.map((x) => x.valor) }]));
}

// Barras horizontales de una sola serie. items: [{ nombre, valor, color? }]
export function barrasH({ titulo, items, nota, color }) {
  const max = Math.max(0.01, ...items.map((x) => Math.abs(x.valor)));
  return h('div', { class: 'tarjeta g-tarjeta' }, h('h3', null, titulo), nota ? h('p', { class: 'ayuda' }, nota) : null,
    ...items.map((x, i) => h('div', { class: 'g-hfila' },
      h('span', { class: 'g-hetq' }, x.nombre),
      h('div', { class: 'g-hpista' }, h('div', {
        class: 'g-hrelleno', style: `width:${x.valor ? Math.max(2, (Math.abs(x.valor) / max) * 100).toFixed(1) : 0}%;background:${x.color || color || COLORES[0]}`
      })),
      h('span', { class: 'g-hval' }, fmt(x.valor)))),
    tabla(items.map((x) => x.nombre), [{ nombre: 'Monto', valores: items.map((x) => x.valor) }]));
}

// FIN DEL ARCHIVO graficas.js
