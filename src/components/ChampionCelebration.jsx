import {
  getPlayerTournamentStats,
  getTournamentGeneralStats,
  getTournamentPodium,
} from "../utils/tournamentAwards";
import { TCIcon } from "./TCIcon";

const positionColors = ["#f4c95d", "#d1d5db", "#d98b50", "#c4b5fd"];
const positionIcons = ["medalGold", "medalSilver", "medalBronze", "medal"];

export function ChampionCelebration({ tournament, onClose }) {
  const podium = getTournamentPodium(tournament);
  if (!podium?.champion) return null;

  const isLeague = String(tournament?.format || "").trim().toLocaleLowerCase("es") === "league";
  const championStats = getPlayerTournamentStats(tournament, podium.champion);
  const generalStats = getTournamentGeneralStats(tournament);
  const positions = [
    { label: "1.er puesto · Oro", name: podium.champion },
    { label: "2.º puesto · Plata", name: podium.runnerUp },
    { label: "3.er puesto · Bronce", name: podium.bronze?.[0] },
    ...(!isLeague ? [{ label: "4.º puesto · Diploma", name: podium.fourth }] : []),
  ];

  const statCard = (icon, label, value) => (
    <div key={label} style={{ minWidth: 0, padding: "0.7rem 0.3rem", borderRadius: "10px", background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.1)" }}>
      <div style={{ color: "#f0a2ad" }}><TCIcon name={icon} size={20} /></div>
      <div style={{ color: "#fff", fontSize: "1.2rem", fontWeight: 900, marginTop: "0.2rem" }}>{value}</div>
      <div style={{ color: "#c7cbd1", fontSize: "0.62rem", fontWeight: 800, textTransform: "uppercase" }}>{label}</div>
    </div>
  );

  return (
    <div role="dialog" aria-modal="true" aria-label="Resultados finales del torneo" style={{ position: "fixed", inset: 0, zIndex: 2200, display: "flex", alignItems: "center", justifyContent: "center", padding: "0.75rem", background: "rgba(0,0,0,0.84)", backdropFilter: "blur(6px)", overflowY: "auto" }}>
      <section style={{ width: "100%", maxWidth: "680px", maxHeight: "calc(100vh - 1.5rem)", overflowY: "auto", margin: "auto", padding: "1.2rem", position: "relative", borderRadius: "18px", border: "2px solid #b5122a", background: "radial-gradient(circle at 50% 0%, rgba(181,18,42,0.28), transparent 48%), linear-gradient(145deg, #202633, #10141d 82%)", boxShadow: "0 0 30px rgba(181,18,42,0.2), inset 0 1px 0 rgba(255,255,255,0.08)", color: "#fff", textAlign: "center" }}>
        <button type="button" onClick={onClose} aria-label="Cerrar resultados finales" style={{ position: "absolute", top: "0.55rem", right: "0.55rem", width: "34px", height: "34px", borderRadius: "50%", border: "1px solid rgba(255,255,255,0.25)", background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: "1.2rem", cursor: "pointer" }}>×</button>
        <div style={{ color: "#f0a2ad", fontSize: "0.68rem", fontWeight: 900, letterSpacing: "0.2em" }}>FEFUTIN · TORNEO FINALIZADO</div>
        <div aria-hidden="true" style={{ width: "92px", height: "92px", margin: "0.75rem auto", display: "grid", placeItems: "center", borderRadius: "50%", border: "3px solid #f4c95d", background: "radial-gradient(circle, #fff1bd 0%, #d99a20 48%, #71420d 100%)", boxShadow: "0 0 0 7px rgba(244,201,93,0.1), 0 0 28px rgba(244,201,93,0.28)" }}>
          <TCIcon name="trophy" size={42} />
        </div>
        <div style={{ color: "#f8d9a0", fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase" }}>¡Tenemos campeón!</div>
        <h2 style={{ margin: "0.35rem 0", color: "#fff", fontSize: "clamp(1.35rem, 6vw, 2rem)", fontWeight: 900, overflowWrap: "anywhere" }}>{podium.champion}</h2>
        <p style={{ margin: "0 auto 1rem", color: "#f0a2ad", fontSize: "0.85rem", overflowWrap: "anywhere" }}>{tournament.title || "Torneo FEFUTIN"}</p>

        <div style={{ marginTop: "0.5rem", textAlign: "left" }}>
          <div style={{ color: "#fff", fontSize: "0.72rem", fontWeight: 900, letterSpacing: "0.1em", marginBottom: "0.5rem", textAlign: "center" }}>PODIO Y POSICIONES FINALES</div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${isLeague ? 3 : 2}, minmax(0, 1fr))`, gap: "0.5rem" }}>
            {positions.map((item, index) => (
              <div key={item.label} style={{ minWidth: 0, padding: "0.7rem 0.45rem", borderRadius: "10px", background: "rgba(255,255,255,0.055)", border: `1px solid ${positionColors[index]}66`, textAlign: "center" }}>
                <TCIcon name={positionIcons[index]} size={25} />
                <div style={{ color: positionColors[index], fontSize: "0.64rem", fontWeight: 900, marginTop: "0.25rem" }}>{item.label}</div>
                <div style={{ color: "#fff", fontSize: "0.82rem", fontWeight: 900, overflowWrap: "anywhere", marginTop: "0.2rem" }}>{item.name || "Por definir"}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: "1rem", textAlign: "left" }}>
          <div style={{ color: "#f0a2ad", fontSize: "0.72rem", fontWeight: 900, letterSpacing: "0.1em", marginBottom: "0.5rem", textAlign: "center" }}>ESTADÍSTICAS GENERALES DEL TORNEO</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "0.45rem" }}>
            {statCard("clipboard", "Partidos", generalStats.played)}
            {statCard("target", "Goles", generalStats.goals)}
            {statCard("home", "Victorias local", generalStats.homeWins)}
            {statCard("users", "Empates", generalStats.draws)}
            {statCard("arrow", "Victorias visitante", generalStats.awayWins)}
          </div>
        </div>

        <div style={{ marginTop: "1rem", textAlign: "left" }}>
          <div style={{ color: "#f0a2ad", fontSize: "0.72rem", fontWeight: 900, letterSpacing: "0.1em", marginBottom: "0.5rem", textAlign: "center" }}>ESTADÍSTICAS DEL CAMPEÓN</div>
          <div style={{ color: "#fff", fontSize: "0.8rem", fontWeight: 900, textAlign: "center", marginBottom: "0.5rem", overflowWrap: "anywhere" }}>{podium.champion}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "0.45rem" }}>
            {statCard("clipboard", "Jugados", championStats.played)}
            {isLeague && statCard("trophy", "Puntos", championStats.points)}
            {statCard("trophy", "Ganados", championStats.wins)}
            {statCard("users", "Empatados", championStats.draws)}
            {statCard("shield", "Perdidos", championStats.losses)}
            {statCard("target", "Goles a favor", championStats.goalsFor)}
            {isLeague && statCard("shield", "Goles en contra", championStats.goalsAgainst)}
            {isLeague && statCard("chart", "Diferencia de gol", championStats.goalDifference > 0 ? "+" + championStats.goalDifference : championStats.goalDifference)}
            {statCard("chart", "Efectividad", championStats.winRate + "%")}
          </div>
        </div>
        <button type="button" onClick={onClose} style={{ width: "100%", maxWidth: "260px", marginTop: "1.1rem", padding: "0.7rem 1rem", borderRadius: "9px", border: "1px solid #e25b6b", background: "#b5122a", color: "#fff", fontWeight: 900, cursor: "pointer" }}>Ver torneo</button>
      </section>
    </div>
  );
}
