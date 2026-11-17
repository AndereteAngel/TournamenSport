import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

function normalizeCategoryLabel(value) {
  return String(value || "").trim().toLocaleLowerCase("es").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "");
}

function getTournamentCategoryEntries(tournament) {
  const registrationGroup = (Array.isArray(tournament?.groups) ? tournament.groups : [])
    .find((group) => group?.name === "__INSCRIPCIONES__");
  const categoryConfig = Array.isArray(registrationGroup?.category_config)
    ? registrationGroup.category_config
    : [];
  const entries = categoryConfig.flatMap((branch) =>
    (Array.isArray(branch?.categories) ? branch.categories : [])
      .map((category) => ({
        division: String(branch?.division || "").trim(),
        category: String(category || "").trim(),
      }))
      .filter((entry) => entry.division && entry.category)
  );
  if (entries.length) return entries;

  const parts = String(tournament?.game || "").split(" · ").map((part) => part.trim());
  return parts.length >= 3
    ? [{ division: parts[1], category: parts.slice(3).join(" · ") || parts[2] }]
    : [];
}

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

  const linkedCategoryKeys = useMemo(
    () => new Set(participations.map((item) =>
      `${item.tournament_id}::${normalizeCategoryLabel(item.category_label)}`
    )),
    [participations]
  );
  const pendingCategoryKeys = useMemo(
    () => new Set(requests
      .filter((item) => item.status === "pendiente")
      .map((item) => `${item.tournament_id}::${normalizeCategoryLabel(item.category_label)}`)),
    [requests]
  );

  const requestTournament = async (tournament, categoryLabel) => {
    const requestKey = `${tournament.id}::${normalizeCategoryLabel(categoryLabel)}`;
    if (sendingId || !tournament?.id || !categoryLabel) return;
    setSendingId(requestKey);
    setError("");
    setNotice("");
    const { error: requestError } = await supabase.rpc("submit_fefutin_club_tournament_request", {
      p_tournament_id: tournament.id,
      p_category_label: categoryLabel,
    });
    if (requestError) {
      console.error("Error al solicitar participación en torneo:", requestError);
      setError(requestError.message || "No se pudo enviar la solicitud.");
    } else {
      setNotice(`Solicitud enviada para ${tournament.title || "el torneo"} · ${categoryLabel}. Quedó pendiente de aprobación.`);
      await loadData();
      onSubmitted?.();
    }
    setSendingId(null);
  };

  const statusLabel = (status) => status === "pendiente"
    ? "PENDIENTE DE APROBACIÓN"
    : status === "aprobado" ? "APROBADA" : "NO APROBADA";

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
                Consultá los torneos y el estado de participación de tu club.
              </p>
            </div>
          </div>
          {loading ? <p style={{ color: "#ccc" }}>Cargando torneos...</p> : tournaments.length === 0 ? (
            <p style={{ color: "#aaa", marginBottom: 0 }}>Todavía no hay torneos creados.</p>
          ) : (
            <div style={{ width: "100%", overflowX: "auto", marginTop: "1rem" }}>
              <table style={{ width: "100%", minWidth: "560px", borderCollapse: "collapse", color: "#fff", fontSize: ".88rem" }}>
                <thead>
                  <tr style={{ background: "#202020", textAlign: "left" }}>
                    <th style={{ padding: ".75rem", borderBottom: "1px solid #555" }}>TORNEO</th>
                    <th style={{ padding: ".75rem", borderBottom: "1px solid #555" }}>RAMA / CATEGORÍA</th>
                    <th style={{ padding: ".75rem", borderBottom: "1px solid #555" }}>PARTICIPACIÓN</th>
                  </tr>
                </thead>
                <tbody>
                  {tournaments.flatMap((tournament) =>
                    getTournamentCategoryEntries(tournament).map((entry) => {
                      const categoryLabel = `${entry.division} · ${entry.category}`;
                      const requestKey = `${tournament.id}::${normalizeCategoryLabel(categoryLabel)}`;
                      const isLinked = linkedCategoryKeys.has(requestKey);
                      const isPending = pendingCategoryKeys.has(requestKey);
                      return (
                        <tr key={requestKey} style={{ borderBottom: "1px solid #383838" }}>
                          <td style={{ padding: ".8rem .75rem", fontWeight: 800 }}>{tournament.title || "Torneo sin nombre"}</td>
                          <td style={{ padding: ".8rem .75rem", color: "#d1d5db" }}>{categoryLabel}</td>
                          <td style={{ padding: ".8rem .75rem" }}>
                            {isLinked ? (
                              <span style={{ display: "inline-flex", color: "#86efac", background: "#052e16", border: "1px solid #166534", borderRadius: "7px", padding: ".55rem .7rem", fontWeight: 900, fontSize: ".75rem" }}>
                                ✓ INSCRIPTO
                              </span>
                            ) : isPending ? (
                              <span style={{ display: "inline-block", color: "#fde68a", background: "#422006", border: "1px solid #a16207", borderRadius: "7px", padding: ".55rem .7rem", fontWeight: 900, fontSize: ".72rem" }}>
                                SOLICITUD PENDIENTE
                              </span>
                            ) : (
                              <button
                                type="button"
                                style={{ ...buttonStyle, minWidth: "132px", minHeight: "42px", whiteSpace: "nowrap", display: "inline-block" }}
                                disabled={Boolean(sendingId)}
                                onClick={() => requestTournament(tournament, categoryLabel)}
                              >
                                {sendingId === requestKey ? "ENVIANDO..." : "INSCRIBIRSE"}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ color: "#aaa", fontSize: ".78rem", marginBottom: 0, marginTop: ".8rem" }}>
            La inscripción queda confirmada cuando Admin o Directivo aprueba la solicitud.
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
