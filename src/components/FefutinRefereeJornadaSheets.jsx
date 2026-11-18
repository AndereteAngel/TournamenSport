import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

export function FefutinRefereeJornadaSheets({ jornadas = [], currentUser, onOpenMatch }) {
  const [savedKeys, setSavedKeys] = useState(() => new Set());
  const [savingKey, setSavingKey] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [archiveLoaded, setArchiveLoaded] = useState(false);
  const archivingKeysRef = useRef(new Set());

  const planillas = useMemo(() => (jornadas || []).map((jornada) => {
    const details = (jornada.detallesPartidos || [])
      .filter((detail) => detail.matchId || detail.id)
      .map((detail) => ({
        ...detail,
        matchId: String(detail.matchId || detail.id),
        categoria: detail.categoria || "Sin categoría",
        resultadoCargado: Boolean(detail.resultadoCargado),
        referee_id: detail.referee_id || null,
        referee_closed: Boolean(detail.referee_closed),
        legacy_pending_review: Boolean(detail.legacy_pending_review),
      }));
    const assignedMatches = details.filter((detail) =>
      String(detail.referee_id || "") === String(currentUser?.id || "")
    );
    const legacyPendingReview = details.some((detail) => detail.legacy_pending_review);
    const allClosed = details.length > 0 && details.every((detail) => detail.referee_closed) && !legacyPendingReview;
    return {
      key: jornada.key,
      jornadaKey: jornada.jornadaKey || jornada.key,
      turnJourneyId: jornada.turn_journey_id || null,
      turnId: jornada.turn_id || null,
      tournamentId: jornada.tournament_id || null,
      tournamentIds: [...new Set(details.map((detail) => detail.tournament_id).filter(Boolean)
        .concat(jornada.tournament_id ? [jornada.tournament_id] : []))],
      tournamentTitle: jornada.torneo || "Torneo FEFUTIN",
      branch: jornada.rama || "Rama sin identificar",
      turno: jornada.turno || "Turno sin identificar",
      journeyNumber: jornada.journey_number || details[0]?.round || "—",
      scheduledDate: jornada.scheduled_date || details.find((detail) => detail.scheduled_date)?.scheduled_date || null,
      categories: jornada.categorias || [...new Set(details.map((detail) => detail.categoria))],
      details,
      assignedMatches,
      allClosed,
      legacyPendingReview,
      matchCount: details.length,
      partidosJugados: details.filter((detail) => detail.resultadoCargado).length,
    };
  }), [jornadas, currentUser?.id]);

  useEffect(() => {
    let active = true;
    if (!currentUser?.id) return () => { active = false; };
    supabase.from("fefutin_jornada_sheets").select("jornada_key")
      .eq("referee_id", currentUser.id)
      .then(({ data, error: queryError }) => {
        if (!active) return;
        if (queryError) {
          setError("No se pudo consultar el archivo de tus planillas generales: " + queryError.message);
          return;
        }
        setSavedKeys(new Set((data || []).map((item) => item.jornada_key)));
        setArchiveLoaded(true);
      });
    return () => { active = false; };
  }, [currentUser?.id]);

  const printJornada = (jornada, withResults) => {
    const popup = window.open("", "_blank", "width=1000,height=750");
    if (!popup) {
      setError("El navegador bloqueó la impresión. Permití las ventanas emergentes para imprimir la planilla.");
      return;
    }
    const escapeHtml = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
    })[character]);
    const rows = jornada.details.map((detail) => {
      const result = withResults && detail.resultadoCargado
        ? `${detail.score1} - ${detail.score2}`
        : withResults ? "— - —" : "_____ - _____";
      const referee = detail.referee_name || (detail.referee_id ? "Árbitro designado" : "Sin designar");
      return `<tr><td>${escapeHtml(detail.categoria)}</td><td>${escapeHtml(detail.team1 || "—")}</td><td class="score">${result}</td><td>${escapeHtml(detail.team2 || "—")}</td><td>${escapeHtml(referee)}</td></tr>`;
    }).join("");
    const dateLabel = jornada.scheduledDate
      ? new Date(`${jornada.scheduledDate}T12:00:00`).toLocaleDateString("es-AR")
      : "Fecha a confirmar";
    const signatures = withResults ? "" : `<div class="signatures"><div>Firma de árbitro/s<br><br>____________________________</div><div>Firma de responsable de jornada<br><br>____________________________</div></div>`;
    popup.document.open();
    popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Planilla general FEFUTIN</title><style>
      @page{size:A4 portrait;margin:13mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#171c27;margin:0}
      header{border-bottom:4px solid #b5122a;padding-bottom:12px;margin-bottom:16px}.brand{color:#b5122a;font-weight:900;letter-spacing:3px;font-size:13px}
      h1{font-size:20px;margin:8px 0 5px}.meta{font-size:11px;color:#555}.journey{font-size:16px;font-weight:900;margin-top:10px}
      table{width:100%;border-collapse:collapse;margin-top:16px;font-size:9px}th{background:#171c27;color:#fff;text-align:left;padding:8px 6px}
      td{height:34px;padding:6px;border-bottom:1px solid #cfd3da}.score{text-align:center;font-weight:900;white-space:nowrap}
      .signatures{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:42px;text-align:center;font-size:11px;page-break-inside:avoid}
      @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
      </style></head><body><header><div class="brand">FEFUTIN</div><h1>PLANILLA OFICIAL GENERAL DE JORNADA</h1>
      <div class="meta">${escapeHtml(jornada.tournamentTitle)} · Rama ${escapeHtml(jornada.branch)} · Turno ${escapeHtml(jornada.turno)}</div>
      <div class="journey">JORNADA ${escapeHtml(jornada.journeyNumber)} · ${escapeHtml(dateLabel)}</div>
      <div class="meta">${jornada.matchCount} encuentros · ${escapeHtml(jornada.categories.join(" · "))}</div></header>
      <table><thead><tr><th>Categoría</th><th>Local</th><th>Resultado</th><th>Visitante</th><th>Árbitro</th></tr></thead><tbody>${rows}</tbody></table>
      ${signatures}</body></html>`);
    popup.document.close();
    window.setTimeout(() => { popup.focus(); popup.print(); }, 300);
  };

  const archiveJornada = async (jornada) => {
    if (!currentUser?.id || !jornada?.allClosed || !jornada.assignedMatches.length ||
        savedKeys.has(jornada.jornadaKey) || savingKey) return;
    if (!jornada.tournamentId) {
      setError("No se pudo identificar la rama, el turno o la jornada. No se archivó para evitar guardar información incompleta.");
      return;
    }
    setSavingKey(jornada.jornadaKey);
    setError("");
    setMessage("");
    const payload = {
      jornada_key: jornada.jornadaKey,
      tournament_id: jornada.tournamentId,
      tournament_ids: jornada.tournamentIds,
      turn_id: jornada.turnId,
      turn_journey_id: jornada.turnJourneyId,
      tournament_title: jornada.tournamentTitle,
      rama: jornada.branch,
      turno: jornada.turno,
      journey_number: Number(jornada.journeyNumber) || null,
      team_local: "TODOS LOS CLUBES",
      team_visitante: "TODOS LOS CLUBES",
      referee_id: currentUser.id,
      referee_name: currentUser.username || null,
      jornada_date: jornada.scheduledDate || new Date().toISOString().slice(0, 10),
      categorias: jornada.categories,
      detalles: jornada.details,
      puntos_local: 0,
      puntos_visitante: 0,
      closed_at: new Date().toISOString(),
    };
    const { error: insertError } = await supabase.from("fefutin_jornada_sheets").insert(payload);
    setSavingKey("");
    if (insertError) {
      if (insertError.code === "23505") {
        setSavedKeys((previous) => new Set([...previous, jornada.jornadaKey]));
        setMessage("Esta planilla general ya estaba archivada.");
      } else {
        setError("No se pudo cerrar la planilla general: " + insertError.message);
      }
      return;
    }
    setSavedKeys((previous) => new Set([...previous, jornada.jornadaKey]));
    setMessage("Planilla general de la jornada cerrada y guardada en el archivo institucional.");
  };

  useEffect(() => {
    if (!archiveLoaded || !currentUser?.id) return;
    const saveCompleted = async () => {
      for (const jornada of planillas) {
        if (!jornada.allClosed || !jornada.assignedMatches.length ||
            savedKeys.has(jornada.jornadaKey) ||
            archivingKeysRef.current.has(jornada.jornadaKey) ||
            !jornada.tournamentId) continue;
        archivingKeysRef.current.add(jornada.jornadaKey);
        const payload = {
          jornada_key: jornada.jornadaKey,
          tournament_id: jornada.tournamentId,
          tournament_ids: jornada.tournamentIds,
          turn_id: jornada.turnId,
          turn_journey_id: jornada.turnJourneyId,
          tournament_title: jornada.tournamentTitle,
          rama: jornada.branch,
          turno: jornada.turno,
          journey_number: Number(jornada.journeyNumber) || null,
          team_local: "TODOS LOS CLUBES",
          team_visitante: "TODOS LOS CLUBES",
          referee_id: currentUser.id,
          referee_name: currentUser.username || null,
          jornada_date: jornada.scheduledDate || new Date().toISOString().slice(0, 10),
          categorias: jornada.categories,
          detalles: jornada.details,
          puntos_local: 0,
          puntos_visitante: 0,
          closed_at: new Date().toISOString(),
        };
        const { error: insertError } = await supabase.from("fefutin_jornada_sheets").insert(payload);
        if (insertError && insertError.code !== "23505") {
          setError("No se pudo guardar automáticamente la planilla general: " + insertError.message);
          archivingKeysRef.current.delete(jornada.jornadaKey);
          continue;
        }
        setSavedKeys((previous) => new Set([...previous, jornada.jornadaKey]));
        setMessage("Planilla general guardada automáticamente en el archivo institucional.");
      }
    };
    saveCompleted();
  }, [archiveLoaded, currentUser?.id, currentUser?.username, planillas, savedKeys]);

  if (!planillas.length) {
    return <section style={{ margin: "1rem 0", padding: "1rem", border: "1px solid #555", borderRadius: "10px", color: "#ddd" }}>
      <strong>PLANILLAS GENERALES POR JORNADA</strong>
      <p style={{ marginBottom: 0, fontSize: ".82rem" }}>Todavía no tenés jornadas con partidos designados.</p>
    </section>;
  }

  return (
    <section style={{ display: "grid", gap: ".75rem", margin: "1rem 0" }}>
      <h3 style={{ margin: ".2rem 0", color: "#fff", fontSize: ".9rem", letterSpacing: ".05em" }}>PLANILLAS GENERALES POR JORNADA</h3>
      <p style={{ color: "#bbb", fontSize: ".78rem", margin: 0 }}>Cada planilla reúne todos los encuentros de la misma jornada y turno, aunque pertenezcan a categorías distintas. Cada partido conserva su planilla individual.</p>
      {planillas.map((jornada) => {
        const archived = savedKeys.has(jornada.jornadaKey);
        const dateLabel = jornada.scheduledDate
          ? new Date(`${jornada.scheduledDate}T12:00:00`).toLocaleDateString("es-AR")
          : "Fecha a confirmar";
        return (
          <article key={jornada.key} style={{ padding: ".85rem", border: "1px solid #b5122a", borderRadius: "10px", background: "#171c27" }}>
            <div style={{ textAlign: "center", color: "#fff", fontWeight: 900 }}>
              JORNADA {jornada.journeyNumber} · {dateLabel}
            </div>
            <small style={{ display: "block", textAlign: "center", color: "#bbb", marginTop: ".3rem" }}>{jornada.tournamentTitle} · {jornada.branch} · {jornada.turno} · {jornada.matchCount} encuentro(s) · {jornada.categories.length} categoría(s)</small>
            <div style={{ display: "grid", gap: ".4rem", marginTop: ".7rem" }}>
              {jornada.details.map((detail) => {
                const assignedToThisReferee = String(detail.referee_id || "") === String(currentUser?.id || "");
                const canOpen = assignedToThisReferee || ["admin", "directivo"].includes(String(currentUser?.role || "").toLowerCase());
                return (
                  <div key={detail.matchId} style={{ display: "grid", gridTemplateColumns: "minmax(0, .7fr) minmax(0, 1.7fr)", gap: ".35rem .5rem", alignItems: "center", padding: ".6rem", background: "#080b10", borderRadius: "7px", color: "#eee", fontSize: ".72rem" }}>
                    <strong style={{ color: "#f3a0ad" }}>{detail.categoria}</strong>
                    <span style={{ fontWeight: 800 }}>{detail.team1} <span style={{ color: "#f3a0ad" }}>{detail.score1 == null ? "—" : detail.score1} - {detail.score2 == null ? "—" : detail.score2}</span> {detail.team2}</span>
                    <small style={{ gridColumn: "1 / -1", color: "#9ca3af" }}>
                      {detail.scheduled_time ? `${detail.scheduled_time} · ` : ""}{detail.referee_closed ? "ENCUENTRO CERRADO" : assignedToThisReferee ? "PLANILLA PENDIENTE" : detail.referee_id ? "ASIGNADO A OTRO ÁRBITRO" : "SIN ÁRBITRO DESIGNADO"}
                    </small>
                    {detail.venue_address && <small style={{ gridColumn: "1 / -1", color: "#9ca3af" }}>Sede: {detail.venue_address}</small>}
                    <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", borderTop: "1px solid #343a40", paddingTop: ".45rem" }}>
                      <button
                        type="button"
                        disabled={!onOpenMatch || !canOpen}
                        onClick={() => onOpenMatch?.(detail)}
                        style={{ padding: ".5rem .7rem", border: "1px solid #b5122a", borderRadius: "7px", background: detail.referee_closed ? "#242a32" : canOpen ? "#b5122a" : "#444", color: "#fff", fontWeight: 900, fontSize: ".68rem", cursor: onOpenMatch && canOpen ? "pointer" : "not-allowed", opacity: canOpen ? 1 : .6 }}
                      >
                        {detail.referee_closed ? "VER PLANILLA" : canOpen ? "CARGAR PLANILLA" : "SIN ACCESO"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".5rem", flexWrap: "wrap", marginTop: ".75rem" }}>
              <span style={{ color: archived ? "#86efac" : jornada.legacyPendingReview ? "#fca5a5" : jornada.allClosed ? "#86efac" : "#fcd34d", fontSize: ".72rem", fontWeight: 800 }}>
                {archived ? "PLANILLA GENERAL ARCHIVADA" : jornada.legacyPendingReview ? "HAY PARTIDOS ANTIGUOS PENDIENTES DE REVISIÓN" : jornada.allClosed ? "TODOS LOS ENCUENTROS CERRADOS" : `${jornada.assignedMatches.length} PARTIDO(S) ASIGNADO(S) A VOS`}
              </span>
              <button type="button" disabled={!jornada.allClosed || !jornada.assignedMatches.length || archived || savingKey === jornada.jornadaKey || Boolean(savingKey)} onClick={() => archiveJornada(jornada)} style={{ padding: ".65rem .8rem", border: "1px solid #b5122a", borderRadius: "8px", background: archived ? "#333" : "#b5122a", color: "#fff", fontWeight: 900, opacity: !jornada.allClosed || !jornada.assignedMatches.length || archived || savingKey ? .55 : 1 }}>
                {archived ? "GUARDADA EN ARCHIVO" : savingKey === jornada.jornadaKey ? "GUARDANDO..." : "CERRAR Y ARCHIVAR PLANILLA"}
              </button>
            </div>
          </article>
        );
      })}
      {error && <p role="alert" style={{ color: "#fca5a5", margin: 0 }}>{error}</p>}
      {message && <p role="status" style={{ color: "#86efac", margin: 0 }}>{message}</p>}
    </section>
  );
}
