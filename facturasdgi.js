// Facturas de la DGI por revisar: se cargan los Excel que exporta el Facturador Gratuito (emitidas y recibidas),
// quedan en una bandeja y nada se registra solo. La persona revisa cada fila y la registra o la descarta.
import { db, h, toast, modal, dinero, fechaCorta, traducirError } from './lib.js';
import { leerLibro, serialAFecha } from './xlsxleer.js';
import { confirmar } from './acciones.js';

/* -------------------- lectura del Excel -------------------- */
const norm = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const limpiaTexto = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const rucNorm = (v) => String(v ?? '').replace(/[\s.-]/g, '').toUpperCase();

function aNumero(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/[^0-9.,-]/g, '');
  if (!s) return 0;
  const n = Number(s.includes(',') && !s.includes('.') ? s.replace(',', '.') : s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function aFechaISO(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return serialAFecha(v);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(v).trim());
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const i = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v).trim());
  return i ? `${i[1]}-${i[2]}-${i[3]}` : null;
}

// El CUFE trae el RUC con su DV, la fecha, el número de la factura y el punto de facturación.
// Ejemplo: FE01 2 00000057983-2-340436 -10 0000 20261016 0022647677 001 0110327885914
export function leerCufe(cufe) {
  const m = /^FE(\d{2})(\d)(.{20})-(\d{2})\d{4}(\d{8})(\d{10})(\d{3})\d{13}$/.exec(String(cufe || '').trim());
  if (!m) return null;
  return { tipo: m[1], ruc: m[3].replace(/^0+/, ''), dv: m[4], numero: m[6], punto: m[7] };
}

// hoja = filas del Excel (arreglos por columna). Devuelve { sentido, filas } o lanza un error entendible.
export function filasDeHoja(hoja) {
  let enc = -1;
  for (let i = 0; i < Math.min(hoja.length, 15); i++) {
    if ((hoja[i] || []).some((c) => norm(c) === 'cufe')) { enc = i; break; }
  }
  if (enc < 0) throw new Error('No encontré la fila de títulos con la columna CUFE. Sube el Excel tal como lo exporta el Facturador Gratuito (Documentos emitidos o recibidos).');
  const col = {};
  (hoja[enc] || []).forEach((c, i) => { const k = norm(c); if (k && col[k] === undefined) col[k] = i; });
  const sentido = col['nombre del receptor'] !== undefined ? 'emitida' : col['nombre del emisor'] !== undefined ? 'recibida' : null;
  if (!sentido) throw new Error('No pude saber si son facturas emitidas o recibidas: falta la columna "Nombre del Receptor" o "Nombre del Emisor".');
  const g = (f, k) => (col[k] === undefined ? null : f[col[k]]);
  const filas = [];
  for (const f of hoja.slice(enc + 1)) {
    const cufe = limpiaTexto(g(f, 'cufe'));
    if (!cufe) continue;
    const info = leerCufe(cufe);
    const ident = sentido === 'emitida' ? g(f, 'iden receptor') : g(f, 'iden emisor');
    const nombre = sentido === 'emitida' ? g(f, 'nombre del receptor') : g(f, 'nombre del emisor');
    const ruc = limpiaTexto(ident);
    const subtotal = aNumero(g(f, 'subtotal'));
    const itbms = aNumero(g(f, 'itbms'));
    const monto = aNumero(g(f, 'monto'));
    filas.push({
      cufe, sentido,
      tipo_doc: limpiaTexto(g(f, 'tipo de documento')),
      fecha: aFechaISO(g(f, 'fecha de emision')),
      fecha_autorizacion: limpiaTexto(g(f, 'fecha de autorizacion')) || null,
      ruc: ruc || null,
      // En las recibidas el DV del emisor viene dentro del CUFE; en las emitidas el Excel no trae el DV del cliente
      dv: sentido === 'recibida' && info ? info.dv : null,
      nombre: limpiaTexto(nombre) || null,
      numero: info ? info.numero : null,
      concepto: null,
      subtotal, itbms, monto: monto || subtotal + itbms,
      // Solo para avisar si el archivo es de otra empresa (el RUC del emisor de una emitida es el de la propia empresa)
      _rucCufe: info ? info.ruc : null
    });
  }
  return { sentido, filas };
}

export async function leerArchivoFacturas(archivo) {
  const buf = await archivo.arrayBuffer();
  const u = new Uint8Array(buf.slice(0, 4));
  if (!(u[0] === 0x50 && u[1] === 0x4b)) {
    throw new Error('Este archivo no se puede leer. Pídelo en Excel al Facturador Gratuito (Documentos emitidos o recibidos) y súbelo tal cual.');
  }
  const libro = await leerLibro(buf);
  const nombre = libro.nombres[0];
  if (!nombre) throw new Error('El Excel no tiene hojas.');
  return filasDeHoja(libro.hojas[nombre] || []);
}

/* -------------------- datos para el formulario de transacciones -------------------- */
// Arma la "lectura" que ya entiende el formulario (la misma forma que la factura XML)
export function lecturaDeFila(f, empresa) {
  const itbms = Number(f.itbms) || 0;
  const monto = Number(f.monto) || 0;
  const yo = { ruc: empresa.ruc || '', dv: empresa.dv || '', nombre: empresa.razon_social };
  const otro = { ruc: f.ruc || '', dv: f.dv || '', nombre: f.nombre || '' };
  const dif = f.subtotal !== null && f.subtotal !== undefined && Math.abs(Number(f.subtotal) + itbms - monto) > 0.009;
  return {
    emisor: f.sentido === 'emitida' ? yo : otro,
    receptor: f.sentido === 'emitida' ? otro : yo,
    numero_factura: f.numero || null,
    fecha: f.fecha,
    subtotal: Math.round((monto - itbms) * 100) / 100,
    itbms, total: monto,
    descripcion: null, items: [], cuenta_sugerida: null,
    confianza: 'alta',
    observaciones: 'Cargada de la bandeja de facturas de la DGI (Excel). El Excel no trae el concepto: escríbelo o lee el PDF de la factura.'
      + (dif ? ` El subtotal del Excel (${dinero(f.subtotal)}) es distinto del monto; se usa el monto (${dinero(monto)}) porque ya incluye los descuentos.` : ''),
    cufe: f.cufe, rol: f.sentido === 'emitida' ? 'emisor' : 'receptor', forma: 'contado'
  };
}

/* -------------------- bandeja -------------------- */
export async function contarFacturasDgi(empresaId) {
  const r = await db.from('facturas_dgi').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('estado', 'pendiente');
  return r.error ? null : (r.count || 0);
}

export function abrirFacturasDgi({ empresa, terceros, alRegistrar, alCambiar }) {
  const cuerpo = h('div', null, h('p', { class: 'ayuda' }, 'Cargando…'));
  const est = { estado: 'pendiente', sentido: '' };
  let filas = []; let cerrar; let falta = false;
  const refrescar = async () => { await cargar(); alCambiar && alCambiar(); };

  async function cargar() {
    const r = await db.from('facturas_dgi').select('*').eq('empresa_id', empresa.id)
      .order('fecha', { ascending: false }).order('creado_en', { ascending: false }).range(0, 4999);
    if (r.error) { falta = true; filas = []; } else { falta = false; filas = r.data || []; }
    pintar();
  }

  async function subir(ev) {
    const arch = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!arch) return;
    try {
      const { sentido, filas: nuevas } = await leerArchivoFacturas(arch);
      if (!nuevas.length) { toast('El archivo no trae facturas.', 'info'); return; }
      const miRuc = rucNorm(empresa.ruc);
      if (sentido === 'emitida' && miRuc) {
        const otros = nuevas.filter((x) => x._rucCufe && rucNorm(x._rucCufe) !== miRuc).length;
        if (otros === nuevas.length) {
          toast('Las facturas de este archivo las emitió otro RUC, no el de esta empresa. Revisa que sea el archivo correcto.', 'error');
          return;
        }
        if (otros) toast(`${otros} factura(s) del archivo las emitió otro RUC.`, 'info');
      }
      const r = await db.rpc('importar_facturas_dgi', { p_empresa: empresa.id, p_filas: nuevas.map(({ _rucCufe, ...x }) => x) });
      if (r.error) { toast(traducirError(r.error), 'error'); return; }
      const d = r.data || {};
      toast(`${sentido === 'emitida' ? 'Emitidas' : 'Recibidas'}: ${d.nuevas || 0} nueva(s)` + (d.repetidas ? `, ${d.repetidas} ya estaban cargadas` : '') + (d.ya_registradas ? `, ${d.ya_registradas} ya registrada(s)` : '') + '.', 'ok');
      await refrescar();
    } catch (e) { toast(e.message || traducirError(e), 'error'); }
  }

  async function marcar(f, estado, nota) {
    const r = await db.rpc('marcar_factura_dgi', { p_id: f.id, p_estado: estado, p_transaccion: null, p_nota: nota || null });
    if (r.error) { toast(traducirError(r.error), 'error'); return; }
    await refrescar();
  }

  function tarjeta(f) {
    const conocido = f.ruc && (terceros || []).some((t) => t.ruc && rucNorm(t.ruc) === rucNorm(f.ruc));
    const esNc = f.es_nota_credito;
    const etq = f.sentido === 'emitida' ? (esNc ? 'Nota de crédito emitida' : 'Venta (emitida)') : (esNc ? 'Nota de crédito recibida' : 'Compra o gasto (recibida)');
    return h('div', { class: 'tarjeta' },
      h('p', null,
        h('span', { class: 'insignia ' + (esNc ? 'aviso' : 'gris') }, etq), ' ',
        f.estado === 'registrada' ? h('span', { class: 'insignia' }, 'Registrada') : null,
        f.estado === 'descartada' ? h('span', { class: 'insignia gris' }, 'Descartada') : null),
      h('p', null, h('strong', null, f.nombre || (f.sentido === 'emitida' ? 'Consumidor final (sin cliente)' : 'Sin nombre')), h('br'),
        h('span', { class: 'ayuda' }, [f.ruc ? `RUC ${f.ruc}${f.dv ? ' DV ' + f.dv : ''}` : 'Sin RUC', conocido ? 'ya está en tus ' + (f.sentido === 'emitida' ? 'clientes' : 'proveedores') : null].filter(Boolean).join(' · '))),
      h('p', null, `${f.fecha ? fechaCorta(f.fecha) : 'Sin fecha'} · N.º ${f.numero || '—'} · `, h('strong', null, dinero(f.monto)),
        Number(f.itbms) > 0 ? h('span', { class: 'ayuda' }, ` (ITBMS ${dinero(f.itbms)})`) : null, h('br'),
        h('span', { class: 'ayuda' }, f.concepto || 'Concepto: no viene en el Excel; escríbelo al registrar')),
      f.nota ? h('p', { class: 'ayuda' }, 'Nota: ' + f.nota) : null,
      esNc && f.estado === 'pendiente' ? h('p', { class: 'ayuda' }, 'Las notas de crédito se registran desde la factura original, con el botón "+ Nota de crédito". Cuando la hagas, toca "Ya la atendí".') : null,
      h('div', { class: 'acciones' },
        f.estado === 'pendiente' && !esNc ? h('button', { class: 'btn btn-peq', type: 'button', onclick: () => { cerrar(); alRegistrar(f); } }, 'Revisar y registrar') : null,
        f.estado === 'pendiente' && esNc ? h('button', { class: 'btn btn-peq', type: 'button', onclick: () => marcar(f, 'descartada', 'Nota de crédito atendida') }, 'Ya la atendí') : null,
        f.estado === 'pendiente' && !esNc ? h('button', {
          class: 'btn btn-sec btn-peq', type: 'button',
          onclick: () => confirmar({
            titulo: 'Descartar factura', mensaje: 'Sale de pendientes y no se registra. Puedes devolverla a pendientes cuando quieras.', boton: 'Descartar', peligro: false,
            alConfirmar: () => marcar(f, 'descartada', 'Descartada en la revisión')
          })
        }, 'Descartar') : null,
        f.estado === 'descartada' ? h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: () => marcar(f, 'pendiente') }, 'Volver a pendientes') : null));
  }

  function pintar() {
    if (falta) { cuerpo.replaceChildren(h('p', { class: 'ayuda' }, 'Falta ejecutar el archivo 106 en Supabase.')); return; }
    const cuenta = (e) => filas.filter((f) => f.estado === e).length;
    const vis = filas.filter((f) => (!est.estado || f.estado === est.estado) && (!est.sentido || f.sentido === est.sentido));
    const sel = (valor, opciones, alCambiarSel) => h('select', { value: valor, onchange: (e) => { alCambiarSel(e.target.value); pintar(); } },
      opciones.map(([v, n]) => h('option', { value: v }, n)));
    const entrada = h('input', { type: 'file', accept: '.xlsx,.xls', hidden: true, onchange: subir });
    cuerpo.replaceChildren(...[
      h('p', { class: 'ayuda' }, 'Sube el Excel de documentos emitidos o recibidos que exporta el Facturador Gratuito de la DGI (uno por vez). Las facturas quedan aquí por revisar: nada se registra solo. Tú eliges cuáles registrar y cuáles descartar.'),
      h('div', { class: 'acciones' },
        entrada,
        h('button', { class: 'btn', type: 'button', onclick: () => entrada.click() }, 'Cargar Excel de la DGI')),
      h('div', { class: 'filtros' },
        sel(est.estado, [['pendiente', `Por revisar (${cuenta('pendiente')})`], ['registrada', `Registradas (${cuenta('registrada')})`], ['descartada', `Descartadas (${cuenta('descartada')})`], ['', 'Todas']], (v) => { est.estado = v; }),
        sel(est.sentido, [['', 'Emitidas y recibidas'], ['emitida', 'Solo emitidas (ventas)'], ['recibida', 'Solo recibidas (compras y gastos)']], (v) => { est.sentido = v; })),
      !vis.length ? h('p', { class: 'ayuda' }, filas.length ? 'No hay facturas con ese filtro.' : 'Todavía no has cargado facturas.') : null,
      ...vis.slice(0, 200).map(tarjeta),
      vis.length > 200 ? h('p', { class: 'ayuda' }, `Se muestran las 200 más recientes de ${vis.length}.`) : null].filter(Boolean));
  }

  cerrar = modal('Facturas de la DGI por revisar', cuerpo);
  cargar();
  return cerrar;
}

// FIN DEL ARCHIVO facturasdgi.js
