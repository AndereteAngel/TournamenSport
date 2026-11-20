import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

const normalize = (value) => String(value || "").trim().toLocaleLowerCase("es")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const getLocalDateValue = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
};

const buildStandings = (category) => {
  const teams = new Map();
  (category?.clubs || []).forEach((club) => {
    const key = normalize(club.club_name);
    if (key) teams.set(key, {
      name: club.club_name,
      logo_path: club.logo_path,
      played: 0, wins: 0, draws: 0, losses: 0,
      goalsFor: 0, goalsAgainst: 0, points: 0,
    });
  });
  const matches = (category?.rounds || []).flatMap((round) => round.matches || []);
  matches.forEach((match) => {
    if (match.score1 == null || match.score2 == null) return;
    const local = teams.get(normalize(match.team1));
    const visitor = teams.get(normalize(match.team2));
    if (!local || !visitor) return;
    const score1 = Number(match.score1);
    const score2 = Number(match.score2);
    if (!Number.isFinite(score1) || !Number.isFinite(score2)) return;
    local.played += 1;
    visitor.played += 1;
    local.goalsFor += score1;
    local.goalsAgainst += score2;
    visitor.goalsFor += score2;
    visitor.goalsAgainst += score1;
    if (score1 > score2) { local.wins += 1; visitor.losses += 1; local.points += 3; }
    else if (score2 > score1) { visitor.wins += 1; local.losses += 1; visitor.points += 3; }
    else { local.draws += 1; visitor.draws += 1; local.points += 2; visitor.points += 2; }
  });
  return [...teams.values()].map((team) => ({
    ...team,
    goalDifference: team.goalsFor - team.goalsAgainst,
  })).sort((a, b) =>
    b.points - a.points || b.goalDifference - a.goalDifference ||
    b.goalsFor - a.goalsFor || a.name.localeCompare(b.name, "es")
  );
};

export function FefutinTurnCompetition({
  tournament,
  turn,
  isAdmin = false,
  isDirectivo = false,
  onBack,
}) {
  const [competition, setCompetition] = useState(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [selectedTeamName, setSelectedTeamName] = useState("");
  const [teamMatchesView, setTeamMatchesView] = useState("pending");
  const [standingsExpanded, setStandingsExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [startDate, setStartDate] = useState(getLocalDateValue);
  const [daysBetween, setDaysBetween] = useState(turn?.turno === "Semanal" ? 7 : 7);

  const canManage = isAdmin || isDirectivo;
  const loadCompetition = useCallback(async () => {
    if (!turn?.turn_id) return;
    setLoading(true);
    setError("");
    const { data, error: queryError } = await supabase.rpc("get_fefutin_turn_competition", {
      p_turn_id: turn.turn_id,
    });
    if (queryError) {
      setError(queryError.message || "No se pudo cargar el turno.");
      setCompetition(null);
    } else {
      setCompetition(data || null);
      const firstCategory = data?.categories?.[0]?.tournament_category_id;
      setSelectedCategoryId((current) =>
        current && data?.categories?.some((item) => item.tournament_category_id === current)
          ? current
          : firstCategory || ""
      );
    }
    setLoading(false);
  }, [turn?.turn_id]);

  useEffect(() => { loadCompetition(); }, [loadCompetition]);

  const categories = competition?.categories || [];
  const activeCategory = categories.find((item) => String(item.tournament_category_id) === String(selectedCategoryId)) || categories[0] || null;
  const standings = useMemo(() => buildStandings(activeCategory), [activeCategory]);
  const categoryMatches = (activeCategory?.rounds || []).flatMap((round) =>
    (round.matches || []).map((match) => ({ ...match, roundNumber: round.round_number, scheduledDate: round.scheduled_date }))
  );
  const selectedTeamMatches = selectedTeamName
    ? categoryMatches.filter((match) => normalize(match.team1) === normalize(selectedTeamName) || normalize(match.team2) === normalize(selectedTeamName))
    : [];
  const playedTeamMatches = selectedTeamMatches.filter((match) => match.score1 != null && match.score2 != null);
  const pendingTeamMatches = selectedTeamMatches.filter((match) => match.score1 == null || match.score2 == null);
  const filteredRounds = (activeCategory?.rounds || []).map((round) => ({
    ...round,
    matches: (round.matches || []).filter((match) => {
      if (!selectedTeamName) return true;
      const belongsToTeam = normalize(match.team1) === normalize(selectedTeamName) || normalize(match.team2) === normalize(selectedTeamName);
      const hasResult = match.score1 != null && match.score2 != null;
      return belongsToTeam && (teamMatchesView === "played" ? hasResult : !hasResult);
    }),
  })).filter((round) => !selectedTeamName || round.matches.length > 0);
  const allFormatsSupported = categories.every((category) => category.format === "league");
  const allMatches = categories.flatMap((category) => (category.rounds || []).flatMap((round) => round.matches || []));
  const allMatchesClosed = allMatches.length > 0 && allMatches.every((match) => match.referee_closed);

  const finishTurn = async () => {
    if (!canManage || !allMatchesClosed) return;
    const { data, error: finishError } = await supabase.rpc("finish_fefutin_turn", {
      p_turn_id: turn.turn_id,
    });
    if (finishError) {
      setError(finishError.message || "No se pudo finalizar el turno.");
      return;
    }
    setNotice(data?.all_turns_finished
      ? "Turno finalizado. Todas las competencias de esta rama están finalizadas."
      : "Turno finalizado. El otro turno de la rama permanece independiente.");
    await loadCompetition();
  };

  const startTurn = async () => {
    if (!canManage || starting || !turn?.turn_id || !categories.length || !allFormatsSupported) return;
    setStarting(true);
    setError("");
    setNotice("");
    const { data, error: startError } = await supabase.rpc("generate_fefutin_turn_fixtures", {
      p_turn_id: turn.turn_id,
      p_start_date: startDate,
      p_days_between: Number(daysBetween) || 7,
    });
    if (startError) {
      setError(startError.message || "No se pudo iniciar el turno.");
    } else {
      setNotice(`Turno iniciado: ${data?.categories_started || 0} categorías, ${data?.journeys_generated || 0} jornadas y ${data?.matches_generated || 0} partidos.`);
      await loadCompetition();
    }
    setStarting(false);
  };

  if (loading && !competition) {
    return <section className="tc-form-screen" style={{ padding: "1rem", color: "#fff" }}>Cargando turno y fixture...</section>;
  }

  return (
    <section className="tc-form-screen" style={{ width: "100%", maxWidth: "100%", padding: "1rem", boxSizing: "border-box", color: "#fff" }}>
      <button type="button" className="tc-form-back" onClick={onBack}>← Volver a los turnos</button>
      <header style={{ margin: "1rem 0", padding: "1rem", background: "#101010", border: "1px solid #b5122a", borderRadius: "12px", textAlign: "center" }}>
        <small style={{ color: "#f3a0ad", fontWeight: 900, letterSpacing: ".12em" }}>FEFUTIN · {competition?.branch_name || turn?.branch_name || ""}</small>
        <h2 style={{ margin: ".35rem 0", color: "#fff" }}>{competition?.tournament_title || tournament?.title || "Torneo"} · {competition?.turno || turn?.turno}</h2>
        <span style={{ color: "#bbb", fontSize: ".8rem" }}>Estado: {competition?.turn_status || turn?.turn_status || "inscripcion"}</span>
      </header>

      {error && <p role="alert" style={{ color: "#fecaca", background: "#450a0a", border: "1px solid #b5122a", borderRadius: "8px", padding: ".75rem" }}>{error}</p>}
      {notice && <p role="status" style={{ color: "#bbf7d0", background: "#052e16", border: "1px solid #166534", borderRadius: "8px", padding: ".75rem" }}>{notice}</p>}

      {(competition?.turn_status || turn?.turn_status) === "inscripcion" && canManage && (
        <section style={{ display: "grid", gap: ".7rem", padding: "1rem", border: "1px solid #555", borderRadius: "10px", background: "#171c27" }}>
          <strong>INICIAR {competition?.turno?.toLocaleUpperCase("es") || turn?.turno?.toLocaleUpperCase("es")}</strong>
          <p style={{ color: "#ccc", fontSize: ".8rem", margin: 0 }}>El fixture se genera por separado para cada categoría y todos los partidos de la misma fecha quedan dentro de una jornada general del turno.</p>
          <label style={{ display: "grid", gap: ".3rem", fontSize: ".78rem" }}>Primera fecha
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} style={{ padding: ".65rem", borderRadius: "7px", background: "#fff", color: "#171c27" }} />
          </label>
          <label style={{ display: "grid", gap: ".3rem", fontSize: ".78rem" }}>Días entre jornadas
            <input type="number" min="1" max="60" value={daysBetween} onChange={(event) => setDaysBetween(event.target.value)} style={{ padding: ".65rem", borderRadius: "7px", background: "#fff", color: "#171c27" }} />
          </label>
          {!allFormatsSupported && <p style={{ color: "#fcd34d", fontSize: ".78rem", margin: 0 }}>Este turno contiene formatos distintos de todos-contra-todos. No se iniciará parcialmente.</p>}
          <button type="button" onClick={startTurn} disabled={starting || !categories.length || !allFormatsSupported} style={{ padding: ".8rem", border: 0, borderRadius: "8px", background: "#b5122a", color: "#fff", fontWeight: 900, opacity: starting || !categories.length || !allFormatsSupported ? .55 : 1 }}>
            {starting ? "GENERANDO FIXTURE..." : "CERRAR INSCRIPCIÓN E INICIAR TURNO"}
          </button>
        </section>
      )}

      {(competition?.turn_status === "en_curso" && canManage) && (
        <section style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".75rem", flexWrap: "wrap", padding: ".8rem", background: "#171c27", border: "1px solid #555", borderRadius: "9px" }}>
          <span style={{ color: allMatchesClosed ? "#86efac" : "#fcd34d", fontSize: ".78rem", fontWeight: 800 }}>
            {allMatchesClosed ? "TODOS LOS PARTIDOS ESTÁN CERRADOS" : `${allMatches.filter((match) => !match.referee_closed).length} PARTIDO(S) PENDIENTE(S) DE CIERRE`}
          </span>
          <button type="button" onClick={finishTurn} disabled={!allMatchesClosed} style={{ padding: ".65rem .85rem", border: "1px solid #b5122a", borderRadius: "8px", background: allMatchesClosed ? "#b5122a" : "#444", color: "#fff", fontWeight: 900, opacity: allMatchesClosed ? 1 : .55 }}>
            FINALIZAR TURNO
          </button>
        </section>
      )}

      {!!categories.length && (
        <nav style={{ display: "flex", gap: ".5rem", overflowX: "auto", padding: ".7rem 0" }}>
          {categories.map((category) => (
            <button key={category.tournament_category_id} type="button" onClick={() => { setSelectedCategoryId(category.tournament_category_id); setSelectedTeamName(""); setTeamMatchesView("pending"); }} style={{ flex: "0 0 auto", padding: ".65rem .9rem", border: "1px solid #b5122a", borderRadius: "8px", background: activeCategory?.tournament_category_id === category.tournament_category_id ? "#b5122a" : "#171c27", color: "#fff", fontWeight: 900 }}>
              {category.name}
            </button>
          ))}
        </nav>
      )}

      {activeCategory && (
        <div style={{ display: "grid", gap: ".85rem" }}>
          <section style={{ padding: ".9rem", minWidth: 0, width: "100%", boxSizing: "border-box", overflow: "hidden", background: "#171c27", border: "1px solid #444", borderRadius: "10px" }}>
            <strong style={{ display: "block", color: "#fff" }}>{activeCategory.name} · {activeCategory.format === "league" ? "TODOS CONTRA TODOS" : activeCategory.format}</strong>
            <small style={{ color: "#bbb" }}>{activeCategory.clubs?.length || 0} clubes inscriptos · {activeCategory.status}</small>
            {standings.length > 0 && (
              <>
              <style>{`
                @media (max-width: 700px) {
                  .fefutin-standings--compact th:nth-child(n+5),
                  .fefutin-standings--compact td:nth-child(n+5) { display: none; }
                  .fefutin-standings--compact table { width: 100% !important; min-width: 0 !important; }
                  .fefutin-standings--expanded table { width: max-content !important; min-width: 620px !important; }
                }
              `}</style>
              <button type="button" onClick={() => setStandingsExpanded((expanded) => !expanded)} aria-expanded={standingsExpanded} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", marginTop: ".7rem", padding: ".65rem .7rem", border: "1px solid #b5122a", borderRadius: "7px", background: "#101010", color: "#fff", fontWeight: 900, textAlign: "left", cursor: "pointer" }}>
                <span>TABLA DE POSICIONES</span>
                <span style={{ color: "#f3a0ad", fontSize: ".75rem" }}>{standingsExpanded ? "▲ OCULTAR ESTADÍSTICAS" : "▼ VER TABLA COMPLETA"}</span>
              </button>
              <div
                role="region"
                className={`fefutin-standings ${standingsExpanded ? "fefutin-standings--expanded" : "fefutin-standings--compact"}`}
                aria-label={`Tabla de posiciones de ${activeCategory.name}`}
                tabIndex={0}
                style={{
                  display: "block",
                  width: standingsExpanded ? "calc(100vw - 3.8rem)" : "100%",
                  maxWidth: standingsExpanded ? "calc(100vw - 3.8rem)" : "100%",
                  minWidth: 0,
                  boxSizing: "border-box",
                  overflowX: "scroll",
                  overflowY: "hidden",
                  marginTop: ".7rem",
                  WebkitOverflowScrolling: "touch",
                  overscrollBehaviorX: "contain",
                  touchAction: "pan-x",
                }}
              >
                <table style={{ width: "max-content", minWidth: "620px", borderCollapse: "separate", borderSpacing: 0, tableLayout: "auto", fontSize: ".74rem" }}>
                  <thead>
                    <tr style={{ background: "#b5122a" }}>
                      {["POS", "CLUB", "PTS", "PJ", "PG", "PE", "PP", "GF", "GC", "DIF"].map((name) => (
                        <th
                          key={name}
                          style={{
                            padding: ".55rem .45rem",
                            whiteSpace: "nowrap",
                            textAlign: name === "CLUB" ? "left" : "center",
                            ...(name === "POS" ? { position: "sticky", left: 0, zIndex: 4, width: "34px", minWidth: "34px", boxSizing: "border-box", background: "#b5122a" } : {}),
                            ...(name === "CLUB" ? { position: "sticky", left: "34px", zIndex: 4, width: "140px", minWidth: "140px", boxSizing: "border-box", background: "#b5122a" } : {}),
                            ...(name === "PTS" ? { position: "sticky", left: "174px", zIndex: 3, width: "52px", minWidth: "52px", boxSizing: "border-box", background: "#b5122a", color: "#fff", fontWeight: 900 } : {}),
                            ...(name === "PJ" ? { position: "sticky", left: "226px", zIndex: 3, width: "48px", minWidth: "48px", boxSizing: "border-box", background: "#b5122a", color: "#fff", fontWeight: 900 } : {}),
                          }}
                        >
                          {name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {standings.map((team, index) => (
                      <tr key={normalize(team.name)} style={{ borderBottom: "1px solid #444" }}>
                        <td style={{ padding: ".55rem .45rem", textAlign: "center", whiteSpace: "nowrap", position: "sticky", left: 0, zIndex: 4, width: "34px", minWidth: "34px", boxSizing: "border-box", background: "#171c27" }}>
                          {index + 1}
                        </td>
                        <td style={{ padding: ".45rem", fontWeight: 800, whiteSpace: "nowrap", position: "sticky", left: "34px", zIndex: 4, width: "140px", minWidth: "140px", boxSizing: "border-box", background: "#171c27" }}>
                          <span style={{ display: "flex", alignItems: "center", gap: ".45rem", minWidth: 0 }}>
                            {team.logo_path ? (
                              <img
                                src={supabase.storage.from("fefutin-clubs").getPublicUrl(team.logo_path).data.publicUrl}
                                alt={`Escudo de ${team.name}`}
                                loading="lazy"
                                style={{ width: "24px", height: "24px", objectFit: "contain", borderRadius: "5px", background: "transparent", flexShrink: 0 }}
                              />
                            ) : (
                              <span aria-hidden="true" style={{ width: "24px", height: "24px", display: "grid", placeItems: "center", borderRadius: "5px", background: "#2a1117", color: "#fff", fontSize: ".85rem", flexShrink: 0 }}>⚽</span>
                            )}
                            <span style={{ fontSize: ".82rem", fontWeight: 800, letterSpacing: ".01em" }}>{team.name}</span>
                          </span>
                        </td>
                        {[team.points, team.played, team.wins, team.draws, team.losses, team.goalsFor, team.goalsAgainst, team.goalDifference].map((value, i) => (
                          <td key={i} style={{ padding: ".55rem .5rem", textAlign: "center", whiteSpace: "nowrap", ...(i === 0 ? { position: "sticky", left: "174px", zIndex: 3, width: "52px", minWidth: "52px", boxSizing: "border-box", background: "#171c27", color: "#f3a0ad", fontWeight: 900, fontSize: ".86rem" } : {}), ...(i === 1 ? { position: "sticky", left: "226px", zIndex: 3, width: "48px", minWidth: "48px", boxSizing: "border-box", background: "#171c27", color: "#fff", fontWeight: 900 } : {}) }}>{value}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <small style={{ display: "block", marginTop: ".35rem", color: "#aaa", fontSize: ".68rem" }}>
                En celular, tocá “TABLA DE POSICIONES” para desplegar u ocultar las estadísticas.
              </small>
              </>
            )}
          </section>

          <section style={{ display: "grid", gap: ".65rem", padding: ".85rem", background: "#101010", border: "1px solid #444", borderRadius: "10px" }}>
            <strong style={{ color: "#f3a0ad", fontSize: ".82rem" }}>CONSULTAR PARTIDOS POR EQUIPO</strong>
            <select value={selectedTeamName} onChange={(event) => setSelectedTeamName(event.target.value)} aria-label="Elegir equipo para filtrar sus partidos" style={{ width: "100%", boxSizing: "border-box", padding: ".7rem", borderRadius: "8px", background: "#fff", color: "#171c27", fontWeight: 700 }}>
              <option value="">Todos los equipos · ver fixture completo</option>
              {(activeCategory.clubs || []).map((club) => <option key={club.club_id || club.club_name} value={club.club_name}>{club.club_name}</option>)}
            </select>
            {selectedTeamName ? (
              <>
                <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
                  <button type="button" onClick={() => setTeamMatchesView("pending")} aria-pressed={teamMatchesView === "pending"} style={{ flex: "1 1 120px", padding: ".6rem .7rem", borderRadius: "7px", border: teamMatchesView === "pending" ? "1px solid #fbbf24" : "1px solid #765d20", background: teamMatchesView === "pending" ? "#49380d" : "#241d0b", color: "#fbbf24", fontWeight: 900 }}>⏳ {pendingTeamMatches.length} pendientes</button>
                  <button type="button" onClick={() => setTeamMatchesView("played")} aria-pressed={teamMatchesView === "played"} style={{ flex: "1 1 120px", padding: ".6rem .7rem", borderRadius: "7px", border: teamMatchesView === "played" ? "1px solid #4ade80" : "1px solid #245b38", background: teamMatchesView === "played" ? "#12351f" : "#0c2115", color: "#4ade80", fontWeight: 900 }}>✓ {playedTeamMatches.length} disputados</button>
                </div>
                <small style={{ color: "#aaa" }}>Mostrando los partidos {teamMatchesView === "pending" ? "pendientes" : "disputados"} de {selectedTeamName}.</small>
              </>
            ) : <small style={{ color: "#aaa" }}>Elegí un equipo para consultar sus partidos pendientes o disputados.</small>}
          </section>

          {selectedTeamName && filteredRounds.length === 0 && <p style={{ color: "#bbb", textAlign: "center" }}>{teamMatchesView === "pending" ? "Este equipo no tiene partidos pendientes." : "Este equipo todavía no tiene partidos disputados."}</p>}
          {filteredRounds.map((round) => (
            <section key={round.round_id} style={{ padding: ".85rem", background: "#101010", border: "1px solid #444", borderRadius: "10px" }}>
              <strong style={{ color: "#f3a0ad" }}>JORNADA {round.round_number} · {round.scheduled_date ? new Date(`${round.scheduled_date}T12:00:00`).toLocaleDateString("es-AR") : "Fecha a confirmar"}</strong>
              <div style={{ display: "grid", gap: ".5rem", marginTop: ".6rem" }}>
                {(round.matches || []).map((match) => {
                  const homeClub = (activeCategory.clubs || []).find((club) => normalize(club.club_name) === normalize(match.team1));
                  const awayClub = (activeCategory.clubs || []).find((club) => normalize(club.club_name) === normalize(match.team2));
                  const homeLogo = homeClub?.logo_path ? supabase.storage.from("fefutin-clubs").getPublicUrl(homeClub.logo_path).data.publicUrl : null;
                  const awayLogo = awayClub?.logo_path ? supabase.storage.from("fefutin-clubs").getPublicUrl(awayClub.logo_path).data.publicUrl : null;
                  const hasResult = match.score1 != null && match.score2 != null;
                  return (
                    <div key={match.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)", gap: ".55rem", alignItems: "center", padding: ".75rem .6rem", background: "#171c27", border: "1px solid #333", borderRadius: "9px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: ".4rem", minWidth: 0 }}>
                        {homeLogo ? <img src={homeLogo} alt={`Escudo de ${match.team1}`} loading="lazy" style={{ width: "30px", height: "30px", objectFit: "contain", flexShrink: 0 }} /> : <span aria-hidden="true" style={{ width: "30px", textAlign: "center", flexShrink: 0 }}>⚽</span>}
                        <strong style={{ fontSize: ".78rem", lineHeight: 1.2, overflowWrap: "anywhere" }}>{match.team1}</strong>
                      </div>
                      <strong style={{ minWidth: "54px", textAlign: "center", color: hasResult ? "#fff" : "#f3a0ad", fontSize: "1rem", fontWeight: 900, whiteSpace: "nowrap" }}>{hasResult ? `${match.score1} - ${match.score2}` : "VS"}</strong>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: ".4rem", minWidth: 0 }}>
                        <strong style={{ fontSize: ".78rem", lineHeight: 1.2, textAlign: "right", overflowWrap: "anywhere" }}>{match.team2}</strong>
                        {awayLogo ? <img src={awayLogo} alt={`Escudo de ${match.team2}`} loading="lazy" style={{ width: "30px", height: "30px", objectFit: "contain", flexShrink: 0 }} /> : <span aria-hidden="true" style={{ width: "30px", textAlign: "center", flexShrink: 0 }}>⚽</span>}
                      </div>
                    </div>
                  );
                })}
                {!round.matches?.length && <p style={{ color: "#aaa", fontSize: ".8rem" }}>Esta categoría no tiene partidos en esta jornada.</p>}
              </div>
            </section>
          ))}
          {!activeCategory.rounds?.length && <p style={{ color: "#bbb", textAlign: "center" }}>El fixture de esta categoría todavía no fue generado.</p>}
        </div>
      )}

      {!categories.length && <p style={{ color: "#bbb", textAlign: "center" }}>Este turno todavía no tiene categorías configuradas.</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
        <button type="button" onClick={loadCompetition} disabled={loading} className="tc-form-back">↻ Actualizar turno</button>
      </div>
    </section>
  );
}
