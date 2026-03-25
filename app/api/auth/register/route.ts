import { createClient } from "@supabase/supabase-js";
import { sendMagicLinkEmail } from "@/lib/send-magic-link";
import crypto from "crypto";

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || ""
);

export async function POST(request: Request) {
  const { email, nombre, tipo_usuario } = await request.json();

  if (!email) {
    return Response.json({ error: "Correo requerido" }, { status: 400 });
  }

  try {
    // Generar un token único para el magic link
    const token = crypto.randomBytes(32).toString("hex");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 horas

    // Guardar el enlace mágico en la base de datos vía Supabase
    const { error: insertErr } = await supabase.from("magic_links").insert([
      {
        token,
        email: email.toLowerCase(),
        tipo: "registro",
        nombre: nombre || null,
        tipo_usuario: (tipo_usuario || "asistente").toLowerCase(),
        data_json: JSON.stringify({ nombre, tipo_usuario }),
        fecha_expiracion: expiresAt,
      },
    ]);
    if (insertErr) throw insertErr;

    // Enviar el enlace mágico por correo
    await sendMagicLinkEmail(email, token, "registro");

    console.log(`Magic link para registro (${email}): ${token}`);

    return Response.json({
      message:
        "Se ha enviado un enlace de confirmación a tu correo. Revisa tu bandeja de entrada.",
    });
  } catch (error: any) {
    console.error("Error en registro:", error);
    return Response.json(
      { error: error.message || "Error al procesar el registro" },
      { status: 500 }
    );
  }
}
