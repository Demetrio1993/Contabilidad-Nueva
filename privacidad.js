// Aviso de privacidad (Ley 81 de 2019 y Decreto Ejecutivo 285 de 2021). Se abre desde el inicio de sesión.
import { h, modal } from './lib.js';

const PARRAFOS = [
  ['Quién trata los datos', 'El responsable es el Licdo. Demetrio Dutari Castro, contador público autorizado, que lleva la contabilidad de las empresas registradas en esta aplicación.'],
  ['Qué datos se guardan', 'Nombre, cédula o pasaporte, RUC y DV, dirección y datos de contacto de clientes y proveedores; datos de facturas y transacciones; y datos de salarios y retenciones cuando se registran.'],
  ['Para qué se usan', 'Llevar la contabilidad, preparar estados financieros y declaraciones, y cumplir con la DGI, la CSS y otras obligaciones legales. No se venden ni se ceden con fines comerciales.'],
  ['Dónde se guardan', 'En servicios de nube con servidores en Estados Unidos (Supabase) y copias de seguridad cifradas en GitHub y GitLab. Al usar la aplicación se entiende que los datos se transfieren a esos proveedores para poder prestar el servicio. Las fotos y PDF de facturas se envían a un servicio de lectura con inteligencia artificial para extraer sus datos.'],
  ['Quién puede verlos', 'Solo las personas que el contador autoriza en cada empresa, según su perfil (administrador, contador, lector o auxiliar). Los cambios quedan registrados en una bitácora con usuario y fecha.'],
  ['Sus derechos', 'Puede pedir acceso, rectificación, cancelación u oposición sobre sus datos, y la portabilidad cuando aplique. Hágalo por los medios de contacto que le dio su contador. Algunos datos no se pueden borrar mientras exista una obligación legal de conservarlos.'],
  ['Conservación', 'Se conservan durante el tiempo que exijan las normas fiscales y contables.']
];

export function abrirAvisoPrivacidad() {
  const cuerpo = h('div', { class: 'aviso-priv' },
    ...PARRAFOS.flatMap(([t, p]) => [h('h3', null, t), h('p', null, p)]),
    h('div', { class: 'acciones' },
      h('button', { class: 'btn', type: 'button', onclick: () => cerrar() }, 'Cerrar')));
  const cerrar = modal('Aviso de privacidad', cuerpo);
}
// FIN DEL ARCHIVO privacidad.js
