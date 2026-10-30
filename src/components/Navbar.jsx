import React, { useState } from "react";
import { getPlayerMedals } from "../utils/tournamentAwards";
import { TCIcon } from "./TCIcon";

export function Navbar({
  onGoHome,
  currentTitle,
  tournamentCode,
  currentUser,
  tournaments = [],
  isAdmin = false,
  onGoStats,
  onAdminClick,
  onLogout,
}) {
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [medalOpen, setMedalOpen] = useState(false);

  const handleCopyCode = () => {
    if (!tournamentCode) return;

    navigator.clipboard.writeText(tournamentCode);
    setCopied(true);

    setTimeout(() => setCopied(false), 2000);
  };

  const username = currentUser?.username || "Visitante";
  const medals = getPlayerMedals(tournaments, username);
  const medalButtonStyle = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.45rem", padding: "0.45rem 0.7rem", background: "linear-gradient(145deg, #242427, #111113)", border: "1px solid #ff9140", borderRadius: "9px", color: "#fff", fontSize: "0.72rem", fontWeight: 900, cursor: "pointer", whiteSpace: "nowrap", boxShadow: "inset 0 1px rgba(255,255,255,.08), 0 3px 10px rgba(0,0,0,.22)" };

  return (
    <div
      className="tc-navbar"
      style={{
        width: "100%",
        maxWidth: "100%",
        margin: "0 auto",
        background: "linear-gradient(135deg, #1b1b1e 0%, #111113 100%)",
        border: "1px solid #414146",
        borderRadius: "14px",
        padding: "0.6rem 1rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        boxShadow:
          "0 8px 25px rgba(0, 0, 0, 0.6), inset 0 2px 0 rgba(255, 255, 255, 0.1)",
        position: "relative",
        overflow: "visible",
      }}
    >
      {/* Brillo superior */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "4px",
          background: "linear-gradient(90deg, #ff7a1a, #ffb36b, #ff7a1a)",
          borderTopLeftRadius: "11px",
          borderTopRightRadius: "11px",
        }}
      ></div>

      {/* IZQUIERDA */}
      <div
        onClick={onGoHome}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          cursor: "pointer",
        }}
      >
        <button
          type="button"
          className="tc-navbar-admin-logo"
          onClick={(event) => {
            event.stopPropagation();
            isAdmin ? onLogout?.() : onAdminClick?.();
          }}
          title={isAdmin ? "Cerrar sesión de administrador" : "Ingresar como administrador"}
          aria-label={isAdmin ? "Cerrar sesión de administrador" : "Ingresar como administrador"}
        >
          <img src="https://fefutin.wordpress.com/wp-content/uploads/2017/03/fefutin-logo-grande1.png?h=184&w=166" alt="Acceso de administrador FEFUTIN" />
        </button>

        <div>
          <span
            style={{
              fontFamily: "'Montserrat', sans-serif",
              fontWeight: 900,
              fontSize: "1.15rem",
              color: "#ffffff",
              textShadow: "0 2px 8px rgba(0,0,0,.85)",
              display: "block",
              lineHeight: "1.1",
            }}
          >
            {currentTitle || "FEFUTIN"}
          </span>

          <span
            style={{
              fontSize: "9px",
              color: "#9ca3af",
              fontWeight: 700,
              textTransform: "uppercase",
            }}
          >
            <TCIcon name="user" size={13} /> {username}
          </span>
        </div>
      </div>

      {/* DESKTOP */}
      <div
        className="desktop-nav-actions"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        {tournamentCode && (
          <button
            onClick={handleCopyCode}
            title="Copiar código para compartir"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              background: "#0d0d0f",
              border: "1px solid #55555b",
              borderRadius: "8px",
              padding: "0.3rem 0.6rem",
              color: "#ffad70",
              fontSize: "10px",
              fontWeight: "bold",
              cursor: "pointer",
              boxShadow: "inset 0 2px 4px rgba(0,0,0,0.8)",
            }}
          >
            <TCIcon name="key" size={14} />

            <span
              style={{
                fontFamily: "monospace",
                color: "#fff",
                letterSpacing: "1px",
              }}
            >
              {tournamentCode}
            </span>

            <span
              style={{
                color: "#9ca3af",
                marginLeft: "2px",
              }}
            >
              {copied ? <TCIcon name="check" size={13} /> : <TCIcon name="clipboard" size={13} />}
            </span>
          </button>
        )}

        {/* USUARIO */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            padding: "0.35rem 0.6rem",
            background: "#0d0d0f",
            border: "1px solid #55555b",
            borderRadius: "8px",
            color: "#ffad70",
            fontSize: "10px",
            fontWeight: "bold",
          }}
          title="Usuario actual"
        >
          <TCIcon name="user" size={13} /> {username}
        </div>

        {currentUser && (        <button
          type="button"
          onClick={() => setMedalOpen((open) => !open)}
          style={medalButtonStyle}
          title="Ver historial de medallas"
        >
          <TCIcon name="medal" size={19} /> <span>Medallero</span> <span className="tc-medal-total">{medals.gold + medals.silver + medals.bronze + medals.diploma}</span>
        </button>)}

        {isAdmin && (
          <button type="button" onClick={onGoStats} style={medalButtonStyle}>
            <TCIcon name="chart" size={17} /> <span>Estadísticas</span>
          </button>
        )}



        <button
          onClick={onGoHome}
          style={{
            padding: "0.4rem 0.75rem",
            background: "linear-gradient(135deg, #ff9140 0%, #ff7a1a 58%, #e85d04 100%)",
            border: "1px solid #ffb36b",
            borderBottom: "3px solid #a63c00",
            borderRadius: "8px",
            color: "#fff",
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 900,
            fontSize: "0.7rem",
            textTransform: "uppercase",
            cursor: "pointer",
            textShadow: "0 1px 0 rgba(0, 0, 0, 0.6)",
            boxShadow: "0 4px 12px rgba(255,122,26,.18)",
          }}
        >
          <TCIcon name="home" size={15} /> Inicio
        </button>
      </div>



      {/* HAMBURGUESA */}
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="mobile-menu-btn"
        style={{
          display: "none",
          background: "#0d0d0f",
          border: "1px solid #55555b",
          borderRadius: "8px",
          padding: "0.4rem 0.6rem",
          color: "#fff",
          fontSize: "1rem",
          cursor: "pointer",
        }}
      >
        {menuOpen ? <span className="tc-close-symbol" aria-hidden="true">✕</span> : <TCIcon name="menu" size={20} />}
      </button>

      {/* MENU MOVIL */}
      {menuOpen && (
        <div
          style={{
            position: "absolute",
            top: "110%",
            left: 0,
            right: 0,
            background: "#171719",
            border: "1px solid #414146",
            borderRadius: "12px",
            padding: "1rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
            boxShadow: "0 10px 30px rgba(0,0,0,0.8)",
            zIndex: 100,
          }}
        >
          {/* ALIAS */}
          <div
            style={{
              padding: "0.6rem",
              textAlign: "center",
              background: "#0d0d0f",
              border: "1px solid #55555b",
              borderRadius: "8px",
              color: "#ffad70",
              fontSize: "0.8rem",
              fontWeight: "bold",
            }}
          >
            <TCIcon name="user" size={14} /> {username}
          </div>

          {tournamentCode && (
            <button
              onClick={handleCopyCode}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                background: "#0d0d0f",
                border: "1px solid #55555b",
                borderRadius: "8px",
                padding: "0.6rem",
                color: "#ffad70",
                fontSize: "0.8rem",
                fontWeight: "bold",
                cursor: "pointer",
              }}
            >
              <span className="tc-nav-copy-label"><TCIcon name="key" size={14} /> Copiar Código:</span>

              <span
                style={{
                  fontFamily: "monospace",
                  color: "#fff",
                }}
              >
                {tournamentCode}
              </span>

              <span>{copied ? <TCIcon name="check" size={13} /> : <TCIcon name="clipboard" size={13} />}</span>
            </button>
          )}

          {currentUser && (          <button
            type="button"
            onClick={() => setMedalOpen((open) => !open)}
            style={{ ...medalButtonStyle, padding: "0.7rem", fontSize: "0.8rem" }}
          >
            <TCIcon name="medal" size={19} /> <span>Mi medallero</span> <span className="tc-medal-total">{medals.gold + medals.silver + medals.bronze + medals.diploma}</span>
          </button>)}

          {isAdmin && (
            <button type="button" onClick={() => { setMenuOpen(false); onGoStats?.(); }} style={{ ...medalButtonStyle, padding: "0.7rem", fontSize: "0.8rem" }}>
              <TCIcon name="chart" size={17} /> <span>Estadísticas</span>
            </button>
          )}

          <button
            onClick={() => {
              setMenuOpen(false);
              onGoHome();
            }}
            style={{
              padding: "0.7rem",
              background:
                "linear-gradient(to bottom, #1b5fa8 0%, #0f3768 100%)",
              border: "1px solid #ffb36b",
              borderBottom: "3px solid #a63c00",
              borderRadius: "8px",
              color: "#fff",
              fontFamily: "'Montserrat', sans-serif",
              fontWeight: 900,
              fontSize: "0.8rem",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            <TCIcon name="home" size={16} /> Volver al Inicio
          </button>
        </div>
      )}

      {currentUser && medalOpen && (
        <div style={{ position: "absolute", top: "calc(100% + 10px)", right: 0, width: "min(340px, calc(100vw - 32px))", maxHeight: "70vh", overflowY: "auto", padding: "1rem", borderRadius: "14px", border: "1px solid #ff9140", background: "linear-gradient(145deg, #1b1b1e, #111113)", boxShadow: "0 12px 35px rgba(0,0,0,0.8)", zIndex: 200 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", marginBottom: "0.8rem" }}>
            <strong style={{ color: "#ffb36b", fontSize: "0.85rem" }}><TCIcon name="medal" size={16} /> MI MEDALLERO</strong>
            <button type="button" onClick={() => setMedalOpen(false)} aria-label="Cerrar medallero" className="tc-close-button" style={{ background: "transparent", border: 0, color: "#d1d5db", fontSize: "1rem", cursor: "pointer" }}>✕</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "0.4rem", marginBottom: "0.9rem" }}>
            {[
              ["medalGold", "Oro", medals.gold, "#facc15"],
              ["medalSilver", "Plata", medals.silver, "#d1d5db"],
              ["medalBronze", "Bronce", medals.bronze, "#d97706"],
              ["diploma", "Diploma", medals.diploma, "#60a5fa"],
            ].map(([icon, label, count, color]) => (
              <div key={label} style={{ textAlign: "center", padding: "0.55rem 0.1rem", borderRadius: "9px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className={`tc-medal-emblem tc-medal-${label.toLowerCase()}`}>{icon === "diploma" ? <span style={{ fontSize: 23 }} role="img" aria-label="Diploma">📜</span> : <TCIcon name={icon} size={25} />}</div>
                <div style={{ color, fontWeight: 900, fontSize: "1.1rem" }}>{count}</div>
                <div style={{ color: "#a1a1aa", fontSize: "0.65rem", fontWeight: 800, textTransform: "uppercase" }}>{label}</div>
              </div>
            ))}
          </div>
          <div style={{ color: "#9ca3af", fontSize: "0.68rem", fontWeight: 800, marginBottom: "0.4rem" }}>HISTORIAL DE TORNEOS</div>
          {medals.history.length === 0 ? (
            <p style={{ color: "#a1a1aa", fontSize: "0.78rem", lineHeight: 1.5, margin: 0 }}>Todavía no tenés medallas. ¡Jugá torneos y conquistá el podio!</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
              {medals.history.map((item, index) => (
                <div key={String(item.id) + "-" + index} style={{ display: "flex", alignItems: "center", gap: "0.55rem", padding: "0.55rem", borderRadius: "8px", background: "rgba(255,255,255,0.04)" }}>
                  <span className={`tc-medal-emblem tc-medal-${item.medal}`}>{item.medal === "diploma" ? <span role="img" aria-label="Diploma">📜</span> : <TCIcon name={item.medal === "gold" ? "medalGold" : item.medal === "silver" ? "medalSilver" : "medalBronze"} size={23} />}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: "#fff", fontSize: "0.75rem", fontWeight: 800, overflowWrap: "anywhere" }}>{item.title}</div>
                    <div style={{ color: "#9ca3af", fontSize: "0.65rem" }}>{item.medal === "gold" ? "Primer puesto" : item.medal === "silver" ? "Segundo puesto" : item.medal === "bronze" ? "Tercer puesto" : "Cuarto puesto · Diploma"}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CSS RESPONSIVE */}
      <style>{`
        @media (max-width: 640px) {
          .desktop-nav-actions {
            display: none !important;
          }

          .mobile-menu-btn {
            display: flex !important;
          }

          .mobile-admin-btn {
            display: inline-flex !important;
          }
        }
      `}</style>
    </div>
  );
}
