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

    // Traer registros del evento; intentamos con ambas columnas de FK
    let registrosData: any[] = [];
    const { data: regsA, error: regsAErr } = await supabase
      .from("registros_asistentes")
      .select("id,id_evento,evento_id,id_asistente,asiento_id,numero_orden,fecha_registro,estado")
      .eq("id_evento", eventoId)
      .order("numero_orden", { ascending: true });
    if (!regsAErr && regsA) registrosData = regsA;
    else {
      const { data: regsB, error: regsBErr } = await supabase
        .from("registros_asistentes")
        .select("id,id_evento,evento_id,id_asistente,asiento_id,numero_orden,fecha_registro,estado")
        .eq("evento_id", eventoId)
        .order("numero_orden", { ascending: true });
      if (regsBErr) throw regsBErr;
      registrosData = regsB || [];
    }

    // Recolectar ids para buscar usuarios y asientos
    const asistenteIds = Array.from(new Set(registrosData.map((r: any) => r.id_asistente).filter(Boolean)));
    const asientoIds = Array.from(new Set(registrosData.map((r: any) => r.asiento_id).filter(Boolean)));

    const usuariosMap: Record<string, any> = {};
    if (asistenteIds.length > 0) {
      const { data: users, error: usersErr } = await supabase.from("usuarios").select("id,nombre,email").in("id", asistenteIds as any[]);
      if (usersErr) throw usersErr;
      (users || []).forEach((u: any) => (usuariosMap[String(u.id)] = u));
    }

    const asientosMap: Record<string, any> = {};
    if (asientoIds.length > 0) {
      const { data: asientos, error: asientosErr } = await supabase.from("asientos").select("id,numero_asiento,fila,seccion").in("id", asientoIds as any[]);
      if (asientosErr) throw asientosErr;
      (asientos || []).forEach((a: any) => (asientosMap[String(a.id)] = a));
    }

    const registros = registrosData.map((r: any) => ({
      registroId: r.id,
      eventoId: r.id_evento ?? r.evento_id,
      asistenteId: r.id_asistente,
      nombre: usuariosMap[String(r.id_asistente)]?.nombre ?? null,
      email: usuariosMap[String(r.id_asistente)]?.email ?? null,
      asientoId: r.asiento_id ?? null,
      numero_asiento: asientosMap[String(r.asiento_id)]?.numero_asiento ?? null,
      fila: asientosMap[String(r.asiento_id)]?.fila ?? null,
      seccion: asientosMap[String(r.asiento_id)]?.seccion ?? null,
      numero_orden: r.numero_orden ?? null,
      fecha_registro: r.fecha_registro,
      estado: r.estado,
    }));

    return NextResponse.json({ success: true, registros }, { status: 200 });
  } catch (err: any) {
    console.error("Error fetching registros detalle:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Error interno" },
      { status: 500 }
    );
  }
}
