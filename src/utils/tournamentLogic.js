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

    // Orden estándar de cabezas de serie: mantiene al 1 y al 2 en mitades opuestas.
    const bracketSize = 2 ** Math.ceil(Math.log2(n));
    const seedOrder = (size) => {
        if (size === 1) return [1];
        return seedOrder(size / 2).flatMap((seed) => [seed, size + 1 - seed]);
    };
    const slots = seedOrder(bracketSize).map((seed) => teams[seed - 1] ?? "Pasaje Directo");
    const matches = [];

    for (let i = 0; i < slots.length; i += 2) {
        const team1 = slots[i];
        const team2 = slots[i + 1];
        const hasBye = team1 === "Pasaje Directo" || team2 === "Pasaje Directo";
        const winner = hasBye ? (team1 === "Pasaje Directo" ? team2 : team1) : null;
        matches.push({
            id: `r1-m${matches.length + 1}`,
            team1,
            team2,
            score1: hasBye ? (winner === team1 ? 1 : 0) : null,
            score2: hasBye ? (winner === team2 ? 1 : 0) : null,
            winner,
        });
    }

    return [matches];
}
