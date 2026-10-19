// Soportes: foto o PDF de la factura guardado junto a cada transacción o nota de crédito.
// Los archivos van a una carpeta privada de Supabase (bucket "soportes", hasta 5 MB) y solo
// los ven los usuarios de la empresa. Se pueden ver desde la ficha de la transacción.
import { db, h, toast, traducirError } from './lib.js';
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

// Prepara el archivo: las fotos se reducen; los PDF deben pesar menos de 5 MB
export async function prepararSoporte(archivo) {
  if (archivo.type === 'application/pdf') {
    if (archivo.size > MAX_BYTES) throw new Error('El PDF pesa más de 5 MB. Comprímelo o toma una foto.');
    return { blob: archivo, mime: 'application/pdf', nombre: nombreSeguro(archivo.name) };
  }
  if (/^image\/(jpeg|png|webp)$/.test(archivo.type)) {
    const blob = await reducirImagen(archivo);
    if (blob.size > MAX_BYTES) throw new Error('La imagen sigue pesando más de 5 MB.');
    return { blob, mime: 'image/jpeg', nombre: nombreSeguro((archivo.name || 'foto').replace(/\.[^.]+$/, '')) + '.jpg' };
  }
  throw new Error('Solo se aceptan fotos (JPG, PNG, WebP) y PDF.');
}

// Sube el archivo y lo registra en la base. Devuelve el id del soporte.
export async function subirSoporte({ empresaId, transaccionId = null, notaId = null, archivo }) {
  const p = await prepararSoporte(archivo);
  const ruta = `${empresaId}/${transaccionId || notaId || 'sin-asignar'}/${crypto.randomUUID()}-${p.nombre}`;
  const up = await db.storage.from('soportes').upload(ruta, p.blob, { contentType: p.mime, upsert: false });
  if (up.error) throw up.error;
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
