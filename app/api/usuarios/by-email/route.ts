import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Cliente Supabase server-side para leer usuarios
const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || ""
);

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const email = url.searchParams.get("email");
    if (!email) {
      return NextResponse.json(
        { success: false, error: "email is required" },
        { status: 400 }
      );
    }
    const { data, error } = await supabase
      .from("usuarios")
      .select("id,nombre,email,tipo_usuario")
      .eq("email", email)
      .limit(1);

    if (error) throw error;
    if (!data || data.length === 0) {
      return NextResponse.json({ success: false, found: false }, { status: 404 });
    }

    const row = data[0];
    return NextResponse.json(
      { success: true, found: true, user: row },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Error fetching user by email:", err);
    return NextResponse.json(
      { success: false, error: err.message || String(err) },
      { status: 500 }
    );
  }
}
