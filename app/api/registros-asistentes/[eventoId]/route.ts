import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/lib/auth";

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || ""
);

/**
 * API GET /api/registros-asistentes/[eventoId] — obtener registros de asistentes
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  try {
    const { eventoId } = await params;

    // Validate eventoId is a UUID to avoid passing invalid strings to Postgres
    const isValidUuid = (v: any) =>
      typeof v === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

    if (!isValidUuid(eventoId)) {
      return NextResponse.json(
        {
          success: false,
          error: "eventoId inválido — use un UUID válido en la ruta",
        },
        { status: 400 }
      );
    }

    // GET registros para el evento (se acepta tanto id_evento como evento_id)
    const { data: regsA, error: regsAErr } = await supabase
      .from("registros_asistentes")
      .select("*")
      .eq("id_evento", eventoId)
      .order("numero_orden", { ascending: true });
    let registrosData = [];
    if (!regsAErr && regsA) registrosData = regsA;
    else {
      const { data: regsB, error: regsBErr } = await supabase
        .from("registros_asistentes")
        .select("*")
        .eq("evento_id", eventoId)
        .order("numero_orden", { ascending: true });
      if (regsBErr) throw regsBErr;
      registrosData = regsB || [];
    }

    return NextResponse.json({ success: true, count: registrosData.length, registros: registrosData }, { status: 200 });
  } catch (error: any) {
    console.error("Error fetching registros_asistentes:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Error al obtener registros de asistentes",
      },
      { status: 500 }
    );
  }
}

/**
 * API POST /api/registros-asistentes/[eventoId] — crear reserva (asignar asiento a asistente)
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  try {
    const { eventoId } = await params;

    // Validate eventoId is a UUID to avoid passing invalid strings to Postgres
    const isUuid = (v: any) =>
      typeof v === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
    if (!isUuid(eventoId)) {
      return NextResponse.json(
        { success: false, error: "eventoId inválido" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { asistente_id, nombre, email } = body;
    const sessionUser = getUserFromRequest(request);

    // If the caller is authenticated as an asistente (or admin acting as asistente), prefer session identity
    if (
      !asistente_id &&
      sessionUser &&
      sessionUser.tipo_usuario &&
      sessionUser.tipo_usuario !== "organizador"
    ) {
      // use session user's id as the asistente
      body.asistente_id = String(sessionUser.id);
    }

    // Helper: validar UUID v4-ish
    const isValidUuid = (v: any) =>
      typeof v === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

    // Resolucion/creacion del usuario asistente: si se envía asistente_id lo usamos (si es UUID),
    // si no (o si viene inválido but nombre+email are provided) buscamos por email o creamos uno nuevo.
    let usuarioId: string | null = null;
    if (asistente_id) {
      if (isValidUuid(asistente_id)) {
        usuarioId = asistente_id;
      } else {
        // If cliente sent a temporary id (non-UUID) but provided nombre+email, ignore it and create/find by email.
        if (!email || !nombre) {
          return NextResponse.json(
            {
              success: false,
              error:
                "asistente_id debe ser un UUID válido o enviar nombre y email",
            },
            { status: 400 }
          );
        }
        console.warn(
          "Invalid asistente_id provided, will resolve by email instead.",
          { asistente_id }
        );
        usuarioId = null;
      }
    }
    if (!usuarioId) {
      if (!email || !nombre) {
        return NextResponse.json(
          {
            success: false,
            error: "asistente_id o (nombre y email) son requeridos",
          },
          { status: 400 }
        );
      }

      // Buscar usuario por email usando Supabase
      const { data: byEmailData, error: byEmailErr } = await supabase
        .from("usuarios")
        .select("id")
        .eq("email", email)
        .limit(1);
      if (byEmailErr) throw byEmailErr;
      if (byEmailData && byEmailData.length > 0) {
        usuarioId = byEmailData[0].id;
      } else {
        const { data: createdU, error: createUErr } = await supabase
          .from("usuarios")
          .insert([{ nombre, email, tipo_usuario: "asistente" }])
          .select("id")
          .limit(1);
        if (createUErr) throw createUErr;
        usuarioId = createdU && createdU[0] && createdU[0].id;
      }
    } else {
      // validar que exista
      const { data: checkData, error: checkErr } = await supabase
        .from("usuarios")
        .select("id")
        .eq("id", usuarioId)
        .limit(1);
      if (checkErr) throw checkErr;
      if (!checkData || checkData.length === 0) {
        return NextResponse.json(
          { success: false, error: "Usuario asistente no encontrado" },
          { status: 404 }
        );
      }
    }

    // Asignación de asiento y numero_orden usando Supabase (sin transacciones)
    // Nota: aquí evitamos usar la conexión directa a Postgres y las transacciones
    // para que el código funcione en entornos donde no hay acceso TCP a Postgres.
    // Riesgo: esto no garantiza atomicidad en concurrencia alta.
    let row: any = null;
    let raEventoCol: string | null = null;
    let raAsistenteCol: string | null = null;
    let raAsientoCol: string | null = null;
    // 1) Verificar duplicados localmente: traer registros confirmados y comprobar
    const { data: allConfirmedRegs, error: regsErr } = await supabase
      .from("registros_asistentes")
      .select("*")
      .eq("estado", "confirmado");
    if (regsErr) {
      console.warn("Warning: no se pudieron leer registros_asistentes:", regsErr);
    }
    const confirmedRegs = (allConfirmedRegs || []).filter((r: any) => {
      const eid = r.evento_id ?? r.id_evento ?? null;
      const aid = r.id_asistente ?? r.asistente_id ?? r.usuario_id ?? null;
      return eid === eventoId && aid === usuarioId;
    });
    if (confirmedRegs.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: "El usuario ya tiene una reserva confirmada para este evento",
        },
        { status: 409 }
      );
    }

    // 2) Obtener evento y auditorio
    const { data: evData, error: evErr } = await supabase
      .from("eventos")
      .select("*")
      .eq("id", eventoId)
      .limit(1);
    if (evErr) throw evErr;
    if (!evData || evData.length === 0) {
      return NextResponse.json({ success: false, error: "Evento no encontrado" }, { status: 404 });
    }
    const evRow = evData[0];
    const auditorioId = evRow.id_auditorio ?? evRow.auditorio_id ?? null;

    // 3) Obtener capacidad del auditorio
    let capacidadTotal: number | null = null;
    if (auditorioId) {
      const { data: audData, error: audErr } = await supabase
        .from("auditorios")
        .select("capacidad_total")
        .eq("id", auditorioId)
        .limit(1);
      if (audErr) console.warn("Warning reading auditorios:", audErr);
      if (audData && audData.length > 0) capacidadTotal = Number(audData[0].capacidad_total || 0);
    }

    // 4) Contar ocupados para el evento (desde confirmedRegs y filtrando por evento)
    const ocupadosActuales = (allConfirmedRegs || []).filter((r: any) => {
      const eid = r.evento_id ?? r.id_evento ?? null;
      return eid === eventoId;
    }).length;

    if (capacidadTotal !== null && ocupadosActuales >= capacidadTotal) {
      return NextResponse.json(
        {
          success: false,
          error: "El auditorio está completo — no quedan asientos disponibles",
          capacidad_total: capacidadTotal,
          ocupados: ocupadosActuales,
        },
        { status: 409 }
      );
    }

    // 5) Determinar asiento disponible: obtener asientos del auditorio y excluir los ya asignados para el evento
    // Obtener ids de asientos ya asignados al evento
    const assignedSeatIds = (allConfirmedRegs || [])
      .filter((r: any) => {
        const eid = r.evento_id ?? r.id_evento ?? null;
        return eid === eventoId;
      })
      .map((r: any) => r.id_asiento ?? r.asiento_id ?? null)
      .filter(Boolean);

    // Buscar asiento disponible
    let asientoId: string | null = null;
    if (auditorioId) {
      // Build query excluding assigned ids
      let asientosQuery = supabase.from("asientos").select("id,numero_asiento").eq("id_auditorio", auditorioId).order("numero_asiento", { ascending: true }).limit(1000);
      // try alternate auditorio column if empty result
      let { data: asientosData, error: asientosErr } = await asientosQuery;
      if (asientosErr || !asientosData || asientosData.length === 0) {
        // try auditorio_id
        const alt = await supabase.from("asientos").select("id,numero_asiento").eq("auditorio_id", auditorioId).order("numero_asiento", { ascending: true }).limit(1000);
        asientosData = alt.data || [];
        if (alt.error) console.warn("Warning reading asientos (alt col):", alt.error);
      }
      if (asientosData && asientosData.length > 0) {
        const available = asientosData.find((a: any) => !assignedSeatIds.includes(a.id));
        asientoId = available ? available.id : null;
      }
    }

    if (!asientoId) {
      // no seat found — fallback: allow insertion without asiento (older schemas)
      asientoId = null;
    }

    // 6) Calcular siguiente numero_orden
    const regsForEvent = (allConfirmedRegs || []).filter((r: any) => {
      const eid = r.evento_id ?? r.id_evento ?? null;
      return eid === eventoId;
    });
    const maxOrden = regsForEvent.reduce((acc: number, r: any) => Math.max(acc, Number(r.numero_orden || 0)), 0);
    const siguienteAsiento = maxOrden + 1;

    // 7) Insertar registro intentando variantes de nombres de columnas para maximizar compatibilidad
    const candidateCols = [
      { evento: "evento_id", asistente: "asistente_id", asiento: "id_asiento" },
      { evento: "id_evento", asistente: "id_asistente", asiento: "asiento_id" },
      { evento: "evento_id", asistente: "usuario_id", asiento: "asiento_id" },
    ];
    let insertResult: any = null;
    for (const cols of candidateCols) {
      try {
        const insertObj: any = {
          [cols.evento]: eventoId,
          [cols.asistente]: usuarioId,
          estado: "confirmado",
        };
        if (asientoId && cols.asiento) insertObj[cols.asiento] = asientoId;
        insertObj.numero_orden = siguienteAsiento;
        const { data: insData, error: insErr } = await supabase.from("registros_asistentes").insert([insertObj]).select().limit(1);
        if (insErr) {
          // If error mentions column does not exist, try next candidate
          const msg = (insErr as any).message || "";
          if (msg.includes("column") || msg.includes("does not exist")) {
            continue;
          }
          throw insErr;
        }
        if (insData && insData.length > 0) {
          insertResult = insData[0];
          // attach detected column names to use later
          raEventoCol = cols.evento;
          raAsistenteCol = cols.asistente;
          raAsientoCol = cols.asiento;
          break;
        }
      } catch (e) {
        console.warn("Insert attempt failed for cols", cols, e);
        continue;
      }
    }

    if (!insertResult) {
      // as a last resort try a minimal insert with only estado and fallback column names
      try {
        const { data: altIns, error: altErr } = await supabase.from("registros_asistentes").insert([{ estado: "confirmado" }]).select().limit(1);
        if (altErr) throw altErr;
        insertResult = altIns && altIns[0];
      } catch (e) {
        console.error("Failed to insert registro_asistente:", e);
        return NextResponse.json({ success: false, error: (e as any).message || String(e) }, { status: 500 });
      }
    }

    row = insertResult;

    // Obtener datos del usuario para devolver nombre/email
    const { data: userRows, error: userErr } = await supabase
      .from("usuarios")
      .select("nombre,email")
      .eq("id", usuarioId)
      .limit(1);
    if (userErr) console.warn("Warning reading usuario after insert:", userErr);
    const user = (userRows && userRows[0]) || { nombre: null, email: null };

    // Normalizar propiedades usando los nombres de columna detectados
    const mapped = {
      id: row.id,
      eventoId: row[raEventoCol] || eventoId,
      reservaId: row[raEventoCol] || eventoId,
      asistenteId: usuarioId,
      nombre: user.nombre,
      email: user.email,
      asientoId: row[raAsientoCol] || null,
      numero_orden: row.numero_orden || null,
      numeroAsiento: row.numero_orden || null,
      fecha_registro: row.fecha_registro,
      fechaRegistro: row.fecha_registro,
      estado: row.estado,
    };

    // Emitir evento Socket.IO para sincronización y actualizar conteo agregado
    const { broadcastEvent, computeAndBroadcastAsientosConteo } = await import(
      "@/lib/socketServer"
    );
    await broadcastEvent("asistente:registrado", mapped);
    // Enviar confirmación por email al asistente (incluye título/fecha/enlace)
    try {
      const { sendEmailNotification } = await import("@/lib/notifications");
      // Obtener información del evento para incluir en el email (incluye auditorio)
      let eventInfo = null;
      try {
        const { data: evInfo, error: evInfoErr } = await supabase
          .from("eventos")
          .select("*")
          .eq("id", mapped.eventoId)
          .limit(1);
        if (!evInfoErr && evInfo && evInfo.length > 0) {
          const evRowInfo = evInfo[0];
          eventInfo = {
            titulo: evRowInfo.titulo || evRowInfo.title || null,
            fecha: evRowInfo.fecha || evRowInfo.date || null,
            hora_inicio: evRowInfo.hora_inicio || evRowInfo.start_time || null,
            auditorio: evRowInfo.id_auditorio ?? evRowInfo.auditorio_id ?? null,
          };
        }
      } catch (e) {
        console.warn("Warning fetching evento info for email:", e);
      }

      // Derive title with robust fallback
      const title =
        (eventInfo && (eventInfo.titulo || eventInfo.title)) ||
        "Tu evento reservado";

      // fecha can be stored as 'fecha' or 'date'
      const rawFecha = eventInfo && (eventInfo.fecha || eventInfo.date) ? String(eventInfo.fecha || eventInfo.date) : "";
      // hora can be 'hora_inicio' or 'start_time'
      const rawHora = eventInfo && (eventInfo.hora_inicio || eventInfo.start_time) ? String(eventInfo.hora_inicio || eventInfo.start_time) : "";

      const formatDateSpanish = (dateStr: any) => {
        if (!dateStr) return "";
        try {
          const date = new Date(typeof dateStr === "string" && dateStr.length <= 10 ? dateStr + "T00:00:00" : dateStr);
          if (isNaN(date.getTime())) return String(dateStr);
          const options: Intl.DateTimeFormatOptions = {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          };
          return date.toLocaleDateString("es-MX", options);
        } catch (e) {
          return String(dateStr);
        }
      };

      const formatTimeSpanish = (timeStr: any) => {
        if (!timeStr) return "";
        try {
          const parts = String(timeStr).split(":");
          if (parts.length >= 2) {
            const d = new Date();
            d.setHours(Number(parts[0]), Number(parts[1]), parts[2] ? Number(parts[2]) : 0, 0);
            return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
          }
          return String(timeStr);
        } catch (e) {
          return String(timeStr);
        }
      };

      const fechaFormato = formatDateSpanish(rawFecha) || "Por confirmar";
      const horaFormato = formatTimeSpanish(rawHora) || "Por confirmar";
      const auditorioString = eventInfo && (eventInfo.auditorio || eventInfo.id_auditorio || eventInfo.auditorio_id) 
        ? `Auditorio ${eventInfo.auditorio || eventInfo.id_auditorio || eventInfo.auditorio_id}`
        : "Auditorio no especificado";

      const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
      // Link should point to the registro (attendee record) details page using the inserted registro id
      const eventLink = `${baseUrl}/asistente/detalles/${mapped.id}`;

      const subject = `Confirmación: ${title}`;

      const textLines = [
        `Hola ${mapped.nombre || "Asistente"},`,
        ``,
        `Tu registro para el evento '${title}' ha sido confirmado.`,
        ``,
        `Fecha: ${fechaFormato}`,
        `Hora: ${horaFormato}`,
        `${auditorioString}`,
        `Número de asiento: ${mapped.numero_orden || "N/A"}`,
        ``,
        `Ver detalles: ${eventLink}`,
        ``,
        `¡No faltes!`,
      ];
      const text = textLines.join("\n");

      const htmlBody = `
        <div style="font-family: Arial, sans-serif; color: #333;">
          <h2>Confirmación de Registro</h2>
          <p>Hola <strong>${mapped.nombre || "Asistente"}</strong>,</p>
          <p>Tu registro para el evento <strong>'${title}'</strong> ha sido confirmado.</p>
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Fecha:</strong> ${fechaFormato}</p>
            <p><strong>Hora:</strong> ${horaFormato}</p>
            <p><strong>${auditorioString}</strong></p>
            <p><strong>Número de asiento:</strong> ${mapped.numero_orden || "N/A"}</p>
          </div>
          <p style="margin-top: 20px;">
            <a href="${eventLink}" style="display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">Ver detalles</a>
          </p>
          <p style="margin-top: 20px; color: #666;">Gracias por registrarte.</p>
        </div>
      `;

      console.info("[Email] Composing confirmation email:", {
        recipient: mapped.email,
        subject,
        titulo: title,
        fecha: fechaFormato,
        hora: horaFormato,
        auditorio: auditorioString,
        asiento: mapped.numero_orden,
        link: eventLink,
      });

      if (mapped.email) {
        await sendEmailNotification(mapped.email, subject, text, htmlBody);
        // Registrar en notificaciones_enviadas para evitar reenvíos posteriores (confirmación)
        try {
          const { error: noteErr } = await supabase
            .from("notificaciones_enviadas")
            .insert([{ evento_id: mapped.eventoId, tipo: "confirmation", destinatario_email: mapped.email }]);
          if (noteErr) console.warn("Warning inserting notificaciones_enviadas:", noteErr.message || noteErr);
        } catch (e) {
          console.error("Error registrando confirmation notification:", e);
        }
      }
    } catch (e) {
      console.error("Error enviando email de confirmacion:", e);
    }
    // Actualizar y emitir conteo agregado (asientos:conteo)
    try {
      await computeAndBroadcastAsientosConteo((row && (row[raEventoCol] || row.evento_id || row.id_evento)) || eventoId);
    } catch (e) {
      // No bloquear la respuesta si la actualización del conteo falla
      console.error("Error updating asientos:conteo after registro:", e);
    }

    return NextResponse.json(
      { success: true, registro: mapped },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Error creating registro_asistente:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Error al registrar asistente",
      },
      { status: 500 }
    );
  }
}

/**
 * API DELETE /api/registros-asistentes/[eventoId]?registroId=...
 * or with JSON body { registroId }
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  try {
    const { eventoId } = await params;
    // Read body once (may be used for registroId and authorization)
    const url = new URL(request.url);
    let registroId = url.searchParams.get("registroId");
    const body = await request.json().catch(() => ({} as any));

    if (!registroId) {
      registroId = body && (body.registroId || body.registro_id || body.id);
    }

    if (!registroId) {
      return NextResponse.json(
        { success: false, error: "registroId es requerido" },
        { status: 400 }
      );
    }

    // Authorization: prefer session-based user from cookie; fallback to header/body
    const sessionUser = getUserFromRequest(request);
    let callerUsuarioId: string | null = null;
    let callerTipo: string | null = null;
    if (sessionUser) {
      callerUsuarioId = String(sessionUser.id);
      callerTipo = sessionUser.tipo_usuario || null;
    }

    if (!callerUsuarioId) {
      callerUsuarioId =
        (request.headers.get("x-usuario-id") as string | null) ||
        body.usuario_id ||
        body.userId ||
        body.user_id ||
        null;
    }

    console.info("DELETE /api/registros-asistentes - request received", {
      eventoId,
      registroId,
      callerUsuarioId,
      callerTipo,
    });

    if (!callerUsuarioId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "usuario_id (session cookie or header x-usuario-id) es requerido",
        },
        { status: 401 }
      );
    }

    // Verify caller is the organizador of the event OR has admin role
    try {
      // Select all fields to be resilient against schema differences (id_organizador vs organizador_id etc.)
      const { data: evRows, error: evErr } = await supabase
        .from("eventos")
        .select("*")
        .eq("id", eventoId)
        .limit(1);
      if (evErr) {
        console.warn("Warning reading eventos for permission check:", evErr.message || evErr);
      }
      if (!evRows || evRows.length === 0) {
        return NextResponse.json({ success: false, error: "Evento no encontrado" }, { status: 404 });
      }

      const evRow = evRows[0] || {};
      // Accept many possible column names used across schemas
      const possibleOrganizerKeys = [
        "id_organizador",
        "organizador_id",
        "organizer_id",
        "organizador",
        "organizadorId",
        "id_organizador_usuario",
        "organizador_usuario_id",
      ];
      let organizadorId = "";
      for (const k of possibleOrganizerKeys) {
        if (evRow[k]) {
          organizadorId = String(evRow[k]);
          break;
        }
      }

      const isOrganizer = organizadorId && organizadorId === String(callerUsuarioId);
      const isAdmin = callerTipo === "admin" || callerTipo === "organizator" || callerTipo === "organizador";
      if (!isOrganizer && !isAdmin) {
        return NextResponse.json({ success: false, error: "No autorizado: solo el organizador o administradores pueden eliminar registros" }, { status: 403 });
      }
    } catch (e) {
      console.error("Error verificando organizador antes de eliminar registro:", e);
      return NextResponse.json({ success: false, error: "Error verificando permisos" }, { status: 500 });
    }

    // Delete the registro — intentar con ambas variantes de columna (evento_id / id_evento)
    let delResult: any = null;
    try {
      const { data: delA, error: delAErr } = await supabase
        .from("registros_asistentes")
        .delete()
        .match({ id: registroId, evento_id: eventoId })
        .select()
        .limit(1);
      if (delAErr) {
        // continue to try alternative
      } else if (delA && delA.length > 0) {
        delResult = delA[0];
      }

      if (!delResult) {
        const { data: delB, error: delBErr } = await supabase
          .from("registros_asistentes")
          .delete()
          .match({ id: registroId, id_evento: eventoId })
          .select()
          .limit(1);
        if (delBErr) {
          // if both attempts errored, throw
          if (!delResult) throw delBErr;
        } else if (delB && delB.length > 0) {
          delResult = delB[0];
        }
      }

      if (!delResult) {
        return NextResponse.json({ success: false, error: "Registro no encontrado" }, { status: 404 });
      }
    } catch (e) {
      console.error("Error deleting registro_asistente:", e);
      return NextResponse.json({ success: false, error: e.message || String(e) }, { status: 500 });
    }

    // Broadcast conteo update (fire-and-forget to avoid blocking response)
    try {
      const mod = await import("@/lib/socketServer");
      if (mod && typeof mod.computeAndBroadcastAsientosConteo === "function") {
        // don't await — let it run asynchronously
        mod
          .computeAndBroadcastAsientosConteo(eventoId)
          .catch((err: any) =>
            console.error(
              "Error in async computeAndBroadcastAsientosConteo:",
              err
            )
          );
      }
    } catch (e) {
      console.error("Error importing socketServer for async broadcast:", e);
    }

    return NextResponse.json(
      { success: true, deleted: delResult },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Error deleting registro_asistente:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Error al eliminar registro" },
      { status: 500 }
    );
  }
}
