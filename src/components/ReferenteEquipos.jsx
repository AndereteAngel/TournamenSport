import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

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

export function ReferenteEquipos({ currentUser, mode = "equipos", onBack, onOpenTeams, readOnly = false }) {
  const [participations, setParticipations] = useState([]);
  const [rowsByParticipation, setRowsByParticipation] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploadingPlayerId, setUploadingPlayerId] = useState(null);

  const loadParticipations = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: loadError } = await supabase.rpc("get_fefutin_my_teams");
    if (loadError) {
      console.error("Error al cargar fichas FEFUTIN:", loadError);
      setError(loadError.message || "No se pudieron cargar las categorías de tu club.");
      setParticipations([]);
      setLoading(false);
      return;
    }

    const items = (data || []).map((item) => ({
      ...item,
      players: Array.isArray(item.players) ? item.players : [],
    }));
    setParticipations(items);
    const nextRows = {};
    items.forEach((item) => {
      nextRows[item.club_tournament_id] = item.players.map((player) => ({
        ...player,
        birth_date: player.birth_date || "",
      }));
    });
    setRowsByParticipation(nextRows);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadParticipations();
  }, [loadParticipations]);

  const updatePlayer = (participationId, playerId, field, value) => {
    setRowsByParticipation((previous) => ({
      ...previous,
      [participationId]: (previous[participationId] || []).map((player) =>
        player.id === playerId ? { ...player, [field]: value } : player
      ),
    }));
  };

  const addPlayer = (participationId) => {
    setRowsByParticipation((previous) => ({
      ...previous,
      [participationId]: [...(previous[participationId] || []), emptyPlayer()],
    }));
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

  const removePlayer = (participationId, playerId) => {
    setRowsByParticipation((previous) => ({
      ...previous,
      [participationId]: (previous[participationId] || []).filter((player) => player.id !== playerId),
    }));
  };

  const saveRoster = async (item, submit) => {
    const players = rowsByParticipation[item.club_tournament_id] || [];
    if (submit && !window.confirm(`¿Presentar la lista de buena fe de ${item.category_label}? Revisá que todos los datos estén completos.`)) return;

    setSavingId(item.club_tournament_id);
    setError("");
    setNotice("");
    const payload = players.map((player) => ({
      first_name: player.first_name || "",
      last_name: player.last_name || "",
      dni: player.dni || "",
      birth_date: player.birth_date || "",
      jersey_number: player.jersey_number || "",
      photo_path: player.photo_path || "",
    }));
    const { error: saveError } = await supabase.rpc("save_fefutin_team_roster", {
      p_club_tournament_id: item.club_tournament_id,
      p_players: payload,
      p_submit: submit,
    });

    if (saveError) {
      console.error("Error al guardar lista de buena fe:", saveError);
      setError(saveError.message || "No se pudo guardar la lista.");
      setSavingId(null);
      return;
    }

    setNotice(submit
      ? `Lista de ${item.category_label} presentada correctamente.`
      : `Borrador de ${item.category_label} guardado.`);
    await loadParticipations();
    setSavingId(null);
  };

  const isManager = currentUser?.role === "admin" || currentUser?.role === "directivo";
  const club = participations[0];

  return (
    <div className="tc-form-screen" style={{ padding: "1rem", minHeight: "70vh" }}>
      <section className="cr-card" style={{ width: "100%", maxWidth: "1100px", margin: "auto", padding: "clamp(1rem, 3vw, 2rem)", boxSizing: "border-box", background: "#080808", color: "#fff", border: "1px solid #b5122a" }}>
        <button type="button" className="tc-form-back" onClick={onBack}>← Volver al inicio</button>
        <p style={{ color: "#b5122a", fontWeight: 900, letterSpacing: ".12em", fontSize: ".72rem", margin: "1.25rem 0 .35rem" }}>
          {isManager ? "GESTIÓN DE CLUBES" : "ÁREA DEL REFERENTE"}
        </p>
        <h2 className="cr-title" style={{ color: "#fff", margin: "0 0 .5rem" }}>
          {mode === "torneos" ? "MIS TORNEOS" : "FICHA DE EQUIPOS"}
        </h2>
        <p style={{ color: "#d1d5db", lineHeight: 1.55, marginTop: 0 }}>
          {mode === "torneos"
            ? "Estas son las categorías en las que tu club fue habilitado para participar."
            : "Los datos institucionales ya están cargados. Completá una lista independiente para cada categoría."}
        </p>

        {error && <p role="alert" style={{ color: "#fecaca", background: "#450a0a", border: "1px solid #b5122a", borderRadius: "8px", padding: ".75rem" }}>{error}</p>}
        {notice && <p role="status" style={{ color: "#bbf7d0", background: "#052e16", border: "1px solid #166534", borderRadius: "8px", padding: ".75rem" }}>{notice}</p>}

        {loading ? (
          <p style={{ color: "#ddd", textAlign: "center", padding: "2rem" }}>Cargando clubes y categorías...</p>
        ) : participations.length === 0 ? (
          <div style={{ border: "1px dashed #555", borderRadius: "10px", padding: "1.5rem", textAlign: "center", color: "#ddd", marginTop: "1rem" }}>
            <strong>No hay categorías habilitadas todavía.</strong>
            <p style={{ color: "#aaa", marginBottom: 0 }}>Cuando Admin o Directivo apruebe la inscripción de tu club, las participaciones aparecerán acá.</p>
          </div>
        ) : (
          <>
            {isManager && club && (
              <div style={{ display: "flex", alignItems: "center", gap: ".8rem", padding: ".8rem", margin: "1rem 0", background: "#171c27", borderRadius: "10px" }}>
                {club.logo_path && <img src={supabase.storage.from("fefutin-clubs").getPublicUrl(club.logo_path).data.publicUrl} alt={club.club_name} style={{ width: "58px", height: "58px", objectFit: "contain", background: "#fff", borderRadius: "8px" }} />}
                <div><strong>{club.club_name}</strong><div style={{ color: "#ccc", fontSize: ".85rem" }}>{club.headquarters_address}</div></div>
              </div>
            )}

            <div style={{ display: "grid", gap: "1rem", marginTop: "1rem" }}>
              {participations.map((item) => {
                const players = rowsByParticipation[item.club_tournament_id] || [];
                const logoUrl = item.logo_path ? supabase.storage.from("fefutin-clubs").getPublicUrl(item.logo_path).data.publicUrl : "";
                const statusLabel = item.team_status === "presentada" ? "LISTA PRESENTADA" : item.team_status === "borrador" ? "BORRADOR" : "PENDIENTE DE CARGA";
                return (
                  <article key={item.club_tournament_id} style={{ border: "1px solid #b5122a", borderRadius: "11px", background: "#111", padding: "1rem", minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: ".75rem", flexWrap: "wrap" }}>
                      {logoUrl && <img src={logoUrl} alt={`Escudo de ${item.club_name}`} style={{ width: "54px", height: "54px", objectFit: "contain", borderRadius: "8px", background: "#fff" }} />}
                      <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                        <strong style={{ display: "block", color: "#fff", fontSize: "1rem" }}>{item.club_name}</strong>
                        <span style={{ display: "block", color: "#ccc", fontSize: ".82rem" }}>{item.headquarters_address}</span>
                      </div>
                      <span style={{ color: item.team_status === "presentada" ? "#86efac" : "#fca5a5", border: "1px solid currentColor", borderRadius: "20px", padding: ".3rem .55rem", fontSize: ".68rem", fontWeight: 900 }}>{statusLabel}</span>
                    </div>

                    <div style={{ margin: ".9rem 0", padding: ".75rem", borderRadius: "8px", background: "#171c27" }}>
                      <strong style={{ color: "#fff", display: "block" }}>{item.tournament_title}</strong>
                      <span style={{ color: "#fca5a5", fontWeight: 800, fontSize: ".9rem" }}>{item.category_label}</span>
                      <div style={{ color: "#aaa", fontSize: ".78rem", marginTop: ".25rem" }}>Equipo: {item.club_name} · {item.category_label}</div>
                    </div>

                    {mode === "torneos" ? (
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button type="button" style={buttonStyle} onClick={() => onOpenTeams?.()}>Abrir ficha y lista de buena fe →</button>
                      </div>
                    ) : (
                      <>
                        <h3 style={{ color: "#fff", fontSize: ".95rem", margin: "1rem 0 .65rem" }}>LISTA DE BUENA FE</h3>
                        <div style={{ overflowX: "auto", width: "100%" }}>
                          <table style={{ width: "100%", minWidth: "760px", borderCollapse: "collapse", color: "#fff", fontSize: ".82rem" }}>
                            <thead><tr style={{ background: "#b5122a" }}>
                              {["#", "Apellido", "Nombre", "DNI", "Fecha de nacimiento", "N.º camiseta", "Foto", "Carnet", ""].map((label) => <th key={label} style={{ padding: ".6rem .4rem", textAlign: "left", whiteSpace: "nowrap" }}>{label}</th>)}
                            </tr></thead>
                            <tbody>
                              {players.map((player, index) => (
                                <tr key={player.id} style={{ borderBottom: "1px solid #333" }}>
                                  <td style={{ padding: ".45rem", color: "#aaa" }}>{index + 1}</td>
                                  {[
                                    ["last_name", "Apellido"],
                                    ["first_name", "Nombre"],
                                    ["dni", "DNI"],
                                    ["birth_date", "Fecha", "date"],
                                    ["jersey_number", "Camiseta"],
                                  ].map(([field, placeholder, type]) => (
                                    <td key={field} style={{ padding: ".35rem" }}>
                                      {field === "jersey_number" ? (
                                        <select
                                          aria-label={`${placeholder} del jugador ${index + 1}`}
                                          value={player[field] || "Sin especificar"}
                                          disabled={readOnly || item.team_status === "presentada"}
                                          onChange={(event) => updatePlayer(item.club_tournament_id, player.id, field, event.target.value)}
                                          style={inputStyle}
                                        >
                                          <option value="Sin especificar">Sin especificar</option>
                                          {Array.from({ length: 99 }, (_, number) => number + 1).map((number) => (
                                            <option key={number} value={String(number)}>{number}</option>
                                          ))}
                                        </select>
                                      ) : (
                                        <input
                                          aria-label={`${placeholder} del jugador ${index + 1}`}
                                          type={type || "text"}
                                          value={player[field] || ""}
                                          disabled={readOnly || item.team_status === "presentada"}
                                          onChange={(event) => updatePlayer(item.club_tournament_id, player.id, field, event.target.value)}
                                          placeholder={placeholder}
                                          style={inputStyle}
                                        />
                                      )}
                                    </td>
                                  ))}
                                  <td style={{ padding: ".35rem", minWidth: "125px" }}>
                                    {player.photo_path ? <img src={supabase.storage.from("fefutin-player-photos").getPublicUrl(player.photo_path).data.publicUrl} alt="Foto del jugador" style={{ width: "48px", height: "58px", objectFit: "cover", borderRadius: "6px" }} /> : <span style={{ color: "#facc15" }}>Sin foto</span>}
                                    {!readOnly && item.team_status !== "presentada" && <label style={{ display: "block", color: "#ffb3bf", fontSize: ".7rem", cursor: "pointer", marginTop: ".25rem" }}>
                                      {uploadingPlayerId === player.id ? "Subiendo..." : "Cargar foto"}
                                      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploadingPlayerId === player.id} onChange={(event) => uploadPlayerPhoto(item.club_tournament_id, player.id, event.target.files?.[0])} style={{ display: "none" }} />
                                    </label>}
                                  </td>
                                  <td style={{ padding: ".35rem", color: player.approval_status === "aprobado" ? "#86efac" : "#facc15", fontWeight: 800, whiteSpace: "nowrap" }}>
                                    {player.carnet_number || (player.approval_status === "rechazado" ? "Rechazado" : "Pendiente")}
                                  </td>
                                  <td style={{ padding: ".35rem" }}>
                                    {!readOnly && item.team_status !== "presentada" && <button type="button" onClick={() => removePlayer(item.club_tournament_id, player.id)} title="Quitar jugador" style={{ ...buttonStyle, padding: ".45rem .6rem", color: "#fecaca" }}>✕</button>}
                                  </td>
                                </tr>
                              ))}
                              {!players.length && <tr><td colSpan="9" style={{ padding: "1rem", textAlign: "center", color: "#aaa" }}>Todavía no agregaste jugadores a esta categoría.</td></tr>}
                            </tbody>
                          </table>
                        </div>
                        {!readOnly && item.team_status !== "presentada" && (
                          <div style={{ display: "flex", gap: ".6rem", flexWrap: "wrap", justifyContent: "space-between", marginTop: ".85rem" }}>
                            <button type="button" style={buttonStyle} onClick={() => addPlayer(item.club_tournament_id)}>＋ Agregar jugador</button>
                            <div style={{ display: "flex", gap: ".55rem", flexWrap: "wrap" }}>
                              <button type="button" style={buttonStyle} disabled={savingId === item.club_tournament_id} onClick={() => saveRoster(item, false)}>{savingId === item.club_tournament_id ? "Guardando..." : "Guardar borrador"}</button>
                              <button type="button" className="cr-btn-gold" disabled={savingId === item.club_tournament_id} onClick={() => saveRoster(item, true)}>{savingId === item.club_tournament_id ? "Enviando..." : "Presentar lista"}</button>
                            </div>
                          </div>
                        )}
                        {item.team_status === "presentada" && <p style={{ color: "#facc15", fontSize: ".78rem" }}>Lista presentada: las modificaciones están bloqueadas mientras se revisan las altas.</p>}
                        {item.submitted_at && <p style={{ color: "#86efac", fontSize: ".78rem", marginBottom: 0 }}>Presentada: {new Date(item.submitted_at).toLocaleString("es-AR")}</p>}
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          </>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.25rem" }}>
          <button type="button" className="tc-form-back" onClick={loadParticipations} disabled={loading}>↻ Actualizar</button>
        </div>
      </section>
    </div>
  );
}

export default ReferenteEquipos;
