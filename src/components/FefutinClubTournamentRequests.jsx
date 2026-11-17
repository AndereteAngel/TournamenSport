import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    const [teamsResult, requestsResult] = await Promise.all([
      supabase.rpc("get_fefutin_my_teams"),
      supabase.rpc("get_fefutin_my_tournament_requests"),
    ]);
    if (teamsResult.error || requestsResult.error) {
      const loadError = teamsResult.error || requestsResult.error;
      console.error("Error al consultar participaciones del club:", loadError);
      setError(loadError.message || "No se pudieron cargar las solicitudes del club.");
      setLoading(false);
      return;
    }
    setParticipations(teamsResult.data || []);
    setRequests(requestsResult.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const linkedTournamentIds = useMemo(
    () => new Set(participations.map((item) => item.tournament_id)),
    [participations]
  );
  const pendingTournamentIds = useMemo(
    () => new Set(requests
      .filter((item) => item.status === "pendiente")
      .map((item) => item.tournament_id)),
    [requests]
  );

  const requestTournament = async (tournament) => {
    if (sendingId || !tournament?.id) return;
    setSendingId(tournament.id);
    setError("");
    setNotice("");
    const { error: requestError } = await supabase.rpc("submit_fefutin_club_tournament_request", {
      p_tournament_id: tournament.id,
      p_category_label: "TODA LA TIRA",
    });
    if (requestError) {
      console.error("Error al solicitar participación en torneo:", requestError);
      setError(requestError.message || "No se pudo enviar la solicitud.");
    } else {
      setNotice(`Solicitud enviada para ${tournament.title || "el torneo"}. Incluye todas las categorías de la tira y quedó pendiente de aprobación.`);
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
          Tu club ya está registrado en FEFUTIN. Elegí un nuevo torneo para solicitar participar. No necesitás volver a cargar los datos del club ni los jugadores.
        </p>
        {error && <p role="alert" style={{ color: "#fecaca", background: "#450a0a", border: "1px solid #b5122a", borderRadius: "8px", padding: ".75rem" }}>{error}</p>}
        {notice && <p role="status" style={{ color: "#bbf7d0", background: "#052e16", border: "1px solid #166534", borderRadius: "8px", padding: ".75rem" }}>{notice}</p>}

        <section style={{ ...panelStyle, borderColor: "#444", marginTop: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".75rem", flexWrap: "wrap" }}>
            <div>
              <h3 style={{ color: "#fff", margin: 0 }}>TORNEOS CREADOS</h3>
              <p style={{ color: "#aaa", fontSize: ".82rem", margin: ".3rem 0 0" }}>
                Cada inscripción incluye todas las categorías habilitadas del torneo.
              </p>
            </div>
          </div>
          {loading ? <p style={{ color: "#ccc" }}>Cargando torneos...</p> : tournaments.length === 0 ? (
            <p style={{ color: "#aaa", marginBottom: 0 }}>Todavía no hay torneos creados.</p>
          ) : (
            <div style={{ display: "grid", gap: ".7rem", width: "100%", marginTop: "1rem" }}>
              {tournaments.map((tournament) => {
                const isLinked = linkedTournamentIds.has(tournament.id);
                const isPending = pendingTournamentIds.has(tournament.id);
                const gameSummary = String(tournament.game || "").split(" · ").filter(Boolean);
                const divisionSummary = [...new Set(gameSummary.filter((part) =>
                  ["Baby fútbol", "Infantil", "Femenino", "Sénior", "Mayores", "Futsal"].includes(part)
                ))].join(" · ");
                return (
                  <article key={tournament.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: ".65rem", padding: ".9rem", border: "1px solid #444", borderRadius: "9px", background: "#111", minWidth: 0 }}>
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ color: "#fff", display: "block", overflowWrap: "anywhere" }}>{tournament.title || "Torneo sin nombre"}</strong>
                      <span style={{ color: "#d1d5db", display: "block", fontSize: ".9rem", marginTop: ".25rem" }}>
                        {divisionSummary ? `${divisionSummary} · ` : ""}Participación en todas las categorías
                      </span>
                    </div>
                    <div style={{ width: "100%", minWidth: 0 }}>
                      {isLinked ? (
                        <span style={{ display: "inline-flex", width: "100%", boxSizing: "border-box", justifyContent: "center", color: "#86efac", background: "#052e16", border: "1px solid #166534", borderRadius: "7px", padding: ".75rem", fontWeight: 900, fontSize: ".8rem" }}>
                          ✓ INSCRIPTO EN EL TORNEO
                        </span>
                      ) : isPending ? (
                        <span style={{ display: "inline-flex", width: "100%", boxSizing: "border-box", justifyContent: "center", color: "#fde68a", background: "#422006", border: "1px solid #a16207", borderRadius: "7px", padding: ".75rem", fontWeight: 900, fontSize: ".8rem", textAlign: "center" }}>
                          SOLICITUD PENDIENTE
                        </span>
                      ) : (
                        <button
                          type="button"
                          style={{ ...buttonStyle, display: "block", width: "100%", minHeight: "46px", boxSizing: "border-box", fontSize: ".9rem" }}
                          disabled={Boolean(sendingId)}
                          onClick={() => requestTournament(tournament)}
                        >
                          {sendingId === tournament.id ? "ENVIANDO..." : "INSCRIBIRSE"}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          <p style={{ color: "#aaa", fontSize: ".78rem", marginBottom: 0, marginTop: ".8rem" }}>
            Con una sola aprobación, tu club queda inscripto en toda la tira de categorías.
          </p>
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
        ? `¿Aprobar la participación de ${request.club_name} en "${request.tournament_title}"?`
        : `¿Desestimar la solicitud de ${request.club_name} para "${request.tournament_title}"?`
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
                <span style={{ display: "block", color: "#ddd", fontSize: ".82rem", marginTop: ".2rem" }}>{request.category_label}</span>
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
