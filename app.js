// Contabilidad-Nueva · Rebanada 1: acceso, empresas y catálogo de cuentas
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

if (!window.supabase) {
  document.getElementById('app').textContent =
    'No se pudo cargar la librería de conexión. Revisa tu internet y recarga la página.';
  throw new Error('La librería de Supabase no cargó');
}

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const estado = { email: '', recuperando: false };

/* ============================ utilidades ============================ */

// Crea elementos del DOM sin usar innerHTML (los datos nunca se interpretan como HTML)
function h(tag, props, ...hijos) {
  const el = document.createElement(tag);
  let valor;
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'value') valor = v;
      else if (k === 'checked') el.checked = true;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  for (const c of hijos.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  if (valor !== undefined) el.value = valor;
  return el;
}

function toast(mensaje, tipo = 'info') {
  const t = h('div', { class: 'toast ' + tipo }, mensaje);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), 4200);
}

function modal(titulo, contenido) {
  const fondo = h('div', { class: 'modal-fondo' });
  const cerrar = () => fondo.remove();
  fondo.addEventListener('click', (e) => { if (e.target === fondo) cerrar(); });
  fondo.append(h('div', { class: 'modal' },
    h('div', { class: 'modal-cab' },
      h('h2', null, titulo),
      h('button', { class: 'btn-icono', type: 'button', onclick: cerrar, 'aria-label': 'Cerrar' }, '✕')),
    contenido));
  document.body.append(fondo);
  return cerrar;
}

function mostrar(el) {
  document.getElementById('app').replaceChildren(el);
  window.scrollTo(0, 0);
}

function irA(hash) {
  if (location.hash === hash) window.dispatchEvent(new Event('ruta'));
  else location.hash = hash;
}

function texto(v) {
  const s = (v ?? '').toString().trim();
  return s === '' ? null : s;
}

function traducirError(e) {
  const m = e && e.message ? e.message : String(e);
  if (e && e.code === '23505') return 'Ya existe un registro con esos datos.';
  if ((e && e.code === '42501') || /row-level security/i.test(m)) return 'No tienes permiso para esta acción.';
  if (/Invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/Email not confirmed/i.test(m)) return 'Primero confirma tu correo con el enlace que te enviamos.';
  if (/already registered/i.test(m)) return 'Ese correo ya tiene una cuenta. Entra con tu contraseña.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Sin conexión. Revisa tu internet e intenta de nuevo.';
  return m;
}

function campo(etiqueta, control, ayuda) {
  return h('label', { class: 'campo' },
    h('span', { class: 'etiqueta' }, etiqueta), control,
    ayuda ? h('span', { class: 'ayuda' }, ayuda) : null);
}

function cargando(msg = 'Cargando…') {
  return h('p', { class: 'cargando' }, msg);
}

function errorVista(e) {
  return h('div', { class: 'contenido' },
    h('div', { class: 'tarjeta error' },
      h('h2', null, 'No se pudo cargar'),
      h('p', null, traducirError(e)),
      h('button', { class: 'btn', type: 'button', onclick: () => window.dispatchEvent(new Event('ruta')) }, 'Reintentar')));
}

async function salir() {
  await db.auth.signOut();
  estado.email = '';
  irA('#/');
}

function marco(...contenido) {
  return h('div', { class: 'marco' },
    h('header', { class: 'barra' },
      h('a', { class: 'marca', href: '#/empresas' }, 'Contabilidad'),
      h('div', { class: 'barra-der' },
        h('span', { class: 'correo' }, estado.email),
        h('button', { class: 'btn btn-sec btn-peq', type: 'button', onclick: salir }, 'Salir'))),
    h('main', { class: 'contenido' }, contenido));
}

function marcoEmpresa(empresa, pestana, contenido) {
  const pestanas = [['datos', 'Datos'], ['catalogo', 'Catálogo']];
  return marco(
    h('a', { class: 'volver', href: '#/empresas' }, '← Empresas'),
    h('h1', { class: 'titulo' }, empresa.razon_social),
    h('nav', { class: 'pestanas' }, pestanas.map(([clave, nombre]) =>
      h('a', { class: 'pestana' + (clave === pestana ? ' activa' : ''), href: `#/empresa/${empresa.id}/${clave}` }, nombre))),
    contenido);
}

/* ============================== acceso =============================== */

function vistaLogin() {
  const email = h('input', { type: 'email', required: true, autocomplete: 'email', placeholder: 'correo@ejemplo.com' });
  const clave = h('input', { type: 'password', required: true, autocomplete: 'current-password', minlength: '6', placeholder: 'Contraseña' });
  const btnEntrar = h('button', { class: 'btn btn-bloque', type: 'submit' }, 'Entrar');

  async function entrar(ev) {
    ev.preventDefault();
    btnEntrar.disabled = true;
    const { error } = await db.auth.signInWithPassword({ email: email.value.trim(), password: clave.value });
    btnEntrar.disabled = false;
    if (error) { toast(traducirError(error), 'error'); return; }
    irA('#/empresas');
  }

  async function crearCuenta() {
    if (!email.value.trim() || clave.value.length < 6) {
      toast('Escribe tu correo y una contraseña de al menos 6 caracteres.', 'error');
      return;
    }
    const { data, error } = await db.auth.signUp({
      email: email.value.trim(), password: clave.value,
      options: { emailRedirectTo: location.origin + location.pathname }
    });
    if (error) { toast(traducirError(error), 'error'); return; }
    if (data.session) irA('#/empresas');
    else toast('Te enviamos un correo para confirmar la cuenta.', 'ok');
  }

  async function olvide() {
    if (!email.value.trim()) { toast('Escribe tu correo arriba y vuelve a tocar este enlace.', 'error'); return; }
    const { error } = await db.auth.resetPasswordForEmail(email.value.trim(), {
      redirectTo: location.origin + location.pathname
    });
    if (error) toast(traducirError(error), 'error');
    else toast('Te enviamos un correo para cambiar la contraseña.', 'ok');
  }

  return h('div', { class: 'contenido' },
    h('form', { class: 'tarjeta centrada', onsubmit: entrar },
      h('h1', null, 'Contabilidad'),
      h('p', { class: 'ayuda' }, 'Accede con tu correo y contraseña.'),
      campo('Correo', email),
      campo('Contraseña', clave),
      btnEntrar,
      h('div', { class: 'acciones' },
        h('button', { class: 'btn btn-sec', type: 'button', onclick: crearCuenta }, 'Crear cuenta')),
      h('button', { class: 'enlace', type: 'button', onclick: olvide }, 'Olvidé mi contraseña')));
}

function vistaNuevaClave() {
  const clave = h('input', { type: 'password', required: true, autocomplete: 'new-password', minlength: '6' });
  async function guardar(ev) {
    ev.preventDefault();
    const { error } = await db.auth.updateUser({ password: clave.value });
    if (error) { toast(traducirError(error), 'error'); return; }
    estado.recuperando = false;
    toast('Contraseña actualizada.', 'ok');
    irA('#/empresas');
  }
  return h('div', { class: 'contenido' },
    h('form', { class: 'tarjeta centrada', onsubmit: guardar },
      h('h1', null, 'Nueva contraseña'),
      campo('Contraseña nueva', clave, 'Mínimo 6 caracteres.'),
      h('button', { class: 'btn btn-bloque', type: 'submit' }, 'Guardar')));
}

/* ============================== empresas ============================= */

async function vistaEmpresas() {
  mostrar(marco(cargando()));
  const { data, error } = await db.from('empresas')
    .select('id, razon_social, nombre_comercial, ruc, dv, tipo_persona, contribuyente_itbms, activa')
    .order('razon_social');
  if (error) throw error;

  const items = data.map((e) => h('a', { class: 'tarjeta empresa-item', href: `#/empresa/${e.id}/catalogo` },
    h('h2', null, e.razon_social),
    h('div', { class: 'ayuda' }, e.nombre_comercial || null),
    h('div', { class: 'ayuda' }, e.ruc ? `RUC ${e.ruc}${e.dv ? ' DV ' + e.dv : ''}` : 'RUC sin registrar'),
    h('div', { class: 'insignias' },
      h('span', { class: 'insignia' }, e.tipo_persona === 'juridica' ? 'Persona jurídica' : 'Persona natural'),
      h('span', { class: 'insignia ' + (e.contribuyente_itbms ? '' : 'gris') },
        e.contribuyente_itbms ? 'Contribuyente ITBMS' : 'No contribuyente ITBMS'),
      e.activa ? null : h('span', { class: 'insignia aviso' }, 'Inactiva'))));

  mostrar(marco(
    h('h1', { class: 'titulo' }, 'Mis empresas'),
    items.length ? items : h('div', { class: 'tarjeta' },
      h('p', null, 'Todavía no tienes empresas. Crea la primera: el catálogo de cuentas se carga solo.')),
    h('a', { class: 'btn btn-bloque', href: '#/empresa-nueva' }, '+ Nueva empresa')));
}

function formularioEmpresa(e, alGuardar) {
  const nuevo = !e;
  e = e || {};
  const f = {
    razon: h('input', { type: 'text', required: true, value: e.razon_social ?? '' }),
    comercial: h('input', { type: 'text', value: e.nombre_comercial ?? '' }),
    tipo: h('select', { value: e.tipo_persona ?? 'natural' },
      h('option', { value: 'natural' }, 'Persona natural'),
      h('option', { value: 'juridica' }, 'Persona jurídica')),
    ruc: h('input', { type: 'text', value: e.ruc ?? '' }),
    dv: h('input', { type: 'text', maxlength: '3', value: e.dv ?? '' }),
    fecha: h('input', { type: 'date', value: e.fecha_constitucion ?? '' }),
    aviso: h('input', { type: 'text', value: e.numero_aviso_operacion ?? '' }),
    actividad: h('input', { type: 'text', value: e.actividad_economica ?? '' }),
    direccion: h('input', { type: 'text', value: e.direccion ?? '' }),
    telefono: h('input', { type: 'tel', value: e.telefono ?? '' }),
    correo: h('input', { type: 'email', value: e.correo ?? '' }),
    representante: h('input', { type: 'text', value: e.representante_legal ?? '' }),
    cedula: h('input', { type: 'text', value: e.cedula_representante ?? '' }),
    itbms: h('input', { type: 'checkbox', checked: !!e.contribuyente_itbms })
  };
  const boton = h('button', { class: 'btn btn-bloque', type: 'submit' }, nuevo ? 'Crear empresa' : 'Guardar cambios');

  async function guardar(ev) {
    ev.preventDefault();
    const datos = {
      razon_social: texto(f.razon.value),
      nombre_comercial: texto(f.comercial.value),
      tipo_persona: f.tipo.value,
      ruc: texto(f.ruc.value),
      dv: texto(f.dv.value),
      fecha_constitucion: texto(f.fecha.value),
      numero_aviso_operacion: texto(f.aviso.value),
      actividad_economica: texto(f.actividad.value),
      direccion: texto(f.direccion.value),
      telefono: texto(f.telefono.value),
      correo: texto(f.correo.value),
      representante_legal: texto(f.representante.value),
      cedula_representante: texto(f.cedula.value),
      contribuyente_itbms: f.itbms.checked
    };
    if (!datos.razon_social) { toast('Escribe el nombre o razón social.', 'error'); return; }
    boton.disabled = true;
    const r = nuevo
      ? await db.from('empresas').insert(datos).select('id').single()
      : await db.from('empresas').update(datos).eq('id', e.id).select('id').single();
    boton.disabled = false;
    if (r.error) { toast(traducirError(r.error), 'error'); return; }
    alGuardar(r.data.id, datos);
  }

  return h('form', { class: 'tarjeta', onsubmit: guardar },
    campo('Nombre o razón social', f.razon),
    campo('Nombre comercial', f.comercial),
    campo('Tipo de contribuyente', f.tipo),
    h('div', { class: 'acciones' },
      h('div', { style: 'flex: 2 1 160px' }, campo('RUC', f.ruc)),
      h('div', { style: 'flex: 1 1 80px' }, campo('DV', f.dv))),
    campo('Fecha de constitución o inicio de operaciones', f.fecha),
    campo('Número de aviso de operación', f.aviso),
    campo('Actividad económica', f.actividad),
    campo('Dirección', f.direccion),
    campo('Teléfono', f.telefono),
    campo('Correo de la empresa', f.correo),
    campo('Representante legal o propietario', f.representante),
    campo('Cédula del representante', f.cedula),
    h('div', { class: 'grupo' },
      h('h3', null, 'ITBMS'),
      h('label', { class: 'fila-check' }, f.itbms,
        h('span', null, 'Es contribuyente del ITBMS')),
      h('p', { class: 'ayuda' }, 'Si no lo es, las compras y ventas se registran por su monto global, sin separar el impuesto.')),
    boton);
}

function vistaEmpresaNueva() {
  mostrar(marco(
    h('a', { class: 'volver', href: '#/empresas' }, '← Empresas'),
    h('h1', { class: 'titulo' }, 'Nueva empresa'),
    formularioEmpresa(null, (id) => {
      toast('Empresa creada con su catálogo de cuentas.', 'ok');
      irA(`#/empresa/${id}/catalogo`);
    })));
}

async function cargarEmpresa(id) {
  const { data, error } = await db.from('empresas').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

async function vistaEmpresaDatos(id) {
  mostrar(marco(cargando()));
  const e = await cargarEmpresa(id);
  mostrar(marcoEmpresa(e, 'datos', formularioEmpresa(e, () => {
    toast('Datos guardados.', 'ok');
    irA(`#/empresa/${id}/datos`);
  })));
}

/* ============================== catálogo ============================= */

const TIPOS = {
  activo: 'Activos', pasivo: 'Pasivos', patrimonio: 'Patrimonio', ingreso: 'Ingresos',
  costo: 'Costos', gasto: 'Gastos', extraordinario: 'Extraordinarios'
};
const CLASIF = {
  activo_corriente: 'Activo corriente', activo_no_corriente: 'Activo no corriente',
  pasivo_corriente: 'Pasivo corriente', pasivo_no_corriente: 'Pasivo no corriente',
  patrimonio: 'Patrimonio', resultado_ingresos: 'Resultado: ingresos',
  resultado_costos: 'Resultado: costos', resultado_gastos: 'Resultado: gastos',
  resultado_extraordinarios: 'Resultado: extraordinarios', resultado_impuesto: 'Resultado: impuesto'
};

function opciones(mapa, conVacio) {
  const o = Object.entries(mapa).map(([v, t]) => h('option', { value: v }, t));
  return conVacio ? [h('option', { value: '' }, '(ninguna)'), ...o] : o;
}

function sugerirNumero(padre, cuentas) {
  const ancho = { 2: 1, 3: 2, 4: 3 }[padre.nivel + 1];
  let max = 0;
  for (const c of cuentas) {
    if (c.cuenta_padre_id !== padre.id) continue;
    const n = parseInt(c.numero.split('.').pop(), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return padre.numero + '.' + String(max + 1).padStart(ancho, '0');
}

async function vistaCatalogo(id) {
  mostrar(marco(cargando()));
  const [re, rc] = await Promise.all([
    db.from('empresas').select('id, razon_social').eq('id', id).single(),
    db.from('cuentas').select('*').eq('empresa_id', id).order('numero').range(0, 4999)
  ]);
  if (re.error) throw re.error;
  if (rc.error) throw rc.error;
  const empresa = re.data;
  let cuentas = rc.data;
  const filtro = { texto: '', tipo: '', anexo: false };
  const lista = h('div', { class: 'lista-cuentas' });
  const contador = h('p', { class: 'ayuda' });

  function pintar() {
    const t = filtro.texto.toLowerCase();
    const vistas = cuentas.filter((c) =>
      (!filtro.tipo || c.tipo === filtro.tipo) &&
      (!filtro.anexo || c.lleva_anexo) &&
      (!t || c.numero.includes(t) || c.nombre.toLowerCase().includes(t)));
    lista.replaceChildren(...vistas.map((c) =>
      h('button', {
        class: `cuenta nivel-${c.nivel}` + (c.activa ? '' : ' inactiva'),
        type: 'button', onclick: () => editarCuenta(c)
      },
        h('span', { class: 'num' }, c.numero),
        h('span', null, c.nombre),
        h('span', { class: 'insignias' },
          c.lleva_anexo ? h('span', { class: 'insignia' + (c.anexo_dr && c.linea_dr ? '' : ' aviso') },
            c.anexo_dr ? `Anexo ${c.anexo_dr}` : 'Anexo') : null,
          h('span', { class: 'insignia gris' }, c.naturaleza === 'deudora' ? 'D' : 'A')))));
    contador.textContent = `${vistas.length} de ${cuentas.length} cuentas`;
  }

  async function recargar() {
    const r = await db.from('cuentas').select('*').eq('empresa_id', id).order('numero').range(0, 4999);
    if (r.error) { toast(traducirError(r.error), 'error'); return; }
    cuentas = r.data;
    pintar();
  }

  function editarCuenta(c) {
    const nombre = h('input', { type: 'text', required: true, value: c.nombre });
    const naturaleza = h('select', { value: c.naturaleza },
      h('option', { value: 'deudora' }, 'Deudora'),
      h('option', { value: 'acreedora' }, 'Acreedora'));
    const clasif = h('select', { value: c.clasificacion_ef ?? '' }, opciones(CLASIF, true));
    const mov = h('input', { type: 'checkbox', checked: c.acepta_movimientos });
    const anexo = h('input', { type: 'checkbox', checked: c.lleva_anexo });
    const anexoNum = h('input', { type: 'text', value: c.anexo_dr ?? '', placeholder: 'Número de anexo' });
    const linea = h('input', { type: 'text', value: c.linea_dr ?? '', placeholder: 'Línea de la declaración' });
    const activa = h('input', { type: 'checkbox', checked: c.activa });
    let cerrar;

    async function guardar(ev) {
      ev.preventDefault();
      if (!texto(nombre.value)) { toast('Escribe el nombre de la cuenta.', 'error'); return; }
      const datos = {
        nombre: texto(nombre.value),
        naturaleza: naturaleza.value,
        clasificacion_ef: texto(clasif.value),
        acepta_movimientos: mov.checked,
        lleva_anexo: anexo.checked,
        anexo_dr: texto(anexoNum.value),
        linea_dr: texto(linea.value),
        activa: activa.checked
      };
      const { error } = await db.from('cuentas').update(datos).eq('id', c.id);
      if (error) { toast(traducirError(error), 'error'); return; }
      if (datos.lleva_anexo && (!datos.anexo_dr || !datos.linea_dr)) {
        toast('Guardado. Falta completar el anexo o la línea.', 'info');
      } else {
        toast('Cuenta guardada.', 'ok');
      }
      cerrar();
      await recargar();
    }

    cerrar = modal(`${c.numero} · Cuenta`, h('form', { onsubmit: guardar },
      h('p', { class: 'ayuda' }, `Tipo: ${TIPOS[c.tipo] || c.tipo} · Nivel ${c.nivel}. El número no se puede cambiar.`),
      campo('Nombre', nombre),
      campo('Naturaleza', naturaleza),
      campo('Clasificación en el estado financiero', clasif),
      h('label', { class: 'fila-check' }, mov, h('span', null, 'Acepta movimientos')),
      h('div', { class: 'grupo' },
        h('h3', null, 'Declaración de renta (DGI)'),
        h('p', { class: 'ayuda' }, 'Se llena a mano para esta empresa, según su actividad. Alimenta los anexos de la renta.'),
        h('label', { class: 'fila-check' }, anexo, h('span', null, 'Esta cuenta lleva anexo')),
        campo('Número de anexo', anexoNum),
        campo('Línea de la declaración', linea)),
      h('label', { class: 'fila-check' }, activa, h('span', null, 'Cuenta activa')),
      h('button', { class: 'btn btn-bloque', type: 'submit' }, 'Guardar')));
  }

  function nuevaCuenta() {
    const padres = cuentas.filter((c) => c.nivel <= 3);
    const padre = h('select', null, padres.map((c) =>
      h('option', { value: c.id }, `${c.numero} · ${c.nombre}`)));
    const numero = h('input', { type: 'text', required: true, inputmode: 'decimal' });
    const nombre = h('input', { type: 'text', required: true });
    const naturaleza = h('select', null,
      h('option', { value: 'deudora' }, 'Deudora'),
      h('option', { value: 'acreedora' }, 'Acreedora'));
    const mov = h('input', { type: 'checkbox' });
    const anexo = h('input', { type: 'checkbox' });
    const anexoNum = h('input', { type: 'text', placeholder: 'Número de anexo' });
    const linea = h('input', { type: 'text', placeholder: 'Línea de la declaración' });
    const info = h('p', { class: 'ayuda' });
    let cerrar;

    const elegido = () => padres.find((c) => c.id === padre.value);
    function alElegirPadre() {
      const p = elegido();
      if (!p) return;
      numero.value = sugerirNumero(p, cuentas);
      naturaleza.value = p.naturaleza;
      mov.checked = p.nivel + 1 === 4;
      info.textContent = `Nivel ${p.nivel + 1} · ${TIPOS[p.tipo] || p.tipo}`;
    }
    padre.addEventListener('change', alElegirPadre);

    async function guardar(ev) {
      ev.preventDefault();
      const p = elegido();
      const num = numero.value.trim();
      if (!p) { toast('Elige la cuenta superior.', 'error'); return; }
      if (!/^\d+(\.\d+)*$/.test(num) || !num.startsWith(p.numero + '.')) {
        toast(`El número debe empezar con ${p.numero}. y usar solo dígitos y puntos.`, 'error');
        return;
      }
      if (cuentas.some((c) => c.numero === num)) { toast('Ese número ya existe.', 'error'); return; }
      const datos = {
        empresa_id: id,
        numero: num,
        nombre: texto(nombre.value),
        tipo: p.tipo,
        naturaleza: naturaleza.value,
        nivel: p.nivel + 1,
        cuenta_padre_id: p.id,
        clasificacion_ef: p.clasificacion_ef,
        acepta_movimientos: mov.checked,
        lleva_anexo: anexo.checked,
        anexo_dr: texto(anexoNum.value),
        linea_dr: texto(linea.value)
      };
      if (!datos.nombre) { toast('Escribe el nombre de la cuenta.', 'error'); return; }
      const { error } = await db.from('cuentas').insert(datos);
      if (error) { toast(traducirError(error), 'error'); return; }
      toast('Cuenta agregada. Ya está disponible en todos los informes.', 'ok');
      cerrar();
      await recargar();
    }

    cerrar = modal('Nueva cuenta', h('form', { onsubmit: guardar },
      campo('Cuenta superior', padre, 'La nueva cuenta queda dentro de esta.'),
      info,
      campo('Número', numero, 'Se sugiere el siguiente disponible; puedes cambiarlo.'),
      campo('Nombre', nombre),
      campo('Naturaleza', naturaleza),
      h('label', { class: 'fila-check' }, mov, h('span', null, 'Acepta movimientos')),
      h('div', { class: 'grupo' },
        h('h3', null, 'Declaración de renta (DGI)'),
        h('label', { class: 'fila-check' }, anexo, h('span', null, 'Esta cuenta lleva anexo')),
        campo('Número de anexo', anexoNum),
        campo('Línea de la declaración', linea)),
      h('button', { class: 'btn btn-bloque', type: 'submit' }, 'Agregar cuenta')));
    alElegirPadre();
  }

  const buscar = h('input', {
    type: 'search', placeholder: 'Buscar por número o nombre',
    oninput: (e) => { filtro.texto = e.target.value.trim(); pintar(); }
  });
  const tipo = h('select', { onchange: (e) => { filtro.tipo = e.target.value; pintar(); } },
    h('option', { value: '' }, 'Todos los tipos'), opciones(TIPOS, false));
  const soloAnexo = h('input', { type: 'checkbox', onchange: (e) => { filtro.anexo = e.target.checked; pintar(); } });

  pintar();
  mostrar(marcoEmpresa(empresa, 'catalogo', [
    h('div', { class: 'filtros' }, buscar, tipo,
      h('label', { class: 'fila-check' }, soloAnexo, h('span', null, 'Solo cuentas con anexo'))),
    contador,
    lista,
    h('div', { class: 'acciones' },
      h('button', { class: 'btn', type: 'button', onclick: nuevaCuenta }, '+ Nueva cuenta'))
  ]));
}

/* ============================== enrutador ============================ */

async function render() {
  try {
    const { data } = await db.auth.getSession();
    const sesion = data.session;
    if (!sesion) { estado.email = ''; mostrar(vistaLogin()); return; }
    estado.email = sesion.user.email || '';
    if (estado.recuperando) { mostrar(vistaNuevaClave()); return; }

    const p = (location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
    if (p.length === 0 || p[0] === 'empresas') { await vistaEmpresas(); return; }
    if (p[0] === 'empresa-nueva') { vistaEmpresaNueva(); return; }
    if (p[0] === 'empresa' && p[1]) {
      if (p[2] === 'catalogo') await vistaCatalogo(p[1]);
      else await vistaEmpresaDatos(p[1]);
      return;
    }
    irA('#/empresas');
  } catch (e) {
    mostrar(errorVista(e));
  }
}

window.addEventListener('hashchange', render);
window.addEventListener('ruta', render);
db.auth.onAuthStateChange((evento) => {
  if (evento === 'PASSWORD_RECOVERY') { estado.recuperando = true; render(); }
  else if (evento === 'SIGNED_OUT') render();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

render();
