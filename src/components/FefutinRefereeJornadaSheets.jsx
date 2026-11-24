import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
const normalizeTeamName = (value) => String(value || "").trim().toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const getClosedMatchPoints = (detail, side) => {
  if (!detail?.resultadoCargado || !detail?.referee_closed) return 0;
  const score1 = Number(detail.score1);
  const score2 = Number(detail.score2);
  if (!Number.isFinite(score1) || !Number.isFinite(score2)) return 0;
  if (side === "local") return Number(detail.puntosTeam1 ?? (score1 > score2 ? 3 : score1 < score2 ? 1 : 2));
  return Number(detail.puntosTeam2 ?? (score2 > score1 ? 3 : score2 < score1 ? 1 : 2));
};

const buildCategoryTotals = (details) => {
  const totals = new Map();
  const add = (name, clubId, points) => {
    const equipo = String(name || "").trim();
    if (!equipo) return;
    const key = clubId ? "club:" + String(clubId) : "name:" + normalizeTeamName(equipo);
    const current = totals.get(key) || { clubId: clubId || null, equipo, puntos: 0 };
    current.puntos += points;
    totals.set(key, current);
  };
  details.forEach((detail) => {
    if (!detail.resultadoCargado || !detail.referee_closed) return;
    add(detail.team1, detail.local_club_id, getClosedMatchPoints(detail, "local"));
    add(detail.team2, detail.visitor_club_id, getClosedMatchPoints(detail, "visitante"));
  });
  return [...totals.values()].sort((a, b) => b.puntos - a.puntos || a.equipo.localeCompare(b.equipo, "es"));
};
const buildTurnStandings = (competition) => {
  const teams = new Map();
  const getTeam = (clubId, name) => {
    const label = String(name || "").trim();
    const key = clubId ? "club:" + String(clubId) : "name:" + normalizeTeamName(label);
    if (!label || key === "name:") return null;
    if (!teams.has(key)) teams.set(key, { clubId: clubId || null, equipo: label, puntos: 0, partidos: 0, ganados: 0, empatados: 0, perdidos: 0, golesFavor: 0, golesContra: 0 });
    return teams.get(key);
  };
  (competition?.categories || []).forEach((category) => (category.rounds || []).forEach((round) => (round.matches || []).forEach((match) => {
    if (match.status !== "finalizado" && !match.referee_closed) return;
    if (match.score1 == null || match.score2 == null) return;
    const a = Number(match.score1), b = Number(match.score2);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return;
    const local = getTeam(match.local_club_id, match.team1);
    const visitor = getTeam(match.visitor_club_id, match.team2);
    if (!local || !visitor) return;
    local.partidos++; visitor.partidos++;
    local.golesFavor += a; local.golesContra += b;
    visitor.golesFavor += b; visitor.golesContra += a;
    if (a > b) { local.puntos += 3; local.ganados++; visitor.puntos += 1; visitor.perdidos++; }
    else if (a < b) { visitor.puntos += 3; visitor.ganados++; local.puntos += 1; local.perdidos++; }
    else { local.puntos += 2; visitor.puntos += 2; local.empatados++; visitor.empatados++; }
  })));
  return [...teams.values()].sort((a,b) => b.puntos-a.puntos || (b.golesFavor-b.golesContra)-(a.golesFavor-a.golesContra) || b.golesFavor-a.golesFavor || a.equipo.localeCompare(b.equipo,"es"));
};

export function FefutinRefereeJornadaSheets({ jornadas = [], currentUser, onOpenMatch }) {
  const [savedKeys, setSavedKeys] = useState(() => new Set());
  const [savingKey, setSavingKey] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [archiveLoaded, setArchiveLoaded] = useState(false);
  const [expandedKey, setExpandedKey] = useState("");
  const [generalViewKey, setGeneralViewKey] = useState("");
  const [photoBatch, setPhotoBatch] = useState({ jornadaKey: "", targets: [], files: [], assignments: {} });
  const [preparingPhotoKey, setPreparingPhotoKey] = useState("");
  const [uploadingPhotoKey, setUploadingPhotoKey] = useState("");
  const [turnStandingsById, setTurnStandingsById] = useState({});
  const [turnStandingsErrors, setTurnStandingsErrors] = useState({});

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
    const getJourneyTeamKey = (clubId, name) => clubId ? "club:" + String(clubId) : "name:" + normalizeTeamName(name);
    details.forEach((detail) => {
      if (!detail.resultadoCargado || !detail.referee_closed) return;
      const addTeamPoints = (name, clubId, points) => {
        const teamName = String(name || "").trim();
        if (!teamName) return null;
        const key = getJourneyTeamKey(clubId, teamName);
        const current = teamTotalsMap.get(key) || { clubId: clubId || null, equipo: teamName, puntos: 0, partidos: 0, ganados: 0, empatados: 0, perdidos: 0 };
        current.puntos += Number(points) || 0;
        current.partidos += 1;
        teamTotalsMap.set(key, current);
        return key;
      };
      const localKey = addTeamPoints(detail.team1, detail.local_club_id, detail.puntosTeam1 ?? (detail.score1 > detail.score2 ? 3 : detail.score1 < detail.score2 ? 1 : 2));
      const visitorKey = addTeamPoints(detail.team2, detail.visitor_club_id, detail.puntosTeam2 ?? (detail.score2 > detail.score1 ? 3 : detail.score2 < detail.score1 ? 1 : 2));
      const local = localKey ? teamTotalsMap.get(localKey) : null;
      const visitante = visitorKey ? teamTotalsMap.get(visitorKey) : null;
      if (local && visitante) {
        if (detail.score1 > detail.score2) { local.ganados += 1; visitante.perdidos += 1; }
        else if (detail.score1 < detail.score2) { visitante.ganados += 1; local.perdidos += 1; }
        else { local.empatados += 1; visitante.empatados += 1; }
      }
    });
    const teamTotals = [...teamTotalsMap.values()].sort((a, b) =>
      b.puntos - a.puntos || a.equipo.localeCompare(b.equipo, "es")
    );
    const totalPointsTeam1 = details.reduce((sum, detail) =>
      sum + (detail.resultadoCargado ? Number(detail.puntosTeam1 ?? (detail.score1 > detail.score2 ? 3 : detail.score1 < detail.score2 ? 1 : 2)) : 0), 0);
    const totalPointsTeam2 = details.reduce((sum, detail) =>
      sum + (detail.resultadoCargado ? Number(detail.puntosTeam2 ?? (detail.score2 > detail.score1 ? 3 : detail.score2 < detail.score1 ? 1 : 2)) : 0), 0);
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
    const ids = [...new Set(planillas.map((j) => j.turnId).filter(Boolean).map(String))];
    if (!ids.length) { setTurnStandingsById({}); setTurnStandingsErrors({}); return () => { active = false; }; }
    Promise.all(ids.map(async (turnId) => { const { data, error } = await supabase.rpc("get_fefutin_turn_competition", { p_turn_id: turnId }); return { turnId, data, error }; }))
      .then((results) => { if (!active) return; const next = {}, errors = {}; results.forEach(({turnId,data,error}) => { if (error) errors[turnId] = error.message || "No se pudo cargar la tabla acumulada."; else next[turnId] = buildTurnStandings(data); }); setTurnStandingsById(next); setTurnStandingsErrors(errors); });
    return () => { active = false; };
  }, [planillas.map((j) => j.turnId || "").filter(Boolean).sort().join("|")]);

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
        pendingTargets.some((target) => photoBatch.assignments[target.key] == null || photoBatch.assignments[target.key] === "") ||
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

  const printJornada = (jornada, mode) => {
    const isGeneral = mode === "general";
    const standings = turnStandingsById[String(jornada.turnId)] || [];
    const popup = window.open("", "_blank", "width=1100,height=800");
    if (!popup) {
      setError("El navegador bloqueó la impresión. Permití las ventanas emergentes para imprimir la planilla.");
      return;
    }
    const escapeHtml = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
    })[character]);
    const rows = jornada.details.map((detail) => {
      const hasResult = Boolean(detail.resultadoCargado);
      const result = hasResult ? String(detail.score1) + " - " + String(detail.score2) : "Pendiente";
      const referee = detail.referee_name || (detail.referee_id ? "Árbitro designado" : "Sin designar");
      const winner = !hasResult ? "—" : detail.score1 > detail.score2 ? detail.team1 : detail.score2 > detail.score1 ? detail.team2 : "Empate";
      const points = hasResult
        ? (detail.team1 || "Local") + ": " + (detail.puntosTeam1 ?? (detail.score1 > detail.score2 ? 3 : detail.score1 < detail.score2 ? 1 : 2)) + " pts · " + (detail.team2 || "Visitante") + ": " + (detail.puntosTeam2 ?? (detail.score2 > detail.score1 ? 3 : detail.score2 < detail.score1 ? 1 : 2)) + " pts"
        : "—";
      return "<tr><td>" + escapeHtml(detail.categoria) + "</td><td>" + escapeHtml(detail.team1 || "—") + "</td><td class=\"score\">" + escapeHtml(result) + "</td><td>" + escapeHtml(detail.team2 || "—") + "</td><td>" + escapeHtml(winner) + "</td><td>" + escapeHtml(points) + "</td><td>" + escapeHtml(referee) + "</td></tr>";
    }).join("");
    const standingsRows = standings.map((team, index) =>
      "<tr><td>" + (index + 1) + "</td><td>" + escapeHtml(team.equipo) + "</td><td>" + team.puntos + "</td><td>" + team.partidos + "</td><td>" + team.ganados + "</td><td>" + team.empatados + "</td><td>" + team.perdidos + "</td><td>" + team.golesFavor + "</td><td>" + team.golesContra + "</td><td>" + (team.golesFavor - team.golesContra) + "</td></tr>"
    ).join("");
    const dateLabel = jornada.scheduledDate
      ? new Date(jornada.scheduledDate + "T12:00:00").toLocaleDateString("es-AR")
      : "Fecha a confirmar";
    const signatures = isGeneral ? "<div class=\"signatures\"><div>Firma de árbitro/s<br><br>____________________________</div><div>Firma de responsable de jornada<br><br>____________________________</div></div>" : "";
    const generalBlock = isGeneral
      ? "<h2>TABLA GENERAL ACUMULADA · " + escapeHtml(jornada.branch) + " · " + escapeHtml(jornada.turno) + "</h2><div class=\"meta\">Acumulado de todos los partidos finalizados de todas las categorías y jornadas de este turno.</div><table><thead><tr><th>Pos.</th><th>Club</th><th>PTS</th><th>PJ</th><th>PG</th><th>PE</th><th>PP</th><th>GF</th><th>GC</th><th>DIF</th></tr></thead><tbody>" + (standingsRows || "<tr><td colspan=\"10\">Todavía no hay resultados acumulados.</td></tr>") + "</tbody></table>" + (turnStandingsErrors[String(jornada.turnId)] ? "<p>" + escapeHtml(turnStandingsErrors[String(jornada.turnId)]) + "</p>" : "") + signatures
      : "";
    popup.document.open();
    popup.document.write("<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\"><title>" + (isGeneral ? "Planilla general digital" : "Resumen de jornada") + " FEFUTIN</title><style>" +
      "@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#171c27;margin:0}" +
      "header{border-bottom:4px solid #b5122a;padding-bottom:10px;margin-bottom:14px}.brand{color:#b5122a;font-weight:900;letter-spacing:3px;font-size:13px}" +
      "h1{font-size:19px;margin:7px 0 5px}.meta{font-size:10px;color:#555}.journey{font-size:14px;font-weight:900;margin-top:8px}h2{font-size:13px;margin:18px 0 7px;color:#b5122a}" +
      "table{width:100%;border-collapse:collapse;margin-top:8px;font-size:8px}th{background:#171c27;color:#fff;text-align:left;padding:7px 5px}td{padding:6px 5px;border-bottom:1px solid #cfd3da}.score{text-align:center;font-weight:900;white-space:nowrap}" +
      ".signatures{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:32px;text-align:center;font-size:10px;page-break-inside:avoid}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}" +
      "</style></head><body><header><div class=\"brand\">FEFUTIN</div><h1>" + (isGeneral ? "PLANILLA DIGITAL GENERAL DE JORNADA" : "RESUMEN DE JORNADA") + "</h1>" +
      "<div class=\"meta\">" + escapeHtml(jornada.tournamentTitle) + " · Rama " + escapeHtml(jornada.branch) + " · Turno " + escapeHtml(jornada.turno) + "</div>" +
      "<div class=\"journey\">JORNADA " + escapeHtml(jornada.journeyNumber) + " · " + escapeHtml(dateLabel) + "</div><div class=\"meta\">" + jornada.matchCount + " encuentros · " + escapeHtml(jornada.categories.join(" · ")) + " · " + jornada.partidosJugados + " partidos con resultado</div></header>" +
      "<h2>ENCUENTROS DE LA JORNADA</h2><table><thead><tr><th>Categoría</th><th>Local</th><th>Resultado</th><th>Visitante</th><th>Ganador</th><th>Puntos por equipo</th><th>Árbitro</th></tr></thead><tbody>" + rows + "</tbody></table>" + generalBlock + "</body></html>");
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
    <section style={{ display: "grid", gap: ".75rem", margin: "1rem 0", width: "100%", minWidth: 0, boxSizing: "border-box" }}>
      <h3 style={{ margin: ".2rem 0", color: "#fff", fontSize: ".9rem", letterSpacing: ".05em" }}>PLANILLAS GENERALES POR JORNADA</h3>
      <p style={{ color: "#bbb", fontSize: ".78rem", margin: 0 }}>Cada planilla reúne todos los encuentros de la misma jornada y turno, aunque pertenezcan a categorías distintas. Cada partido conserva su planilla individual.</p>
      {planillas.map((jornada) => {
        const archived = savedKeys.has(jornada.jornadaKey);
        const expanded = expandedKey === jornada.jornadaKey;
        const dateLabel = jornada.scheduledDate
          ? new Date(`${jornada.scheduledDate}T12:00:00`).toLocaleDateString("es-AR")
          : "Fecha a confirmar";
        const pendingCount = jornada.details.filter((detail) => !detail.referee_closed).length;
        const configuredCategories = Array.isArray(jornada.categories) ? jornada.categories : [];
        const journeyCategories = [...new Set([
          ...configuredCategories,
          ...jornada.details.map((detail) => detail.categoria || "Sin categoría"),
        ])].sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
        const journeyMatchups = [];
        jornada.details.forEach((detail) => {
          const localName = String(detail.team1 || "Local").trim();
          const visitorName = String(detail.team2 || "Visitante").trim();
          const localKey = detail.local_club_id ? "club:" + detail.local_club_id : "name:" + normalizeTeamName(localName);
          const visitorKey = detail.visitor_club_id ? "club:" + detail.visitor_club_id : "name:" + normalizeTeamName(visitorName);
          const key = localKey + "::" + visitorKey;
          let matchup = journeyMatchups.find((item) => item.key === key);
          if (!matchup) {
            matchup = { key, localName, visitorName, details: [] };
            journeyMatchups.push(matchup);
          }
          matchup.details.push(detail);
        });
        return (
          <article key={jornada.key} style={{ width: "100%", minWidth: 0, boxSizing: "border-box", padding: ".9rem", border: "1px solid #b5122a", borderRadius: "12px", background: "linear-gradient(145deg, #171c27, #090a0e)", color: "#fff" }}>
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
                          {detail.resultadoCargado ? `${winner} · ${detail.team1}: ${points1} pts · ${detail.team2}: ${points2} pts` : "Resultado pendiente"}
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
                  <section style={{ marginTop: ".7rem", padding: ".7rem", border: "1px solid #555", borderRadius: "7px", background: "#171c27" }}>
                    <strong style={{ display: "block", color: "#f3a0ad", textAlign: "center", fontSize: ".74rem" }}>PUNTOS TOTALES · {jornada.branch} · {jornada.turno}</strong>
                    <small style={{ display: "block", color: "#bbb", textAlign: "center", margin: ".25rem 0 .55rem", fontSize: ".65rem" }}>Acumulado de todas las categorías y jornadas de este turno.</small>
                    {turnStandingsErrors[String(jornada.turnId)] ? <p role="alert" style={{ color: "#fca5a5", fontSize: ".7rem", margin: 0 }}>{turnStandingsErrors[String(jornada.turnId)]}</p> : (turnStandingsById[String(jornada.turnId)] || []).length ?
                      <div style={{ display: "grid", gap: ".3rem" }}>{(turnStandingsById[String(jornada.turnId)] || []).map((team, index) => <div key={normalizeTeamName(team.equipo)} style={{ display: "grid", gridTemplateColumns: "24px minmax(0,1fr) auto", gap: ".4rem", alignItems: "center", padding: ".4rem", background: "#20242c", borderRadius: "5px" }}><strong style={{ color: "#f3a0ad", fontSize: ".72rem" }}>{index + 1}.</strong><span style={{ fontSize: ".74rem", fontWeight: 800 }}>{team.equipo}</span><strong style={{ color: "#f3a0ad", fontSize: ".82rem" }}>{team.puntos} pts</strong></div>)}</div>
                      : <p style={{ color: "#aaa", fontSize: ".7rem", textAlign: "center", margin: 0 }}>Todavía no hay puntos acumulados.</p>}
                  </section>
                  <div style={{ marginTop: ".65rem", display: "flex", justifyContent: "center", gap: ".5rem", flexWrap: "wrap" }}>
                    <button type="button" onClick={() => printJornada(jornada, "summary")} style={{ padding: ".6rem .7rem", border: "1px solid #777", borderRadius: "7px", background: "#242a32", color: "#fff", fontWeight: 800, fontSize: ".68rem" }}>IMPRIMIR RESUMEN</button>
                    <button type="button" onClick={() => setGeneralViewKey(generalViewKey === jornada.jornadaKey ? "" : jornada.jornadaKey)} aria-expanded={generalViewKey === jornada.jornadaKey} style={{ padding: ".6rem .7rem", border: "1px solid #b5122a", borderRadius: "7px", background: "#b5122a", color: "#fff", fontWeight: 900, fontSize: ".68rem" }}>{generalViewKey === jornada.jornadaKey ? "CERRAR PLANILLA GENERAL" : "PLANILLA GENERAL"}</button>
                  </div>
                </section>

                {generalViewKey === jornada.jornadaKey && (
                  <section
                    aria-label="Planilla general digital de la jornada"
                    style={{
                      display: "grid",
                      gap: "1rem",
                      width: "100%",
                      minWidth: 0,
                      boxSizing: "border-box",
                      marginTop: ".25rem",
                      padding: "clamp(.75rem, 2.5vw, 1.2rem)",
                      border: "1px solid #cbd0d8",
                      borderRadius: "12px",
                      background: "#f4f5f7",
                      color: "#171c27",
                    }}
                  >
                    <header style={{ padding: "1rem", borderRadius: "9px", background: "#171c27", color: "#fff", textAlign: "center" }}>
                      <div style={{ color: "#ffb6c1", fontWeight: 900, letterSpacing: ".16em", fontSize: ".72rem" }}>FEFUTIN</div>
                      <strong style={{ display: "block", margin: ".3rem 0", fontSize: "clamp(1.05rem, 3.5vw, 1.35rem)" }}>PLANILLA GENERAL DE JORNADA</strong>
                      <div style={{ color: "#fff", fontSize: ".86rem", lineHeight: 1.5 }}>{jornada.tournamentTitle} · {jornada.branch}</div>
                      <div style={{ color: "#e5e7eb", fontSize: ".8rem", marginTop: ".2rem" }}>Turno: {jornada.turno} · Jornada {jornada.journeyNumber} · {dateLabel}</div>
                    </header>

                    <section style={{ display: "grid", gap: ".9rem", minWidth: 0 }}>
                      <div>
                        <strong style={{ display: "block", color: "#171c27", fontSize: ".95rem" }}>RESUMEN DE RESULTADOS POR CATEGORÍA</strong>
                        <span style={{ display: "block", color: "#4b5563", fontSize: ".78rem", marginTop: ".15rem" }}>Los resultados y puntos se actualizan al cerrar cada partido.</span>
                      </div>
                      {journeyMatchups.length ? journeyMatchups.map((matchup) => {
                        let localTotal = 0;
                        let visitorTotal = 0;
                        const categoryRows = journeyCategories.map((category) => {
                          const categoryDetails = matchup.details.filter((detail) =>
                            (detail.categoria || "Sin categoría") === category
                          );
                          const completedDetails = categoryDetails.filter((detail) =>
                            detail.resultadoCargado && detail.referee_closed &&
                            Number.isFinite(Number(detail.score1)) && Number.isFinite(Number(detail.score2))
                          );
                          const goalsLocal = completedDetails.reduce((sum, detail) => sum + Number(detail.score1), 0);
                          const goalsVisitor = completedDetails.reduce((sum, detail) => sum + Number(detail.score2), 0);
                          const pointsLocal = completedDetails.reduce((sum, detail) => sum + getClosedMatchPoints(detail, "local"), 0);
                          const pointsVisitor = completedDetails.reduce((sum, detail) => sum + getClosedMatchPoints(detail, "visitante"), 0);
                          localTotal += pointsLocal;
                          visitorTotal += pointsVisitor;
                          return { category, hasResult: completedDetails.length > 0, goalsLocal, goalsVisitor, pointsLocal, pointsVisitor };
                        });
                        return (
                          <section key={matchup.key} style={{ display: "grid", gap: ".55rem", padding: ".85rem", border: "1px solid #d5d9df", borderRadius: "9px", background: "#fff", color: "#171c27", minWidth: 0 }}>
                            <strong style={{ color: "#171c27", fontSize: ".95rem", textAlign: "center", overflowWrap: "anywhere" }}>
                              {matchup.localName} <span style={{ color: "#b5122a" }}>VS.</span> {matchup.visitorName}
                            </strong>
                            <div style={{ display: "grid", gridTemplateColumns: "minmax(5.2rem, 1.2fr) minmax(3.1rem, .7fr) repeat(2, minmax(3.5rem, .8fr))", gap: ".25rem", alignItems: "center", minWidth: 0, padding: ".45rem .25rem", background: "#171c27", color: "#fff", borderRadius: "6px" }}>
                              <strong style={{ fontSize: ".64rem", color: "#fff" }}>CATEGORÍA</strong>
                              <strong style={{ fontSize: ".62rem", color: "#fff", textAlign: "center" }}>RESULT.</strong>
                              <strong style={{ fontSize: ".62rem", color: "#fff", textAlign: "center" }}>LOCAL</strong>
                              <strong style={{ fontSize: ".62rem", color: "#fff", textAlign: "center" }}>VISIT.</strong>
                            </div>
                            {categoryRows.map((row) => (
                              <div key={row.category} style={{ display: "grid", gridTemplateColumns: "minmax(5.2rem, 1.2fr) minmax(3.1rem, .7fr) repeat(2, minmax(3.5rem, .8fr))", gap: ".25rem", alignItems: "center", minWidth: 0, padding: ".5rem .25rem", borderBottom: "1px solid #e5e7eb" }}>
                                <strong style={{ color: "#171c27", fontSize: ".75rem", overflowWrap: "anywhere" }}>{row.category}</strong>
                                <strong style={{ color: row.hasResult ? "#171c27" : "#9ca3af", fontSize: ".8rem", textAlign: "center", whiteSpace: "nowrap" }}>
                                  {row.hasResult ? row.goalsLocal + " - " + row.goalsVisitor : "—"}
                                </strong>
                                <strong style={{ color: row.hasResult ? "#b5122a" : "#9ca3af", fontSize: ".75rem", textAlign: "center", whiteSpace: "nowrap" }}>
                                  {row.hasResult ? row.pointsLocal + " pts" : "—"}
                                </strong>
                                <strong style={{ color: row.hasResult ? "#b5122a" : "#9ca3af", fontSize: ".75rem", textAlign: "center", whiteSpace: "nowrap" }}>
                                  {row.hasResult ? row.pointsVisitor + " pts" : "—"}
                                </strong>
                              </div>
                            ))}
                            <div style={{ display: "grid", gridTemplateColumns: "minmax(5.2rem, 1.2fr) minmax(3.1rem, .7fr) repeat(2, minmax(3.5rem, .8fr))", gap: ".25rem", alignItems: "center", padding: ".65rem .25rem", borderTop: "2px solid #b5122a", background: "#fff0f2", borderRadius: "5px" }}>
                              <strong style={{ color: "#171c27", fontSize: ".78rem" }}>TOTAL</strong>
                              <span />
                              <strong style={{ color: "#b5122a", fontSize: ".82rem", textAlign: "center" }}>{localTotal} pts</strong>
                              <strong style={{ color: "#b5122a", fontSize: ".82rem", textAlign: "center" }}>{visitorTotal} pts</strong>
                            </div>
                          </section>
                        );
                      }) : (
                        <section style={{ padding: ".9rem", border: "1px solid #d5d9df", borderRadius: "9px", background: "#fff", color: "#4b5563", textAlign: "center", fontSize: ".8rem" }}>
                          Todavía no hay enfrentamientos cargados para esta jornada.
                        </section>
                      )}
                    </section>

                    <section style={{ display: "grid", gap: ".55rem", padding: ".9rem", borderRadius: "9px", background: "#171c27", color: "#fff" }}>
                      <strong style={{ color: "#fff", fontSize: ".9rem" }}>TABLA GENERAL DEL TURNO</strong>
                      <span style={{ color: "#e5e7eb", fontSize: ".76rem", lineHeight: 1.4 }}>Acumulado de todas las jornadas de {jornada.branch} · {jornada.turno}.</span>
                      {turnStandingsErrors[String(jornada.turnId)] ? (
                        <p role="alert" style={{ color: "#fecaca", fontSize: ".78rem", margin: 0 }}>{turnStandingsErrors[String(jornada.turnId)]}</p>
                      ) : (turnStandingsById[String(jornada.turnId)] || []).length ? (
                        <div style={{ display: "grid", gap: ".35rem" }}>
                          {(turnStandingsById[String(jornada.turnId)] || []).map((team, index) => (
                            <div key={team.clubId || normalizeTeamName(team.equipo)} style={{ display: "grid", gridTemplateColumns: "28px minmax(0,1fr) auto", alignItems: "center", gap: ".5rem", padding: ".55rem .6rem", borderRadius: "6px", background: index === 0 ? "#b5122a" : "#252b35", color: "#fff" }}>
                              <strong style={{ color: "#fff", fontSize: ".8rem" }}>{index + 1}.</strong>
                              <span style={{ color: "#fff", fontSize: ".82rem", fontWeight: 800, overflowWrap: "anywhere" }}>{team.equipo}</span>
                              <strong style={{ color: "#fff", fontSize: ".9rem", whiteSpace: "nowrap" }}>{team.puntos} pts</strong>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p style={{ color: "#fff", fontSize: ".78rem", margin: 0 }}>Todavía no hay puntos acumulados para este turno.</p>
                      )}
                    </section>

                    <button type="button" onClick={() => setGeneralViewKey("")} style={{ width: "100%", padding: ".8rem", border: 0, borderRadius: "7px", background: "#b5122a", color: "#fff", fontWeight: 900, fontSize: ".85rem" }}>VOLVER A MIS DESIGNACIONES</button>
                  </section>
                )}
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
                          disabled={Boolean(uploadingPhotoKey || savingKey) || (photoBatch.targets.some((target) => !target.uploaded) && photoBatch.targets.filter((target) => !target.uploaded).some((target) => photoBatch.assignments[target.key] == null || photoBatch.assignments[target.key] === ""))}
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
