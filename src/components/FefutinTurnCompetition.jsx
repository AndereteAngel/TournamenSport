import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { FefutinMatchSheet } from "./FefutinMatchSheet";

const normalize = (value) => String(value || "").trim().toLocaleLowerCase("es")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "");

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
  currentUser,
  isAdmin = false,
  isDirectivo = false,
  isReferee = false,
  onBack,
}) {
  const [competition, setCompetition] = useState(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [referees, setReferees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
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

  useEffect(() => {
    let active = true;
    if (!canManage) {
      setReferees([]);
      return () => { active = false; };
    }
    supabase.from("profiles")
      .select("id, username, role, approval_status, deactivated_at")
      .eq("role", "arbitro")
      .eq("approval_status", "aprobado")
      .is("deactivated_at", null)
      .order("username")
      .then(({ data, error: queryError }) => {
        if (!active) return;
        if (queryError) {
          console.error("No se pudo cargar el directorio de arbitros:", queryError);
          setReferees([]);
          return;
        }
        setReferees(data || []);
      });
    return () => { active = false; };
  }, [canManage]);

  const assignReferee = async (matchId, refereeId) => {
    const { error: assignError } = await supabase.rpc("assign_fefutin_normalized_match_referee", {
      p_match_id: matchId,
      p_referee_id: refereeId || null,
    });
    if (assignError) {
      setError(assignError.message || "No se pudo asignar el árbitro.");
      return;
    }
    setNotice(refereeId ? "Árbitro asignado al encuentro." : "Se quitó la designación del encuentro.");
    await loadCompetition();
  };

  const categories = competition?.categories || [];
  const activeCategory = categories.find((item) => String(item.tournament_category_id) === String(selectedCategoryId)) || categories[0] || null;
  const standings = useMemo(() => buildStandings(activeCategory), [activeCategory]);
  const allFormatsSupported = categories.every((category) => category.format === "league");

  const startTurn = async () => {
    if (!canManage || starting || !turn?.turn_id) return;
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

  const closeNormalizedMatch = async ({ score1, score2 }) => {
    if (!selectedMatch?.id) return false;
    const { error: closeError } = await supabase.rpc("referee_close_normalized_match_from_sheet", {
      p_match_id: selectedMatch.id,
    });
    if (closeError) {
      setError(closeError.message || "No se pudo cerrar el partido.");
      return false;
    }
    setNotice(`Partido cerrado: ${selectedMatch.team1} ${score1} - ${score2} ${selectedMatch.team2}.`);
    setSelectedMatch(null);
    await loadCompetition();
    return true;
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

      {!!categories.length && (
        <nav style={{ display: "flex", gap: ".5rem", overflowX: "auto", padding: ".7rem 0" }}>
          {categories.map((category) => (
            <button key={category.tournament_category_id} type="button" onClick={() => setSelectedCategoryId(category.tournament_category_id)} style={{ flex: "0 0 auto", padding: ".65rem .9rem", border: "1px solid #b5122a", borderRadius: "8px", background: activeCategory?.tournament_category_id === category.tournament_category_id ? "#b5122a" : "#171c27", color: "#fff", fontWeight: 900 }}>
              {category.name}
            </button>
          ))}
        </nav>
      )}

      {activeCategory && (
        <div style={{ display: "grid", gap: ".85rem" }}>
          <section style={{ padding: ".9rem", background: "#171c27", border: "1px solid #444", borderRadius: "10px" }}>
            <strong style={{ display: "block", color: "#fff" }}>{activeCategory.name} · {activeCategory.format === "league" ? "TODOS CONTRA TODOS" : activeCategory.format}</strong>
            <small style={{ color: "#bbb" }}>{activeCategory.clubs?.length || 0} clubes inscriptos · {activeCategory.status}</small>
            {standings.length > 0 && (
              <div style={{ overflowX: "auto", marginTop: ".7rem" }}>
                <table style={{ width: "100%", minWidth: "500px", borderCollapse: "collapse", fontSize: ".74rem" }}>
                  <thead><tr style={{ background: "#b5122a" }}>{["POS", "CLUB", "PTS", "PJ", "PG", "PE", "PP", "GF", "GC", "DIF"].map((name) => <th key={name} style={{ padding: ".45rem .3rem" }}>{name}</th>)}</tr></thead>
                  <tbody>{standings.map((team, index) => <tr key={normalize(team.name)} style={{ borderBottom: "1px solid #444" }}>
                    <td style={{ padding: ".45rem", textAlign: "center" }}>{index + 1}</td>
                    <td style={{ padding: ".45rem", fontWeight: 800 }}>{team.name}</td>
                    {[team.points, team.played, team.wins, team.draws, team.losses, team.goalsFor, team.goalsAgainst, team.goalDifference].map((value, i) => <td key={i} style={{ padding: ".45rem", textAlign: "center" }}>{value}</td>)}
                  </tr>)}</tbody>
                </table>
              </div>
            )}
          </section>

          {(activeCategory.rounds || []).map((round) => (
            <section key={round.round_id} style={{ padding: ".85rem", background: "#101010", border: "1px solid #444", borderRadius: "10px" }}>
              <strong style={{ color: "#f3a0ad" }}>JORNADA {round.round_number} · {round.scheduled_date ? new Date(`${round.scheduled_date}T12:00:00`).toLocaleDateString("es-AR") : "Fecha a confirmar"}</strong>
              <div style={{ display: "grid", gap: ".45rem", marginTop: ".6rem" }}>
                {(round.matches || []).map((match) => {
                  const assigned = String(match.referee_id || "") === String(currentUser?.id || "");
                  const canOpenSheet = canManage || (isReferee && assigned);
                  return (
                    <div key={match.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: ".5rem", alignItems: "center", padding: ".65rem", background: "#171c27", borderRadius: "8px" }}>
                      <div style={{ minWidth: 0 }}>
                        <strong style={{ display: "block", overflowWrap: "anywhere" }}>{match.team1} <span style={{ color: "#f3a0ad" }}>{match.score1 == null ? "—" : match.score1} - {match.score2 == null ? "—" : match.score2}</span> {match.team2}</strong>
                        <small style={{ color: "#aaa" }}>{match.scheduled_time || "Horario a confirmar"} · {match.referee_name || (assigned ? "Tu designación" : match.referee_id ? "Árbitro designado" : "Sin árbitro")}</small>
                        {canManage && (
                          <label style={{ display: "flex", alignItems: "center", gap: ".4rem", marginTop: ".45rem", color: "#bbb", fontSize: ".68rem" }}>
                            Árbitro
                            <select
                              value={match.referee_id || ""}
                              disabled={match.referee_closed}
                              onChange={(event) => assignReferee(match.id, event.target.value)}
                              style={{ minWidth: 0, maxWidth: "100%", padding: ".35rem", borderRadius: "6px", background: "#fff", color: "#171c27" }}
                            >
                              <option value="">Sin designar</option>
                              {referees.map((referee) => <option key={referee.id} value={referee.id}>{referee.username}</option>)}
                            </select>
                          </label>
                        )}
                      </div>
                      {canOpenSheet && (
                        <button type="button" onClick={() => setSelectedMatch(match)} style={{ padding: ".55rem .65rem", border: "1px solid #b5122a", borderRadius: "7px", background: "#b5122a", color: "#fff", fontSize: ".68rem", fontWeight: 900 }}>
                          {match.referee_closed ? "VER PLANILLA" : "PLANILLA"}
                        </button>
                      )}
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
      {selectedMatch && (
        <div style={{ marginTop: "1rem" }}>
          <FefutinMatchSheet
            tournament={tournament}
            match={selectedMatch}
            categoryLabel={activeCategory ? `${competition?.branch_name || ""} · ${activeCategory.name}` : ""}
            isReferee={isReferee}
            isAdmin={canManage}
            onCloseMatch={closeNormalizedMatch}
            onClose={() => setSelectedMatch(null)}
          />
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
        <button type="button" onClick={loadCompetition} disabled={loading} className="tc-form-back">↻ Actualizar turno</button>
      </div>
    </section>
  );
}
