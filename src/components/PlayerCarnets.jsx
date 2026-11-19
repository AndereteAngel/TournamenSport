import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

const statusLabel = {
  pendiente: "PENDIENTE",
  en_proceso: "EN PROCESO",
  habilitado: "HABILITADO",
  no_habilitado: "NO HABILITADO",
};

const statusColor = {
  pendiente: "#facc15",
  en_proceso: "#93c5fd",
  habilitado: "#86efac",
  no_habilitado: "#fca5a5",
};

export function PlayerCarnets({ currentUser, canManage = false, onBack, clubId = null, embedded = false }) {
  const [participations, setParticipations] = useState([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("todas");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [carnetAlertOpen, setCarnetAlertOpen] = useState(false);
  const [photoPreviewOpen, setPhotoPreviewOpen] = useState(false);
  const [dniPreviewOpen, setDniPreviewOpen] = useState(false);
  const [dniDocuments, setDniDocuments] = useState(null);
  const [dniLoading, setDniLoading] = useState(false);
  const [dniError, setDniError] = useState("");

  useEffect(() => {
    let active = true;
    const loadCarnets = async () => {
      setLoading(true);
      setError("");
      const { data, error: loadError } = await supabase.rpc("get_fefutin_my_permanent_rosters");
      if (!active) return;
      if (loadError) {
        setError(loadError.message || "No se pudieron cargar los carnets de jugadores.");
        setParticipations([]);
        setLoading(false);
        return;
      }
      setParticipations((data || []).map((item) => ({
        ...item,
        players: Array.isArray(item.players) ? item.players : [],
      })));
      setLoading(false);
    };
    loadCarnets();
    return () => { active = false; };
  }, []);

  const players = useMemo(() => {
    const unique = new Map();
    participations.forEach((item) => {
      if (clubId && item.club_id !== clubId) return;
      item.players.forEach((player) => {
        // El padrón del referente incluye también las altas pendientes de carnet.
        // La vista de carnets conserva únicamente jugadores con número asignado.
        if (!embedded && !String(player.carnet_number || "").trim()) return;
        const key = player.id || player.carnet_number || `${item.club_id}:${item.category_label}:${player.dni || player.first_name}`;
        if (!unique.has(key)) {
          unique.set(key, {
            ...player,
            club_id: item.club_id,
            club_name: item.club_name,
            logo_path: item.logo_path,
            category_label: item.category_label,
            tournament_title: item.tournament_title,
          });
        }
      });
    });
    return [...unique.values()].sort((a, b) =>
      (a.last_name || "").localeCompare(b.last_name || "", "es") ||
      (a.first_name || "").localeCompare(b.first_name || "", "es")
    );
  }, [participations, clubId]);

  const categoryOptions = [...new Set(players.map((player) => player.category_label).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  const filteredPlayers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("es");
    return players.filter((player) => {
      const searchFields = embedded ? [player.first_name, player.last_name, player.dni, player.carnet_number] : [player.first_name, player.last_name, player.dni, player.carnet_number, player.club_name];
      const matchesSearch = !query || searchFields.some((value) => String(value || "").toLocaleLowerCase("es").includes(query));
      const matchesCategory = categoryFilter === "todas" || player.category_label === categoryFilter;
      const playerStatus = player.approval_status === "pendiente"
        ? "pendiente"
        : player.approval_status === "rechazado"
          ? "rechazado"
          : (player.carnet_status || "pendiente");
      const matchesStatus = statusFilter === "todos" || playerStatus === statusFilter;
      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [players, search, categoryFilter, statusFilter]);

  const selectedPlayer = filteredPlayers.find((player) => player.carnet_number === selectedKey) || filteredPlayers[0] || null;
  const photoUrl = selectedPlayer?.photo_path
    ? supabase.storage.from("fefutin-player-photos").getPublicUrl(selectedPlayer.photo_path).data.publicUrl
    : "";
  const samplePhotoUrl = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 420"><rect width="320" height="420" fill="#242424"/><circle cx="160" cy="132" r="72" fill="#555"/><path d="M38 390c8-91 55-139 122-139s114 48 122 139" fill="#555"/><circle cx="160" cy="132" r="72" fill="none" stroke="#b5122a" stroke-width="8"/><text x="160" y="400" fill="#ddd" font-family="Arial,sans-serif" font-size="18" text-anchor="middle">FOTO DE MUESTRA</text></svg>');
  const logoUrl = selectedPlayer?.logo_path
    ? supabase.storage.from("fefutin-clubs").getPublicUrl(selectedPlayer.logo_path).data.publicUrl
    : "";
  const verificationStatus = selectedPlayer?.carnet_status || "pendiente";

  useEffect(() => {
    if (selectedPlayer && selectedPlayer.carnet_number !== selectedKey) {
      setSelectedKey(selectedPlayer.carnet_number);
    }
  }, [selectedPlayer, selectedKey]);

  const openDniDocuments = async (player) => {
    setDniPreviewOpen(true);
    setDniLoading(true);
    setDniError("");
    setDniDocuments(null);
    const { data, error: rpcError } = await supabase.rpc("get_fefutin_player_dni_documents", {
      p_player_entry_id: player.id,
    });
    if (rpcError) {
      setDniError(rpcError.message || "No se pudieron consultar los documentos del DNI.");
      setDniLoading(false);
      return;
    }
    const documents = data?.[0];
    if (!documents?.dni_front_path || !documents?.dni_back_path) {
      setDniError("Este jugador todavía no tiene cargados el frente y el dorso del DNI.");
      setDniLoading(false);
      return;
    }
    const [front, back] = await Promise.all([
      supabase.storage.from("fefutin-player-dni").createSignedUrl(documents.dni_front_path, 300),
      supabase.storage.from("fefutin-player-dni").createSignedUrl(documents.dni_back_path, 300),
    ]);
    if (front.error || back.error) {
      setDniError(front.error?.message || back.error?.message || "No se pudieron abrir las imágenes del DNI.");
      setDniLoading(false);
      return;
    }
    setDniDocuments({
      frontUrl: front.data.signedUrl,
      backUrl: back.data.signedUrl,
      frontPdf: documents.dni_front_path.toLowerCase().endsWith(".pdf"),
      backPdf: documents.dni_back_path.toLowerCase().endsWith(".pdf"),
    });
    setDniLoading(false);
  };

  const fieldStyle = {
    width: "100%", boxSizing: "border-box", padding: ".75rem",
    borderRadius: "8px", border: "1px solid #555", background: "#101010",
    color: "#fff", marginTop: ".35rem",
  };

  return (
    <div className="tc-form-screen" style={{ width: "100%", maxWidth: "100%", padding: embedded ? 0 : "1rem", minHeight: "70vh", boxSizing: "border-box" }}>
      <section className={embedded ? "" : "cr-card"} style={{ width: "100%", maxWidth: "100%", margin: "auto", padding: embedded ? 0 : "clamp(1rem, 3vw, 2rem)", boxSizing: "border-box", background: embedded ? "transparent" : "#090909", color: "#fff", border: embedded ? 0 : "1px solid #b5122a" }}>
        {!embedded && <button type="button" className="tc-form-back" onClick={onBack}>← Volver</button>}
        <header style={{ textAlign: "center", margin: "1.2rem 0" }}>
          <p style={{ color: "#b5122a", fontWeight: 900, letterSpacing: ".15em", margin: 0 }}>FEFUTIN · IDENTIFICACIÓN OFICIAL</p>
          <h2 className="cr-title" style={{ margin: ".35rem 0" }}>{embedded ? "JUGADORES REGISTRADOS" : "CARNET DE JUGADOR"}</h2>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,180px),1fr))", gap: ".7rem", marginBottom: "1rem", padding: ".85rem", border: "1px solid #444", borderRadius: "10px", background: "#171717" }}>
          <label style={{ display: "grid", gap: ".35rem", color: "#eee", fontSize: ".76rem", fontWeight: 800 }}>
            Buscar jugador
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={embedded ? "Nombre, apellido o DNI..." : "Nombre o apellido..."} style={fieldStyle} />
          </label>
          <label style={{ display: "grid", gap: ".35rem", color: "#eee", fontSize: ".76rem", fontWeight: 800 }}>
            Categoría
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} style={fieldStyle}>
              <option value="todas">Todas las categorías</option>
              {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: ".35rem", color: "#eee", fontSize: ".76rem", fontWeight: 800 }}>
            {embedded ? "Estado de inscripción / carnet" : "Estado del carnet"}
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={fieldStyle}>
              <option value="todos">Todos los estados</option>
              <option value="pendiente">Pendiente</option>
              <option value="en_proceso">En proceso</option>
              <option value="habilitado">Habilitado</option>
              <option value="no_habilitado">No habilitado</option>
              {embedded && <option value="rechazado">Rechazado</option>}
            </select>
          </label>
          <button type="button" onClick={() => { setSearch(""); setCategoryFilter("todas"); setStatusFilter("todos"); }} style={{ alignSelf: "end", border: "1px solid #b5122a", borderRadius: "8px", padding: ".7rem .9rem", background: "#171c27", color: "#fff", fontWeight: 800, cursor: "pointer" }}>Limpiar filtros</button>
        </div>

        {!embedded && filteredPlayers.length > 0 && (
          <label style={{ display: "block", color: "#ddd", fontSize: ".78rem", fontWeight: 800, marginBottom: "1rem" }}>
            Seleccionar carnet
            <select value={selectedPlayer?.carnet_number || ""} onChange={(event) => setSelectedKey(event.target.value)} style={fieldStyle}>
              {filteredPlayers.map((player) => (
                <option key={player.carnet_number} value={player.carnet_number}>
                  {[player.last_name, player.first_name].filter(Boolean).join(", ")}
                </option>
              ))}
            </select>
          </label>
        )}

        {loading ? (
          <p style={{ color: "#ddd", textAlign: "center" }}>{embedded ? "Cargando jugadores..." : "Cargando carnets..."}</p>
        ) : error ? (
          <p role="alert" style={{ color: "#fca5a5" }}>{error}</p>
        ) : embedded ? (
          <>
            <div style={{ overflowX: "auto", border: "1px solid #444", borderRadius: "9px", marginTop: ".5rem" }}>
              <table style={{ width: "100%", minWidth: "620px", borderCollapse: "collapse", background: "#101010", color: "#fff", textAlign: "left" }}>
                <thead><tr style={{ background: "#b5122a" }}>
                  {["N.º", "FOTO", "JUGADOR", "DNI", "CATEGORÍA", "CARNET", "ESTADO"].map((heading) => <th key={heading} style={{ padding: ".65rem .5rem", fontSize: ".68rem", whiteSpace: "nowrap" }}>{heading}</th>)}
                </tr></thead>
                <tbody>
                  {filteredPlayers.map((player, index) => {
                    const playerStatus = player.approval_status === "pendiente"
                      ? "PENDIENTE DE APROBACIÓN"
                      : player.approval_status === "rechazado"
                        ? "RECHAZADO"
                        : statusLabel[player.carnet_status || "pendiente"] || "PENDIENTE";
                    const playerStatusColor = player.approval_status === "rechazado"
                      ? "#fca5a5"
                      : player.approval_status === "pendiente"
                        ? "#facc15"
                        : statusColor[player.carnet_status || "pendiente"] || "#ddd";
                    return (
                      <tr key={player.id || player.carnet_number || index} style={{ borderTop: "1px solid #333" }}>
                        <td style={{ padding: ".55rem", color: "#fca5a5", fontWeight: 900 }}>{index + 1}</td>
                        <td style={{ padding: ".4rem" }}><img src={player.photo_path ? supabase.storage.from("fefutin-player-photos").getPublicUrl(player.photo_path).data.publicUrl : samplePhotoUrl} alt="" style={{ width: "42px", height: "48px", borderRadius: "5px", objectFit: "cover", display: "block" }} /></td>
                        <td style={{ padding: ".55rem", minWidth: "125px" }}><strong>{[player.last_name, player.first_name].filter(Boolean).join(", ") || "Sin nombre"}</strong></td>
                        <td style={{ padding: ".55rem", whiteSpace: "nowrap" }}>{player.dni || "—"}</td>
                        <td style={{ padding: ".55rem" }}>{player.category_label || "—"}</td>
                        <td style={{ padding: ".55rem", whiteSpace: "nowrap" }}>
                          {player.carnet_number ? <button type="button" onClick={() => { setSelectedKey(player.carnet_number); setCarnetAlertOpen(true); }} style={{ border: 0, background: "transparent", color: "#fff", textDecoration: "underline", cursor: "pointer", fontWeight: 800 }}>{player.carnet_number}</button> : "Pendiente"}
                        </td>
                        <td style={{ padding: ".55rem", color: playerStatusColor, fontSize: ".7rem", fontWeight: 900, whiteSpace: "nowrap" }}>{playerStatus}</td>
                      </tr>
                    );
                  })}
                  {!filteredPlayers.length && <tr><td colSpan={7} style={{ color: "#aaa", textAlign: "center", padding: "1rem" }}>{players.length ? "No hay jugadores que coincidan con los filtros." : "Todavía no hay jugadores registrados en este club."}</td></tr>}
                </tbody>
              </table>
            </div>
            {carnetAlertOpen && selectedPlayer && (
              <div role="dialog" aria-modal="true" aria-label="Carnet del jugador" onClick={(event) => { if (event.target === event.currentTarget) setCarnetAlertOpen(false); }} style={{ position: "fixed", inset: 0, zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", background: "rgba(0,0,0,.82)", backdropFilter: "blur(4px)" }}>
                <div style={{ width: "min(100%, 820px)", maxHeight: "92vh", overflowY: "auto", padding: "clamp(.6rem,2vw,1rem)", border: "1px solid #555", borderRadius: "14px", background: "#171717", boxShadow: "0 20px 70px rgba(0,0,0,.65)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".5rem", marginBottom: ".65rem" }}>
                    <strong style={{ color: "#fff", fontSize: ".85rem" }}>CARNET DEL JUGADOR</strong>
                    <button type="button" onClick={() => setCarnetAlertOpen(false)} style={{ border: "1px solid #b5122a", borderRadius: "8px", background: "#111", color: "#fff", padding: ".5rem .8rem", cursor: "pointer" }}>✕ Cerrar</button>
                  </div>
                  <article className="fefutin-carnet-motion fefutin-carnet-card" style={{ width: "100%", maxWidth: "760px", aspectRatio: "1.586 / 1", minHeight: "250px", boxSizing: "border-box", margin: "0 auto", border: "2px solid #b5122a", borderRadius: "14px", overflow: "hidden", background: "linear-gradient(135deg,#242424 0%,#101010 58%,#080808 100%)", color: "#fff", boxShadow: "0 12px 30px rgba(0,0,0,.35)", animation: "fefutinCarnetSway 5.5s ease-in-out infinite", transformOrigin: "50% 85%" }}>
              <div style={{ boxSizing: "border-box", width: "100%", padding: ".8rem 1rem", background: "#b5122a", display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".5rem" }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, color: "#fff", fontSize: ".78rem", fontWeight: 900, letterSpacing: ".1em" }}>FEFUTIN</p>
                  <p style={{ margin: ".15rem 0 0", color: "#fff", fontSize: ".62rem", fontWeight: 700, letterSpacing: ".06em" }}>FEDERACIÓN DE FÚTBOL INFANTIL</p>
                </div>
                <img src="https://fefutin.wordpress.com/wp-content/uploads/2017/03/fefutin-logo-grande1.png?h=184&w=166" alt="Logo oficial de FEFUTIN" style={{ flex: "0 0 auto", width: "54px", height: "54px", objectFit: "contain", padding: "3px", boxSizing: "border-box", background: "#fff", border: "1px solid rgba(255,255,255,.8)", borderRadius: "8px" }} />
              </div>

              <div style={{ boxSizing: "border-box", width: "100%", height: "calc(100% - 108px)", minHeight: 0, padding: "clamp(.45rem,1.5vw,.8rem)", display: "grid", gridTemplateColumns: "clamp(92px,19%,140px) minmax(0,1fr)", gap: "clamp(.5rem,1.5vw,.9rem)", alignItems: "center" }}>
                <button type="button" onClick={() => setPhotoPreviewOpen(true)} aria-label="Ampliar fotografía del jugador" style={{ width: "100%", aspectRatio: "3/4", minWidth: 0, boxSizing: "border-box", padding: 0, border: "2px solid #b5122a", borderRadius: "10px", overflow: "hidden", background: "#202020", display: "block", cursor: "zoom-in" }}>
                  <img src={photoUrl || samplePhotoUrl} alt={photoUrl ? "Fotografía de " + selectedPlayer.first_name + " " + selectedPlayer.last_name : "Fotografía de muestra"} style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />
                </button>
                <div style={{ minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-word" }}>
                  <p style={{ color: "#e7a0aa", fontSize: ".65rem", fontWeight: 900, letterSpacing: ".1em", margin: "0 0 .35rem" }}>CREDENCIAL OFICIAL</p>
                  <h3 style={{ color: "#fff", fontSize: "clamp(1rem,4vw,1.35rem)", lineHeight: 1.15, margin: "0 0 .8rem" }}>{[selectedPlayer.first_name, selectedPlayer.last_name].filter(Boolean).join(" ")}</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", gap: ".65rem .9rem" }}>
                    <div style={{ borderBottom: "1px solid #454545", paddingBottom: ".4rem" }}>
                      <p style={{ color: "#aaa", fontSize: ".62rem", fontWeight: 800, letterSpacing: ".08em", margin: 0 }}>NÚMERO FEFUTIN</p>
                      <p style={{ color: "#fff", fontSize: ".95rem", fontWeight: 900, margin: ".15rem 0 0" }}>{selectedPlayer.carnet_number}</p>
                    </div>
                    <div style={{ borderBottom: "1px solid #454545", paddingBottom: ".4rem" }}>
                      <p style={{ color: "#aaa", fontSize: ".62rem", fontWeight: 800, letterSpacing: ".08em", margin: 0 }}>DNI</p>
                      <button type="button" onClick={() => openDniDocuments(selectedPlayer)} style={{ color: "#fff", fontSize: ".9rem", fontWeight: 800, margin: ".15rem 0 0", padding: 0, border: 0, borderBottom: "1px dashed #e7a0aa", background: "transparent", cursor: "pointer", textAlign: "left" }}>{selectedPlayer.dni || "NO REGISTRADO"}　↗</button>
                    </div>
                    <div style={{ borderBottom: "1px solid #454545", paddingBottom: ".4rem" }}>
                      <p style={{ color: "#aaa", fontSize: ".62rem", fontWeight: 800, letterSpacing: ".08em", margin: 0 }}>CLUB</p>
                      <div style={{ display: "flex", alignItems: "center", gap: ".45rem", marginTop: ".2rem" }}>
                        {logoUrl && <img src={logoUrl} alt="" style={{ width: "28px", height: "28px", objectFit: "contain", background: "#fff", borderRadius: "5px" }} />}
                        <p style={{ color: "#fff", fontSize: ".84rem", fontWeight: 800, margin: 0 }}>{selectedPlayer.club_name}</p>
                      </div>
                    </div>
                    <div style={{ borderBottom: "1px solid #454545", paddingBottom: ".4rem" }}>
                      <p style={{ color: "#aaa", fontSize: ".62rem", fontWeight: 800, letterSpacing: ".08em", margin: 0 }}>CATEGORÍA</p>
                      <p style={{ color: "#fff", fontSize: ".84rem", margin: ".15rem 0 0" }}>{selectedPlayer.category_label || "—"}</p>
                    </div>
                    <div>
                      <p style={{ color: "#aaa", fontSize: ".62rem", fontWeight: 800, letterSpacing: ".08em", margin: 0 }}>ESTADO DE HABILITACIÓN</p>
                      <p style={{ color: statusColor[verificationStatus] || "#facc15", fontSize: ".82rem", fontWeight: 900, margin: ".15rem 0 0" }}>{statusLabel[verificationStatus] || "PENDIENTE"}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ boxSizing: "border-box", width: "100%", padding: ".6rem 1rem", borderTop: "1px solid #b5122a", background: "#090909", display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".5rem" }}>
                <span style={{ color: "#ddd", fontSize: ".62rem", fontWeight: 800, letterSpacing: ".08em" }}>JUGADOR FEFUTIN</span>
                <span style={{ color: "#e7a0aa", fontSize: ".6rem", fontWeight: 800 }}>CARNET DIGITAL · FEFUTIN</span>
              </div>
                  </article>
                </div>
              </div>
            )}
            <style>{`
              @keyframes fefutinCarnetSway {
                0%, 100% { transform: perspective(900px) rotateX(0deg) rotateZ(0deg) translateY(0); }
                22% { transform: perspective(900px) rotateX(1.2deg) rotateZ(-0.65deg) translateY(-2px); }
                48% { transform: perspective(900px) rotateX(-0.6deg) rotateZ(0.55deg) translateY(-4px); }
                72% { transform: perspective(900px) rotateX(0.8deg) rotateZ(-0.35deg) translateY(-1px); }
              }
              @media (max-width: 520px) and (orientation: portrait) {
                .fefutin-carnet-card {
                  aspect-ratio: auto !important;
                  min-height: 0 !important;
                  height: auto !important;
                  border-radius: 10px !important;
                  animation: none !important;
                }
                .fefutin-carnet-card > div:first-child {
                  padding: .45rem .6rem !important;
                  min-height: 48px;
                }
                .fefutin-carnet-card > div:first-child p:first-child {
                  font-size: .68rem !important;
                }
                .fefutin-carnet-card > div:first-child p:last-child {
                  font-size: .48rem !important;
                  letter-spacing: .02em !important;
                }
                .fefutin-carnet-card > div:first-child img {
                  width: 38px !important;
                  height: 38px !important;
                }
                .fefutin-carnet-card > div:nth-child(2) {
                  height: auto !important;
                  min-height: 0 !important;
                  padding: .5rem !important;
                  grid-template-columns: 76px minmax(0, 1fr) !important;
                  gap: .55rem !important;
                  align-items: start !important;
                }
                .fefutin-carnet-card > div:nth-child(2) > div:first-child {
                  width: 76px !important;
                  max-height: 102px;
                  aspect-ratio: 3 / 4 !important;
                }
                .fefutin-carnet-card > div:nth-child(2) > div:first-child span {
                  font-size: 1.5rem !important;
                }
                .fefutin-carnet-card > div:nth-child(2) > div:nth-child(2) {
                  min-width: 0 !important;
                }
                .fefutin-carnet-card > div:nth-child(2) > div:nth-child(2) > p {
                  font-size: .52rem !important;
                  margin-bottom: .2rem !important;
                }
                .fefutin-carnet-card h3 {
                  font-size: .82rem !important;
                  line-height: 1.12 !important;
                  margin-bottom: .45rem !important;
                }
                .fefutin-carnet-card > div:nth-child(2) > div:nth-child(2) > div {
                  grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
                  gap: .38rem .5rem !important;
                }
                .fefutin-carnet-card > div:nth-child(2) > div:nth-child(2) > div > div {
                  min-width: 0 !important;
                  padding-bottom: .22rem !important;
                }
                .fefutin-carnet-card > div:nth-child(2) > div:nth-child(2) > div > div p:first-child {
                  font-size: .46rem !important;
                  letter-spacing: .02em !important;
                  line-height: 1.1 !important;
                }
                .fefutin-carnet-card > div:nth-child(2) > div:nth-child(2) > div > div p:last-child {
                  font-size: .66rem !important;
                  line-height: 1.15 !important;
                  overflow-wrap: anywhere !important;
                }
                .fefutin-carnet-card > div:nth-child(2) > div:nth-child(2) > div > div img {
                  width: 20px !important;
                  height: 20px !important;
                }
                .fefutin-carnet-card > div:last-child {
                  padding: .38rem .55rem !important;
                  min-height: 28px;
                }
                .fefutin-carnet-card > div:last-child span {
                  font-size: .46rem !important;
                  letter-spacing: .02em !important;
                }
              }
              @media (prefers-reduced-motion: reduce) {
                .fefutin-carnet-motion { animation: none !important; }
              }
            `}</style>
            <p style={{ color: "#aaa", fontSize: ".78rem", textAlign: "center", marginTop: "1rem" }}>Credencial generada desde el registro oficial de jugadores.</p>
          </>
        ) : !selectedPlayer ? (
          <p style={{ color: "#ddd", textAlign: "center", padding: "1.5rem" }}>
            {players.length === 0
              ? "Todavía no hay jugadores aprobados con carnet para mostrar. El carnet aparece cuando Admin o Directivo aprueba al jugador."
              : "No hay carnets que coincidan con los filtros seleccionados."}
          </p>
        ) : (
          <>
            <article className="fefutin-carnet-motion fefutin-carnet-card" style={{ width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box", margin: "0 auto", border: "2px solid #b5122a", borderRadius: "18px", overflow: "hidden", background: "linear-gradient(135deg,#242424 0%,#101010 58%,#080808 100%)", color: "#fff", boxShadow: "0 12px 30px rgba(0,0,0,.35)", animation: "fefutinCarnetSway 5.5s ease-in-out infinite", transformOrigin: "50% 85%" }}>
              <div style={{ boxSizing: "border-box", width: "100%", padding: ".8rem 1rem", background: "#b5122a", display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".5rem" }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, color: "#fff", fontSize: ".78rem", fontWeight: 900, letterSpacing: ".1em" }}>FEFUTIN</p>
                  <p style={{ margin: ".15rem 0 0", color: "#fff", fontSize: ".62rem", fontWeight: 700, letterSpacing: ".06em" }}>FEDERACIÓN DE FÚTBOL INFANTIL</p>
                </div>
                <img src="https://fefutin.wordpress.com/wp-content/uploads/2017/03/fefutin-logo-grande1.png?h=184&w=166" alt="Logo oficial de FEFUTIN" style={{ flex: "0 0 auto", width: "54px", height: "54px", objectFit: "contain", padding: "3px", boxSizing: "border-box", background: "#fff", border: "1px solid rgba(255,255,255,.8)", borderRadius: "8px" }} />
              </div>

              <div style={{ boxSizing: "border-box", width: "100%", padding: "clamp(.75rem,3vw,1.15rem)", display: "grid", gridTemplateColumns: "clamp(110px,22%,190px) minmax(0,1fr)", gap: "clamp(.75rem,2.5vw,1.25rem)", alignItems: "center" }}>
                <button type="button" onClick={() => setPhotoPreviewOpen(true)} aria-label="Ampliar fotografía del jugador" style={{ width: "100%", aspectRatio: "3/4", minWidth: 0, boxSizing: "border-box", padding: 0, border: "2px solid #b5122a", borderRadius: "10px", overflow: "hidden", background: "#202020", display: "block", cursor: "zoom-in" }}>
                  <img src={photoUrl || samplePhotoUrl} alt={photoUrl ? "Fotografía de " + selectedPlayer.first_name + " " + selectedPlayer.last_name : "Fotografía de muestra"} style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />
                </button>
                <div style={{ minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-word" }}>
                  <p style={{ color: "#e7a0aa", fontSize: ".65rem", fontWeight: 900, letterSpacing: ".1em", margin: "0 0 .35rem" }}>CREDENCIAL OFICIAL</p>
                  <h3 style={{ color: "#fff", fontSize: "clamp(1rem,4vw,1.35rem)", lineHeight: 1.15, margin: "0 0 .8rem" }}>{[selectedPlayer.first_name, selectedPlayer.last_name].filter(Boolean).join(" ")}</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", gap: ".65rem .9rem" }}>
                    <div style={{ borderBottom: "1px solid #454545", paddingBottom: ".4rem" }}>
                      <p style={{ color: "#aaa", fontSize: ".62rem", fontWeight: 800, letterSpacing: ".08em", margin: 0 }}>NÚMERO FEFUTIN</p>
                      <p style={{ color: "#fff", fontSize: ".95rem", fontWeight: 900, margin: ".15rem 0 0" }}>{selectedPlayer.carnet_number}</p>
                    </div>
                    <div style={{ borderBottom: "1px solid #454545", paddingBottom: ".4rem" }}>
                      <p style={{ color: "#aaa", fontSize: ".62rem", fontWeight: 800, letterSpacing: ".08em", margin: 0 }}>DNI</p>
                      <button type="button" onClick={() => openDniDocuments(selectedPlayer)} style={{ color: "#fff", fontSize: ".9rem", fontWeight: 800, margin: ".15rem 0 0", padding: 0, border: 0, borderBottom: "1px dashed #e7a0aa", background: "transparent", cursor: "pointer", textAlign: "left" }}>{selectedPlayer.dni || "NO REGISTRADO"}　↗</button>
                    </div>
                    <div style={{ borderBottom: "1px solid #454545", paddingBottom: ".4rem" }}>
                      <p style={{ color: "#aaa", fontSize: ".62rem", fontWeight: 800, letterSpacing: ".08em", margin: 0 }}>CLUB</p>
                      <div style={{ display: "flex", alignItems: "center", gap: ".45rem", marginTop: ".2rem" }}>
                        {logoUrl && <img src={logoUrl} alt="" style={{ width: "28px", height: "28px", objectFit: "contain", background: "#fff", borderRadius: "5px" }} />}
                        <p style={{ color: "#fff", fontSize: ".84rem", fontWeight: 800, margin: 0 }}>{selectedPlayer.club_name}</p>
                      </div>
                    </div>
                    <div style={{ borderBottom: "1px solid #454545", paddingBottom: ".4rem" }}>
                      <p style={{ color: "#aaa", fontSize: ".62rem", fontWeight: 800, letterSpacing: ".08em", margin: 0 }}>CATEGORÍA</p>
                      <p style={{ color: "#fff", fontSize: ".84rem", margin: ".15rem 0 0" }}>{selectedPlayer.category_label || "—"}</p>
                    </div>
                    <div>
                      <p style={{ color: "#aaa", fontSize: ".62rem", fontWeight: 800, letterSpacing: ".08em", margin: 0 }}>ESTADO DE HABILITACIÓN</p>
                      <p style={{ color: statusColor[verificationStatus] || "#facc15", fontSize: ".82rem", fontWeight: 900, margin: ".15rem 0 0" }}>{statusLabel[verificationStatus] || "PENDIENTE"}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ boxSizing: "border-box", width: "100%", padding: ".6rem 1rem", borderTop: "1px solid #b5122a", background: "#090909", display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".5rem" }}>
                <span style={{ color: "#ddd", fontSize: ".62rem", fontWeight: 800, letterSpacing: ".08em" }}>JUGADOR FEFUTIN</span>
                <span style={{ color: "#e7a0aa", fontSize: ".6rem", fontWeight: 800 }}>CARNET DIGITAL · FEFUTIN</span>
              </div>
            </article>
            <style>{`
              @keyframes fefutinCarnetSway {
                0%, 100% { transform: perspective(900px) rotateX(0deg) rotateZ(0deg) translateY(0); }
                22% { transform: perspective(900px) rotateX(1.2deg) rotateZ(-0.65deg) translateY(-2px); }
                48% { transform: perspective(900px) rotateX(-0.6deg) rotateZ(0.55deg) translateY(-4px); }
                72% { transform: perspective(900px) rotateX(0.8deg) rotateZ(-0.35deg) translateY(-1px); }
              }
              @media (prefers-reduced-motion: reduce) {
                .fefutin-carnet-motion { animation: none !important; }
              }
            `}</style>
            <p style={{ color: "#aaa", fontSize: ".78rem", textAlign: "center", marginTop: "1rem" }}>Credencial generada desde el registro oficial de jugadores.</p>
          </>
        )}

        {photoPreviewOpen && selectedPlayer && (
          <div role="dialog" aria-modal="true" aria-label="Fotografía ampliada del jugador" onClick={(event) => { if (event.target === event.currentTarget) setPhotoPreviewOpen(false); }} style={{ position: "fixed", inset: 0, zIndex: 11000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", background: "rgba(0,0,0,.94)" }}>
            <button type="button" onClick={() => setPhotoPreviewOpen(false)} style={{ position: "absolute", top: "1rem", right: "1rem", zIndex: 1, border: "1px solid #b5122a", borderRadius: "9px", padding: ".65rem .9rem", color: "#fff", background: "#171717", cursor: "pointer" }}>✕ Cerrar</button>
            <img src={photoUrl || samplePhotoUrl} alt={photoUrl ? "Fotografía ampliada de " + selectedPlayer.first_name + " " + selectedPlayer.last_name : "Fotografía de muestra"} style={{ display: "block", maxWidth: "min(94vw, 720px)", maxHeight: "84vh", objectFit: "contain", border: "2px solid #b5122a", borderRadius: "12px", boxShadow: "0 16px 60px rgba(0,0,0,.7)" }} />
          </div>
        )}

        {dniPreviewOpen && (
          <div role="dialog" aria-modal="true" aria-label="Documentos del DNI" onClick={(event) => { if (event.target === event.currentTarget) setDniPreviewOpen(false); }} style={{ position: "fixed", inset: 0, zIndex: 11001, display: "flex", alignItems: "center", justifyContent: "center", padding: ".75rem", background: "rgba(0,0,0,.94)" }}>
            <div style={{ width: "min(100%, 960px)", maxHeight: "94vh", overflowY: "auto", padding: "1rem", border: "1px solid #b5122a", borderRadius: "14px", background: "#171717", color: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".7rem", marginBottom: "1rem" }}>
                <div>
                  <strong style={{ display: "block" }}>DOCUMENTO DE IDENTIDAD</strong>
                  <span style={{ color: "#aaa", fontSize: ".8rem" }}>{selectedPlayer ? [selectedPlayer.first_name, selectedPlayer.last_name].filter(Boolean).join(" ") : ""}</span>
                </div>
                <button type="button" onClick={() => setDniPreviewOpen(false)} style={{ border: "1px solid #b5122a", borderRadius: "8px", background: "#101010", color: "#fff", padding: ".55rem .8rem", cursor: "pointer" }}>✕ Cerrar</button>
              </div>
              {dniLoading && <p style={{ textAlign: "center", color: "#ddd" }}>Cargando documentos...</p>}
              {dniError && <p role="alert" style={{ color: "#fca5a5" }}>{dniError}</p>}
              {dniDocuments && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))", gap: "1rem" }}>
                  {[
                    { label: "FRENTE DEL DNI", url: dniDocuments.frontUrl, pdf: dniDocuments.frontPdf },
                    { label: "DORSO DEL DNI", url: dniDocuments.backUrl, pdf: dniDocuments.backPdf },
                  ].map((document) => (
                    <div key={document.label} style={{ minWidth: 0, padding: ".65rem", border: "1px solid #444", borderRadius: "10px", background: "#090909" }}>
                      <strong style={{ display: "block", color: "#e7a0aa", fontSize: ".8rem", marginBottom: ".6rem" }}>{document.label}</strong>
                      {document.pdf
                        ? <iframe title={document.label} src={document.url} style={{ width: "100%", height: "min(65vh,520px)", border: 0, background: "#fff", borderRadius: "6px" }} />
                        : <img src={document.url} alt={document.label} style={{ display: "block", width: "100%", maxHeight: "65vh", objectFit: "contain", background: "#fff", borderRadius: "6px" }} />}
                    </div>
                  ))}
                </div>
              )}
              <p style={{ color: "#888", fontSize: ".72rem", margin: "1rem 0 0" }}>Documentación privada. El acceso queda limitado al referente de este club y a los usuarios institucionales autorizados.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
