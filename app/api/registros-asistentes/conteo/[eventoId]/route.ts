import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || ""
);

/**
 * GET /api/registros-asistentes/conteo/[eventoId]
 * Devuelve el conteo actual de asientos ocupados y la capacidad del auditorio
 * para el evento especificado. Responde con payload similar a `asientos:conteo`.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  try {
    const { eventoId } = await params;

    const isUuid = (v: any) =>
      typeof v === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

    if (!isUuid(eventoId)) {
      return NextResponse.json(
        { success: false, error: "eventoId inválido — use un UUID válido" },
        { status: 400 }
      );
    }

    // Obtener evento y auditorio
    const { data: evs, error: evErr } = await supabase.from("eventos").select("id,id_auditorio,auditorio_id").eq("id", eventoId).limit(1);
    if (evErr) throw evErr;
    if (!evs || evs.length === 0) return NextResponse.json({ success: false, error: "Evento no encontrado" }, { status: 404 });
    const ev = evs[0];
    const audId = ev.id_auditorio ?? ev.auditorio_id ?? null;

    // Obtener capacidad del auditorio
    let capacidad_total = 0;
    if (audId) {
      const { data: auds, error: audErr } = await supabase.from("auditorios").select("capacidad_total").eq("id", audId).limit(1);
      if (audErr) throw audErr;
      capacidad_total = Number(auds && auds[0] ? auds[0].capacidad_total || 0 : 0);
    }

    // Contar registros confirmados
    const { data: regs, error: regsErr } = await supabase.from("registros_asistentes").select("id").or(`evento_id.eq.${eventoId},id_evento.eq.${eventoId}`).eq("estado", "confirmado");
    if (regsErr) throw regsErr;
    const ocupados = (regs || []).length;

    const payload = {
      reservaId: eventoId,
      eventoId,
      id_evento: eventoId,
      auditorio: audId,
      id_auditorio: audId,
      ocupados: ocupados || 0,
      capacidad: capacidad_total || 0,
      capacidad_total: capacidad_total || 0,
    };

    return NextResponse.json(
      { success: true, conteo: payload },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Error en conteo de asientos por evento:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Error interno" },
      { status: 500 }
    );
  }
}
