import { signToken, serializeTokenCookie } from "@/lib/auth";
import { NextResponse } from "next/server";
import supabaseAdmin from "@/lib/supabaseServer";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return NextResponse.json(
      { error: "Token no proporcionado" },
      { status: 400 }
    );
  }

  try {
    // Buscar el magic link en Supabase
    const { data: links, error: linkErr } = await supabaseAdmin
      .from("magic_links")
      .select("*")
      .eq("token", token)
      .eq("usado", false)
      .limit(1);
    if (linkErr) throw linkErr;
    if (!links || links.length === 0) return NextResponse.json({ error: "Enlace inválido o ya usado" }, { status: 400 });
    const link = links[0];

    // Verificar que no haya expirado
    if (new Date(link.fecha_expiracion) < new Date()) {
      return NextResponse.json({ error: "Enlace expirado" }, { status: 400 });
    }

    let userId = link.usuario_id;

    // Si es un registro nuevo, crear el usuario
    if (link.tipo === "registro" && !userId) {
      const { data: createdUsers, error: createErr } = await supabaseAdmin.from("usuarios").insert([
        { nombre: link.nombre || link.email, email: link.email, tipo_usuario: (link.tipo_usuario || "asistente").toLowerCase() },
      ]).select("id").limit(1);
      if (createErr) throw createErr;
      userId = createdUsers && createdUsers[0] && createdUsers[0].id;
    }

    // Marcar el magic link como usado
    const { error: updErr } = await supabaseAdmin.from("magic_links").update({ usado: true, fecha_uso: new Date() }).eq("id", link.id);
    if (updErr) throw updErr;

    // Obtener los datos del usuario
    const { data: userRows, error: userErr } = await supabaseAdmin.from("usuarios").select("id,nombre,email,tipo_usuario").eq("id", userId).limit(1);
    if (userErr) throw userErr;
    if (!userRows || userRows.length === 0) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    const user = userRows[0];

    // Crear el token de sesión
    const token_jwt = signToken({
      id: user.id,
      email: user.email,
      nombre: user.nombre,
      tipo_usuario: user.tipo_usuario,
    });

    // Crear respuesta con NextResponse para manejar correctamente la cookie
    const response = NextResponse.json(
      {
        message: "Sesión iniciada correctamente",
        user,
      },
      { status: 200 }
    );

    // Establecer la cookie usando NextResponse
    response.headers.set("Set-Cookie", serializeTokenCookie(token_jwt));

    return response;
  } catch (error: any) {
    console.error("Error verificando magic link:", error);
    return NextResponse.json(
      { error: error.message || "Error al procesar el enlace" },
      { status: 500 }
    );
  }
}
