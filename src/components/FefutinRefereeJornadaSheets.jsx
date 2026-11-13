import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

export function FefutinRefereeJornadaSheets({ jornadas = [], currentUser }) {
  const [savedKeys, setSavedKeys] = useState(() => new Set());
  const [savingKey, setSavingKey] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Se consume exactamente el cálculo que alimenta DATOS POR JORNADA
  // en la tarjeta de estadísticas de cada árbitro.
  const planillas = useMemo(() => (jornadas || []).map((jornada) => {
    const details = (jornada.detallesPartidos || []).map((detail) => ({
      ...detail,
      categoria: detail.categoria || "Sin categoría",
      resultadoCargado: Boolean(detail.resultadoCargado),
      referee_id: detail.referee_id || null,
      referee_closed: Boolean(detail.referee_closed),
    }));
    const matches = details.filter((detail) => detail.instancia !== "Pendiente de fixture");
    const allAssignedToThisReferee = matches.length > 0 &&
      matches.every((detail) => detail.referee_id === currentUser?.id);
    const allClosed = allAssignedToThisReferee &&
      matches.every((detail) => detail.referee_closed);
    const tournamentIds = [...new Set(details.map((detail) => detail.tournament_id).filter(Boolean))];
    return {
      key: jornada.key,
      jornadaKey: jornada.key,
      tournamentId: tournamentIds[0] || null,
      tournamentIds,
      tournamentTitle: jornada.torneo || "Torneo FEFUTIN",
      branch: jornada.rama || "Infantil",
      teamLocal: jornada.team1,
      teamVisitor: jornada.team2,
      categories: jornada.categorias || [],
      details,
      pointsLocal: Number(jornada.puntosTeam1 || 0),
      pointsVisitor: Number(jornada.puntosTeam2 || 0),
      allClosed,
      allAssignedToThisReferee,
      matchCount: matches.length,
      partidosJugados: jornada.partidosJugados || 0,
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
      });
    return () => { active = false; };
  }, [currentUser?.id]);

  const printJornada = (jornada, withResults) => {
    const popup = window.open("", "_blank", "width=900,height=700");
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
      const points = withResults && detail.resultadoCargado
        ? `<td>${detail.puntosTeam1}</td><td>${detail.puntosTeam2}</td>`
        : withResults ? "<td>—</td><td>—</td>" : "<td></td>";
      return `<tr><td>${escapeHtml(detail.categoria)}</td><td>${escapeHtml(detail.team1 || jornada.teamLocal)} ${result} ${escapeHtml(detail.team2 || jornada.teamVisitor)}</td>${points}</tr>`;
    }).join("");
    const headerPoints = withResults
      ? `<p class="totals">${escapeHtml(jornada.teamLocal)}: <strong>${jornada.pointsLocal} puntos</strong> · ${escapeHtml(jornada.teamVisitor)}: <strong>${jornada.pointsVisitor} puntos</strong></p>`
      : "";
    const tableHeaders = withResults
      ? `<th>Puntos ${escapeHtml(jornada.teamLocal)}</th><th>Puntos ${escapeHtml(jornada.teamVisitor)}</th>`
      : "<th>Observaciones</th>";
    const signature = withResults ? "" : `<div class="signatures"><div>Firma referente local<br><br>____________________________</div><div>Firma referente visitante<br><br>____________________________</div></div><p class="ref">Árbitro: ${escapeHtml(currentUser?.username || "________________")} · Matrícula: __________________</p>`;
    popup.document.open();
    popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Planilla general FEFUTIN</title><style>
      @page{size:A4 portrait;margin:14mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#171c27;margin:0}
      header{border-bottom:4px solid #b5122a;padding-bottom:12px;margin-bottom:16px}.brand{color:#b5122a;font-weight:900;letter-spacing:3px;font-size:13px}
      h1{font-size:21px;margin:8px 0 5px}.meta{font-size:11px;color:#555}.clubs{font-size:17px;font-weight:900;margin-top:12px}
      table{width:100%;border-collapse:collapse;margin-top:16px;font-size:10px}th{background:#171c27;color:#fff;text-align:left;padding:8px 6px}
      td{height:38px;padding:7px 6px;border-bottom:1px solid #cfd3da}.totals{margin-top:14px;font-size:12px}
      .signatures{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:48px;text-align:center;font-size:11px;page-break-inside:avoid}
      .ref{margin-top:22px;font-size:11px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
      </style></head><body><header><div class="brand">FEFUTIN</div><h1>PLANILLA OFICIAL GENERAL DE JORNADA</h1>
      <div class="meta">${escapeHtml(jornada.tournamentTitle)} · Rama ${escapeHtml(jornada.branch)} · ${escapeHtml(jornada.categories.join(" · "))}</div>
      <div class="clubs">${escapeHtml(jornada.teamLocal)} VS. ${escapeHtml(jornada.teamVisitor)}</div></header>
      <table><thead><tr><th>Categoría</th><th>Resultado</th>${tableHeaders}</tr></thead><tbody>${rows}</tbody></table>
      ${headerPoints}${signature}</body></html>`);
    popup.document.close();
    window.setTimeout(() => { popup.focus(); popup.print(); }, 300);
  };

  const archiveJornada = async (jornada) => {
    if (!currentUser?.id || !jornada?.allClosed || savedKeys.has(jornada.jornadaKey) || savingKey) return;
    if (!jornada.tournamentId) {
      setError("No se pudo identificar el torneo de esta planilla. No se archivó para evitar guardar información incompleta.");
      return;
    }
    setSavingKey(jornada.jornadaKey);
    setError("");
    setMessage("");
    const payload = {
      jornada_key: jornada.jornadaKey,
      tournament_id: jornada.tournamentId,
      tournament_ids: jornada.tournamentIds,
      tournament_title: jornada.tournamentTitle,
      rama: jornada.branch,
      team_local: jornada.teamLocal,
      team_visitante: jornada.teamVisitor,
      referee_id: currentUser.id,
      referee_name: currentUser.username || null,
      jornada_date: new Date().toISOString().slice(0, 10),
      categorias: jornada.categories,
      detalles: jornada.details,
      puntos_local: jornada.pointsLocal,
      puntos_visitante: jornada.pointsVisitor,
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
    setMessage("Planilla general cerrada y guardada en el archivo institucional.");
  };

  // Guarda en el archivo institucional las jornadas completas sin exigir un paso manual.
  useEffect(() => {
    if (!archiveLoaded || !currentUser?.id) return;
    const saveCompleted = async () => {
      for (const jornada of planillas) {
        if (!jornada.allClosed || savedKeys.has(jornada.jornadaKey) || archivingKeysRef.current.has(jornada.jornadaKey) || !jornada.tournamentId) continue;
        archivingKeysRef.current.add(jornada.jornadaKey);
        const payload = {
          jornada_key: jornada.jornadaKey, tournament_id: jornada.tournamentId, tournament_ids: jornada.tournamentIds,
          tournament_title: jornada.tournamentTitle, rama: jornada.branch, team_local: jornada.teamLocal,
          team_visitante: jornada.teamVisitor, referee_id: currentUser.id, referee_name: currentUser.username || null,
          jornada_date: new Date().toISOString().slice(0, 10), categorias: jornada.categories, detalles: jornada.details,
          puntos_local: jornada.pointsLocal, puntos_visitante: jornada.pointsVisitor, closed_at: new Date().toISOString(),
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
      <p style={{ marginBottom: 0, fontSize: ".82rem" }}>Todavía no tenés cruces de clubes designados para generar una planilla general.</p>
    </section>;
  }

  return (
    <section style={{ display: "grid", gap: ".75rem", margin: "1rem 0" }}>
      <h3 style={{ margin: ".2rem 0", color: "#fff", fontSize: ".9rem", letterSpacing: ".05em" }}>PLANILLAS GENERALES POR JORNADA</h3>
      <p style={{ color: "#bbb", fontSize: ".78rem", margin: 0 }}>Esta planilla utiliza los mismos partidos, categorías y puntos que DATOS POR JORNADA en la tarjeta del árbitro.</p>
      {planillas.map((jornada) => {
        const archived = savedKeys.has(jornada.jornadaKey);
        return (
          <article key={jornada.key} style={{ padding: ".85rem", border: "1px solid #b5122a", borderRadius: "10px", background: "#171c27" }}>
            <div style={{ textAlign: "center", color: "#fff", fontWeight: 900 }}>
              {jornada.teamLocal} <span style={{ color: "#f3a0ad" }}>VS.</span> {jornada.teamVisitor}
            </div>
            <small style={{ display: "block", textAlign: "center", color: "#bbb", marginTop: ".3rem" }}>{jornada.tournamentTitle} · {jornada.branch} · {jornada.categories.length} categoría(s)</small>
            <div style={{ display: "grid", gap: ".4rem", marginTop: ".7rem" }}>
              {jornada.details.map((detail, index) => (
                <div key={`${jornada.key}-${index}`} style={{ display: "grid", gridTemplateColumns: "minmax(0, .7fr) minmax(0, 1.5fr)", gap: ".35rem .5rem", alignItems: "center", padding: ".5rem", background: "#080b10", borderRadius: "7px", color: "#eee", fontSize: ".72rem" }}>
                  <strong style={{ color: "#f3a0ad" }}>{detail.categoria}</strong>
                  <span>{detail.team1} {detail.score1 == null ? "—" : detail.score1} - {detail.score2 == null ? "—" : detail.score2} {detail.team2}</span>
                  <span style={{ gridColumn: "1 / -1", color: "#d1d5db" }}>{jornada.teamLocal}: <strong style={{ color: "#fff" }}>{detail.resultadoCargado ? detail.puntosTeam1 + " pts" : "Pendiente"}</strong> · {jornada.teamVisitor}: <strong style={{ color: "#fff" }}>{detail.resultadoCargado ? detail.puntosTeam2 + " pts" : "Pendiente"}</strong></span>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".5rem", marginTop: ".7rem" }}>
              <button type="button" onClick={() => printJornada(jornada, false)} style={{ padding: ".6rem .4rem", border: "1px solid #b5122a", borderRadius: "8px", background: "#fff", color: "#171c27", fontWeight: 900, fontSize: ".7rem" }}>IMPRIMIR EN BLANCO</button>
              <button type="button" onClick={() => printJornada(jornada, true)} style={{ padding: ".6rem .4rem", border: "1px solid #b5122a", borderRadius: "8px", background: "#241015", color: "#fff", fontWeight: 900, fontSize: ".7rem" }}>IMPRIMIR CON RESULTADOS</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".5rem", marginTop: ".65rem" }}>
              <div style={{ padding: ".55rem", border: "1px solid #b5122a", borderRadius: "7px" }}><small style={{ color: "#bbb" }}>TOTAL {jornada.teamLocal}</small><strong style={{ display: "block", color: "#fff" }}>{jornada.pointsLocal} puntos</strong></div>
              <div style={{ padding: ".55rem", border: "1px solid #b5122a", borderRadius: "7px" }}><small style={{ color: "#bbb" }}>TOTAL {jornada.teamVisitor}</small><strong style={{ display: "block", color: "#fff" }}>{jornada.pointsVisitor} puntos</strong></div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".5rem", flexWrap: "wrap", marginTop: ".7rem" }}>
              <span style={{ color: archived ? "#86efac" : jornada.allClosed ? "#fca5a5" : "#fcd34d", fontSize: ".72rem", fontWeight: 800 }}>
                {archived ? "PLANILLA GENERAL ARCHIVADA" : jornada.allClosed ? "LISTA PARA CERRAR" : jornada.allAssignedToThisReferee ? "PARTIDOS PENDIENTES DE CIERRE" : "DESIGNACIÓN INCOMPLETA"}
              </span>
              <button type="button" disabled={!jornada.allClosed || archived || savingKey === jornada.jornadaKey || Boolean(savingKey)} onClick={() => archiveJornada(jornada)} style={{ padding: ".65rem .8rem", border: "1px solid #b5122a", borderRadius: "8px", background: archived ? "#333" : "#b5122a", color: "#fff", fontWeight: 900, opacity: !jornada.allClosed || archived || savingKey ? .55 : 1 }}>
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
