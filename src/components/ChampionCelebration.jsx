import { getPlayerTournamentStats, getTournamentPodium } from "../utils/tournamentAwards";
import { TCIcon } from "./TCIcon";

export function ChampionCelebration({ tournament, onClose }) {
  const podium = getTournamentPodium(tournament);
  if (!podium?.champion) return null;

  const stats = getPlayerTournamentStats(tournament, podium.champion);

  return (
    <div
      className="tc-champion-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Campeón del torneo"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        background: "rgba(3, 3, 10, 0.82)",
        backdropFilter: "blur(6px)",
        overflowY: "auto",
      }}
    >
    <section
      className="tc-champion-card"
      aria-label="Campeón del torneo"
      style={{
        width: "100%",
        maxWidth: "650px",
        maxHeight: "calc(100vh - 2rem)",
        overflowY: "auto",
        margin: "auto",
        padding: "1.25rem",
        position: "relative",
        borderRadius: "18px",
        border: "2px solid #facc15",
        background: "radial-gradient(circle at 50% 0%, rgba(250,204,21,0.22), transparent 52%), linear-gradient(145deg, #171426, #080711 80%)",
        boxShadow: "0 0 28px rgba(250,204,21,0.16), inset 0 1px 0 rgba(255,255,255,0.08)",
        textAlign: "center",
      }}
    >
      <button
        className="tc-champion-close"
        type="button"
        onClick={onClose}
        aria-label="Cerrar tarjeta del campeón"
        title="Cerrar y ver el torneo"
        style={{
          position: "absolute",
          top: "0.6rem",
          right: "0.6rem",
          width: "34px",
          height: "34px",
          borderRadius: "50%",
          border: "1px solid rgba(255,255,255,0.25)",
          background: "rgba(0,0,0,0.45)",
          color: "#fff",
          fontSize: "1.1rem",
          fontWeight: 900,
          cursor: "pointer",
          zIndex: 2,
        }}
      >
        ×
      </button>
      <div style={{ fontSize: "0.7rem", fontWeight: 900, letterSpacing: "0.22em", color: "#facc15" }}>
        TOURNAMENTCLASH • CAMPEÓN
      </div>
      <div
        className="tc-champion-trophy"
        aria-hidden="true"
        style={{
          width: "104px",
          height: "104px",
          margin: "0.8rem auto",
          display: "grid",
          placeItems: "center",
          borderRadius: "50%",
          border: "3px solid #fde68a",
          background: "radial-gradient(circle, #fef3c7 0%, #f59e0b 42%, #713f12 100%)",
          boxShadow: "0 0 0 7px rgba(250,204,21,0.09), 0 0 32px rgba(250,204,21,0.35)",
          fontSize: "3.5rem",
        }}
      >
        <TCIcon name="trophy" size={46} />
      </div>
      <div style={{ color: "#fef3c7", fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase" }}>
        ¡Tenemos campeón!
      </div>
      <h2 className="tc-champion-name" style={{ margin: "0.35rem 0", color: "#fff", fontSize: "clamp(1.4rem, 6vw, 2rem)", fontWeight: 900, overflowWrap: "anywhere" }}>
        {podium.champion}
      </h2>
      <p style={{ margin: "0 auto 1rem", color: "#c4b5fd", fontSize: "0.85rem", overflowWrap: "anywhere" }}>
        {tournament.title || "Torneo TournamentClash"}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(115px, 1fr))", gap: "0.45rem" }}>
        {[
          ["sword", "Jugados", stats.played],
          ["trophy", "Victorias", stats.wins],
          ["shield", "Derrotas", stats.losses],
          ["target", "Efectividad", stats.winRate + "%"],
        ].map(([icon, label, value]) => (
          <div key={label} className="tc-champion-stat" style={{ padding: "0.7rem 0.25rem", borderRadius: "10px", background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.09)" }}>
            <div className="tc-stat-icon"><TCIcon name={icon} size={21} /></div>
            <div style={{ color: "#fff", fontSize: "1.15rem", fontWeight: 900 }}>{value}</div>
            <div style={{ color: "#a1a1aa", fontSize: "0.62rem", fontWeight: 800, textTransform: "uppercase" }}>{label}</div>
          </div>
        ))}
      </div>
      <p style={{ color: "#facc15", fontSize: "0.7rem", fontWeight: 800, margin: "1rem 0 0.8rem" }}>
        <TCIcon name="medalGold" size={16} /> TÍTULO REGISTRADO EN EL MEDALLERO
      </p>
      <button type="button" onClick={onClose} className="cr-btn-gold" style={{ maxWidth: "260px", padding: "0.65rem 1rem", fontSize: "0.8rem" }}>
        Ver torneo
      </button>
    </section>
    </div>
  );
}
