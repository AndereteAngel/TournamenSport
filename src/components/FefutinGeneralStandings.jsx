import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

const getCategory = (tournament) => {
  const explicit = String(tournament?.category_detail || tournament?.category_type || "").trim();
  if (explicit) return explicit;
  const parts = String(tournament?.game || "").split("·").map((part) => part.trim());
  return parts.length ? parts[parts.length - 1] : "Sin categoría";
};

const normalize = (value) => String(value || "").trim().toLocaleLowerCase("es")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const getCompetitionName = (tournament) => String(tournament?.title || "").trim() || "Torneo sin nombre";

const makeStandings = (sheets, tournamentIds, selectedCategory, tournaments) => {
  const standings = new Map();
  const processed = new Set();
  const ensureTeam = (name) => {
    const teamName = typeof name === "string" ? name : String(name?.name || name?.team_name || name?.club_name || name?.nombre || "");
    const key = normalize(teamName);
    if (!key) return null;
    if (!standings.has(key)) standings.set(key, {
      name: teamName.trim(), played: 0, wins: 0, draws: 0, losses: 0,
      goalsFor: 0, goalsAgainst: 0, points: 0,
    });
    return standings.get(key);
  };

  // Los participantes salen de los torneos realmente creados y comienzan con cero puntos.
  tournaments.forEach((tournament) => {
    if (selectedCategory && getCategory(tournament) !== selectedCategory) return;
    (Array.isArray(tournament.groups) ? tournament.groups : []).forEach((group) => {
      if (group?.name === "__INSCRIPCIONES__") return;
      (Array.isArray(group?.teams) ? group.teams : []).forEach(ensureTeam);
    });
  });

  sheets.forEach((sheet) => {
    (Array.isArray(sheet.detalles) ? sheet.detalles : []).forEach((detail, index) => {
      const tournamentId = String(detail?.tournament_id || "");
      if (!tournamentIds.has(tournamentId)) return;
      if (selectedCategory && String(detail?.categoria || "") !== selectedCategory) return;
      if (detail?.score1 == null || detail?.score2 == null) return;
      const matchKey = String(sheet.jornada_key || sheet.id) + "::" + String(detail.clave || index);
      if (processed.has(matchKey)) return;
      processed.add(matchKey);

      const team1 = ensureTeam(detail.team1 || sheet.team_local);
      const team2 = ensureTeam(detail.team2 || sheet.team_visitante);
      if (!team1 || !team2) return;
      const score1 = Number(detail.score1);
      const score2 = Number(detail.score2);
      if (!Number.isFinite(score1) || !Number.isFinite(score2)) return;
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

const getArchivedMatches = (sheets, tournamentIds, selectedCategory) => {
  const matches = [];
  const processed = new Set();
  sheets.forEach((sheet) => {
    (Array.isArray(sheet.detalles) ? sheet.detalles : []).forEach((detail, index) => {
      const tournamentId = String(detail?.tournament_id || "");
      if (!tournamentIds.has(tournamentId)) return;
      if (selectedCategory && String(detail?.categoria || "") !== selectedCategory) return;
      const team1 = String(detail?.team1 || sheet.team_local || "").trim();
      const team2 = String(detail?.team2 || sheet.team_visitante || "").trim();
      if (!team1 || !team2 || normalize(team1) === "pasaje directo" || normalize(team2) === "pasaje directo") return;
      const key = String(sheet.jornada_key || sheet.id) + "::" + String(detail?.clave || index);
      if (processed.has(key)) return;
      processed.add(key);
      const played = detail?.score1 != null && detail?.score2 != null &&
        Number.isFinite(Number(detail.score1)) && Number.isFinite(Number(detail.score2));
      matches.push({
        key,
        category: String(detail?.categoria || "Sin categoría"),
        team1,
        team2,
        played,
        score1: played ? Number(detail.score1) : null,
        score2: played ? Number(detail.score2) : null,
      });
    });
  });
  return matches.sort((a, b) =>
    a.category.localeCompare(b.category, "es", { numeric: true }) ||
    a.team1.localeCompare(b.team1, "es") ||
    a.team2.localeCompare(b.team2, "es")
  );
};

export function FefutinGeneralStandings({ tournaments = [], branch = "Infantil" }) {
  const [selectedCompetition, setSelectedCompetition] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedTeam, setSelectedTeam] = useState("");
  const [sheets, setSheets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [clubLogos, setClubLogos] = useState([]);

  // La competencia se identifica exclusivamente por RAMA + NOMBRE DEL TORNEO.
  // El turno es un dato informativo y no participa de esta agrupación.
  const competitions = useMemo(() => {
    const grouped = new Map();
    tournaments.forEach((tournament) => {
      const name = getCompetitionName(tournament);
      const key = normalize(name);
      if (!grouped.has(key)) grouped.set(key, { key, name, tournaments: [] });
      grouped.get(key).tournaments.push(tournament);
    });
    return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [tournaments]);

  const activeCompetition = competitions.find((item) => item.key === selectedCompetition);
  const activeTournaments = activeCompetition?.tournaments || [];
  const activeTournamentIdsKey = activeTournaments.map((item) => String(item.id)).filter(Boolean).sort().join("|");
  const activeTournamentIds = useMemo(
    () => activeTournamentIdsKey ? activeTournamentIdsKey.split("|") : [],
    [activeTournamentIdsKey]
  );
  const tournamentIds = useMemo(() => new Set(activeTournamentIds), [activeTournamentIds]);

  useEffect(() => {
    let cancelled = false;
    const loadCompetitionClubLogos = async () => {
      if (!activeTournaments.length) {
        setClubLogos([]);
        return;
      }
      const results = await Promise.all(activeTournaments.map((tournament) =>
        supabase.rpc("get_fefutin_tournament_clubs", { p_tournament_id: tournament.id })
      ));
      if (cancelled) return;
      const clubs = results.flatMap(({ data, error: rpcError }) => {
        if (rpcError) {
          console.error("Error al cargar escudos de la tabla general:", rpcError);
          return [];
        }
        return data || [];
      });
      const uniqueClubs = [...new Map(clubs.map((club) => [
        normalize(club.club_name),
        {
          name: club.club_name,
          url: club.logo_path
            ? supabase.storage.from("fefutin-clubs").getPublicUrl(club.logo_path).data.publicUrl
            : "",
        },
      ]).filter(([key]) => key)).values()];
      setClubLogos(uniqueClubs);
    };
    loadCompetitionClubLogos();
    return () => { cancelled = true; };
  }, [activeTournamentIdsKey]);
  const categories = useMemo(() => [...new Set(activeTournaments.map(getCategory))]
    .filter((category) => category && category !== "Sin categoría")
    .sort((a, b) => a.localeCompare(b, "es", { numeric: true })), [activeTournaments]);

  useEffect(() => {
    let active = true;
    if (!selectedCompetition || !activeTournamentIds.length) {
      setSheets([]);
      setLoaded(false);
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    setLoaded(false);
    setError("");
    supabase.from("fefutin_public_jornada_sheets").select("*")
      .overlaps("tournament_ids", activeTournamentIds)
      .order("jornada_date", { ascending: true })
      .then(({ data, error: queryError }) => {
        if (!active) return;
        if (queryError) setError("No se pudieron consultar las planillas generales cerradas: " + queryError.message);
        else setSheets(data || []);
        setLoaded(true);
        setLoading(false);
      });
    return () => { active = false; };
  }, [selectedCompetition, activeTournamentIdsKey]);

  useEffect(() => {
    setSelectedCategory("");
    setSelectedTeam("");
  }, [selectedCompetition]);

  const rows = useMemo(
    () => makeStandings(sheets, tournamentIds, selectedCategory, activeTournaments),
    [sheets, tournamentIds, selectedCategory, activeTournaments]
  );
  const archivedMatches = useMemo(
    () => getArchivedMatches(sheets, tournamentIds, selectedCategory),
    [sheets, tournamentIds, selectedCategory]
  );
  const selectedTeamMatches = selectedTeam
    ? archivedMatches.filter((match) => normalize(match.team1) === normalize(selectedTeam) || normalize(match.team2) === normalize(selectedTeam))
    : [];

  if (!competitions.length) return null;

  const cardStyle = {
    background: "#171c27", color: "#fff", border: "1px solid #b5122a",
    borderRadius: "12px", padding: ".85rem", width: "100%", textAlign: "left",
  };

  return (
    <section aria-label={`Tablas generales de ${branch}`} style={{ margin: "1rem 0 1.25rem", color: "#fff" }}>
      <style>{`
        .fefutin-general-team-link {
          display: inline-block;
          appearance: none;
          padding: 0;
          border: 0;
          background: transparent !important;
          background-image: none !important;
          box-shadow: none !important;
          color: #fff;
          font: inherit;
          font-size: .9rem;
          font-weight: 900;
          letter-spacing: .01em;
          line-height: 1.25;
          text-align: left;
          text-decoration: none;
          cursor: pointer;
          animation: fefutinTeamGlow 2.8s ease-in-out infinite;
          transition: color .2s ease, text-shadow .2s ease, transform .2s ease;
        }
        .fefutin-general-team-link:hover,
        .fefutin-general-team-link:focus-visible {
          color: #fff;
          text-shadow: 0 0 5px rgba(255,255,255,.85), 0 0 12px rgba(243,160,173,.9), 0 0 20px rgba(181,18,42,.8);
          outline: none;
          transform: translateX(2px);
        }
        @keyframes fefutinTeamGlow {
          0%, 100% { text-shadow: 0 0 0 rgba(243,160,173,0); }
          50% { text-shadow: 0 0 5px rgba(243,160,173,.55), 0 0 10px rgba(181,18,42,.35); }
        }
        @media (prefers-reduced-motion: reduce) {
          .fefutin-general-team-link { animation: none; transition: none; }
        }
      `}</style>
      <h3 style={{ textAlign: "center", color: "#fff", fontSize: ".9rem", letterSpacing: ".1em", margin: "0 0 .7rem" }}>TABLAS GENERALES</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 210px), 1fr))", gap: ".65rem" }}>
        {competitions.map((competition) => (
          <button key={competition.key} type="button"
            onClick={() => setSelectedCompetition((current) => current === competition.key ? "" : competition.key)}
            aria-expanded={selectedCompetition === competition.key}
            style={{ ...cardStyle, cursor: "pointer", textAlign: "center", background: selectedCompetition === competition.key ? "#b5122a" : "#171c27" }}>
            <strong style={{ display: "block", fontSize: ".82rem", letterSpacing: ".04em" }}>TABLA GENERAL · {branch.toLocaleUpperCase("es")}</strong>
            <span style={{ display: "block", marginTop: ".3rem", color: "#f3a0ad", fontWeight: 900 }}>{competition.name.toLocaleUpperCase("es")}</span>
            <small style={{ display: "block", marginTop: ".25rem", color: "#ddd" }}>{competition.tournaments.length} torneo(s) incluidos</small>
          </button>
        ))}
      </div>

      {activeCompetition && (
        <div style={{ ...cardStyle, marginTop: ".8rem", textAlign: "left" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".6rem", flexWrap: "wrap" }}>
            <div>
              <strong style={{ display: "block", textAlign: "center" }}>TABLA GENERAL · {branch.toLocaleUpperCase("es")} · {activeCompetition.name.toLocaleUpperCase("es")}</strong>
              <small style={{ display: "block", color: "#bbb", marginTop: ".25rem" }}>Acumulado de los torneos de esta rama y con este nombre. El turno no modifica la agrupación.</small>
            </div>
            <button type="button" onClick={() => setSelectedCompetition("")}
              style={{ background: "#fff", color: "#171c27", border: "1px solid #b5122a", borderRadius: "7px", padding: ".45rem .7rem", fontWeight: 800 }}>Cerrar</button>
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

          {!!rows.length && (
            <div style={{ overflowX: "auto", marginTop: ".8rem" }}>
              <table style={{ width: "100%", minWidth: "540px", borderCollapse: "collapse", color: "#fff", fontSize: ".76rem" }}>
                <thead><tr style={{ background: "#b5122a" }}>
                  {["POS", "CLUB", "PTS", "PJ", "PG", "PE", "PP", "GF", "GC", "DIF"].map((heading) =>
                    <th key={heading} style={{ padding: ".55rem .35rem", textAlign: heading === "CLUB" ? "left" : "center", whiteSpace: "nowrap" }}>{heading}</th>
                  )}
                </tr></thead>
                <tbody>{rows.map((team, index) => (
                  <tr key={normalize(team.name)} style={{ borderBottom: "1px solid #454545", background: index % 2 ? "#202633" : "#11151d" }}>
                    <td style={{ padding: ".55rem .35rem", textAlign: "center", fontWeight: 900 }}>{index + 1}</td>
                    <td style={{ padding: ".55rem .35rem", fontWeight: 800, textAlign: "left" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: ".5rem", minWidth: 0 }}>
                        {clubLogos.find((club) => normalize(club.name) === normalize(team.name))?.url ? (
                          <img src={clubLogos.find((club) => normalize(club.name) === normalize(team.name)).url} alt={`Escudo de ${team.name}`} style={{ width: "30px", height: "30px", objectFit: "contain", flexShrink: 0 }} />
                        ) : null}
                        <button className="fefutin-general-team-link" type="button" onClick={() => setSelectedTeam(team.name)}
                          aria-label={`Ver partidos de ${team.name}`}
                          style={{}}>
                          {team.name}
                        </button>
                      </div>
                    </td>
                    {[team.points, team.played, team.wins, team.draws, team.losses, team.goalsFor, team.goalsAgainst, team.goalDifference].map((value, valueIndex) =>
                      <td key={valueIndex} style={{ padding: ".55rem .35rem", textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{value}</td>
                    )}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {loaded && !error && !rows.length && (
            <p style={{ color: "#ddd", textAlign: "center", margin: "1rem 0 .2rem" }}>Todavía no hay equipos cargados para esta competencia y categoría.</p>
          )}

          <small style={{ display: "block", color: "#aaa", marginTop: ".7rem" }}>Solo se consultan planillas generales cerradas y archivadas. No se generan equipos ni resultados ficticios.</small>
        </div>

      )}

      {selectedTeam && (
        <div role="presentation" onClick={() => setSelectedTeam("")}
          style={{ position: "fixed", inset: 0, zIndex: 9999, display: "grid", placeItems: "center", padding: "1rem", background: "rgba(0,0,0,.78)" }}>
          <section role="dialog" aria-modal="true" aria-label={`Partidos de ${selectedTeam}`}
            onClick={(event) => event.stopPropagation()}
            style={{ position: "relative", width: "100%", maxWidth: "620px", maxHeight: "85vh", overflowY: "auto", background: "#171c27", color: "#fff", border: "2px solid #b5122a", borderRadius: "14px", padding: "1rem", boxShadow: "0 18px 55px rgba(0,0,0,.55)" }}>
            <button type="button" onClick={() => setSelectedTeam("")} aria-label="Cerrar partidos"
              style={{ position: "absolute", top: ".55rem", right: ".55rem", width: "34px", height: "34px", borderRadius: "50%", border: "1px solid #b5122a", background: "#fff", color: "#171c27", fontSize: "1.25rem", fontWeight: 900, cursor: "pointer" }}>×</button>
            <h3 style={{ margin: "0 2.5rem 1rem 0", color: "#fff", textAlign: "center", fontSize: "1rem" }}>{selectedTeam}</h3>
            {loading && <p style={{ textAlign: "center", color: "#ddd" }}>Cargando partidos…</p>}
            {error && <p role="alert" style={{ color: "#fca5a5" }}>{error}</p>}
            {!loading && !error && !selectedTeamMatches.length && (
              <p style={{ color: "#ddd", textAlign: "center" }}>Todavía no hay partidos archivados para este equipo.</p>
            )}
            {!loading && !error && ["Jugados", "Pendientes"].map((status) => {
              const teamMatches = selectedTeamMatches.filter((match) => status === "Jugados" ? match.played : !match.played);
              return (
                <div key={status} style={{ marginTop: ".8rem" }}>
                  <h4 style={{ margin: "0 0 .5rem", paddingBottom: ".35rem", borderBottom: "1px solid #454545", color: status === "Jugados" ? "#fff" : "#f3a0ad", fontSize: ".85rem" }}>
                    {status.toUpperCase()} ({teamMatches.length})
                  </h4>
                  {!teamMatches.length ? <p style={{ margin: ".45rem 0", color: "#aaa", fontSize: ".82rem" }}>No hay partidos {status.toLocaleLowerCase("es")}.</p> : (
                    <div style={{ display: "grid", gap: ".45rem" }}>
                      {teamMatches.map((match) => {
                        const isTeam1 = normalize(match.team1) === normalize(selectedTeam);
                        const opponent = isTeam1 ? match.team2 : match.team1;
                        const score = isTeam1 ? `${match.score1} - ${match.score2}` : `${match.score2} - ${match.score1}`;
                        return (
                          <div key={match.key} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: ".5rem", alignItems: "center", padding: ".65rem", borderRadius: "8px", background: "#11151d", border: "1px solid #343b49" }}>
                            <div style={{ minWidth: 0 }}>
                              <small style={{ display: "block", color: "#f3a0ad", marginBottom: ".2rem" }}>{match.category}</small>
                              <strong style={{ overflowWrap: "anywhere" }}>vs. {opponent}</strong>
                            </div>
                            <strong style={{ whiteSpace: "nowrap", color: match.played ? "#fff" : "#f3a0ad" }}>{match.played ? score : "PENDIENTE"}</strong>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        </div>
      )}
    </section>
  );
}
