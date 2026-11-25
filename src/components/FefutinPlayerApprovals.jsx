import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

const STATUS_OPTIONS = [
  { value: "todos", label: "Todos los estados" },
  { value: "pendiente_alta", label: "Pendientes de habilitación" },
  { value: "habilitado", label: "Activos · Habilitados" },
  { value: "no_habilitado", label: "No habilitados" },
  { value: "rechazado", label: "Rechazados" },
];

const getStatus = (player) => {
  if (player.approval_status === "pendiente") return "pendiente_alta";
  if (player.approval_status === "rechazado") return "rechazado";
  if (player.approval_status === "aprobado") {
    if (player.carnet_status === "no_habilitado") return "no_habilitado";
    return "habilitado";
  }
  return "pendiente_alta";
};

const statusLabel = (status) => ({
  pendiente_alta: "PENDIENTE DE HABILITACIÓN",
  habilitado: "ACTIVO · HABILITADO",
  no_habilitado: "NO HABILITADO",
  rechazado: "RECHAZADO",
}[status] || "SIN ESTADO");

const statusColor = (status) => ({
  pendiente_alta: "#fcd34d",
  habilitado: "#86efac",
  no_habilitado: "#fca5a5",
  rechazado: "#fca5a5",
}[status] || "#ddd");

export function FefutinPlayerApprovals() {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  // El buzón abre mostrando todo el historial, no solamente los pendientes.
  const [statusFilter, setStatusFilter] = useState("pendiente_alta");
  const [clubFilter, setClubFilter] = useState("todos");
  const [categoryFilter, setCategoryFilter] = useState("todas");
  const [search, setSearch] = useState("");
  const [dniDocuments, setDniDocuments] = useState({});

  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError("");
    try {
      const { data, error: rpcError } = await supabase.rpc("get_fefutin_player_registry_overview");
    if (rpcError) {
      console.error("Error al cargar jugadores FEFUTIN:", rpcError);
      setError(rpcError.message || "No se pudo cargar el registro permanente de jugadores.");
      setPlayers([]);
    } else {
      const rows = (data || []).map((player) => ({
        ...player,
        player_entry_id: player.player_entry_id,
        tournament_title: player.tournament_title || "PLANTEL PERMANENTE",
      }));
      setPlayers(rows);
    }
    } catch (loadError) {
      console.error("Error inesperado al cargar jugadores FEFUTIN:", loadError);
      setError(loadError?.message || "No se pudo cargar la lista de jugadores.");
      setPlayers([]);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const clubs = useMemo(
    () => [...new Set(players.map((p) => p.club_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")),
    [players]
  );
  const categories = useMemo(
    () => [...new Set(players.map((p) => p.category_label).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")),
    [players]
  );

  const filteredPlayers = useMemo(() => players.filter((player) => {
    const status = getStatus(player);
    const term = search.trim().toLocaleLowerCase("es");
    const matchesSearch = !term || [
      player.first_name, player.last_name, player.dni, player.carnet_number,
      player.club_name, player.tournament_title,
    ].some((value) => String(value || "").toLocaleLowerCase("es").includes(term));

    return (statusFilter === "todos" || status === statusFilter)
      && (clubFilter === "todos" || player.club_name === clubFilter)
      && (categoryFilter === "todas" || player.category_label === categoryFilter)
      && matchesSearch;
  }), [players, statusFilter, clubFilter, categoryFilter, search]);

  // Una tarjeta por torneo + equipo + categoría; los jugadores quedan agrupados dentro.
  const tournamentCards = useMemo(() => {
    const groups = new Map();
    filteredPlayers.forEach((player) => {
      const key = [
        player.club_id || player.club_name || "sin-club",
        player.category_label || "sin-categoria",
      ].join("::");

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          tournamentTitle: "PLANTEL PERMANENTE",
          clubName: player.club_name || "Equipo sin nombre",
          category: player.category_label || "Categoría sin especificar",
          players: [],
        });
      }
      groups.get(key).players.push(player);
    });

    return [...groups.values()].sort((a, b) =>
      a.tournamentTitle.localeCompare(b.tournamentTitle, "es")
      || a.clubName.localeCompare(b.clubName, "es")
      || a.category.localeCompare(b.category, "es")
    );
  }, [filteredPlayers]);

  const viewDniDocuments = async (player) => {
    setError("");
    const { data, error: rpcError } = await supabase.rpc("get_fefutin_player_dni_documents", {
      p_player_entry_id: player.player_entry_id,
    });
    if (rpcError) {
      setError(rpcError.message || "No se pudieron consultar los documentos del DNI.");
      return;
    }
    const documents = data?.[0];
    if (!documents?.dni_front_path || !documents?.dni_back_path) {
      setError("Esta inscripción todavía no tiene cargados los dos lados del DNI.");
      return;
    }
    const [front, back] = await Promise.all([
      supabase.storage.from("fefutin-player-dni").createSignedUrl(documents.dni_front_path, 300),
      supabase.storage.from("fefutin-player-dni").createSignedUrl(documents.dni_back_path, 300),
    ]);
    if (front.error || back.error) {
      setError(front.error?.message || back.error?.message || "No se pudieron abrir los documentos.");
      return;
    }
    setDniDocuments((current) => ({
      ...current,
      [player.player_entry_id]: { front: front.data.signedUrl, back: back.data.signedUrl },
    }));
  };

  const decide = async (player) => {
    setWorkingId(player.player_entry_id);
    setError("");
    setMessage("");

    const { data: charge, error: chargeError } = await supabase
      .from("fefutin_player_charges")
      .select("id, amount, status")
      .eq("roster_player_id", player.player_entry_id)
      .maybeSingle();

    if (chargeError || !charge) {
      setError(chargeError?.message || "No encontramos el cargo de fichaje de este jugador. No se puede aprobar hasta revisar la deuda.");
      setWorkingId(null);
      return;
    }

    let rpcName = "decide_fefutin_player";
    let rpcArgs = {
      p_player_entry_id: player.player_entry_id,
      p_approve: true,
    };

    if (charge.status !== "pagado") {
      const amount = new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: charge.currency || "ARS",
        maximumFractionDigits: 0,
      }).format(Number(charge.amount || 0));
      const reason = window.prompt(
        `El fichaje de este jugador todavía adeuda ${amount}. Si decidís aprobarlo por excepción, la deuda seguirá pendiente. Indicá el motivo:`
      );
      if (reason === null) {
        setWorkingId(null);
        return;
      }
      if (reason.trim().length < 5) {
        setError("La excepción necesita un motivo de al menos 5 caracteres.");
        setWorkingId(null);
        return;
      }
      if (!window.confirm(`¿Confirmás aprobar por excepción? La deuda de ${amount} NO se cancela y seguirá pendiente para el club.`)) {
        setWorkingId(null);
        return;
      }
      rpcName = "decide_fefutin_player_with_exception";
      rpcArgs = {
        p_player_entry_id: player.player_entry_id,
        p_reason: reason.trim(),
      };
    } else if (!window.confirm(`¿Confirmás habilitar a ${player.first_name} ${player.last_name}? El fichaje está saldado; se generará su carnet FEFUTIN.`)) {
      setWorkingId(null);
      return;
    }

    const { data, error: rpcError } = await supabase.rpc(rpcName, rpcArgs);

    if (rpcError) {
      console.error("Error al activar jugador:", rpcError);
      setError(rpcError.message || "No se pudo activar al jugador.");
    } else {
      setPlayers((current) => current.map((item) =>
        item.player_entry_id === player.player_entry_id
          ? { ...item, approval_status: "aprobado", carnet_number: data, carnet_status: "habilitado" }
          : item
      ));
      setMessage(
        charge.status === "pagado"
          ? `${player.first_name} ${player.last_name} quedó ACTIVADO y HABILITADO. El fichaje está saldado y se generó su carnet FEFUTIN.`
          : `${player.first_name} ${player.last_name} quedó ACTIVADO por excepción. La deuda de fichaje sigue pendiente y quedó registrado el motivo.`
      );
    }
    setWorkingId(null);
  };

  const markNoHabilitado = async (player) => {
    const reason = window.prompt(`Motivo para marcar NO HABILITADO a ${player.first_name} ${player.last_name}:`);
    if (reason === null) return;
    if (!reason.trim()) {
      setError("Tenés que indicar el motivo de la sanción.");
      return;
    }
    if (!window.confirm(`¿Confirmás que ${player.first_name} ${player.last_name} quedará NO HABILITADO? Se conservarán su inscripción y carnet.`)) return;

    setWorkingId(player.player_entry_id);
    setError("");
    setMessage("");
    const { error: rpcError } = await supabase.rpc("set_fefutin_player_no_habilitado", {
      p_player_entry_id: player.player_entry_id,
      p_reason: reason.trim(),
    });

    if (rpcError) {
      console.error("Error al registrar sanción del jugador:", rpcError);
      setError(rpcError.message || "No se pudo registrar la sanción.");
    } else {
      setPlayers((current) => current.map((item) =>
        item.player_entry_id === player.player_entry_id
          ? { ...item, carnet_status: "no_habilitado" }
          : item
      ));
      setMessage(`${player.first_name} ${player.last_name} quedó NO HABILITADO. Su carnet y su historial se conservaron.`);
      await load();
    }
    setWorkingId(null);
  };

  const fieldStyle = {
    width: "100%", minWidth: 0, boxSizing: "border-box", padding: ".7rem .8rem",
    borderRadius: "8px", border: "1px solid #666", background: "#fff", color: "#171717",
    fontSize: ".88rem",
  };

  return (
    <section style={{ width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box", marginTop: "1.5rem", borderTop: "1px solid #3a3a3a", paddingTop: "1.3rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <div>
          <h3 style={{ color: "#fff", margin: 0 }}>BUZÓN DE SOLICITUDES Y ACTIVACIONES</h3>
          <p style={{ color: "#aaa", fontSize: ".82rem", margin: ".3rem 0 0" }}>
            Todos los llamados quedan registrados. Al habilitar un jugador, se genera su carnet y queda habilitado para competir.
          </p>
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
        <input aria-label="Buscar jugador" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar jugador, DNI o club..." style={fieldStyle} />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "#ddd", fontSize: ".82rem", margin: "0 0 .7rem" }}>
        <span>LLAMADOS EN EL BUZÓN</span>
        <strong>{loading ? "…" : filteredPlayers.length}</strong>
      </div>

      {loading ? <p style={{ color: "#ddd" }}>Cargando solicitudes...</p> :
        tournamentCards.length === 0 ? (
          <p style={{ color: "#aaa", border: "1px solid #444", borderRadius: "9px", padding: "1.2rem", textAlign: "center" }}>
            No hay llamados para los filtros seleccionados.
          </p>
        ) : (
          <div style={{ display: "grid", gap: ".9rem" }}>
            {tournamentCards.map((card) => {
              const counts = card.players.reduce((acc, player) => {
                const status = getStatus(player);
                acc[status] = (acc[status] || 0) + 1;
                return acc;
              }, {});
              return (
                <article key={card.key} style={{ border: "1px solid #555", borderTop: "3px solid #b5122a", borderRadius: "12px", background: "#202020", padding: ".9rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: ".7rem", flexWrap: "wrap", marginBottom: ".8rem" }}>
                    <div>
                      <span style={{ color: "#ffb3bf", fontSize: ".68rem", fontWeight: 800, letterSpacing: ".08em" }}>PLANTEL PERMANENTE</span>
                      <h4 style={{ color: "#fff", margin: ".15rem 0", fontSize: "1rem" }}>{card.tournamentTitle}</h4>
                      <p style={{ color: "#ccc", margin: 0, fontSize: ".78rem" }}>{card.clubName} · {card.category}</p>
                    </div>
                    <div style={{ display: "flex", gap: ".35rem", flexWrap: "wrap" }}>
                      <span style={{ color: "#ddd", background: "#333", borderRadius: "20px", padding: ".3rem .55rem", fontSize: ".7rem" }}>{card.players.length} jugador{card.players.length === 1 ? "" : "es"}</span>
                      {Object.entries(counts).map(([status, count]) => (
                        <span key={status} style={{ color: statusColor(status), background: "#111", border: "1px solid #444", borderRadius: "20px", padding: ".3rem .55rem", fontSize: ".68rem" }}>
                          {count} {status === "pendiente_alta" ? "por activar" : status === "habilitado" ? "habilitados" : status === "rechazado" ? "rechazados" : "no habilitados"}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: ".5rem" }}>
                    {card.players.map((player) => {
                      const status = getStatus(player);
                      const canActivate = status === "pendiente_alta";
                      const busy = workingId === player.player_entry_id;
                      return (
                        <div key={player.player_entry_id} style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: ".7rem", border: "1px solid #454545", borderRadius: "8px", background: "#151515", padding: ".7rem .8rem", boxSizing: "border-box" }}>
                          <div style={{ minWidth: 0, color: "#fff" }}>
                            <strong style={{ display: "block", fontSize: ".9rem" }}>{player.last_name}, {player.first_name}</strong>
                            <span style={{ display: "block", color: "#bbb", fontSize: ".74rem", marginTop: ".15rem" }}>
                              DNI: {player.dni || "—"}{player.carnet_number ? ` · Carnet: ${player.carnet_number}` : ""}
                            </span>
                            <span style={{ display: "inline-block", marginTop: ".35rem", color: statusColor(status), fontSize: ".68rem", fontWeight: 800 }}>
                              {statusLabel(status)}
                            </span>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: ".55rem", marginTop: ".45rem" }}>
                              <button type="button" onClick={() => viewDniDocuments(player)} style={{ border: "1px solid #777", borderRadius: "6px", background: "#252525", color: "#fff", padding: ".35rem .55rem", fontSize: ".66rem", fontWeight: 800, cursor: "pointer" }}>CONSULTAR DNI</button>
                              {dniDocuments[player.player_entry_id] && <>
                                <a href={dniDocuments[player.player_entry_id].front} target="_blank" rel="noreferrer" style={{ color: "#93c5fd", fontSize: ".7rem", alignSelf: "center" }}>Ver frente</a>
                                <a href={dniDocuments[player.player_entry_id].back} target="_blank" rel="noreferrer" style={{ color: "#93c5fd", fontSize: ".7rem", alignSelf: "center" }}>Ver dorso</a>
                              </>}
                            </div>
                          </div>
                          {canActivate ? (
                            <button type="button" className="cr-btn-gold" disabled={busy} onClick={() => decide(player)} style={{ whiteSpace: "nowrap", padding: ".55rem .75rem", fontSize: ".75rem" }}>
                              {busy ? "Procesando..." : "ACTIVAR"}
                            </button>
                          ) : status === "habilitado" ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => markNoHabilitado(player)}
                              style={{ whiteSpace: "nowrap", padding: ".5rem .65rem", fontSize: ".7rem", border: "1px solid #b91c1c", borderRadius: "7px", background: "#351015", color: "#fecaca", fontWeight: 800, cursor: busy ? "wait" : "pointer" }}
                            >
                              {busy ? "Procesando..." : "NO HABILITAR"}
                            </button>
                          ) : (
                            <span style={{ color: "#888", fontSize: ".68rem", textAlign: "right" }}>En buzón</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
        )}
    </section>
  );
}
