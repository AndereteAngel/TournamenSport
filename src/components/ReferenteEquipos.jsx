import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { PlayerCarnets } from "./PlayerCarnets";

const emptyPlayer = () => ({
  id: `nuevo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  first_name: "",
  last_name: "",
  dni: "",
  birth_date: "",
  jersey_number: "Sin especificar",
  photo_path: "",
});

const inputStyle = {
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  padding: "0.65rem 0.7rem",
  borderRadius: "7px",
  border: "1px solid #555",
  background: "#fff",
  color: "#111",
  fontSize: "0.9rem",
};

const buttonStyle = {
  border: "1px solid #b5122a",
  borderRadius: "8px",
  padding: "0.65rem 0.9rem",
  background: "#171c27",
  color: "#fff",
  fontWeight: 800,
  cursor: "pointer",
};

export function ReferenteEquipos({ currentUser, mode = "equipos", onBack, onOpenTeams, onOpenTournament, readOnly = false }) {
  const [participations, setParticipations] = useState([]);
  const [rowsByParticipation, setRowsByParticipation] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploadingPlayerId, setUploadingPlayerId] = useState(null);
  const [editingPlayer, setEditingPlayer] = useState(null);
  const [selectedClubId, setSelectedClubId] = useState(null);
  const [clubProfile, setClubProfile] = useState(null);
  const [selectedSection, setSelectedSection] = useState(null);
  const [tournamentSearch, setTournamentSearch] = useState("");
  const [tournamentCategory, setTournamentCategory] = useState("todas");
  const [tournamentStatus, setTournamentStatus] = useState("todos");
  const [activeTournamentIndex, setActiveTournamentIndex] = useState(0);
  const [rosterSearch, setRosterSearch] = useState("");
  const [rosterCategory, setRosterCategory] = useState("todas");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [rosterView, setRosterView] = useState("menu");
  const [registrationPlayer, setRegistrationPlayer] = useState({ first_name: "", last_name: "", dni: "", birth_date: "", category_roster_id: "", photo_path: "", dni_front_path: "", dni_back_path: "" });
  const [registrationUploads, setRegistrationUploads] = useState({ photo: false, front: false, back: false });

  const loadParticipations = useCallback(async () => {
    setLoading(true);
    setError("");
    const rpcName = mode === "torneos" ? "get_fefutin_my_turn_teams" : "get_fefutin_my_permanent_rosters";
    const { data, error: loadError } = await supabase.rpc(rpcName);
    if (loadError) {
      console.error("Error al cargar fichas FEFUTIN:", loadError);
      setError(loadError.message || "No se pudieron cargar las categorías de tu club.");
      setParticipations([]);
      setLoading(false);
      return;
    }

    const items = (data || []).map((item) => ({
      ...item,
      // La función SQL devuelve team_id para los planteles permanentes.
      // El componente usa club_tournament_id como identificador interno.
      club_tournament_id: item.club_tournament_id || item.team_id || item.roster_id || null,
      players: (Array.isArray(item.players) ? item.players : []).map((player) => ({
        ...player,
        jersey_number: player.jersey_number || "Sin especificar",
      })),
    }));
    setParticipations(items);
    if (currentUser?.role === "referente" && currentUser?.clubId) {
      const { data: profileClub, error: clubError } = await supabase
        .from("fefutin_clubs")
        .select("id, name, affiliate_number, headquarters_address, logo_path")
        .eq("id", currentUser.clubId)
        .maybeSingle();
      if (clubError) {
        console.warn("No se pudo cargar la ficha del club referente:", clubError);
      } else if (profileClub) {
        setClubProfile({
          club_id: profileClub.id,
          club_name: profileClub.name,
          affiliate_number: profileClub.affiliate_number,
          headquarters_address: profileClub.headquarters_address,
          logo_path: profileClub.logo_path,
        });
        setSelectedClubId(profileClub.id);
      }
    } else if (currentUser?.role === "referente" && items.length > 0) {
      setSelectedClubId(items[0].club_id);
    }
    const nextRows = {};
    items.forEach((item) => {
      nextRows[item.club_tournament_id] = item.players.map((player) => ({
        ...player,
        birth_date: player.birth_date || "",
      }));
    });
    setRowsByParticipation(nextRows);
    setLoading(false);
  }, [mode, currentUser?.role, currentUser?.clubId]);

  useEffect(() => {
    loadParticipations();
  }, [loadParticipations]);

  const updatePlayer = (participationId, playerId, field, value) => {
    setRowsByParticipation((previous) => ({
      ...previous,
      [participationId]: (previous[participationId] || []).map((player) =>
        player.id === playerId && player.approval_status !== "aprobado" && player.approval_status !== "rechazado"
          ? { ...player, [field]: value }
          : player
      ),
    }));
  };

  const addPlayer = (participationId) => {
    const player = emptyPlayer();
    setRowsByParticipation((previous) => ({
      ...previous,
      [participationId]: [...(previous[participationId] || []), player],
    }));
    setEditingPlayer({ participationId, playerId: player.id });
  };

  const uploadPlayerPhoto = async (participationId, playerId, file) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("La foto debe estar en formato JPG, PNG o WEBP.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("La foto no puede superar los 5 MB.");
      return;
    }
    setUploadingPlayerId(playerId);
    setError("");
    const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${currentUser.id}/${playerId}-${Date.now()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from("fefutin-player-photos").upload(path, file, { upsert: true, contentType: file.type });
    if (uploadError) setError(uploadError.message || "No se pudo subir la fotografía.");
    else updatePlayer(participationId, playerId, "photo_path", path);
    setUploadingPlayerId(null);
  };

  const uploadRegistrationDocument = async (kind, file) => {
    if (!file) return;
    const isPhoto = kind === "photo";
    const allowed = isPhoto
      ? ["image/jpeg", "image/png", "image/webp"]
      : ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowed.includes(file.type)) {
      setError(isPhoto ? "La foto debe estar en formato JPG, PNG o WEBP." : "El DNI debe ser una imagen JPG, PNG, WEBP o PDF.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("El archivo no puede superar los 5 MB.");
      return;
    }
    setRegistrationUploads((previous) => ({ ...previous, [kind]: true }));
    setError("");
    const extension = file.name.split(".").pop()?.toLowerCase() || (isPhoto ? "jpg" : "jpg");
    const bucket = isPhoto ? "fefutin-player-photos" : "fefutin-player-dni";
    const path = `${currentUser.id}/inscripcion-${Date.now()}-${kind}.${extension}`;
    const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file, { upsert: true, contentType: file.type });
    if (uploadError) {
      setError(uploadError.message || "No se pudo subir el archivo.");
    } else {
      setRegistrationPlayer((previous) => ({ ...previous, [kind === "photo" ? "photo_path" : kind === "front" ? "dni_front_path" : "dni_back_path"]: path }));
      setNotice(kind === "photo" ? "Fotografía cargada." : kind === "front" ? "Frente del DNI cargado de forma privada." : "Dorso del DNI cargado de forma privada.");
    }
    setRegistrationUploads((previous) => ({ ...previous, [kind]: false }));
  };

  const submitIndividualPlayer = async () => {
    const form = registrationPlayer;
    const category = visibleParticipations.find((item) => item.club_tournament_id === form.category_roster_id);
    if (!category) return setError("Elegí una categoría del club.");
    if (!form.first_name.trim() || !form.last_name.trim() || !form.dni.trim() || !form.birth_date) {
      return setError("Completá nombre, apellido, DNI y fecha de nacimiento.");
    }
    if (!form.photo_path || !form.dni_front_path || !form.dni_back_path) {
      return setError("Cargá la foto del jugador y el frente y dorso del DNI.");
    }
    const existingPlayers = rowsByParticipation[category.club_tournament_id] || [];
    const newPlayer = {
      id: `nuevo-${Date.now()}`,
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      dni: form.dni.trim(),
      birth_date: form.birth_date,
      photo_path: form.photo_path,
      jersey_number: "",
    };
    const payload = [...existingPlayers, newPlayer].map((player) => ({
      id: player.id,
      first_name: player.first_name || "",
      last_name: player.last_name || "",
      dni: player.dni || "",
      birth_date: player.birth_date || "",
      photo_path: player.photo_path || "",
    }));
    setSavingId(category.club_tournament_id);
    setError("");
    setNotice("");
    const { error: saveError } = await supabase.rpc("save_fefutin_permanent_roster_with_dni", {
      p_roster_id: category.club_tournament_id,
      p_players: payload,
      p_player_dni: form.dni,
      p_dni_front_path: form.dni_front_path,
      p_dni_back_path: form.dni_back_path,
    });
    setSavingId(null);
    if (saveError) {
      console.error("Error al inscribir jugador:", saveError);
      setError(saveError.message || "No se pudo guardar la inscripción.");
      return;
    }
    setRegistrationPlayer({ first_name: "", last_name: "", dni: "", birth_date: "", category_roster_id: category.club_tournament_id, photo_path: "", dni_front_path: "", dni_back_path: "" });
    setNotice("Jugador inscripto correctamente. Su ficha quedó pendiente de revisión de Admin o Directivo.");
    await loadParticipations();
  };

  const removePlayer = (participationId, playerId) => {
    setRowsByParticipation((previous) => ({
      ...previous,
      [participationId]: (previous[participationId] || []).filter((player) =>
        player.id !== playerId || player.approval_status === "aprobado" || player.approval_status === "rechazado"
      ),
    }));
  };

  const saveRoster = async (item, submit) => {
    const players = rowsByParticipation[item.club_tournament_id] || [];
    if (submit && !window.confirm(`¿Presentar la lista de buena fe de ${getParticipationLabel(item)}? Revisá que todos los datos estén completos.`)) return;

    setSavingId(item.club_tournament_id);
    setError("");
    setNotice("");
    const payload = players.map((player) => ({
      id: player.id,
      first_name: player.first_name || "",
      last_name: player.last_name || "",
      dni: player.dni || "",
      birth_date: player.birth_date || "",
      jersey_number: player.jersey_number || "",
      photo_path: player.photo_path || "",
    }));
    const { error: saveError } = mode === "torneos"
      ? await supabase.rpc("save_fefutin_team_roster", {
          p_club_tournament_id: item.club_tournament_id,
          p_players: payload,
          p_submit: submit,
        })
      : await supabase.rpc("save_fefutin_permanent_roster", {
          p_roster_id: item.club_tournament_id,
          p_players: payload.map(({ jersey_number, ...player }) => player),
        });

    if (saveError) {
      console.error("Error al guardar lista de buena fe:", saveError);
      setError(saveError.message || "No se pudo guardar la lista.");
      setSavingId(null);
      return;
    }

    setNotice(mode === "torneos"
      ? (submit ? `Lista de ${getParticipationLabel(item)} presentada correctamente.` : `Borrador de ${getParticipationLabel(item)} guardado.`)
      : `Plantel permanente de ${item.category_label} guardado correctamente.`);
    await loadParticipations();
    setSavingId(null);
  };

  const createPermanentCategory = async () => {
    const category = newCategoryName.trim();
    if (!category) {
      setError("Escribí el nombre de la categoría.");
      return;
    }
    setError("");
    const { data: createdRosterId, error: createError } = await supabase.rpc("create_fefutin_permanent_roster", {
      p_category_label: category,
    });
    if (createError) {
      setError(createError.message || "No se pudo crear la categoría.");
      return;
    }
    setNewCategoryName("");
    setNotice(`Categoría ${category} creada. Ya podés inscribir jugadores.`);
    await loadParticipations();
    if (createdRosterId) {
      setRegistrationPlayer((previous) => ({ ...previous, category_roster_id: createdRosterId }));
    }
  };

  const isManager = currentUser?.role === "admin" || currentUser?.role === "directivo";
  const isRegistrationScreen = mode === "equipos" && selectedSection === "listas" && currentUser?.role === "referente" && rosterView === "inscripcion";
  const isRosterMenuScreen = mode === "equipos" && selectedSection === "listas" && currentUser?.role === "referente" && rosterView === "menu";
  const clubs = [...new Map(participations.map((item) => [item.club_id, item])).values()];
  const activeClubId = currentUser?.role === "referente"
    ? (selectedClubId || currentUser?.clubId || clubs[0]?.club_id || null)
    : selectedClubId;
  const selectedClub = clubs.find((item) => item.club_id === activeClubId) || (clubProfile?.club_id === activeClubId ? clubProfile : null);
  const club = selectedClub || participations[0] || clubProfile;
  const visibleParticipations = mode === "equipos" && activeClubId
    ? participations.filter((item) => item.club_id === activeClubId)
    : participations;
  const getParticipationLabel = (item) => item.turno ? `${item.category_label} · ${item.turno}` : item.category_label;
  const categoryOptions = [...new Set(visibleParticipations.map((item) => getParticipationLabel(item)).filter((category) => category && category !== "SIN CATEGORÍAS"))].sort((a, b) => a.localeCompare(b, "es"));
  const filteredParticipations = visibleParticipations.filter((item) => {
    if (mode === "torneos" || selectedSection === "torneos") {
      const query = tournamentSearch.trim().toLocaleLowerCase("es");
      const matchesSearch = !query || [item.tournament_title, item.category_label, item.turno, item.club_name].some((value) => String(value || "").toLocaleLowerCase("es").includes(query));
      const matchesCategory = tournamentCategory === "todas" || getParticipationLabel(item) === tournamentCategory;
      const matchesStatus = tournamentStatus === "todos" || (tournamentStatus === "pendiente" ? !["presentada", "borrador"].includes(item.team_status) : item.team_status === tournamentStatus);
      return matchesSearch && matchesCategory && matchesStatus;
    }
    if (selectedSection === "listas") return item.category_label !== "SIN CATEGORÍAS" && (rosterCategory === "todas" || item.category_label === rosterCategory);
    return true;
  });
  const filteredPlayersFor = (item) => {
    const query = rosterSearch.trim().toLocaleLowerCase("es");
    return (rowsByParticipation[item.club_tournament_id] || []).filter((player) =>
      !query || [player.first_name, player.last_name, player.dni].some((value) => String(value || "").toLocaleLowerCase("es").includes(query))
    );
  };
  const filterInputStyle = { ...inputStyle, background: "#fff", color: "#111", marginTop: 0 };
  const filterLabelStyle = { display: "grid", gap: ".35rem", color: "#eee", fontSize: ".76rem", fontWeight: 800 };

  return (
    <div className="tc-form-screen" style={{ width: "100%", maxWidth: "100%", padding: 0, minHeight: "70vh", boxSizing: "border-box" }}>
      <section className="cr-card" style={{ width: "100%", maxWidth: "100%", margin: "auto", padding: "clamp(1rem, 3vw, 2rem)", boxSizing: "border-box", background: "#080808", color: "#fff", border: "1px solid #b5122a" }}>
        {!isRegistrationScreen && !isRosterMenuScreen && <>
        <button
          type="button"
          className="tc-form-back"
          onClick={() => {
            if (mode === "equipos" && selectedSection) {
              setSelectedSection(null);
              setEditingPlayer(null);
              setRosterView("menu");
            } else if (mode === "equipos" && activeClubId && currentUser?.role !== "referente") {
              setSelectedClubId(null);
              setEditingPlayer(null);
            } else {
              onBack?.();
            }
          }}
        >
          {mode === "equipos" && selectedSection ? currentUser?.role === "referente" ? "← Volver a MI CLUB" : "← Volver a la ficha del club" : mode === "equipos" && activeClubId && currentUser?.role !== "referente" ? "← Volver a clubes" : "← Volver al inicio"}
        </button>
        {selectedSection !== "torneos" && <>
        <p style={{ color: "#b5122a", fontWeight: 900, letterSpacing: ".12em", fontSize: ".72rem", margin: "1.25rem 0 .35rem" }}>
          {isManager ? "GESTIÓN DE CLUBES" : "ÁREA DEL REFERENTE"}
        </p>
        <h2 className="cr-title" style={{ color: "#fff", margin: "0 0 .5rem" }}>
          {mode === "torneos" ? "MIS TORNEOS" : selectedClub ? selectedSection === "torneos" ? "TORNEOS PARTICIPANTES" : selectedSection === "listas" ? "LISTAS DE BUENA FE" : selectedSection === "datos" ? "DATOS DEL CLUB" : selectedSection === "carnets" ? "CARNETS DE JUGADORES" : selectedClub.club_name : currentUser?.role === "referente" ? "MI CLUB" : "FICHA DE EQUIPOS"}
        </h2>
        <p style={{ color: "#d1d5db", lineHeight: 1.55, marginTop: 0 }}>
          {mode === "torneos"
            ? "Estas son las categorías en las que tu club fue habilitado para participar."
            : selectedClub && selectedSection === "torneos"
              ? "Torneos y categorías en las que participa este club."
              : selectedClub && selectedSection === "listas"
                ? "Listas de buena fe y fichas personales, organizadas por categoría."
                : selectedClub && selectedSection === "datos"
                  ? "Información institucional registrada del club."
                  : selectedClub && selectedSection === "carnets"
                    ? "Credenciales digitales de los jugadores aprobados de este club."
                  : selectedClub
                    ? "Elegí una sección para consultar la información del club."
                    : isManager
                      ? "Seleccioná un club para consultar su información."
                      : currentUser?.role === "referente" ? "Consultá la información institucional de tu club." : "Seleccioná tu club para consultar su información."}
        </p>

        {error && <p role="alert" style={{ color: "#fecaca", background: "#450a0a", border: "1px solid #b5122a", borderRadius: "8px", padding: ".75rem" }}>{error}</p>}
        {notice && <p role="status" style={{ color: "#bbf7d0", background: "#052e16", border: "1px solid #166534", borderRadius: "8px", padding: ".75rem" }}>{notice}</p>}

        {loading ? (
          <p style={{ color: "#ddd", textAlign: "center", padding: "2rem" }}>Cargando clubes y categorías...</p>
        ) : participations.length === 0 && !(mode === "equipos" && selectedSection === "listas" && currentUser?.role === "referente" && ["menu", "inscripcion", "registrados"].includes(rosterView)) ? (
          <div style={{ border: "1px dashed #555", borderRadius: "10px", padding: "1.5rem", textAlign: "center", color: "#ddd", marginTop: "1rem" }}>
            <strong>No hay categorías registradas todavía.</strong>
            <p style={{ color: "#aaa", marginBottom: 0 }}>Podés crear las categorías permanentes desde LISTAS DE BUENA FE. No necesitás estar inscripto en un torneo.</p>
          </div>
        ) : (
          <>
            {mode === "equipos" && !activeClubId && !isRosterMenuScreen ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))", gap: ".85rem", marginTop: "1.25rem" }}>
                {clubs.map((item) => {
                  const logoUrl = item.logo_path ? supabase.storage.from("fefutin-clubs").getPublicUrl(item.logo_path).data.publicUrl : "";
                  return (
                    <button
                      key={item.club_id}
                      type="button"
                      onClick={() => setSelectedClubId(item.club_id)}
                      title={item.club_name}
                      style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: ".55rem", minWidth: 0, minHeight: "132px", padding: ".8rem .45rem", border: "1px solid #b5122a", borderRadius: "10px", background: "#111", color: "#fff", cursor: "pointer" }}
                    >
                      <span style={{ width: "76px", height: "76px", display: "grid", placeItems: "center", overflow: "hidden", borderRadius: "9px", background: "#fff" }}>
                        {logoUrl ? <img src={logoUrl} alt="" style={{ width: "84%", height: "84%", objectFit: "contain", display: "block" }} /> : <span style={{ color: "#171c27", fontSize: ".62rem", fontWeight: 900 }}>SIN ESCUDO</span>}
                      </span>
                      <strong style={{ color: "#fff", fontSize: ".8rem", lineHeight: 1.25, textAlign: "center", overflowWrap: "anywhere" }}>{item.club_name}</strong>
                    </button>
                  );
                })}
              </div>
            ) : mode === "equipos" && activeClubId && !selectedSection && !isManager ? (
              <div style={{ display: "grid", gap: "1rem", marginTop: "1.25rem" }}>
                <article style={{ overflow: "hidden", border: "2px solid #b5122a", borderRadius: "18px", background: "linear-gradient(135deg,#292929 0%,#111 58%,#080808 100%)", color: "#fff", boxShadow: "0 12px 30px rgba(0,0,0,.35)", maxWidth: "100%", width: "100%", margin: 0 }}>
                  <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".8rem", padding: ".9rem 1rem", background: "#b5122a" }}>
                    <div>
                      <p style={{ margin: 0, color: "#fff", fontWeight: 900, letterSpacing: ".12em" }}>FEFUTIN</p>
                      <p style={{ margin: ".2rem 0 0", color: "#fff", fontSize: ".65rem", fontWeight: 800, letterSpacing: ".06em" }}>CREDENCIAL INSTITUCIONAL</p>
                    </div>
                    <span style={{ fontSize: "1.8rem" }}>🏅</span>
                  </header>
                  <div style={{ display: "grid", gridTemplateColumns: "clamp(105px,28%,160px) minmax(0,1fr)", gap: "clamp(.8rem,3vw,1.2rem)", alignItems: "center", padding: "clamp(.9rem,3vw,1.3rem)" }}>
                    <div style={{ aspectRatio: "1", display: "grid", placeItems: "center", overflow: "hidden", border: "2px solid #b5122a", borderRadius: "12px", background: "#fff" }}>
                      {club?.logo_path ? <img src={supabase.storage.from("fefutin-clubs").getPublicUrl(club.logo_path).data.publicUrl} alt={"Escudo de " + club.club_name} style={{ width: "82%", height: "82%", objectFit: "contain", display: "block" }} /> : <span style={{ color: "#171c27", fontWeight: 900, fontSize: ".7rem" }}>SIN ESCUDO</span>}
                    </div>
                    <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                      <h3 style={{ margin: "0 0 .8rem", color: "#fff", fontSize: "clamp(1.05rem,4vw,1.4rem)", lineHeight: 1.2 }}>{club?.club_name}</h3>
                      <p style={{ margin: 0, color: "#aaa", fontSize: ".62rem", fontWeight: 800, letterSpacing: ".08em" }}>NÚMERO DE AFILIACIÓN FEFUTIN</p>
                      <p style={{ margin: ".2rem 0 0", color: "#fff", fontSize: "1.15rem", fontWeight: 900, letterSpacing: ".06em" }}>{club?.affiliate_number || "PENDIENTE DE ASIGNACIÓN"}</p>
                    </div>
                  </div>
                  <footer style={{ padding: ".65rem 1rem", borderTop: "1px solid #b5122a", background: "#090909", color: "#ddd", fontSize: ".65rem", fontWeight: 800, letterSpacing: ".08em" }}>CLUB REGISTRADO EN FEFUTIN · CARNET DIGITAL</footer>
                </article>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: ".85rem" }}>
                  {[
                    { id: "listas", title: "LISTA DE BUENA FE", description: "Jugadores, fichas y estado de habilitación", symbol: "📋" },
                    { id: "datos", title: "DATOS DEL CLUB", description: "Información institucional y datos de contacto", symbol: "🏟️" },
                  ].map((section) => (
                    <button key={section.id} type="button" onClick={() => setSelectedSection(section.id)} style={{ minHeight: "140px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: ".65rem", padding: "1.1rem", border: "1px solid #b5122a", borderRadius: "12px", background: "#111", color: "#fff", cursor: "pointer", textAlign: "center" }}>
                      <span style={{ fontSize: "2rem" }}>{section.symbol}</span>
                      <strong style={{ fontSize: ".95rem", letterSpacing: ".04em" }}>{section.title}</strong>
                      <span style={{ color: "#ccc", fontSize: ".78rem", lineHeight: 1.4 }}>{section.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : mode === "equipos" && activeClubId && !selectedSection ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "1rem", marginTop: "1.25rem" }}>
                {[
                  { id: "torneos", title: "TORNEOS", description: "Torneos y categorías participantes", symbol: "🏆" },
                  { id: "datos", title: "DATOS DEL CLUB", description: "Información institucional y escudo", symbol: "🏟️" },
                  { id: "carnets", title: "CARNETS", description: "Credenciales digitales de los jugadores", symbol: "🪪" },
                ].map((section) => (
                  <button key={section.id} type="button" onClick={() => setSelectedSection(section.id)} style={{ minHeight: "155px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: ".65rem", padding: "1.1rem", border: "1px solid #b5122a", borderRadius: "12px", background: "#111", color: "#fff", cursor: "pointer", textAlign: "center" }}>
                    <span style={{ fontSize: "2rem" }}>{section.symbol}</span>
                    <strong style={{ fontSize: ".95rem", letterSpacing: ".04em" }}>{section.title}</strong>
                    <span style={{ color: "#ccc", fontSize: ".78rem", lineHeight: 1.4 }}>{section.description}</span>
                  </button>
                ))}
              </div>
            ) : mode === "equipos" && selectedSection === "carnets" ? (
              <div style={{ marginTop: "1.25rem" }}>
                <PlayerCarnets currentUser={currentUser} canManage={isManager} clubId={activeClubId} embedded />
              </div>
            ) : mode === "equipos" && selectedSection === "datos" ? (
              <div style={{ display: "grid", width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box", alignSelf: "stretch", gap: "1.1rem", marginTop: "1.25rem" }}>
                <section style={{ width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box", border: "1px solid #b5122a", borderRadius: "12px", background: "#111", padding: "1rem" }}>
                  <p style={{ color: "#b5122a", fontSize: ".7rem", fontWeight: 900, letterSpacing: ".1em", margin: "0 0 .8rem" }}>DATOS INSTITUCIONALES Y DE CONTACTO</p>
                  <h3 style={{ color: "#fff", margin: "0 0 1rem", overflowWrap: "anywhere" }}>{club?.club_name}</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: ".9rem" }}>
                    {[
                      ["Domicilio de la sede", club?.headquarters_address],
                      ["Tipo de cancha", club?.court_type],
                      ["Referente del club", club?.referente_name],
                      ["Teléfono del referente", club?.referente_phone],
                      ["Correo del referente", club?.referente_email],
                    ].map(([label, value]) => (
                      <div key={label} style={{ padding: ".75rem", borderRadius: "8px", background: "#1b1b1b", minWidth: 0 }}>
                        <p style={{ margin: "0 0 .25rem", color: "#aaa", fontSize: ".68rem", fontWeight: 800, letterSpacing: ".04em" }}>{label}</p>
                        <p style={{ margin: 0, color: "#fff", overflowWrap: "anywhere", lineHeight: 1.45 }}>{value || "No registrado"}</p>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            ) : (
              <>
                {(mode === "equipos" && selectedSection !== "listas" && selectedSection !== "torneos" || isManager && mode === "torneos") && club && (
                  <div style={{ display: "flex", alignItems: "center", gap: ".8rem", padding: ".8rem", margin: "1rem 0", background: "#171c27", borderRadius: "10px" }}>
                    {club.logo_path && <img src={supabase.storage.from("fefutin-clubs").getPublicUrl(club.logo_path).data.publicUrl} alt={club.club_name} style={{ width: "58px", height: "58px", objectFit: "contain", background: "#fff", borderRadius: "8px" }} />}
                    <div><strong>{club.club_name}</strong><div style={{ color: "#ccc", fontSize: ".85rem" }}>{club.headquarters_address}</div></div>
                  </div>
                )}

                {mode === "equipos" && selectedSection === "listas" && currentUser?.role === "referente" && rosterView === "inscripcion" && (
                  <section style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: ".6rem", alignItems: "end", padding: ".9rem", marginTop: "1rem", border: "1px solid #b5122a", borderRadius: "10px", background: "#171717" }}>
                    <label style={{ display: "grid", gap: ".35rem", color: "#fff", fontSize: ".78rem", fontWeight: 800 }}>
                      AGREGAR CATEGORÍA PERMANENTE
                      <input value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") createPermanentCategory(); }} placeholder="Ej.: Infantil 2018, Femenino..." style={filterInputStyle} maxLength={80} />
                    </label>
                    <button type="button" style={buttonStyle} onClick={createPermanentCategory}>＋ Crear</button>
                  </section>
                )}

                {mode === "equipos" && selectedSection === "listas" && currentUser?.role === "referente" && rosterView === "menu" && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: ".75rem", marginTop: "1rem" }}>
                    <button type="button" onClick={() => { setRosterView("registrados"); setEditingPlayer(null); }} style={{ ...buttonStyle, minHeight: "76px", background: rosterView === "registrados" ? "#b5122a" : "#171c27" }}>👥 JUGADORES REGISTRADOS</button>
                    <button type="button" onClick={() => { setRosterView("inscripcion"); setEditingPlayer(null); }} style={{ ...buttonStyle, minHeight: "76px", background: rosterView === "inscripcion" ? "#b5122a" : "#171c27" }}>📝 INSCRIPCIÓN</button>
                  </div>
                )}

                {selectedSection !== "torneos" && (mode === "torneos" || selectedSection === "listas" && (currentUser?.role !== "referente" || rosterView !== "menu")) && !(selectedSection === "listas" && currentUser?.role === "referente") && (
                  <div style={{ display: "grid", width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box", alignSelf: "stretch", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,190px),1fr))", gap: ".7rem", padding: ".85rem", marginTop: "1rem", border: "1px solid #444", borderRadius: "10px", background: "#171717" }}>
                    {(mode === "torneos" || selectedSection === "torneos") ? (
                      <>
                        <label style={filterLabelStyle}>Buscar torneo
                          <input value={tournamentSearch} onChange={(event) => setTournamentSearch(event.target.value)} placeholder="Nombre del torneo..." style={filterInputStyle} />
                        </label>
                        <label style={filterLabelStyle}>Categoría
                          <select value={tournamentCategory} onChange={(event) => setTournamentCategory(event.target.value)} style={filterInputStyle}>
                            <option value="todas">Todas las categorías</option>
                            {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
                          </select>
                        </label>
                        <label style={filterLabelStyle}>Estado
                          <select value={tournamentStatus} onChange={(event) => setTournamentStatus(event.target.value)} style={filterInputStyle}>
                            <option value="todos">Todos los estados</option>
                            <option value="presentada">Lista presentada</option>
                            <option value="borrador">Borrador</option>
                            <option value="pendiente">Pendiente de carga</option>
                          </select>
                        </label>
                        <button type="button" style={buttonStyle} onClick={() => { setTournamentSearch(""); setTournamentCategory("todas"); setTournamentStatus("todos"); }}>Limpiar filtros</button>
                      </>
                    ) : (
                      <>
                        <label style={filterLabelStyle}>Buscar jugador
                          <input value={rosterSearch} onChange={(event) => setRosterSearch(event.target.value)} placeholder="Nombre, apellido o DNI..." style={filterInputStyle} />
                        </label>
                        <label style={filterLabelStyle}>Categoría
                          <select value={rosterCategory} onChange={(event) => setRosterCategory(event.target.value)} style={filterInputStyle}>
                            <option value="todas">Todas las categorías</option>
                            {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
                          </select>
                        </label>
                        <button type="button" style={buttonStyle} onClick={() => { setRosterSearch(""); setRosterCategory("todas"); }}>Limpiar filtros</button>
                      </>
                    )}
                  </div>
                )}

                <div
                  onScroll={mode === "torneos" ? (event) => {
                    const container = event.currentTarget;
                    const center = container.getBoundingClientRect().left + container.clientWidth / 2;
                    let nearest = 0;
                    let distance = Infinity;
                    Array.from(container.children).forEach((card, index) => {
                      const rect = card.getBoundingClientRect();
                      const currentDistance = Math.abs(center - (rect.left + rect.width / 2));
                      if (currentDistance < distance) { distance = currentDistance; nearest = index; }
                    });
                    setActiveTournamentIndex(nearest);
                  } : undefined}
                  style={mode === "torneos" ? {
                    display: "flex", flexDirection: "row", alignItems: "center",
                    width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box",
                    alignSelf: "stretch", gap: 0, marginTop: "1rem",
                    overflowX: "auto", overflowY: "hidden",
                    padding: "2rem max(1rem, calc((100% - 300px) / 2)) 1.5rem",
                    scrollSnapType: "x mandatory",
                    scrollPaddingInline: "max(1rem, calc((100% - 300px) / 2))",
                    WebkitOverflowScrolling: "touch", scrollbarWidth: "thin", perspective: "900px"
                  } : { display: "grid", width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box", alignSelf: "stretch", gap: "1rem", marginTop: "1rem" }}
                >
              {mode === "equipos" && selectedSection === "listas" && currentUser?.role === "referente" && rosterView === "registrados" ? (
                <div style={{ width: "100%", marginTop: "1rem" }}>
                  <PlayerCarnets currentUser={currentUser} clubId={activeClubId} embedded />
                </div>
              ) : mode === "equipos" && selectedSection === "listas" && currentUser?.role === "referente" && rosterView === "inscripcion" ? (
                <div style={{ display: "grid", gap: "1rem", width: "100%", marginTop: "1rem" }}>
                  <label style={{ display: "grid", gap: ".35rem", color: "#fff", fontSize: ".8rem", fontWeight: 800 }}>
                    CATEGORÍA A INSCRIBIR
                    <select value={rosterCategory} onChange={(event) => setRosterCategory(event.target.value)} style={filterInputStyle}>
                      <option value="todas">Todas las categorías</option>
                      {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
                    </select>
                  </label>
                  {filteredParticipations.map((item) => {
                    const players = rowsByParticipation[item.club_tournament_id] || [];
                    return (
                      <section key={item.club_tournament_id} style={{ width: "100%", minWidth: 0 }}>
                        <h3 style={{ color: "#fff", fontSize: "1rem", margin: "0 0 .65rem" }}>{getParticipationLabel(item)}</h3>
                        <div style={{ overflowX: "auto", border: "1px solid #444", borderRadius: "8px" }}>
                          <table style={{ width: "100%", minWidth: "720px", borderCollapse: "collapse", color: "#fff", textAlign: "left", background: "#090909" }}>
                            <thead><tr style={{ background: "#b5122a" }}>
                              {["N.º", "APELLIDO", "NOMBRE", "DNI", "FECHA NAC.", "FOTO", ""].map((heading, i) => <th key={i} style={{ padding: ".6rem .5rem", fontSize: ".68rem", whiteSpace: "nowrap" }}>{heading}</th>)}
                            </tr></thead>
                            <tbody>
                              {players.map((player, index) => {
                                const locked = readOnly || player.approval_status === "aprobado" || player.approval_status === "rechazado";
                                const photoUrl = player.photo_path ? supabase.storage.from("fefutin-player-photos").getPublicUrl(player.photo_path).data.publicUrl : "";
                                return <tr key={player.id} style={{ borderTop: "1px solid #333" }}>
                                  <td style={{ padding: ".4rem .5rem", color: "#fca5a5", fontWeight: 900 }}>{index + 1}</td>
                                  {["last_name", "first_name", "dni", "birth_date"].map((field) => <td key={field} style={{ padding: ".35rem" }}>
                                    <input type={field === "birth_date" ? "date" : "text"} inputMode={field === "dni" ? "numeric" : undefined} value={player[field] || ""} disabled={locked} onChange={(event) => updatePlayer(item.club_tournament_id, player.id, field, event.target.value)} placeholder={field === "last_name" ? "Apellido" : field === "first_name" ? "Nombre" : field === "dni" ? "DNI" : ""} style={{ ...inputStyle, minWidth: field === "birth_date" ? "145px" : field === "dni" ? "110px" : "125px", padding: ".55rem .45rem", fontSize: ".8rem" }} />
                                  </td>)}
                                  <td style={{ padding: ".4rem .5rem", minWidth: "100px" }}>
                                    {photoUrl ? <img src={photoUrl} alt="" style={{ width: "38px", height: "38px", objectFit: "cover", borderRadius: "5px", display: "block", marginBottom: ".25rem" }} /> : <span style={{ display: "block", color: "#999", fontSize: ".6rem", marginBottom: ".25rem" }}>SIN FOTO</span>}
                                    {!locked && <label style={{ color: "#fca5a5", fontSize: ".68rem", fontWeight: 800, cursor: "pointer" }}>{uploadingPlayerId === player.id ? "Subiendo..." : "Cargar foto"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploadingPlayerId === player.id} onChange={(event) => uploadPlayerPhoto(item.club_tournament_id, player.id, event.target.files?.[0])} style={{ display: "none" }} /></label>}
                                  </td>
                                  <td style={{ padding: ".35rem" }}>{!locked && <button type="button" onClick={() => removePlayer(item.club_tournament_id, player.id)} style={{ ...buttonStyle, padding: ".4rem .55rem" }} aria-label="Quitar jugador">✕</button>}</td>
                                </tr>;
                              })}
                              {!players.length && <tr><td colSpan={7} style={{ padding: "1rem", color: "#aaa", textAlign: "center" }}>Todavía no hay jugadores cargados en esta categoría.</td></tr>}
                            </tbody>
                          </table>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".6rem", flexWrap: "wrap", marginTop: ".65rem" }}>
                          <button type="button" style={buttonStyle} onClick={() => addPlayer(item.club_tournament_id)}>＋ Agregar jugador</button>
                          <button type="button" className="cr-btn-gold" disabled={savingId === item.club_tournament_id} onClick={() => saveRoster(item, false)}>{savingId === item.club_tournament_id ? "Guardando..." : "GUARDAR PLANILLA"}</button>
                        </div>
                      </section>
                    );
                  })}
                  {!filteredParticipations.length && <p style={{ color: "#aaa", textAlign: "center" }}>Primero creá una categoría para cargar su planilla.</p>}
                </div>
              ) : (filteredParticipations.map((item, tournamentIndex) => {
                const allPlayers = rowsByParticipation[item.club_tournament_id] || [];
                const players = selectedSection === "listas" ? filteredPlayersFor(item) : allPlayers;
                const logoUrl = item.logo_path ? supabase.storage.from("fefutin-clubs").getPublicUrl(item.logo_path).data.publicUrl : "";
                const statusLabel = item.team_status === "presentada" ? "LISTA PRESENTADA" : item.team_status === "borrador" ? "BORRADOR" : "PENDIENTE DE CARGA";
                const isEditingThis = editingPlayer?.participationId === item.club_tournament_id;
                const currentEditingPlayer = isEditingThis ? players.find((player) => player.id === editingPlayer.playerId) : null;
                return (
                  <article
                    key={item.club_tournament_id}
                    role={mode === "torneos" ? "button" : undefined}
                    tabIndex={mode === "torneos" ? 0 : undefined}
                    aria-label={mode === "torneos" ? `Abrir torneo ${item.tournament_title}` : undefined}
                    onClick={mode === "torneos" ? () => onOpenTournament?.(item) : undefined}
                    onKeyDown={mode === "torneos" ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onOpenTournament?.(item);
                      }
                    } : undefined}
                    style={mode === "torneos" ? {
                      position: "relative", flex: "0 0 min(76%, 330px)", width: "min(76%, 330px)",
                      maxWidth: "330px", minWidth: "245px", boxSizing: "border-box", alignSelf: "center",
                      scrollSnapAlign: "center", zIndex: activeTournamentIndex === tournamentIndex ? 3 : 1,
                      marginLeft: tournamentIndex === 0 ? 0 : "-58px",
                      transform: `translateY(${activeTournamentIndex === tournamentIndex ? "-3px" : "7px"}) scale(${activeTournamentIndex === tournamentIndex ? 1.08 : 0.78}) rotateY(${activeTournamentIndex > tournamentIndex ? "7deg" : activeTournamentIndex < tournamentIndex ? "-7deg" : "0deg"})`,
                      opacity: Math.abs(activeTournamentIndex - tournamentIndex) > 2 ? 0.58 : activeTournamentIndex === tournamentIndex ? 1 : 0.82,
                      transition: "transform 260ms cubic-bezier(.2,.8,.2,1), opacity 260ms ease",
                      border: "1px solid #b5122a", borderRadius: "11px", background: "#111", padding: "1rem", cursor: "pointer"
                    } : { width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box", alignSelf: "stretch", border: "1px solid #b5122a", borderRadius: "11px", background: "#111", padding: "1rem", cursor: "default" }}
                  >
{selectedSection !== "listas" && (
                    <div style={{ display: "flex", alignItems: "center", gap: ".75rem", flexWrap: "wrap" }}>
                      {logoUrl && <img src={logoUrl} alt={`Escudo de ${item.club_name}`} style={{ width: "54px", height: "54px", objectFit: "contain", borderRadius: "8px", background: "#fff" }} />}
                      <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                        <strong style={{ display: "block", color: "#fff", fontSize: "1rem" }}>{item.club_name}</strong>
                        <span style={{ display: "block", color: "#ccc", fontSize: ".82rem" }}>{item.headquarters_address}</span>
                      </div>
                      <span style={{ color: item.team_status === "presentada" ? "#86efac" : "#fca5a5", border: "1px solid currentColor", borderRadius: "20px", padding: ".3rem .55rem", fontSize: ".68rem", fontWeight: 900 }}>{statusLabel}</span>
                    </div>
                    )}

                    <div style={{ margin: ".9rem 0", padding: ".75rem", borderRadius: "8px", background: "#171c27" }}>
                      <strong style={{ color: "#fff", display: "block" }}>{mode === "torneos" ? item.tournament_title : selectedSection === "listas" && currentUser?.role === "referente" ? item.category_label : "PLANTEL PERMANENTE"}</strong>
                      {!(selectedSection === "listas" && currentUser?.role === "referente") && <>
                        <span style={{ color: "#fca5a5", fontWeight: 800, fontSize: ".9rem" }}>{getParticipationLabel(item)}</span>
                        <div style={{ color: "#aaa", fontSize: ".78rem", marginTop: ".25rem" }}>Equipo: {item.club_name} · {getParticipationLabel(item)}</div>
                      </>}
                    </div>

                    {mode === "torneos" || selectedSection === "torneos" ? (
                      mode === "torneos" ? (
                        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: ".2rem" }}>
                          <span style={{ color: "#fff", fontSize: ".78rem", fontWeight: 900, letterSpacing: ".04em" }}>ABRIR TORNEO →</span>
                        </div>
                      ) : (
                        <div style={{ color: "#aaa", fontSize: ".8rem", marginTop: ".65rem" }}>
                          {item.team_status === "presentada" ? "Lista de buena fe presentada" : item.team_status === "borrador" ? "Lista en preparación" : "Lista pendiente de carga"}
                        </div>
                      )
                    ) : (
                      <>
                        {isEditingThis && currentEditingPlayer ? (
                          <div style={{ marginTop: "1rem", padding: "1rem", border: "1px solid #b5122a", borderRadius: "12px", background: "#080808" }}>
                            <button type="button" onClick={() => setEditingPlayer(null)} style={{ ...buttonStyle, marginBottom: "1rem" }}>← Volver a la lista</button>
                            <p style={{ color: "#b5122a", fontSize: ".72rem", fontWeight: 900, letterSpacing: ".1em", margin: "0 0 .35rem" }}>FICHA INDIVIDUAL</p>
                            <h3 style={{ color: "#fff", margin: "0 0 1rem" }}>{currentEditingPlayer.first_name || currentEditingPlayer.last_name ? `${currentEditingPlayer.last_name} ${currentEditingPlayer.first_name}` : "Nuevo jugador"}</h3>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 230px), 1fr))", gap: ".85rem" }}>
                              <label style={{ color: "#eee", display: "grid", gap: ".35rem", fontSize: ".82rem" }}>Apellido
                                <input value={currentEditingPlayer.last_name || ""} disabled={readOnly || item.team_status === "presentada" || currentEditingPlayer.approval_status === "aprobado" || currentEditingPlayer.approval_status === "rechazado"} onChange={(event) => updatePlayer(item.club_tournament_id, currentEditingPlayer.id, "last_name", event.target.value)} placeholder="Apellido" style={inputStyle} />
                              </label>
                              <label style={{ color: "#eee", display: "grid", gap: ".35rem", fontSize: ".82rem" }}>Nombre
                                <input value={currentEditingPlayer.first_name || ""} disabled={readOnly || item.team_status === "presentada" || currentEditingPlayer.approval_status === "aprobado" || currentEditingPlayer.approval_status === "rechazado"} onChange={(event) => updatePlayer(item.club_tournament_id, currentEditingPlayer.id, "first_name", event.target.value)} placeholder="Nombre" style={inputStyle} />
                              </label>
                              <label style={{ color: "#eee", display: "grid", gap: ".35rem", fontSize: ".82rem" }}>DNI
                                <input inputMode="numeric" value={currentEditingPlayer.dni || ""} disabled={readOnly || item.team_status === "presentada" || currentEditingPlayer.approval_status === "aprobado" || currentEditingPlayer.approval_status === "rechazado"} onChange={(event) => updatePlayer(item.club_tournament_id, currentEditingPlayer.id, "dni", event.target.value)} placeholder="Número de documento" style={inputStyle} />
                              </label>
                              <label style={{ color: "#eee", display: "grid", gap: ".35rem", fontSize: ".82rem" }}>Fecha de nacimiento
                                <input type="date" value={currentEditingPlayer.birth_date || ""} disabled={readOnly || item.team_status === "presentada" || currentEditingPlayer.approval_status === "aprobado" || currentEditingPlayer.approval_status === "rechazado"} onChange={(event) => updatePlayer(item.club_tournament_id, currentEditingPlayer.id, "birth_date", event.target.value)} style={{ ...inputStyle, WebkitAppearance: "none", appearance: "none", display: "block", fontSize: "0.9rem", lineHeight: "normal", padding: "0.65rem 0.7rem", height: "54px", minHeight: "54px", maxWidth: "100%", borderRadius: "7px" }} />
                              </label>
                              {mode === "torneos" && (
                                <label style={{ color: "#eee", display: "grid", gap: ".35rem", fontSize: ".82rem" }}>Número de camiseta
                                  <select value={currentEditingPlayer.jersey_number || "Sin especificar"} disabled={readOnly || item.team_status === "presentada" || currentEditingPlayer.approval_status === "aprobado" || currentEditingPlayer.approval_status === "rechazado"} onChange={(event) => updatePlayer(item.club_tournament_id, currentEditingPlayer.id, "jersey_number", event.target.value)} style={inputStyle}>
                                    <option value="Sin especificar">Sin especificar</option>
                                    {Array.from({ length: 99 }, (_, number) => number + 1).map((number) => <option key={number} value={String(number)}>{number}</option>)}
                                  </select>
                                </label>
                              )}
                            </div>
                            <div style={{ marginTop: "1rem", display: "grid", gap: ".55rem" }}>
                              <span style={{ color: "#eee", fontSize: ".82rem", fontWeight: 700 }}>Fotografía individual</span>
                              {currentEditingPlayer.photo_path ? (
                                <img src={supabase.storage.from("fefutin-player-photos").getPublicUrl(currentEditingPlayer.photo_path).data.publicUrl} alt="Foto del jugador" style={{ width: "112px", height: "132px", objectFit: "cover", borderRadius: "8px", border: "1px solid #b5122a" }} />
                              ) : <span style={{ color: "#facc15", fontSize: ".82rem" }}>Todavía no se cargó una fotografía.</span>}
                              {!readOnly && item.team_status !== "presentada" && currentEditingPlayer.approval_status !== "aprobado" && currentEditingPlayer.approval_status !== "rechazado" && (
                                <label style={{ ...buttonStyle, display: "inline-block", width: "fit-content", cursor: "pointer" }}>
                                  {uploadingPlayerId === currentEditingPlayer.id ? "Subiendo fotografía..." : currentEditingPlayer.photo_path ? "Cambiar fotografía" : "＋ Cargar fotografía"}
                                  <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploadingPlayerId === currentEditingPlayer.id} onChange={(event) => uploadPlayerPhoto(item.club_tournament_id, currentEditingPlayer.id, event.target.files?.[0])} style={{ display: "none" }} />
                                </label>
                              )}
                              <span style={{ color: "#aaa", fontSize: ".72rem" }}>Formatos JPG, PNG o WEBP. Máximo 5 MB.</span>
                            </div>
                            <button type="button" onClick={() => setEditingPlayer(null)} style={{ ...buttonStyle, marginTop: "1.2rem", width: "100%" }}>{readOnly || item.team_status === "presentada" ? "Volver a la lista" : "Guardar datos y volver a la lista"}</button>
                          </div>
                        ) : (
                          <>
                            <h3 style={{ color: "#fff", fontSize: ".95rem", margin: "1rem 0 .65rem" }}>LISTA DE BUENA FE · {getParticipationLabel(item)}</h3>
                            <div style={{ display: "grid", gap: ".65rem" }}>
                              {players.map((player, index) => {
                                const photoUrl = player.photo_path ? supabase.storage.from("fefutin-player-photos").getPublicUrl(player.photo_path).data.publicUrl : "";
                                return (
                                  <div key={player.id} style={{ display: "grid", gridTemplateColumns: "76px minmax(0, 1fr) auto", alignItems: "center", columnGap: ".85rem", rowGap: ".5rem", padding: ".8rem", border: "1px solid #333", borderRadius: "10px", background: "#080808", minWidth: 0 }}>
                                    <button type="button" onClick={() => rosterView !== "registrados" && setEditingPlayer({ participationId: item.club_tournament_id, playerId: player.id })} disabled={rosterView === "registrados"} aria-label={`Ver ficha de ${player.first_name} ${player.last_name}`} title="Ver ficha personal" style={{ gridColumn: "1", gridRow: "1", width: "76px", height: "76px", padding: 0, border: "1px solid #b5122a", borderRadius: "9px", overflow: "hidden", background: "#222", cursor: rosterView === "registrados" ? "default" : "pointer", display: "grid", placeItems: "center" }}>
                                      {photoUrl ? <img src={photoUrl} alt={`Foto de ${player.first_name} ${player.last_name}`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : <span style={{ color: "#aaa", fontSize: ".62rem" }}>SIN FOTO</span>}
                                    </button>
                                    <div style={{ minWidth: 0, gridColumn: "2", gridRow: "1", alignSelf: "center" }}>
                                      <strong style={{ display: "block", color: "#fff", fontSize: "1rem", lineHeight: 1.3, overflowWrap: "break-word", wordBreak: "normal" }}>{player.last_name || "Apellido pendiente"}, {player.first_name || "Nombre pendiente"}</strong>
                                      <span style={{ display: "block", color: "#fca5a5", fontSize: ".78rem", marginTop: ".3rem" }}>{getParticipationLabel(item)}</span>
                                      {player.carnet_number && (
                                        <div style={{ marginTop: ".35rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: ".4rem" }}>
                                          <span style={{ color: "#ddd", fontSize: ".7rem", fontWeight: 700 }}>{player.carnet_number}</span>
                                          <span style={{
                                            color: player.carnet_status === "habilitado" ? "#86efac" : player.carnet_status === "no_habilitado" ? "#fca5a5" : player.carnet_status === "en_proceso" ? "#93c5fd" : "#facc15",
                                            border: "1px solid currentColor",
                                            borderRadius: "20px",
                                            padding: ".16rem .45rem",
                                            fontSize: ".62rem",
                                            fontWeight: 900,
                                            letterSpacing: ".02em"
                                          }}>
                                            {player.carnet_status === "habilitado" ? "HABILITADO" : player.carnet_status === "no_habilitado" ? "NO HABILITADO" : player.carnet_status === "en_proceso" ? "EN PROCESO" : "PENDIENTE"}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                    {!readOnly && rosterView !== "registrados" && item.team_status !== "presentada" && player.approval_status !== "aprobado" && player.approval_status !== "rechazado" && (
                                      <button type="button" onClick={() => removePlayer(item.club_tournament_id, player.id)} title="Quitar jugador" aria-label="Quitar jugador" style={{ gridColumn: "3", gridRow: "1", padding: ".55rem .7rem", border: "1px solid #b5122a", borderRadius: "8px", background: "#171c27", color: "#fecaca", cursor: "pointer" }}>✕</button>
                                    )}
                                  </div>
                                );
                              })}
                              {!players.length && <p style={{ padding: "1rem", textAlign: "center", color: "#aaa" }}>{rosterSearch.trim() ? "No hay jugadores que coincidan con la búsqueda." : "Todavía no agregaste jugadores a esta categoría."}</p>}
                            </div>
                            {!readOnly && rosterView !== "registrados" && item.team_status !== "presentada" && (
                              <div style={{ display: "flex", gap: ".6rem", flexWrap: "wrap", justifyContent: "space-between", marginTop: ".85rem" }}>
                                <button type="button" style={buttonStyle} onClick={() => addPlayer(item.club_tournament_id)}>＋ Agregar jugador</button>
                                <div style={{ display: "flex", gap: ".55rem", flexWrap: "wrap" }}>
                                  {mode === "torneos" ? (
                                    <>
                                      <button type="button" style={buttonStyle} disabled={savingId === item.club_tournament_id} onClick={() => saveRoster(item, false)}>{savingId === item.club_tournament_id ? "Guardando..." : "Guardar borrador"}</button>
                                      <button type="button" className="cr-btn-gold" disabled={savingId === item.club_tournament_id} onClick={() => saveRoster(item, true)}>{savingId === item.club_tournament_id ? "Enviando..." : "Presentar lista"}</button>
                                    </>
                                  ) : (
                                    <button type="button" className="cr-btn-gold" disabled={savingId === item.club_tournament_id} onClick={() => saveRoster(item, false)}>{savingId === item.club_tournament_id ? "Guardando..." : "GUARDAR PLANTEL PERMANENTE"}</button>
                                  )}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                        {mode === "torneos" && item.team_status === "presentada" && <p style={{ color: "#facc15", fontSize: ".78rem" }}>Lista presentada: las modificaciones están bloqueadas mientras se revisan las altas.</p>}
                        {item.submitted_at && <p style={{ color: "#86efac", fontSize: ".78rem", marginBottom: 0 }}>Presentada: {new Date(item.submitted_at).toLocaleString("es-AR")}</p>}
                      </>
                    )}
                  </article>
                );
              }))}
                </div>
                {filteredParticipations.length === 0 && (mode === "torneos" || selectedSection === "listas") && (
                  <p style={{ color: "#aaa", textAlign: "center", padding: "1.2rem" }}>No hay resultados para los filtros seleccionados.</p>
                )}
              </>
            )}
          </>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.25rem" }}>
          <button type="button" className="tc-form-back" onClick={loadParticipations} disabled={loading}>↻ Actualizar</button>
        </div>
        </>}
        {isRegistrationScreen && (
          <>
            <button
              type="button"
              className="tc-form-back"
              onClick={() => {
                setRosterView("menu");
                setEditingPlayer(null);
              }}
            >
              ← Volver
            </button>
            <h2 className="cr-title" style={{ color: "#fff", margin: "1.25rem 0 0" }}>
              INSCRIPCIÓN DE JUGADOR
            </h2>
            <p style={{ color: "#ccc", lineHeight: 1.5 }}>Completá una ficha por jugador. Al guardar, quedará pendiente de revisión para la emisión de su carnet FEFUTIN.</p>
            {error && <p role="alert" style={{ color: "#fecaca", background: "#450a0a", border: "1px solid #b5122a", padding: ".7rem", borderRadius: "8px" }}>{error}</p>}
            {notice && <p role="status" style={{ color: "#bbf7d0", background: "#052e16", border: "1px solid #166534", padding: ".7rem", borderRadius: "8px" }}>{notice}</p>}
            <div style={{ display: "grid", gap: ".9rem", marginTop: "1rem" }}>
              <label style={{ display: "grid", gap: ".35rem", color: "#fff", fontSize: ".8rem", fontWeight: 800 }}>
                CLUB ACTUAL
                <input value={club?.club_name || participations[0]?.club_name || ""} readOnly style={{ ...inputStyle, background: "#e5e7eb" }} />
              </label>
              <section style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: ".6rem", alignItems: "end", padding: ".85rem", border: "1px solid #b5122a", borderRadius: "10px", background: "#171717" }}>
                <label style={{ display: "grid", gap: ".35rem", color: "#fff", fontSize: ".78rem", fontWeight: 800 }}>
                  ¿NO EXISTE LA CATEGORÍA? CREALA ACÁ
                  <input value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); createPermanentCategory(); } }} placeholder="Ej.: Cat. 2018" style={filterInputStyle} maxLength={80} />
                </label>
                <button type="button" style={buttonStyle} onClick={createPermanentCategory} disabled={!newCategoryName.trim()}>＋ Crear</button>
              </section>
              <label style={{ display: "grid", gap: ".35rem", color: "#fff", fontSize: ".8rem", fontWeight: 800 }}>
                CATEGORÍA
                <select value={registrationPlayer.category_roster_id || ""} onChange={(event) => setRegistrationPlayer((previous) => ({ ...previous, category_roster_id: event.target.value }))} style={inputStyle}>
                  <option value="">Seleccioná la categoría</option>
                  {visibleParticipations.filter((item) => item.category_label && item.category_label !== "SIN CATEGORÍAS").map((item) => <option key={item.club_tournament_id} value={item.club_tournament_id}>{getParticipationLabel(item)}</option>)}
                </select>
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,220px),1fr))", gap: ".75rem" }}>
                <label style={{ display: "grid", gap: ".35rem", color: "#fff", fontSize: ".8rem", fontWeight: 800 }}>APELLIDO
                  <input value={registrationPlayer.last_name} onChange={(event) => setRegistrationPlayer((previous) => ({ ...previous, last_name: event.target.value }))} placeholder="Apellido" style={inputStyle} />
                </label>
                <label style={{ display: "grid", gap: ".35rem", color: "#fff", fontSize: ".8rem", fontWeight: 800 }}>NOMBRE
                  <input value={registrationPlayer.first_name} onChange={(event) => setRegistrationPlayer((previous) => ({ ...previous, first_name: event.target.value }))} placeholder="Nombre" style={inputStyle} />
                </label>
                <label style={{ display: "grid", gap: ".35rem", color: "#fff", fontSize: ".8rem", fontWeight: 800 }}>DNI
                  <input inputMode="numeric" value={registrationPlayer.dni} onChange={(event) => setRegistrationPlayer((previous) => ({ ...previous, dni: event.target.value.replace(/[^0-9]/g, "") }))} placeholder="Número de documento" style={inputStyle} />
                </label>
                <label style={{ display: "grid", gap: ".35rem", color: "#fff", fontSize: ".8rem", fontWeight: 800 }}>FECHA DE NACIMIENTO
                  <input type="date" value={registrationPlayer.birth_date} onChange={(event) => setRegistrationPlayer((previous) => ({ ...previous, birth_date: event.target.value }))} style={inputStyle} />
                </label>
              </div>
              <section style={{ display: "grid", gap: ".65rem", padding: ".9rem", border: "1px solid #444", borderRadius: "10px" }}>
                <strong style={{ color: "#fff" }}>DOCUMENTO NACIONAL DE IDENTIDAD</strong>
                <p style={{ color: "#aaa", fontSize: ".75rem", margin: 0 }}>Los archivos se guardan en un espacio privado y solo pueden consultarlos el referente correspondiente y las autoridades FEFUTIN.</p>
                {[
                  ["front", "FRENTE DEL DNI", registrationPlayer.dni_front_path],
                  ["back", "DORSO DEL DNI", registrationPlayer.dni_back_path],
                ].map(([kind, label, path]) => <label key={kind} style={{ display: "grid", gap: ".35rem", color: "#fff", fontSize: ".78rem", fontWeight: 800 }}>
                  {label}
                  <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={registrationUploads[kind]} onChange={(event) => uploadRegistrationDocument(kind, event.target.files?.[0])} style={{ color: "#fff" }} />
                  <span style={{ color: path ? "#86efac" : "#fca5a5", fontSize: ".72rem" }}>{registrationUploads[kind] ? "Subiendo..." : path ? "Documento cargado de forma privada" : "Pendiente de carga · máximo 5 MB"}</span>
                </label>)}
              </section>
              <section style={{ display: "grid", gap: ".65rem", padding: ".9rem", border: "1px solid #444", borderRadius: "10px" }}>
                <strong style={{ color: "#fff" }}>FOTOGRAFÍA DEL JUGADOR</strong>
                {registrationPlayer.photo_path ? <img src={supabase.storage.from("fefutin-player-photos").getPublicUrl(registrationPlayer.photo_path).data.publicUrl} alt="Foto del jugador" style={{ width: "112px", height: "132px", objectFit: "cover", borderRadius: "8px", border: "1px solid #b5122a" }} /> : <span style={{ color: "#fca5a5", fontSize: ".75rem" }}>Todavía no se cargó una fotografía.</span>}
                <label style={{ ...buttonStyle, display: "inline-block", width: "fit-content", cursor: "pointer" }}>
                  {registrationUploads.photo ? "Subiendo fotografía..." : registrationPlayer.photo_path ? "Cambiar fotografía" : "＋ Cargar fotografía"}
                  <input type="file" accept="image/jpeg,image/png,image/webp" disabled={registrationUploads.photo} onChange={(event) => uploadRegistrationDocument("photo", event.target.files?.[0])} style={{ display: "none" }} />
                </label>
                <span style={{ color: "#aaa", fontSize: ".72rem" }}>JPG, PNG o WEBP · máximo 5 MB.</span>
              </section>
              <label style={{ display: "grid", gap: ".35rem", color: "#fff", fontSize: ".8rem", fontWeight: 800 }}>
                NÚMERO DE CARNET FEFUTIN
                <input value="Se asignará automáticamente cuando Admin o Directivo apruebe el alta" readOnly style={{ ...inputStyle, background: "#e5e7eb", fontSize: ".78rem" }} />
              </label>
              <button type="button" className="cr-btn-gold" disabled={savingId !== null || Object.values(registrationUploads).some(Boolean) || visibleParticipations.length === 0} onClick={submitIndividualPlayer} style={{ width: "100%", minHeight: "48px" }}>
                {savingId ? "GUARDANDO INSCRIPCIÓN..." : "GUARDAR INSCRIPCIÓN DEL JUGADOR"}
              </button>
            </div>
          </>
        )}
        {isRosterMenuScreen && (
          <div style={{ display: "grid", gap: "1rem", width: "100%", margin: 0 }}>
            {error && <p role="alert" style={{ color: "#fecaca", background: "#450a0a", border: "1px solid #b5122a", borderRadius: "8px", padding: ".75rem", margin: 0 }}>{error}</p>}
            {notice && <p role="status" style={{ color: "#bbf7d0", background: "#052e16", border: "1px solid #166534", borderRadius: "8px", padding: ".75rem", margin: 0 }}>{notice}</p>}
            <section style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: ".6rem", alignItems: "end", padding: ".9rem", border: "1px solid #b5122a", borderRadius: "10px", background: "#171717" }}>
              <label style={{ display: "grid", gap: ".35rem", color: "#fff", fontSize: ".78rem", fontWeight: 800 }}>
                CREAR CATEGORÍA DEL PLANTEL PERMANENTE
                <input value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") createPermanentCategory(); }} placeholder="Ej.: Cat. 2018" style={filterInputStyle} maxLength={80} />
              </label>
              <button type="button" style={buttonStyle} onClick={createPermanentCategory}>＋ Crear</button>
            </section>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: ".75rem" }}>
              <button type="button" onClick={() => { setRosterView("registrados"); setEditingPlayer(null); }} style={{ ...buttonStyle, minHeight: "76px" }}>👥 JUGADORES REGISTRADOS</button>
              <button type="button" onClick={() => { setRosterView("inscripcion"); setEditingPlayer(null); }} style={{ ...buttonStyle, minHeight: "76px" }}>📝 INSCRIPCIÓN</button>
            </div>
            <p style={{ color: "#aaa", fontSize: ".78rem", margin: 0 }}>Las categorías y sus jugadores quedan guardados en el plantel permanente del club, independientemente de los torneos.</p>
          </div>
        )}
        </>}
      </section>
    </div>
  );
}

export default ReferenteEquipos;