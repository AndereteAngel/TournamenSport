import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

export function FefutinRefereeJornadaSheets({ jornadas = [], currentUser, onOpenMatch }) {
  const [savedKeys, setSavedKeys] = useState(() => new Set());
  const [savingKey, setSavingKey] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [archiveLoaded, setArchiveLoaded] = useState(false);
  const [expandedKey, setExpandedKey] = useState("");
  const [photoBatch, setPhotoBatch] = useState({ jornadaKey: "", targets: [], files: [], assignments: {} });
  const [preparingPhotoKey, setPreparingPhotoKey] = useState("");
  const [uploadingPhotoKey, setUploadingPhotoKey] = useState("");

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
    const teamTotalsMap = new Map();
    details.forEach((detail) => {
      if (!detail.resultadoCargado) return;
      const addTeamPoints = (name, points) => {
        const teamName = String(name || "").trim();
        if (!teamName) return;
        const normalized = teamName.toLocaleLowerCase("es");
        const current = teamTotalsMap.get(normalized) || { equipo: teamName, puntos: 0, partidos: 0, ganados: 0, empatados: 0, perdidos: 0 };
        current.puntos += Number(points) || 0;
        current.partidos += 1;
        teamTotalsMap.set(normalized, current);
      };
      addTeamPoints(detail.team1, detail.puntosTeam1 ?? (detail.score1 > detail.score2 ? 3 : detail.score1 < detail.score2 ? 1 : 2));
      addTeamPoints(detail.team2, detail.puntosTeam2 ?? (detail.score2 > detail.score1 ? 3 : detail.score2 < detail.score1 ? 1 : 2));
      const local = teamTotalsMap.get(String(detail.team1 || "").trim().toLocaleLowerCase("es"));
      const visitante = teamTotalsMap.get(String(detail.team2 || "").trim().toLocaleLowerCase("es"));
      if (local && visitante) {
        if (detail.score1 > detail.score2) { local.ganados += 1; visitante.perdidos += 1; }
        else if (detail.score1 < detail.score2) { visitante.ganados += 1; local.perdidos += 1; }
        else { local.empatados += 1; visitante.empatados += 1; }
      }
    });
    const teamTotals = [...teamTotalsMap.values()].sort((a, b) =>
      b.puntos - a.puntos || a.equipo.localeCompare(b.equipo, "es")
    );
    const totalPointsTeam1 = details.reduce((sum, detail) => sum + (detail.resultadoCargado ? Number(detail.puntosTeam1 ?? (detail.score1 > detail.score2 ? 3 : detail.score1 < detail.score2 ? 1 : 2)) : 0), 0);
    const totalPointsTeam2 = details.reduce((sum, detail) => sum + (detail.resultadoCargado ? Number(detail.puntosTeam2 ?? (detail.score2 > detail.score1 ? 3 : detail.score2 < detail.score1 ? 1 : 2)) : 0), 0);
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
      teamTotals,
      totalPointsTeam1,
      totalPointsTeam2,
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

  const preparePhotoBatch = async (jornada) => {
    if (!currentUser?.id || !jornada?.allClosed || !jornada.turnJourneyId || preparingPhotoKey) return;
    setPreparingPhotoKey(jornada.jornadaKey);
    setError("");
    setMessage("");
    try {
      const matchIds = [...new Set(jornada.details.map((detail) => detail.normalizedMatchId).filter(Boolean))];
      if (!matchIds.length || matchIds.length !== jornada.details.length) {
        throw new Error("Esta jornada contiene partidos antiguos o sin vínculo normalizado. No se mezclarán con las planillas nuevas; requiere revisión antes de cerrar.");
      }
      const { data: sheets, error: sheetsError } = await supabase
        .from("fefutin_match_sheets")
        .select("id,tournament_id,normalized_match_id,lado,categoria,estado")
        .in("normalized_match_id", matchIds)
        .in("tournament_id", jornada.tournamentIds)
        .in("estado", ["cerrada", "cerrado"]);
      if (sheetsError) throw sheetsError;

      const targets = [{
        key: "general",
        label: "PLANILLA GENERAL DE LA JORNADA",
        document_type: "general",
        match_sheet_id: null,
        tournament_id: jornada.tournamentId,
        categoria: null,
        turn_id: jornada.turnId,
        turn_journey_id: jornada.turnJourneyId,
        turno: jornada.turno,
        journey_number: Number(jornada.journeyNumber) || null,
        jornada_date: jornada.scheduledDate || new Date().toISOString().slice(0, 10),
        jornada_label: String(jornada.journeyNumber || ""),
        uploaded: false,
      }];

      for (const detail of jornada.details) {
        for (const side of ["local", "visitante"]) {
          const matches = (sheets || []).filter((sheet) =>
            sheet.normalized_match_id === detail.normalizedMatchId &&
            sheet.lado === side
          );
          if (matches.length !== 1) {
            throw new Error("No se encontró exactamente una planilla digital cerrada para " +
              detail.categoria + " · " + detail.team1 + " vs. " + detail.team2 +
              " (" + side + "). No se archivó ninguna foto.");
          }
          const sheet = matches[0];
          targets.push({
            key: sheet.id,
            label: detail.categoria + " · " + detail.team1 + " vs. " + detail.team2 +
              " · PLANILLA " + side.toUpperCase(),
            document_type: "category",
            match_sheet_id: sheet.id,
            tournament_id: sheet.tournament_id,
            categoria: sheet.categoria || detail.categoria || null,
            turn_id: jornada.turnId,
            turn_journey_id: jornada.turnJourneyId,
            turno: jornada.turno,
            journey_number: Number(jornada.journeyNumber) || null,
            jornada_date: jornada.scheduledDate || new Date().toISOString().slice(0, 10),
            jornada_label: String(jornada.journeyNumber || ""),
            uploaded: false,
          });
        }
      }

      const { data: existingPhotos, error: photosError } = await supabase
        .from("fefutin_jornada_photos")
        .select("match_sheet_id,document_type")
        .eq("referee_id", currentUser.id)
        .eq("turn_journey_id", jornada.turnJourneyId);
      if (photosError) throw photosError;
      const uploadedKeys = new Set((existingPhotos || []).map((photo) =>
        photo.document_type === "general" ? "general" : photo.match_sheet_id
      ));
      const checkedTargets = targets.map((target) => ({
        ...target,
        uploaded: uploadedKeys.has(target.key),
      }));
      setPhotoBatch({
        jornadaKey: jornada.jornadaKey,
        targets: checkedTargets,
        files: [],
        assignments: {},
      });
      const pending = checkedTargets.filter((target) => !target.uploaded).length;
      setMessage(pending
        ? "Se identificaron " + checkedTargets.length + " documentos. Seleccioná las fotos que faltan."
        : "Todas las fotos ya están archivadas. Podés cerrar la jornada.");
    } catch (err) {
      setError(err.message || "No se pudieron preparar las fotos de la jornada.");
    } finally {
      setPreparingPhotoKey("");
    }
  };

  const updatePhotoFiles = (fileList) => {
    const files = Array.from(fileList || []);
    const pendingTargets = photoBatch.targets.filter((target) => !target.uploaded);
    const assignments = {};
    if (files.length === pendingTargets.length) {
      pendingTargets.forEach((target, index) => { assignments[target.key] = String(index); });
    }
    setPhotoBatch((current) => ({ ...current, files, assignments }));
  };

  const uploadPhotoBatchAndClose = async (jornada) => {
    if (!currentUser?.id || uploadingPhotoKey || photoBatch.jornadaKey !== jornada.jornadaKey) return;
    const pendingTargets = photoBatch.targets.filter((target) => !target.uploaded);
    const usedFiles = Object.values(photoBatch.assignments);
    if (pendingTargets.length !== usedFiles.length ||
        pendingTargets.some((target) => photoBatch.assignments[target.key] == null) ||
        new Set(usedFiles).size !== usedFiles.length) {
      setError("Asigná una foto distinta a cada planilla pendiente, incluida la planilla general.");
      return;
    }
    setUploadingPhotoKey(jornada.jornadaKey);
    setError("");
    setMessage("");
    try {
      const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
      for (let index = 0; index < pendingTargets.length; index += 1) {
        const target = pendingTargets[index];
        const file = photoBatch.files[Number(photoBatch.assignments[target.key])];
        if (!file || !allowedTypes.includes(file.type)) {
          throw new Error("Todas las fotos deben estar en formato JPG, PNG o WEBP.");
        }
        if (file.size > 12 * 1024 * 1024) {
          throw new Error("La foto " + file.name + " supera el límite de 12 MB.");
        }
        const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const storagePath = currentUser.id + "/jornada-" + jornada.jornadaKey + "-" +
          target.key + "-" + Date.now() + "-" + index + "." + extension;
        const { error: uploadError } = await supabase.storage
          .from("fefutin-jornada-photos")
          .upload(storagePath, file, { contentType: file.type, upsert: false });
        if (uploadError) throw uploadError;
        const { error: insertError } = await supabase.from("fefutin_jornada_photos").insert({
          tournament_id: target.tournament_id,
          turn_id: target.turn_id,
          turn_journey_id: target.turn_journey_id,
          turno: target.turno,
          journey_number: target.journey_number,
          jornada_date: target.jornada_date,
          jornada_label: target.jornada_label,
          referee_id: currentUser.id,
          referee_name: currentUser.username || null,
          storage_path: storagePath,
          original_filename: file.name,
          document_type: target.document_type,
          match_sheet_id: target.match_sheet_id,
          categoria: target.categoria,
        });
        if (insertError) throw insertError;
      }

      setPhotoBatch((current) => ({
        ...current,
        targets: current.targets.map((target) => ({ ...target, uploaded: true })),
        files: [],
        assignments: {},
      }));
      setMessage("Todas las fotos quedaron archivadas. Cerrando la jornada...");
      await archiveJornada(jornada);
    } catch (err) {
      setError("La carga se detuvo para evitar cerrar una jornada incompleta: " +
        (err.message || "Error al guardar una foto.") +
        " Si algunas fotos ya se guardaron, volvé a preparar la carga: el sistema las reconocerá y pedirá solo las faltantes.");
    } finally {
      setUploadingPhotoKey("");
    }
  };

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
      const winner = !withResults || !detail.resultadoCargado ? "—" : detail.score1 > detail.score2 ? detail.team1 : detail.score2 > detail.score1 ? detail.team2 : "Empate";
      const points = withResults && detail.resultadoCargado
        ? `${detail.puntosTeam1 ?? (detail.score1 > detail.score2 ? 3 : detail.score1 < detail.score2 ? 1 : 2)} - ${detail.puntosTeam2 ?? (detail.score2 > detail.score1 ? 3 : detail.score2 < detail.score1 ? 1 : 2)}`
        : "—";
      return `<tr><td>${escapeHtml(detail.categoria)}</td><td>${escapeHtml(detail.team1 || "—")}</td><td class="score">${result}</td><td>${escapeHtml(detail.team2 || "—")}</td><td>${escapeHtml(winner)}</td><td class="score">${points}</td><td>${escapeHtml(referee)}</td></tr>`;
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
      table{width:100%;border-collapse:collapse;margin-top:16px;font-size:8px}th{background:#171c27;color:#fff;text-align:left;padding:8px 6px}
      td{height:34px;padding:6px;border-bottom:1px solid #cfd3da}.score{text-align:center;font-weight:900;white-space:nowrap}
      .signatures{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:42px;text-align:center;font-size:11px;page-break-inside:avoid}
      @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
      </style></head><body><header><div class="brand">FEFUTIN</div><h1>PLANILLA OFICIAL GENERAL DE JORNADA</h1>
      <div class="meta">${escapeHtml(jornada.tournamentTitle)} · Rama ${escapeHtml(jornada.branch)} · Turno ${escapeHtml(jornada.turno)}</div>
      <div class="journey">JORNADA ${escapeHtml(jornada.journeyNumber)} · ${escapeHtml(dateLabel)}</div>
      <div class="meta">${jornada.matchCount} encuentros · ${escapeHtml(jornada.categories.join(" · "))}</div></header>
      <table><thead><tr><th>Categoría</th><th>Local</th><th>Resultado</th><th>Visitante</th><th>Ganador</th><th>Puntos</th><th>Árbitro</th></tr></thead><tbody>${rows}</tbody></table>
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
      puntos_local: jornada.totalPointsTeam1,
      puntos_visitante: jornada.totalPointsTeam2,
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
        const expanded = expandedKey === jornada.jornadaKey;
        const dateLabel = jornada.scheduledDate
          ? new Date(`${jornada.scheduledDate}T12:00:00`).toLocaleDateString("es-AR")
          : "Fecha a confirmar";
        const pendingCount = jornada.details.filter((detail) => !detail.referee_closed).length;
        return (
          <article key={jornada.key} style={{ padding: ".9rem", border: "1px solid #b5122a", borderRadius: "12px", background: "linear-gradient(145deg, #171c27, #090a0e)", color: "#fff" }}>
            <div style={{ textAlign: "center", color: "#f3a0ad", fontWeight: 900, letterSpacing: ".06em" }}>
              JORNADA {jornada.journeyNumber} · {dateLabel}
            </div>
            <h4 style={{ margin: ".45rem 0 .25rem", textAlign: "center", color: "#fff", fontSize: "1rem" }}>{jornada.tournamentTitle}</h4>
            <div style={{ textAlign: "center", color: "#ccc", fontSize: ".78rem" }}>{jornada.branch} · {jornada.turno}</div>
            <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: ".4rem", margin: ".75rem 0" }}>
              <span style={{ border: "1px solid #555", borderRadius: "999px", padding: ".3rem .6rem", fontSize: ".7rem" }}>{jornada.matchCount} encuentros</span>
              <span style={{ border: "1px solid #555", borderRadius: "999px", padding: ".3rem .6rem", fontSize: ".7rem" }}>{jornada.categories.length} categorías</span>
              <span style={{ border: "1px solid #555", borderRadius: "999px", padding: ".3rem .6rem", fontSize: ".7rem" }}>{jornada.partidosJugados} con resultado</span>
              <span style={{ border: "1px solid #555", borderRadius: "999px", padding: ".3rem .6rem", fontSize: ".7rem" }}>{pendingCount} pendientes de cierre</span>
            </div>
            <div style={{ color: archived ? "#86efac" : jornada.legacyPendingReview ? "#fca5a5" : jornada.allClosed ? "#86efac" : "#fcd34d", textAlign: "center", fontSize: ".72rem", fontWeight: 900, marginBottom: ".7rem" }}>
              {archived ? "PLANILLA GENERAL ARCHIVADA" : jornada.legacyPendingReview ? "HAY PARTIDOS ANTIGUOS PENDIENTES DE REVISIÓN" : jornada.allClosed ? "TODOS LOS ENCUENTROS CERRADOS" : `${jornada.assignedMatches.length} PARTIDO(S) ASIGNADO(S) A VOS`}
            </div>
            <button type="button" onClick={() => setExpandedKey(expanded ? "" : jornada.jornadaKey)} aria-expanded={expanded} style={{ width: "100%", padding: ".75rem", border: "1px solid #e05a70", borderRadius: "8px", background: expanded ? "#171c27" : "#b5122a", color: "#fff", fontWeight: 900, letterSpacing: ".05em" }}>
              {expanded ? "OCULTAR PLANILLAS ▲" : "PLANILLAS · VER ENCUENTROS ▼"}
            </button>
            {expanded && (
              <div style={{ display: "grid", gap: ".7rem", marginTop: ".8rem" }}>
                <div style={{ display: "grid", gap: ".45rem" }}>
                  {jornada.details.map((detail) => {
                    const assignedToThisReferee = String(detail.referee_id || "") === String(currentUser?.id || "");
                    const canOpen = assignedToThisReferee || ["admin", "directivo"].includes(String(currentUser?.role || "").toLowerCase());
                    const winner = !detail.resultadoCargado ? "Resultado pendiente" : detail.score1 > detail.score2 ? detail.team1 : detail.score2 > detail.score1 ? detail.team2 : "Empate";
                    const points1 = detail.resultadoCargado ? Number(detail.puntosTeam1 ?? (detail.score1 > detail.score2 ? 3 : detail.score1 < detail.score2 ? 1 : 2)) : null;
                    const points2 = detail.resultadoCargado ? Number(detail.puntosTeam2 ?? (detail.score2 > detail.score1 ? 3 : detail.score2 < detail.score1 ? 1 : 2)) : null;
                    return (
                      <div key={detail.matchId} style={{ display: "grid", gap: ".4rem", padding: ".7rem", background: "#080b10", border: "1px solid #343a40", borderRadius: "8px" }}>
                        <strong style={{ color: "#f3a0ad", fontSize: ".72rem" }}>{detail.categoria}</strong>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: ".45rem", textAlign: "center" }}>
                          <strong style={{ fontSize: ".78rem", overflowWrap: "anywhere" }}>{detail.team1 || "—"}</strong>
                          <strong style={{ color: "#fff", whiteSpace: "nowrap" }}>{detail.score1 == null ? "—" : detail.score1} - {detail.score2 == null ? "—" : detail.score2}</strong>
                          <strong style={{ fontSize: ".78rem", overflowWrap: "anywhere" }}>{detail.team2 || "—"}</strong>
                        </div>
                        <small style={{ color: "#bbb", textAlign: "center" }}>
                          {detail.resultadoCargado ? `${winner} · Puntos: ${points1} - ${points2}` : "Resultado pendiente"}
                          {" · "}{detail.referee_closed ? "ENCUENTRO CERRADO" : assignedToThisReferee ? "PLANILLA PENDIENTE" : detail.referee_id ? "ASIGNADO A OTRO ÁRBITRO" : "SIN ÁRBITRO DESIGNADO"}
                        </small>
                        {detail.venue_address && <small style={{ color: "#9ca3af" }}>Sede: {detail.venue_address}</small>}
                        <button type="button" disabled={!onOpenMatch || !canOpen} onClick={() => onOpenMatch?.(detail)} style={{ width: "100%", padding: ".6rem", border: "1px solid #b5122a", borderRadius: "7px", background: detail.referee_closed ? "#242a32" : canOpen ? "#b5122a" : "#444", color: "#fff", fontWeight: 900, fontSize: ".7rem", cursor: onOpenMatch && canOpen ? "pointer" : "not-allowed", opacity: canOpen ? 1 : .6 }}>
                          {detail.referee_closed ? "VER PLANILLA" : canOpen ? "CARGAR PLANILLA" : "SIN ACCESO"}
                        </button>
                      </div>
                    );
                  })}
                </div>
                <section style={{ padding: ".8rem", background: "#101010", border: "1px solid #b5122a", borderRadius: "9px" }}>
                  <div style={{ color: "#f3a0ad", fontWeight: 900, fontSize: ".78rem", textAlign: "center", letterSpacing: ".06em" }}>RESUMEN GENERAL DE LA JORNADA</div>
                  <div style={{ color: "#ccc", fontSize: ".7rem", textAlign: "center", margin: ".35rem 0 .65rem" }}>Puntaje acumulado de todos los encuentros con resultado cargado.</div>
                  {jornada.teamTotals.length ? (
                    <div style={{ display: "grid", gap: ".35rem" }}>
                      {jornada.teamTotals.map((team) => (
                        <div key={team.equipo} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: ".5rem", alignItems: "center", padding: ".45rem .55rem", background: "#20242c", borderRadius: "6px" }}>
                          <span style={{ fontSize: ".78rem", fontWeight: 800 }}>{team.equipo}</span>
                          <strong style={{ color: "#f3a0ad", fontSize: ".85rem" }}>{team.puntos} pts</strong>
                          <small style={{ gridColumn: "1 / -1", color: "#aaa", fontSize: ".66rem" }}>{team.ganados} ganados · {team.empatados} empatados · {team.perdidos} perdidos</small>
                        </div>
                      ))}
                    </div>
                  ) : <p style={{ margin: 0, color: "#aaa", textAlign: "center", fontSize: ".75rem" }}>Todavía no hay resultados para sumar.</p>}
                  <div style={{ marginTop: ".65rem", display: "flex", justifyContent: "center", gap: ".5rem", flexWrap: "wrap" }}>
                    <button type="button" onClick={() => printJornada(jornada, true)} style={{ padding: ".6rem .7rem", border: "1px solid #777", borderRadius: "7px", background: "#242a32", color: "#fff", fontWeight: 800, fontSize: ".68rem" }}>IMPRIMIR RESUMEN</button>
                    <button type="button" onClick={() => printJornada(jornada, false)} style={{ padding: ".6rem .7rem", border: "1px solid #777", borderRadius: "7px", background: "#242a32", color: "#fff", fontWeight: 800, fontSize: ".68rem" }}>PLANILLA GENERAL</button>
                  </div>
                </section>
                {!archived && (
                  <section style={{ display: "grid", gap: ".6rem", padding: ".8rem", background: "#080b10", border: "1px solid #b5122a", borderRadius: "9px" }}>
                    <strong style={{ color: "#f3a0ad", textAlign: "center", fontSize: ".78rem" }}>CIERRE INSTITUCIONAL · FOTOS DE LA JORNADA</strong>
                    <p style={{ margin: 0, color: "#ccc", fontSize: ".72rem", textAlign: "center" }}>
                      Seleccioná juntas las fotos de cada planilla local y visitante, más la planilla general. Cada foto se vincula con su documento digital.
                    </p>
                    {photoBatch.jornadaKey !== jornada.jornadaKey ? (
                      <button type="button" disabled={!jornada.allClosed || !jornada.assignedMatches.length || preparingPhotoKey === jornada.jornadaKey}
                        onClick={() => preparePhotoBatch(jornada)}
                        style={{ width: "100%", padding: ".7rem", border: "1px solid #b5122a", borderRadius: "8px", background: "#b5122a", color: "#fff", fontWeight: 900 }}>
                        {preparingPhotoKey === jornada.jornadaKey ? "VERIFICANDO PLANILLAS..." : "PREPARAR CARGA DE TODAS LAS FOTOS"}
                      </button>
                    ) : (
                      <>
                        <div style={{ color: "#ddd", fontSize: ".72rem" }}>
                          {photoBatch.targets.filter((target) => target.uploaded).length} de {photoBatch.targets.length} fotos ya archivadas.
                        </div>
                        {photoBatch.targets.filter((target) => !target.uploaded).length > 0 && (
                          <>
                            <label style={{ display: "grid", gap: ".35rem", color: "#fff", fontSize: ".72rem", fontWeight: 800 }}>
                              SELECCIONAR TODAS LAS FOTOS
                              <input type="file" accept="image/jpeg,image/png,image/webp" multiple
                                onChange={(event) => updatePhotoFiles(event.target.files)}
                                style={{ width: "100%", color: "#fff", fontSize: ".72rem" }} />
                            </label>
                            {photoBatch.targets.filter((target) => !target.uploaded).map((target) => (
                              <label key={target.key} style={{ display: "grid", gap: ".3rem", color: "#ddd", fontSize: ".7rem" }}>
                                {target.label}
                                <select value={photoBatch.assignments[target.key] ?? ""}
                                  onChange={(event) => setPhotoBatch((current) => ({
                                    ...current,
                                    assignments: { ...current.assignments, [target.key]: event.target.value },
                                  }))}
                                  style={{ width: "100%", padding: ".55rem", borderRadius: "7px", background: "#fff", color: "#171c27" }}>
                                  <option value="">Elegir foto...</option>
                                  {photoBatch.files.map((file, index) => (
                                    <option key={index} value={String(index)}
                                      disabled={Object.entries(photoBatch.assignments).some(([key, value]) => key !== target.key && value === String(index))}>
                                      {file.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ))}
                          </>
                        )}
                        <button type="button"
                          disabled={Boolean(uploadingPhotoKey || savingKey) || (photoBatch.targets.some((target) => !target.uploaded) && photoBatch.targets.filter((target) => !target.uploaded).some((target) => photoBatch.assignments[target.key] == null))}
                          onClick={() => photoBatch.targets.some((target) => !target.uploaded)
                            ? uploadPhotoBatchAndClose(jornada)
                            : archiveJornada(jornada)}
                          style={{ width: "100%", padding: ".7rem", border: "1px solid #b5122a", borderRadius: "8px", background: "#b5122a", color: "#fff", fontWeight: 900 }}>
                          {uploadingPhotoKey === jornada.jornadaKey ? "SUBIENDO FOTOS..." :
                            photoBatch.targets.some((target) => !target.uploaded) ? "SUBIR FOTOS Y CERRAR JORNADA" : "CERRAR JORNADA Y ARCHIVAR PLANILLA"}
                        </button>
                      </>
                    )}
                  </section>
                )}
                {archived && <div style={{ padding: ".7rem", textAlign: "center", color: "#86efac", fontWeight: 900 }}>JORNADA CERRADA · FOTOS ARCHIVADAS</div>}
              </div>
            )}
          </article>
        );
      })}
      {error && <p role="alert" style={{ color: "#fca5a5", margin: 0 }}>{error}</p>}
      {message && <p role="status" style={{ color: "#86efac", margin: 0 }}>{message}</p>}
    </section>
  );
}
