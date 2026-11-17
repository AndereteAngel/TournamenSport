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
