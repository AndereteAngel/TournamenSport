import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

const getTurno = (tournament) => {
  const parts = String(tournament?.game || "").split("·").map((part) => part.trim().toLocaleLowerCase("es"));
  if (parts.includes("matutino")) return "Matutino";
  if (parts.includes("vespertino")) return "Vespertino";
  return "";
};

const getCategory = (tournament) => {
  const explicit = String(tournament?.category_detail || tournament?.category_type || "").trim();
  if (explicit) return explicit;
  const parts = String(tournament?.game || "").split("·").map((part) => part.trim());
  return parts.length ? parts[parts.length - 1] : "Sin categoría";
};

const normalize = (value) => String(value || "").trim().toLocaleLowerCase("es")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const makeStandings = (sheets, tournamentIds, selectedCategory, tournaments) => {
  const standings = new Map();
  const processed = new Set();
  const ensureTeam = (name) => {
    const key = normalize(name);
    if (!key) return null;
    if (!standings.has(key)) standings.set(key, {
      name: String(name).trim(), played: 0, wins: 0, draws: 0, losses: 0,
      goalsFor: 0, goalsAgainst: 0, points: 0,
    });
    return standings.get(key);
  };

  // Los participantes salen de los torneos realmente creados: aparecen con cero
  // puntos hasta que una planilla cerrada aporte resultados.
  tournaments.forEach((tournament) => {
    if (selectedCategory && getCategory(tournament) !== selectedCategory) return;
    (Array.isArray(tournament.groups) ? tournament.groups : []).forEach((group) => {
      (Array.isArray(group?.teams) ? group.teams : []).forEach(ensureTeam);
    });
  });

  sheets.forEach((sheet) => {
    (Array.isArray(sheet.detalles) ? sheet.detalles : []).forEach((detail, index) => {
      const tournamentId = String(detail?.tournament_id || "");
      if (!tournamentIds.has(tournamentId)) return;
      if (selectedCategory && String(detail?.categoria || "") !== selectedCategory) return;
      if (!detail?.resultadoCargado || detail.score1 == null || detail.score2 == null) return;
      const matchKey = String(sheet.jornada_key || sheet.id) + "::" + String(detail.clave || index);
      if (processed.has(matchKey)) return;
      processed.add(matchKey);

      const team1 = ensureTeam(detail.team1 || sheet.team_local);
      const team2 = ensureTeam(detail.team2 || sheet.team_visitante);
      if (!team1 || !team2) return;
      const score1 = Number(detail.score1);
      const score2 = Number(detail.score2);
      if (!Number.isFinite(score1) || !Number.isFinite(score2)) return;
      // En la planilla, puntosTeam1/2 están orientados según team_local/visitante
      // de la jornada, mientras que detail.team1/2 conserva el orden del partido.
      const detailTeam1IsLocal = normalize(detail.team1 || sheet.team_local) === normalize(sheet.team_local);
      const points1 = Number(detailTeam1IsLocal ? detail.puntosTeam1 : detail.puntosTeam2) || 0;
      const points2 = Number(detailTeam1IsLocal ? detail.puntosTeam2 : detail.puntosTeam1) || 0;

      team1.played += 1;
      team2.played += 1;
      team1.goalsFor += score1;
      team1.goalsAgainst += score2;
      team2.goalsFor += score2;
      team2.goalsAgainst += score1;
      team1.points += points1;
      team2.points += points2;
      if (score1 > score2) { team1.wins += 1; team2.losses += 1; }
      else if (score1 < score2) { team2.wins += 1; team1.losses += 1; }
      else { team1.draws += 1; team2.draws += 1; }
    });
  });

  return [...standings.values()].map((team) => ({
    ...team,
    goalDifference: team.goalsFor - team.goalsAgainst,
  })).sort((a, b) =>
    b.points - a.points ||
    b.goalDifference - a.goalDifference ||
    b.goalsFor - a.goalsFor ||
    a.name.localeCompare(b.name, "es")
  );
};

export function FefutinGeneralStandings({ tournaments = [], branch = "Infantil" }) {
  const [selectedTurno, setSelectedTurno] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [sheets, setSheets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const tournamentsByTurno = useMemo(() => ({
    Matutino: tournaments.filter((item) => getTurno(item) === "Matutino"),
    Vespertino: tournaments.filter((item) => getTurno(item) === "Vespertino"),
  }), [tournaments]);

  const availableTurnos = ["Matutino", "Vespertino"].filter((turno) => tournamentsByTurno[turno].length > 0);
  const activeTournaments = selectedTurno ? tournamentsByTurno[selectedTurno] || [] : [];
  const activeTournamentIds = activeTournaments.map((item) => String(item.id));
  const activeTournamentIdsKey = activeTournamentIds.join("|");
  const tournamentIds = useMemo(() => new Set(activeTournamentIds), [activeTournamentIdsKey]);
  const categories = useMemo(() => [...new Set(activeTournaments.map(getCategory))]
    .filter((category) => category && category !== "Sin categoría")
    .sort((a, b) => a.localeCompare(b, "es", { numeric: true })), [activeTournaments]);

  useEffect(() => {
    let active = true;
    if (!selectedTurno) return () => { active = false; };
    setLoading(true);
    setLoaded(false);
    setError("");
    supabase.from("fefutin_public_jornada_sheets").select("*").overlaps("tournament_ids", activeTournamentIds).order("jornada_date", { ascending: true })
      .then(({ data, error: queryError }) => {
        if (!active) return;
        if (queryError) setError("No se pudieron consultar las planillas generales cerradas: " + queryError.message);
        else setSheets(data || []);
        setLoaded(true);
        setLoading(false);
      });
    return () => { active = false; };
  }, [selectedTurno, activeTournamentIdsKey]);

  useEffect(() => {
    setSelectedCategory("");
  }, [selectedTurno]);

  const rows = useMemo(() => makeStandings(sheets, tournamentIds, selectedCategory, activeTournaments), [sheets, tournamentIds, selectedCategory, activeTournaments]);

  if (!availableTurnos.length) return null;

  const cardStyle = {
    background: "#171c27", color: "#fff", border: "1px solid #b5122a",
    borderRadius: "12px", padding: ".85rem", width: "100%", textAlign: "left",
  };

  return (
    <section aria-label={`Tablas generales de ${branch}`} style={{ margin: "1rem 0 1.25rem", color: "#fff" }}>
      <h3 style={{ textAlign: "center", color: "#fff", fontSize: ".9rem", letterSpacing: ".1em", margin: "0 0 .7rem" }}>TABLAS GENERALES</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax( min(100%, 210px), 1fr))", gap: ".65rem" }}>
        {availableTurnos.map((turno) => (
          <button key={turno} type="button" onClick={() => setSelectedTurno((current) => current === turno ? "" : turno)}
            aria-expanded={selectedTurno === turno}
            style={{ ...cardStyle, cursor: "pointer", textAlign: "center", background: selectedTurno === turno ? "#b5122a" : "#171c27" }}>
            <strong style={{ display: "block", fontSize: ".82rem", letterSpacing: ".04em" }}>TABLA GENERAL · {branch.toLocaleUpperCase("es")}</strong>
            <span style={{ display: "block", marginTop: ".3rem", color: "#f3a0ad", fontWeight: 900 }}>{turno.toLocaleUpperCase("es")}</span>
            <small style={{ display: "block", marginTop: ".25rem", color: "#ddd" }}>{tournamentsByTurno[turno].length} torneo(s) incluidos</small>
          </button>
        ))}
      </div>

      {selectedTurno && (
        <div style={{ ...cardStyle, marginTop: ".8rem", textAlign: "left" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".6rem", flexWrap: "wrap" }}>
            <div>
              <strong style={{ display: "block", textAlign: "center" }}>TABLA GENERAL · {branch.toLocaleUpperCase("es")} · {selectedTurno.toLocaleUpperCase("es")}</strong>
              <small style={{ display: "block", color: "#bbb", marginTop: ".25rem" }}>Acumulado de los torneos creados en esta rama y turno.</small>
            </div>
            <button type="button" onClick={() => setSelectedTurno("")} style={{ background: "#fff", color: "#171c27", border: "1px solid #b5122a", borderRadius: "7px", padding: ".45rem .7rem", fontWeight: 800 }}>Cerrar</button>
          </div>

          {categories.length > 1 && (
            <label style={{ display: "block", marginTop: ".8rem", color: "#fff", fontSize: ".8rem", fontWeight: 800 }}>
              CATEGORÍA
              <select value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)}
                style={{ display: "block", width: "100%", marginTop: ".35rem", padding: ".65rem", border: "1px solid #b5122a", borderRadius: "8px", background: "#fff", color: "#171c27" }}>
                <option value="">Todas las categorías</option>
                {categories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>
          )}

          {loading && <p style={{ color: "#ddd", textAlign: "center" }}>Cargando puntos acumulados…</p>}
          {error && <p role="alert" style={{ color: "#fca5a5" }}>{error}</p>}
          {loaded && !error && !rows.length && (
            <p style={{ color: "#ddd", textAlign: "center", margin: "1rem 0 .2rem" }}>Todavía no hay planillas generales cerradas con resultados para este turno. La tabla se completará automáticamente al archivarse las jornadas.</p>
          )}
          {!!rows.length && (
            <div style={{ overflowX: "auto", marginTop: ".8rem" }}>
              <table style={{ width: "100%", minWidth: "540px", borderCollapse: "collapse", color: "#fff", fontSize: ".76rem" }}>
                <thead><tr style={{ background: "#b5122a" }}>
                  {["POS", "CLUB", "PJ", "PG", "PE", "PP", "GF", "GC", "DIF", "PTS"].map((heading) =>
                    <th key={heading} style={{ padding: ".55rem .35rem", textAlign: heading === "CLUB" ? "left" : "center", whiteSpace: "nowrap" }}>{heading}</th>
                  )}
                </tr></thead>
                <tbody>{rows.map((team, index) => (
                  <tr key={normalize(team.name)} style={{ borderBottom: "1px solid #454545", background: index % 2 ? "#202633" : "#11151d" }}>
                    <td style={{ padding: ".55rem .35rem", textAlign: "center", fontWeight: 900 }}>{index + 1}</td>
                    <td style={{ padding: ".55rem .35rem", fontWeight: 800 }}>{team.name}</td>
                    {[team.played, team.wins, team.draws, team.losses, team.goalsFor, team.goalsAgainst, team.goalDifference, team.points].map((value, valueIndex) =>
                      <td key={valueIndex} style={{ padding: ".55rem .35rem", textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{value}</td>
                    )}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <small style={{ display: "block", color: "#aaa", marginTop: ".7rem" }}>Solo se suman resultados de planillas generales cerradas y archivadas. No se generan equipos ni resultados ficticios.</small>
        </div>
      )}
    </section>
  );
}
