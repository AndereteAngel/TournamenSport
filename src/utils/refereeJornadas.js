const getTournamentCategory = (tournament) => {
  const explicit = String(tournament?.category_detail || tournament?.category_type || "").trim();
  if (explicit) return explicit;
  const parts = String(tournament?.game || "").split("·").map((part) => part.trim()).filter(Boolean);
  return parts[parts.length - 1] || "Sin categoría";
};

const normalizarEquipo = (valor) => String(valor || "")
  .trim()
  .toLocaleLowerCase("es")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "");

const obtenerRama = (tournament) => {
  const source = [
    tournament?.game,
    tournament?.category_detail,
    tournament?.category_type,
    ...(Array.isArray(tournament?.groups)
      ? tournament.groups.flatMap((group) => group?.category_config || []).map((item) => item?.division)
      : []),
  ].filter(Boolean).join(" ").toLocaleLowerCase("es");

  if (/futsal/.test(source)) return "Futsal";
  if (/femenin|mujer/.test(source)) return "Femenino";
  if (/s[eé]nior|senior|mayores|adult|primera/.test(source)) return "Sénior";
  if (/baby|infantil|formativ/.test(source)) return "Baby fútbol";
  return "Baby fútbol";
};

const obtenerTurno = (tournament) => {
  const parts = String(tournament?.game || "").split("·").map((part) => part.trim().toLocaleLowerCase("es"));
  return parts.some((part) => /fin de semana/.test(part)) ? "Fin de semana" : "Semanal";
};

export const obtenerJornadasDeArbitro = (torneos, refereeId) => {
  if (!refereeId) return [];

  const jornadas = new Map();
  const registrarPartido = (tournament, match, instancia, incluirTodasLasCategorias, ubicacion) => {
    const team1 = String(match?.team1 || "").trim();
    const team2 = String(match?.team2 || "").trim();
    if (!team1 || !team2 ||
        normalizarEquipo(team1) === "pasaje directo" ||
        normalizarEquipo(team2) === "pasaje directo") return;

    const rama = obtenerRama(tournament);
    const propietario = String(tournament?.created_by_user_id || tournament?.created_by || "").trim().toLocaleLowerCase("es");
    const turno = obtenerTurno(tournament);
    const competencia = [
      String(tournament?.title || "Torneo sin nombre").trim().toLocaleLowerCase("es"),
      propietario,
      rama.toLocaleLowerCase("es"),
      turno.toLocaleLowerCase("es"),
    ].join("|");
    const categoria = getTournamentCategory(tournament);
    const cruce = [normalizarEquipo(team1), normalizarEquipo(team2)].sort().join("::");
    const key = competencia + "::" + cruce;
    const asignado = String(match?.referee_id || "") === String(refereeId);

    if (!jornadas.has(key)) {
      if (!incluirTodasLasCategorias && asignado) {
        jornadas.set(key, {
          key,
          torneo: tournament.title || "Torneo sin nombre",
          rama,
          turno,
          propietario,
          etapa: "Jornada de competencia",
          team1,
          team2,
          team1Normalizado: normalizarEquipo(team1),
          team2Normalizado: normalizarEquipo(team2),
          partidos: 0,
          partidosJugados: 0,
          goles: 0,
          puntosTeam1: 0,
          puntosTeam2: 0,
          categoriasSet: new Set(),
          detallesPartidos: [],
        });
      } else {
        return;
      }
    }
    if (!incluirTodasLasCategorias && !asignado) return;

    const jornada = jornadas.get(key);
    const score1 = Number(match?.score1);
    const score2 = Number(match?.score2);
    const resultadoCargado = match?.score1 != null && match?.score2 != null &&
      Number.isFinite(score1) && Number.isFinite(score2);
    const puntosPartidoTeam1 = resultadoCargado ? (score1 > score2 ? 3 : score1 < score2 ? 1 : 2) : 0;
    const puntosPartidoTeam2 = resultadoCargado ? (score2 > score1 ? 3 : score2 < score1 ? 1 : 2) : 0;
    const mismoOrden = normalizarEquipo(team1) === jornada.team1Normalizado;
    const puntosTeam1 = mismoOrden ? puntosPartidoTeam1 : puntosPartidoTeam2;
    const puntosTeam2 = mismoOrden ? puntosPartidoTeam2 : puntosPartidoTeam1;
    const matchId = match?.id == null ? null : String(match.id);
    const clave = String(tournament.id || tournament.title) + "::" +
      String(matchId || instancia + "::" + team1 + "::" + team2);
    if (jornada.detallesPartidos.some((partido) => partido.clave === clave)) return;

    jornada.partidos += 1;
    if (resultadoCargado) {
      jornada.partidosJugados += 1;
      jornada.goles += score1 + score2;
      jornada.puntosTeam1 += puntosTeam1;
      jornada.puntosTeam2 += puntosTeam2;
    }
    jornada.categoriasSet.add(categoria);
    jornada.detallesPartidos.push({
      clave,
      matchId,
      phase: ubicacion.phase,
      groupIndex: ubicacion.groupIndex ?? null,
      roundIndex: ubicacion.roundIndex ?? null,
      round: match?.round || (ubicacion.roundIndex != null ? ubicacion.roundIndex + 1 : null),
      groupName: ubicacion.groupName || instancia,
      categoria,
      team1,
      team2,
      score1: resultadoCargado ? score1 : null,
      score2: resultadoCargado ? score2 : null,
      resultadoCargado,
      puntosTeam1,
      puntosTeam2,
      instancia,
      tournament_id: tournament.id || null,
      referee_id: match?.referee_id || null,
      referee_closed: Boolean(match?.referee_closed),
      fechaOrden: match?.result_loaded_at ? new Date(match.result_loaded_at).getTime() : 0,
    });
  };

  const recorrerPartidos = (incluirTodasLasCategorias) => {
    (torneos || []).forEach((tournament) => {
      (Array.isArray(tournament.groups) ? tournament.groups : []).forEach((group, groupIndex) => {
        if (group?.name === "__INSCRIPCIONES__") return;
        (Array.isArray(group?.matches) ? group.matches : []).forEach((match) =>
          registrarPartido(tournament, match, group?.name || "Fase de grupos", incluirTodasLasCategorias, {
            phase: "groups",
            groupIndex,
            roundIndex: null,
            groupName: group?.name || `Grupo ${groupIndex + 1}`,
          })
        );
      });
      (Array.isArray(tournament.playoffs) ? tournament.playoffs : []).forEach((round, roundIndex) => {
        (Array.isArray(round) ? round : []).forEach((match) =>
          registrarPartido(tournament, match, "Eliminatorias · Ronda " + (roundIndex + 1), incluirTodasLasCategorias, {
            phase: "playoffs",
            groupIndex: null,
            roundIndex,
            groupName: "Eliminatorias · Ronda " + (roundIndex + 1),
          })
        );
      });
    });
  };

  // Primero se identifican las jornadas que tienen al menos un partido asignado.
  recorrerPartidos(false);
  // Luego se agregan los demás partidos de ese mismo cruce y torneo.
  recorrerPartidos(true);

  // También se incluyen las categorías de la rama aunque el fixture de esa categoría
  // todavía no tenga generado el cruce correspondiente.
  jornadas.forEach((jornada) => {
    (torneos || []).forEach((tournament) => {
      const competenciaTorneo = [
        String(tournament?.title || "Torneo sin nombre").trim().toLocaleLowerCase("es"),
        String(tournament?.created_by_user_id || tournament?.created_by || "").trim().toLocaleLowerCase("es"),
        obtenerRama(tournament).toLocaleLowerCase("es"),
        obtenerTurno(tournament).toLocaleLowerCase("es"),
      ].join("|");
      const competenciaJornada = [
        String(jornada.torneo || "Torneo sin nombre").trim().toLocaleLowerCase("es"),
        jornada.propietario,
        jornada.rama.toLocaleLowerCase("es"),
        jornada.turno.toLocaleLowerCase("es"),
      ].join("|");
      if (competenciaTorneo !== competenciaJornada) return;

      const categoria = getTournamentCategory(tournament);
      if (!categoria || categoria === "Sin categoría" || jornada.categoriasSet.has(categoria)) return;
      jornada.categoriasSet.add(categoria);
      jornada.detallesPartidos.push({
        clave: String(tournament.id || tournament.title) + "::categoria-sin-cruce::" + categoria,
        matchId: null,
        phase: null,
        groupIndex: null,
        roundIndex: null,
        round: null,
        groupName: "Pendiente de fixture",
        tournament_id: tournament.id || null,
        categoria,
        team1: jornada.team1,
        team2: jornada.team2,
        score1: null,
        score2: null,
        resultadoCargado: false,
        puntosTeam1: 0,
        puntosTeam2: 0,
        instancia: "Pendiente de fixture",
        referee_id: null,
        referee_closed: false,
        fechaOrden: 0,
      });
    });
  });

  return [...jornadas.values()].map((jornada) => ({
    ...jornada,
    categorias: [...jornada.categoriasSet].sort((a, b) => a.localeCompare(b, "es", { numeric: true })),
    detallesPartidos: jornada.detallesPartidos.sort((a, b) =>
      a.categoria.localeCompare(b.categoria, "es", { numeric: true }) ||
      a.instancia.localeCompare(b.instancia, "es")
    ),
  })).sort((a, b) =>
    a.team1.localeCompare(b.team1, "es") || a.team2.localeCompare(b.team2, "es")
  );
};

export default obtenerJornadasDeArbitro;


// Convierte la respuesta normalizada del RPC en el contrato que consumen
// las tarjetas y planillas generales del árbitro: una fila por jornada completa.
export const normalizarJornadasDeTurno = (rows, refereeId) => {
  return (rows || []).map((row) => {
    const sourceMatches = Array.isArray(row.matches) ? row.matches : [];
    const details = sourceMatches.map((match) => {
      const score1 = match.score1 == null ? null : Number(match.score1);
      const score2 = match.score2 == null ? null : Number(match.score2);
      const resultadoCargado = score1 !== null && score2 !== null &&
        Number.isFinite(score1) && Number.isFinite(score2);
      const puntosTeam1 = resultadoCargado ? (score1 > score2 ? 3 : score1 < score2 ? 1 : 2) : 0;
      const puntosTeam2 = resultadoCargado ? (score2 > score1 ? 3 : score2 < score1 ? 1 : 2) : 0;
      return {
        id: String(match.id),
        clave: String(match.id),
        matchId: String(match.id),
        normalizedMatchId: String(match.id),
        phase: "normalized",
        legacy_phase: match.legacy_phase || null,
        legacy_group_index: match.legacy_group_index ?? null,
        legacy_source_match_id: match.legacy_source_match_id || null,
        legacy_pending_review: Boolean(match.legacy_pending_review),
        round_id: match.round_id || null,
        turn_id: match.turn_id || row.turn_id,
        turno: row.turno || null,
        turn_journey_id: row.turn_journey_id || null,
        journey_number: row.journey_number || null,
        scheduled_date: match.match_date || row.scheduled_date || null,
        tournament_category_id: match.tournament_category_id || null,
        categoria: match.category || match.categoria || "Sin categoría",
        category_id: match.category_id || null,
        team1: match.team1 || "",
        team2: match.team2 || "",
        score1: resultadoCargado ? score1 : null,
        score2: resultadoCargado ? score2 : null,
        resultadoCargado,
        referee_id: match.referee_id || null,
        referee_name: match.referee_name || null,
        referee_closed: Boolean(match.referee_closed),
        referee_closed_at: match.referee_closed_at || null,
        round: match.round || row.journey_number || null,
        groupName: match.groupName || `Jornada ${row.journey_number || ""}`.trim(),
        instancia: "Jornada normalizada",
        tournament_id: row.tournament_id,
        venue_address: match.venue_address || "",
        scheduled_time: match.scheduled_time || null,
        puntosTeam1,
        puntosTeam2,
      };
    });
    const assignedMatches = details.filter((detail) => String(detail.referee_id || "") === String(refereeId || ""));
    const categories = [...new Set(details.map((detail) => detail.categoria))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
    const closedMatches = details.filter((detail) => detail.referee_closed).length;
    const playedMatches = details.filter((detail) => detail.resultadoCargado).length;
    const goals = details.reduce((total, detail) =>
      total + (detail.resultadoCargado ? detail.score1 + detail.score2 : 0), 0);
    return {
      key: String(row.turn_journey_id),
      jornadaKey: String(row.turn_journey_id),
      turn_journey_id: row.turn_journey_id,
      turn_id: row.turn_id,
      tournament_id: row.tournament_id,
      torneo: row.tournament_title || "Torneo FEFUTIN",
      rama: row.branch_name || "Sin rama",
      turno: row.turno || "Sin turno",
      journey_number: row.journey_number,
      scheduled_date: row.scheduled_date || null,
      etapa: "Jornada general",
      team1: "JORNADA COMPLETA",
      team2: "",
      team1Normalizado: "jornada completa",
      team2Normalizado: "",
      partidos: details.length,
      partidosJugados: playedMatches,
      partidosCerrados: closedMatches,
      partidosAsignados: assignedMatches.length,
      goles: goals,
      puntosTeam1: 0,
      puntosTeam2: 0,
      categorias,
      detallesPartidos: details,
      referee_id: refereeId || assignedMatches[0]?.referee_id || null,
    };
  }).filter((journey) =>
    journey.detallesPartidos.length > 0 &&
    journey.detallesPartidos.some((detail) => String(detail.referee_id || "") === String(refereeId || ""))
  ).sort((a, b) =>
    String(a.scheduled_date || "").localeCompare(String(b.scheduled_date || "")) ||
    Number(a.journey_number || 0) - Number(b.journey_number || 0)
  );
};
