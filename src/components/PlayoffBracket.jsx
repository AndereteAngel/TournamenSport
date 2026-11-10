import { useState } from "react";
import { TCIcon } from "./TCIcon";
import { FefutinMatchSheet } from "./FefutinMatchSheet";

export function PlayoffBracket({
  tournament,
  onUpdateTournament,
  onFinishTournament,
  isAdmin = false,
  isReferee = false,
  isReferente = false,
  currentUser,
  onCloseMatch,
  clubLogos = [],
}) {
  const rounds = tournament.playoffs || [];
  const [selectedSheetMatch, setSelectedSheetMatch] = useState(null);
  const getClubLogo = (teamName) => {
    const normalize = (value) => String(value || "").trim().toLocaleLowerCase("es");
    return clubLogos.find((club) => normalize(club.name) === normalize(teamName))?.url || "";
  };
  const isFinalized = String(tournament.status || "").trim().toLocaleLowerCase("es") === "finalizado";
  const canEditFixtureScores = isAdmin && !isFinalized;

  const handleScoreChange = (roundIdx, matchId, field, value) => {
    if (!canEditFixtureScores || isFinalized) return;
    const numValue = value === "" ? null : Number(value);

    // Copiamos las rondas actuales y eliminamos rondas posteriores si se modifica un resultado anterior
    const updatedRounds = rounds.slice(0, roundIdx + 1).map((round, rIdx) => {
      if (rIdx !== roundIdx) return round;

      return round.map((match) => {
        if (match.id !== matchId) return match;

        const updated = { ...match, [field]: numValue };

        if (updated.score1 !== null && updated.score2 !== null) {
          if (updated.score1 > updated.score2) updated.winner = updated.team1;
          else if (updated.score2 > updated.score1)
            updated.winner = updated.team2;
          else updated.winner = "Empate (Definir)";
        } else {
          updated.winner = null;
        }

        return updated;
      });
    });

    const currentRound = updatedRounds[roundIdx];
    const isCurrentRoundComplete = currentRound.every(
      (m) => m.winner !== null && m.winner !== "Empate (Definir)"
    );

    // Al completar las semifinales, creamos la final y el partido por el tercer puesto.
    // En las demás rondas, avanzan los ganadores como siempre.
    if (isCurrentRoundComplete && currentRound.length > 1 && !currentRound.some((match) => match.stage === "final" || match.stage === "third_place")) {
      const nextRoundMatches = [];
      const roundId = roundIdx + 2;

      if (currentRound.length === 2 && currentRound.every((match) => match.team1 !== "Pasaje Directo" && match.team2 !== "Pasaje Directo")) {
        const [firstSemi, secondSemi] = currentRound;
        const loserOf = (match) =>
          match.winner === match.team1 ? match.team2 : match.team1;

        nextRoundMatches.push({
          id: `r${roundId}-final`,
          stage: "final",
          team1: firstSemi.winner,
          team2: secondSemi.winner,
          score1: null,
          score2: null,
          winner: null,
        });
        nextRoundMatches.push({
          id: `r${roundId}-third-place`,
          stage: "third_place",
          team1: loserOf(firstSemi),
          team2: loserOf(secondSemi),
          score1: null,
          score2: null,
          winner: null,
        });
      } else {
        // Ranquear a los ganadores de esta ronda por la diferencia de gol
        // obtenida en su partido: mayor diferencia = mejor rankeado.
        const rankedWinners = [...currentRound].sort((a, b) => {
          const diffA = Math.abs((a.score1 ?? 0) - (a.score2 ?? 0));
          const diffB = Math.abs((b.score1 ?? 0) - (b.score2 ?? 0));
          if (diffA !== diffB) return diffB - diffA;

          const winnerGoals = (match) =>
            match.winner === match.team1 ? (match.score1 ?? 0) : (match.score2 ?? 0);
          return winnerGoals(b) - winnerGoals(a);
        });

        // El mejor rankeado enfrenta al peor; el segundo al penúltimo, etc.
        let left = 0;
        let right = rankedWinners.length - 1;
        while (left < right) {
          const best = rankedWinners[left].winner;
          const worst = rankedWinners[right].winner;
          nextRoundMatches.push({
            id: `r${roundId}-m${nextRoundMatches.length + 1}`,
            team1: best,
            team2: worst,
            score1: null,
            score2: null,
            winner: null,
          });
          left++;
          right--;
        }
        if (left === right) {
          nextRoundMatches.push({
            id: `r${roundId}-m${nextRoundMatches.length + 1}`,
            team1: rankedWinners[left].winner,
            team2: "Pasaje Directo",
            score1: 1,
            score2: 0,
            winner: rankedWinners[left].winner,
          });
        }
      }

      updatedRounds.push(nextRoundMatches);
    }

    onUpdateTournament({ ...tournament, playoffs: updatedRounds });
  };

  const finalRound = rounds[rounds.length - 1];
  const finalMatch =
    finalRound?.find((match) => match.stage === "final") ||
    (finalRound?.length === 1 ? finalRound[0] : null);
  const champion = finalMatch?.winner;
  const isTournamentComplete = champion && champion !== "Empate (Definir)";

  return (
    <div className="cr-card" style={{ maxWidth: "600px" }}>
      <div className="cr-card-glow"></div>

      <div
        style={{
          marginBottom: "1.25rem",
          paddingBottom: "0.9rem",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {/* ETIQUETA DEL JUEGO */}
        <div
          style={{
            fontSize: "10px",
            color: "#ffd700",
            fontWeight: "bold",
            textTransform: "uppercase",
            marginBottom: "4px",
            textAlign: "center",
          }}
        >
          {String(tournament.game || "").split(" · ")[0]}
        </div>

        {/* TÍTULO */}
        <h2
          className="cr-title"
          style={{
            fontSize: "1.2rem",
            textAlign: "center",
            margin: "0",
            width: "100%",
          }}
        >
          {tournament.title} - Playoffs
        </h2>
        {tournament.category_detail || (String(tournament.game || "").includes(" · ") ? String(tournament.game).split(" · ").slice(1).join(" · ") : "") && (
          <div style={{ marginTop: "0.45rem", color: "#f3a847", fontSize: "0.85rem", fontWeight: 800, textAlign: "center" }}>
            Categoría: {tournament.category_detail || (String(tournament.game || "").includes(" · ") ? String(tournament.game).split(" · ").slice(1).join(" · ") : "")}
          </div>
        )}

        {/* FASE */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginTop: "10px",
          }}
        >
          <span
            style={{
              fontSize: "10px",
              backgroundColor: "rgba(234, 179, 8, 0.12)",
              color: "#facc15",
              border: "1px solid rgba(234, 179, 8, 0.6)",
              padding: "5px 10px",
              borderRadius: "6px",
              fontWeight: "bold",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              whiteSpace: "nowrap",
            }}
          >
            LLAVES DE ELIMINACIÓN
          </span>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "1.5rem",
          marginBottom: "1.5rem",
        }}
      >
        {rounds.map((round, rIdx) => (
          <div key={rIdx}>
            <h3
              style={{
                fontSize: "0.8rem",
                fontWeight: "bold",
                textTransform: "uppercase",
                color: "#ffd700",
                marginBottom: "0.5rem",
                borderBottom: "1px solid #2d2b3b",
                paddingBottom: "4px",
              }}
            >
              {round.some((match) => match.stage === "third_place")
                ? "Gran Final y partido por el tercer puesto"
                : round.some((match) => match.stage === "final") || (rIdx === rounds.length - 1 && round.length === 1)
                ? "Gran Final"
                : rounds.length === 1
                ? "Eliminación Directa"
                : rIdx === 0
                ? "Cuartos de Final"
                : rIdx === 1
                ? "Semifinales"
                : `Fase ${rIdx + 1}`}
            </h3>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
              }}
            >
              {round.map((match) => (
                <div
                  key={match.id}
                  style={{
                    padding: "0.6rem 0.75rem",
                    backgroundColor: "#121019",
                    border: "2px solid #2d2b3b",
                    borderRadius: "10px",
                  }}
                >
                  {match.stage === "third_place" && (
                    <div style={{ color: "#facc15", fontSize: "0.68rem", fontWeight: 800, textAlign: "center", marginBottom: "0.4rem", textTransform: "uppercase" }}>
                      Partido por el 3.er puesto
                    </div>
                  )}
                  {match.stage === "final" && (
                    <div style={{ color: "#ffd700", fontSize: "0.68rem", fontWeight: 800, textAlign: "center", marginBottom: "0.4rem", textTransform: "uppercase" }}>
                      Gran final
                    </div>
                  )}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                      gap: "0.25rem",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.3rem", width: "42%", minWidth: 0 }}>
                      {getClubLogo(match.team1) ? <img src={getClubLogo(match.team1)} alt={`Escudo de ${match.team1}`} style={{ width: "30px", height: "30px", objectFit: "contain", borderRadius: "5px", flexShrink: 0 }} /> : null}
                      <span style={{ minWidth: 0, fontSize: "0.74rem", fontWeight: "bold", textAlign: "center", overflowWrap: "anywhere", color: match.winner === match.team1 ? "#4ade80" : "#fff" }}>
                        {match.winner === match.team1 && <><TCIcon name="crown" size={13} /> </>}{match.team1}
                      </span>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                        minWidth: "72px",
                      }}
                    >
                      {canEditFixtureScores ? (
                        <>
                          <input type="number" min="0" value={match.score1 !== null ? match.score1 : ""} onChange={(e) => handleScoreChange(rIdx, match.id, "score1", e.target.value)} style={{ width: "34px", textAlign: "center", backgroundColor: "#1e1b2e", border: "1px solid #1b5fa8", color: "#fff", borderRadius: "4px", padding: "4px" }} />
                          <span>-</span>
                          <input type="number" min="0" value={match.score2 !== null ? match.score2 : ""} onChange={(e) => handleScoreChange(rIdx, match.id, "score2", e.target.value)} style={{ width: "34px", textAlign: "center", backgroundColor: "#1e1b2e", border: "1px solid #1b5fa8", color: "#fff", borderRadius: "4px", padding: "4px" }} />
                        </>
                      ) : (
                        <strong style={{ color: "#fff", fontSize: "0.9rem", letterSpacing: "0.08em" }}>
                          {match.score1 !== null ? match.score1 : "–"} - {match.score2 !== null ? match.score2 : "–"}
                        </strong>
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.3rem", width: "42%", minWidth: 0 }}>
                      <span style={{ minWidth: 0, fontSize: "0.74rem", fontWeight: "bold", textAlign: "center", overflowWrap: "anywhere", color: match.winner === match.team2 ? "#4ade80" : "#fff" }}>
                        {match.team2}{match.winner === match.team2 && <> <TCIcon name="crown" size={14} /></>}
                      </span>
                      {getClubLogo(match.team2) ? <img src={getClubLogo(match.team2)} alt={`Escudo de ${match.team2}`} style={{ width: "30px", height: "30px", objectFit: "contain", borderRadius: "5px", flexShrink: 0 }} /> : null}
                    </div>
                  </div>
                  {(isAdmin || isReferente || (isReferee && String(match.referee_id || "") === String(currentUser?.id || ""))) && match.team1 !== "Pasaje Directo" && match.team2 !== "Pasaje Directo" && (
                    <button
                      type="button"
                      onClick={() => setSelectedSheetMatch({ ...match, round: String(rIdx + 1), roundIndex: rIdx })}
                      style={{ width: "100%", marginTop: "0.55rem", padding: "0.5rem 0.65rem", borderRadius: "7px", border: "1px solid #b5122a", background: "#241015", color: "#fff", fontSize: "0.72rem", fontWeight: 900, cursor: "pointer" }}
                    >
                      📋 ABRIR PLANILLA OFICIAL
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {isTournamentComplete && (
        <div
          style={{
            background: "linear-gradient(145deg, #171717 0%, #080808 100%)",
            border: "2px solid #ff7900",
            borderRadius: "14px",
            padding: "1.5rem",
            textAlign: "center",
            marginBottom: "1rem",
            boxShadow: "0 0 22px rgba(255, 121, 0, 0.22), inset 0 0 18px rgba(255, 121, 0, 0.05)",
          }}
        >
          <div className="tc-playoff-champion-icons" style={{ color: "#ff7900" }}><TCIcon name="crown" size={26} /><TCIcon name="trophy" size={40} /><TCIcon name="crown" size={26} /></div>
          <h3
            style={{
              fontSize: "1.2rem",
              fontWeight: 900,
              color: "#ff7900",
              textTransform: "uppercase",
              margin: "0 0 8px 0",
              letterSpacing: "0.04em",
            }}
          >
            ¡TENEMOS CAMPEÓN DEL TORNEO!
          </h3>
          <p
            style={{
              fontSize: "1.1rem",
              fontWeight: 900,
              color: "#fff",
              margin: 0,
            }}
          >
            {champion} se consagra campeón de FEFUTIN.
          </p>
        </div>
      )}

      {isAdmin && isTournamentComplete && !isFinalized && (
        <button onClick={onFinishTournament} className="cr-btn-gold">
          <TCIcon name="sword" size={16} /> Guardar y Salir al Lobby
        </button>
      )}
      {selectedSheetMatch && (
        <FefutinMatchSheet
          tournament={tournament}
          match={selectedSheetMatch}
          isReferee={isReferee}
          readOnly={isReferente}
          onCloseMatch={async ({ score1, score2 }) => {
            const closed = await onCloseMatch?.({
              phase: "playoffs",
              roundIndex: selectedSheetMatch.roundIndex,
              matchId: selectedSheetMatch.id,
              score1,
              score2,
            });
            if (closed) setSelectedSheetMatch((current) => current ? { ...current, score1, score2, referee_closed: true } : current);
            return closed;
          }}
          onClose={() => setSelectedSheetMatch(null)}
        />
      )}
    </div>
  );
}
