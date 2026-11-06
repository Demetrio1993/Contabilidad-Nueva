// Captura de la factura electrónica de la DGI por su código QR.
// El QR trae la dirección de consulta de la DGI con el CUFE. De ahí salen, sin internet, el RUC y DV del emisor,
// la fecha y el número de la factura. Los montos, nombres y demás datos se piden a la función ocr-factura (modo "qr"),
// que baja la página de la DGI. Las cuentas y auxiliares nunca se llenan: se eligen a mano.
import { h, toast, modal } from './lib.js';
import { leerQrServidor, normalizarLectura } from './ocr.js';
import { leerFacturaXml } from './facturaxml.js';

/* ------------------------- lectura del texto del QR ------------------------- */
// FE01 2 00000057983-2-340436 -10 0000 20261016 0022647677 001 0110327885914
const PATRON_CUFE = /FE(\d{2})(\d)(.{20})-(\d{2})\d{4}(\d{8})(\d{10})(\d{3})\d{13}/;

export function leerCufeCompleto(cufe) {
  const m = new RegExp('^' + PATRON_CUFE.source + '$').exec(String(cufe || '').trim());
  if (!m) return null;
  const f = m[5];
  const fecha = /^20\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(f) ? `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}` : null;
  return { tipo: m[1], ruc: m[3].replace(/^0+/, ''), dv: m[4], fecha, numero: m[6], punto: m[7] };
}

// Devuelve { url, cufe } a partir de lo que contiene el QR (dirección de la DGI, o solo el CUFE)
export function interpretarQr(texto) {
  const t = String(texto || '').trim();
  let url = null; let cufe = null;
  try {
    const u = new URL(t);
    if (u.protocol === 'https:') url = u.toString();
    cufe = u.searchParams.get('chFE') || u.searchParams.get('CUFE') || u.searchParams.get('cufe');
  } catch (_e) { /* no es una dirección */ }
  if (!cufe) {
    const m = PATRON_CUFE.exec(t.replace(/\s+/g, ''));
    if (m) cufe = m[0];
  }
  cufe = cufe ? String(cufe).trim() : null;
  if (cufe && !leerCufeCompleto(cufe)) cufe = cufe.length > 30 && /^FE/i.test(cufe) ? cufe : null;
  return { url, cufe };
}

const hostDgi = (url) => { try { return /^dgi-fep(st)?\.mef\.gob\.pa$/.test(new URL(url).hostname); } catch (_e) { return false; } };

// Del texto del QR a los datos que usa el formulario de la transacción (mismo formato que la lectura con IA y el XML)
export async function leerDesdeQr(texto, { contexto, empresa } = {}) {
  const q = interpretarQr(texto);
  if (!q.cufe && !(q.url && hostDgi(q.url))) {
    throw new Error('Este código QR no es de una factura electrónica de la DGI. Si es otro código, usa "Tomar foto" o el XML.');
  }
  const info = q.cufe ? leerCufeCompleto(q.cufe) : null;
  let lectura = null; let aviso = '';
  if (q.url && hostDgi(q.url)) {
    try {
      const r = await leerQrServidor(q.url, contexto || {});
      lectura = r.xml ? leerFacturaXml(r.xml, empresa || null) : normalizarLectura(r.datos);
      lectura.observaciones = (r.xml ? 'Consultada con el código QR. ' : 'Leída de la página de la DGI mediante el código QR; revisa los montos. ')
        + (lectura.observaciones || '');
      if (r.xml) lectura.confianza = 'alta';
    } catch (e) {
      aviso = String(e.message || e);
    }
  } else {
    aviso = 'El QR trae solo el CUFE, sin dirección de consulta.';
  }
  if (!lectura) {
    lectura = normalizarLectura({ confianza: 'baja' });
    lectura.observaciones = 'Del código QR salieron el RUC del emisor, la fecha y el número de la factura. Los montos no se pudieron traer'
      + (aviso ? ` (${aviso})` : '') + ': escríbelos o lee el XML o el PDF de la factura.';
  }
  // El CUFE completa lo que la lectura no trajo (y manda sobre el número y la fecha si faltan)
  if (q.cufe) lectura.cufe = lectura.cufe && !/^SIN-CUFE/.test(lectura.cufe) ? lectura.cufe : q.cufe;
  if (info) {
    lectura.emisor = lectura.emisor || {};
    if (!lectura.emisor.ruc) { lectura.emisor.ruc = info.ruc; lectura.emisor.dv = lectura.emisor.dv || info.dv; }
    if (!lectura.fecha && info.fecha) lectura.fecha = info.fecha;
    if (!lectura.numero_factura) lectura.numero_factura = info.numero;
    if (info.tipo !== '01') {
      lectura.observaciones += ` El CUFE indica documento tipo ${info.tipo} (no es una factura de operación interna); si es nota de crédito, anula o corrige la factura original.`;
    }
  }
  // La descripción es el detalle de la factura: todos los renglones (sin repetir), no solo un resumen
  const nombres = [...new Set((lectura.items || []).map((i) => String(i.descripcion || '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
  if (nombres.length) lectura.descripcion = nombres.join('; ').slice(0, 240);
  lectura.cuenta_sugerida = null;
  return lectura;
}

/* ------------------------- lectura de la imagen o de la cámara ------------------------- */
let detector = null;
let tieneDetector;
async function usaDetector() {
  if (tieneDetector !== undefined) return tieneDetector;
  tieneDetector = false;
  try {
    if ('BarcodeDetector' in window) {
      const f = await window.BarcodeDetector.getSupportedFormats();
      if (f.includes('qr_code')) { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); tieneDetector = true; }
    }
    diag.detector = tieneDetector ? 'sí' : ('BarcodeDetector' in window ? 'sin QR' : 'no existe');
  } catch (_e) { tieneDetector = false; diag.detector = 'error'; }
  return tieneDetector;
}

let promesaJsQr = null;
export const diag = { detector: '', jsqr: '' };
function cargarJsQr() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (promesaJsQr) return promesaJsQr;
  const FUENTES = ['https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js', 'https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.min.js'];
  promesaJsQr = (async () => {
    for (const src of FUENTES) {
      const ok = await new Promise((res) => {
        const s = document.createElement('script');
        s.src = src; s.async = true;
        s.onload = () => res(!!window.jsQR); s.onerror = () => res(false);
        document.head.append(s);
      });
      if (ok) { diag.jsqr = 'cargó'; return window.jsQR; }
    }
    diag.jsqr = 'no cargó (sin internet o bloqueada)';
    promesaJsQr = null;
    return null;
  })();
  return promesaJsQr;
}

const lienzo = document.createElement('canvas');
function pixeles(fuente, maxLado) {
  const w0 = fuente.videoWidth || fuente.naturalWidth || fuente.width;
  const h0 = fuente.videoHeight || fuente.naturalHeight || fuente.height;
  if (!w0 || !h0) return null;
  const k = Math.min(1, maxLado / Math.max(w0, h0));
  lienzo.width = Math.round(w0 * k); lienzo.height = Math.round(h0 * k);
  const c = lienzo.getContext('2d', { willReadFrequently: true });
  c.drawImage(fuente, 0, 0, lienzo.width, lienzo.height);
  return c.getImageData(0, 0, lienzo.width, lienzo.height);
}

// fuente: <video>, <img>, <canvas> o ImageBitmap. Devuelve el texto del QR o null.
export async function decodificar(fuente, { intensivo = false } = {}) {
  if (await usaDetector()) {
    try {
      const r = await detector.detect(fuente);
      if (r && r.length && r[0].rawValue) return r[0].rawValue;
    } catch (_e) { /* se prueba con jsQR */ }
    if (!intensivo) return null;
  }
  const jsQR = await cargarJsQr();
  if (!jsQR) return null;
  for (const lado of intensivo ? [1600, 1000, 640] : [800]) {
    const im = pixeles(fuente, lado);
    if (!im) return null;
    const r = jsQR(im.data, im.width, im.height, { inversionAttempts: 'attemptBoth' });
    if (r && r.data) return r.data;
  }
  return null;
}

/* ------------------------- pantalla del escáner ------------------------- */
export function abrirEscanerQr({ obtenerContexto, obtenerEmpresa, alLeer }) {
  let cerrado = false; let flujo = null; let ocupado = false;
  const estado = h('p', { class: 'ayuda' }, 'Apunta la cámara al código QR de la factura. Se lee solo.');
  const video = h('video', { autoplay: true, playsinline: true, muted: true, style: 'width:100%;max-height:50vh;background:#000;border-radius:8px' });
  const archivo = h('input', { type: 'file', accept: 'image/*', hidden: true });
  let cerrar = () => {};
  const parar = () => {
    cerrado = true;
    if (flujo) flujo.getTracks().forEach((t) => t.stop());
    flujo = null;
  };

  async function procesar(texto) {
    if (ocupado) return;
    ocupado = true;
    estado.textContent = 'QR leído. Consultando la factura en la DGI… puede tardar unos segundos.';
    try {
      const lectura = await leerDesdeQr(texto, { contexto: obtenerContexto ? obtenerContexto() : {}, empresa: obtenerEmpresa ? obtenerEmpresa() : null });
      parar(); cerrar();
      alLeer(lectura);
    } catch (e) {
      ocupado = false;
      estado.textContent = '';
      toast(e.message, 'error');
      if (!cerrado && flujo) bucle();
    }
  }

  async function bucle() {
    while (!cerrado && flujo && !ocupado) {
      try {
        const t = await decodificar(video);
        if (t) { await procesar(t); return; }
      } catch (_e) { /* sigue intentando */ }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  async function iniciar() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      estado.textContent = 'Este navegador no deja usar la cámara. Usa "Elegir foto del QR".';
      return;
    }
    try {
      flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (cerrado) { parar(); return; }
      video.srcObject = flujo;
      await video.play().catch(() => {});
      bucle();
    } catch (e) {
      const n = e && e.name;
      estado.textContent = (n === 'NotAllowedError' || n === 'SecurityError'
        ? 'El navegador no tiene permiso para usar la cámara. Toca el candado junto a la dirección > Permisos > Cámara > Permitir, y vuelve a abrir el escáner.'
        : `No se pudo abrir la cámara (${n || 'error'}).`) + ' Mientras tanto puedes pegar el enlace del QR abajo.';
    }
  }

  archivo.addEventListener('change', async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    estado.textContent = 'Buscando el código QR en la imagen…';
    try {
      const bmp = await createImageBitmap(f);
      const t = await decodificar(bmp, { intensivo: true });
      if (!t) {
        estado.textContent = `No se leyó el QR en la imagen. Lector del navegador: ${diag.detector || 'sin probar'}; lector de respaldo: ${diag.jsqr || 'sin probar'}. Puedes pegar el enlace del QR abajo.`;
        toast('No encontré un código QR en esa imagen.', 'error'); return;
      }
      await procesar(t);
    } catch (_e) {
      estado.textContent = '';
      toast('No se pudo abrir la imagen.', 'error');
    }
  });

  const pegado = h('textarea', { rows: '2', placeholder: 'https://dgi-fep.mef.gob.pa/Consultas/FacturasPorQR?chFE=…' });
  const cuerpo = h('div', { class: 'grupo' },
    video, estado,
    h('div', { class: 'acciones' },
      h('button', { class: 'btn btn-sec', type: 'button', onclick: () => archivo.click() }, 'Elegir foto del QR'),
      h('button', { class: 'btn btn-sec', type: 'button', onclick: () => { parar(); cerrar(); } }, 'Cancelar')),
    archivo,
    h('p', { class: 'ayuda' }, 'Si la cámara no lee el QR: léelo con la cámara del teléfono o con Google Lens, copia el enlace que sale y pégalo aquí.'),
    pegado,
    h('button', { class: 'btn btn-sec btn-bloque', type: 'button', onclick: () => { const t = pegado.value.trim(); if (!t) { toast('Pega primero el enlace o el CUFE.', 'error'); return; } procesar(t); } }, 'Usar el enlace pegado'),
    h('p', { class: 'ayuda' }, 'El QR da el RUC y DV del emisor, la fecha y el número; lo demás se trae de la DGI. Las cuentas y auxiliares los eliges tú. Revisa siempre antes de registrar.'));
  cerrar = modal('Escanear QR de la factura', cuerpo);
  // si cierran con la X o tocando fuera, se apaga la cámara
  const fondo = document.querySelector('.modal-fondo:last-of-type');
  if (fondo) new MutationObserver(() => { if (!document.body.contains(fondo)) parar(); }).observe(document.body, { childList: true });
  iniciar();
}
// FIN DEL ARCHIVO qr.js
