#!/usr/bin/env node
/**
 * Prueba completa de registro: obtiene eventos, crea un registro y verifica correo
 */

const fs = require("fs");
const path = require("path");

// Load .env.local
const envPath = path.join(__dirname, ".env.local");
const envContent = fs.readFileSync(envPath, "utf-8");
const env = {};
envContent.split("\n").forEach((line) => {
  const [key, ...valueParts] = line.split("=");
  if (key && !key.startsWith("#")) {
    const value = valueParts.join("=").replace(/^["']|["']$/g, "");
    env[key.trim()] = value.trim();
  }
});
Object.assign(process.env, env);

// Import supabase client
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function test() {
  console.log("=".repeat(70));
  console.log("TEST DE REGISTRO COMPLETO (con correo de confirmación)");
  console.log("=".repeat(70));

  try {
    // 1) Obtener eventos
    console.log("\n[1] Obteniendo lista de eventos...");
    const { data: eventos, error: eventosErr } = await supabase
      .from("eventos")
      .select("*")
      .order("fecha", { ascending: true })
      .limit(5);

    if (eventosErr) throw eventosErr;
    if (!eventos || eventos.length === 0) {
      console.log("❌ No hay eventos disponibles");
      process.exit(1);
    }

    const evento = eventos[0];
    console.log(`✅ Evento encontrado:`);
    console.log(`   ID: ${evento.id}`);
    console.log(`   Título: ${evento.titulo}`);
    console.log(`   Fecha: ${evento.fecha}`);
    console.log(`   Hora: ${evento.hora_inicio} - ${evento.hora_fin}`);

    // 2) Crear usuario de prueba (o reutilizar existente)
    console.log("\n[2] Creando/verificando usuario de prueba...");
    const testEmail = "test-registro@example.com";
    const testName = "Test Attendee";

    const { data: existingUser, error: checkErr } = await supabase
      .from("usuarios")
      .select("id")
      .eq("email", testEmail)
      .limit(1);

    if (checkErr) throw checkErr;

    let usuarioId;
    if (existingUser && existingUser.length > 0) {
      usuarioId = existingUser[0].id;
      console.log(`✅ Usuario ya existe: ${usuarioId}`);
    } else {
      const { data: newUser, error: createErr } = await supabase
        .from("usuarios")
        .insert([{ nombre: testName, email: testEmail, tipo_usuario: "asistente" }])
        .select("id")
        .limit(1);

      if (createErr) throw createErr;
      usuarioId = newUser[0].id;
      console.log(`✅ Usuario creado: ${usuarioId}`);
    }

    // 3) Registrar asistente mediante POST al API local
    console.log("\n[3] Registrando asistente en evento...");
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://169.254.123.36:3000";
    const registroPayload = {
      asistente_id: usuarioId,
      nombre: testName,
      email: testEmail,
    };

    console.log(`   URL: POST ${baseUrl}/api/registros-asistentes/${evento.id}`);
    console.log(`   Body: ${JSON.stringify(registroPayload, null, 2)}`);

    const registroRes = await fetch(
      `${baseUrl}/api/registros-asistentes/${evento.id}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registroPayload),
      }
    );

    const registroData = await registroRes.json();

    if (!registroRes.ok) {
      console.log(`❌ Error en registro (${registroRes.status}):`);
      console.log(JSON.stringify(registroData, null, 2));
      process.exit(1);
    }

    console.log(`✅ Registro exitoso:`);
    if (registroData.registro) {
      const reg = registroData.registro;
      console.log(`   ID del Registro: ${reg.id}`);
      console.log(`   Evento ID: ${reg.eventoId || reg.id_evento}`);
      console.log(`   Email: ${reg.email}`);
      console.log(`   Asiento: ${reg.numeroAsiento}`);
    }

    // 4) Verificar correo enviado (logs del servidor Next.js)
    console.log("\n[4] Verificación de correo enviado:");
    console.log("   ✓ Revisa la consola del servidor Next.js para:");
    console.log("     - [Notification] Sending to: [email_del_test]");
    console.log("     - [Notification] Sending with Mailjet API... payload: {...}");
    console.log("     - [Notification] ✅ Email sent successfully!");
    console.log("   ✓ O verifica tu inbox en:", testEmail);

    // 5) Mostrar URL de detalles (donde debería ir el botón "Ver detalles")
    if (registroData.registro) {
      const registroId = registroData.registro.id;
      const detallesUrl = `${baseUrl}/asistente/detalles/${registroId}`;
      console.log("\n[5] Link 'Ver detalles' generado:");
      console.log(`   ${detallesUrl}`);
      console.log("   (Este link debería estar en el correo de confirmación)");
    }

    console.log("\n" + "=".repeat(70));
    console.log("✅ PRUEBA COMPLETADA EXITOSAMENTE");
    console.log("=".repeat(70));
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Error durante prueba:", err.message || err);
    process.exit(1);
  }
}

test();
