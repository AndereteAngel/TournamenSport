import {
  calculateGroupStandings,
  generatePlayoffBrackets,
} from "./utils/tournamentLogic";
import { useEffect, useState } from "react";

import { CreateTournament } from "./components/CreateTournament";
import { GroupStageView } from "./components/GroupStageView";
import { Navbar } from "./components/Navbar";
import { RefereeCarnets } from "./components/RefereeCarnets";
import { TCIcon } from "./components/TCIcon";
import { TournamentNotice, useTournamentNotice } from "./components/TournamentNotice";
import { PlayoffBracket } from "./components/PlayoffBracket";
import { ChampionCelebration } from "./components/ChampionCelebration";
import { supabase } from "./supabaseClient";

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


function RefereeStats({ onBack, canManageAccess = false, onDeactivateReferee }) {
  const [perfiles, setPerfiles] = useState([]);
  const [carnets, setCarnets] = useState([]);
  const [torneos, setTorneos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [arbitroSeleccionado, setArbitroSeleccionado] = useState(null);
  const [mesCalendario, setMesCalendario] = useState(() => {
    const hoy = new Date();
    return new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  });
  const [diaCalendarioSeleccionado, setDiaCalendarioSeleccionado] = useState(null);

  const cargarEstadisticas = async () => {
    setLoading(true);
    setError("");
    const [
      { data: perfilesData, error: perfilesError },
      { data: torneosData, error: torneosError },
      { data: carnetsData, error: carnetsError },
    ] = await Promise.all([
      supabase.from("profiles")
        .select("id, username, role, approval_status, deactivated_at")
        .order("username", { ascending: true }),
      supabase.from("tournaments").select("*"),
      supabase.rpc("get_fefutin_referee_carnets"),
    ]);

    if (perfilesError || torneosError) {
      console.error("Error al cargar estadísticas arbitrales:", { perfilesError, torneosError });
      setError(perfilesError
        ? "No se pudo cargar la lista de árbitros. Revisá los permisos de lectura de profiles en Supabase."
        : "No se pudieron cargar los torneos para calcular las estadísticas.");
      setLoading(false);
      return;
    }

    if (carnetsError) {
      console.warn("No se pudieron cargar los nombres de los carnets; se usará el nombre del perfil:", carnetsError);
    }
    setPerfiles(perfilesData || []);
    setCarnets(carnetsData || []);
    setTorneos(torneosData || []);
    setLoading(false);
  };

  useEffect(() => {
    cargarEstadisticas();
  }, []);

  const estadisticasPorId = {};
  const registrarPartido = (match, tournament) => {
    const refereeId = match?.referee_id;
    const scoreLocal = Number(match?.score1);
    const scoreVisitante = Number(match?.score2);
    const team1 = String(match?.team1 || "").trim();
    const team2 = String(match?.team2 || "").trim();

    if (!refereeId ||
        match?.score1 === null || match?.score1 === undefined ||
        match?.score2 === null || match?.score2 === undefined ||
        !Number.isFinite(scoreLocal) || !Number.isFinite(scoreVisitante) ||
        !team1 || !team2 ||
        team1.toLocaleLowerCase("es") === "pasaje directo" ||
        team2.toLocaleLowerCase("es") === "pasaje directo") return;

    if (!estadisticasPorId[refereeId]) {
      const perfil = perfiles.find((item) => item.id === refereeId);
      const carnet = carnets.find((item) => item.id === refereeId);
      estadisticasPorId[refereeId] = {
        id: refereeId,
        nombre: [carnet?.first_name, carnet?.last_name].filter(Boolean).join(" ") || perfil?.username || carnet?.username || "Árbitro",
        partidos: 0,
        victoriasLocales: 0,
        victoriasVisitantes: 0,
        empates: 0,
        golesLocal: 0,
        golesVisitante: 0,
        golesTotales: 0,
        porRama: {},
      };
    }

    const stats = estadisticasPorId[refereeId];
    const rama = String(tournament?.game || "").split(" · ")[1] || "Sin rama";
    stats.partidos += 1;
    if (scoreLocal > scoreVisitante) stats.victoriasLocales += 1;
    else if (scoreVisitante > scoreLocal) stats.victoriasVisitantes += 1;
    else stats.empates += 1;
    stats.golesLocal += scoreLocal;
    stats.golesVisitante += scoreVisitante;
    stats.golesTotales += scoreLocal + scoreVisitante;
    stats.porRama[rama] = (stats.porRama[rama] || 0) + 1;
  };

  torneos.forEach((tournament) => {
    (Array.isArray(tournament.groups) ? tournament.groups : []).forEach((group) => {
      (Array.isArray(group?.matches) ? group.matches : []).forEach((match) => registrarPartido(match, tournament));
    });
    (Array.isArray(tournament.playoffs) ? tournament.playoffs : []).forEach((round) => {
      (Array.isArray(round) ? round : []).forEach((match) => registrarPartido(match, tournament));
    });
  });

  perfiles
    .filter((perfil) => perfil.role === "arbitro" && perfil.approval_status === "aprobado" && !perfil.deactivated_at)
    .forEach((perfil) => {
      if (!estadisticasPorId[perfil.id]) {
        const carnet = carnets.find((item) => item.id === perfil.id);
        estadisticasPorId[perfil.id] = {
          id: perfil.id,
          nombre: [carnet?.first_name, carnet?.last_name].filter(Boolean).join(" ") || perfil.username || carnet?.username || "Árbitro",
          partidos: 0,
          victoriasLocales: 0,
          victoriasVisitantes: 0,
          empates: 0,
          golesLocal: 0,
          golesVisitante: 0,
          golesTotales: 0,
          porRama: {},
        };
      }
    });

  const estadisticas = Object.values(estadisticasPorId)
    .sort((a, b) => b.partidos - a.partidos || a.nombre.localeCompare(b.nombre, "es"));
  const arbitroActual = estadisticas.find((item) => item.id === arbitroSeleccionado);
  const partidosDirigidos = arbitroSeleccionado
    ? torneos.flatMap((tournament) => {
        const partidosGrupos = (Array.isArray(tournament.groups) ? tournament.groups : []).flatMap((group, groupIndex) =>
          (Array.isArray(group?.matches) ? group.matches : [])
            .filter((match) =>
              match?.referee_id === arbitroSeleccionado &&
              match?.score1 !== null && match?.score1 !== undefined &&
              match?.score2 !== null && match?.score2 !== undefined &&
              Number.isFinite(Number(match.score1)) &&
              Number.isFinite(Number(match.score2)) &&
              String(match.team1 || "").trim() &&
              String(match.team2 || "").trim() &&
              String(match.team1 || "").trim().toLocaleLowerCase("es") !== "pasaje directo" &&
              String(match.team2 || "").trim().toLocaleLowerCase("es") !== "pasaje directo"
            )
            .map((match, matchIndex) => ({
              ...match,
              torneo: tournament.title || "Torneo sin nombre",
              rama: String(tournament.game || "").split(" · ")[1] || "Sin rama",
              instancia: group?.name || `Grupo ${groupIndex + 1}`,
              orden: match.result_loaded_at ? new Date(match.result_loaded_at).getTime() : 0,
              clave: `${tournament.id || tournament.title}-grupo-${groupIndex}-partido-${matchIndex}`,
            }))
        );

        const partidosPlayoffs = (Array.isArray(tournament.playoffs) ? tournament.playoffs : []).flatMap((round, roundIndex) =>
          (Array.isArray(round) ? round : [])
            .filter((match) =>
              match?.referee_id === arbitroSeleccionado &&
              match?.score1 !== null && match?.score1 !== undefined &&
              match?.score2 !== null && match?.score2 !== undefined &&
              Number.isFinite(Number(match.score1)) &&
              Number.isFinite(Number(match.score2)) &&
              String(match.team1 || "").trim() &&
              String(match.team2 || "").trim() &&
              String(match.team1 || "").trim().toLocaleLowerCase("es") !== "pasaje directo" &&
              String(match.team2 || "").trim().toLocaleLowerCase("es") !== "pasaje directo"
            )
            .map((match, matchIndex) => ({
              ...match,
              torneo: tournament.title || "Torneo sin nombre",
              rama: String(tournament.game || "").split(" · ")[1] || "Sin rama",
              instancia: `Eliminatorias · Ronda ${roundIndex + 1}`,
              orden: match.result_loaded_at ? new Date(match.result_loaded_at).getTime() : 0,
              clave: `${tournament.id || tournament.title}-playoff-${roundIndex}-partido-${matchIndex}`,
            }))
        );

        return [...partidosGrupos, ...partidosPlayoffs];
      }).sort((a, b) => b.orden - a.orden)
    : [];

  const actividadCalendario = {};
  const obtenerDiaArgentina = (fecha) => {
    if (!fecha) return null;
    const instante = new Date(fecha);
    if (Number.isNaN(instante.getTime())) return null;
    const partes = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instante);
    const valores = Object.fromEntries(partes.map((parte) => [parte.type, parte.value]));
    return `${valores.year}-${valores.month}-${valores.day}`;
  };

  if (arbitroSeleccionado) {
    const registrarActividadCalendario = (match) => {
      if (match?.referee_id !== arbitroSeleccionado ||
          match?.score1 === null || match?.score1 === undefined ||
          match?.score2 === null || match?.score2 === undefined) return;
      const dia = obtenerDiaArgentina(match.result_loaded_at);
      if (!dia) return;
      actividadCalendario[dia] = (actividadCalendario[dia] || 0) + 1;
    };

    torneos.forEach((tournament) => {
      (Array.isArray(tournament.groups) ? tournament.groups : []).forEach((group) => {
        (Array.isArray(group?.matches) ? group.matches : []).forEach(registrarActividadCalendario);
      });
      (Array.isArray(tournament.playoffs) ? tournament.playoffs : []).forEach((round) => {
        (Array.isArray(round) ? round : []).forEach(registrarActividadCalendario);
      });
    });
  }

  const anioCalendario = mesCalendario.getFullYear();
  const numeroMesCalendario = mesCalendario.getMonth();
  const cantidadDiasMes = new Date(anioCalendario, numeroMesCalendario + 1, 0).getDate();
  const primerDiaSemana = (new Date(anioCalendario, numeroMesCalendario, 1).getDay() + 6) % 7;
  const claveDiaCalendario = (dia) => `${anioCalendario}-${String(numeroMesCalendario + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  const fechaHoyCalendario = obtenerDiaArgentina(new Date().toISOString());
  const cantidadActividadDiaSeleccionado = diaCalendarioSeleccionado
    ? actividadCalendario[diaCalendarioSeleccionado] || 0
    : 0;

  const tarjetaMetrica = (etiqueta, valor, color = "#fff") => (
    <div style={{ background: "#171c27", border: "1px solid #b5122a", borderRadius: "12px", padding: "0.9rem", textAlign: "center" }}>
      <div style={{ color: "#c7cbd1", fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase" }}>{etiqueta}</div>
      <div style={{ color, fontSize: "1.65rem", fontWeight: 900, marginTop: "0.25rem" }}>{valor}</div>
    </div>
  );

  if (loading || error) {
    return (
      <div className="referee-stat-card" style={{ width: "100%", maxWidth: "1100px", margin: "0 auto", textAlign: "center" }}>
        <h2 className="cr-title">ÁRBITROS · ESTADÍSTICAS</h2>
        <p style={{ color: error ? "#f87171" : "#d1d5db" }}>{error || "Cargando estadísticas arbitrales..."}</p>
        {error && <button type="button" className="cr-btn-gold" onClick={cargarEstadisticas}>Reintentar</button>}
        <div><button type="button" className="tc-form-back" onClick={onBack} style={{ marginTop: "1rem" }}>← Volver</button></div>
      </div>
    );
  }

  if (arbitroActual) {
    return (
      <div style={{ width: "100%", maxWidth: "1100px", margin: "0 auto", paddingBottom: "2rem" }}>
        <section className="referee-stat-card" style={{ marginBottom: "1rem" }}>
          
          <h2 className="cr-title" style={{ marginBottom: "4px" }}>{arbitroActual.nombre}</h2>
          <p style={{ color: "#d1d5db", margin: 0, fontSize: "0.82rem" }}>Ficha individual · Estadísticas arbitrales</p>
        </section>

        <section className="referee-stat-card" style={{ marginBottom: "1rem" }}>
          <h3 style={{ color: "#fff", marginTop: 0 }}>Resultados dirigidos</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))", gap: "0.75rem" }}>
            {tarjetaMetrica("Partidos", arbitroActual.partidos)}
            {tarjetaMetrica("Victorias locales", arbitroActual.victoriasLocales, "#86efac")}
            {tarjetaMetrica("Empates", arbitroActual.empates, "#facc15")}
            {tarjetaMetrica("Victorias visitantes", arbitroActual.victoriasVisitantes, "#93c5fd")}
          </div>
        </section>

        <section className="referee-stat-card" style={{ marginBottom: "1rem" }}>
          <h3 style={{ color: "#fff", marginTop: 0 }}>Goles en sus partidos</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))", gap: "0.75rem" }}>
            {tarjetaMetrica("Goles locales", arbitroActual.golesLocal)}
            {tarjetaMetrica("Goles visitantes", arbitroActual.golesVisitante)}
            {tarjetaMetrica("Goles totales", arbitroActual.golesTotales, "#facc15")}
          </div>
        </section>

        <section className="referee-stat-card">
          <h3 style={{ color: "#fff", marginTop: 0 }}>Partidos por rama</h3>
          {Object.keys(arbitroActual.porRama).length ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.65rem" }}>
              {Object.entries(arbitroActual.porRama).map(([rama, cantidad]) => (
                <div key={rama} style={{ background: "#171c27", borderRadius: "10px", padding: "0.8rem", color: "#fff", border: "1px solid #34313d" }}>
                  <strong>{rama}</strong><div style={{ color: "#d1d5db", marginTop: "0.25rem" }}>{cantidad} partidos</div>
                </div>
              ))}
            </div>
          ) : <p style={{ color: "#d1d5db" }}>Todavía no registra partidos.</p>}
        </section>

        <section className="referee-stat-card" style={{ marginTop: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <div>
              <h3 style={{ color: "#fff", margin: 0 }}>Actividad de carga</h3>
              <p style={{ color: "#d1d5db", fontSize: "0.78rem", margin: "0.25rem 0 0" }}>Días en los que registró resultados</p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <button type="button" className="tc-form-back" aria-label="Mes anterior" onClick={() => { setMesCalendario(new Date(anioCalendario, numeroMesCalendario - 1, 1)); setDiaCalendarioSeleccionado(null); }}>‹</button>
              <strong style={{ color: "#fff", minWidth: "135px", textAlign: "center", textTransform: "capitalize" }}>
                {mesCalendario.toLocaleDateString("es-AR", { month: "long", year: "numeric" })}
              </strong>
              <button type="button" className="tc-form-back" aria-label="Mes siguiente" onClick={() => { setMesCalendario(new Date(anioCalendario, numeroMesCalendario + 1, 1)); setDiaCalendarioSeleccionado(null); }}>›</button>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: "0.35rem", marginTop: "1rem" }}>
            {["L", "M", "M", "J", "V", "S", "D"].map((dia, index) => (
              <div key={`${dia}-${index}`} style={{ color: "#aeb4bf", textAlign: "center", fontSize: "0.72rem", fontWeight: 800, padding: "0.35rem 0" }}>{dia}</div>
            ))}
            {Array.from({ length: primerDiaSemana }, (_, index) => (
              <div key={`vacio-${index}`} />
            ))}
            {Array.from({ length: cantidadDiasMes }, (_, index) => {
              const dia = index + 1;
              const clave = claveDiaCalendario(dia);
              const cantidad = actividadCalendario[clave] || 0;
              const seleccionado = diaCalendarioSeleccionado === clave;
              const esHoy = fechaHoyCalendario === clave;
              return (
                <button
                  key={clave}
                  type="button"
                  onClick={() => setDiaCalendarioSeleccionado(seleccionado ? null : clave)}
                  aria-label={`${dia}: ${cantidad} resultados cargados`}
                  style={{
                    minWidth: 0,
                    aspectRatio: "1",
                    borderRadius: "9px",
                    border: seleccionado ? "2px solid #fff" : esHoy ? "1px solid #facc15" : cantidad ? "1px solid #b5122a" : "1px solid #343a46",
                    background: cantidad ? "#b5122a" : "#171c27",
                    color: "#fff",
                    fontWeight: cantidad ? 900 : 600,
                    cursor: "pointer",
                    padding: "0.2rem",
                    boxShadow: seleccionado ? "0 0 0 2px rgba(181,18,42,0.35)" : "none",
                  }}
                >
                  <span>{dia}</span>
                  {cantidad > 0 && <span style={{ display: "block", fontSize: "0.58rem", lineHeight: 1.1 }}>{cantidad}</span>}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", marginTop: "0.8rem", color: "#d1d5db", fontSize: "0.72rem" }}>
            <span style={{ width: "11px", height: "11px", borderRadius: "3px", background: "#b5122a", display: "inline-block" }} />
            Día con resultados cargados
          </div>
          {diaCalendarioSeleccionado && (
            <p style={{ color: "#fff", margin: "0.8rem 0 0", fontSize: "0.82rem" }}>
              {new Date(`${diaCalendarioSeleccionado}T12:00:00`).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })}: <strong>{cantidadActividadDiaSeleccionado} {cantidadActividadDiaSeleccionado === 1 ? "resultado cargado" : "resultados cargados"}</strong>
            </p>
          )}
          {Object.keys(actividadCalendario).length === 0 && (
            <p style={{ color: "#aeb4bf", fontSize: "0.75rem", margin: "0.8rem 0 0" }}>El calendario comenzará a marcar actividad con las próximas cargas de resultados. Los registros anteriores no tienen fecha de carga guardada.</p>
          )}
        </section>

        <section className="referee-stat-card" style={{ marginTop: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.85rem" }}>
            <div>
              <h3 style={{ color: "#fff", margin: 0 }}>Partidos dirigidos</h3>
              <p style={{ color: "#d1d5db", fontSize: "0.78rem", margin: "0.25rem 0 0" }}>Encuentros con resultado cargado por este árbitro</p>
            </div>
            <strong style={{ color: "#fff", background: "#b5122a", borderRadius: "20px", padding: "0.3rem 0.7rem", fontSize: "0.8rem" }}>{partidosDirigidos.length}</strong>
          </div>
          {partidosDirigidos.length === 0 ? (
            <p style={{ color: "#aeb4bf", margin: 0 }}>Todavía no hay partidos con resultados cargados para este árbitro.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
              {partidosDirigidos.map((partido) => (
                <article key={partido.clave} style={{ background: "#171c27", border: "1px solid #343a46", borderLeft: "3px solid #b5122a", borderRadius: "10px", padding: "0.8rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.55rem" }}>
                    <strong style={{ color: "#fff", fontSize: "0.82rem" }}>{partido.torneo}</strong>
                    <span style={{ color: "#aeb4bf", fontSize: "0.7rem" }}>{partido.result_loaded_at && !Number.isNaN(new Date(partido.result_loaded_at).getTime()) ? new Date(partido.result_loaded_at).toLocaleDateString("es-AR") : "Fecha no registrada"}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)", alignItems: "center", gap: "0.5rem" }}>
                    <strong style={{ color: "#fff", fontSize: "0.82rem", overflowWrap: "anywhere" }}>{partido.team1}</strong>
                    <span style={{ color: "#fff", background: "#080808", border: "1px solid #b5122a", borderRadius: "8px", padding: "0.35rem 0.6rem", fontWeight: 900, whiteSpace: "nowrap" }}>{partido.score1} - {partido.score2}</span>
                    <strong style={{ color: "#fff", fontSize: "0.82rem", textAlign: "right", overflowWrap: "anywhere" }}>{partido.team2}</strong>
                  </div>
                  <div style={{ color: "#aeb4bf", fontSize: "0.7rem", marginTop: "0.55rem" }}>{partido.rama} · {partido.instancia}</div>
                </article>
              ))}
            </div>
          )}
        </section>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
          <button type="button" className="tc-form-back" onClick={() => setArbitroSeleccionado(null)}>← Volver a todos</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", maxWidth: "1100px", margin: "0 auto", paddingBottom: "2rem" }}>
      <section className="referee-stat-card" style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <div>
            <h2 className="cr-title" style={{ marginBottom: "4px" }}>ÁRBITROS · ESTADÍSTICAS</h2>
            <p style={{ color: "#d1d5db", margin: 0, fontSize: "0.82rem" }}>Consultá y compará el rendimiento de todos los árbitros</p>
          </div>
          <button type="button" onClick={cargarEstadisticas} className="tc-form-back">↻ Actualizar</button>
        </div>
      </section>

      {estadisticas.length === 0 ? (
        <section className="referee-stat-card"><p style={{ color: "#d1d5db" }}>Todavía no hay árbitros aprobados para mostrar.</p></section>
      ) : (
        <div className="referee-stats-grid" style={{ display: "grid", gap: "0.9rem", alignItems: "stretch" }}>
          {estadisticas.map((arbitro) => (
            <article
              key={arbitro.id}
              className="referee-stat-card referee-mini-card"
              style={{ position: "relative", minWidth: 0, width: "100%", minHeight: "218px", boxSizing: "border-box", textAlign: "left", color: "#fff", display: "flex", flexDirection: "column", gap: "0.75rem", background: "linear-gradient(145deg, #202633 0%, #11151d 78%)", border: "1px solid #343d4b", borderTop: "3px solid #b5122a", padding: "1rem", borderRadius: "14px", boxShadow: "0 7px 18px rgba(0,0,0,.24)" }}
            >
              <button
                type="button"
                onClick={() => setArbitroSeleccionado(arbitro.id)}
                aria-label={`Ver estadísticas de ${arbitro.nombre}`}
                className="referee-stat-card-button"
                style={{ width: "100%", minWidth: 0, textAlign: "left", color: "#fff", cursor: "pointer", display: "flex", flexDirection: "column", gap: "0.65rem", background: "transparent", border: 0, padding: 0 }}
              >
                <div className="referee-mini-heading" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "2.8rem", marginTop: canManageAccess ? "1.6rem" : 0, padding: "0.55rem", minWidth: 0, width: "100%", boxSizing: "border-box", background: "#050505", border: "1px solid #343a46", borderRadius: "9px", textAlign: "center" }}>
                  <strong style={{ display: "block", width: "100%", color: "#fff", fontSize: "clamp(0.76rem, 1.05vw, 0.96rem)", lineHeight: 1.25, textAlign: "center", overflowWrap: "anywhere" }}>{arbitro.nombre}</strong>
                </div>
                <div className="referee-mini-total" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.3rem", textAlign: "center", borderBottom: "1px solid #343d4b", padding: "0.25rem 0 0.65rem" }}><strong style={{ display: "block", width: "100%", color: "#fff", fontSize: "1.75rem", lineHeight: 1, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{arbitro.partidos}</strong><span style={{ display: "block", width: "100%", color: "#aeb7c5", fontSize: "0.64rem", fontWeight: 800, letterSpacing: "0.08em", textAlign: "center" }}>PARTIDOS DIRIGIDOS</span></div>
                <div className="referee-mini-metrics" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "0.45rem", textAlign: "center" }}>
                  <div style={{ background: "#0d1118", border: "1px solid #303947", borderRadius: "7px", padding: "0.45rem 0.1rem" }}>
                    <strong style={{ display: "block", color: "#86efac", fontSize: "1.1rem" }}>{arbitro.victoriasLocales}</strong>
                    <span style={{ color: "#b8c0cc", fontSize: "clamp(0.48rem, 0.7vw, 0.6rem)", display: "block" }}>LOCAL</span>
                  </div>
                  <div style={{ background: "#171c27", borderRadius: "8px", padding: "0.5rem 0.2rem" }}>
                    <strong style={{ display: "block", color: "#facc15", fontSize: "1.1rem" }}>{arbitro.empates}</strong>
                    <span style={{ color: "#b8c0cc", fontSize: "clamp(0.48rem, 0.7vw, 0.6rem)", display: "block" }}>EMPATES</span>
                  </div>
                  <div style={{ background: "#171c27", borderRadius: "8px", padding: "0.5rem 0.2rem" }}>
                    <strong style={{ display: "block", color: "#93c5fd", fontSize: "1.1rem" }}>{arbitro.victoriasVisitantes}</strong>
                    <span style={{ color: "#b8c0cc", fontSize: "clamp(0.48rem, 0.7vw, 0.6rem)", display: "block" }}>VISIT.</span>
                  </div>
                </div>
                <div className="referee-mini-goals" style={{ color: "#c7cbd1", fontSize: "0.7rem", lineHeight: 1.4, display: "flex", justifyContent: "space-between", gap: "0.4rem", flexWrap: "wrap" }}>
                  <span>GOLES EN PARTIDOS: <strong style={{ color: "#fff" }}>{arbitro.golesLocal + arbitro.golesVisitante}</strong></span>
                  <span>LOCAL <strong style={{ color: "#fff" }}>{arbitro.golesLocal}</strong> · VISIT. <strong style={{ color: "#fff" }}>{arbitro.golesVisitante}</strong></span>
                </div>
                <span className="referee-mini-detail" style={{ color: "#ff9aa8", fontSize: "0.66rem", fontWeight: 800, letterSpacing: "0.08em", borderTop: "1px solid #343d4b", paddingTop: "0.65rem", marginTop: "auto", display: "flex", justifyContent: "space-between" }}>CONSULTAR FICHA <span aria-hidden="true">→</span></span>
              </button>
              {canManageAccess && (
                <button
                  type="button"
                  title="Dar de baja árbitro"
                  aria-label={`Dar de baja a ${arbitro.nombre}`}
                  onClick={async (event) => {
                    event.stopPropagation();
                    if (!onDeactivateReferee) return;
                    const resultado = await onDeactivateReferee(arbitro);
                    if (resultado) {
                      setArbitroSeleccionado(null);
                      await cargarEstadisticas();
                    }
                  }}
                  style={{ position: "absolute", top: "0.65rem", right: "0.65rem", width: "34px", height: "34px", display: "grid", placeItems: "center", borderRadius: "8px", border: "1px solid #b5122a", background: "#391018", color: "#fff", cursor: "pointer", zIndex: 2 }}
                >
                  <TCIcon name="trash" size={16} />
                </button>
              )}
            </article>
          ))}
        </div>
      )}

      <p style={{ color: "#aaa", fontSize: "0.72rem", marginBottom: 0, marginTop: "1rem" }}>
        Se cuentan partidos con resultado completo y árbitro identificado. Los registros anteriores a la identificación del árbitro no se atribuyen retroactivamente.
      </p>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
        <button type="button" className="tc-form-back" onClick={onBack}>← Volver al inicio</button>
      </div>
    </div>
  );
}


function AdminStats({ onBack }) {
  const [visitas, setVisitas] = useState([]);
  const [perfiles, setPerfiles] = useState([]);
  const [torneosStats, setTorneosStats] = useState([]);
  const [errorArbitrosStats, setErrorArbitrosStats] = useState("");
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
      { data: torneosData, error: torneosError },
    ] = await Promise.all([
      supabase
        .from("visitas")
        .select(
          "id, created_at, user_id, username, email, device, started_at, last_seen_at, duration_seconds"
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("profiles")
        .select("id, username, email, created_at, role, approval_status, deactivated_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("tournaments")
        .select("*"),
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
    setTorneosStats(torneosError ? [] : (torneosData || []));
    setErrorArbitrosStats(torneosError
      ? "No se pudieron consultar los torneos para calcular las estadísticas arbitrales."
      : "");
    if (torneosError) console.error("Error al obtener torneos para estadísticas arbitrales:", torneosError);
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

  // Estadísticas arbitrales: se leen los marcadores ya guardados en cada partido.
  // referee_id identifica al árbitro que realizó la última carga/corrección del resultado.
  const estadisticasArbitrosPorId = {};
  const registrarPartidoArbitrado = (match, tournament) => {
    const refereeId = match?.referee_id;
    const scoreLocal = Number(match?.score1);
    const scoreVisitante = Number(match?.score2);
    const team1 = String(match?.team1 || "").trim();
    const team2 = String(match?.team2 || "").trim();

    if (!refereeId ||
        match?.score1 === null || match?.score1 === undefined ||
        match?.score2 === null || match?.score2 === undefined ||
        !Number.isFinite(scoreLocal) || !Number.isFinite(scoreVisitante) ||
        !team1 || !team2 ||
        team1.toLocaleLowerCase("es") === "pasaje directo" ||
        team2.toLocaleLowerCase("es") === "pasaje directo") return;

    if (!estadisticasArbitrosPorId[refereeId]) {
      const perfil = perfiles.find((item) => item.id === refereeId);
      estadisticasArbitrosPorId[refereeId] = {
        id: refereeId,
        nombre: perfil?.username || "Árbitro",
        partidos: 0,
        golesLocal: 0,
        golesVisitante: 0,
        golesTotales: 0,
        porRama: {},
      };
    }

    const stats = estadisticasArbitrosPorId[refereeId];
    const partesJuego = String(tournament?.game || "").split(" · ");
    const rama = partesJuego[1] || "Sin rama";
    stats.partidos += 1;
    stats.golesLocal += scoreLocal;
    stats.golesVisitante += scoreVisitante;
    stats.golesTotales += scoreLocal + scoreVisitante;
    stats.porRama[rama] = (stats.porRama[rama] || 0) + 1;
  };

  torneosStats.forEach((tournament) => {
    (Array.isArray(tournament.groups) ? tournament.groups : []).forEach((group) => {
      (Array.isArray(group?.matches) ? group.matches : []).forEach((match) => {
        registrarPartidoArbitrado(match, tournament);
      });
    });
    (Array.isArray(tournament.playoffs) ? tournament.playoffs : []).forEach((round) => {
      (Array.isArray(round) ? round : []).forEach((match) => {
        registrarPartidoArbitrado(match, tournament);
      });
    });
  });

  // También mostramos árbitros aprobados que todavía no registraron partidos.
  perfiles
    .filter((perfil) => perfil.role === "arbitro" && perfil.approval_status === "aprobado")
    .forEach((perfil) => {
      if (!estadisticasArbitrosPorId[perfil.id]) {
        estadisticasArbitrosPorId[perfil.id] = {
          id: perfil.id,
          nombre: perfil.username || "Árbitro",
          partidos: 0,
          golesLocal: 0,
          golesVisitante: 0,
          golesTotales: 0,
          porRama: {},
        };
      }
    });

  const estadisticasArbitros = Object.values(estadisticasArbitrosPorId)
    .sort((a, b) => b.partidos - a.partidos || a.nombre.localeCompare(b.nombre, "es"));

  if (loadingStats) {
    return (
      <div
        className="cr-card tc-stats-screen"
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
        className="cr-card tc-stats-screen"
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
      className="tc-stats-screen"
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
              Panel privado de FEFUTIN
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

      {/* ESTADÍSTICAS DE ÁRBITROS */}
      <div className="cr-card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ color: "#fff", marginTop: 0, marginBottom: "0.45rem" }}>
          <TCIcon name="chart" /> Estadísticas de árbitros
        </h3>
        <p style={{ color: "#9ca3af", fontSize: "0.75rem", marginTop: 0 }}>
          Se cuentan los partidos con resultado completo y árbitro identificado. Los resultados cargados antes de registrar al árbitro no se atribuyen retroactivamente.
        </p>

        {errorArbitrosStats ? (
          <p style={{ color: "#f87171" }}>{errorArbitrosStats}</p>
        ) : estadisticasArbitros.length === 0 ? (
          <p style={{ color: "#9ca3af" }}>Todavía no hay partidos registrados por árbitros.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: "620px", borderCollapse: "collapse", color: "#fff", fontSize: "0.8rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #4b5563", color: "#d1d5db", textAlign: "left" }}>
                  <th style={{ padding: "0.65rem 0.45rem" }}>Árbitro</th>
                  <th style={{ padding: "0.65rem 0.45rem", textAlign: "center" }}>Partidos</th>
                  <th style={{ padding: "0.65rem 0.45rem" }}>Ramas</th>
                  <th style={{ padding: "0.65rem 0.45rem", textAlign: "center" }}>Goles local</th>
                  <th style={{ padding: "0.65rem 0.45rem", textAlign: "center" }}>Goles visitante</th>
                  <th style={{ padding: "0.65rem 0.45rem", textAlign: "center" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {estadisticasArbitros.map((arbitro) => (
                  <tr key={arbitro.id} style={{ borderBottom: "1px solid #2d2b3b" }}>
                    <td style={{ padding: "0.7rem 0.45rem", fontWeight: 800 }}>{arbitro.nombre}</td>
                    <td style={{ padding: "0.7rem 0.45rem", textAlign: "center", color: "#facc15", fontWeight: 900 }}>{arbitro.partidos}</td>
                    <td style={{ padding: "0.7rem 0.45rem", color: "#d1d5db" }}>
                      {Object.entries(arbitro.porRama).length
                        ? Object.entries(arbitro.porRama).map(([rama, cantidad]) => `${rama}: ${cantidad}`).join(" · ")
                        : "Sin partidos"}
                    </td>
                    <td style={{ padding: "0.7rem 0.45rem", textAlign: "center" }}>{arbitro.golesLocal}</td>
                    <td style={{ padding: "0.7rem 0.45rem", textAlign: "center" }}>{arbitro.golesVisitante}</td>
                    <td style={{ padding: "0.7rem 0.45rem", textAlign: "center", color: "#facc15", fontWeight: 900 }}>{arbitro.golesTotales}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
  const [authReady, setAuthReady] = useState(false);
  const [pendingAccessRequests, setPendingAccessRequests] = useState([]);
  const [loadingAccessRequests, setLoadingAccessRequests] = useState(false);
  const [accessActionError, setAccessActionError] = useState("");
  const [activeReferees, setActiveReferees] = useState([]);
  const [loadingActiveReferees, setLoadingActiveReferees] = useState(false);
  const [deactivatingRefereeId, setDeactivatingRefereeId] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [authInput, setAuthInput] = useState({ email: "", password: "" });
  const [authMode, setAuthMode] = useState("login");
  const [registerInput, setRegisterInput] = useState({ username: "", requestedRole: "arbitro" });
  const [activeView, setActiveView] = useState("home");
  const [showWhoWeAre, setShowWhoWeAre] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [activeTournament, setActiveTournament] = useState(null);
  const [showChampionCard, setShowChampionCard] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [tournaments, setTournaments] = useState([]);
  const [tournamentCategoryFilter, setTournamentCategoryFilter] = useState("Todas");
  const [tournamentDivisionFilter, setTournamentDivisionFilter] = useState("Todas");
  const [divisionCategorySearch, setDivisionCategorySearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [editingTournament, setEditingTournament] = useState(false);
  const [deletingTournamentId, setDeletingTournamentId] = useState(null);
  const [registeredProfiles, setRegisteredProfiles] = useState([]);
  const [loadingRegisteredProfiles, setLoadingRegisteredProfiles] = useState(false);
  const [registeredProfilesSearch, setRegisteredProfilesSearch] = useState("");
  const [selectedRegisteredProfileIds, setSelectedRegisteredProfileIds] = useState([]);
  const isAdmin = currentUser?.role === "admin";
  const isDirectivo = currentUser?.role === "directivo";
  const isArbitro = currentUser?.role === "arbitro";
  const canManageTournaments = isAdmin || isDirectivo;
  const canViewStatistics = isAdmin;
  const canViewRefereeStats = isAdmin || isDirectivo || isArbitro;
  const canDeleteTournaments = isAdmin;
  const canManageAccess = isAdmin || isDirectivo;
  const [catalogSeeded, setCatalogSeeded] = useState(false);

  const saveTeamsToCatalog = async (teams) => {
    const uniqueTeams = [...new Map(
      (teams || [])
        .map((name) => String(name || "").trim())
        .filter(Boolean)
        .map((name) => [name.toLocaleLowerCase("es"), name])
    ).values()];

    if (!uniqueTeams.length) return null;

    const { error } = await supabase
      .from("teams_catalog")
      .upsert(
        uniqueTeams.map((name) => ({ name })),
        { onConflict: "normalized_name", ignoreDuplicates: true }
      );

    if (error) console.error("No se pudo actualizar el catálogo histórico de equipos:", error);
    return error;
  };

  useEffect(() => {
    if (!isAdmin || catalogSeeded || !tournaments.length) return;

    const historicalTeams = tournaments.flatMap((tournament) =>
      (Array.isArray(tournament?.groups) ? tournament.groups : []).flatMap((group) =>
        Array.isArray(group?.teams) ? group.teams : []
      )
    );

    if (!historicalTeams.length) {
      setCatalogSeeded(true);
      return;
    }

    saveTeamsToCatalog(historicalTeams).then((error) => {
      if (!error) setCatalogSeeded(true);
    });
  }, [isAdmin, tournaments, catalogSeeded]);

  useEffect(() => {
    if (!authReady) return;
    if (!canManageAccess && activeView === "access-requests") setActiveView("home");
    if ((!canManageTournaments && ["create", "edit", "join"].includes(activeView)) ||
        (!canViewStatistics && activeView === "stats") ||
        (!canViewRefereeStats && activeView === "referee-stats") ||
        (!isArbitro && activeView === "referee-carnets") ||
        (!canManageAccess && activeView === "referee-carnet-directory")) {
      setActiveView("home");
      setActiveTournament(null);
    }
  }, [authReady, isAdmin, canManageTournaments, canViewStatistics, canViewRefereeStats, canManageAccess, isArbitro, activeView]);

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
        if (mounted) setAuthReady(true);
        return;
      }

      if (!session?.user) {
        if (mounted) {
          setCurrentUser(null);
          setAuthReady(true);
        }
        return;
      }

      const user = await buildCurrentUser(session.user);

      if (!user) {
        if (mounted) {
          setCurrentUser(null);
          setAuthReady(true);
        }
        await supabase.auth.signOut();
        return;
      }

      if (mounted) {
        setCurrentUser(user);
        setAuthReady(true);
      }
    };

    loadCurrentUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // La carga inicial ya la resuelve getSession() y el inicio de sesión
      // lo resuelve handleAuthSubmit(). Evitamos ejecutar buildCurrentUser()
      // dos veces en paralelo para esos mismos eventos.
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN") return;

      if (!session?.user) {
        if (mounted) {
          setCurrentUser(null);
          setAuthReady(true);
        }
        return;
      }

      // No ejecutar consultas a Supabase dentro de onAuthStateChange:
      // el callback se dispara mientras el cliente gestiona el bloqueo de auth.
      // Diferimos la carga del perfil para evitar bloquear el inicio/cambio de sesión.
      const authUser = session.user;
      setTimeout(async () => {
        if (!mounted) return;

        const user = await buildCurrentUser(authUser);
        if (mounted) {
          setCurrentUser(user);
          setAuthReady(true);
        }
        if (!user && mounted) await supabase.auth.signOut();
      }, 0);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const buildCurrentUser = async (authUser) => {
    if (!authUser) return null;

    const [{ data: profile, error: profileError }, { data: accessRows, error: accessError }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, username, email")
        .eq("id", authUser.id)
        .maybeSingle(),
      supabase.rpc("get_my_fefutin_access"),
    ]);

    if (profileError || accessError) {
      console.error("Error al obtener perfil o permisos:", { profileError, accessError });
      return null;
    }

    const access = Array.isArray(accessRows) ? accessRows[0] : null;
    if (!profile || !access || access.approval_status === "baja" || access.deactivated_at) {
      return null;
    }

    return {
      id: authUser.id,
      username: profile.username || authUser.user_metadata?.username || "Jugador",
      email: authUser.email || profile.email || "",
      role: access.role || "visitante",
      requestedRole: access.requested_role || null,
      approvalStatus: access.approval_status || "aprobado",
      approvedAt: access.approved_at || null,
    };
  };

  useEffect(() => {
    if (canManageAccess) loadActiveReferees();
    else setActiveReferees([]);
  }, [canManageAccess, currentUser?.id]);

  useEffect(() => {
    let cancelled = false;
    const loadPendingRequests = async () => {
      if (!canManageAccess) { setPendingAccessRequests([]); return; }
      setLoadingAccessRequests(true);
      const { data, error } = await supabase.rpc("get_fefutin_pending_requests");
      if (cancelled) return;
      if (error) {
        console.error("Error al cargar solicitudes de acceso:", error);
        setAccessActionError("No se pudieron cargar las solicitudes. Revisá la conexión con Supabase.");
      } else {
        setPendingAccessRequests(data || []);
        setAccessActionError("");
      }
      setLoadingAccessRequests(false);
    };
    loadPendingRequests();
    return () => { cancelled = true; };
  }, [canManageAccess, currentUser?.id]);

  const refreshPendingRequests = async () => {
    if (!canManageAccess) return;
    setLoadingAccessRequests(true);
    const { data, error } = await supabase.rpc("get_fefutin_pending_requests");
    if (error) setAccessActionError(error.message || "No se pudieron actualizar las solicitudes.");
    else { setPendingAccessRequests(data || []); setAccessActionError(""); }
    setLoadingAccessRequests(false);
  };

  const loadActiveReferees = async () => {
    if (!canManageAccess) return;
    setLoadingActiveReferees(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, email")
      .eq("role", "arbitro")
      .eq("approval_status", "aprobado")
      .is("deactivated_at", null)
      .order("username", { ascending: true });

    if (error) {
      console.error("Error al cargar árbitros activos:", error);
      setAccessActionError("No se pudo cargar la lista de árbitros activos.");
    } else {
      setActiveReferees(data || []);
    }
    setLoadingActiveReferees(false);
  };

  const handleDeactivateReferee = async (referee) => {
    if (!canManageAccess || !referee?.id || deactivatingRefereeId) return;
    const nombre = referee.username || referee.email || "este árbitro";
    const confirmado = window.confirm(
      `¿Querés dar de baja a ${nombre}? No podrá volver a ingresar, pero se conservarán sus partidos y estadísticas históricas.`
    );
    if (!confirmado) return;

    setDeactivatingRefereeId(referee.id);
    const { error } = await supabase.rpc("deactivate_fefutin_referee", {
      p_user_id: referee.id,
    });

    if (error) {
      console.error("Error al dar de baja al árbitro:", error);
      setAccessActionError(error.message || "No se pudo dar de baja al árbitro.");
      setDeactivatingRefereeId(null);
      return false;
    } else {
      setAccessActionError("");
      await loadActiveReferees();
      showNotice(`✅ ${nombre} fue dado de baja. Su historial quedó conservado.`);
      setDeactivatingRefereeId(null);
      return true;
    }
  };

  const handleAccessDecision = async (userId, decision) => {
    const rpcName = decision === "approve" ? "approve_fefutin_access" : "reject_fefutin_access";
    const { error } = await supabase.rpc(rpcName, { p_user_id: userId });
    if (error) { setAccessActionError(error.message || "No se pudo procesar la solicitud."); return; }
    setAccessActionError("");
    await refreshPendingRequests();
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
    if (!currentUser || !canDeleteTournaments) {
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
        `Esta acción eliminará el torneo de FEFUTIN.\n\n` +
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
  // AUTENTICACIÓN Y SOLICITUDES DE ACCESO
  // =========================================================

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    const username = registerInput.username.trim();
    const email = authInput.email.trim().toLowerCase();
    const password = authInput.password.trim();
    const requestedRole = registerInput.requestedRole;

    if (username.length < 3) {
      showNotice("Ingresá un nombre de al menos 3 caracteres.");
      return;
    }
    if (!email || password.length < 6) {
      showNotice("Ingresá un email válido y una contraseña de al menos 6 caracteres.");
      return;
    }
    if (!["directivo", "arbitro"].includes(requestedRole)) {
      showNotice("Seleccioná si solicitás acceso como directivo o árbitro.");
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username, requested_role: requestedRole },
      },
    });

    if (error) {
      console.error("Error al registrar solicitud:", error);
      showNotice(error.message?.toLowerCase().includes("already")
        ? "Ese email ya está registrado. Probá iniciar sesión."
        : "No se pudo crear la cuenta. Revisá los datos e intentá nuevamente.");
      return;
    }

    setAuthInput({ email: "", password: "" });
    setRegisterInput({ username: "", requestedRole: "arbitro" });
    setAuthMode("login");

    if (data.session && data.user) {
      const user = await buildCurrentUser(data.user);
      if (user) {
        setCurrentUser(user);
        setActiveView("home");
      }
    }

    showNotice("✅ Solicitud enviada. Tu cuenta queda como visitante hasta que FEFUTIN apruebe el rol solicitado. Si Supabase requiere confirmar el email, revisá tu correo.");
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();

    const email = authInput.email.trim().toLowerCase();
    const password = authInput.password.trim();

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

    const user = await buildCurrentUser(data.user);

    if (!user) {
      await supabase.auth.signOut();
      showNotice("⛔ La cuenta está desactivada o no tiene un perfil habilitado. Contactá a FEFUTIN.");
      return;
    }

    setCurrentUser(user);
    if (user.approvalStatus === "pendiente") {
      showNotice("Tu solicitud de acceso está pendiente de aprobación. Mientras tanto podés consultar la plataforma pública.");
    } else if (user.approvalStatus === "desestimado") {
      showNotice("Tu solicitud de acceso fue desestimada. Tu cuenta conserva acceso como visitante.");
    } else if (user.role === "visitante") {
      showNotice("Ingresaste como visitante. Podés consultar la información pública de FEFUTIN.");
    } else if (user.role === "arbitro") {
      showNotice("Ingresaste como árbitro. Tenés acceso a la consulta de torneos y resultados.");
    } else if (user.role === "directivo") {
      showNotice("Ingresaste como directivo. Tenés acceso a las funciones de gestión habilitadas para tu rol.");
    }

    setAuthInput({
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
    if (!canManageTournaments) {
      showNotice("❌ Solo un administrador o directivo puede crear torneos.");
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
      console.error("Error detallado al guardar el torneo en Supabase:", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      const reason = error.message || error.details || "Error sin descripción";
      showNotice(`❌ Supabase rechazó la creación: ${reason}`);
      return;
    }

    if (data && data.length > 0) {
      const catalogError = await saveTeamsToCatalog(config.teams);
      setActiveTournament(data[0]);
      setTournaments((prev) => [data[0], ...prev]);
      setActiveView("groups");
      if (catalogError) {
        showNotice("El torneo se creó, pero no se pudo actualizar el catálogo de equipos. Revisá los permisos de teams_catalog.");
      }
    }
  };

  const handleRegisterForTournament = async (tournament) => {
    if (!isAdmin || !tournament?.id) return;

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
    if (!canManageTournaments) {
      showNotice("Solo un administrador o directivo puede agregar participantes.");
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

    if (!canManageTournaments) {
      showNotice("Solo un administrador o directivo puede dar comienzo al torneo.");
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

  const isTournamentAdmin = canManageTournaments;

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
      const catalogError = await saveTeamsToCatalog(config.teams);
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

      showNotice(catalogError
        ? "El torneo se modificó, pero no se pudo actualizar el catálogo de equipos."
        : "✅ Torneo modificado correctamente."
      );
    }
  };

  const handleUpdateTournamentInSupabase = async (updatedTournament) => {
    if (!canManageTournaments) {
      showNotice("❌ Solo un administrador o directivo puede modificar torneos y resultados.");
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

  const handleUpdateMatchResult = async ({ phase, groupIndex, roundIndex, matchId, score1, score2 }) => {
    if (!isArbitro || !activeTournament?.id) {
      showNotice("No tenés permisos para cargar resultados.");
      return;
    }

    const { data, error } = await supabase.rpc("referee_update_match_result", {
      p_tournament_id: activeTournament.id,
      p_phase: phase,
      p_match_id: matchId,
      p_score1: score1,
      p_score2: score2,
      p_group_index: groupIndex ?? null,
      p_round_index: roundIndex ?? null,
    });

    if (error) {
      console.error("Error al guardar resultado arbitral:", error);
      showNotice(error.message || "No se pudo guardar el resultado. Verificá los permisos del árbitro.");
      return;
    }

    const updatedTournament = data?.id ? data : Array.isArray(data) ? data[0] : null;
    if (!updatedTournament?.id) {
      showNotice("Supabase no devolvió el torneo actualizado. Actualizá la pantalla antes de continuar.");
      return;
    }

    setActiveTournament(updatedTournament);
    setTournaments((prev) => prev.map((item) => item.id === updatedTournament.id ? updatedTournament : item));
  };

  // =========================================================
  // UNIRSE A TORNEO
  // =========================================================

  const handleJoinTournamentSubmit = (e) => {
    e.preventDefault();
    if (!canManageTournaments) {
      showNotice("⛔ Solo un administrador o directivo puede gestionar inscripciones.");
      setActiveView("home");
      return;
    }

    const cleanCode = joinCodeInput.trim().toUpperCase();

    const found = tournaments.find((t) => t.code === cleanCode);

    if (!found) {
      showNotice("❌ Código de torneo no encontrado en la base de datos.");
      return;
    }

    setActiveTournament(found);

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
    if (!canManageTournaments) return;
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
    if (!canManageTournaments || !activeTournament) return;
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
  };

  const tournamentCategories = [...new Set(
    tournaments.map((tournament) =>
      getTournamentCategory(tournament)
    ).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "es"));

  const getTournamentDivision = (tournament) => {
    const parts = String(tournament?.game || "").split(" · ").map((part) => part.trim());
    const explicitDivision = parts.find((part) => ["Infantil", "Femenino", "Mayores"].includes(part));
    if (explicitDivision) return explicitDivision;
    const category = `${getTournamentCategory(tournament)} ${tournament?.game || ""}`.toLocaleLowerCase("es");
    if (/femenin|mujer/.test(category)) return "Femenino";
    if (/mayor|adult|senior|primera/.test(category)) return "Mayores";
    return "Infantil";
  };

  const filteredTournaments = tournaments.filter((tournament) => {
    const matchesCategory = tournamentCategoryFilter === "Todas" ||
      getTournamentCategory(tournament) === tournamentCategoryFilter;
    const matchesDivision = tournamentDivisionFilter === "Todas" ||
      getTournamentDivision(tournament) === tournamentDivisionFilter;
    return matchesCategory && matchesDivision;
  });

  const openTournament = (tournament) => {
    setActiveTournament(tournament);
    setActiveView(
      tournament.playoffs && tournament.playoffs.length > 0
        ? "playoffs"
        : "groups"
    );
  };

  const renderDivisionCard = (division, image, label) => (
    <section className="tc-home-division-section" key={division}>
      <button
        type="button"
        className="tc-home-division-card"
        onClick={() => {
          setTournamentDivisionFilter(division);
          setTournamentCategoryFilter("Todas");
          setDivisionCategorySearch("");
          setActiveView("division-tournaments");
        }}
      >
        <img src={image} alt="" />
        <span>{label}</span>
      </button>
    </section>
  );


  return (
    <div className="cr-container tc-theme-clash">
      {showWelcome && activeView !== "admin-login" && (
        <section className="fefutin-welcome" aria-label="Bienvenida a FEFUTIN">
          <div className="fefutin-welcome-panel">
            <img src="https://fefutin.wordpress.com/wp-content/uploads/2017/03/fefutin-logo-grande1.png?h=184&w=166" alt="Logo histórico de FEFUTIN" className="fefutin-welcome-logo" />
            <div className="fefutin-welcome-kicker">FEDERACIÓN DE FÚTBOL INFANTIL</div>
            <h1>FEFUTIN</h1>
            <p>Pasión, formación y competencia.</p>
            <button type="button" onClick={() => setShowWelcome(false)}>BIENVENIDOS</button>
          </div>
        </section>
      )}
      <TournamentNotice
        notice={notice}
        onClose={clearNotice}
        confirmation={confirmation}
        onResolveConfirmation={resolveConfirmation}
      />
      {showChampionCard && activeTournament?.status === "Finalizado" && (
        <ChampionCelebration
          tournament={activeTournament}
          onClose={() => setShowChampionCard(false)}
        />
      )}
      <Navbar
          onGoHome={handleGoHome}
          currentTitle={activeTournament?.title}
          tournamentCode={activeTournament?.code}
          currentUser={currentUser}
          tournaments={tournaments}
          isAdmin={isAdmin}
          canManageAccess={canManageAccess}
          pendingAccessCount={pendingAccessRequests.length}
          onGoAccessRequests={() => { setAccessActionError(""); setActiveView("access-requests"); }}
          onGoStats={() => setActiveView("stats")}
          isArbitro={isArbitro}
          onGoMyCarnet={() => setActiveView("referee-carnets")}
          onGoCarnetDirectory={() => setActiveView("referee-carnet-directory")}
          onAdminClick={() => setActiveView("admin-login")}
          onLogout={handleLogout}
        />

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
              src="https://fefutin.wordpress.com/wp-content/uploads/2017/03/fefutin-logo-grande1.png?h=184&w=166"
              alt="Escudo original de FEFUTIN"
              className="tc-login-crest"
            />

            <div className="tc-auth-kicker"><span></span> PLATAFORMA DE TORNEOS DEPORTIVOS <span></span></div>
            <h1 className="cr-logo-title">FEFUTIN</h1>
            <p className="tc-auth-tagline">Ingresá a la plataforma de FEFUTIN.</p>
          </div>

          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
            <button type="button" onClick={() => setAuthMode("login")} className={authMode === "login" ? "cr-btn-gold" : "tc-form-back"} style={{ flex: 1, padding: "0.65rem" }}>Ingresar</button>
            <button type="button" onClick={() => setAuthMode("register")} className={authMode === "register" ? "cr-btn-gold" : "tc-form-back"} style={{ flex: 1, padding: "0.65rem" }}>Solicitar acceso</button>
          </div>

          <form
            className="tc-auth-form"
            onSubmit={authMode === "register" ? handleRegisterSubmit : handleAuthSubmit}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
            }}
          >
            {authMode === "register" && <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: "bold", textTransform: "uppercase", color: "#d1d5db", marginBottom: "4px" }}>Nombre y apellido</label>
              <input type="text" placeholder="Ej: Juan Pérez" value={registerInput.username} onChange={(e) => setRegisterInput({ ...registerInput, username: e.target.value })} required minLength={3} className="cr-input" />
            </div>}

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
                {true && (
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
                type={showPassword ? "text" : "password"}
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

            {authMode === "register" && <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: "bold", textTransform: "uppercase", color: "#d1d5db", marginBottom: "4px" }}>Solicito acceso como</label>
              <select value={registerInput.requestedRole} onChange={(e) => setRegisterInput({ ...registerInput, requestedRole: e.target.value })} className="cr-input" required>
                <option value="arbitro">Árbitro</option>
                <option value="directivo">Directivo</option>
              </select>
              <p style={{ color: "#9ca3af", fontSize: "0.75rem", lineHeight: 1.45, margin: "0.35rem 0 0" }}>La solicitud debe ser aprobada por las autoridades de FEFUTIN. Mientras tanto tendrás acceso público como visitante.</p>
            </div>}

            <button
              type="submit"
              className="cr-btn-gold tc-auth-submit"
              style={{
                marginTop: "0.5rem",
                padding: "0.55rem 1rem",
                borderBottom: "3px solid #522b00",
              }}
            >
              <><TCIcon name="shield" size={17} /> {authMode === "register" ? "Enviar solicitud" : "Ingresar"}</>
            </button>

            <div style={{ textAlign: "center", marginTop: "0.5rem" }}>
              <button type="button" onClick={() => { setActiveView("home"); setAuthMode("login"); setAuthInput({ email: "", password: "" }); setRegisterInput({ username: "", requestedRole: "arbitro" }); }} style={{ background: "transparent", border: "none", color: "#9ca3af", fontSize: "0.8rem", cursor: "pointer" }}>
                ← Volver a la plataforma pública
              </button>
            </div>
          </form>
        </div>
        </div>
      ) : activeView === "access-requests" && canManageAccess ? (
        <div className="tc-form-screen" style={{ padding: "1rem", minHeight: "70vh" }}>
          <section className="cr-card" style={{ width: "100%", maxWidth: "900px", margin: "auto", padding: "clamp(1rem, 3vw, 2rem)" }}>
            <button type="button" className="tc-form-back" onClick={() => setActiveView("home")}>← Volver</button>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", margin: "1rem 0 1.5rem" }}>
              <div>
                <p style={{ color: "#b5122a", fontWeight: 900, letterSpacing: "0.12em", fontSize: "0.72rem", margin: 0 }}>GESTIÓN DE USUARIOS</p>
                <h2 className="cr-title" style={{ margin: "0.35rem 0" }}>SOLICITUDES DE ACCESO</h2>
                <p style={{ color: "var(--tc-text, #fff)", opacity: 0.75, margin: 0 }}>Revisá y resolvé los pedidos de ingreso a FEFUTIN.</p>
              </div>
              <button type="button" className="tc-form-back" onClick={refreshPendingRequests} disabled={loadingAccessRequests}>↻ Actualizar</button>
            </div>
            {accessActionError && <div role="alert" style={{ border: "1px solid #b5122a", color: "#fff", background: "#391018", borderRadius: "8px", padding: "0.8rem", marginBottom: "1rem" }}>{accessActionError}</div>}
            {loadingAccessRequests ? (
              <p style={{ color: "#fff", textAlign: "center", padding: "2rem" }}>Cargando solicitudes...</p>
            ) : pendingAccessRequests.length === 0 ? (
              <div style={{ border: "1px solid #555", borderRadius: "12px", padding: "2rem 1rem", textAlign: "center", color: "#fff" }}>
                <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>✓</div>
                <strong>No hay solicitudes pendientes</strong>
                <p style={{ opacity: 0.7, marginBottom: 0 }}>Cuando alguien solicite acceso como árbitro o directivo, aparecerá aquí.</p>
              </div>
            ) : (
              <div style={{ display: "grid", gap: "0.85rem" }}>
                {pendingAccessRequests.map((request) => (
                  <article key={request.id} style={{ border: "1px solid #b5122a", borderRadius: "12px", background: "#111", padding: "1rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ color: "#fff", display: "block", fontSize: "1rem" }}>{request.username || "Sin nombre"}</strong>
                      <span style={{ color: "#ddd", display: "block", overflowWrap: "anywhere", fontSize: "0.88rem" }}>{request.email || "Sin email"}</span>
                      <span style={{ display: "inline-block", marginTop: "0.5rem", color: "#fff", background: "#8f1026", borderRadius: "20px", padding: "0.25rem 0.65rem", fontSize: "0.72rem", fontWeight: 800 }}>{request.requested_role === "directivo" ? "SOLICITA SER DIRECTIVO" : "SOLICITA SER ÁRBITRO"}</span>
                      <small style={{ display: "block", color: "#aaa", marginTop: "0.4rem" }}>Recibida: {request.created_at ? new Date(request.created_at).toLocaleString("es-AR") : "—"}</small>
                    </div>
                    <div style={{ display: "flex", gap: "0.55rem", flexWrap: "wrap" }}>
                      <button type="button" className="cr-btn-gold" onClick={() => handleAccessDecision(request.id, "approve")}>Aprobar</button>
                      <button type="button" className="tc-form-back" onClick={() => handleAccessDecision(request.id, "reject")}>Desestimar</button>
                    </div>
                  </article>
                ))}
              </div>
            )}

            <div style={{ borderTop: "1px solid #3a3a3a", marginTop: "1.75rem", paddingTop: "1.4rem" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.9rem" }}>
                <div>
                  <h3 style={{ color: "#fff", margin: 0 }}>ÁRBITROS ACTIVOS</h3>
                  <p style={{ color: "#aaa", fontSize: "0.82rem", margin: "0.3rem 0 0" }}>Desde aquí podés dar de baja una cuenta sin borrar sus partidos ni sus estadísticas.</p>
                </div>
                <button type="button" className="tc-form-back" onClick={loadActiveReferees} disabled={loadingActiveReferees}>↻ Actualizar árbitros</button>
              </div>

              {loadingActiveReferees ? (
                <p style={{ color: "#ddd", textAlign: "center", padding: "1rem" }}>Cargando árbitros...</p>
              ) : activeReferees.length === 0 ? (
                <p style={{ color: "#aaa", padding: "0.5rem 0" }}>No hay árbitros activos para mostrar.</p>
              ) : (
                <div style={{ display: "grid", gap: "0.7rem" }}>
                  {activeReferees.map((referee) => (
                    <article key={referee.id} style={{ border: "1px solid #444", borderRadius: "10px", background: "#111", padding: "0.85rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.8rem", flexWrap: "wrap" }}>
                      <div style={{ minWidth: 0 }}>
                        <strong style={{ color: "#fff", display: "block" }}>{referee.username || "Árbitro sin nombre"}</strong>
                        <span style={{ color: "#aaa", fontSize: "0.82rem", overflowWrap: "anywhere" }}>{referee.email || "Sin email registrado"}</span>
                      </div>
                      <button
                        type="button"
                        className="tc-form-back"
                        onClick={() => handleDeactivateReferee(referee)}
                        disabled={deactivatingRefereeId === referee.id}
                        style={{ borderColor: "#b5122a", color: "#fff", background: "#391018", opacity: deactivatingRefereeId === referee.id ? 0.6 : 1 }}
                      >
                        {deactivatingRefereeId === referee.id ? "Procesando..." : "Dar de baja"}
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : activeView === "referee-carnets" && isArbitro ? (
        <RefereeCarnets currentUser={currentUser} canManage={false} onBack={() => setActiveView("home")} />
      ) : activeView === "referee-carnet-directory" && canManageAccess ? (
        <RefereeCarnets currentUser={currentUser} canManage={true} onBack={() => setActiveView("home")} />
      ) : activeView === "stats" && isAdmin ? (
        <div className="tc-form-screen tc-stats-screen">
          <AdminStats onBack={() => setActiveView("home")} />
        </div>
      ) : activeView === "referee-stats" && canViewRefereeStats ? (
        <div className="tc-form-screen tc-stats-screen">
          <RefereeStats onBack={() => setActiveView("home")} canManageAccess={canManageAccess} onDeactivateReferee={handleDeactivateReferee} />
        </div>
      ) : activeView === "division-tournaments" ? (
        <div className="tc-form-screen tc-division-tournaments-screen">
          <section className="cr-card" style={{ width: "100%", maxWidth: "980px", margin: "auto", background: "#080808", backgroundColor: "#080808", color: "#fff", border: "1px solid #b5122a" }}>
            <button type="button" className="tc-form-back" onClick={() => setActiveView("home")}>
              <span aria-hidden="true">←</span> Volver
            </button>
            <div className="tc-home-panel-art">
              <div><span>FEFUTIN</span><strong>FÚTBOL · {tournamentDivisionFilter.toLocaleUpperCase("es")}</strong></div>
            </div>
            <h2 className="cr-title">TORNEOS DE {tournamentDivisionFilter.toLocaleUpperCase("es")}</h2>
            <div className="tc-division-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={divisionCategorySearch}
                onChange={(event) => setDivisionCategorySearch(event.target.value)}
                placeholder="Buscar por categoría o torneo..."
                aria-label={`Buscar torneos de ${tournamentDivisionFilter} por categoría o nombre`}
              />
              {divisionCategorySearch && (
                <button type="button" onClick={() => setDivisionCategorySearch("")} aria-label="Limpiar búsqueda">×</button>
              )}
            </div>
            {(() => {
              const branchTournaments = tournaments.filter((t) => getTournamentDivision(t) === tournamentDivisionFilter);
              const categories = [...new Set(branchTournaments.map(getTournamentCategory).filter(Boolean))];
              const query = divisionCategorySearch.trim().toLocaleLowerCase("es");
              const visibleCategories = categories.filter((category) => {
                const categoryMatches = category.toLocaleLowerCase("es").includes(query);
                const hasMatchingTournament = branchTournaments.some((t) =>
                  getTournamentCategory(t) === category &&
                  String(t.title || "").toLocaleLowerCase("es").includes(query)
                );
                return !query || categoryMatches || hasMatchingTournament;
              });
              return categories.length ? (
                visibleCategories.length ? visibleCategories.map((category) => (
                  <section key={category} className="tc-division-category" style={{ background: "#101010", backgroundColor: "#101010", border: "1px solid #b5122a", borderRadius: "12px", padding: "0.75rem", marginBottom: "0.75rem" }}>
                    <h3>{category}</h3>
                    <div className="tc-division-tournament-list">
                      {branchTournaments.filter((t) =>
                        getTournamentCategory(t) === category &&
                        (!query || category.toLocaleLowerCase("es").includes(query) ||
                          String(t.title || "").toLocaleLowerCase("es").includes(query))
                      ).map((t) => (
                        <button type="button" className="tc-home-division-tournament" key={t.id} onClick={() => openTournament(t)} style={{ background: "#171717", backgroundColor: "#171717", color: "#fff", border: "1px solid #b5122a" }}>
                          <strong>{t.title || "Torneo sin nombre"}</strong>
                          <span>Fútbol · {category}</span>
                          <small>{t.status || "En preparación"}</small>
                        </button>
                      ))}
                    </div>
                  </section>
                )) : <p className="tc-division-search-empty">No encontramos torneos para “{divisionCategorySearch}”. Probá con otra categoría o nombre.</p>
              ) : <p style={{ color: "#fff" }}>Todavía no hay torneos creados en esta rama.</p>;
            })()}
          </section>
        </div>
      ) : activeView === "home" ? (
        <div className="tc-home-screen">
        <div
          className="cr-card tc-home-panel"
          style={{
            width: "100%",
            maxWidth: "980px",
            margin: "auto",
          }}
        >
          <div className="tc-home-panel-art" aria-label="FEFUTIN — Fútbol formativo">
            <img src="/WhatsApp%20Image%202026-10-31%20at%2010.45.37.jpeg" alt="Escudo Liga FEFUTIN" />
            <div>
              <span>FEFUTIN</span>
              <strong>FÚTBOL FORMATIVO</strong>
            </div>
          </div>
          <div className="tc-home-divisions" aria-label="Divisiones de la liga">
            {renderDivisionCard("Infantil", "/WhatsApp%20Image%202026-10-31%20at%2010.45.23.jpeg", "INFANTIL")}
            {renderDivisionCard("Femenino", "/WhatsApp%20Image%202026-10-30%20at%2021.11.20.jpeg", "FEMENINO")}
            {renderDivisionCard("Mayores", "/WhatsApp%20Image%202026-10-30%20at%2020.59.32.jpeg", "MAYORES")}
          </div>
          <button
            type="button"
            className="tc-home-about-card tc-home-about-card-shine"
            onClick={() => setShowWhoWeAre(true)}
          >
            <span className="tc-home-about-icon">⚽</span>
            <span className="tc-home-about-copy">
              <strong>QUIÉNES SOMOS</strong>
              <small>Conocé la liga y nuestros valores</small>
            </span>
            <span className="tc-home-about-arrow">→</span>
          </button>

          {(isAdmin || isDirectivo || isArbitro) && (
            <button
              type="button"
              className="tc-home-about-card tc-home-referee-card"
              onClick={() => setActiveView("referee-stats")}
            >
              <span className="tc-home-about-icon tc-home-referee-icon" aria-hidden="true">
                <svg viewBox="0 0 48 48" width="27" height="27" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="19" cy="12" r="6" stroke="currentColor" strokeWidth="2.8" />
                  <path d="M8.5 36.5v-4.2c0-6.2 4.7-10.8 10.5-10.8 3.1 0 5.8 1.2 7.7 3.3" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
                  <path d="M29 25.5 39.5 29l-3.2 9.2-10.5-3.6L29 25.5Z" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" />
                  <path d="m31.5 29.5 4.2 1.4M29.8 33.3l4.2 1.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M25.5 25.8 28 22l5.2 1.7-1.4 4.1" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="tc-home-about-copy">
                <strong>ÁRBITROS</strong>
                <small>Consultá y compará las estadísticas arbitrales</small>
              </span>
              <span className="tc-home-about-arrow">→</span>
            </button>
          )}

          {showWhoWeAre && (
            <div className="tc-about-overlay" onClick={() => setShowWhoWeAre(false)}>
              <section
                className="tc-about-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="tc-about-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="tc-about-accent" />
                <button
                  type="button"
                  className="tc-about-close"
                  aria-label="Cerrar"
                  onClick={() => setShowWhoWeAre(false)}
                >×</button>
                <span className="tc-about-eyebrow">FEFUTIN · FÚTBOL FORMATIVO</span>
                <h2 id="tc-about-title">¿QUIÉNES SOMOS?</h2>
                <p>
                  FEFUTIN es una comunidad deportiva que encuentra en el fútbol mucho más
                  que una competencia: un lugar para aprender, compartir, superarse y
                  construir vínculos. A través de sus torneos, busca que chicos, chicas,
                  jóvenes y adultos puedan disfrutar del deporte y sentirse parte de un
                  espacio de encuentro.
                </p>
                <p>
                  Las publicaciones institucionales históricas de FEFUTIN ya reflejaban
                  su vínculo con la organización y difusión de torneos de fútbol infantil
                  y femenino. Esta plataforma reúne hoy la información de las divisiones
                  Infantil, Femenino y Mayores, para acercar sus competencias a jugadores,
                  familias, equipos y acompañantes.
                </p>
                <h3>NUESTRAS DIVISIONES</h3>
                <div className="tc-about-divisions">
                  <div><strong>INFANTIL</strong><span>Formación, aprendizaje y diversión. Crecer jugando y compartiendo en equipo.</span></div>
                  <div><strong>FEMENINO</strong><span>Un espacio para competir, desarrollar el talento y fortalecer la participación.</span></div>
                  <div><strong>MAYORES</strong><span>La pasión por el fútbol continúa: encuentro, competencia y compañerismo.</span></div>
                </div>
                <h3>NUESTROS VALORES</h3>
                <div className="tc-about-values">
                  <div><strong>RESPETO</strong><span>Por compañeros, rivales, familias y árbitros.</span></div>
                  <div><strong>INCLUSIÓN</strong><span>Un lugar donde todos y todas puedan participar.</span></div>
                  <div><strong>FORMACIÓN</strong><span>Aprender, crecer y mejorar dentro y fuera de la cancha.</span></div>
                  <div><strong>COMPAÑERISMO</strong><span>Construir equipo desde la solidaridad y el juego limpio.</span></div>
                </div>
                <div className="tc-about-footer">UNIDOS POR EL DEPORTE · CRECIENDO EN EQUIPO</div>
              </section>
            </div>
          )}
          {(isAdmin || isDirectivo || isArbitro) && <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "1.5rem",
              paddingBottom: "1rem",
              borderBottom: "1px solid #2d2b3b",
            }}
            className="tc-admin-profile-row"
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
              }}
            >
              <div className="tc-admin-crown">
                <TCIcon name={isAdmin ? "crown" : "user"} size={22} />
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
                  className="tc-admin-label"
                >
                  {isAdmin ? "Administrador" : isDirectivo ? "Directivo" : "Árbitro"}
                </span>

                <h2
                  style={{
                    fontSize: "1.1rem",
                    fontWeight: 900,
                    color: "#ffd700",
                    margin: 0,
                  }}
                  className="tc-admin-username"
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

          {canManageTournaments && <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr)",
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


          </div>}

          <div className="tc-home-tournaments" style={{ display: "none" }}>
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
                className="tc-home-refresh"
                title="Actualizar lista de torneos"
                aria-label="Actualizar lista de torneos"
              >
                <TCIcon name="refresh" size={14} />
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
                {tournamentDivisionFilter === "Todas" ? "Buscar torneos por categoría" : `Torneos de ${tournamentDivisionFilter}`} · <button type="button" className="tc-home-filter-reset" onClick={() => { setTournamentDivisionFilter("Todas"); setTournamentCategoryFilter("Todas"); }}>Ver todas las divisiones</button>
              </label>
              <select
                id="tournament-category-filter"
                value={tournamentCategoryFilter}
                onChange={(e) => { setTournamentCategoryFilter(e.target.value); setTournamentDivisionFilter("Todas"); }}
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
                    className="tc-home-tournament-item tc-home-tournament-card"
                    key={t.id}
                    onClick={() => openTournament(t)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                      alignItems: "center",
                      gap: "8px",
                      padding: "10px",
                      backgroundColor: "#171c27",
                      border: "1px solid rgba(255,255,255,.28)",
                      borderLeft: "4px solid #b5122a",
                      borderRadius: "10px",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ minWidth: 0, boxSizing: "border-box", minHeight: "38px", display: "flex", alignItems: "center", justifyContent: "center", padding: "7px 2px", color: "#fff", textAlign: "center", fontSize: ".95rem", fontWeight: 900, lineHeight: 1.25, overflowWrap: "anywhere", letterSpacing: ".02em", textShadow: "0 1px 2px rgba(0,0,0,.65)" }}>
                      {t.title}
                    </div>
                    <div style={{ minWidth: 0, boxSizing: "border-box", minHeight: "38px", display: "flex", alignItems: "center", justifyContent: "center", padding: "7px 2px", color: "#fff", textAlign: "center", fontSize: ".95rem", fontWeight: 900, lineHeight: 1.25, overflowWrap: "anywhere", letterSpacing: ".02em", textShadow: "0 1px 2px rgba(0,0,0,.65)" }}>
                      {getTournamentCategory(t)}
                    </div>
                    <div style={{ minWidth: 0, boxSizing: "border-box", minHeight: "38px", display: "flex", alignItems: "center", justifyContent: "center", padding: "7px 2px", color: "#fff", textAlign: "center", fontSize: ".95rem", fontWeight: 900, lineHeight: 1.25, overflowWrap: "anywhere", letterSpacing: ".02em", textShadow: "0 1px 2px rgba(0,0,0,.65)" }}>
                      {getTournamentDivision(t)}
                    </div>
                    <div style={{ minWidth: 0, display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "center", gap: "6px" }}>
                      {isAdmin && (
                        <button
                          type="button"
                          title="Eliminar torneo"
                          aria-label="Eliminar torneo"
                          disabled={deletingTournamentId === t.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteTournament(t);
                          }}
                          style={{
                            alignSelf: "center",
                            width: "30px",
                            height: "30px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: deletingTournamentId === t.id ? "#374151" : "rgba(127,29,29,.35)",
                            border: "1px solid rgba(239,68,68,.55)",
                            borderRadius: "7px",
                            color: "#f87171",
                            cursor: deletingTournamentId === t.id ? "not-allowed" : "pointer",
                            padding: 0,
                          }}
                        >
                          {deletingTournamentId === t.id ? "…" : <TCIcon name="trash" size={17} />}
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
      ) : activeView === "create" && canManageTournaments ? (
        <div className="tc-form-screen tc-create-screen">
        <div className="tc-create-artwork">
          <img src="/WhatsApp%20Image%202026-10-31%20at%2010.45.37.jpeg" alt="Identidad visual de la Liga FEFUTIN" />
          <div><strong>ORGANIZÁ TU TORNEO</strong><span>Elegí el deporte, definí la categoría y prepará la competencia.</span></div>
        </div>
        <CreateTournament
          onSave={handleCreateTournamentSubmit}
          onCancel={() => setActiveView("home")}
        />
        </div>
      ) : activeView === "edit" && canManageTournaments ? (
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
      ) : activeView === "join" && canManageTournaments ? (
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
            <div className="cr-card" style={{ width: "100%", maxWidth: "900px", boxSizing: "border-box", background: "#080808", backgroundColor: "#080808", color: "#fff", border: "1px solid #b5122a" }}>
              <div className="cr-card-glow"></div>
              {(() => {
                const registration = (activeTournament.groups || []).find((group) => group?.name === "__INSCRIPCIONES__");
                const participants = Array.isArray(registration?.teams) ? registration.teams : [];
                const capacity = Number(registration?.capacity || 0);
                const canManage = canManageTournaments;
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
              isAdmin={canManageTournaments}
              isReferee={isArbitro}
              onUpdateMatchResult={handleUpdateMatchResult}
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
            isAdmin={canManageTournaments}
            isReferee={isArbitro}
            onUpdateMatchResult={handleUpdateMatchResult}
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

      {(activeView === "groups" || activeView === "playoffs") && (
        <div style={{ width: "100%", maxWidth: "900px", display: "flex", justifyContent: "flex-end", margin: "0.75rem auto 1.25rem", padding: "0 0.25rem", boxSizing: "border-box" }}>
          <button
            type="button"
            className="tc-form-back"
            onClick={() => {
              setActiveTournament(null);
              setActiveView("home");
            }}
          >
            ← Volver a torneos
          </button>
        </div>
      )}
    </div>
  );
}

export default TournamenSportApp;
