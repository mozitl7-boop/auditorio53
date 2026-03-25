import { NextResponse } from "next/server";
import supabaseAdmin from "@/lib/supabaseServer";
import { sendMagicLinkEmail } from "@/lib/send-magic-link";
import crypto from "crypto";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = (body?.email || "").toString().trim().toLowerCase();
    if (!email)
      return NextResponse.json({ error: "email required" }, { status: 400 });

    // Buscar usuario por email usando Supabase
    const { data: users, error: userErr } = await supabaseAdmin
      .from("usuarios")
      .select("id,nombre,email,tipo_usuario")
      .ilike("email", email)
      .limit(1);
    if (userErr) throw userErr;
    const user = users && users[0];
    if (!user)
      return NextResponse.json({ error: "Usuario no encontrado. Regístrate primero." }, { status: 404 });

    // Generar magic link para login
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(new Date().getTime() + 24 * 60 * 60 * 1000);

    // Guardar el magic link de login en Supabase
    const { error: insertErr } = await supabaseAdmin.from("magic_links").insert([
      { token, email, usuario_id: user.id, tipo: "login", fecha_expiracion: expiresAt },
    ]);
    if (insertErr) throw insertErr;

    // Enviar el enlace mágico por correo
    await sendMagicLinkEmail(email, token, "login");

    console.log(`Magic link para login (${email}): /auth/magic?token=${token}`);

    return NextResponse.json(
      {
        message:
          "Se ha enviado un enlace de confirmación a tu correo. Revisa tu bandeja de entrada.",
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
