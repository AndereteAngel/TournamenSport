import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
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

  // La aprobacion del padron permanente habilita al jugador para integrar
  // la planilla. Solo un rechazo o una inhabilitacion explicita lo impiden;
  // un carnet pendiente no genera una segunda aprobacion.
  if (["rechazado", "no_aprobado", "inactivo"].includes(approval) ||
      ["rechazado", "no_habilitado"].includes(carnet)) return "NO HABILITADO";
  if (approval === "aprobado") return "HABILITADO";
  return "PENDIENTE DE VERIFICACIÓN";
};

export function FefutinMatchSheet({ tournament, match, categoryLabel = "", initialSide = "local", onClose, isReferee = false, isAdmin = false, onCloseMatch }) {
  const [currentUserId, setCurrentUserId] = useState("");
  useEffect(() => {
    let active = true;
    supabase?.auth.getUser().then(({ data }) => { if (active) setCurrentUserId(data?.user?.id || ""); });
    return () => { active = false; };
  }, []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [closingMatch, setClosingMatch] = useState(false);
  const [categoryPhotoFile, setCategoryPhotoFile] = useState(null);
  const [uploadingCategoryPhoto, setUploadingCategoryPhoto] = useState(false);
  const [categoryPhotoNotice, setCategoryPhotoNotice] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sheetId, setSheetId] = useState(null);
  const [activeSide, setActiveSide] = useState(initialSide === "visitante" ? "visitante" : "local");
  const [metadata, setMetadata] = useState({
    jornada: String(match?.journey_number || match?.round || ""),
    turno: String(match?.turno || ""),
    sede: "",
    fecha_partido: "",
    arbitro_designado: "",
    observaciones: "",
  });
  const [localPlayers, setLocalPlayers] = useState([]);
  const [visitorPlayers, setVisitorPlayers] = useState([]);
  const [localClubLogoPath, setLocalClubLogoPath] = useState("");
  const [visitorClubLogoPath, setVisitorClubLogoPath] = useState("");

  const category = useMemo(() => String(categoryLabel || getCategory(tournament)).trim(), [categoryLabel, tournament]);
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

        let assignedRefereeName = "";
        if (match?.referee_id) {
          const [
            { data: refereeProfile, error: refereeProfileError },
            { data: refereeCarnets, error: refereeCarnetsError },
          ] = await Promise.all([
            (isReferee || isAdmin)
              ? supabase.from("profiles").select("id, username").eq("id", match.referee_id).maybeSingle()
              : Promise.resolve({ data: null, error: null }),
            isReferee || isAdmin
              ? supabase.rpc("get_fefutin_referee_carnets")
              : Promise.resolve({ data: [], error: null }),
          ]);
          if (refereeProfileError) throw refereeProfileError;
          if (refereeCarnetsError) throw refereeCarnetsError;
          const refereeCarnet = (refereeCarnets || []).find((item) => item.id === match.referee_id);
          assignedRefereeName = [refereeCarnet?.first_name, refereeCarnet?.last_name].filter(Boolean).join(" ").trim()
            || refereeProfile?.username
            || "";
        }

        const normalizedMatchId = String(match.id);
        const isNormalizedMatch = Boolean(match?.round_id || match?.tournament_category_id) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalizedMatchId);
        let normalizedRoster = null;
        let localClub = null;
        let visitorClub = null;
        let local = [];
        let visitor = [];

        if (isNormalizedMatch) {
          const { data: rosterData, error: rosterError } = await supabase.rpc("get_fefutin_match_sheet_roster", {
            p_match_id: normalizedMatchId,
          });
          if (rosterError) throw rosterError;
          if (!rosterData?.local || !rosterData?.visitor) {
            throw new Error("No se encontraron las inscripciones exactas de ambos clubes para esta categoría y turno.");
          }
          normalizedRoster = rosterData;
          const rosterClubIds = [rosterData.local.club_id, rosterData.visitor.club_id].filter(Boolean);
          const { data: rosterClubs, error: rosterClubsError } = rosterClubIds.length
            ? await supabase.from("fefutin_clubs").select("id, name, headquarters_address, logo_path").in("id", rosterClubIds)
            : { data: [], error: null };
          if (rosterClubsError) throw rosterClubsError;
          localClub = {
            id: rosterData.local.club_id,
            name: rosterData.local.name,
            headquarters_address: rosterData.local.headquarters_address || "",
            logo_path: (rosterClubs || []).find((club) => club.id === rosterData.local.club_id)?.logo_path || "",
          };
          visitorClub = {
            id: rosterData.visitor.club_id,
            name: rosterData.visitor.name,
            headquarters_address: rosterData.visitor.headquarters_address || "",
            logo_path: (rosterClubs || []).find((club) => club.id === rosterData.visitor.club_id)?.logo_path || "",
          };
          const toSheetPlayers = (players, clubName) => (players || []).map((player) => ({
            ...player,
            player_id: player.player_id,
            club: clubName,
            nombre: player.nombre || "",
            apellido: player.apellido || "",
            carnet_number: player.carnet_number || "",
            dni: player.dni || "",
            numero_camiseta: player.numero_camiseta === "" || player.numero_camiseta == null
              ? ""
              : Number(player.numero_camiseta),
            goles: Number(player.goles || 0),
            es_capitan: Boolean(player.es_capitan),
            tarjetas_amarillas: Number(player.tarjetas_amarillas || 0),
            tarjetas_rojas: Number(player.tarjetas_rojas || 0),
            estado_habilitacion: getPlayerStatus(player),
            observaciones: player.observaciones || "",
          }));
          local = toSheetPlayers(rosterData.local.players, localName);
          visitor = toSheetPlayers(rosterData.visitor.players, visitorName);
        } else {
          // Compatibilidad temporal: los partidos antiguos siguen leyendo sus inscripciones legacy.
          let legacyTurnId = null;
          if (tournament?.fefutin_branch_id) {
            const { data: turnRows, error: turnRowsError } = await supabase.rpc("get_fefutin_tournament_turns", {
              p_tournament_id: tournament.id,
            });
            if (turnRowsError) throw turnRowsError;
            const legacyTurnName = tournament.fefutin_turno ||
              (String(tournament.game || "").toLocaleLowerCase("es").includes("fin de semana") ? "Fin de semana" : "Semanal");
            legacyTurnId = (turnRows || []).find((item) => item.turno === legacyTurnName)?.turn_id || null;
          }
          let registrationsQuery = supabase
            .from("fefutin_club_tournaments")
            .select("id, category_label, club_id, turn_id")
            .eq("tournament_id", tournament.id);
          if (legacyTurnId) registrationsQuery = registrationsQuery.eq("turn_id", legacyTurnId);
          const { data: registrations, error: registrationsError } = await registrationsQuery;
          if (registrationsError) throw registrationsError;

          const categoryParts = String(category || "").split("·").map((part) => part.trim()).filter(Boolean);
          const categoryName = categoryParts[categoryParts.length - 1] || "";
          const matchingRegistrations = (registrations || []).filter((item) => {
            const registrationCategory = normalize(item.category_label);
            return registrationCategory === normalize(category) ||
              registrationCategory === normalize(categoryName) ||
              registrationCategory === normalize("TODA LA TIRA");
          });
          const clubIds = [...new Set(matchingRegistrations.map((item) => item.club_id).filter(Boolean))];
          const { data: clubs, error: clubsError } = clubIds.length
            ? await supabase.from("fefutin_clubs").select("id, name, headquarters_address, court_type, logo_path").in("id", clubIds)
            : { data: [], error: null };
          if (clubsError) throw clubsError;

          localClub = (clubs || []).find((club) => normalize(club.name) === normalize(localName));
          visitorClub = (clubs || []).find((club) => normalize(club.name) === normalize(visitorName));

          const localRegistration = localClub
            ? matchingRegistrations.find((item) => item.club_id === localClub.id)
            : null;
          const visitorRegistration = visitorClub
            ? matchingRegistrations.find((item) => item.club_id === visitorClub.id)
            : null;
          const registrationIds = [localRegistration?.id, visitorRegistration?.id].filter(Boolean);
          const { data: teams, error: teamsError } = registrationIds.length
            ? await supabase.from("fefutin_teams")
                .select("id, club_tournament_id, status")
                .in("club_tournament_id", registrationIds)
            : { data: [], error: null };
          if (teamsError) throw teamsError;

          const localTeam = localRegistration
            ? (teams || []).find((team) => team.club_tournament_id === localRegistration.id)
            : null;
          const visitorTeam = visitorRegistration
            ? (teams || []).find((team) => team.club_tournament_id === visitorRegistration.id)
            : null;
          const teamIds = [localTeam?.id, visitorTeam?.id].filter(Boolean);
          const { data: teamPlayers, error: teamPlayersError } = teamIds.length
            ? await supabase.from("fefutin_team_players")
                .select("id, team_id, first_name, last_name, jersey_number, approval_status, registry_player_id")
                .in("team_id", teamIds)
                .eq("approval_status", "aprobado")
            : { data: [], error: null };
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

          local = localTeam ? buildPlayers(localTeam.id, localName) : [];
          visitor = visitorTeam ? buildPlayers(visitorTeam.id, visitorName) : [];
        }

        let existingSheetsQuery = supabase
          .from("fefutin_match_sheets")
          .select("*")
          .eq("tournament_id", tournament.id);
        existingSheetsQuery = isNormalizedMatch
          ? existingSheetsQuery.eq("normalized_match_id", normalizedMatchId)
          : existingSheetsQuery.eq("match_id", String(match.id));
        const { data: existingSheets, error: sheetError } = await existingSheetsQuery;
        if (sheetError) throw sheetError;

        const localSheet = (existingSheets || []).find((item) => item.lado === "local");
        const visitorSheet = (existingSheets || []).find((item) => item.lado === "visitante");
        const legacySheet = (existingSheets || []).find((item) => !item.lado || item.lado === "conjunta");
        const metadataSheet = localSheet || visitorSheet || legacySheet;
        setSheetId(localSheet?.id || legacySheet?.id || null);

        if (metadataSheet) {
          setMetadata({
            jornada: metadataSheet.jornada || String(normalizedRoster?.round_number || match?.round || ""),
            sede: metadataSheet.sede || normalizedRoster?.venue_address || localClub?.headquarters_address || "",
            // La fecha oficial siempre proviene del fixture normalizado; el dato guardado
            // en una planilla anterior solo funciona como respaldo para partidos legacy.
            fecha_partido: normalizedRoster?.scheduled_date || match?.scheduled_date || match?.match_date || metadataSheet.fecha_partido || "",
            arbitro_designado: assignedRefereeName || metadataSheet.arbitro_designado || "",
            observaciones: metadataSheet.observaciones || "",
          });
        } else {
          setMetadata((current) => ({
            ...current,
            sede: current.sede || localClub?.headquarters_address || "",
            arbitro_designado: assignedRefereeName || current.arbitro_designado || "",
            fecha_partido: normalizedRoster?.scheduled_date || match?.scheduled_date || match?.match_date || current.fecha_partido || "",
          }));
        }

        const sheetIdsToLoad = [localSheet?.id, visitorSheet?.id, legacySheet?.id].filter(Boolean);
        if (sheetIdsToLoad.length) {
          const { data: savedPlayers, error: savedPlayersError } = await supabase
            .from("fefutin_match_sheet_players")
            .select("*")
            .in("match_sheet_id", sheetIdsToLoad);
          if (savedPlayersError) throw savedPlayersError;

          const localSaved = (savedPlayers || []).filter((item) =>
            item.match_sheet_id === (localSheet?.id || legacySheet?.id) &&
            normalize(item.club) === normalize(localName)
          );
          const visitorSaved = (savedPlayers || []).filter((item) =>
            item.match_sheet_id === (visitorSheet?.id || legacySheet?.id) &&
            normalize(item.club) === normalize(visitorName)
          );
          const mergeSaved = (players, rows) => {
            const savedByPlayer = new Map(rows.map((item) => [item.player_id, item]));
            return players.map((player) => {
              const saved = savedByPlayer.get(player.player_id);
              return saved ? { ...player, ...saved, carnet_number: player.carnet_number, dni: player.dni } : player;
            });
          };
          local = mergeSaved(local, localSaved);
          visitor = mergeSaved(visitor, visitorSaved);
        }

        if (!cancelled) {
          setLocalPlayers(local);
          setVisitorPlayers(visitor);
          setLocalClubLogoPath(localClub?.logo_path || "");
          setVisitorClubLogoPath(visitorClub?.logo_path || "");
          setMetadata((current) => ({ ...current, sede: current.sede || localClub?.headquarters_address || "" }));
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
  }, [tournament?.id, match?.id, category, localName, visitorName, isReferee, isAdmin]);

  const updatePlayer = (side, playerId, field, value) => {
    const setter = side === "local" ? setLocalPlayers : setVisitorPlayers;
    setter((current) => current.map((player) =>
      player.player_id === playerId ? { ...player, [field]: value } : player
    ));
  };

  const save = async () => {
    if (!supabase || saving || match?.referee_closed) return false;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const userId = (await supabase.auth.getUser()).data?.user?.id || null;
      const basePayload = {
        tournament_id: tournament.id,
        match_id: String(match.id),
        normalized_match_id: (match?.round_id || match?.tournament_category_id) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(match.id)) ? String(match.id) : null,
        turn_id: match.turn_id || null,
        tournament_category_id: match.tournament_category_id || null,
        jornada: metadata.jornada || null,
        club_local: localName,
        club_visitante: visitorName,
        sede: metadata.sede || null,
        fecha_partido: metadata.fecha_partido || null,
        categoria: category || null,
        arbitro_designado: metadata.arbitro_designado || null,
        observaciones: metadata.observaciones || null,
        updated_by: userId,
      };

      const validatePlayerStats = (players, clubName) => {
        for (const player of players) {
          for (const field of ["goles", "tarjetas_amarillas", "tarjetas_rojas"]) {
            const value = Number(player[field] ?? 0);
            if (!Number.isInteger(value) || value < 0) {
              throw new Error("Revisá los datos de " + clubName + ": goles y tarjetas deben ser números enteros iguales o mayores a cero.");
            }
          }
        }
      };

      validatePlayerStats(localPlayers, localName);
      validatePlayerStats(visitorPlayers, visitorName);

      const saveSide = async (lado, players) => {
        const { data: sheet, error: saveSheetError } = await supabase
          .from("fefutin_match_sheets")
          .upsert({ ...basePayload, lado }, { onConflict: "tournament_id,match_id,lado" })
          .select("id")
          .single();
        if (saveSheetError) throw saveSheetError;

        const allPlayers = players.map((player) => ({
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
          estado_habilitacion: (() => {
            const status = normalize(player.estado_habilitacion);
            if (status === "habilitado") return "habilitado";
            if (status === "no habilitado" || status === "no_habilitado") return "no_habilitado";
            return "pendiente";
          })(),
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
        return sheet.id;
      };

      const [localSheetId, visitorSheetId] = await Promise.all([
        saveSide("local", localPlayers),
        saveSide("visitante", visitorPlayers),
      ]);
      setSheetId(localSheetId);
      setNotice("Planilla guardada correctamente.");
      return true;
    } catch (err) {
      console.error("Error al guardar la planilla:", err);
      setError(err.message || "No se pudo guardar la planilla.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const uploadCategoryPhoto = async () => {
    if (!supabase || !currentUserId || !sheetId || !categoryPhotoFile || uploadingCategoryPhoto || !match?.referee_closed) return;
    setUploadingCategoryPhoto(true);
    setError("");
    setCategoryPhotoNotice("");
    let storagePath = "";
    try {
      const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
      if (!allowedTypes.includes(categoryPhotoFile.type)) throw new Error("La foto debe estar en formato JPG, PNG o WEBP.");
      if (categoryPhotoFile.size > 12 * 1024 * 1024) throw new Error("La imagen no puede superar los 12 MB.");
      const extension = categoryPhotoFile.name.split(".").pop()?.toLowerCase() || "jpg";
      storagePath = `${currentUserId}/categoria-${sheetId}-${Date.now()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from("fefutin-jornada-photos")
        .upload(storagePath, categoryPhotoFile, { contentType: categoryPhotoFile.type, upsert: false });
      if (uploadError) throw uploadError;
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      const { error: insertError } = await supabase.from("fefutin_jornada_photos").insert({
        tournament_id: tournament.id,
        turn_id: match.turn_id || null,
        turn_journey_id: match.turn_journey_id || null,
        turno: match.turno || null,
        journey_number: Number(match.journey_number || match.round) || null,
        jornada_date: metadata.fecha_partido || new Date().toISOString().slice(0, 10),
        jornada_label: metadata.jornada || null,
        referee_id: authData.user.id,
        referee_name: metadata.arbitro_designado || null,
        storage_path: storagePath,
        original_filename: categoryPhotoFile.name,
        document_type: "category",
        match_sheet_id: sheetId,
        categoria: category || null,
      });
      if (insertError) throw insertError;
      setCategoryPhotoFile(null);
      setCategoryPhotoNotice("Foto de la planilla de esta categoría guardada en el archivo.");
    } catch (uploadError) {
      if (storagePath) await supabase.storage.from("fefutin-jornada-photos").remove([storagePath]);
      console.error("No se pudo guardar la foto de la planilla de categoría:", uploadError);
      setError(uploadError.message || "No se pudo guardar la foto.");
    } finally {
      setUploadingCategoryPhoto(false);
    }
  };

  const closeMatch = async () => {
    if (!isReferee || match?.referee_closed || closingMatch || saving) return;
    const saved = await save();
    if (!saved) return;
    const score1 = localPlayers.reduce((total, player) => total + Number(player.goles || 0), 0);
    const score2 = visitorPlayers.reduce((total, player) => total + Number(player.goles || 0), 0);
    setClosingMatch(true);
    try {
      const closed = await onCloseMatch?.({ score1, score2 });
      if (closed) setNotice("Partido cerrado. La planilla quedó bloqueada.");
    } finally {
      setClosingMatch(false);
    }
  };

  const renderPlayerCell = (player, side) => {
    if (!player) return <><td></td><td></td><td></td><td></td><td></td></>;
    const statusColor = player.estado_habilitacion === "HABILITADO" ? "#166534" : player.estado_habilitacion === "NO HABILITADO" ? "#b91c1c" : "#92400e";
    return <>
      <td className="fefutin-shirt-number"><strong aria-label={"Número de camiseta " + player.nombre}>{player.numero_camiseta || "—"}</strong></td>
      <td className="fefutin-player-name">
        <strong>{player.apellido}, {player.nombre}</strong>
        <small>{player.carnet_number || "Sin carnet"}</small>
        <label className="fefutin-captain"><input type="checkbox" checked={Boolean(player.es_capitan)} disabled={Boolean(match?.referee_closed)} onChange={(event) => updatePlayer(side, player.player_id, "es_capitan", event.target.checked)} /> Capitán</label>
      </td>
      <td className="fefutin-status" style={{ color:statusColor }}>{player.estado_habilitacion === "HABILITADO" ? "HABIL." : player.estado_habilitacion === "NO HABILITADO" ? "NO HABIL." : "PEND. VERIF."}</td>
      {isReferee ? <>
        <td className="fefutin-goals"><input aria-label={"Goles " + player.nombre} type="number" min="0" step="1" value={player.goles ?? 0} disabled={Boolean(match?.referee_closed)} onChange={(event) => updatePlayer(side, player.player_id, "goles", event.target.value)} /></td>
        <td className="fefutin-cards">
          <label>A <input aria-label={"Tarjetas amarillas " + player.nombre} type="number" min="0" step="1" value={player.tarjetas_amarillas ?? 0} disabled={Boolean(match?.referee_closed)} onChange={(event) => updatePlayer(side, player.player_id, "tarjetas_amarillas", event.target.value)} /></label>
          <label>R <input aria-label={"Tarjetas rojas " + player.nombre} type="number" min="0" step="1" value={player.tarjetas_rojas ?? 0} disabled={Boolean(match?.referee_closed)} onChange={(event) => updatePlayer(side, player.player_id, "tarjetas_rojas", event.target.value)} /></label>
        </td>
      </> : <><td className="fefutin-goals"></td><td className="fefutin-cards"></td></>}
    </>;
  };
  const activePlayers = activeSide === "local" ? localPlayers : visitorPlayers;
  const activeClubName = activeSide === "local" ? localName : visitorName;
  const displayedPlayers = activePlayers.length ? activePlayers : Array.from({ length: 14 }, () => null);
  const fefutinLogoUrl = "https://fefutin.wordpress.com/wp-content/uploads/2017/03/fefutin-logo-grande1.png?h=184&w=166";
  const getClubLogoUrl = (logoPath) => logoPath
    ? supabase.storage.from("fefutin-clubs").getPublicUrl(logoPath).data.publicUrl
    : "";
  const finalScoreLocal = localPlayers.reduce((total, player) => total + Number(player.goles || 0), 0);
  const finalScoreVisitor = visitorPlayers.reduce((total, player) => total + Number(player.goles || 0), 0);

  return createPortal((
    <div role="dialog" aria-modal="true" aria-label="Planilla oficial de partido" className="fefutin-sheet-overlay">
      <style>{`
        .fefutin-sheet-overlay{position:fixed!important;inset:0!important;z-index:2147483000!important;width:100vw!important;height:100dvh!important;min-height:100dvh!important;overflow-x:hidden!important;overflow-y:auto!important;display:block!important;padding:0!important;background:rgba(0,0,0,.92)!important;-webkit-overflow-scrolling:touch}
        .fefutin-print-sheet{display:block!important;width:100%!important;max-width:none!important;height:auto!important;min-height:100dvh!important;margin:0!important;padding:16px 12px 28px!important;box-sizing:border-box;background:#fff!important;color:#111!important;border-radius:0!important;box-shadow:none!important;font-family:Arial,sans-serif}
        .fefutin-print-sheet *{box-sizing:border-box;color:#111}
        .fefutin-print-both{display:none}
        @media print{
          .fefutin-print-sheet > :not(.fefutin-print-both){display:none!important}
          .fefutin-print-both{display:block!important}
          .fefutin-print-team-page{display:flex!important;flex-direction:column!important;width:100%!important;height:204mm!important;min-height:204mm!important;max-height:204mm!important;box-sizing:border-box!important;break-after:page;page-break-after:always;break-inside:avoid!important;page-break-inside:avoid!important}
          .fefutin-print-team-page:last-child{break-after:auto;page-break-after:auto}
          .fefutin-print-team-page .fefutin-sheet-title{margin-bottom:8px!important;padding-bottom:6px!important}
          .fefutin-print-brand{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:2mm 0 3mm!important;min-height:17mm!important}
          .fefutin-print-brand img{display:block;width:17mm!important;height:17mm!important;object-fit:contain}
          .fefutin-print-brand .league-logo{width:20mm!important;height:17mm!important}
          .fefutin-print-brand .club-logo{width:17mm!important;height:17mm!important}
          .fefutin-print-brand .club-logo-placeholder{width:17mm!important;height:17mm!important;border:1px dashed #999;display:flex;align-items:center;justify-content:center;font-size:7px;font-weight:800;text-align:center;color:#555}
          .fefutin-print-brand-spacer{width:17mm;height:1px}
          .fefutin-print-team-page .fefutin-sheet-table{width:100%!important;min-width:0!important;flex:1 1 auto!important;height:auto!important}
          .fefutin-print-team-page .fefutin-sheet-signatures{display:grid!important;margin-top:auto!important;padding-top:5mm!important;min-height:18mm!important}
        }
        .fefutin-sheet-title{text-align:center;border-bottom:3px solid #b5122a;padding-bottom:12px;margin-bottom:14px}
        .fefutin-sheet-title .brand{color:#b5122a!important;font-size:13px;font-weight:900;letter-spacing:2px}
        .fefutin-sheet-title h2{margin:5px 0;font-size:23px;color:#111!important;text-transform:uppercase}
        .fefutin-sheet-title p{margin:3px 0;font-size:12px;color:#333!important}
        .fefutin-sheet-meta{display:grid;grid-template-columns:76px minmax(0,1.35fr) 135px minmax(0,1.35fr);gap:10px;margin:14px 0;align-items:end;width:100%;min-width:0}
        .fefutin-sheet-meta label{display:grid;grid-template-rows:auto 28px;gap:4px;font-size:10px;font-weight:700;text-transform:uppercase;color:#333!important;min-width:0;width:100%;overflow:hidden}
        .fefutin-sheet-meta input{display:block;box-sizing:border-box;width:100%!important;max-width:100%!important;min-width:0!important;height:28px!important;min-height:28px!important;max-height:28px!important;line-height:20px!important;border:1px solid #999!important;border-radius:3px!important;padding:3px 6px!important;background:#fff!important;color:#111!important;font-size:11px!important;box-shadow:none!important;margin:0!important}

        .fefutin-sheet-signatures{display:none;grid-template-columns:1fr 1fr;gap:24px;margin:8px 0 10px;align-items:end}
        .fefutin-sheet-signature{display:flex;flex-direction:column;gap:4px;text-align:center;font-size:9px;font-weight:800;text-transform:uppercase}
        .fefutin-sheet-signature .line{height:22px;border-bottom:1px solid #333}
        .fefutin-sheet-table-wrap{width:100%;overflow-x:auto}
        .fefutin-sheet-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:9px;background:#fff!important}.fefutin-sheet-table col:nth-child(1),.fefutin-sheet-table col:nth-child(6){width:4%!important}.fefutin-sheet-table col:nth-child(2),.fefutin-sheet-table col:nth-child(7){width:22%!important}.fefutin-sheet-table col:nth-child(3),.fefutin-sheet-table col:nth-child(4),.fefutin-sheet-table col:nth-child(5),.fefutin-sheet-table col:nth-child(8),.fefutin-sheet-table col:nth-child(9),.fefutin-sheet-table col:nth-child(10){width:8%!important}
        .fefutin-sheet-table th,.fefutin-sheet-table td{border:1px solid #777!important;padding:5px 4px;vertical-align:middle;color:#111!important;background-clip:padding-box}
        .fefutin-sheet-table thead th{background:#292929!important;color:#fff!important;text-align:center;font-weight:800;font-size:10px;line-height:1.2}
        .fefutin-sheet-table thead .team-local{background:#b5122a!important;color:#fff!important;font-size:11px}
        .fefutin-sheet-table thead .team-visitor{background:#343a40!important;color:#fff!important;font-size:11px}
        .fefutin-sheet-table .fefutin-shirt-number{text-align:center;font-size:9px!important;font-weight:800;white-space:nowrap}.fefutin-shirt-number input{width:100%!important;max-width:100%!important;height:22px!important;min-height:22px!important;padding:1px!important;text-align:center!important;border:1px solid #999!important;border-radius:3px!important;background:#fff!important;color:#111!important;font-size:10px!important;box-shadow:none!important}.fefutin-sheet-table .fefutin-player-name{font-size:9px!important;line-height:1.25;color:#111!important}
        .fefutin-player-name strong{display:block;font-size:9px!important;color:#111!important;white-space:normal;overflow-wrap:anywhere}
        .fefutin-player-name small{display:block;margin-top:3px;color:#555!important;font-size:7px!important}
        .fefutin-captain{display:flex;align-items:center;gap:3px;margin-top:4px;font-size:7px!important;font-weight:600;color:#333!important}
        .fefutin-captain input{appearance:auto!important;width:11px!important;height:11px!important;min-height:11px!important;margin:0!important;padding:0!important;accent-color:#b5122a}
        .fefutin-sheet-table .fefutin-status{ text-align:center;font-size:7px!important;line-height:1.2;font-weight:900;color:#111!important;overflow-wrap:anywhere}
        .fefutin-goals,.fefutin-cards{text-align:center;vertical-align:middle}
        .fefutin-cards{white-space:nowrap;text-align:center!important}.fefutin-cards label{display:inline-flex!important;flex-direction:row!important;align-items:center!important;justify-content:center!important;vertical-align:middle!important;gap:2px!important;margin:0 2px!important;font-size:8px!important;line-height:1!important;color:#111!important;white-space:nowrap!important}.fefutin-cards input{display:inline-block!important;flex:0 0 20px!important;width:20px!important;min-width:20px!important;height:20px!important;min-height:20px!important;margin:0!important}
        .fefutin-shirt-number input,.fefutin-goals input,.fefutin-cards input{appearance:none!important;display:block!important;box-sizing:border-box!important;width:26px!important;max-width:calc(100% - 4px)!important;height:24px!important;min-height:24px!important;margin:2px auto!important;padding:2px!important;text-align:center!important;border:1px solid #999!important;border-radius:3px!important;background:#fff!important;color:#111!important;font-size:10px!important;box-shadow:none!important}
        .fefutin-sheet-table tbody tr{height:29px}
        .fefutin-sheet-table tbody tr:nth-child(even) td{background:#f3f3f3!important}
        .fefutin-observations{display:grid;gap:5px;margin-top:14px;font-size:10px;font-weight:700;color:#222!important}
        .fefutin-observations textarea{width:100%;border:1px solid #777!important;min-height:48px;padding:6px;background:#fff!important;color:#111!important;font-size:11px!important}
        .fefutin-sheet-result{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:8px;margin:10px 0 4px;padding:9px 12px;border:2px solid #b5122a;border-radius:4px;text-align:center;font-size:13px;font-weight:900;text-transform:uppercase}.fefutin-sheet-result .score{font-size:20px;white-space:nowrap}.fefutin-sheet-result input{width:42px!important;height:32px!important;min-height:32px!important;padding:3px!important;text-align:center!important;border:1px solid #777!important;border-radius:3px!important;background:#fff!important;color:#111!important;font-size:18px!important;font-weight:900!important}.fefutin-sheet-result input:disabled{opacity:1!important;background:#f3f3f3!important}.fefutin-sheet-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:10px;margin-top:16px;min-width:0}
        .fefutin-sheet-actions button{display:flex;align-items:center;justify-content:center;flex:1 1 145px;min-width:0;max-width:100%;min-height:42px;padding:9px 10px;border-radius:5px;border:1px solid #333;cursor:pointer;font-weight:800;line-height:1.2;text-align:center;white-space:normal;overflow-wrap:anywhere;word-break:normal}
        @media(max-width:700px){.fefutin-sheet-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.fefutin-sheet-actions button{width:100%;min-width:0;padding:9px 6px;font-size:12px}.fefutin-sheet-actions strong{grid-column:1/-1;text-align:center}}
        @page{size:A4 landscape;margin:4mm 6mm}
        @media(max-width:700px){.fefutin-print-sheet{padding:12px}.fefutin-sheet-meta{grid-template-columns:76px minmax(0,1fr);gap:8px}.fefutin-sheet-meta label{grid-column:auto!important}.fefutin-sheet-meta label:nth-child(3),.fefutin-sheet-meta label:nth-child(4){grid-column:1 / -1!important}.fefutin-sheet-title h2{font-size:17px}.fefutin-sheet-table{min-width:680px}}
        @media print{
          html,body{background:#fff!important;margin:0!important;padding:0!important}
          body *{visibility:hidden!important}
          .fefutin-print-sheet,.fefutin-print-sheet *{visibility:visible!important}
          .fefutin-sheet-overlay{position:absolute!important;inset:0!important;overflow:visible!important;padding:0!important;background:#fff!important}
          .fefutin-print-sheet{position:relative!important;width:100%!important;max-width:none!important;margin:0!important;padding:0!important;box-shadow:none!important;border-radius:0!important}
          .fefutin-no-print,.fefutin-sheet-actions{display:none!important}
          .fefutin-sheet-title{padding-bottom:5px!important;margin-bottom:6px!important}
          .fefutin-sheet-title .brand{font-size:10px!important}
          .fefutin-sheet-title h2{font-size:14px!important;margin:2px 0!important}
          .fefutin-sheet-title p{font-size:9px!important;margin:1px 0!important}
          .fefutin-sheet-table-wrap{overflow:visible!important}
          .fefutin-sheet-table{width:100%!important;min-width:0!important;font-size:8px!important}
          .fefutin-sheet-table th,.fefutin-sheet-table td{padding:3px 2px!important}
          .fefutin-sheet-table thead th{font-size:8px!important}
          .fefutin-sheet-table tbody tr{height:25px!important;break-inside:avoid}
          .fefutin-sheet-title h2{font-size:14px!important}
          .fefutin-sheet-meta{margin:4px 0!important}
          .fefutin-observations{margin-top:6px!important;gap:3px!important}
          .fefutin-observations textarea{min-height:28px!important;height:28px!important}
          .fefutin-sheet-meta{grid-template-columns:76px minmax(0,1.35fr) 135px minmax(0,1.35fr)!important;gap:8px!important;margin:7px 0!important;width:100%!important}.fefutin-sheet-meta label{min-width:0!important;width:100%!important;overflow:hidden!important}.fefutin-sheet-meta input{box-sizing:border-box!important;width:100%!important;min-width:0!important;max-width:100%!important;height:23px!important;min-height:23px!important;max-height:23px!important;font-size:9px!important;padding:2px 4px!important;margin:0!important}
          .fefutin-sheet-meta input,.fefutin-observations textarea,
          .fefutin-sheet-table input:not([type="checkbox"]){
            appearance:none!important;
            -webkit-appearance:none!important;
            color:transparent!important;
            -webkit-text-fill-color:transparent!important;
            background:transparent!important;
            box-shadow:none!important;
            border:0!important;
            border-bottom:1px solid #777!important;
            border-radius:0!important;
            outline:none!important;
          }
          .fefutin-sheet-table input:not([type="checkbox"]){height:18px!important;min-height:18px!important;padding:0!important}
          .fefutin-sheet-table .fefutin-shirt-number input{width:90%!important}
          .fefutin-sheet-table .fefutin-cards input{width:32px!important;max-width:90%!important}
          .fefutin-sheet-table input[type="checkbox"]{display:none!important}
          .fefutin-sheet-meta input{height:17px!important;min-height:17px!important;padding:0!important}
          .fefutin-observations textarea{resize:none!important}
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

        /* Reglas finales: prioridad exclusiva para la hoja impresa */
        @media print{
          @page{size:A4 landscape;margin:3mm 5mm}
          .fefutin-sheet-overlay{padding:0!important;margin:0!important}
          .fefutin-print-sheet{padding:0!important;margin:0!important}
          .fefutin-sheet-title{padding-bottom:3px!important;margin-bottom:4px!important}
          .fefutin-sheet-title .brand{font-size:9px!important}
          .fefutin-sheet-title h2{font-size:13px!important;margin:1px 0!important}
          .fefutin-sheet-title p{font-size:8px!important;margin:0!important}
          .fefutin-sheet-meta{margin:3px 0!important;gap:5px!important}
          .fefutin-sheet-signatures{display:grid!important;margin:4px 0 6px!important;gap:24px!important}
          .fefutin-sheet-signature{font-size:7px!important;gap:2px!important}
          .fefutin-sheet-signature .line{height:16px!important}

          .fefutin-sheet-meta label{font-size:8px!important;grid-template-rows:auto 15px!important;gap:2px!important}
          .fefutin-print-sheet .fefutin-sheet-meta input,
          .fefutin-print-sheet .fefutin-observations textarea,
          .fefutin-print-sheet .fefutin-sheet-table input:not([type="checkbox"]){
            appearance:none!important;-webkit-appearance:none!important;
            background:transparent!important;background-color:transparent!important;
            color:transparent!important;-webkit-text-fill-color:transparent!important;
            border:0!important;border-bottom:1px solid #555!important;
            border-radius:0!important;box-shadow:none!important;text-shadow:none!important;outline:none!important;
          }
          .fefutin-print-sheet .fefutin-sheet-table input:not([type="checkbox"]){height:14px!important;min-height:14px!important;padding:0!important}
          .fefutin-print-sheet .fefutin-sheet-table .fefutin-shirt-number input,
          .fefutin-print-sheet .fefutin-sheet-table .fefutin-goals input,
          .fefutin-print-sheet .fefutin-sheet-table .fefutin-cards input{width:26px!important;max-width:calc(100% - 4px)!important;height:14px!important;min-height:14px!important;margin:1px auto!important}
          .fefutin-print-sheet .fefutin-sheet-table input[type="checkbox"]{display:none!important}
          .fefutin-print-sheet .fefutin-sheet-table th,.fefutin-print-sheet .fefutin-sheet-table td{padding:1px 2px!important}
          .fefutin-print-sheet .fefutin-sheet-table thead th{font-size:7px!important;line-height:1.1!important}
          .fefutin-print-sheet .fefutin-sheet-table tbody tr{height:6.5mm!important;min-height:6.5mm!important;break-inside:avoid!important}
          .fefutin-print-sheet .fefutin-sheet-table tbody td{height:6.5mm!important;padding:2mm 2px!important}
          .fefutin-print-sheet .fefutin-sheet-table thead th{padding:2.2mm 2px!important}
          .fefutin-print-sheet .fefutin-sheet-signature .line{height:12mm!important}
          .fefutin-print-sheet .fefutin-sheet-signature{font-size:8px!important}
          .fefutin-print-sheet .fefutin-sheet-table .fefutin-player-name,
          .fefutin-print-sheet .fefutin-sheet-table .fefutin-player-name strong{font-size:7px!important;line-height:1.05!important}
          .fefutin-print-sheet .fefutin-sheet-table .fefutin-player-name small{font-size:6px!important;margin-top:1px!important}
          .fefutin-print-sheet .fefutin-sheet-table .fefutin-status{font-size:6px!important;line-height:1!important}
          .fefutin-print-sheet .fefutin-cards label{display:inline-flex!important;flex-direction:row!important;vertical-align:middle!important;gap:1px!important;margin:0 1px!important;font-size:6px!important;line-height:1!important;white-space:nowrap!important}.fefutin-print-sheet .fefutin-cards input{display:inline-block!important;flex:0 0 18px!important;width:18px!important;min-width:18px!important;height:14px!important;min-height:14px!important;margin:0!important}
          .fefutin-print-sheet .fefutin-observations{margin-top:4px!important;gap:2px!important;font-size:8px!important}
          .fefutin-print-sheet .fefutin-observations textarea{height:20px!important;min-height:20px!important;padding:0!important}
          .fefutin-print-sheet .fefutin-sheet-table,.fefutin-print-sheet .fefutin-sheet-table-wrap,.fefutin-print-sheet .fefutin-observations{break-inside:avoid!important;page-break-inside:avoid!important}
        }
        /* Ajuste compacto de tarjetas: A y R comparten la columna sin desbordarse */
        .fefutin-sheet-table td.fefutin-cards{padding-left:1px!important;padding-right:1px!important;white-space:nowrap!important;overflow:hidden!important}
        .fefutin-sheet-table td.fefutin-cards label{display:inline-flex!important;flex:0 1 auto!important;flex-direction:row!important;align-items:center!important;justify-content:center!important;gap:1px!important;margin:0!important;padding:0!important;font-size:7px!important;white-space:nowrap!important}
        .fefutin-sheet-table td.fefutin-cards input{display:inline-block!important;flex:0 1 14px!important;width:14px!important;min-width:0!important;max-width:14px!important;height:17px!important;min-height:17px!important;margin:0!important;padding:0!important;font-size:8px!important}
        @media print{
          .fefutin-sheet-table td.fefutin-cards{padding-left:1px!important;padding-right:1px!important}
          .fefutin-sheet-table td.fefutin-cards label{display:inline-flex!important;gap:1px!important;margin:0!important;font-size:6px!important}
          .fefutin-sheet-table td.fefutin-cards input{display:inline-block!important;flex:0 1 13px!important;width:13px!important;min-width:0!important;max-width:13px!important;height:12px!important;min-height:12px!important;margin:0!important;padding:0!important;font-size:7px!important}
        }
      `}</style>
      <div className="fefutin-print-sheet">
        <div className="fefutin-print-both">
          {[
            { side: "local", name: localName, players: localPlayers, logoPath: localClubLogoPath, className: "team-local" },
            { side: "visitante", name: visitorName, players: visitorPlayers, logoPath: visitorClubLogoPath, className: "team-visitor" },
          ].map((team) => {
            const rows = [...team.players, ...Array.from({ length: 5 }, () => null)];
            const clubLogoUrl = getClubLogoUrl(team.logoPath);
            return (
              <section className="fefutin-print-team-page" key={team.side}>
                <div className="fefutin-print-brand">
                  <img className="league-logo" src={fefutinLogoUrl} alt="Logo oficial de FEFUTIN" />
                  {clubLogoUrl
                    ? <img className="club-logo" src={clubLogoUrl} alt={"Escudo de " + team.name} />
                    : <div className="club-logo-placeholder">ESCUDO<br />DEL CLUB</div>}
                </div>
                <div className="fefutin-sheet-title">
                  <div className="brand">FEFUTIN · PLANILLA OFICIAL</div>
                  <h2>{localName} vs. {visitorName}</h2>
                  <p>{category || "Categoría sin especificar"} · {metadata.turno ? "Turno " + metadata.turno + " · " : ""}{metadata.jornada ? "Jornada " + metadata.jornada : "Jornada sin asignar"}</p>
                  <p>{metadata.fecha_partido ? "Fecha: " + metadata.fecha_partido + " · " : ""}{metadata.sede ? "Sede: " + metadata.sede : ""}</p>
                </div>
                <table className="fefutin-sheet-table">
                  <colgroup>
                    <col style={{width:"7%"}} /><col style={{width:"42%"}} /><col style={{width:"15%"}} /><col style={{width:"12%"}} /><col style={{width:"24%"}} />
                  </colgroup>
                  <thead>
                    <tr><th className={team.className} colSpan={5}>PLANILLA DEL EQUIPO {team.side==="local"?"LOCAL":"VISITANTE"} · {team.name}</th></tr>
                    <tr><th>N°</th><th>JUGADOR</th><th>EST.</th><th>G</th><th>T A/R</th></tr>
                  </thead>
                  <tbody>{rows.map((player,index)=><tr key={player?.player_id || `print-${team.side}-${index}`}>{renderPlayerCell(player,team.side)}</tr>)}</tbody>
                </table>
                <div className="fefutin-sheet-signatures">
                  <div className="fefutin-sheet-signature"><div className="line"></div><span>Firma del referente {team.side==="local"?"local":"visitante"}</span></div>
                  <div className="fefutin-sheet-signature"><div className="line"></div><span>Firma del árbitro</span></div>
                </div>
              </section>
            );
          })}
        </div>
        <div className="fefutin-sheet-title">
          <div className="brand">FEFUTIN · PLANILLA OFICIAL</div>
          <h2>{localName} vs. {visitorName}</h2>
          <p>{category || "Categoría sin especificar"} · {metadata.turno ? "Turno " + metadata.turno + " · " : ""}{metadata.jornada ? "Jornada " + metadata.jornada : "Jornada sin asignar"}</p>
        </div>
        {loading ? <p>Cargando listas oficiales de ambos clubes...</p> : error ? (
          <div style={{padding:12,border:"1px solid #b5122a",color:"#b91c1c"}}>{error}</div>
        ) : <>
          <div className="fefutin-sheet-meta">
            {[
              ["jornada","Jornada"],["sede","Sede / cancha"],["fecha_partido","Fecha del partido"],["arbitro_designado","Árbitro designado"],
            ].map(([field,label]) => <label key={field}>{label}
              <input type={field==="fecha_partido"?"date":"text"} value={metadata[field]} disabled={field==="fecha_partido" || Boolean(match?.referee_closed)} readOnly={field==="fecha_partido"} onChange={(event)=>setMetadata((current)=>({...current,[field]:event.target.value}))}/>
            </label>)}
          </div>
          <div className="fefutin-sheet-signatures">
            <div className="fefutin-sheet-signature">
              <div className="line"></div>
              <span>Firma del referente local</span>
            </div>
            <div className="fefutin-sheet-signature">
              <div className="line"></div>
              <span>Firma del referente visitante</span>
            </div>
          </div>
          <div className="fefutin-no-print" style={{display:"flex",gap:8,margin:"12px 0",flexWrap:"wrap"}}>
            <button type="button" onClick={()=>setActiveSide("local")} aria-pressed={activeSide==="local"} style={{flex:1,minWidth:130,padding:10,border:"1px solid #b5122a",borderRadius:6,background:activeSide==="local"?"#b5122a":"#fff",color:activeSide==="local"?"#fff":"#171c27",fontWeight:800}}>PLANILLA LOCAL</button>
            <button type="button" onClick={()=>setActiveSide("visitante")} aria-pressed={activeSide==="visitante"} style={{flex:1,minWidth:130,padding:10,border:"1px solid #343a40",borderRadius:6,background:activeSide==="visitante"?"#343a40":"#fff",color:activeSide==="visitante"?"#fff":"#171c27",fontWeight:800}}>PLANILLA VISITANTE</button>
          </div>
          <div className="fefutin-sheet-table-wrap">
            <table className="fefutin-sheet-table">
              <colgroup>
                <col style={{width:"7%"}} /><col style={{width:"42%"}} /><col style={{width:"15%"}} /><col style={{width:"12%"}} /><col style={{width:"24%"}} />
              </colgroup>
              <thead>
                <tr><th className={activeSide==="local"?"team-local":"team-visitor"} colSpan={5}>PLANILLA DEL EQUIPO {activeSide==="local"?"LOCAL":"VISITANTE"} · {activeClubName}</th></tr>
                <tr><th>N°</th><th>JUGADOR</th><th>EST.</th><th>G</th><th>T A/R</th></tr>
              </thead>
              <tbody>{displayedPlayers.map((player,index)=><tr key={player?.player_id || `empty-${activeSide}-${index}`}>{renderPlayerCell(player,activeSide)}</tr>)}</tbody>
            </table>
          </div>
          {isReferee && <div className="fefutin-sheet-result" aria-live="polite">
            <span>RESULTADO FINAL</span>
            <span>{localName}</span>
            <span className="score">{finalScoreLocal} – {finalScoreVisitor}</span>
            <span>{visitorName}</span>
          </div>}
          <label className="fefutin-observations">OBSERVACIONES
            <textarea value={metadata.observaciones} disabled={Boolean(match?.referee_closed)} onChange={(event)=>setMetadata((current)=>({...current,observaciones:event.target.value}))}/>
          </label>
          {notice&&<p className="fefutin-no-print" style={{color:"#166534",fontWeight:700}}>{notice}</p>}
          {error&&<p className="fefutin-no-print" style={{color:"#b91c1c"}}>{error}</p>}
          <div className="fefutin-sheet-actions fefutin-no-print">
            <button type="button" onClick={onClose} style={{background:"#b5122a",color:"#fff",borderColor:"#b5122a"}}>CERRAR</button>
            {!match?.referee_closed && <button type="button" onClick={save} disabled={saving || closingMatch} style={{background:"#b5122a",color:"#fff",borderColor:"#b5122a"}}>{saving?"Guardando...":"GUARDAR PLANILLA"}</button>}
            {isReferee && !match?.referee_closed && <button type="button" onClick={closeMatch} disabled={saving || closingMatch} style={{background:"#166534",color:"#fff",borderColor:"#166534"}}>{closingMatch?"CERRANDO...":"CERRAR PARTIDO"}</button>}
            {match?.referee_closed && <strong style={{color:"#166534",alignSelf:"center"}}>✓ PARTIDO CERRADO · SOLO LECTURA</strong>}
            <button type="button" onClick={()=>window.print()} style={{background:"#b5122a",color:"#fff",borderColor:"#b5122a"}}>IMPRIMIR / GUARDAR PDF</button>
          </div>
          {match?.referee_closed && isReferee && (
            <section className="fefutin-no-print" style={{ marginTop: 16, padding: 14, border: "1px solid #b5122a", borderRadius: 8, background: "#fff7f8" }}>
              <strong style={{ display: "block", color: "#b5122a", marginBottom: 8 }}>FOTO DE PLANILLA FIRMADA · {category || "CATEGORÍA"}</strong>
              <p style={{ margin: "0 0 10px", fontSize: 12 }}>Después de cerrar el partido, subí la foto de esta planilla firmada por los referentes. Quedará archivada junto a este partido y su categoría.</p>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setCategoryPhotoFile(event.target.files?.[0] || null)} style={{ maxWidth: "100%", marginBottom: 8 }} />
              <button type="button" onClick={uploadCategoryPhoto} disabled={!categoryPhotoFile || uploadingCategoryPhoto || !currentUserId} style={{ display: "block", padding: "9px 14px", border: 0, borderRadius: 6, background: "#b5122a", color: "#fff", fontWeight: 800, cursor: "pointer", opacity: uploadingCategoryPhoto ? .6 : 1 }}>{uploadingCategoryPhoto ? "GUARDANDO FOTO..." : "GUARDAR FOTO DE ESTA CATEGORÍA"}</button>
              {categoryPhotoNotice && <p role="status" style={{ color: "#166534", fontWeight: 700, marginBottom: 0 }}>{categoryPhotoNotice}</p>}
            </section>
          )}
        </>}
      </div>
    </div>
  ), document.body);
}