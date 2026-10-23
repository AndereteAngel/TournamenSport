import { calculateGroupStandings } from "../utils/tournamentLogic";
import { TCIcon } from "./TCIcon";
import { useState } from "react";

export function GroupStageView({
  tournament,
  onUpdateTournament,
  onProceedToPlayoffs,
  currentUser,
}) {
  const [activeGroupIndex, setActiveGroupIndex] = useState(0);

  const currentGroup = tournament.groups[activeGroupIndex];

  const standings = calculateGroupStandings(
    currentGroup.teams,
    currentGroup.matches
  );

  // Solo el creador del torneo puede cargar/modificar resultados
  const isFinalized = String(tournament.status || "").trim().toLocaleLowerCase("es") === "finalizado";
  const isCreator = currentUser?.id === tournament.created_by_user_id && !isFinalized;

  // El resumen se calcula según el participante elegido en el torneo,
  // que puede tener un nombre distinto al usuario con el que inició sesión.
  const normalizarNombre = (nombre) =>
    String(nombre || "").trim().toLocaleLowerCase("es");

  const tournamentParticipants = [
    ...new Set(tournament.groups.flatMap((group) => group.teams)),
  ];

  const [selectedParticipant, setSelectedParticipant] = useState(() => {
    const usernameMatch = tournamentParticipants.find(
      (participant) =>
        normalizarNombre(participant) === normalizarNombre(currentUser?.username)
    );
    return usernameMatch || "";
  });

  const playerGroup = tournament.groups.find((group) =>
    group.teams.some(
      (team) => normalizarNombre(team) === normalizarNombre(selectedParticipant)
    )
  );

  const playerMatches = playerGroup
    ? playerGroup.matches.filter(
        (match) =>
          normalizarNombre(match.team1) === normalizarNombre(selectedParticipant) ||
          normalizarNombre(match.team2) === normalizarNombre(selectedParticipant)
      )
    : [];

  const playedMatches = playerMatches.filter(
    (match) => match.score1 !== null && match.score1 !== undefined &&
      match.score2 !== null && match.score2 !== undefined
  );

  const pendingMatches = playerMatches.filter(
    (match) => match.score1 === null || match.score1 === undefined ||
      match.score2 === null || match.score2 === undefined
  );

  const handleScoreChange = (matchId, field, value) => {
    // Seguridad adicional en la interfaz
    if (!isCreator || isFinalized) return;

    const numValue = value === "" ? null : Number(value);

    const updatedGroups = tournament.groups.map((group, gIdx) => {
      if (gIdx !== activeGroupIndex) return group;

      const updatedMatches = group.matches.map((match) => {
        if (match.id !== matchId) return match;

        return {
          ...match,
          [field]: numValue,
        };
      });

      return {
        ...group,
        matches: updatedMatches,
      };
    });

    onUpdateTournament({
      ...tournament,
      groups: updatedGroups,
    });
  };

  const allGroupsFinished = tournament.groups.every((group) =>
    group.matches.every((m) => m.score1 !== null && m.score2 !== null)
  );

  return (
    <div
      className="cr-card"
      style={{
        maxWidth: "700px",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <div className="cr-card-glow"></div>

      {/* ENCABEZADO */}
      <div
        className="tournament-header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "1rem",
          marginBottom: "1.5rem",
          paddingBottom: "1rem",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <span
            style={{
              display: "inline-block",
              fontSize: "10px",
              color: "#ffd700",
              fontWeight: "bold",
              textTransform: "uppercase",
              letterSpacing: "1px",
              marginBottom: "0.3rem",
            }}
          >
            {String(tournament.game || "").split(" · ")[0]}
          </span>

          <h2
            className="tournament-main-title"
            style={{
              margin: 0,
              padding: "0.55rem 0.75rem",
              borderLeft: "4px solid #ffd700",
              borderRadius: "0 8px 8px 0",
              background: "linear-gradient(90deg, rgba(255,215,0,0.13), rgba(255,215,0,0.015))",
              color: "#ffd700",
              fontSize: "clamp(1.25rem, 3.5vw, 1.8rem)",
              fontWeight: 900,
              lineHeight: 1.15,
              textAlign: "left",
              textShadow: "0 2px 8px rgba(255, 215, 0, 0.15)",
              textTransform: "uppercase",
              whiteSpace: "normal",
              overflowWrap: "anywhere",
            }}
          >
            {tournament.title}
          </h2>
          {tournament.category_detail || (String(tournament.game || "").includes(" · ") ? String(tournament.game).split(" · ").slice(1).join(" · ") : "") && (
            <div style={{ marginTop: "0.45rem", marginLeft: "0.75rem", color: "#f3a847", fontSize: "0.88rem", fontWeight: 800 }}>
              Categoría: {tournament.category_detail || (String(tournament.game || "").includes(" · ") ? String(tournament.game).split(" · ").slice(1).join(" · ") : "")}
            </div>
          )}
        </div>

        <span
          className="tournament-phase-badge"
          style={{
            flexShrink: 0,
            fontSize: "10px",
            background:
              "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(34,197,94,0.05))",
            color: "#4ade80",
            border: "1px solid rgba(34,197,94,0.45)",
            padding: "6px 10px",
            borderRadius: "999px",
            fontWeight: "bold",
            whiteSpace: "nowrap",
          }}
        >
          FASE DE GRUPOS
        </span>
      </div>

      {/* RESUMEN PERSONAL DEL JUGADOR */}
      {currentUser?.username && (
        <section
          aria-label="Resumen de mis partidos"
          style={{
            marginBottom: "1.25rem",
            padding: "1rem",
            borderRadius: "12px",
            background: "linear-gradient(135deg, rgba(27,95,168,0.2), rgba(18,16,25,0.92))",
            border: "1px solid rgba(96,165,250,0.3)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "0.6rem",
              marginBottom: "0.75rem",
            }}
          >
            <h3 style={{ margin: 0, color: "#fff", fontSize: "0.95rem", fontWeight: 900 }}>
              <TCIcon name="calendar" size={17} /> Mis partidos
            </h3>
            {playerGroup && (
              <span style={{ color: "#93c5fd", fontSize: "0.75rem", fontWeight: 700 }}>
                {playedMatches.length} jugados de {playerMatches.length}
              </span>
            )}
          </div>

          <label style={{ display: "block", color: "#d1d5db", fontSize: "0.75rem", fontWeight: 700, marginBottom: "0.4rem" }}>
            Elegí tu participante del torneo
          </label>
          <select
            value={selectedParticipant}
            onChange={(e) => setSelectedParticipant(e.target.value)}
            style={{
              width: "100%",
              boxSizing: "border-box",
              marginBottom: "0.85rem",
              padding: "0.65rem 0.75rem",
              borderRadius: "8px",
              border: "1px solid rgba(96,165,250,0.45)",
              background: "#15141c",
              color: "#fff",
              fontSize: "0.85rem",
            }}
          >
            <option value="">Seleccioná tu nombre en la lista del torneo</option>
            {tournamentParticipants.map((participant) => (
              <option key={participant} value={participant}>{participant}</option>
            ))}
          </select>

          {!selectedParticipant ? (
            <p style={{ margin: 0, color: "#93c5fd", fontSize: "0.8rem", lineHeight: 1.5 }}>
              Seleccioná el nombre con el que figurás en este torneo para ver tus partidos jugados y pendientes.
            </p>
          ) : !playerGroup ? (
            <p style={{ margin: 0, color: "#fbbf24", fontSize: "0.8rem", lineHeight: 1.5 }}>
              No encontramos partidos para <strong>{selectedParticipant}</strong> en esta fase.
            </p>
          ) : (
            <>
              <div
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  flexWrap: "wrap",
                  marginBottom: pendingMatches.length ? "0.8rem" : 0,
                }}
              >
                <span style={{ padding: "0.35rem 0.6rem", borderRadius: "7px", background: "rgba(34,197,94,0.12)", color: "#4ade80", fontSize: "0.75rem", fontWeight: 800 }}>
                  ✓ {playedMatches.length} jugados
                </span>
                <span style={{ padding: "0.35rem 0.6rem", borderRadius: "7px", background: "rgba(251,191,36,0.12)", color: "#fbbf24", fontSize: "0.75rem", fontWeight: 800 }}>
                  ⏳ {pendingMatches.length} pendientes
                </span>
              </div>

              {pendingMatches.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
                  <p style={{ margin: "0 0 0.2rem", color: "#d1d5db", fontSize: "0.75rem", fontWeight: 700 }}>
                    Te falta jugar contra:
                  </p>
                  {pendingMatches.map((match) => {
                    const opponent =
                      normalizarNombre(match.team1) === normalizarNombre(selectedParticipant)
                        ? match.team2
                        : match.team1;

                    return (
                      <div
                        key={match.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "0.5rem",
                          padding: "0.55rem 0.65rem",
                          borderRadius: "8px",
                          background: "rgba(0,0,0,0.2)",
                          border: "1px solid rgba(255,255,255,0.06)",
                          color: "#fff",
                          fontSize: "0.8rem",
                        }}
                      >
                        <span style={{ overflowWrap: "anywhere" }}>{opponent}</span>
                        <span style={{ color: "#fbbf24", fontSize: "0.68rem", fontWeight: 800, flexShrink: 0 }}>
                          PENDIENTE
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p style={{ margin: 0, color: "#4ade80", fontSize: "0.8rem", fontWeight: 700 }}>
                  <TCIcon name="trophy" size={17} /> ¡Completaste todos tus partidos de esta fase!
                </p>
              )}
            </>
          )}
        </section>
      )}

      {/* AVISO DE PERMISOS */}
      <div
        style={{
          marginBottom: "1.2rem",
          padding: "0.75rem 0.9rem",
          borderRadius: "10px",
          background: isCreator
            ? "rgba(255,215,0,0.07)"
            : "rgba(96,165,250,0.07)",
          border: isCreator
            ? "1px solid rgba(255,215,0,0.2)"
            : "1px solid rgba(96,165,250,0.2)",
          color: isCreator ? "#facc15" : "#93c5fd",
          fontSize: "0.75rem",
          lineHeight: 1.4,
        }}
      >
        {isCreator ? (
          <>
            <TCIcon name="shield" size={15} /> <strong>Organizador:</strong> sos el responsable de cargar y
            validar los resultados.
          </>
        ) : (
          <>
            <TCIcon name="eye" size={15} /> Los resultados son cargados exclusivamente por el organizador del
            torneo.
          </>
        )}
      </div>

      {/* SELECTOR DE GRUPOS */}
      <div style={{ marginBottom: "1.5rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "0.65rem",
            gap: "1rem",
          }}
        >
          <h3
            style={{
              fontSize: "0.8rem",
              fontWeight: "bold",
              textTransform: "uppercase",
              color: "#9ca3af",
              margin: 0,
              letterSpacing: "0.5px",
            }}
          >
            Seleccionar grupo
          </h3>

          <span
            style={{
              fontSize: "0.7rem",
              color: "#6b7280",
            }}
          >
            {tournament.groups.length} grupos
          </span>
        </div>

        <div
          style={{
            display: "flex",
            gap: "0.6rem",
            overflowX: "auto",
            padding: "0.2rem 0.1rem 0.5rem",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {tournament.groups.map((group, idx) => (
            <button
              key={group.id}
              onClick={() => setActiveGroupIndex(idx)}
              style={{
                flex: "0 0 auto",
                minWidth: "76px",
                padding: "0.65rem 1rem",
                background:
                  idx === activeGroupIndex
                    ? "linear-gradient(135deg, #1b5fa8, #123d70)"
                    : "rgba(18,16,25,0.9)",
                border:
                  idx === activeGroupIndex
                    ? "1px solid #ffd700"
                    : "1px solid #2d2b3b",
                color: idx === activeGroupIndex ? "#fff" : "#9ca3af",
                borderRadius: "9px",
                fontWeight: "bold",
                cursor: "pointer",
                fontSize: "0.78rem",
                whiteSpace: "nowrap",
                boxShadow:
                  idx === activeGroupIndex
                    ? "0 4px 14px rgba(27,95,168,0.25)"
                    : "none",
              }}
            >
              {group.name}
            </button>
          ))}
        </div>
      </div>

      {/* TABLA DE POSICIONES */}
      <div
        style={{
          marginBottom: "1.5rem",
          padding: "0.9rem",
          background: "rgba(8,10,18,0.55)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: "12px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "0.75rem",
          }}
        >
          <h3
            style={{
              fontSize: "0.85rem",
              fontWeight: "bold",
              textTransform: "uppercase",
              color: "#d1d5db",
              margin: 0,
            }}
          >
            Tabla de posiciones
          </h3>

          <span
            style={{
              fontSize: "0.7rem",
              color: "#ffd700",
              fontWeight: "bold",
            }}
          >
            {currentGroup.name}
          </span>
        </div>

        <div
          style={{
            overflowX: "auto",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <table
            style={{
              width: "100%",
              minWidth: "430px",
              borderCollapse: "collapse",
              fontSize: "0.75rem",
              textAlign: "center",
            }}
          >
            <thead>
              <tr
                style={{
                  backgroundColor: "#121019",
                  color: "#ffd700",
                  borderBottom: "2px solid #2d2b3b",
                }}
              >
                <th
                  style={{
                    padding: "8px",
                    textAlign: "left",
                  }}
                >
                  Pos / Equipo
                </th>
                <th style={{ padding: "8px" }}>Pts</th>
                <th style={{ padding: "8px" }}>PJ</th>
                <th style={{ padding: "8px" }}>G</th>
                <th style={{ padding: "8px" }}>E</th>
                <th style={{ padding: "8px" }}>P</th>
                <th style={{ padding: "8px" }}>DG</th>
              </tr>
            </thead>

            <tbody>
              {standings.map((team, idx) => {
                const isQualified = idx < tournament.qualifiersPerGroup;

                return (
                  <tr
                    key={team.name}
                    style={{
                      borderBottom: "1px solid rgba(255,255,255,0.06)",
                      backgroundColor: isQualified
                        ? "rgba(34,197,94,0.05)"
                        : "transparent",
                    }}
                  >
                    <td
                      style={{
                        padding: "9px 8px",
                        textAlign: "left",
                        fontWeight: "bold",
                        color: isQualified ? "#4ade80" : "#fff",
                      }}
                    >
                      {idx + 1}. {team.name} {isQualified && "⭐"}
                    </td>

                    <td
                      style={{
                        padding: "9px 8px",
                        fontWeight: "900",
                        color: "#ffd700",
                        fontSize: "0.85rem",
                      }}
                    >
                      {team.points}
                    </td>

                    <td>{team.played}</td>
                    <td>{team.won}</td>
                    <td>{team.drawn}</td>
                    <td>{team.lost}</td>

                    <td>
                      {team.goalDifference > 0
                        ? `+${team.goalDifference}`
                        : team.goalDifference}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* PARTIDOS */}
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "1rem",
            marginBottom: "0.65rem",
          }}
        >
          <h3
            style={{
              fontSize: "0.85rem",
              fontWeight: "bold",
              textTransform: "uppercase",
              color: "#d1d5db",
              margin: 0,
            }}
          >
            Partidos
          </h3>

          <span
            style={{
              fontSize: "0.68rem",
              color: "#6b7280",
            }}
          >
            {currentGroup.matches.length} encuentros
          </span>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.65rem",
            maxHeight: "300px",
            overflowY: "auto",
            paddingRight: "2px",
          }}
        >
          {currentGroup.matches.map((match) => (
            <div
              key={match.id}
              style={{
                padding: "0.75rem",
                background: "linear-gradient(135deg, #121019, #0d0c13)",
                border: "1px solid #2d2b3b",
                borderRadius: "10px",
                display: "grid",
                gridTemplateColumns: "1fr auto 1fr",
                alignItems: "center",
                gap: "0.6rem",
              }}
            >
              {/* EQUIPO 1 */}
              <span
                style={{
                  fontSize: "0.76rem",
                  fontWeight: "bold",
                  textAlign: "right",
                  overflowWrap: "anywhere",
                }}
              >
                {match.team1}
              </span>

              {/* RESULTADO */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                  padding: "3px 6px",
                  background: "rgba(0,0,0,0.25)",
                  borderRadius: "8px",
                }}
              >
                <input
                  type="number"
                  min="0"
                  value={match.score1 !== null ? match.score1 : ""}
                  disabled={!isCreator}
                  onChange={(e) =>
                    handleScoreChange(match.id, "score1", e.target.value)
                  }
                  style={{
                    width: "34px",
                    height: "30px",
                    textAlign: "center",
                    backgroundColor: isCreator ? "#1e1b2e" : "#15141c",
                    border: isCreator
                      ? "1px solid #1b5fa8"
                      : "1px solid #272532",
                    color: "#fff",
                    borderRadius: "5px",
                    padding: "2px",
                    fontWeight: "bold",
                    boxSizing: "border-box",
                    cursor: isCreator ? "text" : "not-allowed",
                    opacity: isCreator ? 1 : 0.8,
                  }}
                />

                <span
                  style={{
                    color: "#6b7280",
                    fontWeight: "bold",
                  }}
                >
                  -
                </span>

                <input
                  type="number"
                  min="0"
                  value={match.score2 !== null ? match.score2 : ""}
                  disabled={!isCreator}
                  onChange={(e) =>
                    handleScoreChange(match.id, "score2", e.target.value)
                  }
                  style={{
                    width: "34px",
                    height: "30px",
                    textAlign: "center",
                    backgroundColor: isCreator ? "#1e1b2e" : "#15141c",
                    border: isCreator
                      ? "1px solid #1b5fa8"
                      : "1px solid #272532",
                    color: "#fff",
                    borderRadius: "5px",
                    padding: "2px",
                    fontWeight: "bold",
                    boxSizing: "border-box",
                    cursor: isCreator ? "text" : "not-allowed",
                    opacity: isCreator ? 1 : 0.8,
                  }}
                />
              </div>

              {/* EQUIPO 2 */}
              <span
                style={{
                  fontSize: "0.76rem",
                  fontWeight: "bold",
                  textAlign: "left",
                  overflowWrap: "anywhere",
                }}
              >
                {match.team2}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* AVANZAR */}
      {allGroupsFinished && isCreator && (
        <button
          onClick={onProceedToPlayoffs}
          className="cr-btn-gold"
          style={{
            marginTop: "1.5rem",
            width: "100%",
          }}
        >
          <TCIcon name="trophy" size={16} /> Avanzar a Playoff · Eliminación Directa
        </button>
      )}
    </div>
  );
}
