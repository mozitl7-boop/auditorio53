"use client";

import { Card } from "@/components/ui/card";
import { Building2, Users, Clock } from "lucide-react";
import type { Reserva, AsistenteRegistrado } from "@/app/page";

type PropiedadesEstadoAuditorio = {
  reservas: Reserva[];
  fechaSeleccionada: Date;
  asistentesRegistrados?: AsistenteRegistrado[];
  asientosConteo?: Record<
    string,
    { ocupados: number; capacidad: number; auditorio?: string }
  >;
};

export function EstadoAuditorio({
  reservas,
  fechaSeleccionada,
  asistentesRegistrados = [],
  asientosConteo = {},
}: PropiedadesEstadoAuditorio) {
  const ahora = new Date();
  const esHoy = fechaSeleccionada.toDateString() === ahora.toDateString();

  const formatearFechaLocal = (fecha: Date) => {
    const year = fecha.getFullYear();
    const month = String(fecha.getMonth() + 1).padStart(2, "0");
    const day = String(fecha.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const obtenerEstadoActual = (auditorio: "A" | "B") => {
    if (!esHoy) return { estado: "desconocido", reserva: null };

    const tiempoActual = ahora.getHours() * 60 + ahora.getMinutes();
    const fechaHoyNormalizada = formatearFechaLocal(ahora);

    const reservasHoy = reservas.filter((r) => {
      if (r.auditorio !== auditorio) return false;
      return r.fecha === fechaHoyNormalizada;
    });

    for (const reserva of reservasHoy) {
      const [horaInicio, minInicio] = reserva.horaInicio.split(":").map(Number);
      const [horaFin, minFin] = reserva.horaFin.split(":").map(Number);
      const minutosInicio = horaInicio * 60 + minInicio;
      const minutosFin = horaFin * 60 + minFin;

      if (tiempoActual >= minutosInicio && tiempoActual < minutosFin) {
        return { estado: "ocupado", reserva };
      }
    }

    return { estado: "disponible", reserva: null };
  };

  const estadoA = obtenerEstadoActual("A");
  const estadoB = obtenerEstadoActual("B");

  const contarOcupados = (reservaId: string | null, capacidad: number) => {
    if (!reservaId) return 0;
    // Preferir conteo agregado enviado por el servidor si está disponible
    const agg = asientosConteo[reservaId];
    if (agg && typeof agg.ocupados === "number") return agg.ocupados;
    return asistentesRegistrados.filter((a) => a.reservaId === reservaId)
      .length;
  };

  const obtenerColorEstado = (estado: string) => {
    switch (estado) {
      case "ocupado":
        return "bg-gradient-to-br from-red-400 to-red-500";
      case "disponible":
        return "bg-gradient-to-br from-green-400 to-green-500";
      default:
        return "bg-gradient-to-br from-gray-300 to-gray-400";
    }
  };

  const obtenerTextoEstado = (estado: string) => {
    switch (estado) {
      case "ocupado":
        return "Ocupado";
      case "disponible":
        return "Disponible";
      default:
        return "N/A";
    }
  };

  return (
    <div className="grid md:grid-cols-2 gap-6 mb-8">
      <Card className="p-6 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-2xl shadow-xl hover:shadow-2xl transition-all overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent pointer-events-none" />
        <div className="relative z-10">
          <div className="flex items-start justify-between mb-4 pb-4 border-b border-white/30">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-white/20 backdrop-blur-sm rounded-xl">
                <Building2 className="w-7 h-7 text-white" />
              </div>
              <div>
                <h3 className="text-3xl font-bold">Auditorio A</h3>
                <div className="flex items-center gap-1.5 text-sm mt-1 text-white/90">
                  <Users className="w-4 h-4" />
                  <span>
                    {estadoA.reserva ? (
                      (() => {
                        const reserva = estadoA.reserva as any;
                        const agg = asientosConteo[reserva.id] || null;
                        const capacidad = Number(
                          (agg && agg.capacidad) || reserva.capacidad_total || reserva.asistentes || 168
                        );
                        const ocupados = contarOcupados(reserva.id, capacidad);
                        return `${ocupados} / ${capacidad} personas`;
                      })()
                    ) : (
                      "0 / 168 personas"
                    )}
                  </span>
                </div>
              </div>
            </div>
            <div
              className={`w-6 h-6 rounded-full ${obtenerColorEstado(
                estadoA.estado
              )} shadow-lg ${
                estadoA.estado === "ocupado" || estadoA.estado === "disponible"
                  ? "animate-pulse"
                  : ""
              }`}
            />
          </div>
          <div className="mt-6">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4" />
              <p className="text-sm font-medium">Estado Actual:</p>
            </div>
            <p className="text-3xl font-bold mb-2">
              {obtenerTextoEstado(estadoA.estado)}
            </p>
            {estadoA.reserva && (
              <div className="bg-white/20 backdrop-blur-sm text-white rounded-xl p-3 mt-3">
                <p className="font-semibold">{estadoA.reserva.titulo}</p>
                <p className="text-sm mt-1 text-white/90">
                  {estadoA.reserva.horaInicio} - {estadoA.reserva.horaFin}
                </p>
                <p className="text-xs mt-1 text-white/80">
                  {estadoA.reserva.organizador}
                </p>
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card className="p-6 bg-gradient-to-br from-purple-500 to-purple-600 text-white rounded-2xl shadow-xl hover:shadow-2xl transition-all overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent pointer-events-none" />
        <div className="relative z-10">
          <div className="flex items-start justify-between mb-4 pb-4 border-b border-white/30">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-white/20 backdrop-blur-sm rounded-xl">
                <Building2 className="w-7 h-7 text-white" />
              </div>
              <div>
                <h3 className="text-3xl font-bold">Auditorio B</h3>
                <div className="flex items-center gap-1.5 text-sm mt-1 text-white/90">
                  <Users className="w-4 h-4" />
                  <span>
                    {estadoB.reserva ? (
                      (() => {
                        const reserva = estadoB.reserva as any;
                        const agg = asientosConteo[reserva.id] || null;
                        const capacidad = Number(
                          (agg && agg.capacidad) || reserva.capacidad_total || reserva.asistentes || 168
                        );
                        const ocupados = contarOcupados(reserva.id, capacidad);
                        return `${ocupados} / ${capacidad} personas`;
                      })()
                    ) : (
                      "0 / 168 personas"
                    )}
                  </span>
                </div>
              </div>
            </div>
            <div
              className={`w-6 h-6 rounded-full ${obtenerColorEstado(
                estadoB.estado
              )} shadow-lg ${
                estadoB.estado === "ocupado" || estadoB.estado === "disponible"
                  ? "animate-pulse"
                  : ""
              }`}
            />
          </div>
          <div className="mt-6">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4" />
              <p className="text-sm font-medium">Estado Actual:</p>
            </div>
            <p className="text-3xl font-bold mb-2">
              {obtenerTextoEstado(estadoB.estado)}
            </p>
            {estadoB.reserva && (
              <div className="bg-white/20 backdrop-blur-sm text-white rounded-xl p-3 mt-3">
                <p className="font-semibold">{estadoB.reserva.titulo}</p>
                <p className="text-sm mt-1 text-white/90">
                  {estadoB.reserva.horaInicio} - {estadoB.reserva.horaFin}
                </p>
                <p className="text-xs mt-1 text-white/80">
                  {estadoB.reserva.organizador}
                </p>
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
