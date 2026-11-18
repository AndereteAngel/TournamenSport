import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

const panelStyle = {
  background: "#080808",
  color: "#fff",
  border: "1px solid #b5122a",
  borderRadius: "12px",
  padding: "1rem",
};
const buttonStyle = {
  border: "1px solid #fff",
  borderRadius: "8px",
  padding: ".65rem .9rem",
  background: "#b5122a",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};

export function ReferenteTorneoSolicitudes({ tournaments = [], currentUser, onBack, onSubmitted }) {
  const [participations, setParticipations] = useState([]);
  const [turns, setTurns] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    const [turnsResult, requestsResult, participationsResult] = await Promise.all([
      supabase.rpc("get_fefutin_tournament_turns", { p_tournament_id: null }),
      supabase.rpc("get_fefutin_my_tournament_requests"),
      supabase.rpc("get_fefutin_my_turn_participations"),
    ]);
    const failed = [turnsResult, requestsResult, participationsResult].find((result) => result.error);
    if (failed) {
      console.error("Error al consultar turnos y participaciones:", failed.error);
      setError(failed.error.message || "No se pudieron cargar los turnos y las solicitudes.");
      setLoading(false);
      return;
    }
    setTurns(turnsResult.data || []);
    setRequests(requestsResult.data || []);
    setParticipations(participationsResult.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const requestTurn = async (turn) => {
    if (sendingId || !turn?.turn_id || !turn?.tournament_id) return;
    setSendingId(turn.turn_id);
    setError("");
    setNotice("");
    const { error: requestError } = await supabase.rpc("submit_fefutin_club_tournament_request", {
      p_tournament_id: turn.tournament_id,
      p_turn_id: turn.turn_id,
    });
    if (requestError) {
      console.error("Error al solicitar participación en turno:", requestError);
      setError(requestError.message || "No se pudo enviar la solicitud.");
    } else {
      setNotice(`Solicitud enviada para ${turn.tournament_title || "la rama"} · ${turn.turno}. Incluye solamente las categorías habilitadas de este turno y quedó pendiente de aprobación.`);
      await loadData();
      onSubmitted?.();
    }
    setSendingId(null);
  };

  return (
    <div className="tc-form-screen" style={{ width: "100%", maxWidth: "100%", padding: 0, minHeight: "70vh", boxSizing: "border-box" }}>
      <section className="cr-card" style={{ ...panelStyle, width: "100%", boxSizing: "border-box", padding: "clamp(1rem, 3vw, 2rem)" }}>
        <button type="button" className="tc-form-back" onClick={onBack}>← Volver al inicio</button>
        <p style={{ color: "#b5122a", fontWeight: 900, letterSpacing: ".12em", fontSize: ".72rem", margin: "1.25rem 0 .35rem" }}>ÁREA DEL REFERENTE</p>
        <h2 className="cr-title" style={{ color: "#fff", margin: "0 0 .5rem" }}>SOLICITAR PARTICIPACIÓN</h2>
        <p style={{ color: "#d1d5db", lineHeight: 1.55, marginTop: 0 }}>
          Elegí la rama y el turno en el que querés participar. La solicitud incluye todas las categorías habilitadas de ese turno, sin inscribir automáticamente al club en el otro.
        </p>
        {error && <p role="alert" style={{ color: "#fecaca", background: "#450a0a", border: "1px solid #b5122a", borderRadius: "8px", padding: ".75rem" }}>{error}</p>}
        {notice && <p role="status" style={{ color: "#bbf7d0", background: "#052e16", border: "1px solid #166534", borderRadius: "8px", padding: ".75rem" }}>{notice}</p>}

        <section style={{ ...panelStyle, borderColor: "#444", marginTop: "1rem" }}>
          <h3 style={{ color: "#fff", margin: 0 }}>RAMAS Y TURNOS DISPONIBLES</h3>
          <p style={{ color: "#aaa", fontSize: ".82rem", margin: ".3rem 0 0" }}>
            Cada turno tiene su inscripción y sus categorías independientes.
          </p>
          {loading ? <p style={{ color: "#ccc" }}>Cargando ramas y turnos...</p> : (
            <div style={{ display: "grid", gap: ".85rem", width: "100%", marginTop: "1rem" }}>
              {tournaments.map((tournament) => {
                const tournamentTurns = turns.filter((turn) => String(turn.tournament_id) === String(tournament.id));
                if (!tournamentTurns.length) return null;
                return (
                  <article key={tournament.id} style={{ display: "grid", gap: ".65rem", padding: ".9rem", border: "1px solid #444", borderRadius: "9px", background: "#111", minWidth: 0 }}>
                    <strong style={{ color: "#fff", display: "block", overflowWrap: "anywhere" }}>{tournament.title || "Torneo de rama"}</strong>
                    <div style={{ display: "grid", gap: ".6rem" }}>
                      {tournamentTurns.map((turn) => {
                        const participation = participations.find((item) => String(item.turn_id) === String(turn.turn_id));
                        const request = requests.find((item) => String(item.turn_id) === String(turn.turn_id) && item.status === "pendiente");
                        const isLinked = participation?.status === "aprobado";
                        const isPending = Boolean(request) || participation?.status === "pendiente";
                        const categoryNames = (turn.categories || [])
                          .filter((category) => category.status === "inscripcion")
                          .map((category) => category.name);
                        const canRequest = turn.turn_status === "inscripcion" && categoryNames.length > 0;
                        return (
                          <div key={turn.turn_id} style={{ display: "grid", gap: ".55rem", padding: ".8rem", border: "1px solid #5b2630", borderRadius: "8px", background: "#171217" }}>
                            <div>
                              <strong style={{ color: "#ffb3bf", display: "block" }}>{turn.turno}</strong>
                              <span style={{ color: "#ddd", display: "block", fontSize: ".82rem", marginTop: ".25rem" }}>
                                {categoryNames.length ? categoryNames.join(" · ") : "No hay categorías abiertas para inscripción"}
                              </span>
                            </div>
                            {isLinked ? (
                              <span style={{ display: "inline-flex", width: "100%", boxSizing: "border-box", justifyContent: "center", color: "#86efac", background: "#052e16", border: "1px solid #166534", borderRadius: "7px", padding: ".7rem", fontWeight: 900, fontSize: ".8rem" }}>
                                ✓ INSCRIPTO EN {turn.turno.toLocaleUpperCase("es")}
                              </span>
                            ) : isPending ? (
                              <span style={{ display: "inline-flex", width: "100%", boxSizing: "border-box", justifyContent: "center", color: "#fde68a", background: "#422006", border: "1px solid #a16207", borderRadius: "7px", padding: ".7rem", fontWeight: 900, fontSize: ".8rem", textAlign: "center" }}>
                                SOLICITUD PENDIENTE · {turn.turno.toLocaleUpperCase("es")}
                              </span>
                            ) : (
                              <button
                                type="button"
                                style={{ ...buttonStyle, display: "block", width: "100%", minHeight: "44px", boxSizing: "border-box", fontSize: ".86rem", opacity: canRequest ? 1 : .55 }}
                                disabled={Boolean(sendingId) || !canRequest}
                                onClick={() => requestTurn(turn)}
                              >
                                {sendingId === turn.turn_id ? "ENVIANDO..." : `SOLICITAR INSCRIPCIÓN · ${turn.turno.toLocaleUpperCase("es")}`}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
              {!turns.some((turn) => tournaments.some((tournament) => String(tournament.id) === String(turn.tournament_id))) && (
                <p style={{ color: "#aaa", marginBottom: 0 }}>Todavía no hay turnos configurados para las ramas disponibles.</p>
              )}
            </div>
          )}
        </section>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
          <button type="button" className="tc-form-back" onClick={loadData} disabled={loading}>↻ Actualizar</button>
        </div>
      </section>
    </div>
  );
}

export function FefutinClubTournamentRequests({ onChanged }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const [error, setError] = useState("");

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: loadError } = await supabase.rpc("get_fefutin_pending_club_tournament_requests");
    if (loadError) {
      console.error("Error al cargar solicitudes de participación:", loadError);
      setError(loadError.message || "No se pudieron cargar las solicitudes.");
      setRequests([]);
    } else setRequests(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  const decideRequest = async (request, approve) => {
    if (processingId) return;
    const action = approve ? "approve" : "reject";
    const confirmed = window.confirm(
      approve
        ? `¿Aprobar la participación de ${request.club_name} en "${request.tournament_title}" · ${request.turno || "turno sin identificar"}?`
        : `¿Desestimar la solicitud de ${request.club_name} para "${request.tournament_title}" · ${request.turno || "turno sin identificar"}?`
    );
    if (!confirmed) return;
    setProcessingId(request.id);
    setError("");
    const { error: decisionError } = await supabase.rpc("decide_fefutin_club_tournament_request", {
      p_request_id: request.id,
      p_approve: approve,
    });
    if (decisionError) {
      console.error("Error al resolver solicitud de participación:", decisionError);
      setError(decisionError.message || "No se pudo resolver la solicitud.");
    } else {
      await loadRequests();
      onChanged?.();
    }
    setProcessingId(null);
  };

  return (
    <div style={{ borderTop: "1px solid #3a3a3a", marginTop: "1.75rem", paddingTop: "1.4rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".75rem", flexWrap: "wrap", marginBottom: ".9rem" }}>
        <div>
          <h3 style={{ color: "#fff", margin: 0 }}>SOLICITUDES DE PARTICIPACIÓN EN TORNEOS</h3>
          <p style={{ color: "#aaa", fontSize: ".82rem", margin: ".3rem 0 0" }}>Revisá y habilitá la participación de clubes que ya están registrados.</p>
        </div>
        <button type="button" className="tc-form-back" onClick={loadRequests} disabled={loading}>↻ Actualizar solicitudes</button>
      </div>
      {error && <p role="alert" style={{ color: "#fecaca", background: "#450a0a", border: "1px solid #b5122a", borderRadius: "8px", padding: ".75rem" }}>{error}</p>}
      {loading ? <p style={{ color: "#ddd" }}>Cargando solicitudes...</p> : requests.length === 0 ? (
        <p style={{ color: "#aaa", padding: ".5rem 0" }}>No hay solicitudes de participación pendientes.</p>
      ) : (
        <div style={{ display: "grid", gap: ".75rem" }}>
          {requests.map((request) => (
            <article key={request.id} style={{ border: "1px solid #b5122a", borderRadius: "10px", background: "#111", padding: ".9rem" }}>
              <strong style={{ color: "#fff", display: "block" }}>{request.club_name}</strong>
              <span style={{ color: "#ccc", display: "block", fontSize: ".8rem", marginTop: ".2rem" }}>Referente: {request.referente_name || "Sin nombre"} · {request.referente_email || "Sin email"}</span>
              <div style={{ margin: ".7rem 0", padding: ".7rem", background: "#1b1b1b", borderRadius: "8px" }}>
                <strong style={{ color: "#ffb3bf" }}>{request.tournament_title}</strong>
                <span style={{ display: "block", color: "#ffb3bf", fontSize: ".82rem", marginTop: ".2rem" }}>{request.turno || "Turno sin identificar"}</span><span style={{ display: "block", color: "#ddd", fontSize: ".78rem", marginTop: ".2rem" }}>{request.category_label}</span>
              </div>
              <small style={{ color: "#aaa" }}>Solicitada: {request.created_at ? new Date(request.created_at).toLocaleString("es-AR") : "—"}</small>
              <div style={{ display: "flex", gap: ".55rem", flexWrap: "wrap", marginTop: ".8rem" }}>
                <button type="button" className="cr-btn-gold" disabled={Boolean(processingId)} onClick={() => decideRequest(request, true)}>{processingId === request.id ? "PROCESANDO..." : "APROBAR PARTICIPACIÓN"}</button>
                <button type="button" className="tc-form-back" disabled={Boolean(processingId)} onClick={() => decideRequest(request, false)}>Desestimar</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
