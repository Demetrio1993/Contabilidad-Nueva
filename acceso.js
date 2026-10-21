// Usuarios de la empresa y eliminación de la empresa (pestaña Datos)
import { db, h, toast, traducirError, campo, irA } from './lib.js';
import { confirmar } from './acciones.js';

const ROLES = {
  admin: 'Administrador (todo, incluye usuarios y eliminar la empresa)',
  contador: 'Contador (registra y corrige)',
  lector: 'Lector (solo consulta)',
  auxiliar: 'Auxiliar (ve todas las transacciones, registra y corrige lo suyo)'
};

// El auxiliar ya ve todas las transacciones de la empresa; no hay permisos extra que marcar
const PERMISOS_AUX = {};

export function seccionUsuarios(empresa) {
  const caja = h('div', null, h('p', { class: 'ayuda' }, 'Cargando usuarios…'));

  async function cargar() {
    const r = await db.rpc('usuarios_empresa', { p_empresa: empresa.id });
    if (r.error) {
      caja.replaceChildren(h('p', { class: 'ayuda' }, /administrador/i.test(r.error.message || '')
        ? 'Solo el administrador de la empresa ve y cambia los usuarios.'
        : traducirError(r.error)));
      return;
    }
    const lista = r.data || [];
    caja.replaceChildren(
      h('div', { class: 'lista-cuentas' }, lista.map((u) => h('div', { class: 'trx' },
        h('div', { class: 'trx-nom' }, u.correo),
        h('div', { class: 'trx-montos' },
          h('span', { class: 'ayuda' }, (ROLES[u.rol] ? ROLES[u.rol].split(' (')[0] : u.rol) +
            (u.rol === 'auxiliar' && (u.permisos || []).length ? ' + ' + u.permisos.map((p) => (PERMISOS_AUX[p] || p).toLowerCase().replace(/^puede /, '')).join(' y ') : '')),
          u.rol === 'auxiliar' ? h('button', {
            class: 'btn btn-sec btn-peq', type: 'button',
            onclick: () => { correoRef.value = u.correo; rolRef.value = 'auxiliar'; marcarPermisos(u.permisos || []); mostrarPermisos(); correoRef.scrollIntoView && correoRef.scrollIntoView(); }
          }, 'Permisos') : null,
          h('button', {
            class: 'btn btn-sec btn-peq', type: 'button',
            onclick: () => confirmar({
              titulo: 'Quitar usuario',
              mensaje: `¿Quitar a ${u.correo} de esta empresa? Ya no podrá verla.`,
              boton: 'Quitar',
              alConfirmar: async () => {
                const q = await db.rpc('quitar_usuario_empresa', { p_empresa: empresa.id, p_usuario: u.usuario_id });
                if (q.error) throw q.error;
                toast('Usuario quitado.', 'ok');
                cargar();
              }
            })
          }, 'Quitar'))))),
      formularioAgregar());
  }

  let correoRef; let rolRef; let marcarPermisos = () => {}; let mostrarPermisos = () => {};

  function formularioAgregar() {
    const correo = h('input', { type: 'email', placeholder: 'correo@ejemplo.com', autocomplete: 'off' });
    const rol = h('select', { value: 'contador', onchange: () => mostrarPermisos() }, Object.entries(ROLES).map(([k, v]) =>
      h('option', { value: k }, v)));
    const cajas = Object.entries(PERMISOS_AUX).map(([k, texto]) => ({
      k, caja: h('input', { type: 'checkbox' }), texto
    }));
    const bloquePermisos = h('div', { class: 'grupo' },
      h('p', { class: 'ayuda' }, 'El auxiliar ve todas las transacciones y sus totales del mes, registra, crea clientes y proveedores, y edita, anula y elimina solo lo que él mismo registró.'),
      cajas.map((c) => h('label', { class: 'fila-check' }, c.caja, h('span', null, c.texto))),
      h('p', { class: 'ayuda' }, 'Para darle más acceso (informes, estados, etc.) cámbiale el rol a Lector o Contador.'));
    correoRef = correo; rolRef = rol;
    mostrarPermisos = () => { bloquePermisos.style.display = rol.value === 'auxiliar' ? '' : 'none'; };
    marcarPermisos = (lista) => { cajas.forEach((c) => { c.caja.checked = lista.includes(c.k); }); };
    mostrarPermisos();
    const boton = h('button', { class: 'btn', type: 'submit' }, 'Agregar o cambiar rol');
    return h('form', {
      onsubmit: async (ev) => {
        ev.preventDefault();
        if (!correo.value.trim()) { toast('Escribe el correo.', 'error'); return; }
        boton.disabled = true;
        const r = await db.rpc('agregar_usuario_empresa', {
          p_empresa: empresa.id, p_correo: correo.value.trim(), p_rol: rol.value,
          p_permisos: rol.value === 'auxiliar' ? cajas.filter((c) => c.caja.checked).map((c) => c.k) : []
        });
        boton.disabled = false;
        if (r.error) { toast(traducirError(r.error), 'error'); return; }
        toast('Usuario guardado.', 'ok');
        correo.value = '';
        cargar();
      }
    },
    campo('Correo del usuario', correo, 'Debe haber creado su cuenta en la app y confirmado su correo.'),
    campo('Rol', rol),
    bloquePermisos,
    boton);
  }

  cargar();
  return h('div', { class: 'grupo' }, h('h3', null, 'Usuarios de esta empresa'), caja);
}

export function seccionEliminar(empresa) {
  const nombre = h('input', { type: 'text', placeholder: 'Escribe el nombre exacto de la empresa', autocomplete: 'off' });
  return h('div', { class: 'grupo' },
    h('h3', null, 'Eliminar empresa'),
    h('p', { class: 'ayuda' }, 'Borra la empresa con TODO lo suyo: transacciones, asientos, catálogo, activos, inventario y cierres. No se puede deshacer. Antes conviene descargar los informes en Excel. Solo el administrador puede hacerlo.'),
    campo('Para confirmar escribe: ' + empresa.razon_social, nombre),
    h('button', {
      class: 'btn btn-peligro btn-bloque', type: 'button',
      onclick: () => {
        if (nombre.value.trim().toLowerCase() !== empresa.razon_social.trim().toLowerCase()) {
          toast('El nombre no coincide con el de la empresa.', 'error');
          return;
        }
        confirmar({
          titulo: 'Eliminar empresa',
          mensaje: `Se borrará ${empresa.razon_social} y todos sus datos. ¿Seguro?`,
          boton: 'Sí, eliminar para siempre',
          alConfirmar: async () => {
            // Los archivos adjuntos viven en Storage y la base no puede borrarlos sola: se quitan primero
            let sinBorrar = 0;
            try {
              const rs = await db.from('soportes').select('ruta').eq('empresa_id', empresa.id);
              const rutas = (rs.data || []).map((x) => x.ruta).filter(Boolean);
              for (let i = 0; i < rutas.length; i += 100) {
                const q = await db.storage.from('soportes').remove(rutas.slice(i, i + 100));
                if (q.error) sinBorrar += Math.min(100, rutas.length - i);
              }
            } catch (e) { sinBorrar += 1; }
            const r = await db.rpc('eliminar_empresa', { p_empresa: empresa.id, p_confirmacion: nombre.value.trim() });
            if (r.error) throw r.error;
            toast(sinBorrar ? 'Empresa eliminada. Algunos adjuntos no se pudieron borrar de Storage.' : 'Empresa eliminada.', 'ok');
            irA('#/empresas');
          }
        });
      }
    }, 'Eliminar esta empresa'));
}

// FIN DEL ARCHIVO acceso.js
