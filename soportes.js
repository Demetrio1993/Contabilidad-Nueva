// Soportes: foto o PDF de la factura guardado junto a cada transacción o nota de crédito.
// Los archivos van a una carpeta privada de Supabase (bucket "soportes", hasta 5 MB) y solo
// los ven los usuarios de la empresa. Se pueden ver desde la ficha de la transacción.
import { db, h, toast, traducirError } from './lib.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { confirmar } from './acciones.js';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_LADO = 1800;

function nombreSeguro(n) {
  const base = String(n || 'archivo').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return (base || 'archivo').slice(-60);
}

async function reducirImagen(archivo) {
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise((ok, mal) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => mal(new Error('No se pudo abrir la imagen.'));
      i.src = url;
    });
    const k = Math.min(1, MAX_LADO / Math.max(img.width, img.height));
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.round(img.width * k);
    lienzo.height = Math.round(img.height * k);
    lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);
    const blob = await new Promise((ok) => lienzo.toBlob(ok, 'image/jpeg', 0.82));
    if (!blob) throw new Error('No se pudo preparar la imagen.');
    return blob;
  } finally { URL.revokeObjectURL(url); }
}

// Copia el archivo a la memoria del teléfono. Algunos teléfonos Android dejan de
// permitir leer el archivo original después de elegirlo y el envío falla con "Failed to fetch".
async function copiarEnMemoria(archivo, mime) {
  try {
    const buf = await archivo.arrayBuffer();
    return new Blob([buf], { type: mime });
  } catch (e) {
    throw new Error('No se pudo leer el archivo del teléfono. Vuelve a elegirlo o toma la foto otra vez.');
  }
}

// Prepara el archivo: las fotos se reducen; los PDF deben pesar menos de 5 MB
export async function prepararSoporte(archivo) {
  if (archivo.type === 'application/pdf') {
    if (archivo.size > MAX_BYTES) throw new Error('El PDF pesa más de 5 MB. Comprímelo o toma una foto.');
    return { blob: await copiarEnMemoria(archivo, 'application/pdf'), mime: 'application/pdf', nombre: nombreSeguro(archivo.name) };
  }
  if (/^image\/(jpeg|png|webp)$/.test(archivo.type)) {
    const blob = await reducirImagen(archivo);
    if (blob.size > MAX_BYTES) throw new Error('La imagen sigue pesando más de 5 MB.');
    return { blob: await copiarEnMemoria(blob, 'image/jpeg'), mime: 'image/jpeg', nombre: nombreSeguro((archivo.name || 'foto').replace(/\.[^.]+$/, '')) + '.jpg' };
  }
  throw new Error('Solo se aceptan fotos (JPG, PNG, WebP) y PDF.');
}

const ES_RED = /failed to fetch|networkerror|load failed|network request failed/i;

// Envío directo a Storage (plan B si la librería falla por la red)
async function subirDirecto(ruta, blob, mime) {
  const ses = await db.auth.getSession();
  const token = ses && ses.data && ses.data.session ? ses.data.session.access_token : SUPABASE_ANON_KEY;
  const url = `${SUPABASE_URL}/storage/v1/object/soportes/${ruta.split('/').map(encodeURIComponent).join('/')}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': mime, 'x-upsert': 'false', 'cache-control': '3600' },
    body: blob
  });
  if (!r.ok) {
    let msg = '';
    try { const j = await r.json(); msg = j.message || j.error || ''; } catch (_) { /* sin cuerpo */ }
    throw new Error(`El servidor rechazó el archivo (código ${r.status}${msg ? ': ' + msg : ''}).`);
  }
}

// Sube el archivo y lo registra en la base. Devuelve el id del soporte.
export async function subirSoporte({ empresaId, transaccionId = null, notaId = null, archivo }) {
  const p = await prepararSoporte(archivo);
  const ruta = `${empresaId}/${transaccionId || notaId || 'sin-asignar'}/${crypto.randomUUID()}-${p.nombre}`;
  const up = await db.storage.from('soportes').upload(ruta, p.blob, { contentType: p.mime, upsert: false });
  if (up.error) {
    const m = String(up.error.message || up.error);
    if (!ES_RED.test(m)) throw up.error;
    // Plan B: envío directo; si también falla, se muestra el detalle real
    try { await subirDirecto(ruta, p.blob, p.mime); } catch (e2) {
      const det = e2 && e2.message ? e2.message : String(e2);
      if (ES_RED.test(det)) throw new Error('No se pudo enviar el archivo a Supabase Storage (' + det + '). Si el internet funciona, revisa que el archivo 64 se haya ejecutado completo (carpeta "soportes" en Storage).');
      throw e2;
    }
  }
  const r = await db.rpc('registrar_soporte', {
    p_empresa: empresaId, p_transaccion: transaccionId, p_nota: notaId,
    p_ruta: ruta, p_nombre: p.nombre, p_mime: p.mime, p_tamano: p.blob.size
  });
  if (r.error) {
    await db.storage.from('soportes').remove([ruta]);
    throw r.error;
  }
  return r.data;
}

const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

// Lista de soportes con enlaces para verlos, y botones para adjuntar o quitar
export function panelSoportes({ empresaId, transaccionId = null, notaId = null, puedeSubir, puedeQuitar }) {
  const caja = h('div', { class: 'bloque-fiscal' }, h('p', { class: 'ayuda' }, 'Cargando archivos…'));
  const entrada = h('input', {
    type: 'file', accept: 'image/*,application/pdf', hidden: true,
    onchange: async (ev) => {
      const archivo = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!archivo) return;
      boton.disabled = true;
      try {
        await subirSoporte({ empresaId, transaccionId, notaId, archivo });
        toast('Archivo adjuntado.', 'ok');
        await cargar();
      } catch (e) { toast(traducirError(e), 'error'); } finally { boton.disabled = false; }
    }
  });
  const boton = h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: () => entrada.click() }, '+ Adjuntar foto o PDF');

  async function cargar() {
    let q = db.from('soportes').select('id, ruta, nombre, tipo_mime, tamano, creado_por, creado_en').eq('empresa_id', empresaId);
    q = transaccionId ? q.eq('transaccion_id', transaccionId) : q.eq('nota_credito_id', notaId);
    const r = await q.order('creado_en');
    if (r.error) {
      caja.replaceChildren(h('p', { class: 'ayuda' }, 'Falta ejecutar el archivo 64 en Supabase para guardar los soportes.'));
      return;
    }
    const filas = r.data || [];
    let firmas = {};
    if (filas.length) {
      const f = await db.storage.from('soportes').createSignedUrls(filas.map((x) => x.ruta), 3600);
      if (!f.error) for (const x of f.data || []) firmas[x.path] = x.signedUrl;
    }
    caja.replaceChildren(
      h('p', null, h('strong', null, 'Soporte de la factura')),
      !filas.length ? h('p', { class: 'ayuda' }, 'Todavía no hay foto ni PDF adjunto.') : null,
      ...filas.map((x) => h('div', { class: 'soporte-fila' },
        firmas[x.ruta]
          ? h('a', { href: firmas[x.ruta], target: '_blank', rel: 'noopener' }, (x.tipo_mime === 'application/pdf' ? 'PDF · ' : 'Foto · ') + x.nombre)
          : h('span', null, x.nombre),
        h('span', { class: 'ayuda' }, kb(x.tamano || 0)),
        puedeQuitar && puedeQuitar(x) ? h('button', {
          class: 'btn btn-sec btn-peq', type: 'button',
          onclick: () => confirmar({
            titulo: 'Quitar archivo', mensaje: `Se borra "${x.nombre}" de esta transacción.`, boton: 'Quitar',
            alConfirmar: async () => {
              const d = await db.rpc('eliminar_soporte', { p_soporte: x.id });
              if (d.error) throw d.error;
              if (d.data) await db.storage.from('soportes').remove([d.data]);
              toast('Archivo quitado.', 'ok');
              await cargar();
            }
          })
        }, 'Quitar') : null)),
      puedeSubir ? h('div', { class: 'acciones' }, boton, entrada) : null);
  }
  cargar();
  return caja;
}

// FIN DEL ARCHIVO soportes.js
