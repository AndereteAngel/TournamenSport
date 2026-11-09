import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

const STATUS_OPTIONS = [
  { value: "todos", label: "Todos los estados" },
  { value: "pendiente_alta", label: "Pendientes de activar" },
  { value: "activo_pendiente", label: "Activos · Pendientes" },
  { value: "habilitado", label: "Activos · Habilitados" },
  { value: "no_habilitado", label: "No habilitados" },
  { value: "rechazado", label: "Rechazados" },
];

const getStatus = (player) => {
  if (player.approval_status === "pendiente") return "pendiente_alta";
  if (player.approval_status === "rechazado") return "rechazado";
  if (player.approval_status === "aprobado") {
    if (player.carnet_status === "habilitado") return "habilitado";
    if (player.carnet_status === "no_habilitado") return "no_habilitado";
    return "activo_pendiente";
  }
  return "pendiente_alta";
};

const statusLabel = (status) => ({
  pendiente_alta: "PENDIENTE DE ACTIVAR",
  activo_pendiente: "ACTIVO · PENDIENTE",
  habilitado: "ACTIVO · HABILITADO",
  no_habilitado: "NO HABILITADO",
  rechazado: "RECHAZADO",
}[status] || "SIN ESTADO");

export function FefutinPlayerApprovals() {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [statusFilter, setStatusFilter] = useState("pendiente_alta");
  const [clubFilter, setClubFilter] = useState("todos");
  const [categoryFilter, setCategoryFilter] = useState("todas");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: rpcError } = await supabase.rpc("get_fefutin_my_teams");
    if (rpcError) {
      console.error("Error al cargar jugadores FEFUTIN:", rpcError);
      setError(rpcError.message || "No se pudo cargar la lista de jugadores.");
      setPlayers([]);
    } else {
      const rows = (data || []).flatMap((team) => {
        let teamPlayers = team.players || [];
        if (typeof teamPlayers === "string") {
          try { teamPlayers = JSON.parse(teamPlayers); } catch { teamPlayers = []; }
        }
        return (Array.isArray(teamPlayers) ? teamPlayers : []).map((player) => ({
          ...player,
          player_entry_id: player.id,
          club_id: team.club_id,
          club_name: team.club_name,
          tournament_id: team.tournament_id,
          tournament_title: team.tournament_title,
          category_label: team.category_label,
        }));
      });
      setPlayers(rows);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const clubs = useMemo(() => [...new Set(players.map((p) => p.club_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")), [players]);
  const categories = useMemo(() => [...new Set(players.map((p) => p.category_label).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")), [players]);

  const filteredPlayers = useMemo(() => players.filter((player) => {
    const status = getStatus(player);
    const term = search.trim().toLocaleLowerCase("es");
    const matchesSearch = !term || [player.first_name, player.last_name, player.dni, player.carnet_number]
      .some((value) => String(value || "").toLocaleLowerCase("es").includes(term));
    return (statusFilter === "todos" || status === statusFilter)
      && (clubFilter === "todos" || player.club_name === clubFilter)
      && (categoryFilter === "todas" || player.category_label === categoryFilter)
      && matchesSearch;
  }), [players, statusFilter, clubFilter, categoryFilter, search]);

  const decide = async (player) => {
    if (!window.confirm(`¿Confirmás activar a ${player.first_name} ${player.last_name}? Se generará su carnet FEFUTIN con estado PENDIENTE.`)) return;
    setWorkingId(player.player_entry_id);
    setError("");
    setMessage("");
    const { data, error: rpcError } = await supabase.rpc("decide_fefutin_player", {
      p_player_entry_id: player.player_entry_id,
      p_approve: true,
    });
    if (rpcError) {
      console.error("Error al activar jugador:", rpcError);
      setError(rpcError.message || "No se pudo activar al jugador.");
    } else {
      setMessage(`Jugador activado. Carnet asignado: ${data}. Estado: PENDIENTE DE VERIFICACIÓN.`);
      await load();
      // Refleja la aprobación en pantalla incluso si la consulta RPC devuelve datos desactualizados.
      setPlayers((current) => current.map((item) =>
        item.player_entry_id === player.player_entry_id
          ? { ...item, approval_status: "aprobado", carnet_number: data, carnet_status: "pendiente" }
          : item
      ));
    }
    setWorkingId(null);
  };

  const fieldStyle = {
    width: "100%", minWidth: 0, boxSizing: "border-box", padding: ".7rem .8rem",
    borderRadius: "8px", border: "1px solid #666", background: "#fff", color: "#171717",
    fontSize: ".88rem",
  };

  return (
    <section style={{ marginTop: "1.5rem", borderTop: "1px solid #3a3a3a", paddingTop: "1.3rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <div>
          <h3 style={{ color: "#fff", margin: 0 }}>ALTAS DE JUGADORES</h3>
          <p style={{ color: "#aaa", fontSize: ".82rem", margin: ".3rem 0 0" }}>Consultá y filtrá los estados de los jugadores y sus carnets.</p>
        </div>
        <button type="button" className="tc-form-back" onClick={load} disabled={loading}>↻ Actualizar</button>
      </div>

      {error && <p role="alert" style={{ color: "#fecaca", background: "#391018", padding: ".7rem", borderRadius: "8px" }}>{error}</p>}
      {message && <p role="status" style={{ color: "#bbf7d0", background: "#052e16", padding: ".7rem", borderRadius: "8px" }}>{message}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))", gap: ".65rem", margin: "1rem 0" }}>
        <select aria-label="Filtrar por estado" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={fieldStyle}>
          {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select aria-label="Filtrar por equipo" value={clubFilter} onChange={(e) => setClubFilter(e.target.value)} style={fieldStyle}>
          <option value="todos">Todos los equipos</option>
          {clubs.map((club) => <option key={club} value={club}>{club}</option>)}
        </select>
        <select aria-label="Filtrar por categoría" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={fieldStyle}>
          <option value="todas">Todas las categorías</option>
          {categories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
        <input aria-label="Buscar jugador" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar jugador o DNI..." style={fieldStyle} />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", color: "#ddd", fontSize: ".82rem", margin: "0 0 .55rem" }}>
        <span>JUGADORES</span><strong>{loading ? "…" : filteredPlayers.length}</strong>
      </div>

      {loading ? <p style={{ color: "#ddd" }}>Cargando jugadores...</p> :
        filteredPlayers.length === 0 ? <p style={{ color: "#aaa", border: "1px solid #444", borderRadius: "9px", padding: "1.2rem", textAlign: "center" }}>No hay jugadores para los filtros seleccionados.</p> :
        <div style={{ display: "grid", gap: ".45rem" }}>
          {filteredPlayers.map((player) => {
            const status = getStatus(player);
            const canActivate = status === "pendiente_alta";
            const busy = workingId === player.player_entry_id;
            return (
              <article key={player.player_entry_id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: ".7rem", border: "1px solid #4a4a4a", borderLeft: "3px solid #b5122a", borderRadius: "8px", background: "#151515", padding: ".7rem .8rem" }}>
                <div style={{ minWidth: 0, color: "#fff" }}>
                  <strong style={{ display: "block", fontSize: ".92rem" }}>{player.last_name}, {player.first_name}</strong>
                  <span style={{ display: "block", color: "#bbb", fontSize: ".76rem", marginTop: ".15rem" }}>DNI: {player.dni || "—"}{player.carnet_number ? ` · Carnet: ${player.carnet_number}` : ""}</span>
                  <span style={{ display: "block", color: "#ffb3bf", fontSize: ".76rem", marginTop: ".15rem" }}>{player.club_name || "Sin equipo"} · {player.category_label || "Sin categoría"}</span>
                  <span style={{ display: "inline-block", marginTop: ".35rem", color: status === "habilitado" ? "#86efac" : status === "no_habilitado" || status === "rechazado" ? "#fca5a5" : "#fcd34d", fontSize: ".68rem", fontWeight: 800 }}>{statusLabel(status)}</span>
                </div>
                {canActivate ? (
                  <button type="button" className="cr-btn-gold" disabled={busy} onClick={() => decide(player)} style={{ whiteSpace: "nowrap", padding: ".55rem .75rem", fontSize: ".75rem" }}>{busy ? "Procesando..." : "ACTIVAR"}</button>
                ) : <span style={{ color: "#888", fontSize: ".7rem", textAlign: "right" }}>—</span>}
              </article>
            );
          })}
        </div>}
    </section>
  );
}
