/**
 * Calcula la tabla de posiciones de un grupo basándose en los partidos jugados.
 * Sistema de puntos: Ganado = 3, Empatado = 2, Perdido = 1.
 */
export function calculateGroupStandings(teams, matches) {
    const standings = teams.map((team) => ({
        name: team,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        points: 0,
    }));

    matches.forEach((match) => {
        if (match.score1 === null || match.score2 === null) return;

        const t1 = standings.find((s) => s.name === match.team1);
        const t2 = standings.find((s) => s.name === match.team2);

        if (!t1 || !t2) return;

        t1.played += 1;
        t2.played += 1;

        t1.goalsFor += match.score1;
        t1.goalsAgainst += match.score2;
        t2.goalsFor += match.score2;
        t2.goalsAgainst += match.score1;

        t1.goalDifference = t1.goalsFor - t1.goalsAgainst;
        t2.goalDifference = t2.goalsFor - t2.goalsAgainst;

        if (match.score1 > match.score2) {
            t1.won += 1;
            t1.points += 3;
            t2.lost += 1;
            t2.points += 1;
        } else if (match.score1 < match.score2) {
            t2.won += 1;
            t2.points += 3;
            t1.lost += 1;
            t1.points += 1;
        } else {
            t1.drawn += 1;
            t1.points += 2;
            t2.drawn += 1;
            t2.points += 2;
        }
    });

    return standings.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
        return b.goalsFor - a.goalsFor;
    });
}

/**
 * Genera la primera ronda de cruces de eliminación directa (Playoffs) emparejando extremos (1° vs último).
 */
export function generatePlayoffBrackets(qualifiedTeams) {
    const teams = [...qualifiedTeams];
    const n = teams.length;
    if (n < 2) return [];

    // Se usa un cuadro de potencia de dos. Los mejores clasificados reciben
    // los pasajes directos cuando la cantidad de equipos no completa el cuadro.
    const bracketSize = 2 ** Math.ceil(Math.log2(n));
    const byeCount = bracketSize - n;
    const matches = [];

    for (let i = 0; i < byeCount; i++) {
        matches.push({
            id: `r1-m${i + 1}`,
            team1: teams[i],
            team2: "Pasaje Directo",
            score1: 1,
            score2: 0,
            winner: teams[i],
        });
    }

    // Los cruces restantes enfrentan al mejor clasificado disponible
    // contra el peor clasificado disponible.
    let left = byeCount;
    let right = n - 1;
    while (left < right) {
        matches.push({
            id: `r1-m${matches.length + 1}`,
            team1: teams[left],
            team2: teams[right],
            score1: null,
            score2: null,
            winner: null,
        });
        left++;
        right--;
    }

    return [matches];
}
