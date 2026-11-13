import {
  getPlayerTournamentStats,
  getTournamentGeneralStats,
  getTournamentPodium,
} from "../utils/tournamentAwards";
import { TCIcon } from "./TCIcon";

const medals = [
  { key: "gold", label: "1.er puesto", color: "#f5c542", dark: "#8a5b08", icon: "medalGold" },
  { key: "silver", label: "2.º puesto", color: "#d9e0e8", dark: "#65717e", icon: "medalSilver" },
  { key: "bronze", label: "3.er puesto", color: "#df9865", dark: "#87451f", icon: "medalBronze" },
];

export function ChampionCelebration({ tournament, onClose }) {
  const podium = getTournamentPodium(tournament);
  if (!podium?.champion) return null;

  const isLeague = String(tournament?.format || "").trim().toLocaleLowerCase("es") === "league";
  const championStats = getPlayerTournamentStats(tournament, podium.champion);
  const generalStats = getTournamentGeneralStats(tournament);
  const podiumPlaces = [
    { ...medals[1], name: podium.runnerUp, order: 1, height: "76px" },
    { ...medals[0], name: podium.champion, order: 2, height: "108px" },
    { ...medals[2], name: podium.bronze?.[0], order: 3, height: "58px" },
  ];
  const statCard = (icon, label, value) => (
    <div key={label} style={{ minWidth: 0, padding: "0.65rem 0.25rem", borderRadius: "11px", background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.1)" }}>
      <div style={{ color: "#f5c542" }}><TCIcon name={icon} size={19} /></div>
      <div style={{ color: "#fff", fontSize: "1.12rem", fontWeight: 900, marginTop: "0.15rem" }}>{value}</div>
      <div style={{ color: "#c7cbd1", fontSize: "0.6rem", fontWeight: 800, textTransform: "uppercase", lineHeight: 1.25 }}>{label}</div>
    </div>
  );

  return (
    <div role="dialog" aria-modal="true" aria-label="Resultados finales del torneo" style={{ position: "fixed", inset: 0, zIndex: 2200, display: "flex", alignItems: "center", justifyContent: "center", padding: "0.75rem", background: "rgba(0,0,0,0.88)", backdropFilter: "blur(7px)", overflowY: "auto" }}>
      <section style={{ width: "100%", maxWidth: "680px", maxHeight: "calc(100vh - 1.5rem)", overflowY: "auto", margin: "auto", padding: "1.15rem", position: "relative", borderRadius: "20px", border: "1px solid rgba(245,197,66,0.65)", background: "radial-gradient(ellipse at 50% 0%, rgba(245,197,66,0.19), transparent 38%), radial-gradient(circle at 0% 65%, rgba(181,18,42,0.13), transparent 35%), linear-gradient(150deg, #252b35, #10141d 78%)", boxShadow: "0 0 42px rgba(245,197,66,0.13), inset 0 1px 0 rgba(255,255,255,0.1)", color: "#fff", textAlign: "center" }}>
        <button type="button" onClick={onClose} aria-label="Cerrar resultados finales" style={{ position: "absolute", top: "0.55rem", right: "0.55rem", zIndex: 2, width: "34px", height: "34px", borderRadius: "50%", border: "1px solid rgba(255,255,255,0.25)", background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: "1.2rem", cursor: "pointer" }}>×</button>

        <div style={{ color: "#f5d77e", fontSize: "0.68rem", fontWeight: 900, letterSpacing: "0.2em" }}>FEFUTIN · TORNEO FINALIZADO</div>

        <div aria-hidden="true" style={{ width: "132px", height: "150px", margin: "0.8rem auto 0.55rem", display: "grid", placeItems: "center", position: "relative", filter: "drop-shadow(0 9px 15px rgba(0,0,0,0.4))" }}>
          <div style={{ position: "absolute", inset: 0, clipPath: "polygon(50% 0%, 94% 13%, 89% 66%, 50% 100%, 11% 66%, 6% 13%)", background: "linear-gradient(135deg, #fff2b0 0%, #f5c542 27%, #a96c13 55%, #ffe69a 78%, #9a6415 100%)", border: "1px solid #ffe9a3" }} />
          <div style={{ position: "absolute", inset: "7px", clipPath: "polygon(50% 0%, 94% 13%, 89% 66%, 50% 100%, 11% 66%, 6% 13%)", background: "linear-gradient(155deg, #4a3a1b, #171c27 68%)", display: "grid", placeItems: "center", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.22)" }}>
            <div style={{ color: "#f8d66f", display: "grid", placeItems: "center", gap: "0.15rem" }}>
              <TCIcon name="trophy" size={54} />
              <span style={{ fontSize: "0.58rem", fontWeight: 900, letterSpacing: "0.18em" }}>CAMPEÓN</span>
            </div>
          </div>
        </div>

        <div style={{ color: "#f8d989", fontSize: "0.76rem", fontWeight: 900, letterSpacing: "0.13em", textTransform: "uppercase" }}>¡Felicitaciones al campeón!</div>
        <h2 style={{ margin: "0.3rem 0 0.2rem", color: "#fff", fontSize: "clamp(1.55rem, 6vw, 2.25rem)", fontWeight: 950, lineHeight: 1.12, overflowWrap: "anywhere", textShadow: "0 2px 14px rgba(245,197,66,0.18)" }}>{podium.champion}</h2>
        <p style={{ margin: "0 auto 1rem", color: "#d9c18b", fontSize: "0.85rem", overflowWrap: "anywhere" }}>{tournament.title || "Torneo FEFUTIN"}</p>

        <div style={{ marginTop: "0.6rem" }}>
          <div style={{ color: "#f5d77e", fontSize: "0.72rem", fontWeight: 900, letterSpacing: "0.12em", marginBottom: "0.55rem" }}>ESTADÍSTICAS DEL CAMPEÓN</div>
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

        <div style={{ marginTop: "1rem", padding: "0.8rem 0.65rem 0.6rem", borderRadius: "15px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.2)" }}>
          <div style={{ color: "#f5d77e", fontSize: "0.72rem", fontWeight: 900, letterSpacing: "0.12em", marginBottom: "0.6rem" }}>PODIO · POSICIONES FINALES</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "0.35rem", alignItems: "end" }}>
            {podiumPlaces.map((place) => (
              <div key={place.key} style={{ minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "end", order: place.order }}>
                <div style={{ minHeight: "66px", display: "flex", flexDirection: "column", justifyContent: "end", alignItems: "center", gap: "0.2rem", width: "100%" }}>
                  <TCIcon name={place.icon} size={place.key === "gold" ? 34 : 28} />
                  <div style={{ color: place.color, fontSize: "0.63rem", fontWeight: 900 }}>{place.label}</div>
                  <div style={{ color: "#fff", fontSize: "0.78rem", fontWeight: 900, lineHeight: 1.15, overflowWrap: "anywhere", minHeight: "2.1em", display: "grid", placeItems: "center" }}>{place.name || "Por definir"}</div>
                </div>
                <div style={{ width: "100%", height: place.height, marginTop: "0.35rem", display: "grid", placeItems: "center", borderRadius: "8px 8px 2px 2px", border: "1px solid " + place.color, borderBottom: "4px solid " + place.dark, background: "linear-gradient(145deg, " + place.color + "55, " + place.dark + "88)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.28)" }}>
                  <span style={{ color: "#fff", fontSize: "1.7rem", fontWeight: 950, textShadow: "0 2px 5px rgba(0,0,0,0.55)" }}>{place.order}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: "0.85rem", padding: "0.65rem", borderRadius: "12px", background: "rgba(255,255,255,0.045)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ color: "#cbd1d8", fontSize: "0.65rem", fontWeight: 900, letterSpacing: "0.1em", marginBottom: "0.45rem" }}>RESUMEN DEL TORNEO</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: "0.25rem" }}>
            {[
              ["PARTIDOS", generalStats.played],
              ["GOLES", generalStats.goals],
              ["LOCAL", generalStats.homeWins],
              ["EMPATES", generalStats.draws],
              ["VISITA", generalStats.awayWins],
            ].map(([label, value]) => (
              <div key={label} style={{ minWidth: 0 }}>
                <div style={{ color: "#fff", fontSize: "1rem", fontWeight: 900 }}>{value}</div>
                <div style={{ color: "#aeb6c1", fontSize: "0.52rem", fontWeight: 800 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        {!isLeague && podium.fourth && (
          <div style={{ marginTop: "0.65rem", color: "#c4b5fd", fontSize: "0.72rem", fontWeight: 800 }}>4.º puesto · Diploma: {podium.fourth}</div>
        )}
        <button type="button" onClick={onClose} style={{ width: "100%", maxWidth: "260px", marginTop: "1rem", padding: "0.75rem 1rem", borderRadius: "10px", border: "1px solid #e4bd52", background: "linear-gradient(135deg, #f2c34e, #a96c13)", color: "#241a08", fontWeight: 950, cursor: "pointer" }}>Ver torneo</button>
      </section>
    </div>
  );
}
