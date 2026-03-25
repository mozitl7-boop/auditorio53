import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || ""
);

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

    // Obtener evento para detectar la columna de auditorio (compatibilidad)
    const { data: evData, error: evErr } = await supabase.from('eventos').select('*').eq('id', eventoId).limit(1);
    if (evErr) throw evErr;
    if (!evData || evData.length === 0) return NextResponse.json({ success: false, error: 'Evento no encontrado' }, { status: 404 });
    const evRow = evData[0];
    const auditorioId = evRow.id_auditorio ?? evRow.auditorio_id;

    // Traer asientos del auditorio
    // Detectar columna de auditorio en tabla asientos (se asume auditorio_id en la mayoría de esquemas)
    const asientosCol = 'auditorio_id';
    const { data: asientosData, error: asientosErr } = await supabase.from('asientos').select('id,numero_asiento,fila,seccion').eq(asientosCol, auditorioId).order('numero_asiento');
    if (asientosErr) throw asientosErr;

    // Traer registros del evento (intentamos con 'evento_id' y 'id_evento')
    let registros: any[] = [];
    const { data: regsA, error: regsAErr } = await supabase.from('registros_asistentes').select('id,evento_id,id_evento,id_asistente,asiento_id,asiento_id as asientoId,numero_orden,estado').eq('evento_id', eventoId);
    if (!regsAErr && regsA) registros = regsA;
    else {
      const { data: regsB, error: regsBErr } = await supabase.from('registros_asistentes').select('id,evento_id,id_evento,id_asistente,asiento_id,numero_orden,estado').eq('id_evento', eventoId);
      if (regsBErr) throw regsBErr;
      registros = regsB || [];
    }

    // Mapear registros por asiento id
    const regsByAsiento: Record<string, any> = {};
    const asistenteIds: Set<any> = new Set();
    for (const r of registros) {
      const seatId = r.asiento_id ?? r.asientoId ?? null;
      if (seatId) regsByAsiento[String(seatId)] = r;
      if (r.id_asistente) asistenteIds.add(r.id_asistente);
    }

    // Traer datos de usuarios en batch
    let usuariosMap: Record<string, any> = {};
    if (asistenteIds.size > 0) {
      const ids = Array.from(asistenteIds);
      const { data: users, error: usersErr } = await supabase.from('usuarios').select('id,nombre,email').in('id', ids as any[]);
      if (usersErr) throw usersErr;
      usuariosMap = (users || []).reduce((acc: any, u: any) => { acc[String(u.id)] = u; return acc; }, {});
    }

    const asientos = (asientosData || []).map((a: any) => {
      const r = regsByAsiento[String(a.id)];
      const ocupado = !!r;
      const asistente = r ? (usuariosMap[String(r.id_asistente)] ? { id: r.id_asistente, nombre: usuariosMap[String(r.id_asistente)].nombre || null, email: usuariosMap[String(r.id_asistente)].email || null, numero_orden: r.numero_orden || null } : { id: r.id_asistente, numero_orden: r.numero_orden || null }) : null;
      return {
        asientoId: a.id,
        numero_asiento: a.numero_asiento,
        numeroAsiento: a.numero_asiento,
        fila: a.fila,
        seccion: a.seccion,
        ocupado,
        registroId: r?.id || null,
        numero_orden: r?.numero_orden || null,
        asistente,
      };
    });

    return NextResponse.json({ success: true, auditorioId, asientos }, { status: 200 });
  } catch (err: any) {
    console.error("Error fetching asientos por evento:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Error interno" },
      { status: 500 }
    );
  }
}
