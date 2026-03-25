"use client";

import type React from "react";
import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { Reserva } from "@/app/page";
import {
  CalendarIcon,
  AlertCircle,
  CheckCircle2,
  Clock,
  Users,
  FileText,
  Upload,
} from "lucide-react";
import { crearValidadorReservas } from "@/lib/validacion-reservas";

type PropiedadesFormularioReserva = {
  alEnviar: (reserva: Omit<Reserva, "id">) => void;
  reservas: Reserva[];
  fechaSeleccionada: Date;
};

export function FormularioReserva({
  alEnviar,
  reservas,
  fechaSeleccionada,
}: PropiedadesFormularioReserva) {
  const { toast } = useToast();

  const [organizadores, setOrganizadores] = useState<
    {
      id: string;
      nombre: string;
      email: string;
    }[]
  >([]);
  const [organizadorId, setOrganizadorId] = useState<string>("");
  const [organizadorLibre, setOrganizadorLibre] = useState<boolean>(false);
  const [enviando, setEnviando] = useState(false);

  const formatearFechaLocal = (fecha: Date) => {
    const year = fecha.getFullYear();
    const month = String(fecha.getMonth() + 1).padStart(2, "0");
    const day = String(fecha.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const obtenerFechaMinima = () => {
    const ahora = new Date();
    const horaActual = ahora.getHours();

    // Si son las 4 PM o después, la fecha mínima es mañana
    if (horaActual >= 16) {
      const manana = new Date(ahora);
      manana.setDate(manana.getDate() + 1);
      return formatearFechaLocal(manana);
    }

    // Si es antes de las 4 PM, puede ser hoy
    return formatearFechaLocal(ahora);
  };

  const [datosFormulario, establecerDatosFormulario] = useState({
    auditorio: "A" as "A" | "B",
    fecha: obtenerFechaMinima(),
    horaInicio: "09:00",
    titulo: "",
    organizador: "",
    organizador_email: "",
    descripcion: "",
    asistentes: "",
    carrera: "no-especificado",
    presentacion: "",
  });

  const [mostrarHorariosDisponibles, establecerMostrarHorariosDisponibles] =
    useState(false);

  useEffect(() => {
    const fechaMinima = obtenerFechaMinima();
    const fechaFormularioFormato = formatearFechaLocal(fechaSeleccionada);

    // Si la fecha seleccionada en el calendario es válida, actualizar formulario
    if (fechaFormularioFormato >= fechaMinima) {
      establecerDatosFormulario((prev) => ({
        ...prev,
        fecha: fechaFormularioFormato,
      }));
    } else {
      // Si la fecha seleccionada es inválida, usar la fecha mínima
      establecerDatosFormulario((prev) => ({
        ...prev,
        fecha: fechaMinima,
      }));
    }
  }, [fechaSeleccionada]);

  // Obtener organizadores disponibles
  useEffect(() => {
    let mounted = true;
    async function fetchOrganizadores() {
      try {
        const res = await fetch("/api/usuarios/organizadores");
        const text = await res.text();
        let data: any;
        try {
          data = text ? JSON.parse(text) : {};
        } catch (e) {
          console.error("Organizadores: respuesta no-JSON:", text);
          data = { success: false, error: "Respuesta no JSON del servidor", raw: text };
        }

        if (mounted && data && data.success) {
          setOrganizadores(data.organizadores || []);
          if (data.organizadores && data.organizadores.length > 0) {
            setOrganizadorId(data.organizadores[0].id);
          }
        } else if (mounted) {
          console.warn("No se obtuvieron organizadores:", data && data.error ? data.error : data);
        }
      } catch (err) {
        console.error("Error fetching organizadores:", err);
      }
    }
    fetchOrganizadores();
    return () => {
      mounted = false;
    };
  }, []);
  const manejarEnvio = async (e: React.FormEvent) => {
    e.preventDefault();

    // Protección contra doble envío
    if (enviando) {
      return;
    }

    // Validar que la fecha sea >= fecha mínima
    const fechaMinima = obtenerFechaMinima();
    if (datosFormulario.fecha < fechaMinima) {
      toast({
        title: "Fecha inválida",
        description:
          "No se pueden hacer reservas para hoy después de las 4:00 PM. Selecciona mañana o una fecha posterior.",
        variant: "destructive",
      });
      return;
    }

    const [hora, minuto] = datosFormulario.horaInicio.split(":").map(Number);
    const horaFin = hora + 1;
    const horaFinTexto = `${String(horaFin).padStart(2, "0")}:${String(
      minuto
    ).padStart(2, "0")}`;

    const validador = crearValidadorReservas(reservas);
    const validacion = validador.validar({
      auditorio: datosFormulario.auditorio,
      fecha: datosFormulario.fecha,
      horaInicio: datosFormulario.horaInicio,
      asistentes: Number.parseInt(datosFormulario.asistentes) || 0,
      titulo: datosFormulario.titulo,
    });

    if (!validacion.esValido) {
      toast({
        title: "Error de validación",
        description: validacion.error,
        variant: "destructive",
      });
      return;
    }

    if (validacion.advertencias && validacion.advertencias.length > 0) {
      validacion.advertencias.forEach((advertencia) => {
        toast({
          title: "Advertencia",
          description: advertencia,
          variant: "default",
        });
      });
    }

    try {
      // Crear evento en la BD
      const response = await fetch("/api/eventos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          // auditorio_id debe ser el id de auditorios ('A' o 'B')
          id_auditorio: datosFormulario.auditorio,
          // enviar el organizador seleccionado (UUID) o el nombre si es libre
          id_organizador: organizadorId || null,
          organizador_nombre: !organizadorId
            ? datosFormulario.organizador
            : null,
          organizador_email: !organizadorId
            ? datosFormulario.organizador_email
            : null,
          titulo: datosFormulario.titulo,
          descripcion: datosFormulario.descripcion,
          fecha: datosFormulario.fecha,
          hora_inicio: datosFormulario.horaInicio,
          hora_fin: horaFinTexto,
          asistentes_esperados:
            Number.parseInt(datosFormulario.asistentes) || 0,
          tipo_evento:
            datosFormulario.carrera === "no-especificado"
              ? null
              : datosFormulario.carrera,
          carrera:
            datosFormulario.carrera === "no-especificado"
              ? null
              : datosFormulario.carrera,
        }),
      });

      const result = await response.json();

      if (result.success) {
        toast({
          title: "Reserva creada",
          description: `${datosFormulario.titulo} reservado exitosamente.`,
        });

        // Informar al componente padre para que actualice la lista sin necesitar F5
        try {
          if (typeof alEnviar === "function") {
            // Usar el objeto `evento` devuelto por el servidor si está disponible
            const nuevoEvento = result.evento
              ? {
                  id: result.evento.id,
                  auditorio: String(result.evento.id_auditorio || result.evento.auditorio || datosFormulario.auditorio) as "A" | "B",
                  fecha: (result.evento.fecha || datosFormulario.fecha).substring(0, 10),
                  horaInicio: (result.evento.hora_inicio || datosFormulario.horaInicio).toString().substring(0, 5),
                  horaFin: (result.evento.hora_fin || horaFinTexto).toString().substring(0, 5),
                  titulo: result.evento.titulo || datosFormulario.titulo,
                  organizador: result.evento.organizador_nombre || datosFormulario.organizador || null,
                  organizadorId: result.evento.id_organizador || organizadorId || undefined,
                  descripcion: result.evento.descripcion || datosFormulario.descripcion || "",
                  asistentes: Number((result.evento.asistentes_esperados ?? Number.parseInt(datosFormulario.asistentes)) || 0),
                  archivado: result.evento.archivado || false,
                  carrera: result.evento.carrera || datosFormulario.carrera || null,
                  presentacion: null,
                }
              : {
                  auditorio: datosFormulario.auditorio,
                  fecha: datosFormulario.fecha,
                  horaInicio: datosFormulario.horaInicio,
                  horaFin: horaFinTexto,
                  titulo: datosFormulario.titulo,
                  organizador: datosFormulario.organizador || null,
                  descripcion: datosFormulario.descripcion || "",
                  asistentes: Number.parseInt(datosFormulario.asistentes) || 0,
                  carrera: datosFormulario.carrera || null,
                };

            // Llamar al callback para que el UI padre actualice su estado inmediatamente
            alEnviar(nuevoEvento as any);
          }
        } catch (e) {
          // No bloquear el flujo si falla el callback
          console.warn("alEnviar callback failed:", e);
        }

        // Limpiar formulario
        establecerDatosFormulario({
          auditorio: "A",
          fecha: obtenerFechaMinima(),
          horaInicio: "09:00",
          titulo: "",
          organizador: "",
          organizador_email: "",
          descripcion: "",
          asistentes: "",
          carrera: "no-especificado",
          presentacion: "",
        });
      } else {
        // Si es conflicto (409) el servidor ahora devuelve `conflict` con el evento
        if (response.status === 409 && result.conflict) {
          const c = result.conflict;
          toast({
            title: "Horario no disponible",
            description: `Ya existe '${c.titulo}' por ${
              c.organizador_nombre || c.organizador_email
            } a las ${c.hora_inicio?.substring(0, 5)}`,
            variant: "destructive",
          });

          // Solicitar sugerencias de horarios libres (3) y mostrarlas si hay
          try {
            const sugRes = await fetch(
              `/api/eventos/horarios-libres?auditorio_id=${datosFormulario.auditorio}&fecha=${datosFormulario.fecha}&limit=3`
            );
            const sugJson = await sugRes.json();
            if (
              sugJson &&
              sugJson.success &&
              Array.isArray(sugJson.slots) &&
              sugJson.slots.length > 0
            ) {
              toast({
                title: "Horarios alternativos",
                description: `Disponibles: ${sugJson.slots.join(", ")}`,
              });
            }
          } catch (err) {
            // No crítico
            console.error("Error fetching suggestions:", err);
          }
        } else {
          toast({
            title: "Error al crear reserva",
            description: result.error || "Error desconocido",
            variant: "destructive",
          });
        }
      }
    } catch (error) {
      console.error("Error creando reserva:", error);
      toast({
        title: "Error al crear reserva",
        description: "Error de conexión",
        variant: "destructive",
      });
    }
  };

  const obtenerHorariosDisponibles = () => {
    const validador = crearValidadorReservas(reservas);
    return validador.obtenerHorariosDisponibles(
      datosFormulario.auditorio,
      datosFormulario.fecha
    );
  };

  const esHorarioDisponible = (hora: string) => {
    const validador = crearValidadorReservas(reservas);
    return validador.estaHorarioDisponible(
      datosFormulario.auditorio,
      datosFormulario.fecha,
      hora
    );
  };

  const capacidadMaxima = datosFormulario.auditorio === "A" ? 168 : 168;
  const porcentajeCapacidad = datosFormulario.asistentes
    ? (Number.parseInt(datosFormulario.asistentes) / capacidadMaxima) * 100
    : 0;

  return (
    <Card className="p-6 sticky top-4 rounded-2xl shadow-xl bg-white/80 backdrop-blur-sm">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b-2 border-gray-200">
        <div className="p-2 bg-linear-to-br from-blue-500 to-cyan-500 rounded-lg shadow-md">
          <CalendarIcon className="w-6 h-6 text-white" />
        </div>
        <h2 className="text-2xl font-semibold">Nueva Reserva</h2>
      </div>

      <form onSubmit={manejarEnvio} className="space-y-5">
        <p className="text-xs text-gray-500">
          Nota: no necesitas presionar <strong>F5</strong>; la lista se actualizará automáticamente.
        </p>
        <div>
          <Label className="text-base font-semibold mb-3 block">
            Auditorio
          </Label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() =>
                establecerDatosFormulario({
                  ...datosFormulario,
                  auditorio: "A",
                })
              }
              className={`p-4 rounded-xl transition-all font-semibold shadow-md hover:shadow-lg ${
                datosFormulario.auditorio === "A"
                  ? "bg-linear-to-b from-blue-500 to-blue-600 text-white scale-105"
                  : "bg-white hover:bg-blue-50 border-2 border-gray-200"
              }`}
            >
              <div className="text-center">
                <div className="text-3xl">A</div>
                <div className="text-xs mt-1">168 personas</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() =>
                establecerDatosFormulario({
                  ...datosFormulario,
                  auditorio: "B",
                })
              }
              className={`p-4 rounded-xl transition-all font-semibold shadow-md hover:shadow-lg ${
                datosFormulario.auditorio === "B"
                  ? "bg-linear-to-b from-purple-500 to-purple-600 text-white scale-105"
                  : "bg-white hover:bg-purple-50 border-2 border-gray-200"
              }`}
            >
              <div className="text-center">
                <div className="text-3xl">B</div>
                <div className="text-xs mt-1">168 personas</div>
              </div>
            </button>
          </div>
        </div>

        <div>
          <Label htmlFor="fecha" className="text-base font-semibold">
            Fecha
          </Label>
          <Input
            id="fecha"
            type="date"
            value={datosFormulario.fecha}
            onChange={(e) =>
              establecerDatosFormulario({
                ...datosFormulario,
                fecha: e.target.value,
              })
            }
            min={obtenerFechaMinima()}
            className="mt-2 rounded-lg shadow-sm"
            required
          />
          <p className="text-xs text-gray-600 mt-1.5 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Después de las 4:00 PM no se permiten reservas para el mismo día
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <Label
              htmlFor="horaInicio"
              className="text-base font-semibold flex items-center gap-2"
            >
              <Clock className="w-4 h-4" />
              Hora
            </Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                establecerMostrarHorariosDisponibles(
                  !mostrarHorariosDisponibles
                )
              }
              className="text-xs h-auto py-1 px-3 rounded-lg font-medium hover:bg-blue-50"
            >
              {mostrarHorariosDisponibles ? "Ocultar" : "Ver horarios"}
            </Button>
          </div>
          <Input
            id="horaInicio"
            type="time"
            value={datosFormulario.horaInicio}
            onChange={(e) =>
              establecerDatosFormulario({
                ...datosFormulario,
                horaInicio: e.target.value,
              })
            }
            min="07:00"
            max="16:00"
            className="mt-1 rounded-lg shadow-sm"
            required
          />
          <p className="text-xs text-gray-600 mt-1.5 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Duración: 1 hora (7AM - 5PM)
          </p>

          {mostrarHorariosDisponibles && (
            <div className="mt-3 p-4 bg-blue-50 rounded-xl shadow-sm">
              <p className="text-sm font-semibold mb-3">
                Horarios disponibles:
              </p>
              <div className="grid grid-cols-3 gap-2">
                {obtenerHorariosDisponibles().map((ranura) => (
                  <Button
                    key={ranura}
                    type="button"
                    variant={
                      datosFormulario.horaInicio === ranura
                        ? "default"
                        : "outline"
                    }
                    size="sm"
                    onClick={() =>
                      establecerDatosFormulario({
                        ...datosFormulario,
                        horaInicio: ranura,
                      })
                    }
                    className={`text-xs h-9 font-medium rounded-lg shadow-sm ${
                      datosFormulario.horaInicio === ranura
                        ? "bg-linear-to-b from-blue-500 to-blue-600 text-white"
                        : "bg-white hover:bg-blue-100"
                    }`}
                  >
                    {ranura}
                  </Button>
                ))}
              </div>
              {obtenerHorariosDisponibles().length === 0 && (
                <div className="text-center py-4">
                  <AlertCircle className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                  <p className="text-sm font-medium text-gray-600">
                    No hay horarios disponibles
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <Label htmlFor="titulo" className="text-base font-semibold">
            Título del Evento
          </Label>
          <Input
            id="titulo"
            value={datosFormulario.titulo}
            onChange={(e) =>
              establecerDatosFormulario({
                ...datosFormulario,
                titulo: e.target.value,
              })
            }
            placeholder="Nombre del evento"
            className="mt-2 rounded-lg shadow-sm"
            required
          />
        </div>

        <div>
          <Label className="text-base font-semibold">Organizador</Label>
          {organizadores && organizadores.length > 0 ? (
            <div className="mt-2">
              <Select
                value={organizadorId}
                onValueChange={(val) => {
                  if (val === "otro") {
                    setOrganizadorId("");
                    setOrganizadorLibre(true);
                  } else {
                    setOrganizadorId(val);
                    setOrganizadorLibre(false);
                  }
                }}
              >
                <SelectTrigger className="rounded-lg shadow-sm">
                  <SelectValue placeholder="Selecciona un organizador" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="otro">Otro (ingresar nombre)</SelectItem>
                  {organizadores.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.nombre} — {o.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500 mt-1">
                Selecciona un organizador existente o elige "Otro" para escribir
                uno.
              </p>
              {organizadorLibre && (
                <div className="mt-2 space-y-2">
                  <Input
                    id="organizador"
                    value={datosFormulario.organizador}
                    onChange={(e) =>
                      establecerDatosFormulario({
                        ...datosFormulario,
                        organizador: e.target.value,
                      })
                    }
                    placeholder="Nombre del organizador"
                    className="rounded-lg shadow-sm"
                    required
                  />
                  <Input
                    id="organizador_email"
                    type="email"
                    value={datosFormulario.organizador_email}
                    onChange={(e) =>
                      establecerDatosFormulario({
                        ...datosFormulario,
                        organizador_email: e.target.value,
                      })
                    }
                    placeholder="Email del organizador"
                    className="rounded-lg shadow-sm"
                    required
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              <Input
                id="organizador"
                value={datosFormulario.organizador}
                onChange={(e) =>
                  establecerDatosFormulario({
                    ...datosFormulario,
                    organizador: e.target.value,
                  })
                }
                placeholder="Nombre del organizador"
                className="rounded-lg shadow-sm"
                required
              />
              <Input
                id="organizador_email"
                type="email"
                value={datosFormulario.organizador_email}
                onChange={(e) =>
                  establecerDatosFormulario({
                    ...datosFormulario,
                    organizador_email: e.target.value,
                  })
                }
                placeholder="Email del organizador"
                className="rounded-lg shadow-sm"
                required
              />
            </div>
          )}
        </div>

        <div>
          <Label
            htmlFor="asistentes"
            className="text-base font-semibold flex items-center gap-2"
          >
            <Users className="w-4 h-4" />
            Número de Asistentes
          </Label>
          <Input
            id="asistentes"
            type="number"
            value={datosFormulario.asistentes}
            onChange={(e) =>
              establecerDatosFormulario({
                ...datosFormulario,
                asistentes: e.target.value,
              })
            }
            placeholder="Número de personas"
            min="1"
            max={capacidadMaxima}
            className="mt-2 rounded-lg shadow-sm"
            required
          />
          {datosFormulario.asistentes && (
            <div className="mt-3">
              <div className="flex justify-between text-xs mb-1 font-medium text-gray-600">
                <span>Capacidad</span>
                <span
                  className={
                    porcentajeCapacidad > 100
                      ? "text-red-600"
                      : "text-green-600"
                  }
                >
                  {datosFormulario.asistentes}/{capacidadMaxima}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden shadow-inner">
                <div
                  className={`h-full transition-all duration-300 rounded-full ${
                    porcentajeCapacidad > 100
                      ? "bg-red-500"
                      : "bg-linear-to-r from-green-500 to-green-600"
                  }`}
                  style={{ width: `${Math.min(porcentajeCapacidad, 100)}%` }}
                />
              </div>
              {porcentajeCapacidad > 100 && (
                <div className="flex items-start gap-2 mt-2 text-xs font-medium bg-red-50 text-red-700 p-3 rounded-lg border border-red-200">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    El número de asistentes excede la capacidad máxima del
                    auditorio
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <Label htmlFor="descripcion" className="text-base font-semibold">
            Descripción
          </Label>
          <Textarea
            id="descripcion"
            value={datosFormulario.descripcion}
            onChange={(e) =>
              establecerDatosFormulario({
                ...datosFormulario,
                descripcion: e.target.value,
              })
            }
            placeholder="Detalles adicionales del evento..."
            rows={3}
            className="mt-2 resize-none rounded-lg shadow-sm"
          />
        </div>

        <div>
          <Label className="text-base font-semibold flex items-center gap-2">
            <Users className="w-4 h-4" />
            Carrera
          </Label>
          <Select
            value={datosFormulario.carrera}
            onValueChange={(value) =>
              establecerDatosFormulario({ ...datosFormulario, carrera: value })
            }
          >
            <SelectTrigger className="mt-2 rounded-lg shadow-sm">
              <SelectValue placeholder="Selecciona una carrera" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="no-especificado">Sin especificar</SelectItem>
              <SelectItem value="electronica">
                Ingeniería Electrónica
              </SelectItem>
              <SelectItem value="electrica">Ingeniería Eléctrica</SelectItem>
              <SelectItem value="industrial">Ingeniería Industrial</SelectItem>
              <SelectItem value="mecanica">Ingeniería Mecánica</SelectItem>
              <SelectItem value="logistica">Ingeniería en Logística</SelectItem>
              <SelectItem value="gestion">
                Ingeniería en Gestión Empresarial
              </SelectItem>
              <SelectItem value="tic">Ingeniería en TIC</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label
            htmlFor="presentacion"
            className="text-base font-semibold flex items-center gap-2"
          >
            <FileText className="w-4 h-4" />
            Adjuntar Presentación (PDF)
          </Label>
          <div className="mt-2 relative">
            <input
              id="presentacion"
              type="file"
              accept="application/pdf"
              onChange={(e) => {
                const archivo = e.target.files?.[0];
                if (archivo) {
                  if (archivo.type !== "application/pdf") {
                    toast({
                      title: "Error",
                      description: "Solo se permiten archivos PDF",
                      variant: "destructive",
                    });
                    return;
                  }
                  if (archivo.size > 10 * 1024 * 1024) {
                    toast({
                      title: "Error",
                      description: "El archivo no puede superar 10 MB",
                      variant: "destructive",
                    });
                    return;
                  }
                  establecerDatosFormulario({
                    ...datosFormulario,
                    presentacion: archivo.name,
                  });
                  toast({
                    title: "Archivo seleccionado",
                    description: `${archivo.name} se ha adjuntado exitosamente`,
                  });
                }
              }}
              className="hidden"
            />
            <label
              htmlFor="presentacion"
              className="cursor-pointer inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors border border-blue-200"
            >
              <Upload className="w-4 h-4" />
              {datosFormulario.presentacion
                ? datosFormulario.presentacion
                : "Seleccionar archivo"}
            </label>
          </div>
        </div>

        {datosFormulario.horaInicio && (
          <div
            className={`flex items-center gap-3 p-4 rounded-xl transition-all font-medium shadow-md ${
              esHorarioDisponible(datosFormulario.horaInicio)
                ? "bg-linear-to-r from-green-500 to-green-600 text-white"
                : "bg-linear-to-r from-red-500 to-red-600 text-white"
            }`}
          >
            {esHorarioDisponible(datosFormulario.horaInicio) ? (
              <>
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                <div>
                  <p className="font-semibold">Horario Disponible</p>
                  <p className="text-xs text-white/90">
                    Puedes reservar este horario
                  </p>
                </div>
              </>
            ) : (
              <>
                <AlertCircle className="w-5 h-5 shrink-0" />
                <div>
                  <p className="font-semibold">Horario No Disponible</p>
                  <p className="text-xs text-white/90">
                    Por favor elige otro horario
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        <Button
          type="submit"
          className="w-full h-12 text-base font-semibold rounded-xl shadow-lg bg-linear-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white transition-all hover:shadow-xl"
        >
          Crear Reserva
        </Button>
      </form>
    </Card>
  );
}
