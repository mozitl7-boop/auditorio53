// Lazily require DB helpers to avoid opening a Postgres connection during module load.
let _db = null;
function getDb() {
  if (!_db) {
    try {
      _db = require("./db");
    } catch (e) {
      _db = null;
    }
  }
  return _db || { query: async () => ({ rows: [] }), detectColumn: async () => null };
}
const { sendEmailNotification } = require("./notifications");

// Worker simple: ejecuta cada hora y envía recordatorios 24h antes.
// Para evitar duplicados, escribe en la tabla `notificaciones_enviadas`.

const HOUR_MS = 1000 * 60 * 60;

async function findEventsAround24hWindow() {
  // Buscamos eventos cuya fecha+hora esté entre 23.5 y 24.5 horas desde ahora
  // PostgreSQL: construir timestamp from fecha + hora
  const sql = `
    SELECT e.id as evento_id, e.titulo, e.fecha, e.hora_inicio, e.id_auditorio,
           to_timestamp(EXTRACT(EPOCH FROM (e.fecha + e.hora_inicio::time))) as event_ts
    FROM eventos e
    WHERE (e.fecha + e.hora_inicio::time) BETWEEN (now() + interval '23 hours 30 minutes') AND (now() + interval '24 hours 30 minutes')
  `;
  try {
    const { detectColumn, query } = getDb();
    const audCol = await detectColumn("eventos", [
      "id_auditorio",
      "auditorio_id",
    ]);
    const sql2 = `
    SELECT e.id as evento_id, e.titulo, e.fecha, e.hora_inicio, e.${audCol} as id_auditorio,
           to_timestamp(EXTRACT(EPOCH FROM (e.fecha + e.hora_inicio::time))) as event_ts
    FROM eventos e
    WHERE (e.fecha + e.hora_inicio::time) BETWEEN (now() + interval '23 hours 30 minutes') AND (now() + interval '24 hours 30 minutes')
  `;
    const res = await query(sql2);
    return res.rows || [];
  } catch (e) {
    console.error("Error buscando eventos para recordatorios:", e);
    return [];
  }
}

async function getAttendeesEmails(eventoId) {
  try {
    const { detectColumn } = getDb();
    const raEventoCol = await detectColumn("registros_asistentes", [
      "id_evento",
      "evento_id",
    ]);
    const raAsistenteCol = await detectColumn("registros_asistentes", [
      "id_asistente",
      "asistente_id",
      "usuario_id",
    ]);
    const q = `SELECT DISTINCT u.email FROM registros_asistentes ra JOIN usuarios u ON ra.${raAsistenteCol} = u.id WHERE ra.${raEventoCol} = $1 AND ra.estado = 'confirmado'`;
    const res = await query(q, [eventoId]);
    return res.rows.map((r) => r.email).filter(Boolean);
  } catch (e) {
    console.error("Error obteniendo asistentes para evento", eventoId, e);
    return [];
  }
}

async function alreadySentReminder(eventoId, email, tipo) {
  try {
    const res = await query(
      `SELECT 1 FROM notificaciones_enviadas WHERE evento_id = $1 AND tipo = $2 AND destinatario_email = $3 LIMIT 1`,
      [eventoId, tipo, email]
    );
    return res.rows.length > 0;
  } catch (e) {
    console.error("Error verificando notificacion enviada:", e);
    return false;
  }
}

async function markNotificationSent(eventoId, tipo, email) {
  try {
    await query(
      `INSERT INTO notificaciones_enviadas (evento_id, tipo, destinatario_email) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [eventoId, tipo, email]
    );
  } catch (e) {
    console.error("Error marcando notificacion enviada:", e);
  }
}

async function sendRemindersOnce() {
  try {
    const events = await findEventsAround24hWindow();
    if (!events || events.length === 0) return;

    for (const ev of events) {
      const eventoId = ev.id_evento || ev.id;
      const title = ev.titulo || "Evento";
      const when = `${ev.fecha} ${ev.hora_inicio}`;

      const emails = await getAttendeesEmails(eventoId);
      if (!emails || emails.length === 0) continue;

      for (const email of emails) {
        try {
          const already = await alreadySentReminder(
            eventoId,
            email,
            "reminder_24h"
          );
          if (already) continue;
          const baseUrl =
            process.env.NEXT_PUBLIC_APP_URL ||
            process.env.NEXT_PUBLIC_API_URL ||
            "http://localhost:3000";
          const eventLink = `${baseUrl}/admin/sala/${eventoId}`;

          const subject = `Recordatorio: ${title} — en 24 horas`;
          const text = `Hola,\n\nTe recordamos que el evento '${title}' está programado para ${when}.\n\nVer detalles: ${eventLink}\n\nTe esperamos.`;
          await sendEmailNotification(email, subject, text);
          await markNotificationSent(eventoId, "reminder_24h", email);
        } catch (e) {
          console.error("Error enviando reminder a", email, e);
        }
      }
    }
  } catch (e) {
    console.error("Error en sendRemindersOnce:", e);
  }
}

let timer = null;
function startReminderWorker() {
  // Ejecutar inmediatamente y luego cada hora
  sendRemindersOnce().catch((e) => console.error(e));
  timer = setInterval(
    () => sendRemindersOnce().catch((e) => console.error(e)),
    HOUR_MS
  );
  console.log("Reminder worker started (checks every hour)");
}

function stopReminderWorker() {
  if (timer) clearInterval(timer);
}

module.exports = { startReminderWorker, stopReminderWorker };
