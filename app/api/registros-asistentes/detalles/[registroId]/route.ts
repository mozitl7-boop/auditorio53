import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || ""
);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ registroId: string }> }
) {
  try {
    const { registroId } = await params;

    if (!registroId) {
      return NextResponse.json(
        { success: false, error: "ID de registro no proporcionado" },
        { status: 400 }
      );
    }

    // Obtener registro
    const { data: regData, error: regErr } = await supabase
      .from("registros_asistentes")
      .select("*")
      .eq("id", registroId)
      .limit(1);
    if (regErr) throw regErr;
    if (!regData || regData.length === 0)
      return NextResponse.json({ success: false, error: "Registro no encontrado" }, { status: 404 });

    const reg = regData[0];

    // Resolver campos comunes
    const asistenteId = reg.id_asistente ?? reg.asistente_id ?? reg.usuario_id ?? null;
    const eventoId = reg.id_evento ?? reg.evento_id ?? null;
    const asientoId = reg.id_asiento ?? reg.asiento_id ?? null;

    // Traer usuario
    let user = null;
    if (asistenteId) {
      const { data: udata, error: uerr } = await supabase.from("usuarios").select("id,nombre,email").eq("id", asistenteId).limit(1);
      if (uerr) throw uerr;
      user = (udata && udata[0]) || null;
    }

    // Traer evento y auditorio y organizador
    let event = null;
    let auditorio = null;
    let organizador = null;
    if (eventoId) {
      const { data: evs, error: evErr } = await supabase.from("eventos").select("*, auditorios:auditorios(id,nombre), organizadores:usuarios(id,nombre,email)").eq("id", eventoId).limit(1);
      // Si la relación anterior no está disponible, recurrir a consultas separadas.
      if (evErr || !evs || evs.length === 0) {
        const { data: evs2, error: ev2Err } = await supabase.from("eventos").select("id,titulo,fecha,hora_inicio,hora_fin,descripcion,id_auditorio,auditorio_id,id_organizador,organizador_id").eq("id", eventoId).limit(1);
        if (ev2Err) throw ev2Err;
        event = (evs2 && evs2[0]) || null;
        if (event) {
          const audId = event.id_auditorio ?? event.auditorio_id ?? null;
          if (audId) {
            const { data: auds, error: audErr } = await supabase.from("auditorios").select("id,nombre").eq("id", audId).limit(1);
            if (audErr) throw audErr;
            auditorio = (auds && auds[0]) || null;
          }
          const orgId = event.id_organizador ?? event.organizador_id ?? null;
          if (orgId) {
            const { data: orgs, error: orgErr } = await supabase.from("usuarios").select("id,nombre,email").eq("id", orgId).limit(1);
            if (orgErr) throw orgErr;
            organizador = (orgs && orgs[0]) || null;
          }
        }
      } else {
        event = evs[0];
        auditorio = event.auditorios && event.auditorios[0] ? event.auditorios[0] : null;
        organizador = event.organizadores && event.organizadores[0] ? event.organizadores[0] : null;
      }
    }

    const detalles = {
      id: reg.id,
      nombre: user?.nombre ?? null,
      email: user?.email ?? null,
      numeroAsiento: reg.numero_orden ?? reg.numeroAsiento ?? null,
      evento: {
        id: event?.id ?? eventoId,
        titulo: event?.titulo ?? null,
        organizador: organizador?.nombre ?? null,
        fecha: event?.fecha ?? null,
        horaInicio: event?.hora_inicio ?? event?.horaInicio ?? null,
        horaFin: event?.hora_fin ?? event?.horaFin ?? null,
        auditorio: auditorio?.nombre ?? null,
        descripcion: event?.descripcion ?? null,
      },
    };

    return NextResponse.json({ success: true, detalles });
  } catch (error) {
    console.error("Error al obtener los detalles del registro:", error);
    return NextResponse.json(
      { success: false, error: "Error al obtener los detalles" },
      { status: 500 }
    );
  }
}
