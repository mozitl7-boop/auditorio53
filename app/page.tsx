"use client";

import { useState, useCallback, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { initSocket } from "@/lib/socket";
import { FormularioReserva } from "@/components/formulario-reserva";
import { Calendario } from "@/components/vista-calendario";
import { ListaReservas } from "@/components/lista-reservas";
import { EstadoAuditorio } from "@/components/estado-auditorio";
import { VistaAsistente } from "@/components/vista-asistente";
import { MenuSeleccionUsuario } from "@/components/menu-seleccion-usuario";
import { LoginUsuario } from "@/components/login-usuario";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarIcon, List, ArrowLeft } from "lucide-react";

export type Reserva = {
  id: string;
  auditorio: "A" | "B";
  fecha: string;
  horaInicio: string;
  horaFin: string;
  titulo: string;
  organizador: string;
  organizadorId?: string;
  descripcion: string;
  asistentes: number;
  archivado?: boolean;
  carrera?: string;
  presentacion?: string;
};

export type AsistenteRegistrado = {
  id: string;
  reservaId: string;
  nombre: string;
  email: string;
  numeroAsiento: number;
  fechaRegistro: string;
};

export default function Page() {
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [asistentesRegistrados, setAsistentesRegistrados] = useState<
    AsistenteRegistrado[]
  >([]);
  const [asientosConteo, setAsientosConteo] = useState<
    Record<string, { ocupados: number; capacidad: number; auditorio?: string }>
  >({});
  const [fechaSeleccionada, setFechaSeleccionada] = useState(new Date());
  const [modoUsuario, setModoUsuario] = useState<
    "organizador" | "asistente" | null
  >(null);
  const [userIds, setUserIds] = useState<{
    organizador: string | null;
    asistente: string | null;
  }>({ organizador: null, asistente: null });

  const currentUserId =
    modoUsuario === "organizador"
      ? userIds.organizador
      : modoUsuario === "asistente"
      ? userIds.asistente
      : null;

  const agregarReserva = (nuevaReserva: Omit<Reserva, "id">) => {
    const reservaConId: Reserva = {
      ...nuevaReserva,
      id: Math.random().toString(36).substring(2, 9),
      organizadorId: currentUserId || undefined,
    };
    setReservas([...reservas, reservaConId]);
  };

  // Cargar eventos iniciales desde la API al montar
  useEffect(() => {
    let mounted = true;
    async function fetchEventos() {
      try {
        const res = await fetch("/api/eventos");
        const json = await res.json();
        if (mounted && json && json.success && Array.isArray(json.eventos)) {
          const mapped = json.eventos.map((e: any) => ({
            id: e.id,
            auditorio: String(e.id_auditorio),
            fecha: (e.fecha instanceof Date
              ? e.fecha.toISOString().substring(0, 10)
              : String(e.fecha)
            ).substring(0, 10),
            horaInicio: (e.hora_inicio || "").toString().substring(0, 5),
            horaFin: (e.hora_fin || "").toString().substring(0, 5),
            titulo: e.titulo,
            organizador: e.organizador_nombre || e.organizador_email || null,
            organizadorId: e.id_organizador || undefined,
            descripcion: e.descripcion || "",
            asistentes: e.asistentes_esperados || 0,
            archivado: (() => {
              try {
                const fechaStr = (
                  e.fecha instanceof Date
                    ? e.fecha.toISOString().substring(0, 10)
                    : String(e.fecha)
                ).substring(0, 10);
                const horaFin =
                  (e.hora_fin || "").toString().substring(0, 5) || "23:59";
                const end = new Date(`${fechaStr}T${horaFin}:00`);
                return new Date() > end;
              } catch (err) {
                return false;
              }
            })(),
            carrera: e.carrera || null,
            presentacion: null,
          }));
          setReservas(mapped);
          // También recuperar registros existentes para que las nuevas sesiones muestren datos históricos.
          try {
            const rres = await fetch(`/api/registros-asistentes/all`);
            const rjson = await rres.json();
            if (
              mounted &&
              rjson &&
              rjson.success &&
              Array.isArray(rjson.registros)
            ) {
              const regs = rjson.registros.map((row: any) => ({
                id: row.id,
                reservaId: row.id_evento,
                nombre: row.nombre || row.asistente_nombre || "",
                email: row.email || row.asistente_email || "",
                numeroAsiento: row.numero_orden || 0,
                fechaRegistro:
                  row.fecha_registro ||
                  row.fechaRegistro ||
                  new Date().toISOString(),
              }));
              setAsistentesRegistrados(regs);
            }
          } catch (err) {
            console.error("Error fetching initial registros:", err);
          }
        }
      } catch (err) {
        console.error("Error fetching eventos iniciales:", err);
      }
    }

    fetchEventos();
    return () => {
      mounted = false;
    };
  }, []);

  // Escuchar registros entrantes por socket para actualizar conteo en tiempo real
  useEffect(() => {
    const socket = initSocket();

    const handleRegistro = (row: any) => {
      try {
        // Normalizar posibles variantes de nombres desde el backend
        const id = row.id || row.registro_id || row.id_asistente || null;
        const reservaId =
          row.id_evento ||
          row.eventoId ||
          row.reservaId ||
          row.reserva_id ||
          null;
        const nombre = row.nombre || row.name || row.nombre_asistente || "";
        const email = row.email || row.correo || row.email_asistente || "";
        const numeroAsiento =
          (typeof row.numeroAsiento === "number" && row.numeroAsiento) ||
          (typeof row.numero_orden === "number" && row.numero_orden) ||
          (typeof row.numero === "number" && row.numero) ||
          0;
        const fechaRegistro =
          row.fechaRegistro || row.fecha_registro || new Date().toISOString();

        const nuevo: AsistenteRegistrado = {
          id: id || String(Math.random().toString(36).substring(2, 9)),
          reservaId: reservaId || String(row.eventoId || row.reservaId || ""),
          nombre,
          email,
          numeroAsiento,
          fechaRegistro,
        };

        setAsistentesRegistrados((prev) => {
          if (prev.some((p) => p.id === nuevo.id)) return prev;
          return [...prev, nuevo];
        });
      } catch (err) {
        console.error("Error al procesar registro en socket:", err);
      }
    };

    socket.on("asistente:registrado", handleRegistro);

    // Manejar eventos de creación de eventos (reservas) en tiempo real
    const handleEventoCreado = (e: any) => {
      try {
        const mapped: Reserva = {
          id: e.id || e.id || e.id_evento || e.eventoId || e.reservaId,
          auditorio: String(e.id_auditorio || e.auditorio || "A") as "A" | "B",
          fecha: (e.fecha instanceof Date
            ? e.fecha.toISOString().substring(0, 10)
            : String(e.fecha || "")
          ).substring(0, 10),
          horaInicio: (e.hora_inicio || e.horaInicio || "")
            .toString()
            .substring(0, 5),
          horaFin: (e.hora_fin || e.horaFin || "").toString().substring(0, 5),
          titulo: e.titulo || e.title || "",
          organizador:
            e.organizador_nombre ||
            e.organizador ||
            e.organizador_email ||
            null,
          organizadorId: e.id_organizador || e.organizadorId || undefined,
          descripcion: e.descripcion || e.description || "",
          asistentes: e.asistentes_esperados || e.asistentes || 0,
          archivado: (() => {
            try {
              const fechaStr = (
                e.fecha instanceof Date
                  ? e.fecha.toISOString().substring(0, 10)
                  : String(e.fecha || "")
              ).substring(0, 10);
              const horaFin =
                (e.hora_fin || e.horaFin || "").toString().substring(0, 5) ||
                "23:59";
              const end = new Date(`${fechaStr}T${horaFin}:00`);
              return new Date() > end;
            } catch (err) {
              return false;
            }
          })(),
          carrera: e.carrera || null,
          presentacion: null,
        };

        setReservas((prev) => {
          if (prev.some((r) => r.id === mapped.id)) return prev;
          return [...prev, mapped];
        });
      } catch (err) {
        console.error("Error al procesar evento creado socket:", err);
      }
    };

    // Manejar evento eliminado: remover de la lista local
    const handleEventoEliminado = (payload: any) => {
      try {
        const id = payload && (payload.id || payload.eventoId || payload.reservaId);
        if (!id) return;
        setReservas((prev) => prev.filter((r) => r.id !== id));
        setAsistentesRegistrados((prev) => prev.filter((a) => a.reservaId !== id));
      } catch (err) {
        console.error("Error procesando evento:eliminado socket:", err);
      }
    };

    socket.on("evento:creado", handleEventoCreado);
    socket.on("evento:eliminado", handleEventoEliminado);

    // Escuchar conteos agregados emitidos por el servidor
    const handleConteo = (payload: any) => {
      try {
        const eventoId =
          payload.reservaId || payload.eventoId || payload.id_evento;
        if (!eventoId) return;
        const ocupados = Number(payload.ocupados || 0);
        const capacidad = Number(
          payload.capacidad || payload.capacidad_total || 0
        );
        const auditorio =
          payload.auditorio || payload.id_auditorio || undefined;
        setAsientosConteo((prev) => ({
          ...prev,
          [eventoId]: { ocupados, capacidad, auditorio },
        }));
      } catch (err) {
        console.error("Error procesando asientos:conteo socket:", err);
      }
    };

    socket.on("asientos:conteo", handleConteo);

    // Solicitar al servidor el estado inicial de registros para poblar la UI
    let poller: any = null;
    const handleConnect = () => {
      // cuando el realtime se conecta, detener el poller si existe
      try {
        if (poller) {
          clearInterval(poller);
          poller = null;
        }
      } catch (e) {
        // ignore
      }
    };

    try {
      // registrar listener para que, si el socket se conecta después, pare el poller
      socket.on("connect", handleConnect);

      if (!socket.connected) {
        // comprobar visibilidad de la página: no pollear si la pestaña está oculta
        const shouldStart =
          typeof document !== "undefined" ? !document.hidden : true;
        if (shouldStart) {
          poller = setInterval(async () => {
            try {
              // si la pestaña está oculta, saltar esta iteración
              if (typeof document !== "undefined" && document.hidden) return;

              const [eresp, rresp] = await Promise.all([
                fetch("/api/eventos"),
                fetch("/api/registros-asistentes/all"),
              ]);
              if (eresp.ok) {
                const ej = await eresp.json();
                if (ej && Array.isArray(ej.eventos)) {
                  const mapped = ej.eventos.map((e: any) => ({
                    id: e.id,
                    auditorio: String(e.id_auditorio),
                    fecha: (e.fecha instanceof Date
                      ? e.fecha.toISOString().substring(0, 10)
                      : String(e.fecha)
                    ).substring(0, 10),
                    horaInicio: (e.hora_inicio || "")
                      .toString()
                      .substring(0, 5),
                    horaFin: (e.hora_fin || "").toString().substring(0, 5),
                    titulo: e.titulo,
                    organizador:
                      e.organizador_nombre || e.organizador_email || null,
                    organizadorId: e.id_organizador || undefined,
                    descripcion: e.descripcion || "",
                    asistentes: e.asistentes_esperados || 0,
                    archivado: (() => {
                      try {
                        const fechaStr = (
                          e.fecha instanceof Date
                            ? e.fecha.toISOString().substring(0, 10)
                            : String(e.fecha)
                        ).substring(0, 10);
                        const horaFin =
                          (e.hora_fin || "").toString().substring(0, 5) ||
                          "23:59";
                        const end = new Date(`${fechaStr}T${horaFin}:00`);
                        return new Date() > end;
                      } catch (err) {
                        return false;
                      }
                    })(),
                    carrera: e.carrera || null,
                    presentacion: null,
                  }));
                  // Combinar sin duplicar
                  setReservas((prev) => {
                    const ids = new Set(prev.map((p) => p.id));
                    const merged = [...prev];
                    mapped.forEach((m: any) => {
                      if (!ids.has(m.id)) merged.push(m);
                    });
                    return merged;
                  });
                }
              }

              if (rresp.ok) {
                const rj = await rresp.json();
                if (rj && Array.isArray(rj.registros)) {
                  const regs = rj.registros.map((row: any) => ({
                    id: row.id,
                    reservaId: row.id_evento,
                    nombre: row.nombre || row.asistente_nombre || "",
                    email: row.email || row.asistente_email || "",
                    numeroAsiento: row.numero_orden || 0,
                    fechaRegistro:
                      row.fecha_registro ||
                      row.fechaRegistro ||
                      new Date().toISOString(),
                  }));
                  setAsistentesRegistrados((prev) => {
                    const ids = new Set(prev.map((p) => p.id));
                    const merged = [...prev];
                    regs.forEach((r: any) => {
                      if (!ids.has(r.id)) merged.push(r);
                    });
                    return merged;
                  });
                }
              }
            } catch (e) {
              // ignorar errores de sondeo
            }
          }, 5000);
        }
      }
    } catch (e) {
      // ignorar
    }

    return () => {
      socket.off("asistente:registrado", handleRegistro);
      socket.off("evento:creado", handleEventoCreado);
      socket.off("evento:eliminado", handleEventoEliminado);
      socket.off("asientos:conteo", handleConteo);
      if (poller) clearInterval(poller);
    };
  }, []);

  const eliminarReserva = async (id: string, organizerId?: string) => {
    try {
      // Preferir el ID del usuario actual; si no existe (modo dev) usar el organizerId
      // TEMP LOG: verificar que el handler del cliente se ejecute al hacer click
      console.info("Client handler eliminarReserva called", {
        id,
        organizerId,
        currentUserId,
      });
      const callerId = currentUserId || organizerId || null;
      if (!callerId) {
        console.warn("No hay usuario disponible para eliminar reserva");
        return false;
      }
      console.info("Deleting evento", { id, callerId });
      const res = await fetch(`/api/eventos/${id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-usuario-id": String(callerId || ""),
        },
        body: JSON.stringify({ usuario_id: callerId }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok || !json.success) {
        console.error("Error eliminando reserva:", json.error || json);
        return false;
      }

      // Actualizar estado localmente solo si el servidor confirmó la eliminación
      setReservas((prev) => prev.filter((reserva) => reserva.id !== id));
      setAsistentesRegistrados((prev) =>
        prev.filter((asistente) => asistente.reservaId !== id)
      );
      return true;
    } catch (err) {
      console.error("Error eliminando reserva:", err);
      return false;
    }
  };

  const eliminarAsistente = async (reservaId: string, asistenteId: string) => {
    try {
      // Determinar el identificador de llamada: dar preferencia al identificador del organizador de la reserva (valor del lado del servidor).
      // TEMP LOG: verificar que el handler del cliente se ejecute al hacer click
      console.info("Client handler eliminarAsistente called", {
        reservaId,
        asistenteId,
        currentUserId,
      });
      const reserva = reservas.find((r) => r.id === reservaId);
      const callerId = reserva?.organizadorId || currentUserId || null;

      console.info("Deleting asistente", {
        reservaId,
        asistenteId,
        callerId,
      });
      const res = await fetch(`/api/registros-asistentes/${reservaId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-usuario-id": String(callerId || ""),
        },
        body: JSON.stringify({
          registroId: asistenteId,
          usuario_id: callerId,
        }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok || !json.success) {
        console.error(
          "Error eliminando asistente en servidor:",
          json.error || json
        );
        return false;
      }

      // También recuperar registros para esta reserva desde el servidor para mantener la UI consistente
      try {
        const rres = await fetch(`/api/registros-asistentes/${reservaId}`);
        const rjson = await rres.json();
        if (rres.ok && rjson && Array.isArray(rjson.registros)) {
          const regs = rjson.registros.map((row: any) => ({
            id: row.id,
            reservaId: row.id_evento,
            nombre: row.nombre || row.asistente_nombre || "",
            email: row.email || row.asistente_email || "",
            numeroAsiento: row.numero_orden || 0,
            fechaRegistro:
              row.fecha_registro ||
              row.fechaRegistro ||
              new Date().toISOString(),
          }));
          setAsistentesRegistrados((prev) => {
            // mantener intactos los registros de otras reservas, sustituir los de esta reserva
            const others = prev.filter((p) => p.reservaId !== reservaId);
            return [...others, ...regs];
          });
        } else {
          // fallback: eliminar localmente
          setAsistentesRegistrados((prev) =>
            prev.filter((a) => a.id !== asistenteId)
          );
        }
      } catch (e) {
        setAsistentesRegistrados((prev) =>
          prev.filter((a) => a.id !== asistenteId)
        );
      }
      return true;
    } catch (err) {
      console.error("Error eliminando asistente:", err);
      return false;
    }
  };

  const registrarAsistente = useCallback(
    (reservaId: string, nombre: string, email: string) => {
      return (async () => {
        const reserva = reservas.find((r) => r.id === reservaId);
        if (!reserva) return { exito: false, mensaje: "Evento no encontrado" };

        try {
          // usar el ID de asistente generado por la selección de usuario (userIds.asistente)
          const asistenteId =
            userIds.asistente || Math.random().toString(36).substring(2, 9);

          const res = await fetch(`/api/registros-asistentes/${reservaId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id_asistente: asistenteId, nombre, email }),
          });

          const json = await res.json();
          if (!res.ok) {
            return {
              exito: false,
              mensaje: json.error || "Error al registrar",
            };
          }

          const row = json.registro;

          // Después de crear el registro en el servidor, refrescar la lista
          // completa de registros para este evento desde la API para asegurar
          // que la UI quede consistente incluso si el realtime no está activo.
          try {
            const rres = await fetch(`/api/registros-asistentes/${reservaId}`);
            const rjson = await rres.json();
            if (rres.ok && rjson && Array.isArray(rjson.registros)) {
              const regs = rjson.registros.map((row: any) => ({
                id: row.id,
                reservaId: row.id_evento,
                nombre: row.nombre || row.asistente_nombre || "",
                email: row.email || row.asistente_email || "",
                numeroAsiento: row.numero_orden || 0,
                fechaRegistro:
                  row.fecha_registro ||
                  row.fechaRegistro ||
                  new Date().toISOString(),
              }));
              setAsistentesRegistrados(regs);
              // Obtener el asiento asignado para el mensaje de confirmación
              const nuevo =
                regs.find(
                  (r) => r.email === (row.email || "") || r.id === row.id
                ) || regs[regs.length - 1];
              return {
                exito: true,
                mensaje: `Asiento ${
                  nuevo ? nuevo.numeroAsiento : row.numero_orden || 0
                } asignado exitosamente`,
                asiento: nuevo ? nuevo.numeroAsiento : row.numero_orden || 0,
              };
            }
          } catch (err) {
            console.error("Error refrescando registros después de POST:", err);
          }

          // Fallback: si no pudimos refrescar, usar el registro devuelto por la API
          const nuevoFallback: AsistenteRegistrado = {
            id: row.id,
            reservaId: row.id_evento,
            nombre: row.nombre,
            email: row.email,
            numeroAsiento: row.numero_orden || 0,
            fechaRegistro: row.fecha_registro || new Date().toISOString(),
          };

          setAsistentesRegistrados((prev) => [...prev, nuevoFallback]);

          return {
            exito: true,
            mensaje: `Asiento ${nuevoFallback.numeroAsiento} asignado exitosamente`,
            asiento: nuevoFallback.numeroAsiento,
          };
        } catch (err: any) {
          console.error("Error registrando asistente:", err);
          return { exito: false, mensaje: err.message || "Error" };
        }
      })();
    },
    [reservas, asistentesRegistrados, userIds]
  );

  if (modoUsuario === null) {
    return (
      <div>
        <div className="container mx-auto px-4 py-6">
          <LoginUsuario
            onSelect={(user) => {
              // Configurar el modo según el tipo de usuario
              if (user.tipo_usuario === "organizador") {
                setUserIds((prev) => ({
                  ...prev,
                  organizador: String(user.id),
                }));
                setModoUsuario("organizador");
              } else if (user.tipo_usuario === "asistente") {
                setUserIds((prev) => ({ ...prev, asistente: String(user.id) }));
                setModoUsuario("asistente");
              } else if (user.tipo_usuario === "admin") {
                // los administradores ven la interfaz de organizador
                setUserIds((prev) => ({
                  ...prev,
                  organizador: String(user.id),
                }));
                setModoUsuario("organizador");
              } else {
                // fallback a asistente
                setUserIds((prev) => ({ ...prev, asistente: String(user.id) }));
                setModoUsuario("asistente");
              }
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="w-full px-6 py-6">
        <header className="mb-6">
          <h1 className="text-4xl font-bold mb-2 text-center bg-linear-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">
            Sistema de Reservas - Auditorios del 53
          </h1>
          <p className="text-sm text-gray-600">
            {modoUsuario === "organizador"
              ? "Modo: Organizador"
              : "Modo: Asistente"}
          </p>
        </header>

        <div className="mb-6">
          <EstadoAuditorio
            reservas={reservas}
            fechaSeleccionada={fechaSeleccionada}
            asistentesRegistrados={asistentesRegistrados}
            asientosConteo={asientosConteo}
          />
        </div>

        {modoUsuario === "organizador" ? (
          <div className="grid lg:grid-cols-[380px_1fr] gap-4">
            <div>
              <FormularioReserva
                alEnviar={agregarReserva}
                reservas={reservas}
                fechaSeleccionada={fechaSeleccionada}
              />
            </div>

            <div>
              <Tabs
                defaultValue="calendario"
                className="w-full"
                key="organizador-tabs"
              >
                <TabsList className="grid w-full grid-cols-2 mb-4 bg-gray-100 rounded-lg p-1 shadow">
                  <TabsTrigger
                    value="calendario"
                    className="flex items-center gap-2 rounded data-[state=active]:bg-linear-to-b data-[state=active]:from-blue-500 data-[state=active]:to-blue-600 data-[state=active]:text-white data-[state=active]:shadow font-medium transition-all text-sm"
                  >
                    <CalendarIcon className="w-4 h-4" />
                    Calendario
                  </TabsTrigger>
                  <TabsTrigger
                    value="lista"
                    className="flex items-center gap-2 rounded data-[state=active]:bg-linear-to-b data-[state=active]:from-purple-500 data-[state=active]:to-purple-600 data-[state=active]:text-white data-[state=active]:shadow font-medium transition-all text-sm"
                  >
                    <List className="w-4 h-4" />
                    Lista
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="calendario">
                  <Calendario
                    reservas={reservas}
                    fechaSeleccionada={fechaSeleccionada}
                    alCambiarFecha={setFechaSeleccionada}
                  />
                </TabsContent>

                <TabsContent value="lista">
                  <ListaReservas
                    reservas={reservas}
                    alEliminar={eliminarReserva}
                    alEliminarAsistente={eliminarAsistente}
                    asistentesRegistrados={asistentesRegistrados}
                    usuarioActualId={currentUserId}
                    modoUsuario={modoUsuario}
                  />
                </TabsContent>
              </Tabs>
            </div>
          </div>
        ) : (
          <VistaAsistente
            reservas={reservas}
            asistentesRegistrados={asistentesRegistrados}
            onRegisterAttendee={registrarAsistente}
          />
        )}
      </div>
    </div>
  );
}
