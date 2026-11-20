// Estados Financieros Pymes: certificaciones del contador (elaboración y entrega / recibido conforme).
// Cada certificación tiene campos editables y un texto editable con marcas {así} que se sustituyen
// por los datos de la empresa y del contador. Lo que se edita se guarda en efpymes_certificados;
// "mis generales" del contador se guardan una sola vez en efpymes_contador.

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function fechaLarga(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`;
}

/* ------------------------- generales del contador ------------------------- */
export const GENERALES_CONTADOR = [
  ['nombre', 'Nombre completo', 'Demetrio Dutari Castro'],
  ['idoneidad', 'N.º de idoneidad (CPA)', ''],
  ['cedula', 'Cédula', ''],
  ['ruc', 'RUC', ''],
  ['dv', 'DV', ''],
  ['direccion', 'Dirección profesional', ''],
  ['telefono', 'Teléfono', ''],
  ['correo', 'Correo electrónico', ''],
  ['lugar', 'Lugar donde firma', 'Santiago de Veraguas']
];

export function generalesPorDefecto(guardado) {
  const g = guardado || {};
  const o = {};
  GENERALES_CONTADOR.forEach(([k, , d]) => { o[k] = g[k] !== undefined && g[k] !== null ? g[k] : d; });
  return o;
}

/* ------------------------- campos de cada certificación ------------------------- */
export const CAMPOS = {
  elaboracion: [
    ['entidad', 'Entidad'],
    ['ruc', 'RUC de la entidad'],
    ['periodo', 'Período contable'],
    ['marco', 'Marco de información'],
    ['lugar', 'Lugar de emisión'],
    ['fecha', 'Fecha de emisión (AAAA-MM-DD)']
  ],
  sistema: [
    ['entidad', 'Entidad o titular de los registros'],
    ['ruc', 'RUC de la entidad'],
    ['sistema', 'Nombre del sistema'],
    ['version', 'Versión del sistema'],
    ['norma', 'Norma que se cita'],
    ['alcance', 'Alcance de la revisión'],
    ['lugar', 'Lugar de emisión'],
    ['fecha', 'Fecha de emisión (AAAA-MM-DD)']
  ],
  entrega: [
    ['entidad', 'Entidad'],
    ['ruc', 'RUC de la entidad'],
    ['periodo', 'Período contable'],
    ['cliente', 'Cliente que recibe (nombre completo)'],
    ['cedula_cliente', 'Cédula o pasaporte del cliente'],
    ['cargo_cliente', 'Calidad con que recibe (propietario, representante legal, apoderado)'],
    ['dir_cliente', 'Dirección del cliente'],
    ['tel_cliente', 'Teléfono del cliente'],
    ['correo_cliente', 'Correo del cliente'],
    ['lugar', 'Lugar de entrega'],
    ['fecha', 'Fecha de entrega (AAAA-MM-DD)'],
    ['hora', 'Hora de entrega (HH:MM)'],
    ['copias', 'Forma de entrega (física, digital o ambas)']
  ]
};

export function camposPorDefecto(tipo, ctx, guardado) {
  const e = ctx.empresa || {};
  const gc = generalesPorDefecto(ctx.contador);
  const base = {
    entidad: e.razon_social || '',
    ruc: e.ruc ? `${e.ruc}${e.dv ? ' DV ' + e.dv : ''}` : '',
    periodo: `Año terminado el 31 de diciembre de ${ctx.anio}`,
    marco: 'NIIF para las PYMES',
    lugar: gc.lugar || '',
    fecha: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10),
    cliente: e.representante_legal || e.razon_social || '',
    cedula_cliente: e.cedula_representante || '',
    cargo_cliente: e.tipo_persona === 'juridica' ? 'Representante legal' : 'Propietario',
    dir_cliente: e.direccion || '',
    tel_cliente: e.telefono || '',
    correo_cliente: e.correo || '',
    sistema: 'Contabilidad (aplicación web para pymes de Panamá)',
    version: ctx.version || '',
    norma: 'Resolución DGI N.º 201-1990 de 21 de julio de 1998 (Gaceta Oficial N.º 23,601 de 5 de agosto de 1998), numeral 6, puntos 4 y 5, y Resolución DGI N.º 201-909 de 24 de julio de 1996',
    alcance: 'pruebas de funcionamiento del sistema con datos de prueba y con los registros de la entidad, y revisión de sus controles y de su documentación',
    hora: '',
    copias: 'Digital (PDF) y, si el cliente lo pide, impresa'
  };
  const o = {};
  CAMPOS[tipo].forEach(([k]) => { o[k] = guardado && guardado[k] !== undefined && guardado[k] !== null ? guardado[k] : base[k]; });
  return o;
}

/* ------------------------- textos por defecto ------------------------- */
// Marcas: {contador} {idoneidad} {cedula_contador} {entidad} {ruc} {anio} {ant} {marco} {lugar} {fecha}
//         {cliente} {cedula_cliente} {cargo_cliente} {hora}
// "# " al inicio de un párrafo = subtítulo centrado. **texto** = negrita.
export const TEXTO_ELABORACION = `Yo, **{contador}**, Contador Público Autorizado, con {idoneidad}{cedula_contador}, de conformidad con la Ley 280 de 30 de diciembre de 2021, que regula el ejercicio de la profesión de contador público autorizado en la República de Panamá,

# CERTIFICO

**Primero. Entidad y período.** Que, a solicitud de **{entidad}** ({ruc}), llevé la contabilidad y elaboré los estados financieros correspondientes al período: {periodo}, con cifras comparativas del año {ant}.

**Segundo. Estados que se certifican.** Que los estados financieros elaborados son: el estado de situación financiera, el estado de resultados, el estado de cambios en el patrimonio, el estado de flujos de efectivo y las notas a los estados financieros, que incluyen un resumen de las políticas contables significativas y otra información explicativa.

**Tercero. Marco de información.** Que los estados financieros se prepararon de conformidad con la {marco}, sobre la base contable de acumulación o devengo, en balboas (B/.), moneda funcional y de presentación de la entidad. Los balboas se expresan a la par con el dólar de los Estados Unidos de América.

**Cuarto. Fuente de la información.** Que las cifras provienen de los registros contables de la entidad (libro diario y libro mayor), llevados a partir de los comprobantes, facturas, estados de cuenta bancarios y demás documentos que el cliente puso a mi disposición. Los saldos del año {ant} que se presentan como comparativos son los que constan en los estados financieros de ese año o los que el cliente suministró.

**Quinto. Alcance del trabajo.** Que mi trabajo consistió en llevar la contabilidad y preparar los estados financieros con la información suministrada por la administración. No constituye una auditoría ni una revisión, por lo que no expreso opinión de auditoría ni conclusión de aseguramiento sobre ellos. [Confirmar: si el encargo se pactó como compilación, el texto anterior se mantiene; si fue otro tipo de encargo, ajustar.]

**Sexto. Responsabilidad de la administración.** Que la administración de la entidad es responsable de la integridad y exactitud de los documentos y datos que me entregó, de que todas las transacciones del período se hayan puesto a mi conocimiento, y de que las estimaciones y los juicios que figuran en las notas reflejen su intención y conocimiento del negocio.

**Séptimo. Hechos posteriores y contingencias.** Que, a la fecha de esta certificación, la administración no me ha informado de hechos posteriores al cierre ni de contingencias que no estén reconocidas o reveladas en las notas, salvo lo que allí consta. [Confirmar con el cliente antes de firmar.]

**Octavo. Archivo.** Que los comprobantes que sirvieron de base a esta contabilidad quedan a disposición del cliente, quien debe conservarlos por el término que exigen las normas fiscales de la República de Panamá.

La presente certificación se expide a solicitud de la parte interesada, en {lugar}, el {fecha}.`;

export const TEXTO_ENTREGA = `Yo, **{contador}**, Contador Público Autorizado, con {idoneidad}{cedula_contador}, hago constar que en {lugar}, el {fecha}, a las {hora}, hice entrega a **{cliente}**, con cédula o pasaporte N.º {cedula_cliente}, quien actúa en calidad de {cargo_cliente} de **{entidad}** ({ruc}), de los siguientes documentos correspondientes al período: {periodo}:

**1.** Estado de situación financiera, con cifras comparativas de {ant}.

**2.** Estado de resultados, con cifras comparativas de {ant}.

**3.** Estado de cambios en el patrimonio.

**4.** Estado de flujos de efectivo.

**5.** Notas a los estados financieros.

**6.** Certificación del contador sobre la elaboración de la contabilidad y de los estados financieros.

# RECIBIDO CONFORME

El cliente declara que recibió los documentos antes descritos, en forma {copias}, que los revisó junto con el contador y que tuvo la oportunidad de hacer las preguntas que consideró necesarias. Declara además que la información y los documentos que entregó al contador para su preparación son completos y veraces, y que conoce que los estados financieros son de su responsabilidad como administración de la entidad.

El cliente reconoce que los documentos entregados deben conservarse junto con sus comprobantes y que cualquier cambio posterior a esta fecha requiere una nueva emisión por parte del contador.

Observaciones: ________________________________________________________________

______________________________________________________________________________

Firman las partes en señal de conformidad, en la fecha y hora indicadas.`;

export const TEXTO_SISTEMA = `Yo, **{contador}**, Contador Público Autorizado, con {idoneidad}{cedula_contador}, de conformidad con la Ley 280 de 30 de diciembre de 2021, que regula el ejercicio de la profesión de contador público autorizado en la República de Panamá, y con lo dispuesto en la {norma}, certifico lo siguiente:

**Primero.** Que he revisado el sistema de contabilidad **{sistema}**, versión {version}, que **{entidad}** ({ruc}) utiliza para llevar sus registros de contabilidad por medios electrónicos.

**Segundo.** Que el sistema seguirá las normas de contabilidad generalmente aceptadas en la República de Panamá y, en la presentación de los estados financieros, la estructura de la NIIF para las PYMES. Lleva los registros por el método de partida doble, con base en el devengado y en balboas, y permite preparar el libro diario, el libro mayor, el balance de comprobación, el balance general y el estado de resultados, además de los auxiliares de cuentas por cobrar, cuentas por pagar y activos fijos.

**Tercero.** Que cada asiento queda registrado con su fecha, número, descripción, referencia, cuentas, débitos y créditos; que el sistema exige que los débitos sean iguales a los créditos, y que los asientos se numeran en orden cronológico.

**Cuarto.** Que el sistema permite imprimir o descargar en PDF y en Excel los libros y estados mencionados, con su encabezado y período, cada vez que se necesiten, y exportar una copia completa de los registros de la entidad desde cualquier equipo con acceso al sistema, incluidos los de las oficinas del titular en Panamá.

**Quinto.** Que el sistema conserva una bitácora con el usuario, la fecha y la hora de cada alta, modificación, anulación o eliminación de los registros principales, y que el acceso se controla por usuario y por perfil.

**Sexto.** Que se mantienen copias de seguridad diarias cifradas en dos sitios independientes, y que existe un manual de usuario que describe el funcionamiento del sistema y sus controles.

**Séptimo.** Que mi revisión consistió en {alcance}. Esta certificación se refiere al sistema y no es un dictamen sobre la razonabilidad de los estados financieros de la entidad.

**Octavo.** Que el titular de los registros deberá conservar a disposición de la Dirección General de Ingresos la documentación completa del programa o aplicación y esta certificación.

Se expide en {lugar}, el {fecha}, a solicitud del interesado.`;

export const TEXTO_DEFECTO = { elaboracion: TEXTO_ELABORACION, entrega: TEXTO_ENTREGA, sistema: TEXTO_SISTEMA };

export const TITULOS = {
  elaboracion: 'CERTIFICACIÓN DEL CONTADOR PÚBLICO AUTORIZADO\nSobre la elaboración de la contabilidad y de los estados financieros',
  sistema: 'CERTIFICACIÓN DEL CONTADOR PÚBLICO AUTORIZADO\nSobre el sistema de registros de contabilidad por medios electrónicos',
  entrega: 'ACTA DE ENTREGA DE LA CONTABILIDAD Y DE LOS ESTADOS FINANCIEROS\nRecibido conforme'
};

/* ------------------------- sustitución y armado ------------------------- */
const OPCIONALES = ['cedula_contador'];

export function sustituir(texto, v) {
  return String(texto || '').replace(/\{(\w+)\}/g, (m, k) => {
    const x = v[k];
    if (x === undefined) return m;
    if (x === '' || x === null) return OPCIONALES.includes(k) ? '' : `[Completar: ${k.replace(/_/g, ' ')}]`;
    return String(x);
  });
}

export function variables(tipo, ctx, campos) {
  const gc = generalesPorDefecto(ctx.contador);
  const lugar = campos.lugar || '';
  return {
    contador: gc.nombre,
    idoneidad: gc.idoneidad ? `idoneidad N.º ${gc.idoneidad}` : 'idoneidad N.º [Completar: idoneidad]',
    cedula_contador: gc.cedula ? ` y cédula N.º ${gc.cedula}` : '',
    entidad: campos.entidad, ruc: campos.ruc ? `RUC ${campos.ruc}` : '', periodo: campos.periodo,
    marco: campos.marco, anio: ctx.anio, ant: ctx.anio - 1,
    sistema: campos.sistema, version: campos.version, norma: campos.norma, alcance: campos.alcance,
    lugar, fecha: campos.fecha ? fechaLarga(campos.fecha) : '',
    cliente: campos.cliente, cedula_cliente: campos.cedula_cliente, cargo_cliente: (campos.cargo_cliente || '').toLowerCase(),
    hora: campos.hora, copias: (campos.copias || '').replace(/^./, (c) => c.toLowerCase())
  };
}

export function construirCarta(tipo, ctx, guardado) {
  const g = guardado || {};
  const campos = camposPorDefecto(tipo, ctx, g.campos);
  const gc = generalesPorDefecto(ctx.contador);
  const texto = sustituir(g.texto !== undefined && g.texto !== null && g.texto !== '' ? g.texto : TEXTO_DEFECTO[tipo], variables(tipo, ctx, campos));
  const parrafos = texto.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => (
    p.startsWith('# ') ? { t: `**${p.slice(2)}**`, size: 11, centro: true, despues: 8 } : { t: p.replace(/\n/g, ' ') }
  ));
  const membrete = [gc.nombre, 'Contador Público Autorizado'];
  if (gc.idoneidad) membrete.push(`Idoneidad N.º ${gc.idoneidad}`);
  const idRuc = gc.ruc ? `RUC ${gc.ruc}${gc.dv ? ' DV ' + gc.dv : ''}` : '';
  const contacto = [idRuc, gc.direccion, gc.telefono, gc.correo].filter(Boolean).join(' · ');
  if (contacto) membrete.push(contacto);

  const lineasContador = [gc.nombre, 'Contador Público Autorizado', gc.idoneidad ? `Idoneidad N.º ${gc.idoneidad}` : 'Idoneidad N.º [Completar]'];
  if (gc.cedula) lineasContador.push(`Cédula N.º ${gc.cedula}`);

  const doc = { tipo: 'carta', clave: tipo, hoja: tipo === 'entrega' ? 'Recibido conforme' : (tipo === 'sistema' ? 'Certificación del sistema' : 'Certificación'), titulo: TITULOS[tipo], membrete, parrafos, campos: [], firmas: [] };
  if (tipo === 'sistema') {
    doc.campos = [['Entidad', campos.entidad], ['RUC', campos.ruc], ['Sistema', `${campos.sistema} · versión ${campos.version}`]];
    doc.firmas = [{ lineas: lineasContador }];
  } else if (tipo === 'elaboracion') {
    doc.campos = [['Entidad', campos.entidad], ['RUC', campos.ruc], ['Período', campos.periodo]];
    doc.firmas = [{ lineas: lineasContador }];
  } else {
    doc.campos = [
      ['Entidad', campos.entidad], ['RUC', campos.ruc], ['Período', campos.periodo],
      ['Cliente que recibe', campos.cliente], ['Cédula o pasaporte', campos.cedula_cliente], ['Calidad con que recibe', campos.cargo_cliente],
      ['Dirección', campos.dir_cliente], ['Teléfono', campos.tel_cliente], ['Correo electrónico', campos.correo_cliente],
      ['Fecha y hora de entrega', [campos.fecha ? fechaLarga(campos.fecha) : '', campos.hora ? `${campos.hora} h` : ''].filter(Boolean).join(', ')]
    ];
    const lc = [campos.cliente || 'Cliente', 'Recibido conforme'];
    if (campos.cedula_cliente) lc.push(`Cédula N.º ${campos.cedula_cliente}`);
    lc.push(`Fecha: ${campos.fecha ? fechaLarga(campos.fecha) : '____________'}  Hora: ${campos.hora ? campos.hora + ' h' : '________'}`);
    doc.firmas = [{ lineas: [...lineasContador.slice(0, 1), 'Entrega · Contador Público Autorizado', ...lineasContador.slice(2)] }, { lineas: lc }];
  }
  return doc;
}

// FIN DEL ARCHIVO efpymescert.js
