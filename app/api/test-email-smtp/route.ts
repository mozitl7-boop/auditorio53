/**
   *  Prueba del punto final del correo electrónico: SMTP directo a través de mailjet
 * GET /api/test-email-smtp - Devuelve el resultado de la prueba
 */

export async function GET(request: Request) {
  try {
    // Use dynamic import to avoid issues with node modules in Next.js
    const { testEmailNotification } = await import("@/lib/notifications");

    const result = await testEmailNotification();

    return Response.json({
      success: result?.success || false,
      provider: result?.provider,
      messageId: result?.messageId,
      error: result?.error,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[API] Test email error:", error);
    return Response.json(
      {
        success: false,
        error: error?.message || "Failed to send test email",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
