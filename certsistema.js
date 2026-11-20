// Pestaña Datos de cada empresa: certificación del contador sobre el sistema de contabilidad electrónico y
// documentación del sistema (docsistema.js), ambas descargables por separado o en un solo PDF.
// Reutiliza las certificaciones de efpymescert.js. Se guarda en efpymes_certificados (tipo 'sistema', anio 0),
// de modo que cada cliente tiene su propio texto, campos y fecha. Los generales del contador se toman de
// efpymes_contador (los mismos de las certificaciones de los estados financieros).
import { db, h, toast, campo, traducirError, hoy, VERSION } from './lib.js';
import { descargar } from './exportar.js';
import { construirPdfPymes } from './efpymespdf.js';
import { construirDocumentacion } from './docsistema.js';
import { CAMPOS, TEXTO_DEFECTO, camposPorDefecto, generalesPorDefecto, construirDocsSistema } from './efpymescert.js';

const TIPO = 'sistema';

export function seccionCertSistema(empresa) {
  const puede = empresa.rol === 'admin' || empresa.rol === 'contador';
  const caja = h('div', { class: 'tarjeta' }, h('h2', null, 'Certificación del sistema contable'), h('p', { class: 'ayuda' }, 'Cargando…'));

  async function iniciar() {
    const [cert, cont] = await Promise.all([
      db.from('efpymes_certificados').select('datos').eq('empresa_id', empresa.id).eq('anio', 0).eq('tipo', TIPO).maybeSingle(),
      db.from('efpymes_contador').select('datos').maybeSingle()
    ]);
    const falta = (e) => e && (e.code === 'PGRST205' || e.code === '42P01' || /efpymes/.test(e.message || ''));
    if (cert.error && !falta(cert.error)) throw cert.error;
    if (cont.error && !falta(cont.error)) throw cont.error;
    const ctx = {
      empresa, anio: Number(hoy().slice(0, 4)), version: VERSION,
      contador: (cont.data && cont.data.datos) || {}
    };
    pintar(ctx, (cert.data && cert.data.datos) || {});
  }

  function pintar(ctx, guardado) {
    const g = generalesPorDefecto(ctx.contador);
    const valores = camposPorDefecto(TIPO, ctx, guardado.campos);
    const inputs = CAMPOS[TIPO].map(([k, e]) => ({
      k, e, input: h(k === 'alcance' || k === 'norma' ? 'textarea' : 'input', { type: 'text', rows: '3', disabled: !puede }, '')
    }));
    inputs.forEach(({ k, input }) => { input.value = valores[k] || ''; });
    const area = h('textarea', { rows: '22', disabled: !puede }, guardado.texto || TEXTO_DEFECTO[TIPO]);
    const reunir = () => {
      const campos = {}; inputs.forEach(({ k, input }) => { campos[k] = input.value.trim(); });
      return { campos, texto: area.value.trim() === TEXTO_DEFECTO[TIPO].trim() ? '' : area.value };
    };
    const guardar = h('button', { class: 'btn', type: 'button' }, 'Guardar');
    guardar.addEventListener('click', async () => {
      guardar.disabled = true;
      const { error } = await db.from('efpymes_certificados').upsert(
        { empresa_id: empresa.id, anio: 0, tipo: TIPO, datos: reunir(), actualizado_en: new Date().toISOString() },
        { onConflict: 'empresa_id,anio,tipo' });
      guardar.disabled = false;
      if (error) { toast(traducirError(error), 'error'); return; }
      toast('Certificación guardada.', 'ok');
    });
    const rest = h('button', { class: 'btn btn-sec', type: 'button', onclick: () => { area.value = TEXTO_DEFECTO[TIPO]; } }, 'Restaurar texto original');

    // qué = 'cert' (certificación), 'doc' (documentación del sistema) o 'ambos' (un solo PDF con las dos cosas)
    const salida = (modo, que = 'cert') => async (ev) => {
      const b = ev && ev.target; if (b) b.disabled = true;
      try {
        const docs = [];
        if (que !== 'doc') docs.push(...construirDocsSistema(ctx, reunir()));
        if (que !== 'cert') docs.push(construirDocumentacion(ctx));
        const doc = docs[0];
        const bytes = construirPdfPymes(docs, { empresa: { razon_social: empresa.razon_social, ruc: empresa.ruc, dv: empresa.dv } });
        const sufijo = { cert: 'certificacion-del-sistema', doc: 'documentacion-del-sistema', ambos: 'certificacion-y-documentacion-del-sistema' }[que];
        const base = `${empresa.razon_social}-${sufijo}`.replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '').trim().replace(/\s+/g, '-');
        const nombre = base + '.pdf';
        if (modo === 'compartir') {
          const f = new File([bytes], nombre, { type: 'application/pdf' });
          try {
            if (navigator.canShare && navigator.canShare({ files: [f] })) {
              await navigator.share({ files: [f], title: doc.titulo, text: `${que === 'doc' ? 'Documentación del sistema' : 'Certificación del sistema'} · ${empresa.razon_social}` });
              toast('Listo para enviar.', 'ok'); return;
            }
          } catch (e) { if (e && e.name === 'AbortError') return; }
          descargar(bytes, nombre, 'application/pdf');
          toast('Este aparato no puede compartir archivos; se descargó para que lo adjuntes.', 'info'); return;
        }
        descargar(bytes, nombre, 'application/pdf');
        toast(`Se descargó ${nombre}`, 'ok');
      } catch (e) { toast('No se pudo crear el archivo: ' + traducirError(e), 'error'); }
      if (b) b.disabled = false;
    };

    caja.replaceChildren(
      h('h2', null, 'Certificación del sistema contable'),
      h('p', { class: 'ayuda' }, 'Texto único de la Certificación-Declaración aprobado por la Resolución DGI 201-909 de 24 de julio de 1996 (Gaceta Oficial 23,091), que exige el artículo 6 del Decreto Ejecutivo 34 de 1998. Tiene dos partes que se firman por separado, la Certificación del CPA y la Declaración del contribuyente, más un anexo descriptivo. La resolución pide presentarla en papel simple tamaño legal, en original y con una copia para el contribuyente; se conserva a disposición de la DGI junto con la documentación del programa. Los datos del equipo (casillas 7 a 10) están adaptados a un sistema en la nube; el resto del texto no se toca. Tus generales (idoneidad, cédula) se toman de "Mis generales" de la pestaña Estados Financieros Pymes.'),
      !g.idoneidad ? h('div', { class: 'aviso-lectura' }, h('strong', null, 'Falta tu número de idoneidad.'), h('p', null, 'Escríbelo en "Mis generales" (pestaña Estados Financieros Pymes, Certificaciones) y saldrá aquí.')) : null,
      inputs.map(({ e, input }) => campo(e, input)),
      campo('Texto de la certificación', area, 'Las marcas entre llaves, como {entidad} o {fecha}, se reemplazan con los datos de arriba al generar el PDF. Los párrafos se separan con una línea en blanco; **así** va en negrita; "# Título" va centrado.'),
      h('div', { class: 'acciones' }, puede ? guardar : null, puede ? rest : null,
        h('button', { class: 'btn btn-sec', type: 'button', onclick: salida('descargar') }, 'Descargar PDF'),
        h('button', { class: 'btn btn-sec', type: 'button', onclick: salida('compartir') }, 'Compartir PDF')),
      h('h3', null, 'Documentación del sistema'),
      h('p', { class: 'ayuda' }, 'PDF corto que describe el sistema, sus controles, las copias de seguridad y los servicios que usa. El titular lo conserva con la certificación a disposición de la DGI. Se arma solo con los datos de este cliente y la versión vigente; no hay nada que llenar.'),
      h('div', { class: 'acciones' },
        h('button', { class: 'btn btn-sec', type: 'button', onclick: salida('descargar', 'doc') }, 'Descargar documentación'),
        h('button', { class: 'btn btn-sec', type: 'button', onclick: salida('compartir', 'doc') }, 'Compartir documentación'),
        h('button', { class: 'btn', type: 'button', onclick: salida('descargar', 'ambos') }, 'Descargar certificación y documentación (un PDF)')));
  }

  iniciar().catch((e) => {
    caja.replaceChildren(h('h2', null, 'Certificación del sistema contable'),
      h('p', { class: 'ayuda' }, 'No se pudo cargar: ' + traducirError(e)));
  });
  return caja;
}
// FIN DEL ARCHIVO certsistema.js
