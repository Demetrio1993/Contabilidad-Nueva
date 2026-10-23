// Funciones compartidas por todas las pantallas
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

if (!window.supabase) {
  document.getElementById('app').textContent =
    'No se pudo cargar la librería de conexión. Revisa tu internet y recarga la página.';
  throw new Error('La librería de Supabase no cargó');
}

export const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const estado = { email: '', recuperando: false, roles: {} };
// Número de versión que se muestra al pie. La descripción de cada versión es solo interna (manual y memoria).
export const VERSION = '33';
// Versión 31: catálogo reorganizado (gastos de operación y financieros), auxiliares por cuenta y cuadros con todos los montos.

// Crea elementos del DOM sin usar innerHTML (los datos nunca se interpretan como HTML)
export function h(tag, props, ...hijos) {
  const el = document.createElement(tag);
  let valor;
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'value') valor = v;
      else if (k === 'checked') el.checked = true;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  for (const c of hijos.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  if (valor !== undefined) el.value = valor;
  return el;
}

export function toast(mensaje, tipo = 'info') {
  const t = h('div', { class: 'toast ' + tipo }, mensaje);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), 4200);
}

export function modal(titulo, contenido) {
  const fondo = h('div', { class: 'modal-fondo' });
  const cerrar = () => fondo.remove();
  fondo.addEventListener('click', (e) => { if (e.target === fondo) cerrar(); });
  fondo.append(h('div', { class: 'modal' },
    h('div', { class: 'modal-cab' },
      h('h2', null, titulo),
      h('button', { class: 'btn-icono', type: 'button', onclick: cerrar, 'aria-label': 'Cerrar' }, '✕')),
    contenido));
  document.body.append(fondo);
  return cerrar;
}

export function mostrar(el) {
  document.getElementById('app').replaceChildren(el);
  window.scrollTo(0, 0);
}

export function irA(hash) {
  if (location.hash === hash) window.dispatchEvent(new Event('ruta'));
  else location.hash = hash;
}

export function texto(v) {
  const s = (v ?? '').toString().trim();
  return s === '' ? null : s;
}

export function traducirError(e) {
  const m = e && e.message ? e.message : String(e);
  if (e && e.code === '23505') return 'Ya existe un registro con esos datos.';
  if ((e && e.code === '42501') || /row-level security/i.test(m)) return 'No tienes permiso para esta acción.';
  if (/Invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/Email not confirmed/i.test(m)) return 'Primero confirma tu correo con el enlace que te enviamos.';
  if (/already registered/i.test(m)) return 'Ese correo ya tiene una cuenta. Entra con tu contraseña.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Sin conexión. Revisa tu internet e intenta de nuevo.';
  return m;
}

export function campo(etiqueta, control, ayuda) {
  return h('label', { class: 'campo' },
    h('span', { class: 'etiqueta' }, etiqueta), control,
    ayuda ? h('span', { class: 'ayuda' }, ayuda) : null);
}

export function cargando(msg = 'Cargando…') {
  return h('p', { class: 'cargando' }, msg);
}

export function errorVista(e) {
  return h('div', { class: 'contenido' },
    h('div', { class: 'tarjeta error' },
      h('h2', null, 'No se pudo cargar'),
      h('p', null, traducirError(e)),
      h('button', { class: 'btn', type: 'button', onclick: () => window.dispatchEvent(new Event('ruta')) }, 'Reintentar')));
}

export async function salir() {
  await db.auth.signOut();
  estado.email = '';
  irA('#/');
}

// Bloque de identidad: logo sobre fondo blanco (el logo tiene letras azul oscuro, se lee en modo claro y oscuro)
// y los datos del contador. grande = pantalla de entrada; si no, versión compacta.
export function bloqueMarca(grande) {
  return h('div', { class: 'hero' + (grande ? ' hero-grande' : '') },
    h('div', { class: 'hero-logo' }, h('img', { src: grande ? 'logo-completo.png' : 'logo-marca.png', alt: 'Demetrio Dutari Castro, Contador Público Autorizado' })),
    h('div', { class: 'hero-texto' },
      h('h1', null, 'Contabilidad para Empresas'),
      h('p', { class: 'hero-nombre' }, 'Licdo. Demetrio Dutari Castro'),
      h('p', { class: 'hero-cpa' }, 'Contador Público Autorizado'),
      h('p', { class: 'hero-dato' }, 'RUC: 9-740-702 DV 37'),
      h('p', { class: 'hero-dato' }, 'Santiago de Veraguas - República de Panamá'),
      h('p', { class: 'hero-lema' }, 'Honestidad y transparencia, al servicio de Panamá.')));
}

export function marco(...contenido) {
  return h('div', { class: 'marco' },
    h('header', { class: 'barra' },
      h('a', { class: 'marca', href: '#/empresas' },
        h('span', { class: 'marca-logo' }, h('img', { src: 'logo-marca.png', alt: 'Logo' })),
        h('span', { class: 'marca-texto' }, 'Contabilidad')),
      h('div', { class: 'barra-der' },
        h('span', { class: 'correo' }, estado.email),
        h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: salir }, 'Salir'))),
    h('main', { class: 'contenido' }, contenido),
    h('footer', { class: 'pie' }, 'Versión ' + VERSION));
}

// El auxiliar solo ve Transacciones (y Clientes y prov. si el administrador se lo habilitó)
export function pestanaPermitida(rol, permisos, clave) {
  if (rol !== 'auxiliar') return true;
  return clave === 'transacciones' || clave === 'terceros';
}

// Rol de la persona en la empresa (se guarda para no consultarlo en cada pantalla)
export async function cargarRol(id) {
  if (estado.roles[id]) return estado.roles[id];
  const r = await db.rpc('mi_rol', { p_empresa: id });
  const fila = !r.error && Array.isArray(r.data) ? r.data[0] : null;
  estado.roles[id] = { rol: fila ? fila.rol : null, permisos: fila ? (fila.permisos || []) : [] };
  return estado.roles[id];
}

export function marcoEmpresa(empresa, pestana, contenido) {
  const pestanas = [
    ['transacciones', 'Transacciones'],
    ['panel', 'Panel'],
    ['informes', 'Informes'],
    ['estados', 'Estados financieros'],
    ['cierre', 'Cierre'],
    ['presupuesto', 'Presupuesto'],
    ['impuestos', 'Impuestos'],
    ['renta', 'Declaración de renta'],
    ['cartera', 'Cobrar y pagar'],
    ['activos', 'Activos'],
    ['conciliacion', 'Conciliación'],
    ['inventario', 'Inventario'],
    ['analisis', 'Análisis'],
    ['terceros', 'Clientes y prov.'],
    ['bitacora', 'Bitácora'],
    ['catalogo', 'Catálogo'],
    ['datos', 'Datos']
  ];
  const info = empresa.rol !== undefined ? { rol: empresa.rol, permisos: empresa.permisos || [] } : (estado.roles[empresa.id] || {});
  const visibles = pestanas.filter(([clave]) => pestanaPermitida(info.rol, info.permisos, clave));
  return marco(
    h('a', { class: 'volver', href: '#/empresas' }, '← Empresas'),
    h('h1', { class: 'titulo' }, empresa.razon_social),
    h('nav', { class: 'pestanas' }, visibles.map(([clave, nombre]) =>
      h('a', { class: 'pestana' + (clave === pestana ? ' activa' : ''), href: `#/empresa/${empresa.id}/${clave}` }, nombre))),
    contenido);
}

export async function empresaCorta(id) {
  const { data, error } = await db.from('empresas')
    .select('id, razon_social, contribuyente_itbms').eq('id', id).single();
  if (error) throw error;
  return data;
}

// Importes en balboas: B/. 1,234.56
export function dinero(n) {
  const v = Number(n || 0);
  return 'B/. ' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Fecha de hoy según la hora local del teléfono, formato AAAA-MM-DD
export function hoy() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function redondear(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// Empresa completa (todas las columnas)
export async function cargarEmpresa(id) {
  const { data, error } = await db.from('empresas').select('*').eq('id', id).single();
  if (error) throw error;
  const r = await cargarRol(id);
  data.rol = r.rol;
  data.permisos = r.permisos;
  return data;
}

// 2026-03-05 -> 05/03/2026
export function fechaCorta(f) {
  if (!f) return '';
  const [a, m, d] = String(f).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}
// FIN DEL ARCHIVO lib.js
