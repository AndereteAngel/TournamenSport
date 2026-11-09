import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

const normalize = (value) => String(value || "")
  .trim()
  .toLocaleLowerCase("es")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "");

const getCategory = (tournament) => {
  const explicit = String(tournament?.category_detail || tournament?.category_type || "").trim();
  if (explicit) return explicit;
  const game = String(tournament?.game || "");
  const separator = game.indexOf(" · ");
  return separator >= 0 ? game.slice(separator + 3).trim() : "";
};

const getPlayerStatus = (player) => {
  const approval = normalize(player?.status);
  const carnet = normalize(player?.carnet_status);
  if (["rechazado", "no_aprobado", "inactivo"].includes(approval) ||
      ["rechazado", "no_habilitado"].includes(carnet)) return "NO HABILITADO";
  if (approval === "aprobado" && ["verificado", "habilitado", "activo"].includes(carnet)) return "HABILITADO";
  return "PENDIENTE DE VERIFICACIÓN";
};

export function FefutinMatchSheet({ tournament, match, onClose }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sheetId, setSheetId] = useState(null);
  const [metadata, setMetadata] = useState({
    jornada: String(match?.round || ""),
    sede: "",
    fecha_partido: "",
    arbitro_designado: "",
    observaciones: "",
  });
  const [localPlayers, setLocalPlayers] = useState([]);
  const [visitorPlayers, setVisitorPlayers] = useState([]);

  const category = useMemo(() => getCategory(tournament), [tournament]);
  const localName = String(match?.team1 || "").trim();
  const visitorName = String(match?.team2 || "").trim();

  useEffect(() => {
    let cancelled = false;
    const loadSheet = async () => {
      setLoading(true);
      setError("");
      setNotice("");
      try {
        if (!supabase) throw new Error("No hay conexión con Supabase configurada.");
        if (!tournament?.id || !match?.id || !localName || !visitorName) {
          throw new Error("No se pudo identificar el torneo o los dos clubes del partido.");
        }

        const { data: registrations, error: registrationsError } = await supabase
          .from("fefutin_club_tournaments")
          .select("id, category_label, club_id")
          .eq("tournament_id", tournament.id);
        if (registrationsError) throw registrationsError;

        const matchingRegistrations = (registrations || []).filter((item) =>
          normalize(item.category_label) === normalize(category)
        );
        const clubIds = [...new Set(matchingRegistrations.map((item) => item.club_id).filter(Boolean))];
        const { data: clubs, error: clubsError } = clubIds.length
          ? await supabase.from("fefutin_clubs").select("id, name, headquarters_address, court_type").in("id", clubIds)
          : { data: [], error: null };
        if (clubsError) throw clubsError;

        const localClub = (clubs || []).find((club) => normalize(club.name) === normalize(localName));
        const visitorClub = (clubs || []).find((club) => normalize(club.name) === normalize(visitorName));
        if (!localClub || !visitorClub) {
          throw new Error("No encontramos la inscripción de ambos clubes en la categoría " + (category || "del torneo") + ". Revisá que los nombres del fixture coincidan con los nombres institucionales.");
        }

        const localRegistration = matchingRegistrations.find((item) => item.club_id === localClub.id);
        const visitorRegistration = matchingRegistrations.find((item) => item.club_id === visitorClub.id);
        const registrationIds = [localRegistration?.id, visitorRegistration?.id].filter(Boolean);
        const { data: teams, error: teamsError } = await supabase
          .from("fefutin_teams")
          .select("id, club_tournament_id, status")
          .in("club_tournament_id", registrationIds);
        if (teamsError) throw teamsError;

        const localTeam = (teams || []).find((team) => team.club_tournament_id === localRegistration.id);
        const visitorTeam = (teams || []).find((team) => team.club_tournament_id === visitorRegistration.id);
        if (!localTeam || !visitorTeam) {
          throw new Error("Uno de los clubes todavía no tiene una lista de equipo creada para esta categoría.");
        }

        const teamIds = [localTeam.id, visitorTeam.id];
        const { data: teamPlayers, error: teamPlayersError } = await supabase
          .from("fefutin_team_players")
          .select("id, team_id, first_name, last_name, jersey_number, approval_status, registry_player_id")
          .in("team_id", teamIds)
          .eq("approval_status", "aprobado");
        if (teamPlayersError) throw teamPlayersError;

        const registryIds = [...new Set((teamPlayers || []).map((item) => item.registry_player_id).filter(Boolean))];
        const { data: officialPlayers, error: officialPlayersError } = registryIds.length
          ? await supabase.from("fefutin_players")
              .select("id, first_name, last_name, dni, carnet_number, status, carnet_status")
              .in("id", registryIds)
          : { data: [], error: null };
        if (officialPlayersError) throw officialPlayersError;

        const officialById = new Map((officialPlayers || []).map((player) => [player.id, player]));
        const buildPlayers = (teamId, clubName) => (teamPlayers || [])
          .filter((item) => item.team_id === teamId && item.registry_player_id && officialById.has(item.registry_player_id))
          .map((item) => {
            const official = officialById.get(item.registry_player_id);
            return {
              player_id: official.id,
              club: clubName,
              nombre: official.first_name || item.first_name || "",
              apellido: official.last_name || item.last_name || "",
              carnet_number: official.carnet_number || "",
              dni: official.dni || "",
              numero_camiseta: item.jersey_number === "" || item.jersey_number == null ? "" : Number(item.jersey_number),
              goles: 0,
              es_capitan: false,
              tarjetas_amarillas: 0,
              tarjetas_rojas: 0,
              estado_habilitacion: getPlayerStatus(official),
              observaciones: "",
            };
          });

        let local = buildPlayers(localTeam.id, localName);
        let visitor = buildPlayers(visitorTeam.id, visitorName);
        if (!local.length || !visitor.length) {
          throw new Error("Las listas oficiales de ambos equipos deben tener jugadores vinculados a sus carnets para generar la planilla.");
        }

        const { data: existingSheet, error: sheetError } = await supabase
          .from("fefutin_match_sheets")
          .select("*")
          .eq("tournament_id", tournament.id)
          .eq("match_id", String(match.id))
          .maybeSingle();
        if (sheetError) throw sheetError;

        if (existingSheet) {
          setSheetId(existingSheet.id);
          setMetadata({
            jornada: existingSheet.jornada || String(match?.round || ""),
            sede: existingSheet.sede || localClub.headquarters_address || "",
            fecha_partido: existingSheet.fecha_partido || "",
            arbitro_designado: existingSheet.arbitro_designado || "",
            observaciones: existingSheet.observaciones || "",
          });
          const { data: savedPlayers, error: savedPlayersError } = await supabase
            .from("fefutin_match_sheet_players")
            .select("*")
            .eq("match_sheet_id", existingSheet.id);
          if (savedPlayersError) throw savedPlayersError;
          const savedByPlayer = new Map((savedPlayers || []).map((item) => [item.player_id, item]));
          const mergeSaved = (players) => players.map((player) => {
            const saved = savedByPlayer.get(player.player_id);
            return saved ? { ...player, ...saved, carnet_number: player.carnet_number, dni: player.dni } : player;
          });
          local = mergeSaved(local);
          visitor = mergeSaved(visitor);
        } else {
          setMetadata((current) => ({ ...current, sede: current.sede || localClub.headquarters_address || "" }));
        }

        if (!cancelled) {
          setLocalPlayers(local);
          setVisitorPlayers(visitor);
          setMetadata((current) => ({ ...current, sede: current.sede || localClub.headquarters_address || "" }));
        }
      } catch (err) {
        console.error("Error al generar la planilla:", err);
        if (!cancelled) setError(err.message || "No se pudieron cargar las listas oficiales.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadSheet();
    return () => { cancelled = true; };
  }, [tournament?.id, match?.id, category, localName, visitorName]);

  const updatePlayer = (side, playerId, field, value) => {
    const setter = side === "local" ? setLocalPlayers : setVisitorPlayers;
    setter((current) => current.map((player) =>
      player.player_id === playerId ? { ...player, [field]: value } : player
    ));
  };

  const save = async () => {
    if (!supabase || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = {
        tournament_id: tournament.id,
        match_id: String(match.id),
        jornada: metadata.jornada || null,
        club_local: localName,
        club_visitante: visitorName,
        sede: metadata.sede || null,
        fecha_partido: metadata.fecha_partido || null,
        categoria: category || null,
        arbitro_designado: metadata.arbitro_designado || null,
        observaciones: metadata.observaciones || null,
        updated_by: (await supabase.auth.getUser()).data?.user?.id || null,
      };
      const { data: sheet, error: saveSheetError } = await supabase
        .from("fefutin_match_sheets")
        .upsert(payload, { onConflict: "tournament_id,match_id" })
        .select("id")
        .single();
      if (saveSheetError) throw saveSheetError;
      setSheetId(sheet.id);

      const allPlayers = [...localPlayers, ...visitorPlayers].map((player) => ({
        match_sheet_id: sheet.id,
        player_id: player.player_id,
        club: player.club,
        nombre: player.nombre,
        apellido: player.apellido,
        numero_camiseta: player.numero_camiseta === "" ? null : Number(player.numero_camiseta),
        goles: Number(player.goles || 0),
        es_capitan: Boolean(player.es_capitan),
        tarjetas_amarillas: Number(player.tarjetas_amarillas || 0),
        tarjetas_rojas: Number(player.tarjetas_rojas || 0),
        estado_habilitacion: player.estado_habilitacion,
        observaciones: player.observaciones || null,
      }));

      const { data: existingRows, error: existingRowsError } = await supabase
        .from("fefutin_match_sheet_players")
        .select("id, player_id")
        .eq("match_sheet_id", sheet.id);
      if (existingRowsError) throw existingRowsError;
      const existingByPlayer = new Map((existingRows || []).map((row) => [row.player_id, row.id]));
      const currentIds = new Set(allPlayers.map((player) => player.player_id));

      for (const player of allPlayers) {
        const existingId = existingByPlayer.get(player.player_id);
        const result = existingId
          ? await supabase.from("fefutin_match_sheet_players").update(player).eq("id", existingId)
          : await supabase.from("fefutin_match_sheet_players").insert(player);
        if (result.error) throw result.error;
      }

      const removedIds = (existingRows || []).filter((row) => !currentIds.has(row.player_id)).map((row) => row.id);
      if (removedIds.length) {
        const { error: deleteError } = await supabase.from("fefutin_match_sheet_players").delete().in("id", removedIds);
        if (deleteError) throw deleteError;
      }
      setNotice("Planilla guardada correctamente.");
    } catch (err) {
      console.error("Error al guardar la planilla:", err);
      setError(err.message || "No se pudo guardar la planilla.");
    } finally {
      setSaving(false);
    }
  };

  const renderTeam = (players, side) => (
    <section style={{ minWidth: 0, border: "1px solid #b5122a", borderRadius: "10px", padding: ".7rem", background: "#111" }}>
      <h3 style={{ color: "#fff", margin: "0 0 .7rem", fontSize: ".95rem" }}>
        {side === "local" ? "LOCAL" : "VISITANTE"} · {side === "local" ? localName : visitorName}
      </h3>
      {players.map((player) => (
        <article key={player.player_id} style={{ padding: ".65rem 0", borderTop: "1px solid #383838", color: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: ".5rem", alignItems: "flex-start" }}>
            <div style={{ minWidth: 0 }}>
              <strong>{player.nombre} {player.apellido}</strong>
              <small style={{ display: "block", color: "#e7a8b2", marginTop: ".15rem" }}>
                {player.carnet_number || "Sin número de carnet"} · Camiseta {player.numero_camiseta || "—"}
              </small>
            </div>
            <span style={{ flexShrink: 0, fontSize: ".62rem", fontWeight: 800, color: player.estado_habilitacion === "HABILITADO" ? "#86efac" : player.estado_habilitacion === "NO HABILITADO" ? "#fca5a5" : "#fcd34d" }}>
              {player.estado_habilitacion}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: ".4rem", marginTop: ".55rem" }}>
            {[
              ["goles", "Goles"],
              ["tarjetas_amarillas", "Amarillas"],
              ["tarjetas_rojas", "Rojas"],
            ].map(([field, label]) => (
              <label key={field} style={{ color: "#ddd", fontSize: ".65rem", display: "grid", gap: ".2rem" }}>
                {label}
                <input type="number" min="0" value={player[field] ?? 0} onChange={(event) => updatePlayer(side, player.player_id, field, event.target.value)} style={{ width: "100%", boxSizing: "border-box", background: "#fff", color: "#171c27", border: "1px solid #777", borderRadius: "5px", padding: ".35rem" }} />
              </label>
            ))}
            <label style={{ color: "#ddd", fontSize: ".65rem", display: "grid", gap: ".2rem", alignContent: "end" }}>
              Capitán
              <input type="checkbox" checked={Boolean(player.es_capitan)} onChange={(event) => updatePlayer(side, player.player_id, "es_capitan", event.target.checked)} style={{ width: "20px", height: "20px" }} />
            </label>
          </div>
        </article>
      ))}
    </section>
  );

  return (
    <div role="dialog" aria-modal="true" aria-label="Planilla de partido" style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,.82)", overflowY: "auto", padding: "1rem", display: "grid", placeItems: "start center" }}>
      <div className="fefutin-print-sheet" style={{ width: "100%", maxWidth: "1000px", boxSizing: "border-box", margin: "1rem auto", padding: "1rem", borderRadius: "14px", background: "#080808", border: "1px solid #b5122a", color: "#fff" }}>
        <style>{`@page { size: A4 landscape; margin: 9mm; } @media print { body * { visibility: hidden !important; } .fefutin-print-sheet, .fefutin-print-sheet * { visibility: visible !important; } .fefutin-print-sheet { position: absolute !important; inset: 0 !important; width: 100% !important; max-width: none !important; margin: 0 !important; padding: 0 !important; border: 0 !important; border-radius: 0 !important; background: #fff !important; color: #111 !important; box-shadow: none !important; } .fefutin-print-sheet h2, .fefutin-print-sheet h3, .fefutin-print-sheet p, .fefutin-print-sheet strong, .fefutin-print-sheet small, .fefutin-print-sheet label, .fefutin-print-sheet span { color: #111 !important; } .fefutin-no-print { display: none !important; } .fefutin-print-sheet .fefutin-team-grid { grid-template-columns: 1fr 1fr !important; gap: 8mm !important; } .fefutin-print-sheet section { background: #fff !important; border: 1px solid #333 !important; break-inside: avoid; } .fefutin-print-sheet article { color: #111 !important; border-top: 1px solid #bbb !important; padding: 3px 0 !important; } .fefutin-print-sheet input, .fefutin-print-sheet textarea { color: #111 !important; background: #fff !important; border: 0 !important; box-shadow: none !important; padding: 1px !important; } .fefutin-print-sheet input[type=checkbox] { appearance: none; width: 10px !important; height: 10px !important; border: 1px solid #111 !important; } .fefutin-print-sheet input[type=number] { width: 35px !important; } }`}</style>
        <div className="fefutin-no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".75rem", flexWrap: "wrap" }}>
          <div>
            <span style={{ color: "#f2aab5", fontSize: ".72rem", fontWeight: 800 }}>FEFUTIN · PLANILLA OFICIAL</span>
            <h2 style={{ margin: ".25rem 0", color: "#fff", fontSize: "1.2rem" }}>{localName} vs. {visitorName}</h2>
            <p style={{ margin: 0, color: "#bbb", fontSize: ".8rem" }}>{category || "Categoría sin especificar"} · {metadata.jornada ? "Fecha " + metadata.jornada : "Jornada sin asignar"}</p>
          </div>
          <button type="button" onClick={onClose} style={{ background: "#261015", border: "1px solid #b5122a", color: "#fff", borderRadius: "7px", padding: ".5rem .75rem", cursor: "pointer" }}>Cerrar ✕</button>
        </div>

        {loading ? <p style={{ color: "#ddd", padding: "1rem 0" }}>Cargando listas oficiales de ambos clubes...</p> : error ? (
          <div style={{ marginTop: "1rem", padding: ".8rem", border: "1px solid #b5122a", borderRadius: "8px", color: "#fecaca", background: "#210b10" }}>{error}</div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: ".65rem", margin: "1rem 0" }}>
              {[
                ["jornada", "Jornada"],
                ["sede", "Sede"],
                ["fecha_partido", "Fecha del partido"],
                ["arbitro_designado", "Árbitro designado"],
              ].map(([field, label]) => (
                <label key={field} style={{ display: "grid", gap: ".3rem", color: "#ddd", fontSize: ".75rem" }}>
                  {label}
                  <input type={field === "fecha_partido" ? "date" : "text"} value={metadata[field]} onChange={(event) => setMetadata((current) => ({ ...current, [field]: event.target.value }))} style={{ width: "100%", boxSizing: "border-box", padding: ".55rem", borderRadius: "6px", border: "1px solid #555", background: "#fff", color: "#171c27" }} />
                </label>
              ))}
            </div>
            <div className="fefutin-team-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: ".75rem" }}>
              {renderTeam(localPlayers, "local")}
              {renderTeam(visitorPlayers, "visitante")}
            </div>
            <label style={{ display: "grid", gap: ".3rem", marginTop: ".8rem", color: "#ddd", fontSize: ".75rem" }}>
              Observaciones generales
              <textarea value={metadata.observaciones} onChange={(event) => setMetadata((current) => ({ ...current, observaciones: event.target.value }))} rows={3} style={{ width: "100%", boxSizing: "border-box", padding: ".6rem", borderRadius: "6px", border: "1px solid #555", background: "#fff", color: "#171c27" }} />
            </label>
            {notice && <p style={{ color: "#86efac", fontWeight: 700 }}>{notice}</p>}
            {error && <p style={{ color: "#fca5a5" }}>{error}</p>}
            <div className="fefutin-no-print" style={{ display: "flex", gap: ".6rem", flexWrap: "wrap", marginTop: "1rem" }}><button type="button" onClick={() => window.print()} style={{ flex: "1 1 220px", padding: ".8rem", borderRadius: "8px", border: "1px solid #fff", background: "#333", color: "#fff", fontWeight: 900, cursor: "pointer" }}>IMPRIMIR / GUARDAR PDF</button>
            <button type="button" onClick={save} disabled={saving} style={{ flex: "1 1 220px", padding: ".8rem", borderRadius: "8px", border: "1px solid #e45a70", background: "#b5122a", color: "#fff", fontWeight: 900, cursor: saving ? "wait" : "pointer", opacity: saving ? .65 : 1 }}>
              {saving ? "Guardando planilla..." : "GUARDAR PLANILLA"}
            </button></div>
          </>
        )}
      </div>
    </div>
  );
}

export default FefutinMatchSheet;
