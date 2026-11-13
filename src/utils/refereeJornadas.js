const getTournamentCategory = (tournament) => {
  const explicit = String(tournament?.category_detail || tournament?.category_type || "").trim();
  if (explicit) return explicit;
  const parts = String(tournament?.game || "").split("·").map((part) => part.trim());
  return parts.length > 1 ? parts[parts.length - 1] : "Sin categoría";
};

export const obtenerJornadasDeArbitro = (torneos, refereeId) => {
    const normalizarEquipo = (valor) => String(valor || "").trim().toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const obtenerRama = (tournament) => {
      const partes = String(tournament?.game || "").split("·").map((parte) => parte.trim());
      const ramaExplicita = partes.find((parte) => ["Infantil", "Femenino", "Mayores"].includes(parte));
      if (ramaExplicita) return ramaExplicita;
      const referencia = (String(tournament?.game || "") + " " + String(tournament?.category_detail || "")).toLocaleLowerCase("es");
      if (/femenin|mujer/.test(referencia)) return "Femenino";
      if (/mayor|adult|senior|primera/.test(referencia)) return "Mayores";
      return "Infantil";
    };
    const jornadas = new Map();
    const registrarPartido = (tournament, match, instancia, incluirTodasLasCategorias = false) => {
      const team1 = String(match?.team1 || "").trim();
      const team2 = String(match?.team2 || "").trim();
      if (!team1 || !team2 ||
          normalizarEquipo(team1) === "pasaje directo" || normalizarEquipo(team2) === "pasaje directo") return;
      const rama = obtenerRama(tournament);
      const propietario = String(tournament?.created_by_user_id || tournament?.created_by || "").trim().toLocaleLowerCase("es");
      const competencia = [String(tournament?.title || "Torneo sin nombre").trim().toLocaleLowerCase("es"), propietario, rama.toLocaleLowerCase("es")].join("|");
      const categoriaPartes = String(tournament?.game || "").split("·").map((parte) => parte.trim());
      const categoria = String(tournament?.category_detail || categoriaPartes[categoriaPartes.length - 1] || getTournamentCategory(tournament) || "Sin categoría").trim();
      const cruce = [normalizarEquipo(team1), normalizarEquipo(team2)].sort().join("::");
      // Primero se identifican las jornadas asignadas al árbitro; luego se completan
      // con los partidos de todas las categorías de ese mismo torneo y enfrentamiento.
      const key = competencia + "::" + cruce;
      if (!jornadas.has(key)) {
        if (!incluirTodasLasCategorias && match?.referee_id === refereeId) {
          jornadas.set(key, {
            key, torneo: tournament.title || "Torneo sin nombre", rama, propietario, etapa: "Jornada de competencia",
            team1, team2, team1Normalizado: normalizarEquipo(team1), team2Normalizado: normalizarEquipo(team2),
            partidos: 0, partidosJugados: 0, goles: 0, puntosTeam1: 0, puntosTeam2: 0,
            categoriasSet: new Set(), detallesPartidos: [],
          });
        } else {
          return;
        }
      }
      if (!incluirTodasLasCategorias && match?.referee_id !== refereeId) return;
      const jornada = jornadas.get(key);
      const score1 = Number(match?.score1);
      const score2 = Number(match?.score2);
      const resultadoCargado = match?.score1 != null && match?.score2 != null && Number.isFinite(score1) && Number.isFinite(score2);
      const puntosPartidoTeam1 = resultadoCargado ? (score1 > score2 ? 3 : score1 < score2 ? 1 : 2) : 0;
      const puntosPartidoTeam2 = resultadoCargado ? (score2 > score1 ? 3 : score2 < score1 ? 1 : 2) : 0;
      const mismoOrden = normalizarEquipo(team1) === jornada.team1Normalizado;
      const puntosTeam1 = mismoOrden ? puntosPartidoTeam1 : puntosPartidoTeam2;
      const puntosTeam2 = mismoOrden ? puntosPartidoTeam2 : puntosPartidoTeam1;
      const clave = String(tournament.id || tournament.title) + "::" + String(match.id || instancia + "::" + team1 + "::" + team2);
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
        clave, categoria, team1, team2, score1: resultadoCargado ? score1 : null, score2: resultadoCargado ? score2 : null,
        resultadoCargado, puntosTeam1, puntosTeam2, instancia,
        tournament_id: tournament.id || null, referee_id: match?.referee_id || null,
        referee_closed: Boolean(match?.referee_closed),
        fechaOrden: match?.result_loaded_at ? new Date(match.result_loaded_at).getTime() : 0,
      });
    };
    const recorrerPartidos = (incluirTodasLasCategorias) => {
      torneos.forEach((tournament) => {
        (Array.isArray(tournament.groups) ? tournament.groups : []).forEach((group) => {
          if (group?.name === "__INSCRIPCIONES__") return;
          (Array.isArray(group?.matches) ? group.matches : []).forEach((match) => registrarPartido(tournament, match, group?.name || "Fase de grupos", incluirTodasLasCategorias));
        });
        (Array.isArray(tournament.playoffs) ? tournament.playoffs : []).forEach((round, roundIndex) => {
          (Array.isArray(round) ? round : []).forEach((match) => registrarPartido(tournament, match, "Eliminatorias · Ronda " + (roundIndex + 1), incluirTodasLasCategorias));
        });
      });
    };
    // Primera pasada: jornadas que efectivamente tiene designadas este árbitro.
    recorrerPartidos(false);
    // Segunda pasada: todas las categorías del mismo torneo y cruce, aunque el
    // partido todavía no tenga árbitro asignado o resultado cargado.
    recorrerPartidos(true);
    // La planilla debe listar TODAS las categorías de la competencia y rama,
    // incluso si en alguna categoría todavía no existe el cruce cargado.
    jornadas.forEach((jornada) => {
      torneos.forEach((tournament) => {
        const ramaTorneo = obtenerRama(tournament);
        const propietarioTorneo = String(tournament?.created_by_user_id || tournament?.created_by || "").trim().toLocaleLowerCase("es");
        const competenciaTorneo = [
          String(tournament?.title || "Torneo sin nombre").trim().toLocaleLowerCase("es"),
          propietarioTorneo,
          ramaTorneo.toLocaleLowerCase("es"),
        ].join("|");
        const competenciaJornada = [
          String(jornada.torneo || "Torneo sin nombre").trim().toLocaleLowerCase("es"),
          jornada.propietario,
          jornada.rama.toLocaleLowerCase("es"),
        ].join("|");
        if (competenciaTorneo !== competenciaJornada) return;
        const partesCategoria = String(tournament?.game || "").split("·").map((parte) => parte.trim());
        const categoria = String(tournament?.category_detail || tournament?.category_type || partesCategoria[partesCategoria.length - 1] || getTournamentCategory(tournament) || "Sin categoría").trim();
        if (!categoria || categoria === "Sin categoría" || jornada.categoriasSet.has(categoria)) return;
        jornada.categoriasSet.add(categoria);
        jornada.detallesPartidos.push({
          clave: String(tournament.id || tournament.title) + "::categoria-sin-cruce::" + categoria,
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
          fechaOrden: 0,
        });
      });
    });
    return [...jornadas.values()].map((jornada) => ({
      ...jornada,
      categorias: [...jornada.categoriasSet].sort((a, b) => a.localeCompare(b, "es", { numeric: true })),
      detallesPartidos: jornada.detallesPartidos.sort((a, b) => a.categoria.localeCompare(b.categoria, "es", { numeric: true }) || a.instancia.localeCompare(b.instancia, "es")),
    })).sort((a, b) => a.team1.localeCompare(b.team1, "es") || a.team2.localeCompare(b.team2, "es"));
  };

export default obtenerJornadasDeArbitro;
