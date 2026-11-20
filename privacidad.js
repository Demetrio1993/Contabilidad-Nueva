// Aviso de privacidad (Ley 81 de 2019 y Decreto Ejecutivo 285 de 2021).
// - abrirAvisoPrivacidad(): solo lectura; se abre desde el inicio de sesión.
// - pedirAceptacionAviso(): al entrar, si el usuario no ha aceptado la versión vigente, muestra el aviso con
//   "Entendido y acepto". No bloquea: si lo deja para después, se vuelve a mostrar la próxima vez que abra la app.
//   La aceptación queda guardada con usuario, correo, fecha y versión (script 122).
// - seccionAceptaciones(): lista en Datos, para el administrador, de quién aceptó y quién falta.
// Si el texto del aviso cambia, se sube AVISO_VERSION y la app vuelve a pedir la aceptación a todos.
import { db, h, modal, toast, traducirError } from './lib.js';

export const AVISO_VERSION = '2';

const PARRAFOS = [
  ['Quién trata los datos', 'El responsable es el Licdo. Demetrio Dutari Castro, contador público autorizado, con RUC 9-740-702 DV 37, que lleva la contabilidad de las empresas registradas en esta aplicación. Correo de contacto: dutaricastrocpa@gmail.com.'],
  ['Qué datos se guardan', 'Nombre, cédula o pasaporte, RUC y DV, dirección y datos de contacto de clientes y proveedores; datos de facturas y transacciones; y datos de salarios y retenciones cuando se registran.'],
  ['Para qué se usan', 'Llevar la contabilidad, preparar estados financieros y declaraciones, y cumplir con la DGI, la CSS y otras obligaciones legales. No se venden ni se ceden con fines comerciales.'],
  ['Dónde se guardan', 'En servicios de nube con servidores en Estados Unidos (Supabase) y copias de seguridad cifradas en GitHub y GitLab. Al aceptar este aviso usted consiente que los datos se transfieran a esos proveedores para poder prestar el servicio. Las fotos y PDF de facturas se envían a un servicio de lectura con inteligencia artificial para extraer sus datos.'],
  ['Quién puede verlos', 'Solo las personas que el contador autoriza en cada empresa, según su perfil (administrador, contador, lector o auxiliar). Los cambios quedan registrados en una bitácora con usuario y fecha.'],
  ['Sus derechos', 'Puede pedir acceso, rectificación, cancelación u oposición sobre sus datos, y la portabilidad, es decir, una copia de sus datos en un formato estructurado. Hágalo escribiendo al responsable al correo dutaricastrocpa@gmail.com. La información se entrega en un plazo no mayor de diez días hábiles y las correcciones se hacen dentro de los cinco días hábiles siguientes a la solicitud (Ley 81 de 2019, artículos 16 y 17). Algunos datos no se pueden borrar mientras exista una obligación legal de conservarlos.'],
  ['Su consentimiento', 'Al tocar "Entendido y acepto" usted da su consentimiento para el tratamiento de sus datos como se describe aquí. Se guarda su usuario, su correo, la fecha y la versión del aviso. Puede retirar su consentimiento cuando quiera, sin efecto retroactivo, pidiéndolo al responsable por ese mismo correo (Ley 81 de 2019, artículo 6).'],
  ['Conservación', 'Se conservan durante el tiempo que exijan las normas fiscales y contables.']
];

const cuerpoTexto = () => PARRAFOS.flatMap(([t, p]) => [h('h3', null, t), h('p', null, p)]);

export function abrirAvisoPrivacidad() {
  const cuerpo = h('div', { class: 'aviso-priv' },
    ...cuerpoTexto(),
    h('div', { class: 'acciones' },
      h('button', { class: 'btn', type: 'button', onclick: () => cerrar() }, 'Cerrar')));
  const cerrar = modal('Aviso de privacidad', cuerpo);
}

// Se pregunta una vez por usuario en cada carga de la app
let usuarioPreguntado = null;

export async function pedirAceptacionAviso(usuarioId) {
  if (!usuarioId || usuarioPreguntado === usuarioId) return;
  usuarioPreguntado = usuarioId;
  try {
    const r = await db.from('aviso_aceptaciones').select('version').eq('version', AVISO_VERSION).maybeSingle();
    if (r.error || r.data) return; // sin la tabla (falta correr el script 122) o ya aceptó esta versión
  } catch (e) { return; }

  let cerrar = () => {};
  const aceptar = h('button', { class: 'btn', type: 'button' }, 'Entendido y acepto');
  aceptar.addEventListener('click', async () => {
    aceptar.disabled = true;
    const x = await db.rpc('aceptar_aviso_privacidad', { p_version: AVISO_VERSION });
    if (x.error) { aceptar.disabled = false; toast(traducirError(x.error), 'error'); return; }
    toast('Aceptación registrada.', 'ok');
    cerrar();
  });
  const luego = h('button', { class: 'btn btn-sec', type: 'button', onclick: () => cerrar() }, 'Recordármelo después');
  const cuerpo = h('div', { class: 'aviso-priv' },
    h('p', { class: 'ayuda' }, 'Antes de seguir, lee cómo se tratan tus datos y acéptalo. Si prefieres hacerlo después, te lo volveremos a recordar la próxima vez que abras la aplicación.'),
    ...cuerpoTexto(),
    h('div', { class: 'acciones' }, aceptar, luego));
  cerrar = modal('Aviso de privacidad', cuerpo);
}

const ROL = { admin: 'Administrador', contador: 'Contador', lector: 'Lector', auxiliar: 'Auxiliar' };

function fechaHora(t) {
  const d = new Date(t);
  return d.toLocaleDateString('es-PA') + ' ' + d.toLocaleTimeString('es-PA', { hour: '2-digit', minute: '2-digit' });
}

export function seccionAceptaciones(empresa) {
  const caja = h('div', null, h('p', { class: 'ayuda' }, 'Cargando…'));
  (async () => {
    const r = await db.rpc('aceptaciones_aviso_empresa', { p_empresa: empresa.id, p_version: AVISO_VERSION });
    if (r.error) {
      const m = String(r.error.message || '');
      caja.replaceChildren(h('p', { class: 'ayuda' }, /administrador/i.test(m)
        ? 'Solo el administrador de la empresa ve esta lista.'
        : (/aceptaciones_aviso_empresa|schema cache/i.test(m) ? 'Falta ejecutar el script 122 en Supabase.' : traducirError(r.error))));
      return;
    }
    const lista = r.data || [];
    const faltan = lista.filter((u) => !u.aceptado_en).length;
    caja.replaceChildren(
      h('p', { class: 'ayuda' }, faltan
        ? `${faltan} de ${lista.length} usuarios todavía no aceptan la versión ${AVISO_VERSION} del aviso. Se les vuelve a recordar cada vez que abren la app.`
        : `Los ${lista.length} usuarios de esta empresa aceptaron la versión ${AVISO_VERSION} del aviso.`),
      h('div', { class: 'lista-cuentas' }, lista.map((u) => h('div', { class: 'trx' },
        h('div', { class: 'trx-nom' }, u.correo),
        h('div', { class: 'trx-montos' },
          h('span', { class: 'ayuda' }, (ROL[u.rol] || u.rol) + ' · ' + (u.aceptado_en ? 'aceptó el ' + fechaHora(u.aceptado_en) : 'pendiente')))))));
  })();
  return h('div', { class: 'grupo' }, h('h3', null, 'Aceptación del aviso de privacidad'), caja);
}
// FIN DEL ARCHIVO privacidad.js
