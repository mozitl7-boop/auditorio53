/**
 * Notificaciones por email - Mailjet REST API
 */

async function sendEmailNotification(toEmail, subject, textBody, htmlBody) {
  if (!toEmail) return null;
  const recipients = Array.isArray(toEmail)
    ? toEmail.filter(Boolean)
    : [toEmail];
  if (recipients.length === 0) return null;

  console.log("[Notification] Sending to:", recipients);

  // PRIMARY: Mailjet REST API
  if (process.env.MAILJET_API_KEY && process.env.MAILJET_SECRET_KEY) {
    try {
      console.log("[Notification] Using Mailjet REST API...");

      const fromEmail = process.env.EMAIL_FROM || "ismonzi15@gmail.com";
      const fromName = "AudiTec";

      // Crear credenciales en Base64 para autenticación básica
      const credentials = `${process.env.MAILJET_API_KEY}:${process.env.MAILJET_SECRET_KEY}`;
      const encodedCredentials = Buffer.from(credentials).toString("base64");

      const payload = {
        Messages: [
          {
            From: {
              Email: fromEmail,
              Name: fromName,
            },
            To: recipients.map((r) => ({
              Email: r,
            })),
            Subject: subject || "Notificación",
            TextPart: String(textBody || "").trim(),
            HTMLPart: String(htmlBody || "").trim(),
          },
        ],
      };

          console.log("[Notification] Sending with Mailjet API... payload:", JSON.stringify(payload).slice(0, 2000));

      const response = await fetch("https://api.mailjet.com/v3.1/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${encodedCredentials}`,
        },
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();
      console.log("[Notification] API Response status:", response.status);

      if (response.status >= 400) {
        console.log(
          "[Notification] API Error response:",
          responseText.substring(0, 300)
        );
        let errorMsg = "Unknown error";
        try {
          const errorJson = JSON.parse(responseText);
          errorMsg = errorJson.message || errorJson.error || errorMsg;
        } catch (e) {
          errorMsg = responseText || "HTTP " + response.status;
        }
        throw new Error(`API error ${response.status}: ${errorMsg}`);
      }

      console.log("[Notification] ✅ Email sent successfully!");
      return {
        success: true,
        provider: "Mailjet REST API",
        status: response.status,
      };
    } catch (err) {
      console.error("[Notification] ❌ REST API error:", err?.message || err);
      return {
        success: false,
        error: err?.message || "REST API failed",
      };
    }
  }

  console.warn("[Notification] ⚠️ No email provider configured");
  return {
    success: false,
    error: "No email provider configured",
  };
}

/**
 * Test function
 */
async function testEmailNotification() {
  const testEmail = process.env.TEST_EMAIL || "isma.zitl16@gmail.com";
  console.log("[Test] Sending test email to:", testEmail);

  return sendEmailNotification(
    testEmail,
    "🧪 Test MailerSend",
    "This is a test email from AudiTec.",
    "<h1>Test Email</h1><p>MailerSend is working correctly!</p>"
  );
}

/**
 * Notify user registration
 */
async function notifyUserRegistration(userEmail, userName) {
  return sendEmailNotification(
    userEmail,
    "Bienvenido a AudiTec",
    `Hola ${userName}, tu cuenta ha sido creada exitosamente.`,
    `<h1>Bienvenido a AudiTec</h1>
     <p>Hola <strong>${userName}</strong>,</p>
     <p>Tu cuenta ha sido registrada exitosamente.</p>`
  );
}

/**
 * Notify event reminder
 * @param {string} userEmail - Email del usuario
 * @param {string} eventName - Nombre del evento
 * @param {string} eventDate - Fecha del evento (formato: YYYY-MM-DD)
 * @param {string} eventTime - Hora del evento (formato: HH:MM)
 * @param {number} auditorioNum - Número de auditorio (1 o 2)
 * @param {string} numeroAsiento - Número de asiento asignado
 */
async function notifyEventReminder(
  userEmail,
  eventName,
  eventDate,
  eventTime,
  auditorioNum,
  numeroAsiento
) {
  // Formatear fecha en español
  const formatDateSpanish = (dateStr) => {
    const date = new Date(dateStr);
    const options = {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    };
    return date.toLocaleDateString("es-MX", options);
  };

  const fechaFormato = formatDateSpanish(eventDate);
  const auditorioLabel = `Auditorio ${auditorioNum}`;

  return sendEmailNotification(
    userEmail,
    `Recordatorio: ${eventName}`,
    `El evento "${eventName}" se realizará el ${fechaFormato} a las ${eventTime} en el ${auditorioLabel}. Tu número de asiento es: ${numeroAsiento}`,
    `<h1>Recordatorio de Evento</h1>
     <p>El evento <strong>${eventName}</strong></p>
     <p>Se realizará el: <strong>${fechaFormato}</strong></p>
     <p>Hora: <strong>${eventTime}</strong></p>
     <p>${auditorioLabel}</p>
     <p>Número de asiento: <strong>${numeroAsiento}</strong></p>`
  );
}

module.exports = {
  sendEmailNotification,
  testEmailNotification,
  notifyUserRegistration,
  notifyEventReminder,
};
