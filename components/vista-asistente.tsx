"use client";

import type React from "react";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import type { Reserva, AsistenteRegistrado } from "@/app/page";
import { BuscadorEventos } from "@/components/buscador-eventos";
import type { FiltrosBusqueda } from "@/components/buscador-eventos";
import {
  CalendarIcon,
  Clock,
  MapPin,
  UserPlus,
  CheckCircle2,
  AlertCircle,
  Armchair,
  Mail,
  User,
  Eye,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type PropiedadesVistaAsistente = {
  reservas: Reserva[];
  asistentesRegistrados: AsistenteRegistrado[];
  onRegisterAttendee: (
    reservaId: string,
    nombre: string,
    email: string
  ) => Promise<{ exito: boolean; mensaje: string; asiento?: number }>;
};

export function VistaAsistente({
  reservas,
  asistentesRegistrados,
  onRegisterAttendee,
}: PropiedadesVistaAsistente) {
  const { toast } = useToast();
  const [dialogsAbiertos, setDialogsAbiertos] = useState<
    Record<string, boolean>
  >({});
  const [detalleAsientoAbierto, setDetalleAsientoAbierto] = useState<
    string | null
  >(null);
  const [filtrosActivos, setFiltrosActivos] = useState<FiltrosBusqueda | null>(
    null
  );
  const [datosFormulario, setDatosFormulario] = useState({
    nombre: "",
    email: "",
  });
  const [conteosServidor, setConteosServidor] = useState<
    Record<string, { ocupados: number; capacidad: number }>
  >({});
  const [isSubmittingByEvent, setIsSubmittingByEvent] = useState<
    Record<string, boolean>
  >({});

  // Obtener datos del usuario logueado al montar el componente
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch(`/api/auth/me`);
        const data = await res.json();
        if (mounted && res.ok && data.user) {
          setDatosFormulario({
            nombre: data.user.nombre || "",
            email: data.user.email || "",
          });
        }
      } catch (e) {
        // ignore errors - user data will remain empty
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Sincronización en tiempo real para eventos
  const { data: eventosActualizados, isConnected } = useRealtimeSync<Reserva[]>(
    "evento:creado",
    reservas,
    []
  );

  // Sincronización en tiempo real para registros de asistentes
  const { data: registrosActualizados } = useRealtimeSync<
    AsistenteRegistrado[]
  >("asistente:registrado", asistentesRegistrados, []);

  // Usar datos actualizados o datos iniciales
  const eventosActuales = eventosActualizados || reservas;
  const registrosActuales = registrosActualizados || asistentesRegistrados;

  const formatearFecha = (fecha: string) => {
    const date = new Date(fecha + "T00:00:00");
    return date.toLocaleDateString("es-MX", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const obtenerAsientosOcupados = (reservaId: string) => {
    return registrosActuales.filter((a) => a.reservaId === reservaId).length;
  };

  // Determine capacity for a given reserva: prefer server-provided capacity, then reserva.capacidad_total,
  // then reserva.asistentes (asistentes_esperados), and finally fall back to auditorio default (168).
  const obtenerCapacidadMaxima = (reserva: Reserva) => {
    const servidor = conteosServidor[reserva.id];
    if (servidor && typeof servidor.capacidad === "number" && servidor.capacidad > 0)
      return servidor.capacidad;
    if (reserva.capacidad_total && reserva.capacidad_total > 0) return reserva.capacidad_total;
    if (reserva.asistentes && reserva.asistentes > 0) return reserva.asistentes;
    return reserva.auditorio === "A" ? 168 : 168;
  };

  const estaLleno = (reserva: Reserva) => {
    const servidor = conteosServidor[reserva.id];
    const ocupadosServidor =
      servidor && typeof servidor.ocupados === "number"
        ? servidor.ocupados
        : reserva.asistentes_registrados || obtenerAsientosOcupados(reserva.id);
    const capacidadServidor =
      servidor &&
      typeof servidor.capacidad === "number" &&
      servidor.capacidad > 0
        ? servidor.capacidad
        : reserva.capacidad_total ||
          reserva.asistentes ||
          obtenerCapacidadMaxima(reserva.auditorio);

    return ocupadosServidor >= capacidadServidor;
  };

  // Helper: prefer servidor.capacidad if available, otherwise fallback to auditorio default
  const serverrCapacidad = (
    reserva: Reserva,
    servidor?: { ocupados: number; capacidad: number }
  ) => {
    if (
      servidor &&
      typeof servidor.capacidad === "number" &&
      servidor.capacidad > 0
    )
      return servidor.capacidad;
    if (reserva.capacidad_total && reserva.capacidad_total > 0)
      return reserva.capacidad_total;
    if (reserva.asistentes && reserva.asistentes > 0) return reserva.asistentes;
    return obtenerCapacidadMaxima(reserva.auditorio);
  };

  // Polling: periodically fetch conteo agregado desde el servidor para cada reserva mostrada
  // Subscribe to server `asientos:conteo` events instead of polling
  const { data: asientosRealtime } = useRealtimeSync<any>(
    "asientos:conteo",
    null,
    []
  );

  useEffect(() => {
    if (!asientosRealtime) return;
    try {
      const payload = asientosRealtime as any;
      const eventoId =
        payload.reservaId || payload.eventoId || payload.id_evento;
      if (!eventoId) return;
      const ocupados = Number(payload.ocupados || 0);
      const capacidad = Number(
        payload.capacidad || payload.capacidad_total || 0
      );
      setConteosServidor((prev) => ({
        ...prev,
        [eventoId]: { ocupados, capacidad },
      }));
    } catch (e) {
      // ignore
    }
  }, [asientosRealtime]);

  const eventosDisponibles = eventosActuales.filter((reserva) => {
    const fechaReserva = new Date(reserva.fecha + "T00:00:00");
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    return fechaReserva >= hoy;
  });

  const eventosFiltrados = filtrosActivos
    ? eventosDisponibles.filter((reserva) => {
        // Filtro por texto de búsqueda
        if (
          filtrosActivos.textoBusqueda &&
          !reserva.titulo
            .toLowerCase()
            .includes(filtrosActivos.textoBusqueda.toLowerCase()) &&
          !reserva.descripcion
            .toLowerCase()
            .includes(filtrosActivos.textoBusqueda.toLowerCase())
        ) {
          return false;
        }

        // Filtro por auditorio
        if (
          filtrosActivos.auditorio !== "todos" &&
          reserva.auditorio !== filtrosActivos.auditorio
        ) {
          return false;
        }

        // Filtro por carrera
        if (
          filtrosActivos.carrera !== "todos" &&
          reserva.carrera !== filtrosActivos.carrera
        ) {
          return false;
        }

        // Filtro por fecha inicio
        if (
          filtrosActivos.fechaInicio &&
          new Date(reserva.fecha) < new Date(filtrosActivos.fechaInicio)
        ) {
          return false;
        }

        // Filtro por fecha fin
        if (
          filtrosActivos.fechaFin &&
          new Date(reserva.fecha) > new Date(filtrosActivos.fechaFin)
        ) {
          return false;
        }

        // Availability / full filter: allow including full rooms when the
        // search filter explicitly requests it (`includeFull`), otherwise
        // hide full events from results.
        try {
          const servidor = conteosServidor[reserva.id];
          const ocupados =
            servidor && typeof servidor.ocupados === "number"
              ? servidor.ocupados
              : reserva.asistentes_registrados ||
                obtenerAsientosOcupados(reserva.id);
          const capacidad =
            servidor &&
            typeof servidor.capacidad === "number" &&
            servidor.capacidad > 0
              ? servidor.capacidad
              : reserva.capacidad_total ||
                reserva.asistentes ||
                obtenerCapacidadMaxima(reserva.auditorio);
          const isFull = ocupados >= capacidad;
          if (isFull && !filtrosActivos.includeFull) return false;
        } catch (e) {
          // ignore availability check errors
        }

        return true;
      })
    : eventosDisponibles;

  const misRegistros = registrosActuales.filter(
    (asistente) =>
      asistente.email === datosFormulario.email && datosFormulario.email !== ""
  );

  const setDialogAbierto = (reservaId: string, abierto: boolean) => {
    setDialogsAbiertos((prev) => ({ ...prev, [reservaId]: abierto }));
  };

  const manejarRegistro = (reservaId: string) => async (e: React.FormEvent) => {
    e.preventDefault();

    // Prevenir múltiples envíos simultáneos
    if (isSubmittingByEvent[reservaId]) {
      return;
    }

    setIsSubmittingByEvent((prev) => ({ ...prev, [reservaId]: true }));

    try {
      const resultado = await onRegisterAttendee(
        reservaId,
        datosFormulario.nombre,
        datosFormulario.email
      );
      if (resultado.exito) {
        toast({
          title: "Registro exitoso",
          description: `${resultado.mensaje}. Te esperamos en el evento.`,
        });
        setDialogAbierto(reservaId, false);
        setDatosFormulario({ nombre: "", email: "" });
      } else {
        toast({
          title: "Error al registrar",
          description: resultado.mensaje,
          variant: "destructive",
        });
      }
    } finally {
      setIsSubmittingByEvent((prev) => ({ ...prev, [reservaId]: false }));
    }
  };

  return (
    <div className="space-y-6">
      <BuscadorEventos
        alBuscar={(filtros) => setFiltrosActivos(filtros)}
        alLimpiar={() => setFiltrosActivos(null)}
      />

      <Card className="p-6 rounded-2xl shadow-xl bg-white/80 backdrop-blur-sm">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b-2 border-gray-200">
          <div className="p-2 bg-linear-to-br from-purple-500 to-purple-600 rounded-lg shadow-md">
            <UserPlus className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold">Eventos Disponibles</h2>
            <p className="text-sm text-gray-600">
              Regístrate para asistir a un evento
            </p>
          </div>
        </div>

        {eventosFiltrados.length === 0 ? (
          <div className="text-center py-12">
            <CalendarIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h3 className="text-xl font-semibold text-gray-600 mb-2">
              No hay eventos disponibles
            </h3>
            <p className="text-gray-500">
              Vuelve más tarde para ver nuevos eventos
            </p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {eventosFiltrados.map((reserva) => {
              const asientosOcupados = obtenerAsientosOcupados(reserva.id);
              const servidor = conteosServidor[reserva.id];
              const capacidadAuditorio = obtenerCapacidadMaxima(reserva);
              const capacidadMaxima = capacidadAuditorio;
              const displayedOcupados =
                servidor && typeof servidor.ocupados === "number"
                  ? servidor.ocupados
                  : asientosOcupados;
              const porcentajeOcupacion = (displayedOcupados / Math.max(1, capacidadMaxima)) * 100;
              const yaRegistrado = registrosActuales.some(
                (a) =>
                  a.reservaId === reserva.id &&
                  a.email === datosFormulario.email &&
                  datosFormulario.email !== ""
              );

              return (
                <Card
                  key={reserva.id}
                  className="p-5 rounded-xl shadow-lg hover:shadow-xl transition-all bg-linear-to-br from-white to-gray-50"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-xl font-bold mb-1">
                        {reserva.titulo}
                      </h3>
                      <p className="text-sm text-gray-600">
                        Por {reserva.organizador}
                      </p>
                    </div>
                    <Badge
                      className={`${
                        reserva.auditorio === "A"
                          ? "bg-linear-to-r from-blue-500 to-blue-600"
                          : "bg-linear-to-r from-purple-500 to-purple-600"
                      } text-white font-semibold px-3 py-1`}
                    >
                      Auditorio {reserva.auditorio}
                    </Badge>
                    {estaLleno(reserva) && (
                      <Badge className="ml-2 bg-linear-to-r from-red-500 to-red-600 text-white font-semibold px-3 py-1">
                        Auditorio lleno
                      </Badge>
                    )}
                  </div>

                  <div className="space-y-2 mb-4">
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <CalendarIcon className="w-4 h-4 text-blue-500" />
                      <span className="font-medium">
                        {formatearFecha(reserva.fecha)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <Clock className="w-4 h-4 text-purple-500" />
                      <span className="font-medium">
                        {reserva.horaInicio} - {reserva.horaFin}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <MapPin className="w-4 h-4 text-green-500" />
                      <span className="font-medium">
                        Auditorio {reserva.auditorio}
                      </span>
                    </div>
                  </div>

                  {reserva.descripcion && (
                    <p className="text-sm text-gray-600 mb-4 line-clamp-2">
                      {reserva.descripcion}
                    </p>
                  )}

                  <div className="mb-4">
                    <div className="flex justify-between text-xs mb-2 font-medium text-gray-600">
                      <span className="flex items-center gap-1">
                        <Armchair className="w-3 h-3" />
                        Asientos ocupados
                      </span>
                      <span
                        className={
                          porcentajeOcupacion > 80
                            ? "text-orange-600"
                            : "text-green-600"
                        }
                      >
                        {asientosOcupados}/{capacidadMaxima}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden shadow-inner">
                      <div
                        className={`h-full transition-all duration-300 rounded-full ${
                          porcentajeOcupacion > 80
                            ? "bg-linear-to-r from-orange-500 to-red-500"
                            : "bg-linear-to-r from-green-500 to-green-600"
                        }`}
                        style={{ width: `${porcentajeOcupacion}%` }}
                      />
                    </div>
                  </div>

                  {yaRegistrado ? (
                    <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg border border-green-200">
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                      <span className="text-sm font-semibold text-green-700">
                        Ya estás registrado
                      </span>
                    </div>
                  ) : (
                    <>
                      {!dialogsAbiertos[reserva.id] ? (
                        <Button
                          onClick={() => {
                            const s = conteosServidor[reserva.id];
                            // Only treat server counts as authoritative when capacidad is a positive number
                            if (
                              s &&
                              typeof s.capacidad === "number" &&
                              s.capacidad > 0 &&
                              s.ocupados >= s.capacidad
                            ) {
                              toast({
                                title: "Evento completo",
                                description:
                                  "Lo sentimos, ya no quedan asientos disponibles.",
                                variant: "destructive",
                              });
                              return;
                            }
                            setDialogAbierto(reserva.id, true);
                          }}
                          className="w-full bg-linear-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white font-semibold rounded-lg shadow-md hover:shadow-lg transition-all"
                        >
                          <UserPlus className="w-4 h-4 mr-2" />
                          Registrarme
                        </Button>
                      ) : (
                        <div className="mt-4 p-6 rounded-2xl shadow-xl bg-white/90 border border-gray-200">
                          <h3 className="text-xl font-bold mb-2 text-purple-700">
                            Registro al Evento
                          </h3>
                          <p className="mb-4 text-gray-600 text-sm">
                            Completa tus datos para registrarte a "
                            {reserva.titulo}"
                          </p>
                          <form
                            onSubmit={manejarRegistro(reserva.id)}
                            className="space-y-4"
                          >
                            <div>
                              <Label
                                htmlFor={`nombre-${reserva.id}`}
                                className="text-base font-semibold flex items-center gap-2"
                              >
                                <User className="w-4 h-4" />
                                Nombre Completo
                              </Label>
                              <Input
                                id={`nombre-${reserva.id}`}
                                value={datosFormulario.nombre}
                                onChange={(e) =>
                                  setDatosFormulario({
                                    ...datosFormulario,
                                    nombre: e.target.value,
                                  })
                                }
                                placeholder="Tu nombre"
                                className="mt-2 rounded-lg bg-gray-100"
                                readOnly
                              />
                              <p className="text-xs text-gray-500 mt-1">
                                Datos de tu perfil (no editables)
                              </p>
                            </div>
                            <div>
                              <Label
                                htmlFor={`email-${reserva.id}`}
                                className="text-base font-semibold flex items-center gap-2"
                              >
                                <Mail className="w-4 h-4" />
                                Correo Electrónico
                              </Label>
                              <Input
                                id={`email-${reserva.id}`}
                                type="email"
                                value={datosFormulario.email}
                                onChange={(e) =>
                                  setDatosFormulario({
                                    ...datosFormulario,
                                    email: e.target.value,
                                  })
                                }
                                placeholder="tu@email.com"
                                className="mt-2 rounded-lg bg-gray-100"
                                readOnly
                              />
                              <p className="text-xs text-gray-500 mt-1">
                                Datos de tu perfil (no editables)
                              </p>
                            </div>
                            <div className="flex items-start gap-2 p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
                              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                              <p>
                                Se te asignará automáticamente el siguiente
                                asiento disponible en orden de llegada.
                              </p>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <Button
                                type="submit"
                                disabled={Boolean(
                                  (() => {
                                    const s = conteosServidor[reserva.id];
                                    return (
                                      s &&
                                      typeof s.capacidad === "number" &&
                                      s.capacidad > 0 &&
                                      s.ocupados >= s.capacidad
                                    );
                                  })() || isSubmittingByEvent[reserva.id]
                                )}
                                className="w-full bg-linear-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white font-semibold rounded-lg shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {isSubmittingByEvent[reserva.id]
                                  ? "Registrando..."
                                  : "Confirmar Registro"}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className="w-full"
                                disabled={isSubmittingByEvent[reserva.id]}
                                onClick={() =>
                                  setDialogAbierto(reserva.id, false)
                                }
                              >
                                Cancelar
                              </Button>
                            </div>
                          </form>
                        </div>
                      )}
                    </>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </Card>

      {misRegistros.length > 0 && (
        <Card className="p-6 rounded-2xl shadow-xl bg-white/80 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b-2 border-gray-200">
            <div className="p-2 bg-linear-to-br from-green-500 to-green-600 rounded-lg shadow-md">
              <CheckCircle2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold">Mis Registros</h2>
              <p className="text-sm text-gray-600">
                Eventos a los que estás registrado
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {misRegistros.map((asistente) => {
              const reserva = eventosActuales.find(
                (r) => r.id === asistente.reservaId
              );
              if (!reserva) return null;

              return (
                <Card
                  key={asistente.id}
                  className="p-4 rounded-xl bg-linear-to-br from-green-50 to-white shadow-md"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="text-lg font-bold mb-1">
                        {reserva.titulo}
                      </h3>
                      <div className="space-y-1 text-sm text-gray-600">
                        <p className="flex items-center gap-2">
                          <CalendarIcon className="w-3 h-3" />
                          {formatearFecha(reserva.fecha)}
                        </p>
                        <p className="flex items-center gap-2">
                          <Clock className="w-3 h-3" />
                          {reserva.horaInicio} - {reserva.horaFin}
                        </p>
                        <p className="flex items-center gap-2">
                          <MapPin className="w-3 h-3" />
                          Auditorio {reserva.auditorio}
                        </p>
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="bg-linear-to-br from-green-500 to-green-600 text-white rounded-xl p-4 shadow-lg">
                        <Armchair className="w-8 h-8 mx-auto mb-1" />
                        <p className="text-xs font-medium">Asiento</p>
                        <p className="text-3xl font-bold">
                          {asistente.numeroAsiento}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4">
                    <Button
                      onClick={() => setDetalleAsientoAbierto(asistente.id)}
                      className="w-full bg-linear-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-semibold rounded-lg"
                    >
                      <Eye className="w-4 h-4 mr-2" />
                      Ver Detalles
                    </Button>
                  </div>

                  {detalleAsientoAbierto === asistente.id && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                      <Card className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
                        <div className="p-6 space-y-6">
                          <div className="flex items-center justify-between border-b pb-4">
                            <h2 className="text-2xl font-bold">
                              Detalles de tu Asiento
                            </h2>
                            <button
                              onClick={() => setDetalleAsientoAbierto(null)}
                              className="p-2 hover:bg-gray-100 rounded-lg transition"
                            >
                              <X className="w-6 h-6" />
                            </button>
                          </div>

                          <div className="space-y-4">
                            <div className="flex gap-4 items-start">
                              <div className="flex-1 space-y-3">
                                <div>
                                  <p className="text-sm text-gray-600 font-medium">
                                    EVENTO
                                  </p>
                                  <p className="text-xl font-bold text-gray-900">
                                    {reserva.titulo}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-sm text-gray-600 font-medium">
                                    ORGANIZADOR
                                  </p>
                                  <p className="text-lg text-gray-900">
                                    {reserva.organizador || "No especificado"}
                                  </p>
                                </div>
                              </div>
                              <div className="flex-shrink-0 bg-linear-to-br from-green-500 to-green-600 text-white rounded-xl p-6 shadow-lg text-center">
                                <Armchair className="w-10 h-10 mx-auto mb-2" />
                                <p className="text-sm font-medium">Asiento</p>
                                <p className="text-4xl font-bold">
                                  {asistente.numeroAsiento}
                                </p>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                                <p className="text-sm text-gray-600 font-medium mb-1">
                                  FECHA
                                </p>
                                <p className="text-base font-semibold text-gray-900">
                                  {formatearFecha(reserva.fecha)}
                                </p>
                              </div>
                              <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
                                <p className="text-sm text-gray-600 font-medium mb-1">
                                  HORA
                                </p>
                                <p className="text-base font-semibold text-gray-900">
                                  {reserva.horaInicio} - {reserva.horaFin}
                                </p>
                              </div>
                              <div className="bg-pink-50 p-4 rounded-lg border border-pink-200">
                                <p className="text-sm text-gray-600 font-medium mb-1">
                                  AUDITORIO
                                </p>
                                <p className="text-base font-semibold text-gray-900">
                                  Auditorio {reserva.auditorio}
                                </p>
                              </div>
                              <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                                <p className="text-sm text-gray-600 font-medium mb-1">
                                  ESTADO
                                </p>
                                <p className="text-base font-semibold text-green-600">
                                  ✓ Confirmado
                                </p>
                              </div>
                            </div>

                            {reserva.descripcion && (
                              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                                <p className="text-sm text-gray-600 font-medium mb-2">
                                  DESCRIPCIÓN
                                </p>
                                <p className="text-gray-900">
                                  {reserva.descripcion}
                                </p>
                              </div>
                            )}

                            <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-4 flex gap-3">
                              <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                              <p className="text-sm text-yellow-800">
                                Por favor, llega 10 minutos antes de la hora de
                                inicio. Ten en cuenta tu número de asiento para
                                facilitar tu entrada al evento.
                              </p>
                            </div>
                          </div>

                          <div className="flex gap-3 pt-4 border-t">
                            <Button
                              onClick={() => setDetalleAsientoAbierto(null)}
                              className="flex-1 bg-linear-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-semibold rounded-lg"
                            >
                              Cerrar
                            </Button>
                          </div>
                        </div>
                      </Card>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
