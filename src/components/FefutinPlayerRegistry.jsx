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
  const allPlayers = useMemo(() => categories.flatMap((category) => category.players.map((player) => ({ ...player, categoryId: category.rosterId, categoryLabel: labelFor(category) }))), [categories]);
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
      {selectedPlayer && (
        <div role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setSelectedPlayer(null); }} style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", background: "rgba(0,0,0,.82)" }}>
          <section role="dialog" aria-modal="true" aria-label="Carnet del jugador" style={{ width: "100%", maxWidth: "380px", maxHeight: "90vh", overflowY: "auto", boxSizing: "border-box", padding: "1rem", border: "2px solid #b5122a", borderRadius: "14px", background: "#fff", color: "#171c27", boxShadow: "0 18px 60px rgba(0,0,0,.5)" }}>
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".5rem", paddingBottom: ".65rem", borderBottom: "3px solid #b5122a" }}>
              <div>
                <p style={{ margin: 0, color: "#b5122a", fontSize: ".65rem", fontWeight: 900, letterSpacing: ".12em" }}>FEFUTIN · BABY FÚTBOL</p>
                <h2 style={{ margin: ".15rem 0 0", fontSize: "1.15rem", fontWeight: 900 }}>CARNET DEL JUGADOR</h2>
              </div>
              <button type="button" onClick={() => setSelectedPlayer(null)} aria-label="Cerrar carnet" style={{ ...secondaryButton, minWidth: "38px", padding: ".45rem", background: "#171c27" }}>✕</button>
            </header>
            <div style={{ display: "flex", gap: ".9rem", alignItems: "center", padding: ".9rem 0" }}>
              {photoUrl(selectedPlayer.photo_path) ? <img src={photoUrl(selectedPlayer.photo_path)} alt={`Foto de ${selectedPlayer.first_name || ""} ${selectedPlayer.last_name || ""}`} style={{ width: "104px", height: "124px", objectFit: "cover", border: "2px solid #b5122a", borderRadius: "8px", flexShrink: 0 }} /> : <div style={{ width: "104px", height: "124px", display: "grid", placeItems: "center", flexShrink: 0, border: "1px dashed #999", borderRadius: "8px", color: "#777", fontSize: ".7rem", textAlign: "center" }}>SIN FOTO</div>}
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, color: "#666", fontSize: ".65rem", fontWeight: 800 }}>APELLIDO Y NOMBRE</p>
                <h3 style={{ margin: ".2rem 0 .65rem", fontSize: "1rem", lineHeight: 1.2, overflowWrap: "anywhere" }}>{[selectedPlayer.last_name, selectedPlayer.first_name].filter(Boolean).join(", ") || "Sin nombre"}</h3>
                <p style={{ margin: 0, color: "#666", fontSize: ".65rem", fontWeight: 800 }}>NÚMERO DE CARNET</p>
                <strong style={{ display: "block", marginTop: ".15rem", color: "#b5122a", fontSize: "1.1rem" }}>{selectedPlayer.carnet_number || "Pendiente"}</strong>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".65rem", padding: ".75rem", borderRadius: "8px", background: "#f3f4f6" }}>
              <div><small style={{ color: "#666", fontWeight: 800 }}>DNI</small><div style={{ fontWeight: 800, overflowWrap: "anywhere" }}>{selectedPlayer.dni || "—"}</div></div>
              <div><small style={{ color: "#666", fontWeight: 800 }}>NACIMIENTO</small><div style={{ fontWeight: 800 }}>{selectedPlayer.birth_date || "—"}</div></div>
              <div><small style={{ color: "#666", fontWeight: 800 }}>CLUB</small><div style={{ fontWeight: 800, overflowWrap: "anywhere" }}>{clubName || "—"}</div></div>
              <div><small style={{ color: "#666", fontWeight: 800 }}>CATEGORÍA</small><div style={{ fontWeight: 800 }}>{selectedPlayer.categoryLabel || "—"}</div></div>
            </div>
            <div style={{ marginTop: ".75rem", padding: ".7rem", border: "1px solid #ddd", borderRadius: "8px", textAlign: "center" }}>
              <strong style={{ display: "block", color: selectedPlayer.approval_status === "aprobado" ? "#166534" : selectedPlayer.approval_status === "rechazado" ? "#b91c1c" : "#92400e", fontSize: ".8rem" }}>
                {selectedPlayer.approval_status === "aprobado" ? "APROBADO" : selectedPlayer.approval_status === "rechazado" ? "RECHAZADO" : "PENDIENTE DE APROBACIÓN"}
              </strong>
              <span style={{ display: "block", marginTop: ".25rem", color: "#555", fontSize: ".72rem" }}>
                {selectedPlayer.carnet_status ? `Estado del carnet: ${selectedPlayer.carnet_status}` : selectedPlayer.approval_status === "aprobado" ? "Carnet sin estado informado" : "Carnet no habilitado"}
              </span>
            </div>
            <p style={{ margin: ".7rem 0 0", color: "#777", fontSize: ".62rem", textAlign: "center" }}>Este comprobante refleja los datos disponibles en el padrón del club.</p>
          </section>
        </div>
      )}
    </main>
  );
}

export default FefutinPlayerRegistry;
