import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || ""
);

/**
 * API GET /api/asientos/[auditorioId] — obtener asientos de un auditorio
 */
export async function GET(
  request: Request,
  { params }: { params: { auditorioId: string } }
) {
  try {
    const auditorioId = params.auditorioId;

    const { data, error } = await supabase
      .from("asientos")
      .select("id,auditorio_id,numero_asiento,fila,seccion,estado")
      .eq("auditorio_id", auditorioId)
      .order("numero_asiento");

    if (error) throw error;

    return NextResponse.json(
      {
        success: true,
        count: (data || []).length,
        asientos: data || [],
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Error fetching asientos:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Error al obtener asientos",
      },
      { status: 500 }
    );
  }
}
