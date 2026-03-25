import { NextResponse } from "next/server";
import supabaseAdmin from "@/lib/supabaseServer";

/**
 * GET /api/eventos/horarios-libres?auditorio_id=A&fecha=2025-11-21&limit=3
 * Devuelve los próximos N horarios (inicio) de una hora libres en el rango 07:00-16:00
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const auditorio_id = url.searchParams.get("auditorio_id");
    const fecha = url.searchParams.get("fecha");
    const limitParam = url.searchParams.get("limit") || "3";
    const limit = Math.max(1, Math.min(24, parseInt(limitParam, 10) || 3));

    if (!auditorio_id || !fecha) {
      return NextResponse.json(
        { success: false, error: "auditorio_id y fecha son requeridos" },
        { status: 400 }
      );
    }

    // Obtener horarios ocupados en esa fecha/auditorio
    const { data: res } = await supabaseAdmin
      .from("eventos")
      .select("hora_inicio")
      .eq("auditorio_id", auditorio_id)
      .eq("fecha", fecha);

    const ocupados = new Set(
      (res || []).map((r: any) => {
        // normalizar 'HH:MM:SS' a 'HH:MM'
        const v = (r.hora_inicio || "").toString();
        return v.length >= 5 ? v.substring(0, 5) : v;
      })
    );

    // Generar franjas de inicio entre 07:00 y 16:00 (duración 1h -> fin hasta 17:00)
    const todas: string[] = [];
    for (let h = 7; h <= 16; h++) {
      todas.push(`${String(h).padStart(2, "0")}:00`);
    }

    const libres = todas.filter((t) => !ocupados.has(t));

    return NextResponse.json(
      { success: true, slots: libres.slice(0, limit) },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Error en horarios-libres:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Error" },
      { status: 500 }
    );
  }
}
