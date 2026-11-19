import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

const inputStyle = {
  width: "100%", minWidth: 0, boxSizing: "border-box", padding: ".75rem",
  borderRadius: "8px", border: "1px solid #555", background: "#fff",
  color: "#111", fontSize: ".95rem",
};
const primaryButton = {
  width: "100%", minHeight: "48px", border: "1px solid #b5122a",
  borderRadius: "8px", padding: ".75rem", background: "#b5122a",
  color: "#fff", fontWeight: 900, cursor: "pointer",
};
const secondaryButton = {
  border: "1px solid #b5122a", borderRadius: "8px", padding: ".65rem .9rem",
  background: "#171c27", color: "#fff", fontWeight: 800, cursor: "pointer",
};

const emptyForm = { categoryId: "", first_name: "", last_name: "", birth_date: "", dni: "", photo_path: "", dni_front_path: "", dni_back_path: "" };

export function FefutinPlayerRegistry({ currentUser, clubId, clubName, onBack }) {
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [newCategory, setNewCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState({ photo: false, front: false, back: false });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeView, setActiveView] = useState("inscribir");
  const [registryCategory, setRegistryCategory] = useState("todas");
  const [registrySearch, setRegistrySearch] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [photoPreviewOpen, setPhotoPreviewOpen] = useState(false);
  const [dniPreviewOpen, setDniPreviewOpen] = useState(false);
  const [dniDocuments, setDniDocuments] = useState(null);
  const [dniLoading, setDniLoading] = useState(false);
  const [dniError, setDniError] = useState("");

  const loadRegistry = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: rpcError } = await supabase.rpc("get_fefutin_my_permanent_rosters");
    if (rpcError) {
      setError(rpcError.message || "No se pudo cargar el padrón del club.");
      setCategories([]);
      setLoading(false);
      return;
    }
    const rows = (data || []).map((item) => ({
      ...item,
      rosterId: item.roster_id || item.team_id || item.club_tournament_id,
      players: Array.isArray(item.players) ? item.players : [],
    })).filter((item) => item.rosterId && (!clubId || item.club_id === clubId));
    setCategories(rows);
    setForm((previous) => ({
      ...previous,
      categoryId: rows.some((item) => item.rosterId === previous.categoryId)
        ? previous.categoryId
        : (rows[0]?.rosterId || ""),
    }));
    setLoading(false);
  }, [clubId]);

  useEffect(() => { loadRegistry(); }, [loadRegistry]);

  const labelFor = (category) => category.category_label || category.category || "Categoría";

  const totalPlayers = useMemo(
    () => categories.reduce((total, category) => total + category.players.length, 0),
    [categories]
  );
  const allPlayers = useMemo(() => categories.flatMap((category) => category.players.map((player) => ({ ...player, categoryId: category.rosterId, categoryLabel: labelFor(category), category_label: labelFor(category), club_name: category.club_name || clubName || "—", logo_path: category.logo_path || "" }))), [categories, clubName]);
  const filteredPlayers = useMemo(() => allPlayers.filter((player) => {
    const categoryMatch = registryCategory === "todas" || player.categoryId === registryCategory;
    const query = registrySearch.trim().toLocaleLowerCase("es");
    const searchMatch = !query || [player.first_name, player.last_name, player.dni].some((value) => String(value || "").toLocaleLowerCase("es").includes(query));
    return categoryMatch && searchMatch;
  }), [allPlayers, registryCategory, registrySearch]);

  const createCategory = async () => {
    const label = newCategory.trim();
    if (!label) { setError("Escribí el nombre de la categoría."); return; }
    setError("");
    setNotice("");
    const { data, error: createError } = await supabase.rpc("create_fefutin_permanent_roster", { p_category_label: label });
    if (createError) { setError(createError.message || "No se pudo crear la categoría."); return; }
    setNewCategory("");
    await loadRegistry();
    if (data) setForm((previous) => ({ ...previous, categoryId: data }));
    setNotice("Categoría creada. Ya podés inscribir jugadores.");
  };

  const uploadFile = async (kind, file) => {
    if (!file) return;
    const isPhoto = kind === "photo";
    const allowed = isPhoto
      ? ["image/jpeg", "image/png", "image/webp"]
      : ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowed.includes(file.type)) {
      setError(isPhoto ? "La foto debe ser JPG, PNG o WEBP." : "El DNI debe ser JPG, PNG, WEBP o PDF.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) { setError("El archivo no puede superar los 5 MB."); return; }
    setUploading((previous) => ({ ...previous, [kind]: true }));
    setError("");
    const extension = file.name.split(".").pop()?.toLowerCase() || (isPhoto ? "jpg" : "pdf");
    const bucket = isPhoto ? "fefutin-player-photos" : "fefutin-player-dni";
    const path = `${currentUser.id}/registro-${Date.now()}-${kind}.${extension}`;
    const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type });
    if (uploadError) setError(uploadError.message || "No se pudo subir el archivo.");
    else {
      const field = kind === "photo" ? "photo_path" : kind === "front" ? "dni_front_path" : "dni_back_path";
      setForm((previous) => ({ ...previous, [field]: path }));
      setNotice(kind === "photo" ? "Foto del jugador cargada." : kind === "front" ? "Frente del DNI cargado." : "Dorso del DNI cargado.");
    }
    setUploading((previous) => ({ ...previous, [kind]: false }));
  };

  const submitPlayer = async (event) => {
    event.preventDefault();
    const category = categories.find((item) => item.rosterId === form.categoryId);
    if (!category) { setError("Primero creá o seleccioná una categoría."); return; }
    if (!form.last_name.trim() || !form.first_name.trim() || !form.dni.trim() || !form.birth_date) {
      setError("Completá apellido, nombre, fecha de nacimiento y DNI."); return;
    }
    if (!form.photo_path || !form.dni_front_path || !form.dni_back_path) {
      setError("Falta cargar la foto del jugador, el frente o el dorso del DNI."); return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    const payload = [
      ...category.players,
      {
        id: `nuevo-${Date.now()}`,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        dni: form.dni.trim(),
        birth_date: form.birth_date,
        photo_path: form.photo_path,
      },
    ].map((player) => ({
      id: player.id,
      first_name: player.first_name || "",
      last_name: player.last_name || "",
      dni: player.dni || "",
      birth_date: player.birth_date || "",
      photo_path: player.photo_path || "",
    }));
    const { error: saveError } = await supabase.rpc("save_fefutin_permanent_roster_with_dni", {
      p_roster_id: category.rosterId,
      p_players: payload,
      p_player_dni: form.dni.trim(),
      p_dni_front_path: form.dni_front_path,
      p_dni_back_path: form.dni_back_path,
    });
    setSaving(false);
    if (saveError) { setError(saveError.message || "No se pudo guardar la inscripción."); return; }
    setForm({ ...emptyForm, categoryId: category.rosterId });
    setNotice("Jugador inscripto. Quedó pendiente de revisión.");
    await loadRegistry();
  };

  const photoUrl = (path) => path ? supabase.storage.from("fefutin-player-photos").getPublicUrl(path).data.publicUrl : "";

  const openDniDocuments = async (player) => {
    setDniPreviewOpen(true);
    setDniLoading(true);
    setDniError("");
    setDniDocuments(null);

    if (!player?.id) {
      setDniError("No se encontró el identificador del jugador para consultar su DNI.");
      setDniLoading(false);
      return;
    }

    const { data, error: rpcError } = await supabase.rpc("get_fefutin_player_dni_documents", {
      p_player_entry_id: player.id,
    });
    if (rpcError) {
      setDniError(rpcError.message || "No se pudieron consultar los documentos del DNI.");
      setDniLoading(false);
      return;
    }

    const documents = data?.[0];
    if (!documents?.dni_front_path || !documents?.dni_back_path) {
      setDniError("Este jugador todavía no tiene cargados el frente y el dorso del DNI.");
      setDniLoading(false);
      return;
    }

    const [front, back] = await Promise.all([
      supabase.storage.from("fefutin-player-dni").createSignedUrl(documents.dni_front_path, 300),
      supabase.storage.from("fefutin-player-dni").createSignedUrl(documents.dni_back_path, 300),
    ]);
    if (front.error || back.error) {
      setDniError(front.error?.message || back.error?.message || "No se pudieron abrir las imágenes del DNI.");
      setDniLoading(false);
      return;
    }

    setDniDocuments({
      frontUrl: front.data.signedUrl,
      backUrl: back.data.signedUrl,
      frontPdf: documents.dni_front_path.toLowerCase().endsWith(".pdf"),
      backPdf: documents.dni_back_path.toLowerCase().endsWith(".pdf"),
    });
    setDniLoading(false);
  };

  return (
    <main style={{ width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box", padding: "clamp(.75rem,3vw,1.25rem)", color: "#fff", background: "#080808", border: "1px solid #b5122a", borderRadius: "12px", display: "grid", gap: "1rem" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".75rem", flexWrap: "wrap" }}>
        <button type="button" onClick={onBack} style={secondaryButton}>← Volver a MI CLUB</button>
        <button type="button" onClick={loadRegistry} disabled={loading} style={secondaryButton}>↻ Actualizar</button>
      </header>

      <section>
        <p style={{ color: "#fca5a5", fontSize: ".7rem", fontWeight: 900, letterSpacing: ".12em", margin: "0 0 .35rem" }}>FEFUTIN · {clubName || "MI CLUB"}</p>
        <h1 style={{ margin: 0, color: "#fff", fontSize: "clamp(1.25rem,5vw,1.8rem)" }}>INSCRIPCIÓN Y PADRÓN DE JUGADORES</h1>
        <p style={{ color: "#aaa", fontSize: ".85rem", lineHeight: 1.45, margin: ".45rem 0 0" }}>Cada jugador se registra una sola vez en su categoría del plantel permanente.</p>
      </section>

      {error && <p role="alert" style={{ margin: 0, padding: ".8rem", border: "1px solid #b5122a", borderRadius: "8px", color: "#fecaca", background: "#450a0a", overflowWrap: "anywhere" }}>{error}</p>}
      {notice && <p role="status" style={{ margin: 0, padding: ".8rem", border: "1px solid #166534", borderRadius: "8px", color: "#bbf7d0", background: "#052e16" }}>{notice}</p>}

      <nav aria-label="Secciones de jugadores" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: ".5rem" }}>
        <button type="button" onClick={() => { setActiveView("inscribir"); setError(""); setNotice(""); }} style={{ ...primaryButton, minHeight: "42px", padding: ".5rem", fontSize: ".8rem", background: activeView === "inscribir" ? "#b5122a" : "#171c27" }}>＋ Inscribir</button>
        <button type="button" onClick={() => { setActiveView("padron"); setError(""); setNotice(""); }} style={{ ...primaryButton, minHeight: "42px", padding: ".5rem", fontSize: ".8rem", background: activeView === "padron" ? "#b5122a" : "#171c27" }}>☷ Padrón ({totalPlayers})</button>
      </nav>
      {activeView === "inscribir" ? (
        <section style={{ display: "grid", gap: ".7rem", minWidth: 0 }}>
          <div style={{ display: "grid", gap: ".5rem", padding: ".7rem", border: "1px solid #444", borderRadius: "9px", background: "#121212" }}>
            <h2 style={{ margin: 0, fontSize: ".86rem" }}>CATEGORÍA DEL JUGADOR</h2>
            <select required value={form.categoryId} onChange={(event) => setForm((p) => ({ ...p, categoryId: event.target.value }))} style={{ ...inputStyle, fontSize: ".82rem", padding: ".62rem" }}>
              <option value="">Seleccionar categoría</option>
              {categories.map((category) => <option key={category.rosterId} value={category.rosterId}>{labelFor(category)}</option>)}
            </select>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: ".45rem", alignItems: "end" }}>
              <label style={{ display: "grid", gap: ".25rem", color: "#aaa", fontSize: ".68rem" }}>Crear categoría si no existe
                <input value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="Ej.: Cat. 2018" maxLength={80} style={{ ...inputStyle, fontSize: ".8rem", padding: ".6rem" }} />
              </label>
              <button type="button" onClick={createCategory} style={{ ...secondaryButton, padding: ".55rem .65rem", fontSize: ".72rem" }}>＋ Crear</button>
            </div>
          </div>
          <form onSubmit={submitPlayer} style={{ display: "grid", gap: ".65rem", padding: ".7rem", border: "1px solid #b5122a", borderRadius: "9px", background: "#121212", minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: ".86rem" }}>DATOS DEL JUGADOR</h2>
            <label style={{ display: "grid", gap: ".25rem", color: "#eee", fontSize: ".7rem", fontWeight: 800 }}>APELLIDO
              <input required value={form.last_name} onChange={(event) => setForm((p) => ({ ...p, last_name: event.target.value }))} style={{ ...inputStyle, fontSize: ".82rem", padding: ".62rem" }} />
            </label>
            <label style={{ display: "grid", gap: ".25rem", color: "#eee", fontSize: ".7rem", fontWeight: 800 }}>NOMBRE
              <input required value={form.first_name} onChange={(event) => setForm((p) => ({ ...p, first_name: event.target.value }))} style={{ ...inputStyle, fontSize: ".82rem", padding: ".62rem" }} />
            </label>
            <label style={{ display: "grid", gap: ".25rem", color: "#eee", fontSize: ".7rem", fontWeight: 800 }}>FECHA DE NACIMIENTO
              <input required type="date" value={form.birth_date} onChange={(event) => setForm((p) => ({ ...p, birth_date: event.target.value }))} style={{ ...inputStyle, fontSize: ".82rem", padding: ".62rem" }} />
            </label>
            <label style={{ display: "grid", gap: ".25rem", color: "#eee", fontSize: ".7rem", fontWeight: 800 }}>DNI
              <input required inputMode="numeric" value={form.dni} onChange={(event) => setForm((p) => ({ ...p, dni: event.target.value }))} style={{ ...inputStyle, fontSize: ".82rem", padding: ".62rem" }} />
            </label>
            <div style={{ display: "grid", gap: ".45rem" }}>
              {[
                { key: "photo", title: "Foto del jugador", path: form.photo_path, accept: "image/jpeg,image/png,image/webp" },
                { key: "front", title: "DNI · Frente", path: form.dni_front_path, accept: "image/jpeg,image/png,image/webp,application/pdf" },
                { key: "back", title: "DNI · Dorso", path: form.dni_back_path, accept: "image/jpeg,image/png,image/webp,application/pdf" },
              ].map((file) => (
                <label key={file.key} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", alignItems: "center", gap: ".45rem", padding: ".5rem", border: "1px solid #444", borderRadius: "7px", color: "#eee", fontSize: ".72rem", fontWeight: 700, minWidth: 0 }}>
                  <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{file.title}<small style={{ display: "block", marginTop: ".15rem", color: file.path ? "#86efac" : "#aaa", fontSize: ".65rem", fontWeight: 500 }}>{file.path ? "Archivo cargado" : "Obligatorio · Máx. 5 MB"}</small></span>
                  <span style={{ ...secondaryButton, fontSize: ".68rem", padding: ".45rem .6rem", whiteSpace: "nowrap" }}>{uploading[file.key] ? "Subiendo…" : file.path ? "Cambiar" : "Cargar"}
                    <input type="file" accept={file.accept} disabled={uploading[file.key]} onChange={(event) => uploadFile(file.key, event.target.files?.[0])} style={{ display: "none" }} />
                  </span>
                </label>
              ))}
            </div>
            <button type="submit" disabled={saving || loading || categories.length === 0 || Object.values(uploading).some(Boolean)} style={{ ...primaryButton, minHeight: "43px", padding: ".6rem", fontSize: ".78rem", opacity: saving || loading || categories.length === 0 || Object.values(uploading).some(Boolean) ? .55 : 1 }}>{saving ? "GUARDANDO…" : "INSCRIBIR JUGADOR"}</button>
            {categories.length === 0 && !loading && <p style={{ margin: 0, color: "#facc15", fontSize: ".74rem" }}>Creá una categoría para habilitar la inscripción.</p>}
          </form>
        </section>
      ) : (
        <section style={{ display: "grid", gap: ".65rem", minWidth: 0 }}>
          <div style={{ display: "grid", gap: ".5rem", padding: ".7rem", border: "1px solid #444", borderRadius: "9px", background: "#121212" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".5rem" }}>
              <h2 style={{ margin: 0, fontSize: ".86rem" }}>PADRÓN DE JUGADORES</h2>
              <strong style={{ color: "#fca5a5", fontSize: ".76rem" }}>{filteredPlayers.length} / {totalPlayers}</strong>
            </div>
            <label style={{ display: "grid", gap: ".25rem", color: "#eee", fontSize: ".7rem", fontWeight: 800 }}>FILTRAR POR CATEGORÍA
              <select value={registryCategory} onChange={(event) => setRegistryCategory(event.target.value)} style={{ ...inputStyle, fontSize: ".8rem", padding: ".6rem" }}>
                <option value="todas">Todas las categorías</option>
                {categories.map((category) => <option key={category.rosterId} value={category.rosterId}>{labelFor(category)}</option>)}
              </select>
            </label>
            <input value={registrySearch} onChange={(event) => setRegistrySearch(event.target.value)} placeholder="Buscar apellido, nombre o DNI" style={{ ...inputStyle, fontSize: ".8rem", padding: ".6rem" }} />
          </div>
          {loading ? <p style={{ color: "#ddd", textAlign: "center", padding: "1rem" }}>Cargando padrón…</p> : filteredPlayers.length === 0 ? (
            <p style={{ color: "#aaa", textAlign: "center", padding: "1rem", border: "1px dashed #555", borderRadius: "8px" }}>{totalPlayers === 0 ? "Todavía no hay jugadores inscriptos." : "No hay jugadores para esos filtros."}</p>
          ) : (
            <div style={{ overflowX: "auto", border: "1px solid #333", borderRadius: "8px" }}>
              <table style={{ width: "100%", minWidth: "520px", borderCollapse: "collapse", color: "#fff", textAlign: "left" }}>
                <thead><tr style={{ background: "#b5122a" }}>{["FOTO", "JUGADOR", "CATEGORÍA", "DNI", "ESTADO"].map((title) => <th key={title} style={{ padding: ".45rem", fontSize: ".62rem", whiteSpace: "nowrap" }}>{title}</th>)}</tr></thead>
                <tbody>{filteredPlayers.map((player, index) => (
                  <tr key={player.id || player.dni || index} style={{ borderTop: "1px solid #333" }}>
                    <td style={{ padding: ".3rem .4rem" }}>{photoUrl(player.photo_path) ? <img src={photoUrl(player.photo_path)} alt="" style={{ width: "32px", height: "38px", objectFit: "cover", borderRadius: "4px" }} /> : "—"}</td>
                    <td style={{ padding: ".4rem", fontSize: ".74rem", fontWeight: 700 }}><button type="button" onClick={() => setSelectedPlayer(player)} style={{ border: 0, padding: 0, background: "transparent", color: "#fff", font: "inherit", fontWeight: 800, textAlign: "left", textDecoration: "underline", textDecorationColor: "#b5122a", textUnderlineOffset: "3px", cursor: "pointer" }}>{[player.last_name, player.first_name].filter(Boolean).join(", ") || "Sin nombre"}</button></td>
                    <td style={{ padding: ".4rem", fontSize: ".68rem" }}>{player.categoryLabel}</td>
                    <td style={{ padding: ".4rem", fontSize: ".68rem", whiteSpace: "nowrap" }}>{player.dni || "—"}</td>
                    <td style={{ padding: ".4rem", whiteSpace: "nowrap", color: player.approval_status === "aprobado" ? "#86efac" : player.approval_status === "rechazado" ? "#fca5a5" : "#facc15", fontSize: ".62rem", fontWeight: 900 }}>{player.approval_status === "aprobado" ? "APROBADO" : player.approval_status === "rechazado" ? "RECHAZADO" : "PENDIENTE"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {selectedPlayer && (() => {
        const selectedPhotoUrl = photoUrl(selectedPlayer.photo_path);
        const selectedLogoUrl = selectedPlayer.logo_path
          ? supabase.storage.from("fefutin-clubs").getPublicUrl(selectedPlayer.logo_path).data.publicUrl
          : "";
        const approvalStatus = selectedPlayer.approval_status || "pendiente";
        const carnetStatus = selectedPlayer.carnet_status || "pendiente";
        const approvalLabel = approvalStatus === "aprobado"
          ? "APROBADO"
          : approvalStatus === "rechazado" ? "RECHAZADO" : "PENDIENTE DE APROBACIÓN";
        const effectiveStatus = approvalStatus === "rechazado"
          ? "no_habilitado"
          : approvalStatus === "aprobado" ? carnetStatus : "pendiente";
        const carnetStatusLabel = {
          pendiente: "PENDIENTE",
          en_proceso: "EN PROCESO",
          habilitado: "HABILITADO",
          no_habilitado: "NO HABILITADO",
        }[effectiveStatus] || "PENDIENTE";
        const carnetStatusColor = {
          pendiente: "#facc15",
          en_proceso: "#93c5fd",
          habilitado: "#86efac",
          no_habilitado: "#fca5a5",
        }[effectiveStatus] || "#facc15";
        return (
          <div role="presentation" onClick={(event) => { if (event.target === event.currentTarget) { setSelectedPlayer(null); setPhotoPreviewOpen(false); } }} style={{ position: "fixed", inset: 0, zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", background: "rgba(0,0,0,.84)", backdropFilter: "blur(4px)" }}>
            <section role="dialog" aria-modal="true" aria-label="Carnet del jugador" style={{ width: "min(100%, 820px)", maxHeight: "92vh", overflowY: "auto", boxSizing: "border-box", padding: "clamp(.6rem,2vw,1rem)", border: "1px solid #555", borderRadius: "14px", background: "#171717", color: "#fff", boxShadow: "0 20px 70px rgba(0,0,0,.65)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".5rem", marginBottom: ".65rem" }}>
                <strong style={{ color: "#fff", fontSize: ".85rem", letterSpacing: ".06em" }}>CARNET DEL JUGADOR</strong>
                <button type="button" onClick={() => { setSelectedPlayer(null); setPhotoPreviewOpen(false); }} style={{ border: "1px solid #b5122a", borderRadius: "8px", background: "#111", color: "#fff", padding: ".5rem .8rem", cursor: "pointer" }}>✕ Cerrar</button>
              </div>
              <article className="fefutin-carnet-motion fefutin-carnet-card" style={{ width: "100%", maxWidth: "760px", aspectRatio: "1.586 / 1", minHeight: "250px", boxSizing: "border-box", margin: "0 auto", border: "2px solid #b5122a", borderRadius: "14px", overflow: "hidden", background: "linear-gradient(135deg,#242424 0%,#101010 58%,#080808 100%)", color: "#fff", boxShadow: "0 12px 30px rgba(0,0,0,.35)", animation: "fefutinCarnetSway 5.5s ease-in-out infinite", transformOrigin: "50% 85%" }}>
                <div style={{ boxSizing: "border-box", width: "100%", padding: ".8rem 1rem", background: "#b5122a", display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".5rem" }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, color: "#fff", fontSize: ".78rem", fontWeight: 900, letterSpacing: ".1em" }}>FEFUTIN</p>
                    <p style={{ margin: ".15rem 0 0", color: "#fff", fontSize: ".62rem", fontWeight: 700, letterSpacing: ".06em" }}>FEDERACIÓN DE FÚTBOL INFANTIL</p>
                  </div>
                  <img src="https://fefutin.wordpress.com/wp-content/uploads/2017/03/fefutin-logo-grande1.png?h=184&w=166" alt="Logo oficial de FEFUTIN" style={{ flex: "0 0 auto", width: "54px", height: "54px", objectFit: "contain", padding: "3px", boxSizing: "border-box", background: "#fff", border: "1px solid rgba(255,255,255,.8)", borderRadius: "8px" }} />
                </div>
                <div style={{ boxSizing: "border-box", width: "100%", height: "calc(100% - 108px)", minHeight: 0, padding: "clamp(.45rem,1.5vw,.8rem)", display: "grid", gridTemplateColumns: "clamp(92px,19%,140px) minmax(0,1fr)", gap: "clamp(.5rem,1.5vw,.9rem)", alignItems: "center" }}>
                  <button type="button" onClick={() => setPhotoPreviewOpen(true)} aria-label="Ampliar fotografía del jugador" style={{ width: "100%", aspectRatio: "3/4", minWidth: 0, boxSizing: "border-box", padding: 0, border: "2px solid #b5122a", borderRadius: "10px", overflow: "hidden", background: "#202020", display: "block", cursor: "zoom-in" }}>
                    {selectedPhotoUrl ? <img src={selectedPhotoUrl} alt={`Fotografía de ${selectedPlayer.first_name || ""} ${selectedPlayer.last_name || ""}`} style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ display: "grid", width: "100%", height: "100%", placeItems: "center", color: "#aaa", fontSize: ".7rem", fontWeight: 800 }}>SIN FOTO</span>}
                  </button>
                  <div style={{ minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-word" }}>
                    <p style={{ color: "#e7a0aa", fontSize: ".65rem", fontWeight: 900, letterSpacing: ".1em", margin: "0 0 .35rem" }}>CREDENCIAL OFICIAL</p>
                    <h3 style={{ color: "#fff", fontSize: "clamp(1rem,4vw,1.35rem)", lineHeight: 1.15, margin: "0 0 .8rem" }}>{[selectedPlayer.first_name, selectedPlayer.last_name].filter(Boolean).join(" ") || "SIN NOMBRE"}</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", gap: ".65rem .9rem" }}>
                      <div style={{ borderBottom: "1px solid #454545", paddingBottom: ".4rem" }}>
                        <p style={{ color: "#aaa", fontSize: ".62rem", fontWeight: 800, letterSpacing: ".08em", margin: 0 }}>NÚMERO FEFUTIN</p>
                        <p style={{ color: "#fff", fontSize: ".95rem", fontWeight: 900, margin: ".15rem 0 0" }}>{selectedPlayer.carnet_number || "PENDIENTE DE ASIGNACIÓN"}</p>
                      </div>
                      <div style={{ borderBottom: "1px solid #454545", paddingBottom: ".4rem" }}>
                        <p style={{ color: "#aaa", fontSize: ".62rem", fontWeight: 800, letterSpacing: ".08em", margin: 0 }}>DNI</p>
                        <button type="button" onClick={() => openDniDocuments(selectedPlayer)} style={{ color: "#fff", fontSize: ".9rem", fontWeight: 800, margin: ".15rem 0 0", padding: 0, border: 0, borderBottom: "1px dashed #e7a0aa", background: "transparent", cursor: "pointer", textAlign: "left" }}>{selectedPlayer.dni || "NO REGISTRADO"}　↗</button>
                      </div>
                      <div style={{ borderBottom: "1px solid #454545", paddingBottom: ".4rem" }}>
                        <p style={{ color: "#aaa", fontSize: ".62rem", fontWeight: 800, letterSpacing: ".08em", margin: 0 }}>CLUB</p>
                        <div style={{ display: "flex", alignItems: "center", gap: ".45rem", marginTop: ".2rem" }}>
                          {selectedLogoUrl && <img src={selectedLogoUrl} alt="" style={{ width: "28px", height: "28px", objectFit: "contain", background: "#fff", borderRadius: "5px" }} />}
                          <p style={{ color: "#fff", fontSize: ".84rem", fontWeight: 800, margin: 0 }}>{selectedPlayer.club_name || clubName || "—"}</p>
                        </div>
                      </div>
                      <div style={{ borderBottom: "1px solid #454545", paddingBottom: ".4rem" }}>
                        <p style={{ color: "#aaa", fontSize: ".62rem", fontWeight: 800, letterSpacing: ".08em", margin: 0 }}>CATEGORÍA</p>
                        <p style={{ color: "#fff", fontSize: ".84rem", margin: ".15rem 0 0" }}>{selectedPlayer.categoryLabel || "—"}</p>
                      </div>
                      <div>
                        <p style={{ color: "#aaa", fontSize: ".62rem", fontWeight: 800, letterSpacing: ".08em", margin: 0 }}>ESTADO DE HABILITACIÓN</p>
                        <p style={{ color: carnetStatusColor, fontSize: ".82rem", fontWeight: 900, margin: ".15rem 0 0" }}>{carnetStatusLabel}</p>
                        <p style={{ color: "#aaa", fontSize: ".65rem", fontWeight: 700, margin: ".2rem 0 0" }}>{approvalLabel}</p>
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{ boxSizing: "border-box", width: "100%", padding: ".6rem 1rem", borderTop: "1px solid #b5122a", background: "#090909", display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".5rem" }}>
                  <span style={{ color: "#ddd", fontSize: ".62rem", fontWeight: 800, letterSpacing: ".08em" }}>JUGADOR FEFUTIN</span>
                  <span style={{ color: "#e7a0aa", fontSize: ".6rem", fontWeight: 800 }}>CARNET DIGITAL · FEFUTIN</span>
                </div>
              </article>
              <p style={{ color: "#aaa", fontSize: ".68rem", textAlign: "center", margin: ".65rem 0 0" }}>Los datos y el número de carnet reflejan el registro oficial disponible. El número no se genera desde esta pantalla.</p>
            </section>
            {photoPreviewOpen && selectedPhotoUrl && (
              <div role="presentation" onClick={() => setPhotoPreviewOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 10002, display: "grid", placeItems: "center", padding: "1rem", background: "rgba(0,0,0,.92)" }}>
                <button type="button" onClick={() => setPhotoPreviewOpen(false)} style={{ position: "absolute", top: "1rem", right: "1rem", border: "1px solid #b5122a", borderRadius: "8px", background: "#171717", color: "#fff", padding: ".55rem .8rem" }}>✕ Cerrar</button>
                <img src={selectedPhotoUrl} alt="Fotografía ampliada del jugador" style={{ maxWidth: "min(92vw,520px)", maxHeight: "82vh", objectFit: "contain", border: "2px solid #b5122a", borderRadius: "10px" }} />
              </div>
            )}
          </div>
        );
      })()}
      {dniPreviewOpen && selectedPlayer && (
        <div role="dialog" aria-modal="true" aria-label="Documentos del DNI" onClick={(event) => { if (event.target === event.currentTarget) setDniPreviewOpen(false); }} style={{ position: "fixed", inset: 0, zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: ".75rem", background: "rgba(0,0,0,.96)" }}>
          <div style={{ width: "min(100%, 960px)", maxHeight: "94vh", overflowY: "auto", padding: "1rem", border: "1px solid #b5122a", borderRadius: "14px", background: "#171717", color: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".7rem", marginBottom: "1rem" }}>
              <div>
                <strong style={{ display: "block" }}>DOCUMENTO DE IDENTIDAD</strong>
                <span style={{ color: "#aaa", fontSize: ".8rem" }}>{[selectedPlayer.first_name, selectedPlayer.last_name].filter(Boolean).join(" ")} · DNI {selectedPlayer.dni || "—"}</span>
              </div>
              <button type="button" onClick={() => setDniPreviewOpen(false)} style={{ border: "1px solid #b5122a", borderRadius: "8px", background: "#101010", color: "#fff", padding: ".55rem .8rem", cursor: "pointer" }}>✕ Cerrar</button>
            </div>
            {dniLoading && <p style={{ textAlign: "center", color: "#ddd" }}>Cargando documentos...</p>}
            {dniError && <p role="alert" style={{ color: "#fca5a5", overflowWrap: "anywhere" }}>{dniError}</p>}
            {dniDocuments && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))", gap: "1rem" }}>
                {[
                  { label: "FRENTE DEL DNI", url: dniDocuments.frontUrl, pdf: dniDocuments.frontPdf },
                  { label: "DORSO DEL DNI", url: dniDocuments.backUrl, pdf: dniDocuments.backPdf },
                ].map((document) => (
                  <div key={document.label} style={{ minWidth: 0, padding: ".65rem", border: "1px solid #444", borderRadius: "10px", background: "#090909" }}>
                    <strong style={{ display: "block", color: "#e7a0aa", fontSize: ".8rem", marginBottom: ".6rem" }}>{document.label}</strong>
                    {document.pdf
                      ? <iframe title={document.label} src={document.url} style={{ width: "100%", height: "min(65vh,520px)", border: 0, background: "#fff", borderRadius: "6px" }} />
                      : <img src={document.url} alt={document.label} style={{ display: "block", width: "100%", maxHeight: "65vh", objectFit: "contain", background: "#fff", borderRadius: "6px" }} />}
                  </div>
                ))}
              </div>
            )}
            <p style={{ color: "#888", fontSize: ".72rem", margin: "1rem 0 0" }}>Documentación privada. Los enlaces de consulta son temporales y se generan sólo después de validar el acceso.</p>
          </div>
        </div>
      )}
      <style>{`
        @keyframes fefutinCarnetSway {
          0%, 100% { transform: perspective(900px) rotateX(0deg) rotateZ(0deg) translateY(0); }
          22% { transform: perspective(900px) rotateX(1.2deg) rotateZ(-0.65deg) translateY(-2px); }
          48% { transform: perspective(900px) rotateX(-0.6deg) rotateZ(0.55deg) translateY(-4px); }
          72% { transform: perspective(900px) rotateX(0.8deg) rotateZ(-0.35deg) translateY(-1px); }
        }
        @media (max-width: 520px) and (orientation: portrait) {
          .fefutin-carnet-card { aspect-ratio: auto !important; min-height: 0 !important; height: auto !important; border-radius: 10px !important; animation: none !important; }
          .fefutin-carnet-card > div:first-child { padding: .45rem .6rem !important; min-height: 48px; }
          .fefutin-carnet-card > div:first-child img { width: 38px !important; height: 38px !important; }
          .fefutin-carnet-card > div:nth-child(2) { height: auto !important; min-height: 0 !important; padding: .5rem !important; grid-template-columns: 76px minmax(0, 1fr) !important; gap: .55rem !important; align-items: start !important; }
          .fefutin-carnet-card > div:nth-child(2) > button { width: 76px !important; max-height: 102px; }
          .fefutin-carnet-card h3 { font-size: .82rem !important; line-height: 1.12 !important; margin-bottom: .45rem !important; }
          .fefutin-carnet-card > div:nth-child(2) > div > div { min-width: 0 !important; padding-bottom: .22rem !important; }
          .fefutin-carnet-card > div:nth-child(2) > div > div p:first-child { font-size: .46rem !important; letter-spacing: .02em !important; line-height: 1.1 !important; }
          .fefutin-carnet-card > div:nth-child(2) > div > div p:not(:first-child) { font-size: .66rem !important; line-height: 1.15 !important; overflow-wrap: anywhere !important; }
          .fefutin-carnet-card > div:last-child { padding: .38rem .55rem !important; min-height: 28px; }
        }
      `}</style>

    </main>
  );
}

export default FefutinPlayerRegistry;
