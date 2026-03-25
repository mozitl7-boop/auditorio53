import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || ""
);

/**
 * GET /api/asientos/evento/[eventoId]/grid
 * Devuelve los asientos agrupados por `fila` para construir una cuadrícula UI.
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

    // Obtener evento para conseguir auditorio
    const { data: evData, error: evErr } = await supabase.from('eventos').select('*').eq('id', eventoId).limit(1);
    if (evErr) throw evErr;
    if (!evData || evData.length === 0) return NextResponse.json({ success: false, error: 'Evento no encontrado' }, { status: 404 });
    const evRow = evData[0];
    const auditorioId = evRow.id_auditorio ?? evRow.auditorio_id;

    // Traer asientos ordenados por fila y numero
    const { data: asientosData, error: asientosErr } = await supabase.from('asientos').select('id,numero_asiento,fila,seccion').eq('auditorio_id', auditorioId).order('fila').order('numero_asiento');
    if (asientosErr) throw asientosErr;

    // Traer registros del evento (ambas variantes de columna)
    let registros: any[] = [];
    const { data: regsA, error: regsAErr } = await supabase.from('registros_asistentes').select('id,evento_id,id_evento,id_asistente,asiento_id,numero_orden,estado').eq('evento_id', eventoId);
    if (!regsAErr && regsA) registros = regsA;
    else {
      const { data: regsB, error: regsBErr } = await supabase.from('registros_asistentes').select('id,evento_id,id_evento,id_asistente,asiento_id,numero_orden,estado').eq('id_evento', eventoId);
      if (regsBErr) throw regsBErr;
      registros = regsB || [];
    }

    // Mapear por asiento y traer usuarios
    const regsByAsiento: Record<string, any> = {};
    const asistenteIds: Set<any> = new Set();
    for (const r of registros) {
      const seatId = r.asiento_id ?? null;
      if (seatId) regsByAsiento[String(seatId)] = r;
      if (r.id_asistente) asistenteIds.add(r.id_asistente);
    }

    let usuariosMap: Record<string, any> = {};
    if (asistenteIds.size > 0) {
      const ids = Array.from(asistenteIds);
      const { data: users, error: usersErr } = await supabase.from('usuarios').select('id,nombre,email').in('id', ids as any[]);
      if (usersErr) throw usersErr;
      usuariosMap = (users || []).reduce((acc: any, u: any) => { acc[String(u.id)] = u; return acc; }, {});
    }

    const filasMap: Record<string, any> = {};
    for (const a of (asientosData || [])) {
      const filaKey = a.fila != null ? String(a.fila) : '';
      if (!filasMap[filaKey]) filasMap[filaKey] = { fila: filaKey, seats: [] };
      const r = regsByAsiento[String(a.id)];
      const seat = {
        asientoId: a.id,
        numero_asiento: a.numero_asiento,
        numeroAsiento: a.numero_asiento,
        fila: a.fila,
        seccion: a.seccion,
        ocupado: !!r,
        registroId: r?.id || null,
        numero_orden: r?.numero_orden || null,
        asistente: r ? (usuariosMap[String(r.id_asistente)] ? { id: r.id_asistente, nombre: usuariosMap[String(r.id_asistente)].nombre || null, email: usuariosMap[String(r.id_asistente)].email || null, numero_orden: r.numero_orden || null } : { id: r.id_asistente, numero_orden: r.numero_orden || null }) : null,
      };
      filasMap[filaKey].seats.push(seat);
    }

    const filas = Object.values(filasMap);
    return NextResponse.json({ success: true, auditorioId, grid: filas }, { status: 200 });
  } catch (err: any) {
    console.error("Error fetching grid de asientos:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Error interno" },
      { status: 500 }
    );
  }
}
