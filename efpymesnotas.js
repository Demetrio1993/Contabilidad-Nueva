// Estados Financieros Pymes: definición de las notas (títulos, a qué estado pertenecen y texto inicial).
// El texto inicial sale de los datos de la empresa y se puede editar por completo en la pantalla.
// Lo que está entre corchetes [Completar: ...] o [Confirmar: ...] es información que solo el contador
// o el propietario conocen; la pantalla avisa cuántos quedan por completar.

/* c = { nombre, ruc, natural, anio, ant, itbms, actividad, dir, marco, manual, agro, propietario } */

const SI_NATURAL = (c, a, b) => (c.natural ? a : b);

export const DEFS = [
  {
    clave: 'entidad', tipo: 'texto', titulo: 'Entidad que informa e información general',
    ref: 'Se relaciona con todos los estados financieros (Sección 3 y Sección 8).',
    texto: (c) => [
      `**${c.nombre}**, con ${c.ruc || 'RUC [Completar]'}, es ${SI_NATURAL(c, 'un negocio de persona natural (un solo dueño)', 'una persona jurídica')} que opera en la República de Panamá. Su actividad principal es ${c.actividad}. Domicilio: ${c.dir}.`,
      SI_NATURAL(c,
        'Por ser un negocio de persona natural, no existe una persona jurídica distinta de su propietario. La contabilidad del negocio se lleva separada de las finanzas personales del propietario, de acuerdo con el principio de entidad que informa, y estos estados presentan solamente los activos, pasivos, ingresos, costos y gastos del negocio. Los bienes y las deudas personales que no se hayan aportado al negocio no forman parte de ellos.',
        'La entidad es una persona jurídica con patrimonio propio, distinto del de sus socios o accionistas. [Completar: datos de constitución, inscripción en el Registro Público y composición del capital.]'),
      c.itbms
        ? 'La entidad es contribuyente del Impuesto de Transferencia de Bienes Corporales Muebles y la Prestación de Servicios (ITBMS). El impuesto cobrado en las ventas se registra como un pasivo con la Dirección General de Ingresos (DGI) y el pagado en las compras como un crédito fiscal; ninguno de los dos se presenta como ingreso ni como gasto.'
        : 'La entidad no es contribuyente del ITBMS. El impuesto que paga en sus compras forma parte del costo o del gasto del bien o servicio adquirido, porque no puede acreditarlo.',
      `Los estados financieros cubren el ejercicio comprendido entre el 1 de enero y el 31 de diciembre de ${c.anio}, con cifras comparativas del ejercicio ${c.ant}. [Completar: aviso de operación, número de empleados y sucursales, si los hay.]`
    ].join('\n\n')
  },
  {
    clave: 'bases', tipo: 'texto', titulo: 'Bases de preparación y declaración de cumplimiento',
    ref: 'Se relaciona con todos los estados financieros (Secciones 1, 2, 3, 4, 5, 6 y 7).',
    texto: (c) => [
      `**Declaración de cumplimiento.** Los estados financieros se prepararon de conformidad con la Norma Internacional de Información Financiera para las Pequeñas y Medianas Entidades (NIIF para las PYMES), emitida por el Consejo de Normas Internacionales de Contabilidad (IASB). La entidad no tiene obligación pública de rendir cuentas: sus instrumentos de deuda o de patrimonio no se negocian en un mercado público y no mantiene activos en calidad de fiduciaria para un grupo amplio de terceros como una de sus principales actividades (Sección 1). El marco contable registrado para la entidad es: ${c.marco}.`,
      '**Edición aplicada.** La estructura de presentación y las revelaciones siguen la tercera edición de la NIIF para las PYMES, publicada por el IASB en febrero de 2025, que entra en vigor para los ejercicios que comiencen a partir del 1 de enero de 2027 y permite su aplicación anticipada. [Confirmar: edición aplicada en este ejercicio (segunda edición de 2015 con sus enmiendas, o tercera edición con aplicación anticipada) y ajustar este párrafo en consecuencia.]',
      '**Base contable de acumulación (devengo).** Los estados financieros, excepto el estado de flujos de efectivo, se preparan sobre la base contable de acumulación: los efectos de las transacciones se reconocen cuando ocurren y no cuando se cobra o se paga el efectivo, y se registran en los períodos con los que se relacionan.',
      '**Negocio en marcha.** Al preparar los estados financieros se evaluó la capacidad de la entidad para continuar como negocio en marcha. No se identificaron incertidumbres significativas sobre hechos o condiciones que generen dudas importantes, ni existe la intención de liquidar la entidad o de cesar sus operaciones. [Confirmar con el propietario.]',
      '**Moneda funcional y de presentación.** La moneda es el balboa (B/.), unidad monetaria de la República de Panamá, que tiene paridad a la par con el dólar de los Estados Unidos de América, moneda que circula como papel moneda en el país. Las cifras se presentan en balboas, exactas hasta el centavo, sin redondeo a miles.',
      '**Presentación de los estados.** El estado de situación financiera clasifica los activos y pasivos en corrientes y no corrientes (Sección 4). El estado de resultados presenta los gastos según su naturaleza (Sección 5). Como la entidad no tiene partidas de otro resultado integral, el resultado integral total es igual a la utilidad neta del año y no se presenta un estado del resultado integral separado. El estado de cambios en el patrimonio concilia el saldo de cada componente al inicio y al final de cada ejercicio (Sección 6). El estado de flujos de efectivo usa el método indirecto (Sección 7). Los activos y los pasivos, y los ingresos y los gastos, no se compensan entre sí, salvo que una sección de la norma lo exija o lo permita.',
      `**Información comparativa.** Se presenta información comparativa del ejercicio ${c.ant} para todos los importes. Cuando cambió la presentación o la clasificación de una partida, se reclasificaron también las cifras comparativas.${c.manual ? ` Algunas cifras del ejercicio ${c.ant} se incorporaron manualmente a partir de los estados financieros de ese ejercicio; el sistema las distingue con la marca de cifra manual.` : ''}`,
      '**Materialidad.** Cada clase significativa de partidas similares se presenta por separado; las partidas de naturaleza o función distinta se presentan separadas, salvo que carezcan de importancia relativa.',
      '**Cambios en políticas, estimaciones y errores (Sección 10).** [Confirmar: durante el ejercicio no hubo cambios en las políticas contables, cambios de estimaciones con efecto significativo ni errores de ejercicios anteriores que requieran reexpresar las cifras comparativas.]',
      '**Novedades de la tercera edición.** Los cambios principales de la tercera edición respecto de la edición de 2015 son: la Sección 2 se alinea con el Marco Conceptual de 2018 (nuevas definiciones de activo, pasivo, ingreso y gasto); la Sección 9 adopta un único modelo de control; las Secciones 11 y 12 incorporan criterios de la NIIF 9, y la Sección 12 reúne los requerimientos de medición a valor razonable; la Sección 19 incorpora el método de adquisición de la NIIF 3; la Sección 23 introduce el modelo de cinco pasos de la NIIF 15 para los ingresos de contratos con clientes; y se aclaran los requerimientos sobre materialidad, beneficios a los empleados, políticas contables y revelaciones. La Sección 20 conserva la distinción entre arrendamientos financieros y operativos. Para esta entidad, los efectos prácticos están en el reconocimiento de los ingresos por servicios (Sección 23) y en la medición de las cuentas por cobrar (Sección 11). [Confirmar: efecto de la aplicación de estos cambios, si lo hubo.]'
    ].join('\n\n')
  },
  {
    clave: 'politicas', tipo: 'texto', titulo: 'Resumen de políticas contables significativas',
    ref: 'Se relaciona con todos los estados financieros. Cada política indica la sección de la NIIF para las PYMES que la sustenta.',
    texto: (c) => [
      '**3.1 Efectivo y equivalentes de efectivo (Secciones 7 y 11).** Comprende el efectivo en caja, los depósitos a la vista en bancos y las inversiones a corto plazo de gran liquidez, fácilmente convertibles en efectivo y sujetas a un riesgo poco significativo de cambios en su valor.',
      '**3.2 Instrumentos financieros (Secciones 11 y 12).** Los activos y pasivos financieros se reconocen cuando la entidad se convierte en parte de las condiciones contractuales del instrumento. Las cuentas por cobrar y por pagar comerciales se miden inicialmente al precio de la transacción y después al costo amortizado; cuando no existe una tasa de interés pactada y el plazo es corto, el costo amortizado es igual al importe por cobrar o por pagar. Al cierre de cada ejercicio se evalúa el deterioro de las cuentas por cobrar con el modelo de pérdidas crediticias esperadas y se reconoce una provisión por el importe estimado como incobrable. Un activo financiero se da de baja cuando vencen los derechos contractuales sobre sus flujos de efectivo o se transfieren sustancialmente los riesgos y beneficios; un pasivo, cuando se extingue la obligación. Cuando se requiere valor razonable, se aplica la jerarquía de la Sección 12.',
      '**3.3 Inventarios (Sección 13).** Se miden al menor entre el costo y el precio de venta estimado menos los costos de terminación y venta. El costo comprende el precio de compra, los fletes y los demás costos para dejar el inventario en su ubicación y condición actuales, neto de descuentos y devoluciones, y se asigna con el método de primeras entradas, primeras salidas (PEPS). El costo de venta se reconoce en el estado de resultados cuando se vende el inventario. [Confirmar: método de costeo y forma de determinar el inventario final.]',
      '**3.4 Propiedad, planta y equipo (Sección 17).** Se miden al costo menos la depreciación acumulada y las pérdidas por deterioro. El costo incluye el precio de adquisición y los costos directamente atribuibles para poner el activo en condiciones de uso. La depreciación se calcula por el método de línea recta durante la vida útil estimada, desde el mes siguiente al de la adquisición. El valor residual, la vida útil y el método de depreciación se revisan al cierre de cada ejercicio. Los gastos de mantenimiento y reparación se reconocen como gasto cuando se incurren; las mejoras que aumentan la vida útil o la capacidad se capitalizan. La ganancia o pérdida por la baja de un activo es la diferencia entre el producto de la venta y su valor en libros. [Completar: vidas útiles por clase de activo.]',
      '**3.5 Activos intangibles y diferidos (Sección 18).** Se miden al costo menos la amortización acumulada y el deterioro. Se amortizan en línea recta durante su vida útil estimada. Los gastos de investigación y los generados internamente que no cumplen las condiciones de reconocimiento se registran como gasto.',
      '**3.6 Deterioro del valor de los activos (Sección 27).** Al cierre de cada ejercicio se evalúa si hay indicios de que un activo, distinto de los inventarios y de los activos financieros, haya perdido valor. Si los hay, se compara el valor en libros con el importe recuperable (el mayor entre el valor razonable menos los costos de venta y el valor en uso) y la diferencia se reconoce como pérdida en resultados.',
      '**3.7 Pasivos financieros y cuentas por pagar (Sección 11).** Las cuentas por pagar comerciales se reconocen al precio de la transacción. Las obligaciones financieras se miden al costo amortizado con el método del interés efectivo; los intereses se reconocen como gasto en el período en que se devengan.',
      '**3.8 Provisiones y contingencias (Sección 21).** Se reconoce una provisión cuando existe una obligación presente, legal o implícita, como resultado de un hecho pasado; es probable que se requiera una salida de recursos para cancelarla y su importe puede estimarse con fiabilidad. Las obligaciones posibles y las probables que no pueden medirse con fiabilidad se revelan como pasivos contingentes. Los activos contingentes no se reconocen.',
      '**3.9 Beneficios a los empleados (Sección 28).** Los beneficios a corto plazo (salarios, décimo tercer mes, vacaciones, cuotas patronales de la Caja de Seguro Social, seguro educativo y riesgos profesionales) se reconocen como gasto y como pasivo a medida que el empleado presta el servicio, por el importe no descontado que se espera pagar. [Confirmar: si existen obligaciones por prima de antigüedad o indemnización que deban medirse y reconocerse.]',
      SI_NATURAL(c,
        '**3.10 Impuesto sobre la renta y seguro educativo (Sección 29).** El impuesto sobre la renta del ejercicio se calcula sobre la utilidad antes de impuestos con la tarifa progresiva vigente para personas naturales: exento hasta B/. 11,000.00; 15 % sobre el exceso hasta B/. 50,000.00 y 25 % sobre el exceso de ese monto. El seguro educativo sobre la utilidad se calcula con la tasa de 2.75 %. Ambos se presentan en el estado de resultados dentro del rubro de impuestos y como pasivo por impuestos por pagar. Se trata de una estimación calculada con las reglas del sistema; la liquidación definitiva es la que resulte de la declaración de renta presentada a la DGI. No se reconoció impuesto diferido porque las diferencias temporarias no son significativas. [Confirmar tarifas vigentes y ausencia de diferencias temporarias.]',
        '**3.10 Impuesto sobre la renta (Sección 29).** El impuesto corriente se calcula sobre la renta gravable del ejercicio con la tasa vigente para personas jurídicas y se reconoce como gasto y como pasivo por impuestos por pagar, neto de anticipos. El impuesto diferido se reconoce sobre las diferencias temporarias entre el valor en libros y la base fiscal de los activos y pasivos. [Completar: tasa aplicada, impuesto diferido y conciliación de la tasa efectiva.]'),
      c.itbms
        ? '**3.11 ITBMS.** El impuesto cobrado en las ventas y el pagado en las compras se registran en cuentas de balance y se compensan en la declaración mensual con la DGI. El saldo neto se presenta como impuesto por pagar o como crédito fiscal a favor.'
        : '**3.11 ITBMS.** La entidad no es contribuyente. El impuesto pagado en las compras se incluye en el costo o gasto correspondiente.',
      '**3.12 Reconocimiento de ingresos (Sección 23).** Los ingresos de contratos con clientes se reconocen aplicando el modelo de cinco pasos: se identifica el contrato; se identifican las obligaciones de desempeño; se determina el precio de la transacción; se asigna ese precio a cada obligación; y se reconoce el ingreso cuando, o a medida que, se satisface cada obligación. Los ingresos por servicios se reconocen conforme se prestan; los ingresos por venta de bienes, cuando se transfiere el control al cliente. Se miden por el importe de la contraprestación recibida o por recibir, neto de descuentos, devoluciones y de impuestos cobrados por cuenta de terceros. Los ingresos financieros se reconocen cuando se devengan. [Confirmar: tipos de ingresos de la entidad y momento en que se satisface cada obligación.]',
      '**3.13 Costos y gastos.** Se reconocen en el estado de resultados cuando se incurren, por el método de acumulación, y se presentan según su naturaleza. Los gastos pagados por adelantado se reconocen como activo y se llevan a resultados en el período al que corresponden.',
      '**3.14 Arrendamientos (Sección 20).** Los arrendamientos se clasifican como financieros cuando transfieren sustancialmente todos los riesgos y beneficios inherentes a la propiedad del activo; en los demás casos son operativos. Los pagos de los arrendamientos operativos se reconocen como gasto de forma lineal durante el plazo del arrendamiento. [Confirmar: si existen arrendamientos financieros.]',
      SI_NATURAL(c,
        '**3.15 Patrimonio del propietario (Sección 22).** El patrimonio está formado por el capital aportado por el propietario, los retiros que hace del negocio y las utilidades acumuladas. Los retiros se presentan como una disminución del patrimonio y se trasladan a las utilidades acumuladas en el cierre anual. Las utilidades del ejercicio pendientes de cierre se muestran en una línea separada del patrimonio.',
        '**3.15 Patrimonio (Sección 22).** El patrimonio incluye el capital social, las utilidades acumuladas y las demás partidas de los propietarios. Los dividendos se reconocen como pasivo cuando se declaran. [Completar: composición del capital y dividendos.]'),
      '**3.16 Transacciones en moneda extranjera (Sección 30).** Como el balboa tiene paridad con el dólar de los Estados Unidos de América, las transacciones en esa moneda no generan diferencias de cambio. Las transacciones en otras monedas se convierten al tipo de cambio de la fecha de la transacción, y los saldos monetarios, al tipo de cambio de cierre. [Confirmar: si hubo transacciones en otras monedas.]',
      c.agro ? '**3.17 Actividad agropecuaria (Sección 34).** Los activos biológicos se miden al valor razonable menos los costos de venta cuando este puede determinarse sin costo ni esfuerzo desproporcionado; en caso contrario, al costo menos la depreciación y el deterioro acumulados. La producción agrícola cosechada se mide, en el punto de cosecha, al valor razonable menos los costos de venta. [Completar: activos biológicos y producción de la entidad.]' : null
    ].filter(Boolean).join('\n\n')
  },
  {
    clave: 'juicios', tipo: 'texto', titulo: 'Juicios, estimaciones y supuestos contables significativos',
    ref: 'Se relaciona con todos los estados financieros (Sección 8).',
    texto: () => [
      'La preparación de los estados financieros requiere que la administración haga juicios, estimaciones y supuestos que afectan los importes de activos, pasivos, ingresos y gastos y las revelaciones. Los resultados reales pueden diferir de las estimaciones. Las estimaciones se revisan periódicamente y sus efectos se reconocen en el período de la revisión y en los períodos futuros que afecten.',
      '**Fuentes clave de incertidumbre en la estimación:**\n- Vida útil y valor residual de la propiedad, planta y equipo y de los intangibles (Notas de propiedad, planta y equipo e intangibles).\n- Provisión para cuentas incobrables, según la antigüedad y la capacidad de pago de los clientes.\n- Valor neto de realización de los inventarios.\n- Impuesto sobre la renta y seguro educativo del ejercicio, calculados antes de la liquidación definitiva con la DGI.\n- Provisiones y pasivos contingentes.',
      '**Juicios significativos:** la determinación de que la entidad es un negocio en marcha, la clasificación de los activos y pasivos entre corrientes y no corrientes y el momento en que se satisfacen las obligaciones de desempeño de los ingresos. [Completar: otros juicios aplicados por la administración.]'
    ].join('\n\n')
  },

  /* ------------------------------ notas de balance ------------------------------ */
  {
    clave: 'efectivo', tipo: 'balance', titulo: 'Efectivo y equivalentes de efectivo', n3: ['1.1.01'], pref: ['1.1.01.'],
    ref: 'Estado de situación financiera: Efectivo y equivalentes de efectivo. Estado de flujos de efectivo: efectivo al inicio y al final del año.',
    texto: () => 'El efectivo comprende los fondos en caja y los saldos en cuentas bancarias, de libre disposición. No existen restricciones sobre su uso. [Confirmar: ausencia de efectivo restringido, sobregiros o depósitos pignorados.] El saldo de cada cuenta se concilia con los extractos bancarios y con el arqueo de caja a la fecha de cierre.'
  },
  {
    clave: 'cxc', tipo: 'balance', titulo: 'Cuentas por cobrar comerciales y otras', n3: ['1.1.02', '1.1.03', '1.1.04'], pref: ['1.1.02.', '1.1.03.', '1.1.04.'],
    ref: 'Estado de situación financiera: Cuentas por cobrar comerciales, Otras cuentas por cobrar y Provisión para cuentas incobrables.',
    texto: () => 'Las cuentas por cobrar provienen de ventas de bienes y servicios a crédito y no generan intereses. Se miden al precio de la transacción menos la provisión por deterioro (Sección 11). Los plazos de cobro son los acordados con cada cliente. La provisión para cuentas incobrables se estima con el modelo de pérdidas crediticias esperadas, a partir de la antigüedad de los saldos y de la experiencia de cobro. [Completar: cuentas por cobrar vencidas, garantías recibidas y movimiento de la provisión del año.]'
  },
  {
    clave: 'inventarios', tipo: 'balance', titulo: 'Inventarios', n3: ['1.1.05'], pref: ['1.1.05.'],
    ref: 'Estado de situación financiera: Inventarios. Estado de resultados: Costos.',
    texto: () => 'Los inventarios se miden al menor entre el costo, determinado por el método PEPS, y el precio de venta estimado menos los costos de terminación y venta (Sección 13). El inventario final se toma de [Completar: conteo físico o del sistema de inventario] a la fecha de cierre. El costo de los inventarios reconocido como gasto en el año se presenta en la nota de costos. [Confirmar: inventarios dados en garantía y rebajas por obsolescencia o deterioro.]'
  },
  {
    clave: 'prepagados', tipo: 'balance', titulo: 'Impuestos y gastos pagados por adelantado', n3: ['1.1.06'], pref: ['1.1.06.'],
    ref: 'Estado de situación financiera: Impuestos y gastos pagados por adelantado.',
    texto: () => 'Comprende pagos hechos por servicios, seguros, alquileres, anticipos de impuestos y otros conceptos cuyo beneficio se recibirá en los períodos siguientes. Se llevan a resultados en el período al que corresponden. [Completar: detalle de los anticipos de impuestos y su recuperabilidad.]'
  },
  {
    clave: 'ppe', tipo: 'balance', titulo: 'Propiedad, planta y equipo, neto', n3: ['1.2.01', '1.2.02'], pref: ['1.2.01.', '1.2.02.'],
    ref: 'Estado de situación financiera: Propiedad, planta y equipo (costo) y Depreciación acumulada. Estado de flujos de efectivo: actividades de inversión.',
    texto: () => 'Los activos se registran al costo y se deprecian en línea recta durante su vida útil estimada, desde el mes siguiente al de su adquisición (Sección 17). El cuadro de conciliación muestra el valor en libros neto al inicio y al final del año; las adquisiciones netas de bajas se calculan por diferencia y pueden corregirse con los datos del registro de activos. [Completar: vidas útiles por clase de activo, bienes totalmente depreciados que siguen en uso y activos dados en garantía.] No se identificaron indicios de deterioro al cierre del ejercicio. [Confirmar.]'
  },
  {
    clave: 'intangibles', tipo: 'balance', titulo: 'Activos intangibles y diferidos, neto', n3: ['1.2.03', '1.2.04'], pref: ['1.2.03.', '1.2.04.'],
    ref: 'Estado de situación financiera: Intangibles y activos diferidos y Amortización acumulada.',
    texto: () => 'Incluye los activos intangibles identificables y los cargos diferidos con beneficio económico futuro. Se miden al costo menos la amortización acumulada y se amortizan en línea recta durante su vida útil (Sección 18). [Completar: naturaleza de cada activo, vida útil y método de amortización.]'
  },
  {
    clave: 'otros_activos', tipo: 'balance', titulo: 'Otros activos no corrientes', n3: ['1.2.05'], pref: ['1.2.05.'],
    ref: 'Estado de situación financiera: Otros activos no corrientes.',
    texto: () => 'Incluye depósitos en garantía y otros activos cuya realización se espera en un plazo mayor a doce meses. [Completar: naturaleza y condiciones de cada partida.]'
  },
  {
    clave: 'cxp', tipo: 'balance', titulo: 'Cuentas por pagar comerciales', n3: ['2.1.01'], pref: ['2.1.01.'],
    ref: 'Estado de situación financiera: Cuentas por pagar comerciales. Estado de flujos de efectivo: variación en cuentas por pagar.',
    texto: () => 'Corresponden a compras de bienes y servicios a proveedores, sin intereses, con vencimiento normal dentro de los doce meses siguientes. Se miden al precio de la transacción (Sección 11). [Completar: saldos vencidos, si los hubiera.]'
  },
  {
    clave: 'obligaciones', tipo: 'balance', titulo: 'Obligaciones financieras', n3: ['2.1.02', '2.2.01'], pref: ['2.1.02.', '2.2.01.'],
    ref: 'Estado de situación financiera: Obligaciones financieras a corto plazo y a largo plazo. Estado de flujos de efectivo: actividades de financiamiento.',
    texto: () => 'Incluye préstamos bancarios, líneas de crédito, tarjetas y otras obligaciones con costo financiero, medidos al costo amortizado (Sección 11). [Completar: acreedor, tasa de interés, plazo, garantías otorgadas y calendario de vencimientos de cada obligación; la porción que vence dentro de doce meses se presenta como corriente.]'
  },
  {
    clave: 'impuestos_pagar', tipo: 'balance', titulo: 'Impuestos por pagar', n3: ['2.1.03'], pref: ['2.1.03.'],
    ref: 'Estado de situación financiera: Impuestos por pagar. Estado de resultados: Impuestos.',
    texto: (c) => `Incluye el impuesto sobre la renta y el seguro educativo estimados del ejercicio${c.itbms ? ', el ITBMS por pagar neto de créditos fiscales' : ''}, las retenciones practicadas pendientes de pago y otras obligaciones con el fisco. Se pagan en las fechas que fija la DGI. [Completar: anticipos y pagos efectuados durante el año y saldos vencidos.]`
  },
  {
    clave: 'laborales', tipo: 'balance', titulo: 'Obligaciones laborales y beneficios a los empleados', n3: ['2.1.04'], pref: ['2.1.04.'],
    ref: 'Estado de situación financiera: Obligaciones laborales.',
    texto: () => 'Comprende los salarios, el décimo tercer mes, las vacaciones, las cuotas patronales de la Caja de Seguro Social, el seguro educativo, los riesgos profesionales y otras prestaciones causadas y pendientes de pago al cierre (Sección 28). Se miden por el importe no descontado que se espera pagar. [Completar: número de empleados y prestaciones de largo plazo, si las hay.]'
  },
  {
    clave: 'otras_cxp', tipo: 'balance', titulo: 'Otras cuentas por pagar, acumulaciones y provisiones', n3: ['2.1.05', '2.2.02'], pref: ['2.1.05.', '2.2.02.'],
    ref: 'Estado de situación financiera: Otras cuentas por pagar y acumulaciones, y Provisiones a largo plazo.',
    texto: () => 'Incluye ingresos recibidos por adelantado, gastos acumulados por pagar, depósitos de clientes y las provisiones reconocidas conforme a la Sección 21. [Completar: naturaleza, monto estimado y calendario de cada provisión, y el movimiento del año.]'
  },
  {
    clave: 'patrimonio', tipo: 'balance', titulo: 'Patrimonio', n3: ['3.1.01', '3.2.01', '3.3.01'], pref: ['3.1.01.', '3.2.01.', '3.3.01.'], conSinNumero: true,
    ref: 'Estado de situación financiera: Patrimonio. Estado de cambios en el patrimonio.',
    texto: (c) => SI_NATURAL(c,
      'El patrimonio corresponde al propietario del negocio. El capital es lo aportado por el propietario; los retiros son las sumas que toma del negocio para su uso personal y se trasladan a las utilidades acumuladas en el cierre anual; las utilidades acumuladas son los resultados de ejercicios anteriores no retirados. La utilidad del ejercicio pendiente de cierre se presenta por separado hasta que se haga el cierre anual (Sección 22). El movimiento de cada componente se muestra en el estado de cambios en el patrimonio. [Completar: aportes o retiros del año que requieran explicación.]',
      'El patrimonio comprende el capital social, las utilidades acumuladas y la utilidad del ejercicio pendiente de cierre (Sección 22). [Completar: capital autorizado, emitido y pagado, número de acciones, dividendos declarados y reserva legal si aplica.]')
  },

  /* ------------------------------ notas de resultados ------------------------------ */
  {
    clave: 'ingresos', tipo: 'resultado', titulo: 'Ingresos de actividades ordinarias y otros ingresos', bandas: [1, 6],
    ref: 'Estado de resultados: Ingresos de actividades ordinarias y Otros ingresos.',
    texto: () => 'Los ingresos se reconocen conforme a la Sección 23 cuando se satisface la obligación de desempeño con el cliente y se miden por la contraprestación recibida o por recibir, neta de descuentos, devoluciones e impuestos cobrados por cuenta de terceros. El detalle por cuenta se muestra en el cuadro. [Completar: naturaleza de los servicios o bienes vendidos, clientes que representan más del 10 % de los ingresos e ingresos exentos o no gravables.]'
  },
  {
    clave: 'costos', tipo: 'resultado', titulo: 'Costos de ventas y de servicios', bandas: [2],
    ref: 'Estado de resultados: Costos. Estado de situación financiera: Inventarios.',
    texto: () => 'El costo de venta de mercancía es igual al inventario inicial más las compras netas de devoluciones y fletes, menos el inventario final (Sección 13). Los costos de servicios son los costos directos de prestar el servicio. [Completar: si el costo de ventas incluye rebajas del valor de los inventarios.]'
  },
  {
    clave: 'gastos_operativos', tipo: 'resultado', titulo: 'Gastos de operación', bandas: [4],
    ref: 'Estado de resultados: Gastos de operación (clasificados por naturaleza).',
    texto: () => 'Los gastos se presentan según su naturaleza (Sección 5) y se reconocen en el período en que se incurren. Incluyen salarios y prestaciones, servicios y alquileres, honorarios, gastos de oficina y ventas, impuestos y tasas, depreciación y amortización, donaciones y otros gastos de operación. [Completar: gastos con partes relacionadas y gastos no deducibles que requieran explicación.]'
  },
  {
    clave: 'gastos_financieros', tipo: 'resultado', titulo: 'Gastos financieros', bandas: [7],
    ref: 'Estado de resultados: Gastos financieros.',
    texto: () => 'Incluye los intereses, las comisiones y los gastos bancarios del período, reconocidos por el método de acumulación. [Completar: intereses pagados en el año, que se revelan también en el estado de flujos de efectivo.]'
  },
  {
    clave: 'extraordinarios', tipo: 'resultado', titulo: 'Otros gastos y egresos', bandas: [8],
    ref: 'Estado de resultados: Otros gastos y egresos (cuentas 7.x del catálogo, llamadas "extraordinarias" en los demás informes).',
    texto: () => 'Comprende partidas ajenas a la operación normal del negocio. La NIIF para las PYMES no permite presentar ni describir ninguna partida de ingreso o gasto como extraordinaria (Sección 5); por eso, en estos estados las cuentas de egresos extraordinarios del catálogo se muestran como "Otros gastos y egresos", con su naturaleza e importe en el cuadro. [Completar: naturaleza de cada partida y si debe reclasificarse a otro rubro, por ejemplo a gastos de operación.]'
  },
  {
    clave: 'impuestos_renta', tipo: 'resultado', titulo: 'Impuesto sobre la renta y seguro educativo', bandas: [10],
    ref: 'Estado de resultados: Impuestos. Estado de situación financiera: Impuestos por pagar.',
    texto: (c) => SI_NATURAL(c,
      'El gasto por impuestos comprende el seguro educativo y el impuesto sobre la renta estimados sobre la utilidad del ejercicio, calculados con las reglas descritas en la política 3.10. Es un cálculo del sistema con la información registrada; la liquidación definitiva depende de la declaración de renta presentada a la DGI, de las deducciones admitidas y de los ingresos exentos. [Completar: diferencias entre la utilidad contable y la renta gravable, y anticipos pagados.]',
      'El gasto por impuestos comprende el impuesto sobre la renta corriente del ejercicio. [Completar: conciliación entre la utilidad antes del impuesto y la renta gravable, tasa efectiva e impuesto diferido.]')
  },

  /* ------------------------------ notas especiales ------------------------------ */
  {
    clave: 'partes', tipo: 'especial', titulo: 'Transacciones con partes relacionadas',
    ref: 'Estado de cambios en el patrimonio: aportes y retiros del propietario.',
    texto: (c) => `${SI_NATURAL(c, `La parte relacionada es el propietario del negocio (${c.propietario}). Las transacciones con él son los aportes de capital y los retiros, que se presentan en el estado de cambios en el patrimonio y se resumen en el cuadro (Sección 33).`, 'Se consideran partes relacionadas los socios o accionistas, los administradores y las entidades que ellos controlan (Sección 33).')} [Completar: otras transacciones con partes relacionadas (préstamos, alquileres, servicios), sus saldos al cierre y su compensación por el personal clave de la gerencia. Si no existen, indicarlo.]`
  },
  {
    clave: 'riesgos', tipo: 'especial', titulo: 'Instrumentos financieros y gestión de riesgos',
    ref: 'Estado de situación financiera: activos y pasivos financieros (Secciones 11 y 12).',
    texto: () => [
      'La entidad está expuesta a los riesgos que se describen a continuación. El propietario es quien define las políticas para gestionarlos.',
      '**Riesgo de crédito.** Es el riesgo de pérdida si un cliente no paga. La exposición máxima es el valor en libros de las cuentas por cobrar y del efectivo en bancos. La entidad evalúa la capacidad de pago de sus clientes, da seguimiento a la antigüedad de los saldos y reconoce una provisión por pérdidas esperadas. [Completar: concentración en clientes, garantías y antigüedad de la cartera.]',
      '**Riesgo de liquidez.** Es el riesgo de no poder cumplir las obligaciones a su vencimiento. La entidad lo gestiona con el seguimiento de los flujos de efectivo y el calendario de cobros y pagos. El cuadro muestra cuánto de los pasivos vence dentro de los doce meses siguientes y cuánto después. [Completar: líneas de crédito disponibles.]',
      '**Riesgo de mercado.** Incluye el riesgo de tasa de interés (por las obligaciones financieras con tasa variable) y el de precios. No existe riesgo de tipo de cambio por las operaciones en dólares de los Estados Unidos de América, porque el balboa tiene paridad con esa moneda. [Confirmar.]',
      'Los instrumentos financieros se miden al costo amortizado o al precio de la transacción, y no se midieron instrumentos a valor razonable (Secciones 11 y 12). [Confirmar.]'
    ].join('\n\n')
  },
  {
    clave: 'contingencias', tipo: 'texto', titulo: 'Compromisos, contingencias y provisiones',
    ref: 'Se relaciona con el estado de situación financiera (Sección 21).',
    texto: () => 'A la fecha de cierre, la entidad no tiene litigios, reclamaciones ni procesos fiscales o laborales pendientes que puedan originar pérdidas materiales, ni ha otorgado garantías a favor de terceros, ni mantiene compromisos de compra o de arrendamiento significativos que no estén reconocidos en los estados financieros. [Confirmar con el propietario y, si existe alguno, describir su naturaleza, su monto estimado y la probabilidad de salida de recursos.]'
  },
  {
    clave: 'flujo_comp', tipo: 'especial', titulo: 'Información complementaria al estado de flujos de efectivo',
    ref: 'Estado de flujos de efectivo (Sección 7).',
    texto: () => 'Los intereses y los impuestos pagados en el año se clasifican en las actividades de operación. El efectivo y los equivalentes de efectivo del estado de flujos de efectivo coinciden con la partida de efectivo del estado de situación financiera. Durante el año no hubo transacciones de inversión o de financiamiento que no hayan requerido el uso de efectivo. [Completar: escribir en el cuadro los impuestos y los intereses pagados en el año y describir las transacciones no monetarias, si las hubo.]'
  },
  {
    clave: 'posteriores', tipo: 'texto', titulo: 'Hechos posteriores al período sobre el que se informa',
    ref: 'Se relaciona con todos los estados financieros (Sección 32).',
    texto: (c) => `La administración evaluó los hechos ocurridos entre el 31 de diciembre de ${c.anio} y la fecha de autorización de estos estados financieros. No se identificaron hechos que requieran ajustar las cifras ni revelaciones adicionales. [Confirmar con el propietario a la fecha de emisión.]`
  },
  {
    clave: 'aprobacion', tipo: 'texto', titulo: 'Autorización para la emisión de los estados financieros',
    ref: 'Se relaciona con todos los estados financieros (Secciones 3 y 32).',
    texto: (c) => `Los estados financieros del ejercicio terminado el 31 de diciembre de ${c.anio} fueron autorizados para su emisión por ${c.propietario} el [Completar: fecha de autorización].`
  }
];

// Equivalencias para señalar la nota en cada línea de los estados
export const NOTA_DE_CUENTA = {
  '1.1.01': 'efectivo', '1.1.02': 'cxc', '1.1.03': 'cxc', '1.1.04': 'cxc', '1.1.05': 'inventarios', '1.1.06': 'prepagados',
  '1.2.01': 'ppe', '1.2.02': 'ppe', '1.2.03': 'intangibles', '1.2.04': 'intangibles', '1.2.05': 'otros_activos',
  '2.1.01': 'cxp', '2.1.02': 'obligaciones', '2.2.01': 'obligaciones', '2.1.03': 'impuestos_pagar', '2.1.04': 'laborales',
  '2.1.05': 'otras_cxp', '2.2.02': 'otras_cxp', '3.1.01': 'patrimonio', '3.2.01': 'patrimonio', '3.3.01': 'patrimonio'
};
export const NOTA_DE_BANDA_RESULTADOS = { 1: 'ingresos', 6: 'ingresos', 2: 'costos', 4: 'gastos_operativos', 7: 'gastos_financieros', 8: 'extraordinarios', 10: 'impuestos_renta' };
export const NOTA_DE_FLUJO = {
  1020: 'ppe', 1030: 'cxc', 1040: 'inventarios', 1050: 'prepagados', 1060: 'cxp', 1070: 'impuestos_pagar', 1080: 'laborales', 1090: 'otras_cxp',
  2010: 'ppe', 2020: 'intangibles', 2030: 'otros_activos', 3010: 'obligaciones', 3020: 'obligaciones', 3030: 'patrimonio', 3040: 'patrimonio',
  3050: 'patrimonio', 4010: 'efectivo', 4020: 'efectivo'
};

// FIN DEL ARCHIVO efpymesnotas.js
