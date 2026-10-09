// Lectura de facturas con IA: foto, galería o PDF -> datos para el formulario
import { db, h, toast } from './lib.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const MAX_LADO = 1600;       // las fotos se reducen para enviarlas más rápido
const MAX_PDF = 6 * 1024 * 1024;

function aBase64(archivo) {
  return new Promise((ok, mal) => {
    const lector = new FileReader();
    lector.onload = () => ok(String(lector.result).split(',')[1]);
    lector.onerror = () => mal(new Error('No se pudo leer el archivo.'));
    lector.readAsDataURL(archivo);
  });
}

async function reducirImagen(archivo) {
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise((ok, mal) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => mal(new Error('No se pudo abrir la imagen. Prueba con otra foto.'));
      i.src = url;
    });
    const k = Math.min(1, MAX_LADO / Math.max(img.width, img.height));
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.round(img.width * k);
    lienzo.height = Math.round(img.height * k);
    lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);
    return { mime: 'image/jpeg', data: lienzo.toDataURL('image/jpeg', 0.85).split(',')[1] };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function prepararArchivo(archivo) {
  if (archivo.type === 'application/pdf') {
    if (archivo.size > MAX_PDF) throw new Error('El PDF es muy grande (máximo 6 MB).');
    return { mime: 'application/pdf', data: await aBase64(archivo) };
  }
  if (archivo.type.startsWith('image/')) return reducirImagen(archivo);
  throw new Error('Usa una foto o un PDF.');
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const txt = (v) => {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return s === '' || s.toLowerCase() === 'null' ? null : s;
};
const parte = (p) => ({ nombre: txt(p && p.nombre), ruc: txt(p && p.ruc), dv: txt(p && p.dv) });

// Deja los datos en un formato seguro y conocido
export function normalizarLectura(d) {
  const fecha = txt(d.fecha);
  return {
    emisor: parte(d.emisor),
    receptor: parte(d.receptor),
    numero_factura: txt(d.numero_factura),
    fecha: fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : null,
    subtotal: num(d.subtotal),
    itbms: num(d.itbms) ?? 0,
    total: num(d.total),
    descripcion: txt(d.descripcion),
    items: Array.isArray(d.items) ? d.items.map((i) => ({
      descripcion: txt(i && i.descripcion), cantidad: num(i && i.cantidad),
      precio_unitario: num(i && i.precio_unitario), total: num(i && i.total)
    })) : [],
    cuenta_sugerida: txt(d.cuenta_sugerida),
    confianza: txt(d.confianza) || 'media',
    observaciones: txt(d.observaciones)
  };
}

export async function leerFactura(archivo, contexto) {
  const { mime, data } = await prepararArchivo(archivo);
  const { data: sesion } = await db.auth.getSession();
  const token = (sesion && sesion.session && sesion.session.access_token) || SUPABASE_ANON_KEY;
  let r;
  try {
    r = await fetch(SUPABASE_URL + '/functions/v1/ocr-factura', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + token
      },
      body: JSON.stringify({ mime, data, ...contexto })
    });
  } catch (_e) {
    throw new Error('No llegó a la función ocr-factura. Revisa que exista en Supabase con ese nombre exacto y que tengas internet.');
  }
  let resp = null;
  try { resp = await r.json(); } catch (_e) { /* sin cuerpo */ }
  if (!r.ok) {
    const detalle = (resp && (resp.error || resp.message)) || '';
    if (r.status === 404) throw new Error('La función ocr-factura no está desplegada en Supabase (404).');
    if (r.status === 401) throw new Error('La función rechazó el acceso (401). Desactiva "Verify JWT" o vuelve a iniciar sesión. ' + detalle);
    throw new Error(detalle || 'Error de la función (código ' + r.status + ').');
  }
  if (!resp || resp.error || !resp.datos) throw new Error((resp && resp.error) || 'No se pudo leer la factura.');
  return normalizarLectura(resp.datos);
}

// Panel con los botones "Tomar foto" y "Elegir imagen o PDF"
export function panelEscaneo({ obtenerContexto, alLeer }) {
  const estado = h('p', { class: 'ayuda' });
  const botones = [];

  async function manejar(ev) {
    const archivo = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!archivo) return;
    estado.textContent = 'Leyendo la factura… puede tardar unos segundos.';
    botones.forEach((b) => { b.disabled = true; });
    try {
      const lectura = await leerFactura(archivo, obtenerContexto());
      estado.textContent = '';
      alLeer(lectura);
    } catch (e) {
      estado.textContent = '';
      toast(e.message, 'error');
    } finally {
      botones.forEach((b) => { b.disabled = false; });
    }
  }

  const camara = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: manejar });
  const galeria = h('input', { type: 'file', accept: 'image/*,application/pdf', hidden: true, onchange: manejar });
  const b1 = h('button', { class: 'btn btn-sec', type: 'button', onclick: () => camara.click() }, 'Tomar foto');
  const b2 = h('button', { class: 'btn btn-sec', type: 'button', onclick: () => galeria.click() }, 'Elegir imagen o PDF');
  botones.push(b1, b2);

  return h('div', { class: 'grupo' },
    h('h3', null, 'Leer factura con IA'),
    h('div', { class: 'acciones' }, b1, b2),
    camara, galeria, estado,
    h('p', { class: 'ayuda' }, 'La lectura puede equivocarse: revisa los datos antes de registrar.'));
}
