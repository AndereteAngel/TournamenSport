import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

const norm = (value) => String(value || "").trim().toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");

const categoryOf = (tournament) => {
  const explicit = String(tournament?.category_detail || tournament?.category_type || "").trim();
  if (explicit) return explicit;
  const game = String(tournament?.game || "");
  const separator = game.indexOf(" · ");
  return separator >= 0 ? game.slice(separator + 3).trim() : "";
};

export function FefutinPrintableMatchSheet({ tournament, match, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [localPlayers, setLocalPlayers] = useState([]);
  const [visitorPlayers, setVisitorPlayers] = useState([]);
  const category = useMemo(() => categoryOf(tournament), [tournament]);
  const localName = String(match?.team1 || "").trim();
  const visitorName = String(match?.team2 || "").trim();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        if (!supabase || !tournament?.id || !localName || !visitorName) {
          throw new Error("No se pudo identificar el torneo y los dos clubes.");
        }
        const { data: registrations, error: registrationsError } = await supabase
          .from("fefutin_club_tournaments")
          .select("id, category_label, club_id")
          .eq("tournament_id", tournament.id);
        if (registrationsError) throw registrationsError;

        const categoryRegistrations = (registrations || []).filter((item) => {
          const registeredCategory = norm(item.category_label);
          const selectedCategory = norm(category);
          return registeredCategory === selectedCategory ||
            registeredCategory.includes(selectedCategory) ||
            selectedCategory.includes(registeredCategory);
        });
        const clubIds = [...new Set(categoryRegistrations.map((item) => item.club_id).filter(Boolean))];
        const { data: clubs, error: clubsError } = clubIds.length
          ? await supabase.from("fefutin_clubs").select("id, name").in("id", clubIds)
          : { data: [], error: null };
        if (clubsError) throw clubsError;

        const findClub = (name) => (clubs || []).find((club) => norm(club.name) === norm(name))
          || (clubs || []).find((club) => norm(club.name).includes(norm(name)) || norm(name).includes(norm(club.name)));
        const localClub = findClub(localName);
        const visitorClub = findClub(visitorName);
        if (!localClub || !visitorClub) {
          throw new Error("No encontramos la inscripción de " + (!localClub ? localName : visitorName) + " en la categoría " + (category || "del torneo") + ".");
        }
        const localRegistration = categoryRegistrations.find((item) => item.club_id === localClub.id);
        const visitorRegistration = categoryRegistrations.find((item) => item.club_id === visitorClub.id);
        const registrationIds = [localRegistration?.id, visitorRegistration?.id].filter(Boolean);
        const { data: teams, error: teamsError } = await supabase
          .from("fefutin_teams")
          .select("id, club_tournament_id")
          .in("club_tournament_id", registrationIds);
        if (teamsError) throw teamsError;
        const localTeam = (teams || []).find((team) => team.club_tournament_id === localRegistration?.id);
        const visitorTeam = (teams || []).find((team) => team.club_tournament_id === visitorRegistration?.id);
        if (!localTeam || !visitorTeam) throw new Error("Uno de los clubes todavía no tiene una lista de jugadores creada para esta categoría.");

        const teamIds = [localTeam.id, visitorTeam.id];
        const { data: roster, error: rosterError } = await supabase
          .from("fefutin_team_players")
          .select("id, team_id, first_name, last_name, jersey_number, approval_status, registry_player_id")
          .in("team_id", teamIds)
          .eq("approval_status", "aprobado");
        if (rosterError) throw rosterError;
        const registryIds = [...new Set((roster || []).map((player) => player.registry_player_id).filter(Boolean))];
        const { data: officialPlayers, error: officialError } = registryIds.length
          ? await supabase.from("fefutin_players").select("id, first_name, last_name, carnet_number").in("id", registryIds)
          : { data: [], error: null };
        if (officialError) throw officialError;
        const officialById = new Map((officialPlayers || []).map((player) => [player.id, player]));
        const build = (teamId) => (roster || []).filter((player) => player.team_id === teamId).map((player) => {
          const official = officialById.get(player.registry_player_id);
          return {
            first_name: official?.first_name || player.first_name || "",
            last_name: official?.last_name || player.last_name || "",
            jersey_number: player.jersey_number ?? "",
            carnet_number: official?.carnet_number || "",
          };
        });
        if (!cancelled) {
          setLocalPlayers(build(localTeam.id));
          setVisitorPlayers(build(visitorTeam.id));
        }
      } catch (err) {
        console.error("Error al generar planilla imprimible:", err);
        if (!cancelled) setError(err.message || "No se pudo cargar la lista de jugadores.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [tournament?.id, match?.id, category, localName, visitorName]);

  const rowCount = Math.max(15, localPlayers.length, visitorPlayers.length);
  const renderSide = (player) => <>
    <td className="shirt"></td>
    <td className="player">{player ? <><strong>{player.last_name}, {player.first_name}</strong><small>{player.carnet_number ? "Carnet " + player.carnet_number : ""}</small></> : ""}</td>
    <td></td><td></td><td></td>
  </>;

  return <div className="fefutin-sheet-overlay" role="dialog" aria-modal="true" aria-label="Planilla imprimible">
    <style>{`
      .fefutin-sheet-overlay{position:fixed;inset:0;z-index:10000;overflow:auto;padding:18px;background:rgba(0,0,0,.86)}
      .fefutin-print-sheet{width:100%;max-width:1500px;margin:0 auto;padding:24px;box-sizing:border-box;background:#fff!important;color:#111!important;font-family:Arial,sans-serif}
      .fefutin-print-sheet *{box-sizing:border-box;color:#111}
      .fefutin-sheet-title{text-align:center;border-bottom:3px solid #b5122a;padding-bottom:10px;margin-bottom:12px}
      .fefutin-sheet-title .brand{color:#b5122a!important;font-size:13px;font-weight:900;letter-spacing:2px}
      .fefutin-sheet-title h2{margin:5px 0;font-size:23px;text-transform:uppercase}
      .fefutin-sheet-title p{margin:3px 0;font-size:12px}
      .fefutin-sheet-meta{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin:12px 0 16px;font-size:10px;font-weight:800;text-transform:uppercase}
      .fefutin-sheet-meta span{border-bottom:1px solid #555;min-height:22px;padding:4px}
      .fefutin-sheet-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:9px}
      .fefutin-sheet-table th,.fefutin-sheet-table td{border:1px solid #777;padding:4px 3px;height:25px}
      .fefutin-sheet-table th{background:#292929;color:#fff!important;font-size:9px}
      .fefutin-sheet-table .local{background:#b5122a;color:#fff!important}
      .fefutin-sheet-table .visitor{background:#343a40;color:#fff!important}
      .fefutin-sheet-table .shirt{width:4%}
      .fefutin-sheet-table .player{width:22%;font-size:8px}
      .fefutin-sheet-table .player strong,.fefutin-sheet-table .player small{display:block}
      .fefutin-sheet-table .player small{font-size:6px;color:#555}
      .fefutin-sheet-signatures{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin:18px 0 8px}
      .fefutin-sheet-signatures div{text-align:center;border-top:1px solid #333;padding-top:4px;font-size:8px;font-weight:800;text-transform:uppercase}
      .fefutin-sheet-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}
      .fefutin-sheet-actions button{padding:10px 16px;border:0;border-radius:5px;background:#b5122a;color:#fff;font-weight:900;cursor:pointer}
      @page{size:A4 landscape;margin:5mm}
      @media print{
        html,body{margin:0!important;padding:0!important;background:#fff!important}
        body *{visibility:hidden!important}
        .fefutin-print-sheet,.fefutin-print-sheet *{visibility:visible!important}
        .fefutin-sheet-overlay{position:absolute!important;inset:0!important;padding:0!important;overflow:visible!important;background:#fff!important}
        .fefutin-print-sheet{max-width:none!important;width:100%!important;padding:0!important}
        .fefutin-sheet-actions{display:none!important}
        .fefutin-sheet-table th,.fefutin-sheet-table td{padding:2px!important;height:21px!important}
      }
    `}</style>
    <div className="fefutin-print-sheet">
      <header className="fefutin-sheet-title">
        <div className="brand">FEFUTIN · PLANILLA OFICIAL</div>
        <h2>{localName} vs. {visitorName}</h2>
        <p>{category || "Categoría"} · Fecha {match?.round || "____"}</p>
      </header>
      {loading ? <p>Cargando jugadores inscriptos...</p> : error ? <p style={{color:"#b91c1c",fontWeight:700}}>{error}</p> : <>
        <div className="fefutin-sheet-meta">
          <span>Fecha: __________________</span><span>Sede: ______________________________</span><span>Árbitro: __________________________</span>
        </div>
        <table className="fefutin-sheet-table">
          <colgroup>{[4,22,8,8,8,4,22,8,8,8].map((w,i)=><col key={i} style={{width:w+"%"}} />)}</colgroup>
          <thead>
            <tr><th className="local" colSpan="5">EQUIPO LOCAL · {localName}</th><th className="visitor" colSpan="5">EQUIPO VISITANTE · {visitorName}</th></tr>
            <tr><th>N°</th><th>JUGADOR</th><th>EST.</th><th>G</th><th>T A/R</th><th>N°</th><th>JUGADOR</th><th>EST.</th><th>G</th><th>T A/R</th></tr>
          </thead>
          <tbody>{Array.from({length:rowCount},(_,i)=><tr key={i}>{renderSide(localPlayers[i])}{renderSide(visitorPlayers[i])}</tr>)}</tbody>
        </table>
        <div className="fefutin-sheet-signatures"><div>Firma referente local</div><div>Firma referente visitante</div></div>
      </>}
      <div className="fefutin-sheet-actions">
        <button type="button" onClick={onClose} style={{background:"#333"}}>CERRAR</button>
        <button type="button" onClick={()=>window.print()}>IMPRIMIR / GUARDAR PDF</button>
      </div>
    </div>
  </div>;
}
