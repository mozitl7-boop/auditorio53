import { NextResponse } from "next/server";
import supabaseAdmin from "@/lib/supabaseServer";

/**
 * API GET /api/usuarios/organizadores — obtener usuarios tipo organizador
 * Usa `supabaseAdmin` (clave de servicio) para consultas server-side.
 */
export async function GET() {
  try {
    // Obtener organizadores desde la tabla `usuarios`
    const { data, error } = await supabaseAdmin
      .from("usuarios")
      .select("id,nombre,email")
      .eq("tipo_usuario", "organizador")
      .order("nombre", { ascending: true });

    if (error) {
      console.error("Error al obtener organizadores (supabase):", error.message || error);
      return NextResponse.json({ success: false, error: error.message || String(error) }, { status: 500 });
    }

    const organizadores = data || [];
    return NextResponse.json({ success: true, count: organizadores.length, organizadores }, { status: 200 });
  } catch (error: any) {
    console.error("Error fetching organizadores:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Error al obtener organizadores" },
      { status: 500 }
    );
  }
}
