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
            <article style={{ width: "100%", maxWidth: "620px", minWidth: 0, boxSizing: "border-box", margin: "0 auto", border: "2px solid #b5122a", borderRadius: "18px", overflow: "hidden", background: "linear-gradient(135deg,#242424 0%,#101010 58%,#080808 100%)", color: "#fff", boxShadow: "0 12px 30px rgba(0,0,0,.35)" }}>
              <div style={{ boxSizing: "border-box", width: "100%", padding: ".8rem 1rem", background: "#b5122a", display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".5rem" }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, color: "#fff", fontSize: "clamp(.62rem,2.5vw,.78rem)", fontWeight: 900, letterSpacing: ".1em", overflowWrap: "anywhere" }}>FEFUTIN</p>
                  <p style={{ margin: ".15rem 0 0", color: "#fff", fontSize: "clamp(.52rem,2.2vw,.66rem)", fontWeight: 700, letterSpacing: ".06em", overflowWrap: "anywhere" }}>FEDERACIÓN DE FÚTBOL INFANTIL</p>
                </div>
                <span aria-hidden="true" style={{ flex: "0 0 auto", width: "38px", height: "38px", border: "1px solid rgba(255,255,255,.7)", borderRadius: "50%", display: "grid", placeItems: "center", color: "#fff", fontSize: "1.25rem" }}>⚽</span>
              </div>
              <div style={{ boxSizing: "border-box", width: "100%", padding: "clamp(.75rem,3vw,1.15rem)", display: "grid", gridTemplateColumns: "clamp(82px,25%,132px) minmax(0,1fr)", gap: "clamp(.65rem,3vw,1.1rem)", alignItems: "start" }}>
                <div style={{ width: "100%", aspectRatio: "3/4", minWidth: 0, boxSizing: "border-box", border: "2px solid #b5122a", borderRadius: "10px", overflow: "hidden", background: "#202020", display: "grid", placeItems: "center" }}>
                  {photoUrl ? <img src={photoUrl} alt="Fotografía del árbitro" style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ color: "#888", fontSize: "2.4rem" }}>⚽</span>}
                </div>
                <div style={{ minWidth: 0, width: "100%", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                  <p style={{ color: "#e7a0aa", fontSize: "clamp(.56rem,2.3vw,.68rem)", fontWeight: 900, letterSpacing: ".1em", lineHeight: 1.35, margin: "0 0 .35rem" }}>CREDENCIAL OFICIAL</p>
                  <h3 style={{ color: "#fff", fontSize: "clamp(1rem,4vw,1.35rem)", lineHeight: 1.15, margin: "0 0 .8rem", overflowWrap: "anywhere" }}>{[form.first_name, form.last_name].filter(Boolean).join(" ") || selectedCarnet?.username || "Nombre y apellido"}</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: ".55rem" }}>
                    <div style={{ minWidth: 0, borderBottom: "1px solid #454545", paddingBottom: ".4rem" }}>
                      <p style={{ color: "#aaa", fontSize: ".62rem", fontWeight: 800, letterSpacing: ".08em", margin: 0 }}>MATRÍCULA</p>
                      <p style={{ color: "#fff", fontSize: ".88rem", fontWeight: 800, margin: ".15rem 0 0", overflowWrap: "anywhere" }}>{form.referee_number || "A completar"}</p>
                    </div>
                    <div style={{ minWidth: 0, borderBottom: "1px solid #454545", paddingBottom: ".4rem" }}>
                      <p style={{ color: "#aaa", fontSize: ".62rem", fontWeight: 800, letterSpacing: ".08em", margin: 0 }}>LOCALIDAD</p>
                      <p style={{ color: "#fff", fontSize: ".84rem", margin: ".15rem 0 0", overflowWrap: "anywhere" }}>{form.locality || "A completar"}</p>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ color: "#aaa", fontSize: ".62rem", fontWeight: 800, letterSpacing: ".08em", margin: 0 }}>FECHA DE NACIMIENTO</p>
                      <p style={{ color: "#fff", fontSize: ".84rem", margin: ".15rem 0 0", overflowWrap: "anywhere" }}>{form.birth_date ? new Date(form.birth_date + "T12:00:00").toLocaleDateString("es-AR") : "A completar"}</p>
                    </div>
                  </div>
                </div>
              </div>
              <div style={{ boxSizing: "border-box", width: "100%", padding: ".55rem 1rem", borderTop: "1px solid #b5122a", background: "#090909", display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".5rem" }}>
                <span style={{ color: "#ddd", fontSize: ".62rem", fontWeight: 800, letterSpacing: ".08em" }}>ÁRBITRO HABILITADO</span>
                <span style={{ color: "#e7a0aa", fontSize: ".6rem", fontWeight: 800 }}>CARNET DIGITAL · FEFUTIN</span>
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
