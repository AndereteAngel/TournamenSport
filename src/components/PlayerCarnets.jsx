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

  useEffect(() => {
    let active = true;
    const loadCarnets = async () => {
      setLoading(true);
      setError("");
      const { data, error: loadError } = await supabase.rpc("get_fefutin_my_teams");
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
        // El carnet_number proviene del registro oficial fefutin_players.
        // Si existe, el jugador ya tiene carnet; no filtramos por el estado de la fila de lista de buena fe.
        if (!String(player.carnet_number || "").trim()) return;
        const key = player.carnet_number;
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
      const matchesSearch = !query || [player.first_name, player.last_name, player.dni, player.carnet_number, player.club_name].some((value) => String(value || "").toLocaleLowerCase("es").includes(query));
      const matchesCategory = categoryFilter === "todas" || player.category_label === categoryFilter;
      const matchesStatus = statusFilter === "todos" || (player.carnet_status || "pendiente") === statusFilter;
      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [players, search, categoryFilter, statusFilter]);

  const selectedPlayer = filteredPlayers.find((player) => player.carnet_number === selectedKey) || filteredPlayers[0] || null;
  const photoUrl = selectedPlayer?.photo_path
    ? supabase.storage.from("fefutin-player-photos").getPublicUrl(selectedPlayer.photo_path).data.publicUrl
    : "";
  const logoUrl = selectedPlayer?.logo_path
    ? supabase.storage.from("fefutin-clubs").getPublicUrl(selectedPlayer.logo_path).data.publicUrl
    : "";
  const verificationStatus = selectedPlayer?.carnet_status || "pendiente";

  useEffect(() => {
    if (selectedPlayer && selectedPlayer.carnet_number !== selectedKey) {
      setSelectedKey(selectedPlayer.carnet_number);
    }
  }, [selectedPlayer, selectedKey]);

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
          <h2 className="cr-title" style={{ margin: ".35rem 0" }}>CARNET DE JUGADOR</h2>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,180px),1fr))", gap: ".7rem", marginBottom: "1rem", padding: ".85rem", border: "1px solid #444", borderRadius: "10px", background: "#171717" }}>
          <label style={{ display: "grid", gap: ".35rem", color: "#eee", fontSize: ".76rem", fontWeight: 800 }}>
            Buscar carnet o jugador
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, DNI o N° de carnet..." style={fieldStyle} />
          </label>
          <label style={{ display: "grid", gap: ".35rem", color: "#eee", fontSize: ".76rem", fontWeight: 800 }}>
            Categoría
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} style={fieldStyle}>
              <option value="todas">Todas las categorías</option>
              {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: ".35rem", color: "#eee", fontSize: ".76rem", fontWeight: 800 }}>
            Estado del carnet
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={fieldStyle}>
              <option value="todos">Todos los estados</option>
              <option value="pendiente">Pendiente</option>
              <option value="en_proceso">En proceso</option>
              <option value="habilitado">Habilitado</option>
              <option value="no_habilitado">No habilitado</option>
            </select>
          </label>
          <button type="button" onClick={() => { setSearch(""); setCategoryFilter("todas"); setStatusFilter("todos"); }} style={{ alignSelf: "end", border: "1px solid #b5122a", borderRadius: "8px", padding: ".7rem .9rem", background: "#171c27", color: "#fff", fontWeight: 800, cursor: "pointer" }}>Limpiar filtros</button>
        </div>

        {filteredPlayers.length > 0 && (
          <label style={{ display: "block", color: "#ddd", fontSize: ".78rem", fontWeight: 800, marginBottom: "1rem" }}>
            Seleccionar carnet
            <select value={selectedPlayer?.carnet_number || ""} onChange={(event) => setSelectedKey(event.target.value)} style={fieldStyle}>
              {filteredPlayers.map((player) => (
                <option key={player.carnet_number} value={player.carnet_number}>
                  {[player.last_name, player.first_name].filter(Boolean).join(", ")} · {player.carnet_number}
                </option>
              ))}
            </select>
          </label>
        )}

        {loading ? (
          <p style={{ color: "#ddd", textAlign: "center" }}>Cargando carnets...</p>
        ) : error ? (
          <p role="alert" style={{ color: "#fca5a5" }}>{error}</p>
        ) : !selectedPlayer ? (
          <p style={{ color: "#ddd", textAlign: "center", padding: "1.5rem" }}>
            {players.length === 0
              ? "Todavía no hay jugadores aprobados con carnet para mostrar. El carnet aparece cuando Admin o Directivo aprueba al jugador."
              : "No hay carnets que coincidan con los filtros seleccionados."}
          </p>
        ) : (
          <>
            <article className="fefutin-carnet-motion" style={{ width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box", margin: "0 auto", border: "2px solid #b5122a", borderRadius: "18px", overflow: "hidden", background: "linear-gradient(135deg,#242424 0%,#101010 58%,#080808 100%)", color: "#fff", boxShadow: "0 12px 30px rgba(0,0,0,.35)", animation: "fefutinCarnetSway 5.5s ease-in-out infinite", transformOrigin: "50% 85%" }}>
              <div style={{ boxSizing: "border-box", width: "100%", padding: ".8rem 1rem", background: "#b5122a", display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".5rem" }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, color: "#fff", fontSize: ".78rem", fontWeight: 900, letterSpacing: ".1em" }}>FEFUTIN</p>
                  <p style={{ margin: ".15rem 0 0", color: "#fff", fontSize: ".62rem", fontWeight: 700, letterSpacing: ".06em" }}>FEDERACIÓN DE FÚTBOL INFANTIL</p>
                </div>
                <img src="https://fefutin.wordpress.com/wp-content/uploads/2017/03/fefutin-logo-grande1.png?h=184&w=166" alt="Logo oficial de FEFUTIN" style={{ flex: "0 0 auto", width: "54px", height: "54px", objectFit: "contain", padding: "3px", boxSizing: "border-box", background: "#fff", border: "1px solid rgba(255,255,255,.8)", borderRadius: "8px" }} />
              </div>

              <div style={{ boxSizing: "border-box", width: "100%", padding: "clamp(.75rem,3vw,1.15rem)", display: "grid", gridTemplateColumns: "clamp(110px,22%,190px) minmax(0,1fr)", gap: "clamp(.75rem,2.5vw,1.25rem)", alignItems: "center" }}>
                <div style={{ width: "100%", aspectRatio: "3/4", minWidth: 0, boxSizing: "border-box", border: "2px solid #b5122a", borderRadius: "10px", overflow: "hidden", background: "#202020", display: "grid", placeItems: "center" }}>
                  {photoUrl ? <img src={photoUrl} alt={"Fotografía de " + selectedPlayer.first_name + " " + selectedPlayer.last_name} style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ color: "#888", fontSize: "2.4rem" }}>⚽</span>}
                </div>
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
                      <p style={{ color: "#fff", fontSize: ".9rem", fontWeight: 800, margin: ".15rem 0 0" }}>{selectedPlayer.dni || "NO REGISTRADO"}</p>
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
      </section>
    </div>
  );
}
