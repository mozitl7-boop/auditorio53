// Lazily require the legacy Postgres helper to avoid opening a TCP
// connection at module-load time (esto causaba `ECONNREFUSED 127.0.0.1:5432`).
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
const { Server } = require("socket.io");
let supabase = null;
try {
  const { createClient } = require("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
  if (url && key) {
    supabase = createClient(url, key);
  } else {
    console.warn(
      "[socketServer] Supabase service key not configured; some realtime broadcasts may be disabled."
    );
  }
} catch (e) {
  console.warn(
    "[socketServer] @supabase/supabase-js not available:",
    e && e.message
  );
}

// Guardar instancia global de Socket.IO
let io = null;

/**
 * Inicializar instancia de Socket.IO
 */
function initIO(server) {
  if (!io) {
    io = new Server(server, {
      cors: {
        origin: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true,
      },
    });

    io.on("connection", (socket) => {
      console.log("Cliente conectado:", socket.id);

      // Escuchar solicitudes de datos iniciales
      socket.on("request_data", (data) => {
        console.log("Solicitud de datos:", data);
        // Responder con el estado actual según el tipo de evento solicitado.
        (async () => {
          try {
            if (!data || !data.event) return;

            // Si piden registros de asistentes, enviamos todos los registros
            if (data.event === "asistente:registrado") {
              const rows = await getAllRegistrosAsistentes();
              // Emitir cada registro de forma individual para que el cliente
              // pueda procesarlo con la misma lógica que los broadcasts en vivo.
              rows.forEach((r) => socket.emit("asistente:registrado", r));
              return;
            }

            // Si piden eventos, enviamos la lista de eventos actuales
            if (data.event === "evento:creado") {
              const eventos = await getEventos();
              eventos.forEach((e) => socket.emit("evento:creado", e));
              return;
            }
          } catch (err) {
            console.error("Error respondiendo a request_data:", err);
          }
        })();
      });

      socket.on("disconnect", () => {
        console.log("Cliente desconectado:", socket.id);
      });
    });
  }
  try {
    // Guardar también en el objeto global para compatibilidad entre
    // diferentes paths de import/require dentro del mismo proceso Node.
    global.__SOCKET_IO__ = io;
  } catch (e) {
    // en algunos entornos global puede ser protegido; no crítico
  }
  return io;
}

/**
 * Obtener instancia de Socket.IO
 */
function getIO() {
  // Retornar la instancia si está inicializada, o intentar leerla desde
  // `global.__SOCKET_IO__` para compatibilidad cuando el módulo se haya
  // cargado por diferentes rutas/resolvers (Next.js dev bundling).
  if (io) return io;
  try {
    if (global.__SOCKET_IO__) return global.__SOCKET_IO__;
  } catch (e) {
    // ignore access errors
  }
  return null;
}

/**
 * Broadcast de evento a todos los clientes conectados
 */
async function broadcastEvent(eventName, data) {
  try {
    const ioInstance = getIO();
    if (ioInstance) {
      ioInstance.emit(eventName, data);
      console.log(`[Broadcast] ${eventName}:`, data);
      return;
    }

    // If Socket.IO is not initialized (e.g. in serverless), fallback to Supabase-based broadcasts
    // For simple CRUD events we expect the API routes to already write to DB (which will trigger Supabase Realtime).
    // Special-case computed broadcasts like `asientos:conteo`: persist into `asientos_conteo` so clients subscribed
    // to that table receive the update.
    if (eventName === "asientos:conteo" && supabase) {
      try {
        const payload = typeof data === "object" ? data : { data };
        await supabase.from("asientos_conteo").upsert(
          {
            id_evento:
              payload.id_evento || payload.eventoId || payload.reservaId,
            payload,
          },
          { onConflict: "evento_id" }
        );
        console.log(
          `[Broadcast][supabase] upserted asientos_conteo for ${
            payload.id_evento || payload.eventoId || payload.reservaId
          }`
        );
        return;
      } catch (e) {
        console.warn(
          "[Broadcast][supabase] failed to upsert asientos_conteo",
          e && e.message
        );
      }
    }

    console.debug(
      `Broadcast skipped (${eventName}): no Socket.IO and no supabase fallback`
    );
    // Attempt a generic Supabase fallback: write a lightweight row into `realtime_events`
    // so clients subscribed via Supabase Realtime can still receive updates.
    // This is optional — if the `realtime_events` table is not present the insert will fail
    // and we quietly ignore it.
    if (supabase) {
      try {
        const payload = typeof data === "object" ? data : { data };
        await supabase.from("realtime_events").insert([
          {
            event_name: eventName,
            payload: payload,
            created_at: new Date().toISOString(),
          },
        ]);
        console.log(
          `[Broadcast][supabase] inserted realtime_events row for ${eventName}`
        );
        return;
      } catch (e) {
        // If the table doesn't exist or insert fails, log and continue
        console.warn(
          `[Broadcast][supabase] realtime_events insert failed for ${eventName}:`,
          e && e.message
        );
      }
    }
  } catch (err) {
    console.error(`Error en broadcast ${eventName}:`, err);
  }
}

module.exports = {
  initIO,
  getIO,
  broadcastEvent,
  getEventos,
  getAsientos,
  getRegistrosAsistentes,
  getAllRegistrosAsistentes,
  computeAndBroadcastAsientosConteo,
};

/**
 * API para obtener eventos desde la BD
 */
async function getEventos() {
  try {
    // Use Supabase to fetch eventos and related data to avoid raw SQL and
    // mismatched column names. This mirrors the logic in `app/api/eventos/route.ts`.
    if (!supabase) {
      // Fallback: return empty list if supabase client isn't available
      return [];
    }

    const { data: eventosData, error: eventosError } = await supabase
      .from("eventos")
      .select("*")
      .order("fecha", { ascending: false })
      .order("hora_inicio", { ascending: true });
    if (eventosError) {
      console.error("[socketServer] supabase eventos error:", eventosError);
      return [];
    }
    const eventosRows = eventosData || [];

    // Determine column naming from sample row
    const sample = eventosRows[0] || {};
    const organizadorColumn = sample.hasOwnProperty("id_organizador")
      ? "id_organizador"
      : sample.hasOwnProperty("organizador_id")
      ? "organizador_id"
      : "id_organizador";
    const auditorioColumn = sample.hasOwnProperty("id_auditorio")
      ? "id_auditorio"
      : sample.hasOwnProperty("auditorio_id")
      ? "auditorio_id"
      : "id_auditorio";

    const organizadorIds = Array.from(
      new Set(
        eventosRows
          .map((e) => e[organizadorColumn])
          .filter((v) => v !== null && v !== undefined)
      )
    );
    const auditorioIds = Array.from(
      new Set(
        eventosRows
          .map((e) => e[auditorioColumn])
          .filter((v) => v !== null && v !== undefined)
      )
    );
    const eventoIds = eventosRows.map((e) => e.id);

    const usuariosPromise = organizadorIds.length
      ? supabase.from("usuarios").select("id,nombre,email").in("id", organizadorIds)
      : Promise.resolve({ data: [], error: null });
    const auditoriosPromise = auditorioIds.length
      ? supabase.from("auditorios").select("id,capacidad_total").in("id", auditorioIds)
      : Promise.resolve({ data: [], error: null });

    const [usuariosRes, auditoriosRes] = await Promise.all([usuariosPromise, auditoriosPromise]);
    if (usuariosRes.error || auditoriosRes.error) {
      console.error("[socketServer] batch fetch error", usuariosRes.error || auditoriosRes.error);
      return [];
    }

    // Fetch confirmed registros for events (try both column variants)
    let registrosConfirmados = [];
    if (eventoIds.length > 0) {
      const { data: regs, error: regsError } = await supabase
        .from("registros_asistentes")
        .select("id,estado,evento_id,id_evento")
        .in("evento_id", eventoIds)
        .or("estado.eq.confirmado");
      if (regsError) {
        const { data: regsAlt, error: regsAltErr } = await supabase
          .from("registros_asistentes")
          .select("id,estado,evento_id,id_evento")
          .in("id_evento", eventoIds)
          .or("estado.eq.confirmado");
        if (regsAltErr) throw regsAltErr;
        registrosConfirmados = regsAlt || [];
      } else {
        registrosConfirmados = regs || [];
      }
    }

    const usuariosMap = (usuariosRes.data || []).reduce((acc, u) => {
      acc[String(u.id)] = u;
      return acc;
    }, {});
    const auditoriosMap = (auditoriosRes.data || []).reduce((acc, a) => {
      acc[String(a.id)] = a;
      return acc;
    }, {});

    const asistentesPorEvento = {};
    registrosConfirmados.forEach((r) => {
      const eid = r.evento_id ?? r.id_evento ?? null;
      if (!eid) return;
      asistentesPorEvento[String(eid)] = (asistentesPorEvento[String(eid)] || 0) + 1;
    });

    const mapped = eventosRows.map((e) => {
      const orgId = e[organizadorColumn];
      const audId = e[auditorioColumn];
      const usuario = usuariosMap[String(orgId)] || {};
      const aud = auditoriosMap[String(audId)] || {};
      const asistentes_registrados = asistentesPorEvento[String(e.id)] || 0;
      const capacidad_total = Number(aud.capacidad_total ?? e.asistentes_esperados ?? 0);
      const fechaStr = e.fecha instanceof Date ? e.fecha.toISOString().substring(0, 10) : String(e.fecha).substring(0, 10);
      const horaFin = (e.hora_fin || "").toString().substring(0, 5) || "23:59";
      const end = new Date(`${fechaStr}T${horaFin}:00`);
      const archivado = new Date() > end;

      return {
        id: e.id,
        titulo: e.titulo,
        descripcion: e.descripcion,
        id_organizador: orgId,
        id_auditorio: audId,
        fecha: e.fecha instanceof Date ? e.fecha.toISOString().substring(0, 10) : String(e.fecha),
        hora_inicio: (e.hora_inicio || "").toString().substring(0, 5),
        hora_fin: (e.hora_fin || "").toString().substring(0, 5),
        asistentes: Number(e.asistentes_esperados || 0),
        estado: e.estado,
        tipo_evento: e.tipo_evento || null,
        carrera: e.carrera || null,
        organizador_nombre: usuario.nombre || null,
        organizador_email: usuario.email || null,
        capacidad_total,
        asistentes_registrados: Number(asistentes_registrados),
        archivado: Boolean(archivado),
      };
    });

    return mapped;
  } catch (err) {
    console.error("Error fetching eventos:", err);
    return [];
  }
}

/**
 * API para obtener asientos de un auditorio
 */
async function getAsientos(auditorioId) {
  try {
    if (!supabase) return [];
    const { data, error } = await supabase.from("asientos").select("id,numero_asiento,fila,seccion,estado,id_auditorio,auditorio_id").or(`id_auditorio.eq.${auditorioId},auditorio_id.eq.${auditorioId}`);
    if (error) {
      console.error("Error fetching asientos via supabase:", error);
      return [];
    }
    // Normalize to id_auditorio
    return (data || []).map((r) => ({
      id: r.id,
      id_auditorio: r.id_auditorio ?? r.auditorio_id ?? auditorioId,
      numero_asiento: r.numero_asiento,
      fila: r.fila,
      seccion: r.seccion,
      estado: r.estado,
    })).sort((a,b)=> (a.numero_asiento||0) - (b.numero_asiento||0));
  } catch (err) {
    console.error("Error fetching asientos:", err);
    return [];
  }
}

/**
 * API para obtener registros de asistentes de un evento
 */
async function getRegistrosAsistentes(eventoId) {
  try {
    if (!supabase) return [];
    // Try both foreign key variants
    const { data: d1, error: e1 } = await supabase.from("registros_asistentes").select("id,numero_orden,fecha_registro,estado,evento_id,id_evento,id_asistente,id_asiento,asiento_id").eq("evento_id", eventoId).order("numero_orden", { ascending: true });
    if (!e1 && d1) return d1.map((r)=>({
      id: r.id,
      id_evento: r.evento_id ?? r.id_evento,
      id_asistente: r.id_asistente ?? r.id_asistente,
      id_asiento: r.id_asiento ?? r.asiento_id ?? null,
      numero_orden: r.numero_orden,
      fecha_registro: r.fecha_registro,
      estado: r.estado,
    }));
    const { data: d2, error: e2 } = await supabase.from("registros_asistentes").select("id,numero_orden,fecha_registro,estado,evento_id,id_evento,id_asistente,id_asiento,asiento_id").eq("id_evento", eventoId).order("numero_orden", { ascending: true });
    if (e2) {
      console.error("Error fetching registros_asistentes via supabase:", e1 || e2);
      return [];
    }
    return (d2 || []).map((r)=>({
      id: r.id,
      id_evento: r.evento_id ?? r.id_evento,
      id_asistente: r.id_asistente ?? r.id_asistente,
      id_asiento: r.id_asiento ?? r.asiento_id ?? null,
      numero_orden: r.numero_orden,
      fecha_registro: r.fecha_registro,
      estado: r.estado,
    }));
  } catch (err) {
    console.error("Error fetching registros_asistentes:", err);
    return [];
  }
}

/**
 * Obtener todos los registros de asistentes (join con usuario y asiento)
 */
async function getAllRegistrosAsistentes() {
  try {
    if (!supabase) return [];
    const { data: registros, error } = await supabase.from("registros_asistentes").select("id,evento_id,id_evento,id_asistente,id_asiento,numero_orden,fecha_registro,estado").order("fecha_registro", { ascending: false });
    if (error) {
      console.error("Error fetching all registros_asistentes via supabase:", error);
      return [];
    }
    const ids = registros || [];
    // Fetch user emails for asistente ids
    const asistenteIds = Array.from(new Set(ids.map((r)=> r.id_asistente ?? r.id_asistente).filter(Boolean)));
    let usuariosById = {};
    if (asistenteIds.length > 0) {
      const { data: users } = await supabase.from('usuarios').select('id,nombre,email').in('id', asistenteIds);
      usuariosById = (users || []).reduce((acc,u)=>{ acc[String(u.id)] = u; return acc; }, {});
    }
    return ids.map((r)=>{
      const asist = usuariosById[String(r.id_asistente)] || {};
      return {
        id: r.id,
        eventoId: r.evento_id ?? r.id_evento,
        id_evento: r.evento_id ?? r.id_evento,
        asistenteId: r.id_asistente,
        id_asistente: r.id_asistente,
        nombre: asist.nombre || null,
        email: asist.email || null,
        asientoId: r.id_asiento ?? null,
        numero_orden: r.numero_orden,
        numeroAsiento: r.numero_orden,
        fecha_registro: r.fecha_registro,
        fechaRegistro: r.fecha_registro,
        estado: r.estado,
      };
    });
  } catch (err) {
    console.error("Error fetching all registros_asistentes:", err);
    return [];
  }
}

/**
 * Calcular conteo de asientos ocupados para un evento y emitir un evento agregado
 * hacia todos los clientes conectados: `asientos:conteo`.
 *
 * Payload ejemplo:
 * {
 *   reservaId: <eventoId>,
 *   eventoId: <eventoId>,
 *   id_evento: <eventoId>,
 *   auditorio: <auditorio_id>,
 *   id_auditorio: <auditorio_id>,
 *   ocupados: <number>,
 *   capacidad: <number>,
 *   capacidad_total: <number>
 * }
 */
async function computeAndBroadcastAsientosConteo(eventoId) {
  try {
    if (!eventoId) return null;

    if (!supabase) return null;
    // Get event and auditorio
    const { data: evs, error: evErr } = await supabase.from('eventos').select('id,id_auditorio,auditorio_id').eq('id', eventoId).limit(1);
    if (evErr) throw evErr;
    const ev = (evs && evs[0]) || null;
    if (!ev) return null;
    const audId = ev.id_auditorio ?? ev.auditorio_id ?? null;

    // Count confirmed registros (try both columns)
    let ocupados = 0;
    const { data: regs1, error: regsErr1 } = await supabase.from('registros_asistentes').select('id').eq('evento_id', eventoId).eq('estado', 'confirmado');
    if (!regsErr1 && regs1) ocupados = regs1.length;
    else {
      const { data: regs2, error: regsErr2 } = await supabase.from('registros_asistentes').select('id').eq('id_evento', eventoId).eq('estado', 'confirmado');
      if (!regsErr2 && regs2) ocupados = regs2.length;
    }

    const { data: audRows } = await supabase.from('auditorios').select('capacidad_total').eq('id', audId).limit(1);
    const capacidad_total = (audRows && audRows[0] && audRows[0].capacidad_total) || 0;

    const payload = {
      reservaId: eventoId,
      eventoId: eventoId,
      id_evento: eventoId,
      auditorio: audId,
      id_auditorio: audId,
      ocupados: ocupados || 0,
      capacidad: capacidad_total || 0,
      capacidad_total: capacidad_total || 0,
    };

    // Usar el broadcast helper para emitir a todos los clientes
    await broadcastEvent("asientos:conteo", payload);
    return payload;
  } catch (err) {
    console.error("Error computing/broadcasting asientos:conteo:", err);
    return null;
  }
}
