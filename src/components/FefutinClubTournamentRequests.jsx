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
  const [requests, setRequests] = useState([]);
  const [participations, setParticipations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    const [requestsResult, participationsResult] = await Promise.all([
      supabase.rpc("fefutin_nuevas_mis_solicitudes"),
      supabase.rpc("fefutin_nuevas_mis_competencias"),
    ]);
    const failed = [requestsResult, participationsResult].find((result) => result.error);
    if (failed) {
      console.error("Error al consultar inscripciones del nuevo esquema:", failed.error);
      setError(failed.error.message || "No se pudieron cargar las inscripciones.");
      setLoading(false);
      return;
    }
    setRequests(requestsResult.data || []);
    setParticipations(participationsResult.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const requestTournament = async (tournament) => {
    if (sendingId || !tournament?.id) return;
    setSendingId(tournament.id);
    setError("");
    setNotice("");
    const { error: requestError } = await supabase.rpc("fefutin_nueva_solicitud_participacion", {
      p_torneo_id: tournament.id,
    });
    if (requestError) {
      console.error("Error al solicitar participación en el nuevo torneo:", requestError);
      setError(requestError.message || "No se pudo enviar la solicitud.");
    } else {
      setNotice(`Solicitud enviada para ${tournament.title || tournament.nombre || "el torneo"}. Incluye todas las categorías activas de esta rama y turno y quedó pendiente de aprobación.`);
      await loadData();
      onSubmitted?.();
    }
    setSendingId(null);
  };

  const normalizedTournaments = tournaments.filter((item) => item?.fefutinNewSchema);

  return (
    <div className="tc-form-screen" style={{ width: "100%", maxWidth: "100%", padding: 0, minHeight: "70vh", boxSizing: "border-box" }}>
      <section className="cr-card" style={{ ...panelStyle, width: "100%", boxSizing: "border-box", padding: "clamp(1rem, 3vw, 2rem)" }}>
        <button type="button" className="tc-form-back" onClick={onBack}>← Volver al inicio</button>
        <p style={{ color: "#b5122a", fontWeight: 900, letterSpacing: ".12em", fontSize: ".72rem", margin: "1.25rem 0 .35rem" }}>ÁREA DEL REFERENTE</p>
        <h2 className="cr-title" style={{ color: "#fff", margin: "0 0 .5rem" }}>SOLICITAR PARTICIPACIÓN</h2>
        <p style={{ color: "#d1d5db", lineHeight: 1.55, marginTop: 0 }}>
          Elegí el torneo, la rama y el turno. Una sola solicitud incluye todas sus categorías activas; cada categoría tendrá su competencia y plantel independiente.
        </p>
        {error && <p role="alert" style={{ color: "#fecaca", background: "#450a0a", border: "1px solid #b5122a", borderRadius: "8px", padding: ".75rem", whiteSpace: "pre-wrap" }}>{error}</p>}
        {notice && <p role="status" style={{ color: "#bbf7d0", background: "#052e16", border: "1px solid #166534", borderRadius: "8px", padding: ".75rem" }}>{notice}</p>}

        <section style={{ ...panelStyle, borderColor: "#444", marginTop: "1rem" }}>
          <h3 style={{ color: "#fff", margin: 0 }}>TORNEOS DISPONIBLES</h3>
          <p style={{ color: "#aaa", fontSize: ".82rem", margin: ".3rem 0 0" }}>
            La inscripción se solicita por torneo (rama y turno), no categoría por categoría.
          </p>
          {loading ? <p style={{ color: "#ccc" }}>Cargando torneos e inscripciones...</p> : (
            <div style={{ display: "grid", gap: ".85rem", width: "100%", marginTop: "1rem" }}>
              {normalizedTournaments.map((tournament) => {
                const request = requests.find((item) => String(item.torneo_id) === String(tournament.id));
                const linked = participations.filter((item) => String(item.torneo_id) === String(tournament.id));
                const isApproved = request?.estado === "aprobado" || linked.length > 0;
                const isPending = request?.estado === "pendiente";
                const categories = (tournament.normalizedCategories || []).map((category) => typeof category === "string" ? category : category.nombre).filter(Boolean);
                return (
                  <article key={tournament.id} style={{ display: "grid", gap: ".65rem", padding: ".9rem", border: "1px solid #444", borderRadius: "9px", background: "#111", minWidth: 0 }}>
                    <strong style={{ color: "#fff", display: "block", overflowWrap: "anywhere" }}>{tournament.title || tournament.nombre || "Torneo FEFUTIN"}</strong>
                    <span style={{ color: "#ffb3bf", fontSize: ".82rem" }}>{[tournament.normalizedBranchName, tournament.normalizedTurno].filter(Boolean).join(" · ")}</span>
                    <span style={{ color: "#ddd", fontSize: ".82rem" }}>{categories.length ? categories.join(" · ") : "Categorías activas del torneo"}</span>
                    {isApproved ? (
                      <span style={{ display: "inline-flex", width: "100%", boxSizing: "border-box", justifyContent: "center", color: "#86efac", background: "#052e16", border: "1px solid #166534", borderRadius: "7px", padding: ".7rem", fontWeight: 900, fontSize: ".8rem" }}>
                        ✓ CLUB HABILITADO · {linked.length || categories.length} COMPETENCIA(S)
                      </span>
                    ) : isPending ? (
                      <span style={{ display: "inline-flex", width: "100%", boxSizing: "border-box", justifyContent: "center", color: "#fde68a", background: "#422006", border: "1px solid #a16207", borderRadius: "7px", padding: ".7rem", fontWeight: 900, fontSize: ".8rem", textAlign: "center" }}>
                        SOLICITUD PENDIENTE DE APROBACIÓN
                      </span>
                    ) : request?.estado === "desestimado" ? (
                      <span style={{ color: "#fca5a5", fontSize: ".82rem" }}>SOLICITUD DESESTIMADA · Contactá a FEFUTIN si necesitás revisar la decisión.</span>
                    ) : (
                      <button
                        type="button"
                        style={{ ...buttonStyle, display: "block", width: "100%", minHeight: "44px", boxSizing: "border-box", fontSize: ".86rem" }}
                        disabled={Boolean(sendingId)}
                        onClick={() => requestTournament(tournament)}
                      >
                        {sendingId === tournament.id ? "ENVIANDO..." : "SOLICITAR INSCRIPCIÓN · TODA LA TIRA"}
                      </button>
                    )}
                  </article>
                );
              })}
              {!normalizedTournaments.length && (
                <p style={{ color: "#aaa", marginBottom: 0 }}>Todavía no hay torneos nuevos disponibles para inscripción.</p>
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
    const { data, error: loadError } = await supabase.rpc("fefutin_nuevas_solicitudes_pendientes");
    if (loadError) {
      console.error("Error al cargar solicitudes del nuevo esquema:", loadError);
      setError(loadError.message || "No se pudieron cargar las solicitudes.");
      setRequests([]);
    } else setRequests(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadRequests();
    const intervalId = window.setInterval(loadRequests, 30000);
    return () => window.clearInterval(intervalId);
  }, [loadRequests]);

  const decideRequest = async (request, approve) => {
    if (processingId) return;
    const confirmed = window.confirm(
      approve
        ? `¿Aprobar la participación de ${request.club_name} en "${request.tournament_title}"? Se habilitará en todas las categorías activas.`
        : `¿Desestimar la solicitud de ${request.club_name} para "${request.tournament_title}"?`
    );
    if (!confirmed) return;
    setProcessingId(request.id);
    setError("");
    const { error: decisionError } = await supabase.rpc("fefutin_resolver_nueva_solicitud", {
      p_solicitud_id: request.id,
      p_aprobar: approve,
    });
    if (decisionError) {
      console.error("Error al resolver solicitud del nuevo esquema:", decisionError);
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
          <p style={{ color: "#aaa", fontSize: ".82rem", margin: ".3rem 0 0" }}>Las aprobaciones habilitan al club en cada competencia activa de la tira.</p>
        </div>
        <button type="button" className="tc-form-back" onClick={loadRequests} disabled={loading}>↻ Actualizar solicitudes</button>
      </div>
      {error && <p role="alert" style={{ color: "#fecaca", background: "#450a0a", border: "1px solid #b5122a", borderRadius: "8px", padding: ".75rem", whiteSpace: "pre-wrap" }}>{error}</p>}
      {!loading && requests.length > 0 && (
        <div role="status" style={{ margin: ".75rem 0", padding: ".85rem", border: "1px solid #b5122a", borderRadius: "9px", background: "#391018", color: "#fff", fontWeight: 800 }}>
          🔔 Hay {requests.length} solicitud(es) nueva(s) esperando aprobación de Admin o Directivo.
        </div>
      )}
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
                <span style={{ display: "block", color: "#ffb3bf", fontSize: ".82rem", marginTop: ".2rem" }}>{request.turno || "Turno sin identificar"}</span>
                <span style={{ display: "block", color: "#ddd", fontSize: ".78rem", marginTop: ".2rem" }}>{request.category_label}</span>
              </div>
              <small style={{ color: "#aaa" }}>Solicitada: {request.created_at ? new Date(request.created_at).toLocaleString("es-AR") : "—"}</small>
              <div style={{ display: "flex", gap: ".55rem", flexWrap: "wrap", marginTop: ".8rem" }}>
                <button type="button" className="cr-btn-gold" disabled={Boolean(processingId)} onClick={() => decideRequest(request, true)}>{processingId === request.id ? "PROCESANDO..." : "APROBAR TODA LA TIRA"}</button>
                <button type="button" className="tc-form-back" disabled={Boolean(processingId)} onClick={() => decideRequest(request, false)}>Desestimar</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
