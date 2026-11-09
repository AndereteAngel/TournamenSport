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

  const renderPlayerCell = (player, side) => {
    if (!player) return <><td></td><td></td><td></td><td></td></>;
    const statusColor = player.estado_habilitacion === "HABILITADO" ? "#166534" : player.estado_habilitacion === "NO HABILITADO" ? "#b91c1c" : "#92400e";
    return <>
      <td className="fefutin-player-name">
        <strong>{player.apellido}, {player.nombre}</strong>
        <small>{player.carnet_number || "Sin carnet"} · Camiseta {player.numero_camiseta || "—"}</small>
        <label className="fefutin-captain"><input type="checkbox" checked={Boolean(player.es_capitan)} onChange={(event) => updatePlayer(side, player.player_id, "es_capitan", event.target.checked)} /> Capitán</label>
      </td>
      <td className="fefutin-status" style={{ color:statusColor }}>{player.estado_habilitacion === "HABILITADO" ? "HABIL." : player.estado_habilitacion === "NO HABILITADO" ? "NO HABIL." : "PEND. VERIF."}</td>
      <td className="fefutin-goals"><input aria-label={"Goles " + player.nombre} type="number" min="0" value={player.goles ?? 0} onChange={(event) => updatePlayer(side, player.player_id, "goles", event.target.value)} /></td>
      <td className="fefutin-cards">
        <label>A <input aria-label={"Tarjetas amarillas " + player.nombre} type="number" min="0" value={player.tarjetas_amarillas ?? 0} onChange={(event) => updatePlayer(side, player.player_id, "tarjetas_amarillas", event.target.value)} /></label>
        <label>R <input aria-label={"Tarjetas rojas " + player.nombre} type="number" min="0" value={player.tarjetas_rojas ?? 0} onChange={(event) => updatePlayer(side, player.player_id, "tarjetas_rojas", event.target.value)} /></label>
      </td>
    </>;
  };
  const rowCount = Math.max(localPlayers.length, visitorPlayers.length);

  return (
    <div role="dialog" aria-modal="true" aria-label="Planilla oficial de partido" className="fefutin-sheet-overlay">
      <style>{`
        .fefutin-sheet-overlay{position:fixed;inset:0;z-index:10000;overflow:auto;padding:18px;background:rgba(0,0,0,.86)}
        .fefutin-print-sheet{width:100%;max-width:1500px;margin:0 auto;padding:24px;box-sizing:border-box;background:#fff!important;color:#111!important;border-radius:4px;box-shadow:0 8px 35px #0008;font-family:Arial,sans-serif}
        .fefutin-print-sheet *{box-sizing:border-box;color:#111}
        .fefutin-sheet-title{text-align:center;border-bottom:3px solid #b5122a;padding-bottom:12px;margin-bottom:14px}
        .fefutin-sheet-title .brand{color:#b5122a!important;font-size:13px;font-weight:900;letter-spacing:2px}
        .fefutin-sheet-title h2{margin:5px 0;font-size:23px;color:#111!important;text-transform:uppercase}
        .fefutin-sheet-title p{margin:3px 0;font-size:12px;color:#333!important}
        .fefutin-sheet-meta{display:grid;grid-template-columns:76px minmax(0,1.35fr) 135px minmax(0,1.35fr);gap:10px;margin:14px 0;align-items:end;width:100%;min-width:0}
        .fefutin-sheet-meta label{display:grid;grid-template-rows:auto 28px;gap:4px;font-size:10px;font-weight:700;text-transform:uppercase;color:#333!important;min-width:0;width:100%;overflow:hidden}
        .fefutin-sheet-meta input{display:block;box-sizing:border-box;width:100%!important;max-width:100%!important;min-width:0!important;height:28px!important;min-height:28px!important;max-height:28px!important;line-height:20px!important;border:1px solid #999!important;border-radius:3px!important;padding:3px 6px!important;background:#fff!important;color:#111!important;font-size:11px!important;box-shadow:none!important;margin:0!important}
        .fefutin-sheet-table-wrap{width:100%;overflow-x:auto}
        .fefutin-sheet-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:9px;background:#fff!important}.fefutin-sheet-table col:nth-child(1),.fefutin-sheet-table col:nth-child(5){width:26%!important}.fefutin-sheet-table col:nth-child(2),.fefutin-sheet-table col:nth-child(3),.fefutin-sheet-table col:nth-child(4),.fefutin-sheet-table col:nth-child(6),.fefutin-sheet-table col:nth-child(7),.fefutin-sheet-table col:nth-child(8){width:8%!important}
        .fefutin-sheet-table th,.fefutin-sheet-table td{border:1px solid #777!important;padding:5px 4px;vertical-align:middle;color:#111!important;background-clip:padding-box}
        .fefutin-sheet-table thead th{background:#292929!important;color:#fff!important;text-align:center;font-weight:800;font-size:10px;line-height:1.2}
        .fefutin-sheet-table thead .team-local{background:#b5122a!important;color:#fff!important;font-size:11px}
        .fefutin-sheet-table thead .team-visitor{background:#343a40!important;color:#fff!important;font-size:11px}
        .fefutin-sheet-table .fefutin-player-name{font-size:9px!important;line-height:1.25;color:#111!important}
        .fefutin-player-name strong{display:block;font-size:9px!important;color:#111!important;white-space:normal;overflow-wrap:anywhere}
        .fefutin-player-name small{display:block;margin-top:3px;color:#555!important;font-size:7px!important}
        .fefutin-captain{display:flex;align-items:center;gap:3px;margin-top:4px;font-size:7px!important;font-weight:600;color:#333!important}
        .fefutin-captain input{appearance:auto!important;width:11px!important;height:11px!important;min-height:11px!important;margin:0!important;padding:0!important;accent-color:#b5122a}
        .fefutin-sheet-table .fefutin-status{ text-align:center;font-size:7px!important;line-height:1.2;font-weight:900;color:#111!important;overflow-wrap:anywhere}
        .fefutin-goals{text-align:center}
        .fefutin-cards{text-align:center;white-space:normal;vertical-align:middle}.fefutin-cards label{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;margin:2px 0;font-size:7px!important;line-height:1!important}.fefutin-cards input{width:30px!important;max-width:100%!important;height:20px!important;min-height:20px!important}
        .fefutin-goals input,.fefutin-cards input{appearance:none!important;width:24px!important;max-width:45%!important;height:24px!important;min-height:24px!important;padding:2px!important;text-align:center!important;border:1px solid #999!important;border-radius:3px!important;background:#fff!important;color:#111!important;font-size:10px!important;box-shadow:none!important}
        .fefutin-cards label{display:inline-flex;align-items:center;gap:2px;margin:0 1px;font-size:8px!important;color:#111!important}
        .fefutin-sheet-table tbody tr{height:35px}
        .fefutin-sheet-table tbody tr:nth-child(even) td{background:#f3f3f3!important}
        .fefutin-observations{display:grid;gap:5px;margin-top:14px;font-size:10px;font-weight:700;color:#222!important}
        .fefutin-observations textarea{width:100%;border:1px solid #777!important;min-height:48px;padding:6px;background:#fff!important;color:#111!important;font-size:11px!important}
        .fefutin-sheet-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}
        .fefutin-sheet-actions button{padding:10px 16px;border-radius:5px;border:1px solid #333;cursor:pointer;font-weight:800}
        @page{size:A4 landscape;margin:7mm}
        @media(max-width:700px){.fefutin-print-sheet{padding:12px}.fefutin-sheet-meta{grid-template-columns:76px minmax(0,1fr);gap:8px}.fefutin-sheet-meta label{grid-column:auto!important}.fefutin-sheet-meta label:nth-child(3),.fefutin-sheet-meta label:nth-child(4){grid-column:1 / -1!important}.fefutin-sheet-title h2{font-size:17px}.fefutin-sheet-table{min-width:680px}}
        @media print{
          html,body{background:#fff!important;margin:0!important;padding:0!important}
          body *{visibility:hidden!important}
          .fefutin-print-sheet,.fefutin-print-sheet *{visibility:visible!important}
          .fefutin-sheet-overlay{position:absolute!important;inset:0!important;overflow:visible!important;padding:0!important;background:#fff!important}
          .fefutin-print-sheet{position:relative!important;width:100%!important;max-width:none!important;margin:0!important;padding:0!important;box-shadow:none!important;border-radius:0!important}
          .fefutin-no-print,.fefutin-sheet-actions{display:none!important}
          .fefutin-sheet-table-wrap{overflow:visible!important}
          .fefutin-sheet-table{width:100%!important;min-width:0!important;font-size:8px!important}
          .fefutin-sheet-table th,.fefutin-sheet-table td{padding:3px 2px!important}
          .fefutin-sheet-table thead th{font-size:8px!important}
          .fefutin-sheet-table tbody tr{height:30px!important;break-inside:avoid}
          .fefutin-sheet-title h2{font-size:17px!important}
          .fefutin-sheet-meta{grid-template-columns:76px minmax(0,1.35fr) 135px minmax(0,1.35fr)!important;gap:8px!important;margin:7px 0!important;width:100%!important}.fefutin-sheet-meta label{min-width:0!important;width:100%!important;overflow:hidden!important}.fefutin-sheet-meta input{box-sizing:border-box!important;width:100%!important;min-width:0!important;max-width:100%!important;height:23px!important;min-height:23px!important;max-height:23px!important;font-size:9px!important;padding:2px 4px!important;margin:0!important}
          .fefutin-sheet-meta input,.fefutin-observations textarea{border:0!important;border-bottom:1px solid #777!important}
        }

        /* Refuerzo de contraste: evita que los estilos globales de la app blanqueen la planilla */
        .fefutin-print-sheet,
        .fefutin-print-sheet table,
        .fefutin-print-sheet thead,
        .fefutin-print-sheet tbody,
        .fefutin-print-sheet tr,
        .fefutin-print-sheet td,
        .fefutin-print-sheet label,
        .fefutin-print-sheet strong,
        .fefutin-print-sheet small,
        .fefutin-print-sheet p,
        .fefutin-print-sheet h2,
        .fefutin-print-sheet span { color:#111111!important; -webkit-text-fill-color:#111111!important; }
        .fefutin-print-sheet .fefutin-sheet-title .brand{color:#b5122a!important;-webkit-text-fill-color:#b5122a!important}
        .fefutin-print-sheet .fefutin-sheet-table thead th{color:#ffffff!important;-webkit-text-fill-color:#ffffff!important}
        .fefutin-print-sheet .fefutin-sheet-table thead .team-local{background:#b5122a!important;color:#fff!important;-webkit-text-fill-color:#fff!important}
        .fefutin-print-sheet .fefutin-sheet-table thead .team-visitor{background:#343a40!important;color:#fff!important;-webkit-text-fill-color:#fff!important}
        .fefutin-print-sheet .fefutin-player-name,
        .fefutin-print-sheet .fefutin-player-name strong,
        .fefutin-print-sheet .fefutin-player-name small,
        .fefutin-print-sheet .fefutin-captain{color:#111!important;-webkit-text-fill-color:#111!important}
        .fefutin-print-sheet .fefutin-status{color:#111!important;-webkit-text-fill-color:#111!important}
        .fefutin-print-sheet input:not([type="checkbox"]),
        .fefutin-print-sheet textarea,
        .fefutin-print-sheet select{appearance:auto!important;background:#fff!important;background-color:#fff!important;color:#111!important;-webkit-text-fill-color:#111!important;border:1px solid #888!important;box-shadow:none!important;text-shadow:none!important;opacity:1!important}
        .fefutin-print-sheet input[type="checkbox"]{appearance:auto!important;accent-color:#b5122a!important;opacity:1!important}
        .fefutin-print-sheet .fefutin-goals input,
        .fefutin-print-sheet .fefutin-cards input{background:#fff!important;color:#111!important;-webkit-text-fill-color:#111!important;border:1px solid #777!important;border-radius:3px!important}
      `}</style>
      <div className="fefutin-print-sheet">
        <div className="fefutin-sheet-title">
          <div className="brand">FEFUTIN · PLANILLA OFICIAL</div>
          <h2>{localName} vs. {visitorName}</h2>
          <p>{category || "Categoría sin especificar"} · {metadata.jornada ? "Fecha " + metadata.jornada : "Jornada sin asignar"}</p>
        </div>
        {loading ? <p>Cargando listas oficiales de ambos clubes...</p> : error ? (
          <div style={{padding:12,border:"1px solid #b5122a",color:"#b91c1c"}}>{error}</div>
        ) : <>
          <div className="fefutin-sheet-meta">
            {[
              ["jornada","Jornada"],["sede","Sede / cancha"],["fecha_partido","Fecha del partido"],["arbitro_designado","Árbitro designado"],
            ].map(([field,label]) => <label key={field}>{label}
              <input type={field==="fecha_partido"?"date":"text"} value={metadata[field]} onChange={(event)=>setMetadata((current)=>({...current,[field]:event.target.value}))}/>
            </label>)}
          </div>
          <div className="fefutin-sheet-table-wrap">
            <table className="fefutin-sheet-table">
              <colgroup>
                <col style={{width:"26%"}} /><col style={{width:"8%"}} /><col style={{width:"8%"}} /><col style={{width:"8%"}} />
                <col style={{width:"26%"}} /><col style={{width:"8%"}} /><col style={{width:"8%"}} /><col style={{width:"8%"}} />
              </colgroup>
              <thead>
                <tr><th className="team-local" colSpan={4}>EQUIPO LOCAL · {localName}</th><th className="team-visitor" colSpan={4}>EQUIPO VISITANTE · {visitorName}</th></tr>
                <tr><th>JUGADOR</th><th>EST.</th><th>G</th><th>T A/R</th><th>JUGADOR</th><th>EST.</th><th>G</th><th>T A/R</th></tr>
              </thead>
              <tbody>{Array.from({length:rowCount},(_,index)=><tr key={index}>
                {renderPlayerCell(localPlayers[index],"local")}{renderPlayerCell(visitorPlayers[index],"visitante")}
              </tr>)}</tbody>
            </table>
          </div>
          <label className="fefutin-observations">OBSERVACIONES
            <textarea value={metadata.observaciones} onChange={(event)=>setMetadata((current)=>({...current,observaciones:event.target.value}))}/>
          </label>
          {notice&&<p className="fefutin-no-print" style={{color:"#166534",fontWeight:700}}>{notice}</p>}
          {error&&<p className="fefutin-no-print" style={{color:"#b91c1c"}}>{error}</p>}
          <div className="fefutin-sheet-actions fefutin-no-print">
            <button type="button" onClick={onClose}>Cerrar</button>
            <button type="button" onClick={save} disabled={saving} style={{background:"#b5122a",color:"#fff",borderColor:"#b5122a"}}>{saving?"Guardando...":"GUARDAR PLANILLA"}</button>
            <button type="button" onClick={()=>window.print()} style={{background:"#222",color:"#fff"}}>IMPRIMIR / GUARDAR PDF</button>
          </div>
        </>}
      </div>
    </div>
  );
}