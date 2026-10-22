import { TCIcon } from "./TCIcon";

export function PlayoffBracket({
  tournament,
  onUpdateTournament,
  onFinishTournament,
}) {
  const rounds = tournament.playoffs || [];
  const isFinalized = String(tournament.status || "").trim().toLocaleLowerCase("es") === "finalizado";

  const handleScoreChange = (roundIdx, matchId, field, value) => {
    if (isFinalized) return;
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
        const winners = currentRound.map((m) => m.winner);
        for (let i = 0; i < winners.length; i += 2) {
          nextRoundMatches.push({
            id: `r${roundId}-m${nextRoundMatches.length + 1}`,
            team1: winners[i],
            team2: winners[i + 1] || "Pasaje Directo",
            score1: null,
            score2: null,
            winner: null,
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
          {tournament.game}
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
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.8rem",
                        fontWeight: "bold",
                        width: "38%",
                        textAlign: "right",
                        color:
                          match.winner === match.team1 ? "#4ade80" : "#fff",
                      }}
                    >
                      {match.winner === match.team1 && <><TCIcon name="crown" size={13} /> </>} {match.team1}
                    </span>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <input
                        type="number"
                        min="0"
                        disabled={isFinalized}
                        value={match.score1 !== null ? match.score1 : ""}
                        onChange={(e) =>
                          handleScoreChange(
                            rIdx,
                            match.id,
                            "score1",
                            e.target.value
                          )
                        }
                        style={{
                          width: "34px",
                          textAlign: "center",
                          backgroundColor: "#1e1b2e",
                          border: "1px solid #1b5fa8",
                          color: "#fff",
                          borderRadius: "4px",
                          padding: "4px",
                        }}
                      />
                      <span>-</span>
                      <input
                        type="number"
                        min="0"
                        disabled={isFinalized}
                        value={match.score2 !== null ? match.score2 : ""}
                        onChange={(e) =>
                          handleScoreChange(
                            rIdx,
                            match.id,
                            "score2",
                            e.target.value
                          )
                        }
                        style={{
                          width: "34px",
                          textAlign: "center",
                          backgroundColor: "#1e1b2e",
                          border: "1px solid #1b5fa8",
                          color: "#fff",
                          borderRadius: "4px",
                          padding: "4px",
                        }}
                      />
                    </div>

                    <span
                      style={{
                        fontSize: "0.8rem",
                        fontWeight: "bold",
                        width: "38%",
                        textAlign: "left",
                        color:
                          match.winner === match.team2 ? "#4ade80" : "#fff",
                      }}
                    >
                      {match.team2} {match.winner === match.team2 && <TCIcon name="crown" size={14} />}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {isTournamentComplete && (
        <div
          style={{
            backgroundColor: "rgba(255, 215, 0, 0.15)",
            border: "3px solid #ffd700",
            borderRadius: "14px",
            padding: "1.5rem",
            textAlign: "center",
            marginBottom: "1rem",
            boxShadow: "0 0 20px rgba(255, 215, 0, 0.4)",
          }}
        >
          <div className="tc-playoff-champion-icons"><TCIcon name="crown" size={26} /><TCIcon name="trophy" size={40} /><TCIcon name="crown" size={26} /></div>
          <h3
            style={{
              fontSize: "1.2rem",
              fontWeight: 900,
              color: "#ffd700",
              textTransform: "uppercase",
              margin: "0 0 6px 0",
            }}
          >
            ¡Tenemos Campeón de la Arena!
          </h3>
          <p
            style={{
              fontSize: "1.1rem",
              fontWeight: 900,
              color: "#fff",
              margin: 0,
            }}
          >
            {champion} se corona como el rey indiscutible.
          </p>
        </div>
      )}

      {isTournamentComplete && !isFinalized && (
        <button onClick={onFinishTournament} className="cr-btn-gold">
          <TCIcon name="sword" size={16} /> Guardar y Salir al Lobby
        </button>
      )}
    </div>
  );
}
