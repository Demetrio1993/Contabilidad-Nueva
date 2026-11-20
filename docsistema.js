// Documentación del sistema: PDF corto que describe la aplicación y sus controles, para que el titular lo conserve
// junto con la Certificación-Declaración a disposición de la DGI (Decreto Ejecutivo 34 de 1998, art. 6, y Resolución
// DGI 201-909 de 1996). No guarda nada en la base de datos: se arma al momento con los datos de la empresa, la versión
// vigente y los generales del contador. No afirma dónde está físicamente el servidor.
import { generalesPorDefecto, fechaLarga } from './efpymescert.js';

export function construirDocumentacion(ctx) {
  const e = ctx.empresa || {};
  const gc = generalesPorDefecto(ctx.contador);
  const fecha = fechaLarga(new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10));
  const ruc = e.ruc ? `${e.ruc}${e.dv ? ' DV ' + e.dv : ''}` : '';
  const P = (t) => ({ t });
  const T = (t) => ({ t: `**${t}**`, size: 11, centro: true, despues: 8 });

  const parrafos = [
    T('1. IDENTIFICACIÓN DEL SISTEMA'),
    P('El sistema se llama **Contabilidad (aplicación web para pymes de Panamá)** y su versión vigente es la **' + (ctx.version || '') + '**. Es una aplicación web instalable que funciona desde el navegador de una computadora, tableta o teléfono. Los datos de cada empresa se guardan en una base de datos PostgreSQL administrada (Supabase) y están separados de los de las demás empresas. La aplicación está publicada en GitHub Pages. La elabora y mantiene ' + gc.nombre + ', Contador Público Autorizado.'),

    T('2. QUÉ HACE'),
    P('Lleva la contabilidad por partida doble, con base en el devengado y en balboas. Incluye transacciones y asientos, catálogo de cuentas, libro diario, libro mayor, balance de comprobación, hoja de trabajo y auxiliares; estados financieros y la versión para PYMES con notas; cuentas por cobrar y por pagar; activos fijos y su depreciación; inventario; conciliación bancaria; ITBMS y formulario 430; impuestos, anexos y declaración de renta de persona natural; presupuesto y cierre del período. Los informes se imprimen o se descargan en PDF y en Excel con su encabezado y período.'),

    T('3. CONTROLES SOBRE LOS REGISTROS'),
    P('**Partida doble.** Cada asiento exige que los débitos sean iguales a los créditos y queda registrado con su fecha, número, descripción, referencia, cuentas y montos. Los asientos se numeran en orden cronológico.'),
    P('**Correcciones.** Las anulaciones y correcciones quedan identificadas como tales; no se borran sin dejar rastro.'),
    P('**Bitácora.** El sistema guarda el usuario, la fecha y la hora de cada alta, modificación, anulación o eliminación en las tablas principales. La bitácora registra cambios; no registra las consultas.'),
    P('**Acceso.** Se entra con usuario y contraseña. Hay cuatro perfiles: administrador, contador, auxiliar y lector. El lector solo consulta. Los permisos se aplican en la propia base de datos y cada usuario solo ve las empresas a las que fue invitado.'),

    T('4. CONSERVACIÓN Y RECUPERACIÓN'),
    P('Se hace una copia de seguridad diaria de la base de datos, cifrada, en un servicio de repositorios, con un espejo en un segundo servicio independiente. Además, desde la pestaña Datos de cada empresa se puede descargar un respaldo completo (archivo JSON) y un respaldo en Excel, y restaurar un respaldo propio. Se conserva también el código de la aplicación y los scripts de la base de datos.'),

    T('5. SERVICIOS DE TERCEROS QUE USA'),
    P('Supabase (base de datos y autenticación de usuarios); GitHub (publicación de la aplicación y copias de seguridad); GitLab (espejo de las copias); Google Gemini (lectura opcional de facturas por imagen, solo cuando el usuario usa esa función); Resend (correo de aviso cuando el cliente aprueba la declaración de renta).'),

    T('6. DOCUMENTACIÓN QUE ACOMPAÑA AL SISTEMA'),
    P('Certificación-Declaración conforme a la Resolución DGI N.º 201-909 de 24 de julio de 1996, con su anexo descriptivo; este documento; el manual de usuario, que describe cada pestaña y sus controles; el código de la aplicación y los scripts de la base de datos, que conserva el desarrollador; y la bitácora y las copias de seguridad descritas arriba. El titular conserva esta documentación a disposición de la Dirección General de Ingresos cuando se la requiera.'),

    T('7. CÓMO OBTENER UNA COPIA'),
    P('En la pestaña Datos de la empresa, el administrador o el contador puede descargar el respaldo completo, el respaldo en Excel y esta documentación junto con la certificación. Los libros y estados se descargan desde sus pestañas, en PDF y en Excel, cada vez que se necesiten.'),

    P('Este documento describe el sistema y no es un dictamen sobre la razonabilidad de los estados financieros de la entidad.')
  ];

  const membrete = [gc.nombre, 'Contador Público Autorizado'];
  if (gc.idoneidad) membrete.push(`Idoneidad N.º ${gc.idoneidad}`);
  const idRuc = gc.ruc ? `RUC ${gc.ruc}${gc.dv ? ' DV ' + gc.dv : ''}` : '';
  const contacto = [idRuc, gc.direccion, gc.telefono, gc.correo].filter(Boolean).join(' · ');
  if (contacto) membrete.push(contacto);

  return {
    tipo: 'carta', clave: 'documentacion', hoja: 'Documentación del sistema',
    titulo: 'DOCUMENTACIÓN DEL SISTEMA\nSistema de registros de contabilidad por medios electrónicos',
    membrete,
    campos: [['Contribuyente', e.razon_social || ''], ['RUC', ruc], ['Sistema', `Contabilidad, versión ${ctx.version || ''}`], ['Fecha', fecha]],
    parrafos,
    firmas: [{ lineas: [gc.nombre, 'Contador Público Autorizado', gc.idoneidad ? `Idoneidad N.º ${gc.idoneidad}` : 'Idoneidad N.º [Completar]'] }]
  };
}
// FIN DEL ARCHIVO docsistema.js
