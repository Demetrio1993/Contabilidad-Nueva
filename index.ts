// Función de Supabase: notificar-aprobacion
// Envía por correo (Resend) el aviso de que el cliente aprobó la Declaración de Renta
// y deja anotado en dr_aprobaciones si el correo salió.
// Secretos necesarios: RESEND_API_KEY. Opcionales: CORREO_DESTINO, CORREO_REMITENTE.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json'
};
const responder = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });
const esc = (t: unknown) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const b = (n: number) => 'B/. ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const servicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = req.headers.get('Authorization') ?? '';
    const { aprobacion_id } = await req.json();
    if (!aprobacion_id) return responder({ ok: false, error: 'Falta aprobacion_id' }, 400);

    // Con la sesión de quien llama: solo ve la aprobación si es miembro de la empresa
    const usuario = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: ap, error: e1 } = await usuario.from('dr_aprobaciones').select('*').eq('id', aprobacion_id).maybeSingle();
    if (e1 || !ap) return responder({ ok: false, error: 'Aprobación no encontrada' }, 404);

    const admin = createClient(url, servicio);
    const { data: emp } = await admin.from('empresas').select('razon_social').eq('id', ap.empresa_id).maybeSingle();
    const clave = Deno.env.get('RESEND_API_KEY');
    if (!clave) {
      await admin.from('dr_aprobaciones').update({ correo_estado: 'sin_configurar', correo_detalle: 'Falta el secreto RESEND_API_KEY' }).eq('id', ap.id);
      return responder({ ok: false, error: 'Correo sin configurar' });
    }
    const destino = Deno.env.get('CORREO_DESTINO') ?? 'dutaricastrocpa@gmail.com';
    const remitente = Deno.env.get('CORREO_REMITENTE') ?? 'Contabilidad <onboarding@resend.dev>';
    const filas = (ap.resumen ?? []).map((r: any) =>
      `<tr><td>${esc(r.renglon)}</td><td>${esc(r.descripcion)}</td><td style="text-align:right">${b(r.monto)}</td></tr>`).join('');
    const html = `<p><strong>${esc(emp?.razon_social ?? 'Empresa')}</strong>: el cliente aprobó la presentación de la Declaración de Renta ${esc(ap.anio)} y sus anexos ante la DGI.</p>
<p>Aprobó: ${esc(ap.aprobado_correo)}<br>Fecha: ${esc(new Date(ap.aprobado_en).toLocaleString('es-PA', { timeZone: 'America/Panama' }))}</p>
${ap.nota ? `<p>Nota del cliente: ${esc(ap.nota)}</p>` : ''}
<table cellpadding="4" style="border-collapse:collapse"><tr><th>Renglón</th><th>Descripción</th><th>Monto</th></tr>${filas}</table>`;

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: remitente, to: [destino], subject: `Declaración de Renta ${ap.anio} aprobada · ${emp?.razon_social ?? ''}`, html })
    });
    const texto = await r.text();
    if (!r.ok) {
      await admin.from('dr_aprobaciones').update({ correo_estado: 'error', correo_detalle: texto.slice(0, 300) }).eq('id', ap.id);
      return responder({ ok: false, error: texto.slice(0, 300) });
    }
    await admin.from('dr_aprobaciones').update({ correo_estado: 'enviado', correo_detalle: null, correo_enviado_en: new Date().toISOString() }).eq('id', ap.id);
    return responder({ ok: true });
  } catch (e) {
    return responder({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
});
// FIN DEL ARCHIVO index.ts
