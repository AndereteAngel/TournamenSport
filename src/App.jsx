import {
  calculateGroupStandings,
  generatePlayoffBrackets,
} from "./utils/tournamentLogic";
import { useEffect, useState } from "react";

import { CreateTournament } from "./components/CreateTournament";
import { GroupStageView } from "./components/GroupStageView";
import { Navbar } from "./components/Navbar";
import { TCIcon } from "./components/TCIcon";
import { ChampionCelebration } from "./components/ChampionCelebration";
import { TournamentNotice, useTournamentNotice } from "./components/TournamentNotice";
import { PlayoffBracket } from "./components/PlayoffBracket";
import { supabase } from "./supabaseClient";

const ADMIN_UID = import.meta.env.VITE_ADMIN_USER_ID || "c2089fce-5fb1-430a-8abc-89f5b762b69a";

// La categoría se guarda dentro de "game" al crear el torneo (ej.: "Fútbol · 2012").
// También leemos las columnas específicas si existen en torneos anteriores/nuevos.
const getTournamentCategory = (tournament) => {
  const explicitCategory = String(
    tournament?.category_detail || tournament?.category_type || ""
  ).trim();
  if (explicitCategory) return explicitCategory;

  const game = String(tournament?.game || "");
  const separatorIndex = game.lastIndexOf(" · ");
  if (separatorIndex >= 0) {
    const categoryFromGame = game.slice(separatorIndex + 3).trim();
    if (categoryFromGame) return categoryFromGame;
  }

  return "Sin categoría";
};

const adminTournamentButtonStyle = {
  width: "auto",
  maxWidth: "fit-content",
  padding: "0.45rem 0.75rem",
  fontSize: "0.68rem",
  lineHeight: 1.2,
  borderWidth: "2px",
  borderBottomWidth: "3px",
  borderRadius: "8px",
  boxShadow: "0 3px 0 #422200, 0 5px 10px rgba(255,156,0,0.2)",
};

function AdminStats({ onBack }) {
  const [visitas, setVisitas] = useState([]);
  const [perfiles, setPerfiles] = useState([]);
  const [loadingStats, setLoadingStats] = useState(true);
  const [errorStats, setErrorStats] = useState("");
  const [busquedaJugador, setBusquedaJugador] = useState("");
  const [jugadorExpandido, setJugadorExpandido] = useState(null);
  const [fechaFiltroVisitas, setFechaFiltroVisitas] = useState(() => {
    const hoy = new Date();
    return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
  });

  const cargarEstadisticas = async () => {
    setLoadingStats(true);
    setErrorStats("");

    const [
      { data: visitasData, error: visitasError },
      { data: perfilesData, error: perfilesError },
    ] = await Promise.all([
      supabase
        .from("visitas")
        .select(
          "id, created_at, user_id, username, email, device, started_at, last_seen_at, duration_seconds"
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("profiles")
        .select("id, username, email, created_at")
        .order("created_at", { ascending: false }),
    ]);

    if (visitasError || perfilesError) {
      console.error("Error al obtener estadísticas:", {
        visitasError,
        perfilesError,
      });
      setErrorStats(
        perfilesError
          ? "No se pudo cargar la lista de jugadores registrados. Revisá los permisos de lectura de profiles en Supabase."
          : "No se pudieron cargar las estadísticas de visitas."
      );
      setLoadingStats(false);
      return;
    }

    setVisitas((visitasData || []).filter((visita) => visita.user_id));
    setPerfiles(perfilesData || []);
    setLoadingStats(false);
  };

  useEffect(() => {
    cargarEstadisticas();
  }, []);

  const formatearFecha = (fecha) => {
    if (!fecha) return "-";

    return new Date(fecha).toLocaleString("es-AR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  };

  const formatearDuracion = (segundos) => {
    const total = Number(segundos || 0);

    if (total < 60) {
      return `${total}s`;
    }

    const minutos = Math.floor(total / 60);
    const segundosRestantes = total % 60;

    if (minutos < 60) {
      return `${minutos}m ${segundosRestantes}s`;
    }

    const horas = Math.floor(minutos / 60);
    const minutosRestantes = minutos % 60;

    return `${horas}h ${minutosRestantes}m`;
  };

  const esVisitaDeHoy = (visita) => {
    const fecha = new Date(visita.created_at);
    const ahora = new Date();

    return (
      fecha.getDate() === ahora.getDate() &&
      fecha.getMonth() === ahora.getMonth() &&
      fecha.getFullYear() === ahora.getFullYear()
    );
  };

  const visitasDeHoy = visitas
    .filter(esVisitaDeHoy)
    .sort(
      (a, b) =>
        new Date(b.started_at || b.created_at) -
        new Date(a.started_at || a.created_at)
    );

  const visitasHoy = visitasDeHoy.length;

  const visitasFechaSeleccionada = visitas
    .filter((visita) => {
      const fecha = new Date(visita.started_at || visita.created_at);
      if (Number.isNaN(fecha.getTime())) return false;
      const fechaLocal = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-${String(fecha.getDate()).padStart(2, "0")}`;
      return fechaLocal === fechaFiltroVisitas;
    })
    .sort(
      (a, b) =>
        new Date(b.started_at || b.created_at) -
        new Date(a.started_at || a.created_at)
    );

  const usuariosRegistrados = perfiles.length;

  const visitasMobile = visitas.filter(
    (visita) => visita.device === "mobile"
  ).length;

  const visitasDesktop = visitas.filter(
    (visita) => visita.device === "desktop"
  ).length;

  const tiempoTotal = visitas.reduce(
    (total, visita) => total + Number(visita.duration_seconds || 0),
    0
  );

  const tiempoPromedio =
    visitas.length > 0 ? Math.round(tiempoTotal / visitas.length) : 0;

  const sesionesActivas = visitas
    .filter((visita) => {
      if (!visita.last_seen_at) return false;
      const diferencia = Date.now() - new Date(visita.last_seen_at).getTime();
      return diferencia >= 0 && diferencia <= 5 * 60 * 1000;
    })
    .sort(
      (a, b) =>
        new Date(b.last_seen_at).getTime() -
        new Date(a.last_seen_at).getTime()
    )
    .filter((visita, index, lista) => {
      const clave = visita.user_id || visita.id;
      return lista.findIndex((otra) => (otra.user_id || otra.id) === clave) === index;
    });

  const usuariosActivos = sesionesActivas.length;

  // =========================================================
  // VISITAS POR DÍA
  // =========================================================

  const visitasPorDia = {};

  visitas.forEach((visita) => {
    const fecha = new Date(visita.created_at);

    const dia = fecha.toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit",
    });

    visitasPorDia[dia] = (visitasPorDia[dia] || 0) + 1;
  });

  const diasOrdenados = Object.entries(visitasPorDia).slice(0, 14);

  // =========================================================
  // VISITAS POR HORA
  // =========================================================

  const visitasPorHora = Array.from({ length: 24 }, () => 0);

  visitas.forEach((visita) => {
    const hora = new Date(visita.created_at).getHours();

    visitasPorHora[hora]++;
  });

  // =========================================================
  // JUGADORES REGISTRADOS: salen de profiles, no de visitas.
  // Así aparecen también quienes todavía nunca entraron.
  // =========================================================

  const actividadPorUsuario = {};

  visitas
    .filter((visita) => visita.user_id)
    .forEach((visita) => {
      const id = visita.user_id;

      if (!actividadPorUsuario[id]) {
        actividadPorUsuario[id] = {
          visitas: 0,
          tiempo: 0,
          ultimaVisita: null,
          device: visita.device || "",
        };
      }

      actividadPorUsuario[id].visitas += 1;
      actividadPorUsuario[id].tiempo += Number(visita.duration_seconds || 0);

      if (
        !actividadPorUsuario[id].ultimaVisita ||
        new Date(visita.created_at) >
          new Date(actividadPorUsuario[id].ultimaVisita)
      ) {
        actividadPorUsuario[id].ultimaVisita = visita.last_seen_at || visita.created_at;
        actividadPorUsuario[id].device = visita.device || actividadPorUsuario[id].device;
      }
    });

  const jugadores = [...perfiles]
    .map((perfil) => {
      const actividad = actividadPorUsuario[perfil.id] || {};

      return {
        id: perfil.id,
        username: perfil.username || "Jugador",
        email: perfil.email || "",
        creadoEn: perfil.created_at || null,
        visitas: actividad.visitas || 0,
        tiempo: actividad.tiempo || 0,
        ultimaVisita: actividad.ultimaVisita || null,
        device: actividad.device || "",
      };
    })
    .sort((a, b) =>
      a.username.localeCompare(b.username, "es", { sensitivity: "base" })
    );

  const jugadoresFiltrados = jugadores.filter((jugador) => {
    const busqueda = busquedaJugador.trim().toLocaleLowerCase("es");
    if (!busqueda) return true;
    return (
      jugador.username.toLocaleLowerCase("es").includes(busqueda) ||
      jugador.email.toLocaleLowerCase("es").includes(busqueda)
    );
  });

  if (loadingStats) {
    return (
      <div
        className="cr-card"
        style={{
          maxWidth: "1000px",
          margin: "auto",
          textAlign: "center",
        }}
      >
        <h2 className="cr-title"><TCIcon name="chart" /> Estadísticas</h2>

        <p style={{ color: "#9ca3af" }}>Cargando estadísticas...</p>
      </div>
    );
  }

  if (errorStats) {
    return (
      <div
        className="cr-card"
        style={{
          maxWidth: "1000px",
          margin: "auto",
          textAlign: "center",
        }}
      >
        <h2 className="cr-title"><TCIcon name="chart" /> Estadísticas</h2>

        <p style={{ color: "#f87171" }}>{errorStats}</p>

        <button
          onClick={onBack}
          className="cr-btn-gold"
          style={{ marginTop: "1rem" }}
        >
          ← Volver
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "1100px",
        margin: "0 auto",
        paddingBottom: "2rem",
      }}
    >
      {/* HEADER */}

      <div
        className="cr-card"
        style={{
          marginBottom: "1rem",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "1rem",
            flexWrap: "wrap",
          }}
        >
          <div>
            <h2 className="cr-title" style={{ marginBottom: "4px" }}>
              <TCIcon name="chart" /> Estadísticas
            </h2>

            <p
              style={{
                color: "#9ca3af",
                margin: 0,
                fontSize: "0.8rem",
              }}
            >
              Panel privado de TournamenSport
            </p>
          </div>

          <div
            style={{
              display: "flex",
              gap: "0.5rem",
            }}
          >
            <button
              onClick={cargarEstadisticas}
              style={{
                padding: "0.5rem 0.8rem",
                background: "#1b5fa8",
                border: "1px solid #3b82f6",
                color: "#fff",
                borderRadius: "7px",
                cursor: "pointer",
                fontWeight: "bold",
              }}
            >
              <TCIcon name="refresh" /> Actualizar
            </button>

            <button
              onClick={onBack}
              style={{
                padding: "0.5rem 0.8rem",
                background: "transparent",
                border: "1px solid #4b5563",
                color: "#d1d5db",
                borderRadius: "7px",
                cursor: "pointer",
                fontWeight: "bold",
              }}
            >
              ← Volver
            </button>
          </div>
        </div>
      </div>

      {/* RESUMEN */}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "0.75rem",
          marginBottom: "1rem",
        }}
      >
        {[
          ["eye", "Sesiones registradas", visitas.length],
          ["calendar", "Sesiones hoy", visitasHoy],
          ["users", "Jugadores", usuariosRegistrados],
          ["bolt", "Activos", usuariosActivos],
          ["clock", "Tiempo promedio", formatearDuracion(tiempoPromedio)],
        ].map(([icono, titulo, valor]) => (
          <div
            key={titulo}
            className="cr-card"
            style={{
              padding: "1rem",
              textAlign: "center",
            }}
          >
            <div className="tc-stat-icon"><TCIcon name={icono} size={23} /></div>

            <div
              style={{
                color: "#9ca3af",
                fontSize: "0.7rem",
                textTransform: "uppercase",
                fontWeight: "bold",
                marginTop: "4px",
              }}
            >
              {titulo}
            </div>

            <div
              style={{
                color: "#ffd700",
                fontSize: "1.4rem",
                fontWeight: 900,
                marginTop: "4px",
              }}
            >
              {valor}
            </div>
          </div>
        ))}
      </div>

      {/* DISPOSITIVOS */}

      <div
        className="cr-card"
        style={{
          marginBottom: "1rem",
        }}
      >
        <h3
          style={{
            color: "#fff",
            marginTop: 0,
            marginBottom: "1rem",
          }}
        >
          <TCIcon name="devices" /> Dispositivos
        </h3>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "1rem",
          }}
        >
          <div
            style={{
              padding: "1rem",
              background: "#121019",
              borderRadius: "8px",
              textAlign: "center",
            }}
          >
            <div className="tc-stat-icon"><TCIcon name="mobile" size={25} /></div>

            <strong
              style={{
                color: "#fff",
                display: "block",
                marginTop: "5px",
              }}
            >
              Mobile
            </strong>

            <span style={{ color: "#9ca3af" }}>{visitasMobile} visitas</span>
          </div>

          <div
            style={{
              padding: "1rem",
              background: "#121019",
              borderRadius: "8px",
              textAlign: "center",
            }}
          >
            <div className="tc-stat-icon"><TCIcon name="desktop" size={25} /></div>

            <strong
              style={{
                color: "#fff",
                display: "block",
                marginTop: "5px",
              }}
            >
              Desktop
            </strong>

            <span style={{ color: "#9ca3af" }}>{visitasDesktop} visitas</span>
          </div>
        </div>
      </div>

      {/* VISITAS POR DÍA */}

      <div
        className="cr-card"
        style={{
          marginBottom: "1rem",
        }}
      >
        <h3
          style={{
            color: "#fff",
            marginTop: 0,
            marginBottom: "1rem",
          }}
        >
          <TCIcon name="calendar" /> Visitas por día
        </h3>

        {diasOrdenados.length === 0 ? (
          <p style={{ color: "#9ca3af" }}>Todavía no hay datos.</p>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.45rem",
            }}
          >
            {diasOrdenados.map(([dia, cantidad]) => (
              <div
                key={dia}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                }}
              >
                <span
                  style={{
                    width: "55px",
                    color: "#d1d5db",
                    fontSize: "0.8rem",
                  }}
                >
                  {dia}
                </span>

                <div
                  style={{
                    flex: 1,
                    height: "22px",
                    background: "#121019",
                    borderRadius: "5px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(
                        100,
                        (cantidad /
                          Math.max(
                            1,
                            Math.max(...Object.values(visitasPorDia))
                          )) *
                          100
                      )}%`,
                      height: "100%",
                      background: "linear-gradient(90deg, #1b5fa8, #60a5fa)",
                    }}
                  />
                </div>

                <strong
                  style={{
                    width: "30px",
                    textAlign: "right",
                    color: "#ffd700",
                  }}
                >
                  {cantidad}
                </strong>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* VISITAS POR HORA */}

      <div
        className="cr-card"
        style={{
          marginBottom: "1rem",
        }}
      >
        <h3
          style={{
            color: "#fff",
            marginTop: 0,
            marginBottom: "1rem",
          }}
        >
          🕐 Visitas por horario
        </h3>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(55px, 1fr))",
            gap: "0.4rem",
          }}
        >
          {visitasPorHora.map((cantidad, hora) => (
            <div
              key={hora}
              style={{
                background: "#121019",
                borderRadius: "6px",
                padding: "0.5rem 0.2rem",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  color: "#9ca3af",
                  fontSize: "0.65rem",
                }}
              >
                {String(hora).padStart(2, "0")}h
              </div>

              <strong
                style={{
                  color: cantidad > 0 ? "#ffd700" : "#4b5563",
                  fontSize: "0.9rem",
                }}
              >
                {cantidad}
              </strong>
            </div>
          ))}
        </div>
      </div>

      {/* JUGADORES REGISTRADOS */}

      <div className="cr-card" style={{ marginBottom: "1rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.75rem",
            flexWrap: "wrap",
            marginBottom: "1rem",
          }}
        >
          <h3 style={{ color: "#fff", margin: 0 }}><TCIcon name="users" /> Jugadores registrados</h3>
          <span style={{ color: "#9ca3af", fontSize: "0.8rem" }}>
            {jugadores.length} cuentas
          </span>
        </div>

        <input
          type="search"
          value={busquedaJugador}
          onChange={(e) => setBusquedaJugador(e.target.value)}
          placeholder="Buscar por alias o correo..."
          aria-label="Buscar jugador por alias o correo"
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "0.75rem",
            marginBottom: "1rem",
            borderRadius: "8px",
            border: "1px solid #3b82f6",
            background: "#121019",
            color: "#fff",
            outline: "none",
          }}
        />

        {jugadoresFiltrados.length === 0 ? (
          <p style={{ color: "#9ca3af" }}>
            {jugadores.length === 0
              ? "No hay jugadores registrados."
              : "No hay jugadores que coincidan con la búsqueda."}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {jugadoresFiltrados.map((jugador, index) => (
              <div
                key={jugador.id}
                style={{
                  background: "#121019",
                  border: "1px solid #2d2b3b",
                  borderRadius: "8px",
                  padding: "0.75rem",
                  display: "grid",
                  gridTemplateColumns: "30px minmax(0, 1fr) repeat(2, auto)",
                  gap: "0.75rem",
                  alignItems: "center",
                }}
              >
                <strong style={{ color: "#ffd700" }}>#{index + 1}</strong>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ color: "#fff", display: "block", overflowWrap: "anywhere" }}>
                    {jugador.username}
                  </strong>
                  <span style={{ color: "#60a5fa", fontSize: "0.75rem", display: "block", overflowWrap: "anywhere" }}>
                    <TCIcon name="mail" size={13} /> {jugador.email || "Email no registrado"}
                  </span>
                  <span style={{ color: "#9ca3af", fontSize: "0.7rem", display: "block", marginTop: "3px" }}>
                    Registro: {formatearFecha(jugador.creadoEn)}
                  </span>
                  <span style={{ color: "#9ca3af", fontSize: "0.7rem", display: "block", marginTop: "2px" }}>
                    Última visita: {formatearFecha(jugador.ultimaVisita)}
                  </span>
                </div>
                <div style={{ textAlign: "center" }}>
                  <span style={{ color: "#9ca3af", fontSize: "0.65rem", display: "block" }}>Visitas</span>
                  <strong style={{ color: "#60a5fa" }}>{jugador.visitas}</strong>
                </div>
                <div style={{ textAlign: "center" }}>
                  <span style={{ color: "#9ca3af", fontSize: "0.65rem", display: "block" }}>Dispositivo</span>
                  <span>{jugador.device === "mobile" ? <TCIcon name="mobile" size={16} /> : jugador.device === "desktop" ? <TCIcon name="desktop" size={16} /> : "—"}</span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setJugadorExpandido(
                      jugadorExpandido === jugador.id ? null : jugador.id
                    )
                  }
                  aria-expanded={jugadorExpandido === jugador.id}
                  style={{
                    gridColumn: "2 / -1",
                    justifySelf: "start",
                    padding: "0.45rem 0.7rem",
                    borderRadius: "6px",
                    border: "1px solid #3b82f6",
                    background: "rgba(27, 95, 168, 0.25)",
                    color: "#bfdbfe",
                    cursor: "pointer",
                    fontWeight: "bold",
                    fontSize: "0.75rem",
                  }}
                >
                  {jugadorExpandido === jugador.id
                    ? "▲ Ocultar actividad"
                    : <><TCIcon name="chart" size={14} /> Ver actividad</>}
                </button>
                {jugadorExpandido === jugador.id && (
                  <div
                    style={{
                      gridColumn: "1 / -1",
                      borderTop: "1px solid #2d2b3b",
                      paddingTop: "0.75rem",
                      marginTop: "0.25rem",
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                        gap: "0.5rem",
                        marginBottom: "0.75rem",
                      }}
                    >
                      <div style={{ background: "#1b1a25", borderRadius: "6px", padding: "0.6rem" }}>
                        <span style={{ color: "#9ca3af", fontSize: "0.7rem", display: "block" }}>Tiempo acumulado</span>
                        <strong style={{ color: "#ffd700" }}>{formatearDuracion(jugador.tiempo)}</strong>
                      </div>
                      <div style={{ background: "#1b1a25", borderRadius: "6px", padding: "0.6rem" }}>
                        <span style={{ color: "#9ca3af", fontSize: "0.7rem", display: "block" }}>Sesiones registradas</span>
                        <strong style={{ color: "#60a5fa" }}>{jugador.visitas}</strong>
                      </div>
                    </div>
                    {visitas
                      .filter((visita) => visita.user_id === jugador.id)
                      .sort(
                        (a, b) =>
                          new Date(b.started_at || b.created_at) -
                          new Date(a.started_at || a.created_at)
                      ).length === 0 ? (
                        <p style={{ color: "#9ca3af", fontSize: "0.8rem", marginBottom: 0 }}>
                          Este jugador todavía no tiene visitas registradas.
                        </p>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                          {visitas
                            .filter((visita) => visita.user_id === jugador.id)
                            .sort(
                              (a, b) =>
                                new Date(b.started_at || b.created_at) -
                                new Date(a.started_at || a.created_at)
                            )
                            .map((visita) => (
                              <div
                                key={visita.id}
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  flexWrap: "wrap",
                                  gap: "0.5rem",
                                  padding: "0.6rem",
                                  borderRadius: "6px",
                                  background: "#121019",
                                }}
                              >
                                <div>
                                  <span style={{ color: "#d1d5db", display: "block", fontSize: "0.78rem" }}>
                                    <TCIcon name="calendar" size={13} /> {formatearFecha(visita.started_at || visita.created_at)}
                                  </span>
                                  <span style={{ color: "#9ca3af", fontSize: "0.7rem" }}>
                                    Última actividad: {formatearFecha(visita.last_seen_at)}
                                  </span>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                  <span style={{ color: "#60a5fa", display: "block", fontSize: "0.75rem" }}>
                                    {visita.device === "mobile" ? <><TCIcon name="mobile" size={13} /> Móvil</> : visita.device === "desktop" ? <><TCIcon name="desktop" size={13} /> PC</> : "Dispositivo —"}
                                  </span>
                                  <span style={{ color: "#9ca3af", fontSize: "0.7rem" }}>
                                    Duración: {formatearDuracion(visita.duration_seconds)}
                                  </span>
                                </div>
                              </div>
                            ))}
                        </div>
                      )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ACTIVIDAD RECIENTE */}

      <div className="cr-card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ color: "#fff", marginTop: 0, marginBottom: "1rem" }}>
          <TCIcon name="bolt" /> Quiénes están conectados
        </h3>
        <p style={{ color: "#9ca3af", fontSize: "0.75rem", marginTop: "-0.5rem" }}>
          Actividad registrada durante los últimos 5 minutos.
        </p>

        {sesionesActivas.length === 0 ? (
          <p style={{ color: "#9ca3af" }}>No hay actividad reciente registrada.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {sesionesActivas.map((visita) => (
              <div
                key={visita.user_id || visita.id}
                style={{
                  background: "#121019",
                  border: "1px solid #2d2b3b",
                  borderRadius: "8px",
                  padding: "0.75rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "0.75rem",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <strong style={{ color: "#fff", display: "block" }}>
                    {visita.username || "Visitante anónimo"}
                  </strong>
                  <span style={{ color: "#9ca3af", fontSize: "0.75rem" }}>
                    {visita.email || (visita.user_id ? "Email no registrado" : "Sin iniciar sesión")}
                  </span>
                </div>
                <span style={{ color: "#34d399", fontSize: "0.75rem" }}>
                  ● Activo · {formatearFecha(visita.last_seen_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* HISTORIAL DE VISITAS POR FECHA */}

      <div className="cr-card">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.75rem",
            flexWrap: "wrap",
            marginBottom: "1rem",
          }}
        >
          <h3 style={{ color: "#fff", margin: 0 }}>
            <TCIcon name="calendar" /> Historial de visitas ({visitasFechaSeleccionada.length})
          </h3>
          <label style={{ color: "#d1d5db", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            Fecha:
            <input
              type="date"
              value={fechaFiltroVisitas}
              onChange={(e) => setFechaFiltroVisitas(e.target.value)}
              aria-label="Filtrar historial por fecha"
              style={{
                padding: "0.5rem",
                borderRadius: "6px",
                border: "1px solid #3b82f6",
                background: "#121019",
                color: "#fff",
                colorScheme: "dark",
              }}
            />
          </label>
        </div>

        {visitasFechaSeleccionada.length === 0 ? (
          <p style={{ color: "#9ca3af" }}>No hay visitas registradas para esta fecha.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {visitasFechaSeleccionada.map((visita) => (
              <div
                key={visita.id}
                style={{
                  background: "#121019",
                  border: "1px solid #2d2b3b",
                  borderRadius: "8px",
                  padding: "0.75rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "0.75rem",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <strong style={{ color: "#fff", display: "block" }}>
                    {visita.username || "Visitante anónimo"}
                  </strong>
                  <span style={{ color: "#9ca3af", fontSize: "0.75rem", overflowWrap: "anywhere" }}>
                    {visita.email || (visita.user_id ? "Email no registrado" : "Sin iniciar sesión")}
                  </span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ color: "#60a5fa", fontSize: "0.75rem", display: "block" }}>
                    {formatearFecha(visita.started_at || visita.created_at)}
                  </span>
                  <span style={{ color: "#9ca3af", fontSize: "0.7rem" }}>
                    {visita.device === "mobile" ? <><TCIcon name="mobile" size={13} /> Móvil</> : visita.device === "desktop" ? <><TCIcon name="desktop" size={13} /> PC</> : "Dispositivo desconocido"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function TournamenSportApp() {
  const {
    notice,
    showNotice,
    clearNotice,
    confirmation,
    confirmTournament,
    resolveConfirmation,
  } = useTournamentNotice();
  const [currentUser, setCurrentUser] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [showPassword, setShowPassword] = useState(false);
  const [authInput, setAuthInput] = useState({
    username: "",
    email: "",
    password: "",
  });
  const [activeView, setActiveView] = useState("home");
  const [activeTournament, setActiveTournament] = useState(null);
  const [showChampionCard, setShowChampionCard] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [tournaments, setTournaments] = useState([]);
  const [tournamentCategoryFilter, setTournamentCategoryFilter] = useState("Todas");
  const [loading, setLoading] = useState(false);
  const [editingTournament, setEditingTournament] = useState(false);
  const [deletingTournamentId, setDeletingTournamentId] = useState(null);
  const [registeredProfiles, setRegisteredProfiles] = useState([]);
  const [loadingRegisteredProfiles, setLoadingRegisteredProfiles] = useState(false);
  const [registeredProfilesSearch, setRegisteredProfilesSearch] = useState("");
  const [selectedRegisteredProfileIds, setSelectedRegisteredProfileIds] = useState([]);
  const isAdmin = currentUser?.id === ADMIN_UID;

  useEffect(() => {
    document.documentElement.dataset.tcTheme = "clash";
    document.body.dataset.tcTheme = "clash";
    try {
      localStorage.removeItem("tc_visual_theme");
    } catch {
      // El tema Clash queda como opción fija aunque el almacenamiento esté bloqueado.
    }
  }, []);

  // =========================================================
  // RECUPERAR SESIÓN
  // =========================================================

  useEffect(() => {
    let mounted = true;

    const loadCurrentUser = async () => {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (error) {
        console.error("Error al recuperar sesión:", error);
        return;
      }

      if (!session?.user) {
        if (mounted) setCurrentUser(null);
        return;
      }

      if (session.user.id !== ADMIN_UID) {
        if (mounted) setCurrentUser(null);
        await supabase.auth.signOut();
        return;
      }

      const user = await buildCurrentUser(session.user);

      if (mounted) setCurrentUser(user);
    };

    loadCurrentUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session?.user) {
        if (mounted) setCurrentUser(null);
        return;
      }

      if (session.user.id !== ADMIN_UID) {
        if (mounted) setCurrentUser(null);
        return;
      }

      const user = await buildCurrentUser(session.user);

      if (mounted) setCurrentUser(user);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const buildCurrentUser = async (authUser) => {
    if (!authUser) return null;

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id, username, email")
      .eq("id", authUser.id)
      .maybeSingle();

    if (error) console.error("Error al obtener perfil:", error);

    return {
      id: authUser.id,
      username:
        profile?.username || authUser.user_metadata?.username || "Jugador",
      email: authUser.email || profile?.email || "",
    };
  };

  // =========================================================
  // REGISTRAR ACTIVIDAD DE USUARIOS AUTENTICADOS
  // =========================================================

  useEffect(() => {
    // La pantalla de acceso/registro no cuenta como navegación dentro de la app.
    if (!currentUser) return;

    let cancelado = false;

    const obtenerVisitaId = () => {
      let visitaId = sessionStorage.getItem("tournamentclash_visita_id");

      if (!visitaId) {
        visitaId = crypto.randomUUID();
        sessionStorage.setItem("tournamentclash_visita_id", visitaId);
      }

      return visitaId;
    };

    const registrarOAsociarVisita = async () => {
      const visitaId = obtenerVisitaId();
      const device = window.innerWidth <= 768 ? "mobile" : "desktop";
      const ahora = new Date().toISOString();

      const { data: visitaExistente, error: errorBusqueda } = await supabase
        .from("visitas")
        .select("id, user_id, started_at")
        .eq("id", visitaId)
        .maybeSingle();

      if (cancelado) return;

      if (errorBusqueda) {
        console.error("Error al buscar la visita actual:", errorBusqueda);
        return;
      }

      if (!visitaExistente) {
        const { error } = await supabase.from("visitas").insert({
          id: visitaId,
          user_id: currentUser?.id || null,
          username: currentUser?.username || null,
          email: currentUser?.email || null,
          device,
          started_at: ahora,
          last_seen_at: ahora,
          duration_seconds: 0,
        });

        if (error) console.error("Error al registrar visita:", error);
        return;
      }

      const actualizacion = {
        last_seen_at: ahora,
        device,
      };

      if (currentUser) {
        actualizacion.user_id = currentUser.id;
        actualizacion.username = currentUser.username;
        actualizacion.email = currentUser.email || null;
      }

      const { error: errorActualizacion } = await supabase
        .from("visitas")
        .update(actualizacion)
        .eq("id", visitaId);

      if (errorActualizacion) {
        console.error("Error al actualizar la visita:", errorActualizacion);
      }
    };

    const actualizarTiempo = async () => {
      const visitaId = sessionStorage.getItem("tournamentclash_visita_id");
      if (!visitaId) return;

      const { data, error } = await supabase
        .from("visitas")
        .select("started_at")
        .eq("id", visitaId)
        .maybeSingle();

      if (error || !data?.started_at || cancelado) return;

      const inicio = new Date(data.started_at);
      const ahora = new Date();
      const segundos = Math.max(0, Math.floor((ahora - inicio) / 1000));

      const { error: errorActualizacion } = await supabase
        .from("visitas")
        .update({
          last_seen_at: ahora.toISOString(),
          duration_seconds: segundos,
        })
        .eq("id", visitaId);

      if (errorActualizacion) {
        console.error("Error al actualizar tiempo de visita:", errorActualizacion);
      }
    };

    registrarOAsociarVisita();

    const intervalo = setInterval(actualizarTiempo, 30000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        registrarOAsociarVisita();
      } else {
        actualizarTiempo();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelado = true;
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [currentUser]);

  useEffect(() => {
    fetchTournaments();
  }, [currentUser]);

  const fetchTournaments = async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("tournaments")
      .select("*")
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      console.error("Error al obtener torneos:", error);
    } else {
      const freshTournaments = data || [];
      setTournaments(freshTournaments);
      if (activeTournament?.id) {
        const refreshedActiveTournament = freshTournaments.find((item) => item.id === activeTournament.id);
        if (refreshedActiveTournament) setActiveTournament(refreshedActiveTournament);
      }
    }

    setLoading(false);
  };

  // =========================================================
  // ELIMINAR TORNEO - SOLO ADMIN
  // =========================================================

  const handleDeleteTournament = async (tournament) => {
    if (!currentUser || currentUser.id !== ADMIN_UID) {
      showNotice("❌ No tenés permisos para eliminar torneos.");
      return;
    }

    if (!tournament?.id) {
      showNotice("❌ No se pudo identificar el torneo.");
      return;
    }

    const confirmar = await confirmTournament(
      `⚠️ ELIMINAR TORNEO\n\n` +
        `"${tournament.title}"\n\n` +
        `Esta acción eliminará el torneo de TournamenSport.\n\n` +
        `¿Estás seguro de que querés continuar?`
    );

    if (!confirmar) return;

    setDeletingTournamentId(tournament.id);

    try {
      // Verificar que Supabase realmente haya eliminado una fila.
      // Una operación DELETE sin filas devueltas puede indicar que RLS la bloqueó.
      const { data: deletedRows, error } = await supabase
        .from("tournaments")
        .delete()
        .eq("id", tournament.id)
        .select("id");

      if (error) {
        console.error("Error al eliminar torneo:", error);

        showNotice(
          `❌ Supabase no pudo eliminar el torneo.\n\n${
            error.message || "Revisá las políticas RLS de DELETE en tournaments."
          }`
        );

        return;
      }

      if (!deletedRows || deletedRows.length === 0) {
        console.warn(
          "No se eliminó ninguna fila. Revisar política RLS DELETE y permisos.",
          { tournamentId: tournament.id, userId: currentUser.id }
        );
        showNotice(
          "❌ El torneo sigue en la base de datos. Revisá en Supabase la política RLS de DELETE para la tabla tournaments."
        );
        return;
      }

      setTournaments((prev) => prev.filter((t) => t.id !== tournament.id));

      if (activeTournament?.id === tournament.id) {
        setActiveTournament(null);
        setActiveView("home");
        setEditingTournament(false);
      }

      showNotice("✅ Torneo eliminado correctamente.");
    } catch (error) {
      console.error("Error inesperado al eliminar torneo:", error);

      showNotice("❌ Ocurrió un error al intentar eliminar el torneo.");
    } finally {
      setDeletingTournamentId(null);
    }
  };

  // =========================================================
  // AUTENTICACIÓN
  // =========================================================

  const handleAuthSubmit = async (e) => {
    e.preventDefault();

    const username = authInput.username.trim();
    const email = authInput.email.trim().toLowerCase();
    const password = authInput.password.trim();

    if (authMode === "register") {
      if (!username || !email || !password) {
        showNotice("❌ Completá todos los campos.");
        return;
      }

      if (username.length < 3) {
        showNotice("❌ El alias debe tener al menos 3 caracteres.");
        return;
      }

      if (password.length < 6) {
        showNotice("❌ La contraseña debe tener al menos 6 caracteres.");
        return;
      }

      const { data: existingProfile, error: profileError } = await supabase
        .from("profiles")
        .select("id")
        .ilike("username", username)
        .maybeSingle();

      if (profileError)
        console.error("Error al verificar alias:", profileError);

      if (existingProfile) {
        showNotice("❌ Este alias ya está registrado.");
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { username },
        },
      });

      if (error) {
        console.error("Error al registrar usuario:", error);

        if (error.message?.toLowerCase().includes("already registered")) {
          showNotice("❌ Este email ya está registrado.");
        } else {
          showNotice(`❌ No se pudo registrar el usuario: ${error.message}`);
        }

        return;
      }

      if (!data.session) {
        showNotice(
          "✅ Registro realizado.\n\nRevisá tu correo electrónico para confirmar la cuenta y luego iniciá sesión."
        );

        setAuthInput({
          username: "",
          email: "",
          password: "",
        });

        setAuthMode("login");
        return;
      }

      const user = await buildCurrentUser(data.user);

      setCurrentUser(user);

      setAuthInput({
        username: "",
        email: "",
        password: "",
      });

      return;
    }

    if (!email || !password) {
      showNotice("❌ Ingresá tu email y contraseña.");
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error("Error al iniciar sesión:", error);

      showNotice("❌ Email o contraseña incorrectos.");

      return;
    }

    if (data.user?.id !== ADMIN_UID) {
      await supabase.auth.signOut();
      showNotice("⛔ Esta cuenta no tiene permisos de administrador.");
      setAuthInput({ username: "", email: "", password: "" });
      return;
    }

    const user = await buildCurrentUser(data.user);

    setCurrentUser(user);

    setAuthInput({
      username: "",
      email: "",
      password: "",
    });
    setActiveView("home");
  };

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("Error al cerrar sesión:", error);
      return;
    }

    // La próxima persona que inicie sesión tendrá
    // una visita completamente nueva.
    sessionStorage.removeItem("tournamentclash_visita_id");

    setCurrentUser(null);
    setActiveView("home");
    setActiveTournament(null);
    setEditingTournament(false);
    setJoinCodeInput("");
  };

  const handleGoHome = () => {
    setActiveTournament(null);
    setActiveView("home");
    setEditingTournament(false);
  };

  // =========================================================
  // CREAR TORNEO
  // =========================================================

  const handleCreateTournamentSubmit = async (config) => {
    if (!isAdmin) {
      showNotice("❌ Solo el administrador puede crear torneos.");
      setActiveView("home");
      return;
    }

    const randomCode = "TS-" + Math.floor(1000 + Math.random() * 9000);
    const registrationGroup = {
      id: 0,
      name: "__INSCRIPCIONES__",
      teams: Array.isArray(config.teams) ? config.teams : [],
      matches: [],
      capacity: Number(config.maxParticipants),
      numGroups: config.format === "groups_playoff" ? Number(config.numGroups) : 1,
    };

    const newTournamentObj = {
      code: randomCode,
      title: config.title,
      game: config.game,
      format: config.format,
      qualifiers_per_group: config.qualifiersPerGroup,
      is_public: config.isPublic,
      created_by_user_id: currentUser.id,
      created_by: currentUser.username,
      groups: [registrationGroup],
      playoffs: null,
      status: "Inscripciones",
    };

    const { data, error } = await supabase
      .from("tournaments")
      .insert([newTournamentObj])
      .select();

    if (error) {
      showNotice("❌ Error al guardar el torneo en Supabase.");
      console.error(error);
      return;
    }

    if (data && data.length > 0) {
      setActiveTournament(data[0]);
      setTournaments((prev) => [data[0], ...prev]);
      setActiveView("groups");
    }
  };

  const handleRegisterForTournament = async (tournament) => {
    if (!currentUser || !tournament?.id) return;

    const { data: latest, error: fetchError } = await supabase
      .from("tournaments")
      .select("id, groups, status")
      .eq("id", tournament.id)
      .maybeSingle();

    if (fetchError || !latest) {
      console.error("Error al consultar inscripción:", fetchError);
      showNotice("No se pudo comprobar el estado de las inscripciones. Intentá de nuevo.");
      return;
    }

    if (String(latest.status || "").trim().toLocaleLowerCase("es") !== "inscripciones") {
      showNotice("🔒 Las inscripciones ya están cerradas.");
      await fetchTournaments();
      return;
    }

    const groups = Array.isArray(latest.groups) ? [...latest.groups] : [];
    const registrationIndex = groups.findIndex((group) => group?.name === "__INSCRIPCIONES__");
    if (registrationIndex < 0) {
      showNotice("No se encontró la lista de inscriptos de este torneo.");
      return;
    }

    const registration = { ...groups[registrationIndex] };
    const participants = Array.isArray(registration.teams) ? [...registration.teams] : [];
    if (participants.some((name) => String(name).toLocaleLowerCase("es") === currentUser.username.toLocaleLowerCase("es"))) {
      showNotice("Ya estás inscripto en este torneo.");
      return;
    }

    const capacity = Number(registration.capacity || 0);
    if (capacity > 0 && participants.length >= capacity) {
      showNotice("🚫 El cupo de este torneo ya está completo.");
      await fetchTournaments();
      return;
    }

    participants.push(currentUser.username);
    registration.teams = participants;
    groups[registrationIndex] = registration;

    const { data: updatedRows, error: updateError } = await supabase
      .from("tournaments")
      .update({ groups })
      .eq("id", tournament.id)
      .eq("status", "Inscripciones")
      .select();

    if (updateError || !updatedRows?.length) {
      console.error("Error al guardar la inscripción:", updateError);
      showNotice("No se pudo completar la inscripción. Puede que el torneo haya comenzado o se haya completado el cupo.");
      await fetchTournaments();
      return;
    }

    const updatedTournament = updatedRows[0];
    setTournaments((prev) => prev.map((item) => item.id === updatedTournament.id ? updatedTournament : item));
    if (activeTournament?.id === updatedTournament.id) setActiveTournament(updatedTournament);
    showNotice(`✅ ¡Te inscribiste en "${updatedTournament.title}"!`);
  };

  const handleLoadRegisteredProfiles = async () => {
    setLoadingRegisteredProfiles(true);
    const { data, error } = await supabase.rpc("list_registered_players");
    setLoadingRegisteredProfiles(false);
    if (error) {
      console.error("Error al cargar usuarios registrados:", error);
      showNotice("No se pudo cargar la lista de jugadores. Verificá que la función segura list_registered_players esté creada en Supabase.");
      return;
    }
    setRegisteredProfiles(data || []);
    setSelectedRegisteredProfileIds([]);
  };

  const handleAddSelectedRegisteredProfiles = async () => {
    if (!activeTournament?.id || !currentUser) return;
    if (!isAdmin) {
      showNotice("Solo el administrador puede agregar participantes.");
      return;
    }
    const { data: latest, error: fetchError } = await supabase.from("tournaments")
      .select("id, title, groups, status").eq("id", activeTournament.id).maybeSingle();
    if (fetchError || !latest) {
      console.error("Error al consultar torneo:", fetchError);
      showNotice("No se pudo actualizar el torneo. Volvé a intentarlo.");
      return;
    }
    if (String(latest.status || "").trim().toLocaleLowerCase("es") !== "inscripciones") {
      showNotice("Las inscripciones ya están cerradas.");
      await fetchTournaments();
      return;
    }
    const groups = Array.isArray(latest.groups) ? [...latest.groups] : [];
    const index = groups.findIndex((group) => group?.name === "__INSCRIPCIONES__");
    if (index < 0) {
      showNotice("No se encontró la lista de inscriptos.");
      return;
    }
    const registration = { ...groups[index] };
    const participants = Array.isArray(registration.teams) ? [...registration.teams] : [];
    const capacity = Number(registration.capacity || 0);
    const chosenProfiles = registeredProfiles.filter((profile) => selectedRegisteredProfileIds.includes(profile.id));
    const alreadyRegistered = new Set(participants.map((name) => String(name).toLocaleLowerCase("es")));
    const namesToAdd = chosenProfiles.map((profile) => String(profile.username || "").trim())
      .filter((name) => name && !alreadyRegistered.has(name.toLocaleLowerCase("es")));
    if (!namesToAdd.length) {
      showNotice("Seleccioná al menos un usuario que todavía no esté inscripto.");
      return;
    }
    if (capacity > 0 && participants.length + namesToAdd.length > capacity) {
      showNotice(`La selección supera el cupo. Hay ${participants.length}/${capacity} inscriptos y seleccionaste ${namesToAdd.length} usuarios nuevos.`);
      return;
    }
    registration.teams = [...participants, ...namesToAdd];
    groups[index] = registration;
    const { data: updatedRows, error: updateError } = await supabase.from("tournaments")
      .update({ groups }).eq("id", activeTournament.id).eq("status", "Inscripciones").select();
    if (updateError || !updatedRows?.length) {
      console.error("Error al guardar participantes seleccionados:", updateError);
      showNotice(updateError?.message
        ? `Supabase rechazó la actualización: ${updateError.message}`
        : "No se pudo guardar la lista. Puede que el torneo haya cambiado de estado.");
      return;
    }
    const updatedTournament = updatedRows[0];
    setActiveTournament(updatedTournament);
    setTournaments((prev) => prev.map((item) => item.id === updatedTournament.id ? updatedTournament : item));
    setSelectedRegisteredProfileIds([]);
    showNotice(`Se agregaron ${namesToAdd.length} participante(s) al torneo.`);
  };

  const handleStartRegistrationTournament = async () => {
    if (!activeTournament?.id) return;

    if (!isAdmin) {
      showNotice("Solo el administrador puede dar comienzo al torneo.");
      return;
    }

    const registration = (activeTournament.groups || []).find((group) => group?.name === "__INSCRIPCIONES__");
    const participants = Array.isArray(registration?.teams) ? registration.teams : [];
    const numGroups = activeTournament.format === "groups_playoff" ? Number(registration?.numGroups || 2) : 1;

    if (participants.length < 4) {
      showNotice("Necesitás al menos 4 participantes inscriptos para dar comienzo.");
      return;
    }
    if (participants.length < numGroups) {
      showNotice(`Para armar ${numGroups} grupos necesitás al menos ${numGroups} participantes.`);
      return;
    }

    const detalleInicio = activeTournament.format === "single_elimination" ? "Las inscripciones se cerrarán y se generarán las llaves de eliminación directa." : "Las inscripciones se cerrarán y se generarán los grupos y partidos.";
    const confirmar = await confirmTournament(`¿Dar comienzo a "${activeTournament.title}" con ${participants.length} participantes? ${detalleInicio}`);
    if (!confirmar) return;

    const isDirectElimination = activeTournament.format === "single_elimination";
    const isLeague = activeTournament.format === "league";
    const shuffled = isDirectElimination
      ? [...participants]
      : [...participants].sort(() => Math.random() - 0.5);
    let groups;
    let playoffs = null;

    if (isDirectElimination) {
      // Sin fase de grupos no hay tabla de posiciones: se respeta el orden
      // de inscripción como orden inicial y no se mezclan los participantes.
      groups = [{
        id: 1,
        name: "Llaves de eliminación",
        teams: shuffled,
        matches: [],
      }];
      playoffs = generatePlayoffBrackets(shuffled);
    } else if (isLeague) {
      // Calendario todos contra todos: cada equipo juega una vez por fecha.
      // En liga respetamos el orden de inscripción para que el calendario sea previsible.
      const scheduleTeams = [...participants];
      if (scheduleTeams.length % 2 !== 0) scheduleTeams.push(null);
      const totalRounds = scheduleTeams.length - 1;
      const rounds = [];

      for (let roundIndex = 0; roundIndex < totalRounds; roundIndex++) {
        const roundMatches = [];
        for (let i = 0; i < scheduleTeams.length / 2; i++) {
          const home = scheduleTeams[i];
          const away = scheduleTeams[scheduleTeams.length - 1 - i];
          if (home && away) {
            roundMatches.push({
              round: roundIndex + 1,
              team1: home,
              team2: away,
              score1: null,
              score2: null,
            });
          }
        }
        rounds.push(roundMatches);
        scheduleTeams.splice(1, 0, scheduleTeams.pop());
      }

      // Ordenar las fechas para que el primer participante juegue primero
      // contra el segundo, luego el tercero, etc. (ej.: 1-2 / 3-4).
      const participantOrder = new Map(participants.map((name, index) => [name, index]));
      rounds.sort((a, b) => {
        const opponentA = a.find((match) => match.team1 === participants[0] || match.team2 === participants[0]);
        const opponentB = b.find((match) => match.team1 === participants[0] || match.team2 === participants[0]);
        const indexA = participantOrder.get(opponentA?.team1 === participants[0] ? opponentA.team2 : opponentA?.team1) ?? 0;
        const indexB = participantOrder.get(opponentB?.team1 === participants[0] ? opponentB.team2 : opponentB?.team1) ?? 0;
        return indexA - indexB;
      });

      // Optimizar la localía sobre el calendario completo, no partido por partido.
      // Cada partido puede invertir su orientación; buscamos minimizar repeticiones
      // consecutivas y mantener equilibrados los totales de local/visitante.
      const fixtures = rounds.flatMap((roundMatches, roundIndex) =>
        [...roundMatches]
          .sort((a, b) => {
            const firstA = Math.min(participantOrder.get(a.team1) ?? 0, participantOrder.get(a.team2) ?? 0);
            const firstB = Math.min(participantOrder.get(b.team1) ?? 0, participantOrder.get(b.team2) ?? 0);
            return firstA - firstB;
          })
          .map((match, matchIndex) => ({
            ...match,
            round: roundIndex + 1,
            id: `fecha-${roundIndex + 1}-partido-${matchIndex + 1}`,
          }))
      );

      // Buscamos alternar localía en los partidos consecutivos que juega cada
      // equipo, manteniendo el reparto total lo más equilibrado posible.
      const evaluateOrientation = (orientation) => {
        const venuesByTeam = new Map(participants.map((team) => [team, []]));
        fixtures.forEach((match, index) => {
          const home = orientation[index] ? match.team2 : match.team1;
          const away = orientation[index] ? match.team1 : match.team2;
          venuesByTeam.get(home)?.push({ round: match.round, venue: "L" });
          venuesByTeam.get(away)?.push({ round: match.round, venue: "V" });
        });

        let imbalance = 0;
        let repeats = 0;
        let longRuns = 0;
        let localRepeatRuns = 0;
        let visitorRepeatRuns = 0;
        venuesByTeam.forEach((venues) => {
          venues.sort((a, b) => a.round - b.round);
          let local = 0;
          let visitor = 0;
          let streak = 1;
          for (let i = 0; i < venues.length; i++) {
            if (venues[i].venue === "L") local++;
            else visitor++;
            if (i > 0) {
              if (venues[i].venue === venues[i - 1].venue) {
                repeats++;
                streak++;
                if (venues[i].venue === "L") localRepeatRuns++;
                else visitorRepeatRuns++;
                if (streak >= 3) longRuns++;
              } else {
                streak = 1;
              }
            }
          }
          const minimumDifference = venues.length % 2;
          imbalance += Math.max(0, Math.abs(local - visitor) - minimumDifference);
        });
        // Una repetición de local se compensa con una repetición de visitante.
        // Es preferible alternar, pero si no se puede, evitamos que los
        // equipos acumulen rachas de un solo tipo de localía.
        const repeatImbalance = Math.abs(localRepeatRuns - visitorRepeatRuns);
        return imbalance * 100000 + repeatImbalance * 5000 + repeats * 1000 + longRuns * 100;
      };

      let seed = participants.reduce((sum, name, index) => {
        for (let i = 0; i < name.length; i++) sum = (sum * 31 + name.charCodeAt(i)) >>> 0;
        return (sum + index + 1) >>> 0;
      }, 20261023);
      const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };

      let bestOrientation = fixtures.map(() => false);
      let bestScore = evaluateOrientation(bestOrientation);
      const iterations = Math.max(2500, fixtures.length * fixtures.length * 20);

      // Reinicios deterministas y búsqueda global aproximada: prioriza que
      // cada equipo alterne local/visitante y evita desequilibrios como 5-1.
      for (let attempt = 0; attempt < 48; attempt++) {
        let orientation = fixtures.map(() => random() < 0.5);
        let currentScore = evaluateOrientation(orientation);
        let temperature = 1500;

        for (let step = 0; step < iterations; step++) {
          const candidate = [...orientation];
          const first = Math.floor(random() * fixtures.length);
          candidate[first] = !candidate[first];
          if (fixtures.length > 1 && random() < 0.3) {
            let second = Math.floor(random() * fixtures.length);
            if (second === first) second = (second + 1) % fixtures.length;
            candidate[second] = !candidate[second];
          }

          const candidateScore = evaluateOrientation(candidate);
          const delta = candidateScore - currentScore;
          if (delta < 0 || random() < Math.exp(-delta / temperature)) {
            orientation = candidate;
            currentScore = candidateScore;
          }
          temperature *= 0.996;
          if (currentScore < bestScore) {
            bestScore = currentScore;
            bestOrientation = [...orientation];
          }
          if (bestScore === 0) break;
        }
        if (bestScore === 0) break;
      }

      const matches = fixtures.map((match, index) => {
        const shouldReverse = bestOrientation[index];
        const home = shouldReverse ? match.team2 : match.team1;
        const away = shouldReverse ? match.team1 : match.team2;
        return {
          ...match,
          team1: home,
          team2: away,
          homeTeam: home,
          awayTeam: away,
        };
      });
      groups = [{
        id: 1,
        name: "Todos contra todos",
        teams: shuffled,
        matches,
      }];
    } else {
      groups = Array.from({ length: numGroups }, (_, index) => ({
        id: index + 1,
        name: `Grupo ${String.fromCharCode(65 + index)}`,
        teams: [],
        matches: [],
      }));

      shuffled.forEach((team, index) => groups[index % numGroups].teams.push(team));
      groups.forEach((group) => {
        const teams = group.teams;
        for (let i = 0; i < teams.length; i++) {
          for (let j = i + 1; j < teams.length; j++) {
            group.matches.push({
              id: `${teams[i]}-${teams[j]}`,
              team1: teams[i],
              team2: teams[j],
              score1: null,
              score2: null,
            });
          }
        }
      });
    }

    const { data, error } = await supabase
      .from("tournaments")
      .update({ groups, playoffs, status: "En curso" })
      .eq("id", activeTournament.id)
      .eq("status", "Inscripciones")
      .select();

    if (error || !data?.length) {
      console.error("Error al iniciar torneo:", error);
      showNotice("No se pudo iniciar el torneo. Puede que ya haya comenzado; actualizá la lista e intentá de nuevo.");
      await fetchTournaments();
      return;
    }

    setActiveTournament(data[0]);
    setTournaments((prev) => prev.map((item) => item.id === data[0].id ? data[0] : item));
    setActiveView(data[0].format === "single_elimination" ? "playoffs" : "groups");
    showNotice(data[0].format === "single_elimination"
      ? "🏆 ¡Torneo en marcha! Se generaron las llaves de eliminación directa."
      : "🏆 ¡Torneo en marcha! Los grupos y partidos se generaron automáticamente.");
  };

  // =========================================================
  // EDITAR TORNEO
  // =========================================================

  const tournamentHasResults = (tournament) => {
    const groupMatches = (tournament?.groups || []).flatMap((group) => group.matches || []);
    const playoffRounds = Array.isArray(tournament?.playoffs) ? tournament.playoffs : [];
    const playoffMatches = playoffRounds.flatMap((round) => Array.isArray(round) ? round : []);
    return [...groupMatches, ...playoffMatches].some(
      (match) =>
        match.score1 !== null &&
        match.score1 !== undefined &&
        match.score2 !== null &&
        match.score2 !== undefined &&
        match.team1 !== "Pasaje Directo" &&
        match.team2 !== "Pasaje Directo"
    );
  };

  const isTournamentAdmin = isAdmin;

  const handleEditTournamentSubmit = async (config) => {
    if (!activeTournament) return;

    if (!isTournamentAdmin) {
      showNotice("❌ Solo el administrador puede modificar este torneo.");
      return;
    }

    if (tournamentHasResults(activeTournament)) {
      showNotice(
        "🔒 Este torneo ya tiene resultados cargados. No se puede modificar su organización para proteger los partidos existentes."
      );
      return;
    }

    const shuffled = [...config.teams].sort(() => 0.5 - Math.random());
    const isDirectElimination = config.format === "single_elimination";
    const numGroups = config.format === "groups_playoff" ? config.numGroups : 1;
    const groups = [];

    if (isDirectElimination) {
      groups.push({
        id: 1,
        name: "Llaves de eliminación",
        teams: shuffled,
        matches: [],
      });
    } else {
      for (let i = 0; i < numGroups; i++) {
        groups.push({
          id: i + 1,
          name: `Grupo ${String.fromCharCode(65 + i)}`,
          teams: [],
          matches: [],
        });
      }

      shuffled.forEach((team, idx) => {
        groups[idx % numGroups].teams.push(team);
      });

      groups.forEach((group) => {
        const groupMatches = [];
        const t = group.teams;

        for (let i = 0; i < t.length; i++) {
          for (let j = i + 1; j < t.length; j++) {
            groupMatches.push({
              id: `${t[i]}-${t[j]}`,
              team1: t[i],
              team2: t[j],
              score1: null,
              score2: null,
            });
          }
        }

        group.matches = groupMatches;
      });
    }

    const updatedTournament = {
      ...activeTournament,
      title: config.title,
      game: config.game,
      format: config.format,
      qualifiers_per_group: config.qualifiersPerGroup,
      is_public: config.isPublic,
      groups,
      playoffs: isDirectElimination ? generatePlayoffBrackets(shuffled) : null,
    };

    const { data, error } = await supabase
      .from("tournaments")
      .update({
        title: updatedTournament.title,
        game: updatedTournament.game,
        format: updatedTournament.format,
        qualifiers_per_group: updatedTournament.qualifiers_per_group,
        is_public: updatedTournament.is_public,
        groups: updatedTournament.groups,
        playoffs: updatedTournament.playoffs,
      })
      .eq("id", updatedTournament.id)
      .select();

    if (error) {
      console.error("Error al modificar torneo:", error);

      showNotice("❌ No se pudieron guardar los cambios.");

      return;
    }

    if (data && data.length > 0) {
      setActiveTournament(data[0]);

      setTournaments((prev) =>
        prev.map((t) => (t.id === data[0].id ? data[0] : t))
      );

      setEditingTournament(false);
      if (data[0].format === "single_elimination" && data[0].playoffs?.length) {
        setActiveView("playoffs");
      } else if (data[0].format !== "single_elimination") {
        setActiveView("groups");
      }

      showNotice("✅ Torneo modificado correctamente.");
    }
  };

  const handleUpdateTournamentInSupabase = async (updatedTournament) => {
    if (!isAdmin) {
      showNotice("❌ Solo el administrador puede modificar torneos y resultados.");
      return;
    }
    const currentStatus = String(activeTournament?.status || updatedTournament?.status || "")
      .trim()
      .toLocaleLowerCase("es");
    if (currentStatus === "finalizado") {
      showNotice("🔒 Este torneo ya está finalizado. No se pueden modificar sus resultados.");
      return;
    }

    setActiveTournament(updatedTournament);

    const { error } = await supabase
      .from("tournaments")
      .update({
        groups: updatedTournament.groups,
        playoffs: updatedTournament.playoffs,
        status: updatedTournament.status,
      })
      .eq("id", updatedTournament.id);

    if (error) {
      console.error("Error al actualizar la tabla en Supabase:", error);
    } else {
      setTournaments((prev) =>
        prev.map((t) => (t.id === updatedTournament.id ? updatedTournament : t))
      );
    }
  };

  // =========================================================
  // UNIRSE A TORNEO
  // =========================================================

  const handleJoinTournamentSubmit = (e) => {
    e.preventDefault();

    const cleanCode = joinCodeInput.trim().toUpperCase();

    const found = tournaments.find((t) => t.code === cleanCode);

    if (!found) {
      showNotice("❌ Código de torneo no encontrado en la base de datos.");
      return;
    }

    setActiveTournament(found);
    setShowChampionCard(String(found.status || "").trim().toLocaleLowerCase("es") === "finalizado");

    if (found.playoffs && found.playoffs.length > 0) {
      setActiveView("playoffs");
    } else {
      setActiveView("groups");
    }
  };

  // =========================================================
  // PLAYOFFS
  // =========================================================

  const handleProceedToPlayoffs = () => {
    if (!isAdmin) return;
    const qualifiedTeams = [];

    activeTournament.groups.forEach((group) => {
      const standings = calculateGroupStandings(group.teams, group.matches);
      const topTeams = standings.slice(
        0,
        Number(activeTournament.qualifiers_per_group || 1)
      );

      topTeams.forEach((team) => {
        qualifiedTeams.push({
          ...team,
          groupId: group.id,
          groupName: group.name,
          groupPosition: standings.findIndex((entry) => entry.name === team.name) + 1,
        });
      });
    });

    // Orden general de los clasificados: puntos, diferencia de gol y goles a favor.
    // Si siguen igualados, se conserva el orden de grupo y la posición dentro de este.
    qualifiedTeams.sort((a, b) =>
      b.points - a.points ||
      b.goalDifference - a.goalDifference ||
      b.goalsFor - a.goalsFor ||
      a.groupId - b.groupId ||
      a.groupPosition - b.groupPosition
    );

    const playoffs = generatePlayoffBrackets(
      qualifiedTeams.map((team) => team.name)
    );

    const updated = {
      ...activeTournament,
      playoffs,
    };

    handleUpdateTournamentInSupabase(updated);

    setActiveView("playoffs");
  };

  const handleFinishTournament = async () => {
    if (!isAdmin || !activeTournament) return;
    const format = String(activeTournament?.format || "").trim().toLocaleLowerCase("es");

    if (format === "league") {
      const groups = Array.isArray(activeTournament?.groups) ? activeTournament.groups : [];
      const matches = groups.flatMap((group) => group.matches || []);
      const playedMatches = matches.filter((match) =>
        match.score1 !== null && match.score1 !== undefined &&
        match.score2 !== null && match.score2 !== undefined
      );
      if (!playedMatches.length) {
        showNotice("⚠️ Para finalizar una liga tiene que haberse jugado al menos un partido.");
        return;
      }
    } else {
      const groups = Array.isArray(activeTournament?.groups) ? activeTournament.groups : [];
      const groupMatches = groups.flatMap((group) => group.matches || []);
      const rawPlayoffs = Array.isArray(activeTournament?.playoffs) ? activeTournament.playoffs : [];
      const rounds = rawPlayoffs.length && !Array.isArray(rawPlayoffs[0]) ? [rawPlayoffs] : rawPlayoffs;
      const allMatches = [...groupMatches, ...rounds.flatMap((round) => round || [])];
      const hasIncompleteMatch = allMatches.some((match) => {
        const isBye = match.team1 === "Pasaje Directo" || match.team2 === "Pasaje Directo";
        if (isBye) return false;
        return match.score1 === null || match.score1 === undefined ||
          match.score2 === null || match.score2 === undefined;
      });

      if (!rounds.length || hasIncompleteMatch) {
        showNotice("⚠️ Para finalizar el torneo, primero hay que completar todos los partidos y las llaves eliminatorias.");
        return;
      }

      const finalRound = rounds[rounds.length - 1];
      const finalMatch = Array.isArray(finalRound)
        ? finalRound.find((match) => match.stage === "final") ||
          (finalRound.length === 1 ? finalRound[0] : null)
        : null;
      const champion = finalMatch?.winner ||
        (finalMatch && Number(finalMatch.score1) !== Number(finalMatch.score2)
          ? Number(finalMatch.score1) > Number(finalMatch.score2) ? finalMatch.team1 : finalMatch.team2
          : null);

      if (!champion || champion === "Empate (Definir)") {
        showNotice("⚠️ No se puede finalizar: la gran final debe tener un ganador.");
        return;
      }
    }

    const finishedObj = { ...activeTournament, status: "Finalizado" };
    const { error } = await supabase
      .from("tournaments")
      .update({ status: "Finalizado", groups: finishedObj.groups, playoffs: finishedObj.playoffs })
      .eq("id", finishedObj.id);

    if (error) {
      console.error("Error al finalizar el torneo:", error);
      showNotice("❌ No se pudo finalizar el torneo. Intentá nuevamente.");
      return;
    }

    setActiveTournament(finishedObj);
    setTournaments((prev) => prev.map((t) => t.id === finishedObj.id ? finishedObj : t));
    setShowChampionCard(true);
    showNotice("🏆 ¡Torneo finalizado! El campeón quedó registrado.");
  };

  const tournamentCategories = [...new Set(
    tournaments.map((tournament) =>
      getTournamentCategory(tournament)
    ).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "es"));

  const filteredTournaments = tournamentCategoryFilter === "Todas"
    ? tournaments
    : tournaments.filter((tournament) =>
        getTournamentCategory(tournament) === tournamentCategoryFilter
      );


  return (
    <div className="cr-container tc-theme-clash">
      <TournamentNotice
        notice={notice}
        onClose={clearNotice}
        confirmation={confirmation}
        onResolveConfirmation={resolveConfirmation}
      />
      <Navbar
          onGoHome={handleGoHome}
          currentTitle={activeTournament?.title}
          tournamentCode={activeTournament?.code}
          currentUser={currentUser}
          tournaments={tournaments}
          isAdmin={isAdmin}
          onGoStats={() => setActiveView("stats")}
          onAdminClick={() => setActiveView("admin-login")}
          onLogout={handleLogout}
        />

      {isAdmin && activeTournament && showChampionCard && String(activeTournament.status || "").trim().toLocaleLowerCase("es") === "finalizado" && (
        <ChampionCelebration
          tournament={activeTournament}
          onClose={() => setShowChampionCard(false)}
        />
      )}

      {activeView === "admin-login" && !isAdmin ? (
        <div className="tc-form-screen tc-auth-screen">
        <div className="cr-card tc-auth-card" style={{ margin: "auto" }}>
          <div className="cr-card-glow"></div>

          <div
            style={{
              textAlign: "center",
              marginBottom: "1.5rem",
            }}
          >
            <img
              src="/tc-crest.svg"
              alt="Escudo original de TournamenSport"
              className="tc-login-crest"
            />

            <div className="tc-auth-kicker"><span></span> PLATAFORMA DE TORNEOS DEPORTIVOS <span></span></div>
            <h1 className="cr-logo-title">TournamenSport</h1>
            <p className="tc-auth-tagline">Acceso exclusivo para la administración de FEFUTIN.</p>
          </div>

          <form
            className="tc-auth-form"
            onSubmit={handleAuthSubmit}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
            }}
          >
            {false && authMode === "register" && (
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.75rem",
                    fontWeight: "bold",
                    textTransform: "uppercase",
                    color: "#d1d5db",
                    marginBottom: "4px",
                  }}
                >
                  <span className="tc-auth-field-icon" aria-hidden="true">●</span> Nombre de usuario
                </label>

                <input
                  type="text"
                  placeholder="Ej.: Juan Pérez"
                  value={authInput.username}
                  onChange={(e) =>
                    setAuthInput({
                      ...authInput,
                      username: e.target.value,
                    })
                  }
                  required
                  className="cr-input"
                />
              </div>
            )}

            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.75rem",
                  fontWeight: "bold",
                  textTransform: "uppercase",
                  color: "#d1d5db",
                  marginBottom: "4px",
                }}
              >
                <span className="tc-auth-field-icon" aria-hidden="true">✉</span> Email
              </label>

              <input
                type="email"
                placeholder="Ej: jugador@gmail.com"
                value={authInput.email}
                onChange={(e) =>
                  setAuthInput({
                    ...authInput,
                    email: e.target.value,
                  })
                }
                required
                className="cr-input"
              />
            </div>

            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.75rem",
                  fontWeight: "bold",
                  textTransform: "uppercase",
                  color: "#d1d5db",
                  marginBottom: "4px",
                }}
              >
                <span><span className="tc-auth-field-icon" aria-hidden="true">◆</span> Contraseña</span>
                {authMode === "login" && (
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#60a5fa",
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      cursor: "pointer",
                      padding: "2px 0 2px 8px",
                      textTransform: "none",
                    }}
                  >
                    {showPassword ? "Ocultar" : "Mostrar"}
                  </button>
                )}
              </label>

              <input
                type={authMode === "login" && showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={authInput.password}
                onChange={(e) =>
                  setAuthInput({
                    ...authInput,
                    password: e.target.value,
                  })
                }
                required
                className="cr-input"
              />
            </div>

            <button
              type="submit"
              className="cr-btn-gold tc-auth-submit"
              style={{
                marginTop: "0.5rem",
              }}
            >
              <><TCIcon name="shield" size={17} /> Ingresar como administrador</>
            </button>

            <div style={{ textAlign: "center", marginTop: "0.5rem" }}>
              <button type="button" onClick={() => { setActiveView("home"); setAuthInput({ username: "", email: "", password: "" }); }} style={{ background: "transparent", border: "none", color: "#9ca3af", fontSize: "0.8rem", cursor: "pointer" }}>
                ← Volver a la plataforma pública
              </button>
            </div>
          </form>
        </div>
        </div>
      ) : activeView === "stats" && isAdmin ? (
        <div className="tc-form-screen tc-stats-screen">
          <AdminStats onBack={() => setActiveView("home")} />
        </div>
      ) : activeView === "home" ? (
        <div className="tc-home-screen">
        <section className="tc-arena-hero" aria-label="Bienvenido a la arena de TournamenSport">
          <img src="/tournament-join.svg" alt="Ilustración deportiva de equipos listos para competir" />
          <div className="tc-home-hero-overlay">
            <span className="tc-home-eyebrow">TORNEOS Y COMPETENCIAS DEPORTIVAS</span>
            <h1>TOURNAMEN<span>SPORT</span></h1>
            <p>Organizá. Competí. Compartí el deporte.</p>
            <div className="tc-home-hero-tag"><span></span> TU PRÓXIMA VICTORIA TE ESPERA</div>
          </div>
        </section>
        <div
          className="cr-card tc-home-panel"
          style={{
            width: "100%",
            maxWidth: "980px",
            margin: "auto",
          }}
        >
          {isAdmin && <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "1.5rem",
              paddingBottom: "1rem",
              borderBottom: "1px solid #2d2b3b",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
              }}
            >
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  backgroundColor: "#1b5fa8",
                  borderRadius: "8px",
                  border: "2px solid #ffd700",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "18px",
                }}
              >
                <TCIcon name="crown" size={22} />
              </div>

              <div>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: "bold",
                    color: "#9ca3af",
                    textTransform: "uppercase",
                    display: "block",
                  }}
                >
                  Participante
                </span>

                <h2
                  style={{
                    fontSize: "1.1rem",
                    fontWeight: 900,
                    color: "#ffd700",
                    margin: 0,
                  }}
                >
                  {currentUser.username}
                </h2>
              </div>
            </div>

            <button
              className="tc-home-logout"
              onClick={handleLogout}
              style={{
                padding: "0.35rem 0.75rem",
                backgroundColor: "rgba(127, 29, 29, 0.4)",
                border: "1px solid rgba(239, 68, 68, 0.5)",
                color: "#f87171",
                fontWeight: "bold",
                borderRadius: "6px",
                fontSize: "0.75rem",
                cursor: "pointer",
              }}
            >
              Cerrar Sesión
            </button>
          </div>}

          {/* BOTÓN ADMIN */}

          {isAdmin && (
            <button
              className="tc-home-admin-action"
              onClick={() => setActiveView("stats")}
              style={{
                width: "100%",
                marginBottom: "1rem",
                padding: "0.75rem",
                background: "linear-gradient(to right, #111827, #1e3a5f)",
                border: "1px solid #60a5fa",
                color: "#fff",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: "bold",
              }}
            >
              <TCIcon name="chart" size={17} /> Ver estadísticas
            </button>
          )}

          {isAdmin && <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "0.75rem",
              marginBottom: "1.5rem",
            }}
            className="tc-home-actions"
          >
            <button
              className="tc-home-action tc-home-action-create"
              onClick={() => setActiveView("create")}
              style={{
                padding: "1rem",
                background: "linear-gradient(to bottom, #1b5fa8, #0f3768)",
                border: "2px solid rgba(96, 165, 250, 0.5)",
                borderRadius: "10px",
                textAlign: "left",
                cursor: "pointer",
                color: "#fff",
              }}
            >
              <div className="tc-home-action-icon">
                <TCIcon name="trophy" size={25} />
              </div>

              <h3
                style={{
                  fontWeight: 900,
                  fontSize: "0.85rem",
                  margin: "0 0 2px 0",
                }}
              >
                Armar Torneo
              </h3>

              <p
                style={{
                  fontSize: "10px",
                  color: "#bfdbfe",
                  margin: 0,
                }}
              >
                Sincronizado en la nube
              </p>
            </button>

            <button
              className="tc-home-action tc-home-action-join"
              onClick={() => setActiveView("join")}
              style={{
                padding: "1rem",
                background: "linear-gradient(to bottom, #581c87, #1e142e)",
                border: "2px solid rgba(168, 85, 247, 0.5)",
                borderRadius: "10px",
                textAlign: "left",
                cursor: "pointer",
                color: "#fff",
              }}
            >
              <div className="tc-home-action-icon">
                <TCIcon name="search" size={25} />
              </div>

              <h3
                style={{
                  fontWeight: 900,
                  fontSize: "0.85rem",
                  margin: "0 0 2px 0",
                }}
              >
                Unirme
              </h3>

              <p
                style={{
                  fontSize: "10px",
                  color: "#e9d5ff",
                  margin: 0,
                }}
              >
                Entra con código
              </p>
            </button>
          </div>}

          <div className="tc-home-tournaments">
            <div
              className="tc-home-tournaments-heading"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "0.75rem",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
              >
                <TCIcon name="bolt" size={17} />

                <h3
                  style={{
                    fontWeight: 900,
                    fontSize: "0.85rem",
                    textTransform: "uppercase",
                    color: "#e5e7eb",
                    margin: 0,
                  }}
                >
                  Torneos en la Nube
                </h3>
              </div>

              <button
                onClick={fetchTournaments}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#60a5fa",
                  fontSize: "0.75rem",
                  cursor: "pointer",
                }}
              >
                <TCIcon name="refresh" size={13} /> Recargar
              </button>
            </div>

            <div style={{ marginBottom: "0.75rem" }}>
              <label
                htmlFor="tournament-category-filter"
                style={{
                  display: "block",
                  marginBottom: "0.35rem",
                  color: "#d1d5db",
                  fontSize: "0.72rem",
                  fontWeight: 800,
                  textTransform: "uppercase",
                }}
              >
                Buscar torneos por categoría
              </label>
              <select
                id="tournament-category-filter"
                value={tournamentCategoryFilter}
                onChange={(e) => setTournamentCategoryFilter(e.target.value)}
                className="cr-input"
                style={{ width: "100%" }}
              >
                <option value="Todas">Todas las categorías</option>
                {tournamentCategories.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </div>

            {loading ? (
              <p
                style={{
                  textAlign: "center",
                  color: "#9ca3af",
                  fontSize: "0.85rem",
                }}
              >
                Cargando torneos...
              </p>
            ) : filteredTournaments.length === 0 ? (
              <p
                style={{
                  textAlign: "center",
                  color: "#9ca3af",
                  fontSize: "0.85rem",
                }}
              >
                No hay torneos activos creados aún.
              </p>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                  maxHeight: "240px",
                  overflowY: "auto",
                }}
              >
                {filteredTournaments.map((t) => (
                  <div
                    className="tc-home-tournament-item"
                    key={t.id}
                    onClick={() => {
                      setActiveTournament(t);
                      setShowChampionCard(String(t.status || "").trim().toLocaleLowerCase("es") === "finalizado");

                      setActiveView(
                        t.playoffs && t.playoffs.length > 0
                          ? "playoffs"
                          : "groups"
                      );
                    }}
                    style={{
                      padding: "0.75rem",
                      backgroundColor: "#121019",
                      border: "2px solid #2d2b3b",
                      borderRadius: "10px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "0.75rem",
                      cursor: "pointer",
                    }}
                  >
                    <div
                      style={{
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          marginBottom: "2px",
                          flexWrap: "wrap",
                        }}
                      >
                        {t.is_public ? (
                          <span
                            style={{
                              fontSize: "9px",
                              backgroundColor: "rgba(27, 95, 168, 0.4)",
                              color: "#93c5fd",
                              fontWeight: "bold",
                              padding: "2px 6px",
                              borderRadius: "4px",
                              border: "1px solid rgba(59, 130, 246, 0.3)",
                            }}
                          >
                            {t.code}
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: "9px",
                              backgroundColor: "rgba(127, 29, 29, 0.4)",
                              color: "#fca5a5",
                              fontWeight: "bold",
                              padding: "2px 6px",
                              borderRadius: "4px",
                              border: "1px solid rgba(239, 68, 68, 0.3)",
                            }}
                          >
                            <><TCIcon name="lock" size={12} /> Privado</>
                          </span>
                        )}

                        <span
                          style={{
                            fontSize: "10px",
                            fontWeight: "bold",
                            color: "#ffd700",
                          }}
                        >
                          <TCIcon name="crown" size={13} /> {t.created_by}
                        </span>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          flexWrap: "wrap",
                          gap: "0.45rem",
                          minWidth: 0,
                        }}
                      >
                        <h4
                          style={{
                            fontWeight: 900,
                            fontSize: "0.85rem",
                            margin: 0,
                            color: "#fff",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {t.title}
                        </h4>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "3px 7px",
                            borderRadius: "5px",
                            background: "rgba(249, 115, 22, 0.14)",
                            border: "1px solid rgba(249, 115, 22, 0.55)",
                            color: "#fdba74",
                            fontSize: "0.65rem",
                            fontWeight: 800,
                            lineHeight: 1.3,
                          }}
                        >
                          {getTournamentCategory(t)}
                        </span>
                      </div>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.6rem",
                        flexShrink: 0,
                      }}
                    >
                    {String(t.status || "").trim().toLocaleLowerCase("es") === "inscripciones" && (
                      <button
                        type="button"
                        disabled={(() => {
                          const registration = (t.groups || []).find((group) => group?.name === "__INSCRIPCIONES__");
                          const teams = registration?.teams || [];
                          const alreadyRegistered = teams.some((name) => String(name).toLocaleLowerCase("es") === currentUser.username.toLocaleLowerCase("es"));
                          const full = Number(registration?.capacity || 0) > 0 && teams.length >= Number(registration.capacity);
                          return alreadyRegistered || full;
                        })()}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRegisterForTournament(t);
                        }}
                        style={{
                          padding: "0.5rem 0.65rem",
                          background: "linear-gradient(135deg, #166534, #14532d)",
                          border: "1px solid #4ade80",
                          borderRadius: "8px",
                          color: "#dcfce7",
                          fontSize: "0.68rem",
                          fontWeight: 900,
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                          opacity: (() => {
                            const registration = (t.groups || []).find((group) => group?.name === "__INSCRIPCIONES__");
                            const teams = registration?.teams || [];
                            const alreadyRegistered = teams.some((name) => String(name).toLocaleLowerCase("es") === currentUser.username.toLocaleLowerCase("es"));
                            const full = Number(registration?.capacity || 0) > 0 && teams.length >= Number(registration.capacity);
                            return alreadyRegistered || full ? 0.55 : 1;
                          })(),
                        }}
                      >
                        {(() => {
                          const registration = (t.groups || []).find((group) => group?.name === "__INSCRIPCIONES__");
                          const teams = registration?.teams || [];
                          const alreadyRegistered = teams.some((name) => String(name).toLocaleLowerCase("es") === currentUser.username.toLocaleLowerCase("es"));
                          const full = Number(registration?.capacity || 0) > 0 && teams.length >= Number(registration.capacity);
                          return alreadyRegistered ? "✓ Inscripto" : full ? "Cupo completo" : "📝 Inscripción";
                        })()}
                      </button>
                    )}
                    <div
                      style={{
                        textAlign: "right",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 900,
                          color:
                            String(t.status || "").trim().toLocaleLowerCase("es") === "en curso" ? "#34d399" :
                            String(t.status || "").trim().toLocaleLowerCase("es") === "inscripciones" ? "#facc15" : "#60a5fa",
                          display: "block",
                        }}
                      >
                        {t.status}
                      </span>

                      <span
                        style={{
                          fontSize: "9px",
                          color: "#9ca3af",
                          fontWeight: 500,
                        }}
                      >
                        Entrar ➔
                      </span>
                    </div>

                      {/* BOTÓN ELIMINAR - SOLO ADMIN */}

                      {isAdmin && (
                        <button
                          type="button"
                          title="Eliminar torneo"
                          disabled={deletingTournamentId === t.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteTournament(t);
                          }}
                          style={{
                            width: "34px",
                            height: "34px",
                            flexShrink: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background:
                              deletingTournamentId === t.id
                                ? "#374151"
                                : "rgba(127, 29, 29, 0.35)",
                            border:
                              deletingTournamentId === t.id
                                ? "1px solid #4b5563"
                                : "1px solid rgba(239, 68, 68, 0.45)",
                            borderRadius: "6px",
                            color:
                              deletingTournamentId === t.id
                                ? "#9ca3af"
                                : "#f87171",
                            cursor:
                              deletingTournamentId === t.id
                                ? "not-allowed"
                                : "pointer",
                            fontSize: "15px",
                          }}
                        >
                          {deletingTournamentId === t.id ? "…" : <TCIcon name="trash" size={16} />}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        </div>
      ) : activeView === "create" && isAdmin ? (
        <div className="tc-form-screen tc-create-screen">
        <div className="tc-create-artwork">
          <img src="/tournament-join.svg" alt="Equipos deportivos preparados para una competencia" />
          <div><strong>ORGANIZÁ TU TORNEO</strong><span>Elegí el deporte, definí la categoría y prepará la competencia.</span></div>
        </div>
        <CreateTournament
          onSave={handleCreateTournamentSubmit}
          onCancel={() => setActiveView("home")}
        />
        </div>
      ) : activeView === "edit" && isAdmin ? (
        <div className="tc-form-screen tc-edit-screen">
        <CreateTournament
          isEditing={true}
          initialData={activeTournament}
          onSave={handleEditTournamentSubmit}
          onCancel={() => {
            setEditingTournament(false);
            setActiveView("groups");
          }}
        />
        </div>
      ) : activeView === "join" && isAdmin ? (
        <div className="tc-form-screen tc-join-screen">
        <div className="tc-join-artwork">
          <img src="/tournament-join.svg" alt="Ilustración de una competencia deportiva" />
        </div>
        <div
          className="cr-card"
          style={{
            maxWidth: "420px",
            margin: "auto",
          }}
        >
          <div className="cr-card-glow"></div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "1.5rem",
            }}
          >
            <h2
              className="cr-title"
              style={{
                fontSize: "1.1rem",
              }}
            >
              <TCIcon name="key" /> Unirse a Torneo
            </h2>

            <button
              onClick={() => setActiveView("home")}
              style={{
                background: "transparent",
                border: "none",
                color: "#9ca3af",
                cursor: "pointer",
                fontWeight: "bold",
                fontSize: "0.85rem",
              }}
            >
              <span className="tc-close-symbol" aria-hidden="true">✕</span> Volver
            </button>
          </div>

          <form
            onSubmit={handleJoinTournamentSubmit}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
            }}
          >
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.75rem",
                  fontWeight: "bold",
                  textTransform: "uppercase",
                  color: "#d1d5db",
                  marginBottom: "4px",
                }}
              >
                Buscá tu torneo por código de invitación
              </label>

              <input
                type="text"
                placeholder="Ej.: TS-4829"
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value)}
                required
                className="cr-input"
                style={{
                  textAlign: "center",
                  fontSize: "1.1rem",
                  letterSpacing: "2px",
                  fontWeight: 900,
                }}
              />
            </div>

            <button
              type="submit"
              className="cr-btn-gold"
              style={{
                marginTop: "0.5rem",
              }}
            >
              <TCIcon name="search" /> Buscar torneo
            </button>
          </form>
        </div>
        </div>
      ) : activeView === "groups" ? (
        <div
          className="tc-competition-screen tc-groups-screen"
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "1rem",
          }}
        >
          {String(activeTournament?.status || "").trim().toLocaleLowerCase("es") === "inscripciones" ? (
            <div className="cr-card" style={{ width: "100%", maxWidth: "900px", boxSizing: "border-box" }}>
              <div className="cr-card-glow"></div>
              {(() => {
                const registration = (activeTournament.groups || []).find((group) => group?.name === "__INSCRIPCIONES__");
                const participants = Array.isArray(registration?.teams) ? registration.teams : [];
                const capacity = Number(registration?.capacity || 0);
                const canManage = isAdmin;
                return (
                  <>
                    <h2 className="cr-title" style={{ marginBottom: "0.5rem" }}>📝 Inscripciones abiertas</h2>
                    <p style={{ color: "#9ca3af", marginTop: 0 }}>{activeTournament.title} · {participants.length}/{capacity} participantes</p>
                    <div style={{ height: "8px", background: "#272532", borderRadius: "8px", overflow: "hidden", marginBottom: "1rem" }}>
                      <div style={{ width: `${Math.min(100, capacity ? participants.length / capacity * 100 : 0)}%`, height: "100%", background: "linear-gradient(90deg, #1b5fa8, #ffd700)" }} />
                    </div>
                    {participants.length ? (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.5rem", marginBottom: "1rem" }}>
                        {participants.map((name, index) => (
                          <div key={name} style={{ padding: "0.65rem", borderRadius: "8px", background: "#121019", border: "1px solid #2d2b3b", color: "#fff" }}>
                            <span style={{ color: "#ffd700", marginRight: "0.4rem" }}>#{index + 1}</span>{name}
                          </div>
                        ))}
                      </div>
                    ) : <p style={{ color: "#9ca3af" }}>Todavía no hay jugadores inscriptos.</p>}
                    <p style={{ color: "#9ca3af", fontSize: "0.8rem" }}>El creador dará comienzo al torneo cuando esté listo. Al iniciar, se cerrarán las inscripciones y se sortearán los grupos y partidos.</p>
                    {canManage && (
                      <div style={{ marginTop: "1rem", padding: "0.85rem", background: "#171522", border: "1px solid #3b82f6", borderRadius: "10px" }}>
                        <h3 style={{ color: "#fff", margin: "0 0 0.35rem" }}><TCIcon name="users" /> Agregar jugadores registrados</h3>
                        <p style={{ color: "#9ca3af", fontSize: "0.78rem", marginTop: 0 }}>Seleccioná cuentas existentes por alias. Solo se muestran los nombres públicos y se respeta el cupo.</p>
                        <button type="button" onClick={handleLoadRegisteredProfiles} disabled={loadingRegisteredProfiles} style={{ width: "100%", padding: "0.65rem", borderRadius: "8px", background: "#1b5fa8", border: "1px solid #60a5fa", color: "#fff", cursor: loadingRegisteredProfiles ? "wait" : "pointer", fontWeight: "bold" }}>
                          {loadingRegisteredProfiles ? "Cargando usuarios..." : registeredProfiles.length ? "↻ Recargar lista de usuarios" : "Cargar lista de usuarios"}
                        </button>
                        {registeredProfiles.length > 0 && (
                          <>
                            <input type="search" value={registeredProfilesSearch} onChange={(e) => setRegisteredProfilesSearch(e.target.value)} placeholder="Filtrar por alias o correo..." aria-label="Filtrar usuarios registrados" style={{ width: "100%", boxSizing: "border-box", margin: "0.65rem 0", padding: "0.65rem", borderRadius: "7px", border: "1px solid #4b5563", background: "#121019", color: "#fff" }} />
                            <div style={{ maxHeight: "260px", overflowY: "auto", display: "grid", gap: "0.35rem" }}>
                              {registeredProfiles.filter((profile) => {
                                const query = registeredProfilesSearch.trim().toLocaleLowerCase("es");
                                return !query || String(profile.username || "").toLocaleLowerCase("es").includes(query);
                              }).map((profile) => {
                                const isAlreadyRegistered = participants.some((name) => String(name).toLocaleLowerCase("es") === String(profile.username || "").toLocaleLowerCase("es"));
                                return (
                                  <label key={profile.id} style={{ display: "flex", gap: "0.6rem", alignItems: "center", padding: "0.55rem", borderRadius: "7px", background: "#121019", color: isAlreadyRegistered ? "#6b7280" : "#e5e7eb", fontSize: "0.82rem", cursor: isAlreadyRegistered ? "not-allowed" : "pointer" }}>
                                    <input type="checkbox" checked={isAlreadyRegistered || selectedRegisteredProfileIds.includes(profile.id)} disabled={isAlreadyRegistered} onChange={(e) => setSelectedRegisteredProfileIds((prev) => e.target.checked ? [...prev, profile.id] : prev.filter((id) => id !== profile.id))} />
                                    <span style={{ flex:  1, minWidth: 0, overflowWrap: "anywhere" }}>{profile.username || "Sin alias"}</span>
                                    {isAlreadyRegistered && <span>✓ Inscripto</span>}
                                  </label>
                                );
                              })}
                            </div>
                            <button type="button" onClick={handleAddSelectedRegisteredProfiles} disabled={!selectedRegisteredProfileIds.length} className="cr-btn-gold" style={{ width: "100%", marginTop: "0.65rem", opacity: selectedRegisteredProfileIds.length ? 1 : 0.55 }}><TCIcon name="plus" size={15} /> Agregar seleccionados ({selectedRegisteredProfileIds.length})</button>
                          </>
                        )}
                      </div>
                    )}
                    {canManage && (
                      <button type="button" className="cr-btn-gold" onClick={handleStartRegistrationTournament} style={{ width: "100%", marginTop: "0.5rem" }}>
                        <TCIcon name="flag" /> Dar comienzo al torneo
                      </button>
                    )}
                    <button type="button" onClick={fetchTournaments} style={{ marginTop: "0.65rem", width: "100%", padding: "0.65rem", borderRadius: "8px", background: "#121019", border: "1px solid #3b82f6", color: "#93c5fd", cursor: "pointer" }}>
                      <TCIcon name="refresh" /> Actualizar inscriptos
                    </button>
                  </>
                );
              })()}
            </div>
          ) : (
            <GroupStageView
              tournament={activeTournament}
              onUpdateTournament={handleUpdateTournamentInSupabase}
              onProceedToPlayoffs={handleProceedToPlayoffs}
              currentUser={currentUser}
              isAdmin={isAdmin}
            />
          )}

          {(isTournamentAdmin || isAdmin) && activeTournament.status !== "Finalizado" && String(activeTournament.status || "").trim().toLocaleLowerCase("es") !== "inscripciones" && (
            <div
              style={{
                width: "100%",
                maxWidth: "900px",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: "0.5rem",
                flexWrap: "wrap",
                marginTop: "0.25rem",
              }}
            >
              {isTournamentAdmin && (
                <button
                  onClick={() => {
                    if (tournamentHasResults(activeTournament)) {
                      showNotice(
                        "🔒 Este torneo ya tiene resultados cargados. No se puede modificar su organización."
                      );
                      return;
                    }

                    setEditingTournament(true);
                    setActiveView("edit");
                  }}
                  className="cr-btn-gold"
                  style={adminTournamentButtonStyle}
                >
                  <TCIcon name="settings" /> Modificar torneo
                </button>
              )}
              {(isTournamentAdmin || isAdmin) &&
                String(activeTournament.status || "").trim().toLocaleLowerCase("es") !== "finalizado" &&
                String(activeTournament.format || "").trim().toLocaleLowerCase("es") === "league" && (
                  <button
                    type="button"
                    onClick={handleFinishTournament}
                    className="cr-btn-gold"
                    style={adminTournamentButtonStyle}
                  >
                    <TCIcon name="flag" /> Finalizar torneo
                  </button>
                )}
            </div>
          )}
        </div>
      ) : (
        <div
          className="tc-competition-screen tc-playoffs-screen"
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "1rem",
          }}
        >
          <PlayoffBracket
            tournament={activeTournament}
            onUpdateTournament={handleUpdateTournamentInSupabase}
            onFinishTournament={handleFinishTournament}
            isAdmin={isAdmin}
          />

          {(isTournamentAdmin || isAdmin) && activeTournament.status !== "Finalizado" && (
            <div
              style={{
                width: "100%",
                maxWidth: "600px",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: "0.5rem",
                flexWrap: "wrap",
                marginTop: "0.25rem",
              }}
            >
              {isTournamentAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    if (tournamentHasResults(activeTournament)) {
                      showNotice(
                        "🔒 Este torneo ya tiene resultados cargados. No se puede modificar su organización."
                      );
                      return;
                    }

                    setEditingTournament(true);
                    setActiveView("edit");
                  }}
                  className="cr-btn-gold"
                  style={adminTournamentButtonStyle}
                >
                  <TCIcon name="settings" /> Modificar torneo
                </button>
              )}
              {(isTournamentAdmin || isAdmin) && (
                <button
                  type="button"
                  onClick={handleFinishTournament}
                  className="cr-btn-gold"
                  style={adminTournamentButtonStyle}
                >
                  <TCIcon name="flag" /> Finalizar torneo
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TournamenSportApp;
