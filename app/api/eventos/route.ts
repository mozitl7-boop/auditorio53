import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/lib/auth";

// Inicializar cliente Supabase del lado servidor usando Service Role
const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || ""
);

/**
 * API GET /api/eventos — obtener todos los eventos
 */
export async function GET() {
  try {
    // Obtener eventos desde Supabase y computar agregados en el servidor
    // Comentarios y variables en español para claridad

    // 1) Traer todos los eventos (ordenados por fecha/hora)
    const { data: eventosData, error: eventosError } = await supabase
      .from("eventos")
      .select("*")
      .order("fecha", { ascending: false })
      .order("hora_inicio", { ascending: true });

    if (eventosError) throw eventosError;

    const eventosRows = eventosData || [];

    // 2) Detectar qué nombres de columna usa la BD según la primera fila (compatibilidad)
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

    // 3) Recolectar ids para consultas en lote (organizadores, auditorios, registros)
    const organizadorIds = Array.from(
      new Set(
        eventosRows
          .map((e: any) => e[organizadorColumn])
          .filter((v: any) => v !== null && v !== undefined)
      )
    );
    const auditorioIds = Array.from(
      new Set(
        eventosRows
          .map((e: any) => e[auditorioColumn])
          .filter((v: any) => v !== null && v !== undefined)
      )
    );
    const eventoIds = eventosRows.map((e: any) => e.id);

    // 4) Traer organizadores y auditorios en batch
    const usuariosPromise = organizadorIds.length
      ? supabase.from("usuarios").select("id,nombre,email").in("id", organizadorIds)
      : Promise.resolve({ data: [], error: null });
    const auditoriosPromise = auditorioIds.length
      ? supabase.from("auditorios").select("id,capacidad_total").in("id", auditorioIds)
      : Promise.resolve({ data: [], error: null });

    const [usuariosRes, auditoriosRes] = await Promise.all([usuariosPromise, auditoriosPromise]);
    if (usuariosRes.error) throw usuariosRes.error;
    if (auditoriosRes.error) throw auditoriosRes.error;

    const usuariosMap = (usuariosRes.data || []).reduce((acc: any, u: any) => {
      acc[String(u.id)] = u;
      return acc;
    }, {});
    const auditoriosMap = (auditoriosRes.data || []).reduce((acc: any, a: any) => {
      acc[String(a.id)] = a;
      return acc;
    }, {});

    // 5) Traer registros_confirmados para calcular asistentes_registrados por evento
    // Evitar referenciar columnas concretas en la consulta (p.ej. `evento_id`) ya que
    // algunos esquemas usan `id_evento` y referenciarlas en la cláusula SQL causa
    // errores 42703 si no existen. En su lugar traemos filas filtradas por estado y
    // filtramos en memoria por los ids de eventos.
    let registrosConfirmados: any[] = [];
    if (eventoIds.length > 0) {
      const { data: regs, error: regsError } = await supabase
        .from("registros_asistentes")
        .select("*")
        .eq("estado", "confirmado");
      if (regsError) {
        // Si falla la consulta por cualquier motivo, loguear y continuar sin conteos
        console.warn("Warning: no se pudieron obtener registros_asistentes:", regsError);
        registrosConfirmados = [];
      } else {
        registrosConfirmados = regs || [];
      }
      // Filtrar localmente por los eventoIds soportando ambas columnas
      registrosConfirmados = registrosConfirmados.filter((r: any) => {
        const eid = r.evento_id ?? r.id_evento ?? null;
        if (!eid) return false;
        return eventoIds.includes(String(eid));
      });
    }

    // Agrupar conteos por evento (desde los registros ya filtrados)
    const asistentesPorEvento: Record<string, number> = {};
    registrosConfirmados.forEach((r: any) => {
      const eid = r.evento_id ?? r.id_evento ?? null;
      if (!eid) return;
      asistentesPorEvento[String(eid)] = (asistentesPorEvento[String(eid)] || 0) + 1;
    });

    // 6) Mapear rows al formato esperado por el frontend
    const mapped = eventosRows.map((e: any) => {
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

    return NextResponse.json(
      {
        success: true,
        count: mapped.length,
        eventos: mapped,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Error fetching eventos:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Error al obtener eventos",
      },
      { status: 500 }
    );
  }
}

/**
 * API POST /api/eventos — crear un nuevo evento
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    // Aceptar variantes snake_case o camelCase
    const auditorio_id = body.auditorio_id ?? body.id_auditorio ?? null;
    let organizador_id = body.organizador_id ?? body.id_organizador ?? null;
    const organizador_nombre = body.organizador_nombre ?? body.organizadorNombre ?? null;
    const organizador_email = body.organizador_email ?? body.organizadorEmail ?? null;
    const titulo = body.titulo ?? null;
    const descripcion = body.descripcion ?? "";
    const fecha = body.fecha ?? null;
    const hora_inicio = body.hora_inicio ?? body.horaInicio ?? null;
    const hora_fin = body.hora_fin ?? body.horaFin ?? null;
    const asistentes_esperados = body.asistentes_esperados ?? body.asistentes ?? 0;
    const tipo_evento = body.tipo_evento ?? body.tipoEvento ?? null;
    const carrera = body.carrera ?? null;

    // Campos requeridos
    if (!auditorio_id || !titulo || !fecha || !hora_inicio || !hora_fin) {
      return NextResponse.json({ success: false, error: "Faltan campos requeridos" }, { status: 400 });
    }

    // Detectar nombres de columna compatibles revisando una fila de ejemplo
    const { data: sampleArr } = await supabase.from('eventos').select('*').limit(1);
    const sample = (sampleArr && sampleArr[0]) || {};
    const organizadorColumn = sample.hasOwnProperty('id_organizador') ? 'id_organizador' : sample.hasOwnProperty('organizador_id') ? 'organizador_id' : 'id_organizador';
    const auditorioColumn = sample.hasOwnProperty('id_auditorio') ? 'id_auditorio' : sample.hasOwnProperty('auditorio_id') ? 'auditorio_id' : 'id_auditorio';

    // Verificar que el auditorio existe
    const { data: audCheck, error: audErr } = await supabase.from('auditorios').select('id,capacidad_total').eq('id', String(auditorio_id)).limit(1).maybeSingle();
    if (audErr) throw audErr;
    if (!audCheck) return NextResponse.json({ success: false, error: 'Auditorio no encontrado' }, { status: 404 });

    // Resolver o crear organizador
    const sessionUser = getUserFromRequest(request);
    let finalOrganizadorId = organizador_id;
    if (!finalOrganizadorId) {
      if (sessionUser && sessionUser.tipo_usuario === 'organizador') {
        finalOrganizadorId = String(sessionUser.id);
      }
    }

    if (!finalOrganizadorId) {
      if (!organizador_nombre || String(organizador_nombre).trim() === '') {
        return NextResponse.json({ success: false, error: 'organizador_id o organizador_nombre requerido' }, { status: 400 });
      }
      if (!organizador_email || String(organizador_email).trim() === '') {
        return NextResponse.json({ success: false, error: 'organizador_email es requerido cuando se crea un organizador nuevo' }, { status: 400 });
      }

      // Buscar por email primero
      const { data: byEmail } = await supabase.from('usuarios').select('id').eq('email', organizador_email).limit(1);
      if (byEmail && byEmail.length > 0) {
        finalOrganizadorId = byEmail[0].id;
      } else {
        const { data: created, error: createErr } = await supabase.from('usuarios').insert([{ nombre: organizador_nombre, email: organizador_email, tipo_usuario: 'organizador' }]).select('id').limit(1);
        if (createErr) throw createErr;
        finalOrganizadorId = created && created[0] && created[0].id;
      }
    } else {
      // validar que el id exista y sea organizador
      const { data: orgCheck } = await supabase.from('usuarios').select('tipo_usuario').eq('id', String(finalOrganizadorId)).limit(1);
      if (!orgCheck || orgCheck.length === 0) return NextResponse.json({ success: false, error: 'Organizador no encontrado' }, { status: 404 });
      if (orgCheck[0].tipo_usuario !== 'organizador') return NextResponse.json({ success: false, error: 'El usuario no es un organizador' }, { status: 400 });
    }

    // Verificar permisos: admin o el mismo organizador
    if (sessionUser) {
      const sessId = String(sessionUser.id);
      const sessTipo = sessionUser.tipo_usuario || null;
      const isAdmin = sessTipo === 'admin';
      const isOrganizerUser = finalOrganizadorId && String(finalOrganizadorId) === sessId;
      if (!isAdmin && !isOrganizerUser) return NextResponse.json({ success: false, error: 'No autorizado: debe ser organizador o admin' }, { status: 403 });
    } else {
      // sin sesión requiere organizador explícito (ya resuelto arriba)
      if (!finalOrganizadorId) return NextResponse.json({ success: false, error: 'Autenticación requerida para crear eventos' }, { status: 401 });
    }

    // Comprobar colisión
    const { data: existe } = await supabase.from('eventos').select('id').eq(auditorioColumn, String(auditorio_id)).eq('fecha', fecha).eq('hora_inicio', hora_inicio).limit(1);
    if (existe && existe.length > 0) {
      // devolver conflicto
      const { data: conflict } = await supabase.from('eventos').select(`*, usuarios:usuarios!inner(${organizadorColumn}=id)`)
        .eq('id', existe[0].id).limit(1);
      return NextResponse.json({ success: false, error: 'Ya existe un evento en ese auditorio/fecha/hora', conflict: conflict && conflict[0] ? conflict[0] : null }, { status: 409 });
    }

    // Insertar evento usando columnas detectadas
    const insertObj: any = {
      titulo,
      descripcion,
      fecha,
      hora_inicio,
      hora_fin,
      asistentes_esperados: asistentes_esperados || 0,
      estado: 'confirmado',
      tipo_evento: tipo_evento || null,
      carrera: carrera || null,
    };
    insertObj[auditorioColumn] = String(auditorio_id);
    insertObj[organizadorColumn] = finalOrganizadorId;

    const { data: insertedArr, error: insertErr } = await supabase.from('eventos').insert([insertObj]).select().limit(1);
    if (insertErr) throw insertErr;
    const inserted = insertedArr && insertedArr[0];
    if (!inserted) return NextResponse.json({ success: false, error: 'No se pudo crear el evento' }, { status: 500 });

    // Calcular asistentes registrados (intentar con evento_id y con id_evento)
    let asistentes_registrados = 0;
    const { data: regs1, error: regsErr1 } = await supabase.from('registros_asistentes').select('id').eq('evento_id', inserted.id).eq('estado', 'confirmado');
    if (!regsErr1 && regs1) asistentes_registrados = regs1.length;
    else {
      const { data: regs2, error: regsErr2 } = await supabase.from('registros_asistentes').select('id').eq('id_evento', inserted.id).eq('estado', 'confirmado');
      if (!regsErr2 && regs2) asistentes_registrados = regs2.length;
    }

    // Obtener capacidad_total del auditorio
    const capacidad_total = audCheck.capacidad_total ?? inserted.asistentes_esperados ?? 0;

    // Calcular archivado
    const fechaStr = inserted.fecha instanceof Date ? inserted.fecha.toISOString().substring(0,10) : String(inserted.fecha).substring(0,10);
    const horaFinStr = (inserted.hora_fin || hora_fin || '').toString().substring(0,5) || '23:59';
    const end = new Date(`${fechaStr}T${horaFinStr}:00`);
    const archivado = new Date() > end;

    const mapped = {
      id: inserted.id,
      auditorio: String(inserted[auditorioColumn] ?? auditorio_id),
      fecha: inserted.fecha instanceof Date ? inserted.fecha.toISOString().substring(0,10) : String(inserted.fecha),
      horaInicio: (inserted.hora_inicio || '').toString().substring(0,5),
      horaFin: (inserted.hora_fin || '').toString().substring(0,5),
      titulo: inserted.titulo,
      organizador: null,
      organizadorId: inserted[organizadorColumn],
      descripcion: inserted.descripcion || '',
      asistentes: inserted.asistentes_esperados || 0,
      asistentes_registrados: Number(asistentes_registrados),
      capacidad_total: Number(capacidad_total),
      archivado: Boolean(archivado),
      carrera: inserted.carrera || null,
      presentacion: null,
    };

    // Intentar obtener datos del organizador para incluir nombre/email
    const { data: orgData } = await supabase.from('usuarios').select('id,nombre,email').eq('id', mapped.organizadorId).limit(1);
    if (orgData && orgData.length > 0) {
      mapped.organizador = orgData[0].nombre || null;
      mapped.organizador_email = orgData[0].email || null;
    }

    // Emitir evento Socket.IO para sincronización en tiempo real
    const { broadcastEvent } = await import('@/lib/socketServer');
    await broadcastEvent('evento:creado', mapped);

    return NextResponse.json({ success: true, evento: mapped }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating evento:', error);
    return NextResponse.json({ success: false, error: error?.message || String(error) || 'Error al crear evento' }, { status: 500 });
  }
}
