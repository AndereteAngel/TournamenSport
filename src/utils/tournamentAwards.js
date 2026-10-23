import { calculateGroupStandings } from "./tournamentLogic";

export function getTournamentPodium(tournament) {
  const status = String(tournament?.status || "").trim().toLocaleLowerCase("es");
  if (!tournament || status !== "finalizado") return null;

  const format = String(tournament.format || "").trim().toLocaleLowerCase("es");
  const isLeague = ["league", "round_robin", "round-robin", "round robin", "todos contra todos", "todos_contra_todos", "todos-contra-todos", "liga"].includes(format);

  // En todos contra todos se calcula el podio con los resultados cargados, aunque queden partidos pendientes.
  if (isLeague) {
    const groups = Array.isArray(tournament.groups) ? tournament.groups : [];
    const matches = groups.flatMap((group) => group.matches || []);
    const playedMatches = matches.filter((match) => {
      const hasScore1 = match.score1 !== null && match.score1 !== undefined && match.score1 !== "";
      const hasScore2 = match.score2 !== null && match.score2 !== undefined && match.score2 !== "";
      return hasScore1 && hasScore2 && Number.isFinite(Number(match.score1)) && Number.isFinite(Number(match.score2));
    });
    if (!playedMatches.length) return null;

    const standings = groups.flatMap((group) =>
      calculateGroupStandings(group.teams || [], group.matches || [])
    ).sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
      if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
      return String(a.name || "").localeCompare(String(b.name || ""), "es");
    });

    if (standings.length < 2) return null;
    return {
      champion: standings[0]?.name || null,
      runnerUp: standings[1]?.name || null,
      bronze: standings[2]?.name ? [standings[2].name] : [],
      fourth: standings[3]?.name || null,
    };
  }

  // En grupos + playoffs, el campeón y el subcampeón salen de la final.
  const rawPlayoffs = Array.isArray(tournament.playoffs) ? tournament.playoffs : [];
  const rounds = rawPlayoffs.length && !Array.isArray(rawPlayoffs[0]) ? [rawPlayoffs] : rawPlayoffs;
  const finalRound = rounds[rounds.length - 1];
  const finalMatch = Array.isArray(finalRound) && finalRound.length === 1 ? finalRound[0] : null;
  const hasScores = (match) => match &&
    match.score1 !== null && match.score1 !== undefined &&
    match.score2 !== null && match.score2 !== undefined;
  const winnerOf = (match) => {
    if (!match) return null;
    if (match.winner && match.winner !== "Empate (Definir)") return match.winner;
    if (!hasScores(match)) return null;
    if (Number(match.score1) > Number(match.score2)) return match.team1;
    if (Number(match.score2) > Number(match.score1)) return match.team2;
    return null;
  };

  const champion = winnerOf(finalMatch);
  if (!champion) return null;
  const runnerUp = [finalMatch.team1, finalMatch.team2].find(
    (name) => name && name !== champion && name !== "Pasaje Directo"
  );
  const semifinalRound = rounds.length >= 2 ? rounds[rounds.length - 2] : [];
  const bronze = [];
  if (Array.isArray(semifinalRound) && semifinalRound.length === 2) {
    semifinalRound.forEach((match) => {
      const matchWinner = winnerOf(match);
      if (!matchWinner) return;
      const loser = [match.team1, match.team2].find(
        (name) => name && name !== matchWinner && name !== "Pasaje Directo"
      );
      if (loser && loser !== champion && loser !== runnerUp) bronze.push(loser);
    });
  }
  return { champion, runnerUp: runnerUp || null, bronze: [...new Set(bronze)], fourth: null };
}

export function getPlayerTournamentStats(tournament, playerName) {
  const normalize = (value) => String(value || "").trim().toLocaleLowerCase("es");
  const target = normalize(playerName);
  const matches = [];

  (tournament?.groups || []).forEach((group) => {
    (group.matches || []).forEach((match) => matches.push(match));
  });
  (tournament?.playoffs || []).forEach((round) => {
    (round || []).forEach((match) => matches.push(match));
  });

  const played = matches.filter((match) => {
    const involved = normalize(match.team1) === target || normalize(match.team2) === target;
    return involved && match.score1 !== null && match.score1 !== undefined &&
      match.score2 !== null && match.score2 !== undefined;
  });

  const wins = played.filter((match) => {
    if (match.winner) return normalize(match.winner) === target;
    const playerIsTeam1 = normalize(match.team1) === target;
    return playerIsTeam1 ? Number(match.score1) > Number(match.score2) : Number(match.score2) > Number(match.score1);
  }).length;
  const draws = played.filter((match) => Number(match.score1) === Number(match.score2)).length;
  const losses = Math.max(0, played.length - wins - draws);

  return {
    played: played.length,
    wins,
    draws,
    losses,
    winRate: played.length ? Math.round((wins / played.length) * 100) : 0,
  };
}

export function getPlayerMedals(tournaments, playerName) {
  const normalize = (value) => String(value || "").trim().toLocaleLowerCase("es");
  const target = normalize(playerName);
  const medals = { gold: 0, silver: 0, bronze: 0, diploma: 0, history: [] };

  (tournaments || []).forEach((tournament) => {
    const podium = getTournamentPodium(tournament);
    if (!podium) return;

    let medal = null;
    if (normalize(podium.champion) === target) {
      medals.gold += 1;
      medal = "gold";
    } else if (normalize(podium.runnerUp) === target) {
      medals.silver += 1;
      medal = "silver";
    } else if (podium.bronze.some((name) => normalize(name) === target)) {
      medals.bronze += 1;
      medal = "bronze";
    } else if (normalize(podium.fourth) === target) {
      medals.diploma += 1;
      medal = "diploma";
    }

    if (medal) medals.history.push({
      id: tournament.id || tournament.code || tournament.title,
      title: tournament.title || "Torneo",
      code: tournament.code || "",
      medal,
      createdAt: tournament.created_at || null,
    });
  });

  return medals;
}
