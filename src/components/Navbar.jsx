import React, { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { getPlayerMedals } from "../utils/tournamentAwards";
import { TCIcon } from "./TCIcon";

export function Navbar({
  onGoHome,
  currentTitle,
  tournamentCode,
  currentUser,
  tournaments = [],
  isAdmin = false,
  canManageAccess = false,
  isArbitro = false,
  onGoMyCarnet,
  onGoCarnetDirectory,
  pendingAccessCount = 0,
  onGoAccessRequests,
  onGoStats,
  onAdminClick,
  onLogout,
}) {
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [medalOpen, setMedalOpen] = useState(false);
  const [referenteClub, setReferenteClub] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const loadReferenteClub = async () => {
      if (currentUser?.role !== "referente" || !currentUser?.id) {
        setReferenteClub(null);
        return;
      }
      const { data, error } = await supabase.rpc("get_fefutin_my_teams");
      if (cancelled) return;
      if (error) {
        console.error("No se pudo cargar el club del referente en la navegación:", error);
        setReferenteClub(null);
        return;
      }
      const club = (data || []).find((item) => item?.club_name);
      setReferenteClub(club || null);
    };
    loadReferenteClub();
    return () => { cancelled = true; };
  }, [currentUser?.id, currentUser?.role]);

  const handleCopyCode = () => {
    if (!tournamentCode) return;

    navigator.clipboard.writeText(tournamentCode);
    setCopied(true);

    setTimeout(() => setCopied(false), 2000);
  };

  const username = currentUser?.username || "Visitante";
  const medals = getPlayerMedals(tournaments, username);
  const medalButtonStyle = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.45rem", padding: "0.45rem 0.7rem", background: "#0b0b0f", border: "1px solid #b5122a", borderRadius: "9px", color: "#fff", fontSize: "0.72rem", fontWeight: 900, cursor: "pointer", whiteSpace: "nowrap", boxShadow: "inset 0 1px rgba(255,255,255,.08), 0 3px 10px rgba(0,0,0,.22)" };

  return (
    <div
      className="tc-navbar"
      style={{
        width: "100%",
        maxWidth: "100%",
        margin: "0 auto",
        background: "linear-gradient(135deg, #101010 0%, #050505 100%)",
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
          background: "linear-gradient(90deg, #8f1026, #b5122a, #8f1026)",
          borderTopLeftRadius: "11px",
          borderTopRightRadius: "11px",
        }}
      ></div>

      {/* IZQUIERDA */}
      <div
        onClick={onAdminClick}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          cursor: "pointer",
        }}
      >
        <img
          src="https://fefutin.wordpress.com/wp-content/uploads/2017/03/fefutin-logo-grande1.png?h=184&w=166"
          alt="FEFUTIN - abrir ingreso y registro"
          title="Ir a ingreso y registro"
          role="button"
          tabIndex={0}
          onClick={(event) => {
            event.stopPropagation();
            onAdminClick?.();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              onAdminClick?.();
            }
          }}
          className="tc-navbar-fefutin-logo"
          style={{
            width: "46px",
            height: "42px",
            objectFit: "contain",
            display: "block",
            flex: "0 0 auto",
          }}
        />

        <div>
          <span
            style={{
              fontFamily: "'Montserrat', sans-serif",
              fontWeight: 900,
              fontSize: "1.25rem",
              whiteSpace: "nowrap",
              color: "#ffffff",
              textShadow: "0 2px 8px rgba(0,0,0,.85)",
              display: "block",
              lineHeight: "1.1",
            }}
          >
            {currentTitle || "FEFUTIN"}
          </span>
          <span
            className="tc-navbar-user-role"
            title={currentUser?.role === "referente" ? (referenteClub?.club_name || "Referente") : undefined}
          >
            {currentUser?.role === "admin"
              ? "Administrador"
              : currentUser?.role === "directivo"
                ? "Dirigente"
                : currentUser?.role === "arbitro"
                  ? "Árbitro"
                  : currentUser?.role === "referente"
                    ? (referenteClub?.club_name || "Referente")
                    : "Visitante"}
          </span>
          <span className="mobile-navbar-alias">
            <TCIcon name="user" size={11} /> {username}
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
            className="tc-nav-code"
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
              color: "#ffffff",
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
            color: "#ffffff",
            fontSize: "10px",
            fontWeight: "bold",
          }}
          title="Usuario actual"
        >
          <TCIcon name="user" size={13} /> {username}
        </div>

        {currentUser && (        <button
          className="tc-nav-medals"
          type="button"
          onClick={() => setMedalOpen((open) => !open)}
          style={medalButtonStyle}
          title="Ver historial de medallas"
        >
          <TCIcon name="medal" size={19} /> <span>Medallero</span> <span className="tc-medal-total">{medals.gold + medals.silver + medals.bronze + medals.diploma}</span>
        </button>)}

        {canManageAccess && (
          <button type="button" onClick={onGoAccessRequests} style={{ ...medalButtonStyle, position: "relative" }}>
            <TCIcon name="user" size={16} /> <span>Solicitudes</span>
            {pendingAccessCount > 0 && <span aria-label={`${pendingAccessCount} solicitudes pendientes`} style={{ position: "absolute", top: "-6px", right: "-6px", minWidth: "17px", height: "17px", padding: "0 4px", borderRadius: "20px", background: "#e11d48", color: "#fff", border: "2px solid #080808", fontSize: "10px", fontWeight: 900, display: "grid", placeItems: "center" }}>{pendingAccessCount > 9 ? "9+" : pendingAccessCount}</span>}
          </button>
        )}

        {isArbitro && (
          <button type="button" onClick={onGoMyCarnet} style={medalButtonStyle}>
            <TCIcon name="user" size={16} /> <span>Mi carnet</span>
          </button>
        )}
        {canManageAccess && (
          <button type="button" onClick={onGoCarnetDirectory} style={medalButtonStyle}>
            <TCIcon name="users" size={16} /> <span>Carnets de árbitros</span>
          </button>
        )}

        {isAdmin && (
          <button className="tc-nav-stats" type="button" onClick={onGoStats} style={medalButtonStyle}>
            <TCIcon name="chart" size={17} /> <span>Estadísticas</span>
          </button>
        )}



        <button
          className="tc-nav-home"
          onClick={onGoHome}
          style={{
            padding: "0.4rem 0.75rem",
            background: "linear-gradient(135deg, #b5122a 0%, #8f1026 100%)",
            border: "1px solid #f07889",
            borderBottom: "3px solid #590a18",
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



      {/* ACCESOS RÁPIDOS MÓVILES: mismo tamaño y alineados antes del menú. */}
      <div className="mobile-nav-quick-actions">
        <button type="button" className="mobile-nav-quick-btn mobile-nav-home" onClick={onGoHome}>
          <TCIcon name="home" size={14} /> Inicio
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
          padding: 0,
          color: "#fff",
          fontSize: "1rem",
          lineHeight: 0,
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        {menuOpen ? <span className="tc-close-symbol" aria-hidden="true">✕</span> : <TCIcon name="menu" size={23} />}
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
              color: "#ffffff",
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
                color: "#ffffff",
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

          {canManageAccess && (
            <button type="button" onClick={() => { setMenuOpen(false); onGoAccessRequests?.(); }} style={{ ...medalButtonStyle, padding: "0.7rem", fontSize: "0.8rem", position: "relative" }}>
              <TCIcon name="user" size={16} /> <span>Solicitudes</span>
              {pendingAccessCount > 0 && <span style={{ minWidth: "17px", height: "17px", borderRadius: "20px", background: "#e11d48", color: "#fff", fontSize: "10px", fontWeight: 900, display: "grid", placeItems: "center" }}>{pendingAccessCount > 9 ? "9+" : pendingAccessCount}</span>}
            </button>
          )}

          {isArbitro && (
            <button type="button" onClick={() => { setMenuOpen(false); onGoMyCarnet?.(); }} style={{ ...medalButtonStyle, padding: "0.7rem", fontSize: "0.8rem" }}>
              <TCIcon name="user" size={16} /> <span>Mi carnet de árbitro</span>
            </button>
          )}
          {canManageAccess && (
            <button type="button" onClick={() => { setMenuOpen(false); onGoCarnetDirectory?.(); }} style={{ ...medalButtonStyle, padding: "0.7rem", fontSize: "0.8rem" }}>
              <TCIcon name="users" size={16} /> <span>Carnets de árbitros</span>
            </button>
          )}

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
                "linear-gradient(to bottom, #b5122a 0%, #8f1026 100%)",
              border: "1px solid #f07889",
              borderBottom: "3px solid #590a18",
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
        <div style={{ position: "absolute", top: "calc(100% + 10px)", right: 0, width: "min(340px, calc(100vw - 32px))", maxHeight: "70vh", overflowY: "auto", padding: "1rem", borderRadius: "14px", border: "1px solid #b5122a", background: "linear-gradient(145deg, #171717, #080808)", boxShadow: "0 12px 35px rgba(0,0,0,0.8)", zIndex: 200 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", marginBottom: "0.8rem" }}>
            <strong style={{ color: "#ffffff", fontSize: "0.85rem" }}><TCIcon name="medal" size={16} /> MI MEDALLERO</strong>
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
        .mobile-nav-quick-actions { display: none; }
        .mobile-navbar-alias { display: none; }
        .tc-navbar-user-role { display: block; margin-top: 3px; color: #f2b7c0; font-size: .68rem; font-weight: 700; line-height: 1.15; max-width: 230px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }


        @media (min-width: 641px) {
          .tc-navbar .desktop-nav-actions > .tc-nav-code {
            background: linear-gradient(180deg, #343943, #171c27) !important;
            border: 1px solid #687386 !important;
            border-bottom: 3px solid #0b0e14 !important;
            color: #e5e7eb !important;
            box-shadow: 0 3px 9px rgba(0,0,0,.28) !important;
          }
          .tc-navbar .desktop-nav-actions > .tc-nav-medals {
            background: linear-gradient(180deg, #252525, #101010) !important;
            border: 1px solid #b5122a !important;
            border-bottom: 3px solid #8a681b !important;
            color: #ffffff !important;
            box-shadow: 0 3px 10px rgba(218,165,32,.16) !important;
          }
          .tc-navbar .desktop-nav-actions > .tc-nav-stats {
            background: linear-gradient(180deg, #252525, #101010) !important;
            border: 1px solid rgba(255,255,255,.35) !important;
            border-bottom: 3px solid #0a1b2a !important;
            color: #ffffff !important;
            box-shadow: 0 3px 10px rgba(48,130,190,.16) !important;
          }
          .tc-navbar .desktop-nav-actions > .tc-nav-home {
            background: linear-gradient(180deg, #c5223b, #8f1026) !important;
            border: 1px solid #f07889 !important;
            border-bottom: 3px solid #5e0b19 !important;
            color: #fff !important;
            box-shadow: 0 3px 10px rgba(181,18,42,.25) !important;
          }
          .tc-navbar .desktop-nav-actions > button:hover {
            transform: translateY(-1px);
            filter: brightness(1.12);
          }
        }

        @media (max-width: 640px) {
          .desktop-nav-actions { display: none !important; }
          .tc-navbar-user-role { max-width: min(46vw, 190px); font-size: .62rem; }
          .mobile-navbar-alias {
            display: flex !important;
            align-items: center !important;
            gap: 4px !important;
            margin-top: 4px !important;
            color: #f2f2f2 !important;
            font-size: 11px !important;
            font-weight: 700 !important;
            white-space: nowrap !important;
          }
          .tc-navbar {
            padding: 0.35rem 0.55rem !important;
          }
          .mobile-nav-quick-actions {
            display: flex !important;
            align-items: center !important;
            justify-content: flex-end !important;
            gap: 8px !important;
            margin-left: auto !important;
            margin-right: 8px !important;
            flex: 0 0 auto !important;
          }
          .mobile-nav-quick-btn {
            box-sizing: border-box !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 4px !important;
            width: 82px !important;
            min-width: 82px !important;
            height: 36px !important;
            min-height: 36px !important;
            padding: 0 9px !important;
            border: 1px solid #55555b !important;
            border-radius: 6px !important;
            background: #0d0d0f !important;
            color: #fff !important;
            font: 800 12px/1 'Montserrat', sans-serif !important;
            white-space: nowrap !important;
            overflow: hidden !important;
          }
          .mobile-nav-home {
            background: linear-gradient(135deg, #b5122a 0%, #8f1026 100%) !important;
            border-color: #f07889 !important;
          }
          .mobile-menu-btn {
            display: flex !important;
            flex: 0 0 36px !important;
            width: 36px !important;
            min-width: 36px !important;
            height: 27px !important;
            min-height: 27px !important;
            align-items: center !important;
            justify-content: center !important;
            padding: 0 !important;
            border-radius: 6px !important;
          }
          .mobile-admin-btn { display: inline-flex !important; }
        }
      `}</style>
    </div>
  );
}
