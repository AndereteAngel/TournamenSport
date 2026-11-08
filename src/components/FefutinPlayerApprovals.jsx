import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

export function FefutinPlayerApprovals() {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: rpcError } = await supabase.rpc("get_fefutin_pending_players");
    if (rpcError) {
      console.error("Error al cargar altas de jugadores:", rpcError);
      setError(rpcError.message || "No se pudieron cargar las altas pendientes.");
      setPlayers([]);
    } else {
      setPlayers(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const decide = async (player, approve) => {
    const action = approve ? "aprobar el alta" : "rechazar el alta";
    if (!window.confirm(`¿Confirmás ${action} de ${player.first_name} ${player.last_name}?${approve ? " Se asignará su carnet FEFUTIN automáticamente." : ""}`)) return;
    setWorkingId(player.player_entry_id);
    setError("");
    setMessage("");
    const { data, error: rpcError } = await supabase.rpc("decide_fefutin_player", {
      p_player_entry_id: player.player_entry_id,
      p_approve: approve,
    });
    if (rpcError) {
      console.error("Error al resolver alta:", rpcError);
      setError(rpcError.message || "No se pudo resolver el alta.");
    } else {
      setMessage(approve ? `Alta aprobada. Carnet asignado: ${data}` : "Alta rechazada.");
      await load();
    }
    setWorkingId(null);
  };

  const photoUrl = (path) => path
    ? supabase.storage.from("fefutin-player-photos").getPublicUrl(path).data.publicUrl
    : "";

  return (
    <section style={{ marginTop: "1.5rem", borderTop: "1px solid #3a3a3a", paddingTop: "1.3rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".75rem", flexWrap: "wrap" }}>
        <div>
          <h3 style={{ color: "#fff", margin: 0 }}>ALTAS DE JUGADORES</h3>
          <p style={{ color: "#aaa", fontSize: ".82rem", margin: ".3rem 0 0" }}>Revisá cada ficha. Al aprobarla se genera su carnet único FEFUTIN.</p>
        </div>
        <button type="button" className="tc-form-back" onClick={load} disabled={loading}>↻ Actualizar</button>
      </div>
      {error && <p role="alert" style={{ color: "#fecaca", background: "#391018", padding: ".7rem", borderRadius: "8px" }}>{error}</p>}
      {message && <p role="status" style={{ color: "#bbf7d0", background: "#052e16", padding: ".7rem", borderRadius: "8px" }}>{message}</p>}
      {loading ? <p style={{ color: "#ddd" }}>Cargando altas pendientes...</p> :
        players.length === 0 ? <p style={{ color: "#aaa" }}>No hay jugadores pendientes de aprobación.</p> :
        <div style={{ display: "grid", gap: ".8rem", marginTop: ".8rem" }}>
          {players.map((player) => (
            <article key={player.player_entry_id} style={{ display: "flex", gap: ".9rem", alignItems: "center", flexWrap: "wrap", border: "1px solid #b5122a", borderRadius: "10px", background: "#111", padding: ".9rem" }}>
              {photoUrl(player.photo_path) ? <img src={photoUrl(player.photo_path)} alt={`Foto de ${player.first_name} ${player.last_name}`} style={{ width: "88px", height: "108px", objectFit: "cover", borderRadius: "8px", background: "#222" }} /> :
                <div style={{ width: "88px", height: "108px", display: "grid", placeItems: "center", color: "#aaa", border: "1px dashed #666", borderRadius: "8px", fontSize: ".75rem" }}>Sin foto</div>}
              <div style={{ flex: "1 1 220px", minWidth: 0, color: "#fff" }}>
                <strong style={{ fontSize: "1rem" }}>{player.last_name}, {player.first_name}</strong>
                <div style={{ color: "#ddd", fontSize: ".82rem", marginTop: ".25rem" }}>DNI: {player.dni} · Nacimiento: {player.birth_date || "—"}</div>
                <div style={{ color: "#ddd", fontSize: ".82rem" }}>Camiseta: {player.jersey_number || "—"}</div>
                <div style={{ color: "#ffb3bf", fontSize: ".82rem", marginTop: ".35rem" }}>{player.club_name} · {player.tournament_title} · {player.category_label}</div>
                <span style={{ color: "#facc15", fontSize: ".72rem", fontWeight: 800 }}>PENDIENTE DE ALTA · SIN CARNET</span>
              </div>
              <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
                <button type="button" className="cr-btn-gold" disabled={workingId === player.player_entry_id} onClick={() => decide(player, true)}>{workingId === player.player_entry_id ? "Procesando..." : "Aprobar y generar carnet"}</button>
                <button type="button" className="tc-form-back" disabled={workingId === player.player_entry_id} onClick={() => decide(player, false)}>Rechazar</button>
              </div>
            </article>
          ))}
        </div>}
    </section>
  );
}
