// Clientes y proveedores
import { db, h, mostrar, toast, modal, campo, texto, traducirError, cargando, marco, marcoEmpresa, cargarEmpresa } from './lib.js';

const TIPOS = { cliente: 'Cliente', proveedor: 'Proveedor', ambos: 'Cliente y proveedor' };

// Abre el formulario de un cliente o proveedor (nuevo si tercero es null).
// alGuardar recibe la fila guardada.
export function abrirTercero(empresaId, tercero, tipoSugerido, alGuardar) {
  const t = tercero || {};
  const nuevo = !tercero;
  const f = {
    tipo: h('select', { value: t.tipo ?? tipoSugerido ?? 'proveedor' },
      Object.entries(TIPOS).map(([v, n]) => h('option', { value: v }, n))),
    razon: h('input', { type: 'text', required: true, value: t.razon_social ?? '' }),
    comercial: h('input', { type: 'text', value: t.nombre_comercial ?? '' }),
    ruc: h('input', { type: 'text', value: t.ruc ?? '' }),
    dv: h('input', { type: 'text', maxlength: '3', value: t.dv ?? '' }),
    direccion: h('input', { type: 'text', value: t.direccion ?? '' }),
    telefono: h('input', { type: 'tel', value: t.telefono ?? '' }),
    correo: h('input', { type: 'email', value: t.correo ?? '' }),
    activo: h('input', { type: 'checkbox', checked: nuevo ? true : t.activo })
  };
  let cerrar;

  async function guardar(ev) {
    ev.preventDefault();
    const datos = {
      tipo: f.tipo.value,
      razon_social: texto(f.razon.value),
      nombre_comercial: texto(f.comercial.value),
      ruc: texto(f.ruc.value),
      dv: texto(f.dv.value),
      direccion: texto(f.direccion.value),
      telefono: texto(f.telefono.value),
      correo: texto(f.correo.value),
      activo: f.activo.checked
    };
    if (!datos.razon_social) { toast('Escribe el nombre o razón social.', 'error'); return; }
    const r = nuevo
      ? await db.from('terceros').insert({ ...datos, empresa_id: empresaId }).select('*').single()
      : await db.from('terceros').update(datos).eq('id', t.id).select('*').single();
    if (r.error) {
      const dup = r.error.code === '23505';
      toast(dup ? 'Ya existe un cliente o proveedor con ese RUC y DV.' : traducirError(r.error), 'error');
      return;
    }
    toast(nuevo ? 'Guardado.' : 'Cambios guardados.', 'ok');
    cerrar();
    alGuardar(r.data);
  }

  cerrar = modal(nuevo ? 'Nuevo cliente o proveedor' : 'Cliente o proveedor', h('form', { onsubmit: guardar },
    campo('Tipo', f.tipo),
    campo('Nombre o razón social', f.razon),
    campo('Nombre comercial', f.comercial),
    h('div', { class: 'acciones' },
      h('div', { style: 'flex: 2 1 160px' }, campo('RUC', f.ruc)),
      h('div', { style: 'flex: 1 1 80px' }, campo('DV', f.dv))),
    campo('Dirección', f.direccion),
    campo('Teléfono', f.telefono),
    campo('Correo', f.correo),
    nuevo ? null : h('label', { class: 'fila-check' }, f.activo, h('span', null, 'Activo')),
    h('button', { class: 'btn btn-bloque', type: 'submit' }, 'Guardar')));
}

export async function vistaTerceros(id) {
  mostrar(marco(cargando()));
  const [empresa, r] = await Promise.all([
    cargarEmpresa(id),
    db.from('terceros').select('*').eq('empresa_id', id).order('razon_social').range(0, 4999)
  ]);
  if (r.error) throw r.error;
  let lista = r.data;
  const filtro = { texto: '', tipo: '' };
  const cont = h('div', { class: 'lista-cuentas' });
  const contador = h('p', { class: 'ayuda' });

  function pintar() {
    const t = filtro.texto.toLowerCase();
    const vistas = lista.filter((x) =>
      (!filtro.tipo || x.tipo === filtro.tipo || x.tipo === 'ambos') &&
      (!t || x.razon_social.toLowerCase().includes(t) || (x.ruc || '').toLowerCase().includes(t)));
    cont.replaceChildren(...vistas.map((x) =>
      h('button', {
        class: 'cuenta' + (x.activo ? '' : ' inactiva'), type: 'button',
        onclick: () => abrirTercero(id, x, null, recargar)
      },
        h('span', { class: 'num' }, x.ruc ? `${x.ruc}${x.dv ? '-' + x.dv : ''}` : 'sin RUC'),
        h('span', null, x.razon_social),
        h('span', { class: 'insignias' }, h('span', { class: 'insignia gris' }, TIPOS[x.tipo])))));
    contador.textContent = vistas.length === 0 && lista.length === 0
      ? 'Todavía no hay clientes ni proveedores.'
      : `${vistas.length} de ${lista.length}`;
  }

  async function recargar() {
    const n = await db.from('terceros').select('*').eq('empresa_id', id).order('razon_social').range(0, 4999);
    if (n.error) { toast(traducirError(n.error), 'error'); return; }
    lista = n.data;
    pintar();
  }

  const buscar = h('input', {
    type: 'search', placeholder: 'Buscar por nombre o RUC',
    oninput: (e) => { filtro.texto = e.target.value.trim(); pintar(); }
  });
  const tipo = h('select', { onchange: (e) => { filtro.tipo = e.target.value; pintar(); } },
    h('option', { value: '' }, 'Todos'),
    h('option', { value: 'cliente' }, 'Clientes'),
    h('option', { value: 'proveedor' }, 'Proveedores'));

  pintar();
  mostrar(marcoEmpresa(empresa, 'terceros', [
    h('div', { class: 'filtros' }, buscar, tipo),
    contador,
    cont,
    h('div', { class: 'acciones' },
      h('button', { class: 'btn', type: 'button', onclick: () => abrirTercero(id, null, null, recargar) }, '+ Nuevo'))
  ]));
}
