import { useState } from "react";
import { TCIcon } from "./TCIcon";

export function useTournamentNotice() {
  const [notice, setNotice] = useState(null);
  const [confirmation, setConfirmation] = useState(null);

  const showNotice = (message) => {
    setNotice(String(message ?? ""));
  };

  const clearNotice = () => setNotice(null);

  const confirmTournament = (message) =>
    new Promise((resolve) => setConfirmation({ message: String(message ?? ""), resolve }));

  const resolveConfirmation = (accepted) => {
    setConfirmation((current) => {
      current?.resolve(accepted);
      return null;
    });
  };

  return {
    notice,
    showNotice,
    clearNotice,
    confirmation,
    confirmTournament,
    resolveConfirmation,
  };
}

export function TournamentNotice({ notice, onClose, confirmation, onResolveConfirmation }) {
  if (confirmation) {
    return (
      <div
        role="presentation"
        onClick={() => onResolveConfirmation(false)}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 2100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1rem",
          background: "rgba(3,3,10,0.72)",
          backdropFilter: "blur(5px)",
        }}
      >
        <section
          role="alertdialog"
          aria-modal="true"
          aria-label="Confirmar acción de TournamentClash"
          onClick={(event) => event.stopPropagation()}
          style={{
            width: "100%",
            maxWidth: "430px",
            boxSizing: "border-box",
            padding: "1.25rem",
            borderRadius: "16px",
            border: "1px solid #fbbf24",
            background: "radial-gradient(circle at 50% 0%, rgba(250,204,21,0.14), transparent 55%), linear-gradient(145deg, #171426, #080711 85%)",
            boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
            color: "#f9fafb",
            textAlign: "center",
          }}
        >
          <div style={{ color: "#facc15", fontSize: "0.62rem", fontWeight: 900, letterSpacing: "0.16em" }}>
            TOURNAMENTCLASH
          </div>
          <div aria-hidden="true" style={{ width: "48px", height: "48px", margin: "0.7rem auto", display: "grid", placeItems: "center", borderRadius: "50%", border: "1px solid #fbbf24", background: "rgba(251,191,36,0.09)", fontSize: "1.55rem" }}>
            <TCIcon name="shield" size={25} />
          </div>
          <p style={{ margin: "0 0 1.2rem", color: "#e5e7eb", fontSize: "0.9rem", lineHeight: 1.55, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
            {confirmation.message.replace(/^⚠️\s*/, "")}
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: "0.65rem", flexWrap: "wrap" }}>
            <button type="button" onClick={() => onResolveConfirmation(false)} style={{ padding: "0.65rem 1rem", borderRadius: "8px", border: "1px solid #6b7280", background: "#252333", color: "#e5e7eb", fontWeight: 800, cursor: "pointer" }}>
              Cancelar
            </button>
            <button type="button" className="cr-btn-gold" onClick={() => onResolveConfirmation(true)} autoFocus style={{ maxWidth: "180px", padding: "0.65rem 1rem", fontSize: "0.78rem" }}>
              Confirmar
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (!notice) return null;

  const message = String(notice);
  const isSuccess = /✅|🏆|correctamente|se agregaron|te inscribiste|torneo en marcha/i.test(message);
  const isWarning = /⚠️|🔒|🚫|solo el creador|seleccioná|necesitás|necesitas/i.test(message);
  const accent = isSuccess ? "#86efac" : isWarning ? "#fbbf24" : "#a5b4fc";
  const symbol = isSuccess ? "sword" : isWarning ? "shield" : "chat";

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        background: "rgba(3,3,10,0.62)",
        backdropFilter: "blur(4px)",
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-label="Aviso de TournamentClash"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "420px",
          boxSizing: "border-box",
          padding: "1.2rem",
          position: "relative",
          borderRadius: "16px",
          border: `1px solid ${accent}`,
          background: "radial-gradient(circle at 50% 0%, rgba(250,204,21,0.12), transparent 55%), linear-gradient(145deg, #171426, #080711 85%)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.48), inset 0 1px 0 rgba(255,255,255,0.07)",
          color: "#f9fafb",
          textAlign: "center",
        }}
      >
        <div style={{ color: "#facc15", fontSize: "0.62rem", fontWeight: 900, letterSpacing: "0.16em" }}>
          TOURNAMENTCLASH
        </div>
        <div
          aria-hidden="true"
          style={{
            width: "48px",
            height: "48px",
            margin: "0.7rem auto",
            display: "grid",
            placeItems: "center",
            borderRadius: "50%",
            border: `1px solid ${accent}`,
            background: "rgba(255,255,255,0.055)",
            fontSize: "1.55rem",
          }}
        >
          <TCIcon name={symbol} size={25} />
        </div>
        <p style={{ margin: "0 0 1rem", color: "#e5e7eb", fontSize: "0.9rem", lineHeight: 1.55, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
          {message.replace(/^[❌✅⚠️🔒🚫🏆]\s*/, "")}
        </p>
        <button
          type="button"
          className="cr-btn-gold"
          onClick={onClose}
          autoFocus
          style={{ maxWidth: "180px", padding: "0.6rem 1rem", fontSize: "0.78rem" }}
        >
          Entendido
        </button>
      </section>
    </div>
  );
}
