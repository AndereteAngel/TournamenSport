import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

const emptyCarnet = {
  first_name: "",
  last_name: "",
  referee_number: "",
  locality: "",
  birth_date: "",
  photo_path: "",
};

export function RefereeCarnets({ currentUser, canManage, onBack }) {
  const [carnets, setCarnets] = useState([]);
  const [selectedId, setSelectedId] = useState(currentUser?.id || "");
  const [form, setForm] = useState(emptyCarnet);
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoFile, setPhotoFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadCarnets = async () => {
    setLoading(true);
    setError("");
    const { data, error: loadError } = await supabase.rpc("get_fefutin_referee_carnets");
    if (loadError) {
      setError(loadError.message || "No se pudieron cargar los carnets.");
      setCarnets([]);
      setLoading(false);
      return;
    }
    const rows = data || [];
    setCarnets(rows);
    const own = rows.find((item) => item.id === currentUser?.id);
    const chosen = canManage ? rows.find((item) => item.id === selectedId) || rows[0] : own;
    setSelectedId(chosen?.id || currentUser?.id || "");
    setForm(chosen ? {
      first_name: chosen.first_name || "",
      last_name: chosen.last_name || "",
      referee_number: chosen.referee_number || "",
      locality: chosen.locality || "",
      birth_date: chosen.birth_date || "",
      photo_path: chosen.photo_path || "",
    } : emptyCarnet);
    setPhotoFile(null);
    setLoading(false);
  };

  useEffect(() => { loadCarnets(); }, [currentUser?.id]);

  const selectedCarnet = carnets.find((item) => item.id === selectedId);
  const editable = currentUser?.role === "arbitro" && selectedId === currentUser.id;

  useEffect(() => {
    let active = true;
    const getPhoto = async () => {
      if (!form.photo_path) { setPhotoUrl(""); return; }
      const { data, error: photoError } = await supabase.storage
        .from("fefutin-carnets").createSignedUrl(form.photo_path, 300);
      if (active) setPhotoUrl(photoError ? "" : data?.signedUrl || "");
    };
    getPhoto();
    return () => { active = false; };
  }, [form.photo_path, selectedId]);

  const selectCarnet = (id) => {
    const item = carnets.find((row) => row.id === id);
    setSelectedId(id);
    setMessage("");
    setForm(item ? {
      first_name: item.first_name || "",
      last_name: item.last_name || "",
      referee_number: item.referee_number || "",
      locality: item.locality || "",
      birth_date: item.birth_date || "",
      photo_path: item.photo_path || "",
    } : emptyCarnet);
    setPhotoFile(null);
  };

  const save = async (event) => {
    event.preventDefault();
    if (!editable) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      let path = form.photo_path || null;
      if (photoFile && photoFile.size > 5 * 1024 * 1024) {
        throw new Error("La fotografía no puede superar los 5 MB.");
      }
      if (photoFile) {
        path = currentUser.id + "/photo";
        const { error: uploadError } = await supabase.storage.from("fefutin-carnets")
          .upload(path, photoFile, { upsert: true, contentType: photoFile.type });
        if (uploadError) throw uploadError;
      }
      const { error: saveError } = await supabase.rpc("save_my_fefutin_referee_carnet", {
        p_first_name: form.first_name,
        p_last_name: form.last_name,
        p_referee_number: form.referee_number,
        p_locality: form.locality,
        p_birth_date: form.birth_date || null,
        p_photo_path: path,
      });
      if (saveError) throw saveError;
      setMessage("Carnet actualizado correctamente.");
      await loadCarnets();
    } catch (saveError) {
      console.error("Error al guardar carnet:", saveError);
      setError(saveError.message || "No se pudo guardar el carnet.");
    } finally {
      setSaving(false);
    }
  };

  const fieldStyle = {
    width: "100%", boxSizing: "border-box", padding: "0.75rem",
    borderRadius: "8px", border: "1px solid #555", background: "#101010",
    color: "#fff", marginTop: "0.35rem",
  };
  const labelStyle = { display: "block", color: "#ddd", fontSize: "0.75rem", fontWeight: 800, marginBottom: "0.8rem" };

  return (
    <div className="tc-form-screen" style={{ padding: "1rem", minHeight: "70vh" }}>
      <section className="cr-card" style={{ width: "100%", maxWidth: "850px", margin: "auto", padding: "clamp(1rem, 3vw, 2rem)", background: "#090909", color: "#fff", border: "1px solid #b5122a" }}>
        <button type="button" className="tc-form-back" onClick={onBack}>← Volver</button>
        <header style={{ textAlign: "center", margin: "1.2rem 0" }}>
          <p style={{ color: "#b5122a", fontWeight: 900, letterSpacing: ".15em", margin: 0 }}>FEFUTIN · IDENTIFICACIÓN OFICIAL</p>
          <h2 className="cr-title" style={{ margin: ".35rem 0" }}>CARNET DE ÁRBITRO</h2>
        </header>

        {canManage && (
          <div style={{ marginBottom: "1rem" }}>
            <label style={labelStyle}>Seleccionar árbitro
              <select value={selectedId} onChange={(event) => selectCarnet(event.target.value)} style={fieldStyle}>
                {carnets.map((item) => <option key={item.id} value={item.id}>{[item.last_name, item.first_name].filter(Boolean).join(", ") || item.username || "Árbitro sin datos"}</option>)}
              </select>
            </label>
          </div>
        )}

        {loading ? <p style={{ color: "#ddd", textAlign: "center" }}>Cargando carnet...</p> : error && !carnets.length ? (
          <p role="alert" style={{ color: "#fca5a5" }}>{error}</p>
        ) : canManage && carnets.length === 0 ? (
          <p style={{ color: "#ddd", textAlign: "center" }}>Todavía no hay árbitros aprobados para mostrar.</p>
        ) : (
          <>
            <article style={{ border: "2px solid #b5122a", borderRadius: "16px", padding: "1rem", background: "linear-gradient(145deg,#1a1a1a,#080808)", display: "grid", gridTemplateColumns: "minmax(120px, 180px) minmax(0,1fr)", gap: "1rem", alignItems: "center" }}>
              <div style={{ aspectRatio: "3/4", border: "1px solid #555", borderRadius: "10px", overflow: "hidden", background: "#111", display: "grid", placeItems: "center" }}>
                {photoUrl ? <img src={photoUrl} alt="Fotografía del árbitro" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ color: "#888", fontSize: "3rem" }}>⚽</span>}
              </div>
              <div>
                <p style={{ color: "#b5122a", fontSize: ".7rem", fontWeight: 900, letterSpacing: ".12em", margin: "0 0 .4rem" }}>FEDERACIÓN DE FÚTBOL INFANTIL</p>
                <h3 style={{ color: "#fff", fontSize: "1.3rem", margin: "0 0 .8rem" }}>{[form.first_name, form.last_name].filter(Boolean).join(" ") || selectedCarnet?.username || "Nombre y apellido"}</h3>
                <p style={{ color: "#ddd", margin: ".35rem 0" }}><strong>Matrícula:</strong> {form.referee_number || "A completar"}</p>
                <p style={{ color: "#ddd", margin: ".35rem 0" }}><strong>Localidad:</strong> {form.locality || "A completar"}</p>
                <p style={{ color: "#ddd", margin: ".35rem 0" }}><strong>Fecha de nacimiento:</strong> {form.birth_date ? new Date(form.birth_date + "T12:00:00").toLocaleDateString("es-AR") : "A completar"}</p>
                <p style={{ color: "#999", fontSize: ".65rem", marginTop: "1rem" }}>CARNET DIGITAL · FEFUTIN</p>
              </div>
            </article>

            {editable ? (
              <form onSubmit={save} style={{ marginTop: "1.2rem", borderTop: "1px solid #444", paddingTop: "1rem" }}>
                <h3 style={{ color: "#fff" }}>Mis datos</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: ".75rem" }}>
                  <label style={labelStyle}>Nombre<input required value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} style={fieldStyle} /></label>
                  <label style={labelStyle}>Apellido<input required value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} style={fieldStyle} /></label>
                  <label style={labelStyle}>Número de árbitro / matrícula<input value={form.referee_number} onChange={(e) => setForm({ ...form, referee_number: e.target.value })} style={fieldStyle} /></label>
                  <label style={labelStyle}>Localidad<input value={form.locality} onChange={(e) => setForm({ ...form, locality: e.target.value })} style={fieldStyle} /></label>
                  <label style={labelStyle}>Fecha de nacimiento<input type="date" value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} style={{ ...fieldStyle, colorScheme: "dark" }} /></label>
                  <label style={labelStyle}>Fotografía<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setPhotoFile(e.target.files?.[0] || null)} style={fieldStyle} /></label>
                </div>
                <button type="submit" className="cr-btn-gold" disabled={saving} style={{ marginTop: ".5rem" }}>{saving ? "Guardando..." : "Guardar carnet"}</button>
              </form>
            ) : (
              <p style={{ color: "#aaa", fontSize: ".8rem", marginTop: "1rem" }}>Consulta de carnet. Los datos personales solo pueden ser editados por el propio árbitro.</p>
            )}
            {message && <p role="status" style={{ color: "#86efac" }}>{message}</p>}
            {error && <p role="alert" style={{ color: "#fca5a5" }}>{error}</p>}
          </>
        )}
      </section>
    </div>
  );
}
