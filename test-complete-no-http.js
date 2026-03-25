#!/usr/bin/env node
/**
 * Prueba completa SIN HTTP: crea registro directamente en Supabase + envía correo
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
const { sendEmailNotification } = require("./lib/notifications");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function test() {
  console.log("=".repeat(80));
  console.log("TEST COMPLETO: REGISTRO + CORREO DE CONFIRMACIÓN");
  console.log("=".repeat(80));

  try {
    // 1) Obtener evento
    console.log("\n[1] Obteniendo evento de prueba...");
    const { data: eventos, error: eventosErr } = await supabase
      .from("eventos")
      .select("*")
      .order("fecha", { ascending: true })
      .limit(1);

    if (eventosErr) throw eventosErr;
    if (!eventos || eventos.length === 0) {
      console.log("❌ No hay eventos disponibles");
      process.exit(1);
    }

    const evento = eventos[0];
    console.log(`✅ Evento seleccionado:`);
    console.log(`   ID: ${evento.id}`);
    console.log(`   Título: ${evento.titulo}`);
    console.log(`   Fecha: ${evento.fecha}`);
    console.log(`   Hora: ${evento.hora_inicio}`);
    console.log(`   Auditorio: ${evento.id_auditorio || evento.auditorio_id}`);

    // 2) Crear usuario de prueba
    console.log("\n[2] Creando usuario de prueba...");
    const testEmail = `test-${Date.now()}@example.com`;
    const testName = "Test Attendee " + Math.random().toString(36).substring(7);

    const { data: newUser, error: createErr } = await supabase
      .from("usuarios")
      .insert([{ nombre: testName, email: testEmail, tipo_usuario: "asistente" }])
      .select("id")
      .limit(1);

    if (createErr) throw createErr;
    const usuarioId = newUser[0].id;
    console.log(`✅ Usuario creado:`);
    console.log(`   ID: ${usuarioId}`);
    console.log(`   Email: ${testEmail}`);
    console.log(`   Nombre: ${testName}`);

    // 3) Crear registro de asistente
    console.log("\n[3] Creando registro de asistente...");

    // Detect column names
    const { data: sample } = await supabase
      .from("registros_asistentes")
      .select("*")
      .limit(1);
    const sampleRow = (sample && sample[0]) || {};
    const eventoCol = Object.keys(sampleRow).find((k) =>
      ["evento_id", "id_evento"].includes(k)
    ) || "id_evento";
    const asistenteCol = Object.keys(sampleRow).find((k) =>
      ["asistente_id", "id_asistente", "usuario_id"].includes(k)
    ) || "asistente_id";

    const insertObj = {
      [eventoCol]: evento.id,
      [asistenteCol]: usuarioId,
      estado: "confirmado",
      numero_orden: Math.floor(Math.random() * 168) + 1,
    };

    console.log(`   Insertando con columnas: ${eventoCol}, ${asistenteCol}`);

    const { data: registroCreado, error: regErr } = await supabase
      .from("registros_asistentes")
      .insert([insertObj])
      .select()
      .limit(1);

    if (regErr) throw regErr;
    const registro = registroCreado[0];
    console.log(`✅ Registro creado:`);
    console.log(`   ID: ${registro.id}`);
    console.log(`   Número de asiento: ${registro.numero_orden}`);

    // 4) Enviar correo de confirmación
    console.log("\n[4] Enviando correo de confirmación...");

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const detallesLink = `${baseUrl}/asistente/detalles/${registro.id}`;

    const subject = `Confirmación: ${evento.titulo}`;
    const textBody = `Hola ${testName},\n\nTu registro para el evento '${evento.titulo}' ha sido confirmado.\nFecha: ${evento.fecha}\nHora: ${evento.hora_inicio}\nAuditorio: ${evento.id_auditorio || evento.auditorio_id}\nNúmero de asiento: ${registro.numero_orden}\n\nVer detalles: ${detallesLink}\n\n¡No faltes!`;
    const htmlBody = `
      <h2>Confirmación de Registro</h2>
      <p>Hola <strong>${testName}</strong>,</p>
      <p>Tu registro para el evento <strong>'${evento.titulo}'</strong> ha sido confirmado.</p>
      <ul>
        <li><strong>Fecha:</strong> ${evento.fecha}</li>
        <li><strong>Hora:</strong> ${evento.hora_inicio}</li>
        <li><strong>Auditorio:</strong> ${evento.id_auditorio || evento.auditorio_id}</li>
        <li><strong>Número de asiento:</strong> ${registro.numero_orden}</li>
      </ul>
      <p><a href="${detallesLink}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Ver detalles</a></p>
      <p>Gracias.</p>
    `;

    const emailResult = await sendEmailNotification(testEmail, subject, textBody, htmlBody);

    if (emailResult.success) {
      console.log(`✅ Correo enviado exitosamente`);
      console.log(`   Destinatario: ${testEmail}`);
      console.log(`   Subject: ${subject}`);
      console.log(`   Provider: ${emailResult.provider}`);
      console.log(`   Status: ${emailResult.status}`);
    } else {
      console.log(`⚠️ Error enviando correo: ${emailResult.error}`);
    }

    // 5) Mostrar resumen
    console.log("\n[5] RESUMEN DE PRUEBA:");
    console.log(`   ✓ Evento: ${evento.titulo} (ID: ${evento.id})`);
    console.log(`   ✓ Usuario creado: ${testName} (${testEmail})`);
    console.log(`   ✓ Registro creado: ${registro.id} (Asiento #${registro.numero_orden})`);
    console.log(`   ✓ Link de detalles: ${detallesLink}`);
    if (emailResult.success) {
      console.log(`   ✓ Correo enviado a ${testEmail}`);
    }

    console.log("\n" + "=".repeat(80));
    console.log("✅ PRUEBA COMPLETADA EXITOSAMENTE");
    console.log("=".repeat(80));
    console.log("\n📧 Verificar inbox de:", testEmail);
    console.log("🔗 Link 'Ver detalles' en correo:", detallesLink);
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Error durante prueba:", err.message || err);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
}

test();
