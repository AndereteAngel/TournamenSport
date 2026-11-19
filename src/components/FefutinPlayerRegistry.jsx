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

  const totalPlayers = useMemo(
    () => categories.reduce((total, category) => total + category.players.length, 0),
    [categories]
  );

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

  const labelFor = (category) => category.category_label || category.category || "Categoría";
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

      <section style={{ display: "grid", gap: ".65rem", padding: ".9rem", border: "1px solid #444", borderRadius: "10px", background: "#121212" }}>
        <h2 style={{ margin: 0, fontSize: "1rem", color: "#fff" }}>1. CATEGORÍAS DEL PLANTEL</h2>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: ".5rem" }}>
          <input value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="Ej.: Cat. 2018" maxLength={80} style={inputStyle} />
          <button type="button" onClick={createCategory} style={secondaryButton}>＋ Crear</button>
        </div>
        <p style={{ margin: 0, color: "#aaa", fontSize: ".75rem" }}>{categories.length} categorías · {totalPlayers} jugadores registrados</p>
      </section>

      <form onSubmit={submitPlayer} style={{ display: "grid", gap: ".8rem", padding: ".9rem", border: "1px solid #b5122a", borderRadius: "10px", background: "#171717" }}>
        <h2 style={{ margin: 0, fontSize: "1rem", color: "#fff" }}>2. INSCRIBIR JUGADOR</h2>
        <label style={{ display: "grid", gap: ".35rem", color: "#fff", fontSize: ".78rem", fontWeight: 800 }}>CATEGORÍA
          <select required value={form.categoryId} onChange={(event) => setForm((previous) => ({ ...previous, categoryId: event.target.value }))} style={inputStyle}>
            <option value="">Seleccionar categoría</option>
            {categories.map((category) => <option key={category.rosterId} value={category.rosterId}>{labelFor(category)}</option>)}
          </select>
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: ".65rem" }}>
          <label style={{ display: "grid", gap: ".35rem", color: "#fff", fontSize: ".78rem", fontWeight: 800 }}>APELLIDO
            <input required value={form.last_name} onChange={(event) => setForm((p) => ({ ...p, last_name: event.target.value }))} style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: ".35rem", color: "#fff", fontSize: ".78rem", fontWeight: 800 }}>NOMBRE
            <input required value={form.first_name} onChange={(event) => setForm((p) => ({ ...p, first_name: event.target.value }))} style={inputStyle} />
          </label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: ".65rem" }}>
          <label style={{ display: "grid", gap: ".35rem", color: "#fff", fontSize: ".78rem", fontWeight: 800 }}>FECHA DE NACIMIENTO
            <input required type="date" value={form.birth_date} onChange={(event) => setForm((p) => ({ ...p, birth_date: event.target.value }))} style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: ".35rem", color: "#fff", fontSize: ".78rem", fontWeight: 800 }}>DNI
            <input required inputMode="numeric" value={form.dni} onChange={(event) => setForm((p) => ({ ...p, dni: event.target.value }))} style={inputStyle} />
          </label>
        </div>
        <div style={{ display: "grid", gap: ".65rem" }}>
          {[
            { key: "photo", title: "FOTO DEL JUGADOR", path: form.photo_path, accept: "image/jpeg,image/png,image/webp" },
            { key: "front", title: "FRENTE DEL DNI", path: form.dni_front_path, accept: "image/jpeg,image/png,image/webp,application/pdf" },
            { key: "back", title: "DORSO DEL DNI", path: form.dni_back_path, accept: "image/jpeg,image/png,image/webp,application/pdf" },
          ].map((file) => (
            <label key={file.key} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", alignItems: "center", gap: ".6rem", padding: ".65rem", border: "1px solid #444", borderRadius: "8px", color: "#fff", fontSize: ".75rem", fontWeight: 800 }}>
              <span>{file.title}<small style={{ display: "block", marginTop: ".25rem", color: file.path ? "#86efac" : "#aaa", fontWeight: 600 }}>{file.path ? "ARCHIVO CARGADO" : "Obligatorio · Máximo 5 MB"}</small></span>
              <span style={{ ...secondaryButton, fontSize: ".7rem", textAlign: "center" }}>{uploading[file.key] ? "Subiendo..." : file.path ? "Cambiar" : "Cargar"}
                <input type="file" accept={file.accept} disabled={uploading[file.key]} onChange={(event) => uploadFile(file.key, event.target.files?.[0])} style={{ display: "none" }} />
              </span>
            </label>
          ))}
        </div>
        <button type="submit" disabled={saving || loading || categories.length === 0 || Object.values(uploading).some(Boolean)} style={{ ...primaryButton, opacity: saving || loading || categories.length === 0 || Object.values(uploading).some(Boolean) ? .55 : 1 }}>
          {saving ? "GUARDANDO INSCRIPCIÓN..." : "GUARDAR JUGADOR EN EL PADRÓN"}
        </button>
        {categories.length === 0 && !loading && <p style={{ margin: 0, color: "#facc15", textAlign: "center", fontSize: ".8rem" }}>Creá una categoría para habilitar la inscripción.</p>}
      </form>

      <section style={{ display: "grid", gap: ".75rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".5rem", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: "1rem", color: "#fff" }}>3. PADRÓN PERMANENTE</h2>
          <span style={{ color: "#fca5a5", fontSize: ".75rem", fontWeight: 900 }}>{totalPlayers} JUGADORES</span>
        </div>
        {loading ? <p style={{ color: "#ddd", textAlign: "center", padding: "1rem" }}>Cargando categorías y jugadores...</p> : categories.length === 0 ? (
          <p style={{ color: "#aaa", textAlign: "center", padding: "1.2rem", border: "1px dashed #555", borderRadius: "8px" }}>Todavía no hay categorías ni jugadores. Creá la primera categoría arriba.</p>
        ) : categories.map((category) => (
          <article key={category.rosterId} style={{ border: "1px solid #444", borderRadius: "9px", overflow: "hidden", background: "#090909" }}>
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".5rem", padding: ".7rem .8rem", background: "#171c27" }}>
              <strong style={{ color: "#fff" }}>{labelFor(category)}</strong>
              <span style={{ color: "#fca5a5", fontSize: ".75rem", fontWeight: 900 }}>{category.players.length} jugadores</span>
            </header>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: "590px", borderCollapse: "collapse", color: "#fff", textAlign: "left" }}>
                <thead><tr style={{ background: "#b5122a" }}>{["N.º", "FOTO", "JUGADOR", "DNI", "CARNET", "ESTADO"].map((title) => <th key={title} style={{ padding: ".55rem", fontSize: ".65rem", whiteSpace: "nowrap" }}>{title}</th>)}</tr></thead>
                <tbody>
                  {category.players.map((player, index) => (
                    <tr key={player.id || player.dni || index} style={{ borderTop: "1px solid #333" }}>
                      <td style={{ padding: ".5rem", color: "#fca5a5", fontWeight: 900 }}>{index + 1}</td>
                      <td style={{ padding: ".35rem .5rem" }}>{photoUrl(player.photo_path) ? <img src={photoUrl(player.photo_path)} alt="" style={{ width: "38px", height: "44px", objectFit: "cover", borderRadius: "5px" }} /> : "—"}</td>
                      <td style={{ padding: ".5rem", fontWeight: 800 }}>{[player.last_name, player.first_name].filter(Boolean).join(", ") || "Sin nombre"}</td>
                      <td style={{ padding: ".5rem", whiteSpace: "nowrap" }}>{player.dni || "—"}</td>
                      <td style={{ padding: ".5rem", whiteSpace: "nowrap" }}>{player.carnet_number || "Sin asignar"}</td>
                      <td style={{ padding: ".5rem", whiteSpace: "nowrap", color: player.approval_status === "aprobado" ? "#86efac" : player.approval_status === "rechazado" ? "#fca5a5" : "#facc15", fontSize: ".68rem", fontWeight: 900 }}>
                        {player.approval_status === "aprobado" ? "APROBADO" : player.approval_status === "rechazado" ? "RECHAZADO" : "PENDIENTE"}
                      </td>
                    </tr>
                  ))}
                  {category.players.length === 0 && <tr><td colSpan={6} style={{ padding: "1rem", color: "#aaa", textAlign: "center" }}>Todavía no hay jugadores inscriptos en esta categoría.</td></tr>}
                </tbody>
              </table>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

export default FefutinPlayerRegistry;
