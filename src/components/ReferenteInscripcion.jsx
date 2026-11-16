import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

function formatSupabaseError(stage, error) {
  return [
    stage,
    error?.message || "Error sin mensaje devuelto por Supabase.",
    error?.code ? `Código: ${error.code}` : "",
    error?.details ? `Detalle: ${error.details}` : "",
    error?.hint ? `Pista: ${error.hint}` : "",
  ].filter(Boolean).join("\n");
}

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "0.85rem 1rem",
  borderRadius: "9px",
  border: "1px solid #555",
  background: "#fff",
  color: "#171c27",
  fontSize: "1rem",
};

const allowedDocumentTypes = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];

export function ReferenteInscripcion({ currentUser, onBack, onSubmitted }) {
  const [clubName, setClubName] = useState("");
  const [clubAddress, setClubAddress] = useState("");
  const [locality, setLocality] = useState("");
  const [courtType, setCourtType] = useState("");
  const [referentePhone, setReferentePhone] = useState("");
  const [clubImage, setClubImage] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [showReview, setShowReview] = useState(false);
  const [formError, setFormError] = useState("");
  const [imagePreview, setImagePreview] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!clubImage) {
      setImagePreview("");
      return undefined;
    }
    const previewUrl = URL.createObjectURL(clubImage);
    setImagePreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [clubImage]);

  const handleSendRegistration = async () => {
    if (saving) return;
    setSaving(true);
    setFormError("");

    const uploadedPaths = [];
    const safeName = (name) => name
      .normalize("NFD")
      .replace(/[\\u0300-\\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]/g, "-");

    const logoPath = `${currentUser.id}/${Date.now()}-${safeName(clubImage.name)}`;
    const { error: uploadError } = await supabase.storage
      .from("fefutin-clubs")
      .upload(logoPath, clubImage, {
        cacheControl: "3600",
        upsert: false,
        contentType: clubImage.type || "image/png",
      });

    if (uploadError) {
      console.error("Error al subir el escudo del club:", uploadError);
      setFormError(formatSupabaseError("ETAPA 1 — SUBIDA DEL ESCUDO", uploadError));
      setSaving(false);
      return;
    }
    uploadedPaths.push({ bucket: "fefutin-clubs", path: logoPath });

    const uploadedDocuments = [];
    for (let index = 0; index < documents.length; index += 1) {
      const file = documents[index];
      const filePath = `${currentUser.id}/${Date.now()}-${index}-${safeName(file.name)}`;
      const { error: documentUploadError } = await supabase.storage
        .from("fefutin-club-documents")
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type,
        });

      if (documentUploadError) {
        console.error("Error al subir documentación institucional:", documentUploadError);
        await Promise.all(uploadedPaths.map((item) => supabase.storage.from(item.bucket).remove([item.path])));
        setFormError(formatSupabaseError("ETAPA 2 — DOCUMENTACIÓN INSTITUCIONAL", documentUploadError));
        setSaving(false);
        return;
      }

      uploadedPaths.push({ bucket: "fefutin-club-documents", path: filePath });
      uploadedDocuments.push({ file_name: file.name, file_path: filePath });
    }

    const { error: registrationError } = await supabase.rpc(
      "submit_fefutin_club_registration",
      {
        p_name: clubName.trim(),
        p_headquarters_address: clubAddress.trim(),
        p_locality: locality.trim(),
        p_logo_path: logoPath,
        p_court_type: courtType.trim(),
        p_referente_phone: referentePhone.trim(),
        p_documents: uploadedDocuments,
      }
    );

    if (registrationError) {
      console.error("Error al enviar la inscripción institucional:", registrationError);
      await Promise.all(uploadedPaths.map((item) => supabase.storage.from(item.bucket).remove([item.path])));
      setFormError(formatSupabaseError("ETAPA 3 — REGISTRO INSTITUCIONAL (RPC)", registrationError));
      setSaving(false);
      return;
    }

    if (onSubmitted) await onSubmitted();
    setSaving(false);
  };

  const handleReview = (event) => {
    event.preventDefault();
    if (!clubName.trim()) {
      setFormError("Ingresá el nombre de la institución o club.");
      return;
    }
    if (!clubAddress.trim()) {
      setFormError("Ingresá el domicilio de la sede del club.");
      return;
    }
    if (!locality.trim()) {
      setFormError("Ingresá la localidad del club.");
      return;
    }
    if (!clubImage) {
      setFormError("Seleccioná el escudo o una imagen del club.");
      return;
    }
    if (documents.length > 10) {
      setFormError("Podés adjuntar hasta 10 documentos institucionales.");
      return;
    }
    if (documents.some((file) => !allowedDocumentTypes.includes(file.type))) {
      setFormError("La documentación debe estar en PDF, JPG, PNG o WEBP.");
      return;
    }
    if (documents.some((file) => file.size > 10 * 1024 * 1024)) {
      setFormError("Cada documento puede pesar hasta 10 MB.");
      return;
    }
    setFormError("");
    setShowReview(true);
  };

  return (
    <div className="tc-form-screen" style={{ width: "100%", maxWidth: "100%", minWidth: 0, padding: "0", minHeight: "70vh", boxSizing: "border-box" }}>
      <section className="cr-card" style={{ width: "100%", maxWidth: "100%", minWidth: 0, margin: 0, padding: "clamp(1rem, 2.5vw, 2rem)", boxSizing: "border-box", background: "#080808", color: "#fff", border: "1px solid #b5122a" }}>
        <button type="button" className="tc-form-back" onClick={onBack}>← Volver al inicio</button>
        <p style={{ color: "#b5122a", fontWeight: 900, letterSpacing: ".12em", fontSize: ".72rem", margin: "1.25rem 0 .35rem" }}>ÁREA DEL REFERENTE</p>
        <h2 className="cr-title" style={{ color: "#fff", margin: "0 0 .5rem" }}>INSCRIPCIÓN INSTITUCIONAL</h2>
        <p style={{ color: "#d1d5db", lineHeight: 1.6, marginTop: 0 }}>
          Registrá tu institución en FEFUTIN. Primero se aprueba el club y su estructura permanente; la participación en torneos se solicita después, por separado.
        </p>

        <form onSubmit={handleReview} style={{ display: "grid", gap: "1.25rem" }}>
          <section style={{ border: "1px solid #343434", borderRadius: "12px", padding: "1rem", display: "grid", gap: ".9rem" }}>
            <h3 style={{ color: "#fff", margin: 0 }}>1. Datos del club</h3>
            <label style={{ display: "grid", gap: ".45rem", color: "#fff", fontWeight: 700 }}>
              Nombre del club o institución *
              <input value={clubName} onChange={(event) => { setClubName(event.target.value); setShowReview(false); }} placeholder="Ej.: Club Atlético..." style={inputStyle} maxLength={100} required />
            </label>
            <label style={{ display: "grid", gap: ".45rem", color: "#fff", fontWeight: 700 }}>
              Domicilio de la sede *
              <input value={clubAddress} onChange={(event) => { setClubAddress(event.target.value); setShowReview(false); }} placeholder="Calle y número" style={inputStyle} maxLength={200} required />
            </label>
            <label style={{ display: "grid", gap: ".45rem", color: "#fff", fontWeight: 700 }}>
              Localidad *
              <input value={locality} onChange={(event) => { setLocality(event.target.value); setShowReview(false); }} placeholder="Localidad del club" style={inputStyle} maxLength={100} required />
            </label>
            <label style={{ display: "grid", gap: ".45rem", color: "#fff", fontWeight: 700 }}>
              Tipo de cancha
              <input value={courtType} onChange={(event) => { setCourtType(event.target.value); setShowReview(false); }} placeholder="Ej.: césped natural, sintético, salón..." style={inputStyle} maxLength={100} />
            </label>
            <label style={{ display: "grid", gap: ".45rem", color: "#fff", fontWeight: 700 }}>
              Teléfono de contacto del referente
              <input value={referentePhone} onChange={(event) => { setReferentePhone(event.target.value); setShowReview(false); }} placeholder="Código de área + número" style={inputStyle} maxLength={40} inputMode="tel" />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "1rem", alignItems: "center" }}>
              <label style={{ display: "grid", gap: ".5rem", color: "#fff", fontWeight: 700 }}>
                Escudo o foto del club *
                <input type="file" accept="image/*" onChange={(event) => { setClubImage(event.target.files?.[0] || null); setShowReview(false); }} style={{ color: "#ddd", maxWidth: "100%" }} />
                <span style={{ color: "#aaa", fontSize: ".78rem", fontWeight: 400 }}>Imagen obligatoria.</span>
              </label>
              <div style={{ width: "88px", height: "88px", borderRadius: "12px", border: "1px dashed #777", display: "grid", placeItems: "center", overflow: "hidden", background: "#171c27" }}>
                {imagePreview ? <img src={imagePreview} alt="Vista previa del escudo del club" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <span style={{ fontSize: "2rem" }}>⚽</span>}
              </div>
            </div>
          </section>

          <section style={{ border: "1px solid #343434", borderRadius: "12px", padding: "1rem", display: "grid", gap: ".9rem" }}>
            <h3 style={{ color: "#fff", margin: 0 }}>2. Inscripción institucional y documentación</h3>
            <p style={{ color: "#aaa", fontSize: ".82rem", margin: 0 }}>Adjuntá la documentación institucional disponible. Se acepta PDF, JPG, PNG o WEBP (hasta 10 MB por archivo).</p>
            <label style={{ display: "grid", gap: ".5rem", color: "#fff", fontWeight: 700 }}>
              Documentación del club
              <input
                type="file"
                accept=".pdf,image/jpeg,image/png,image/webp"
                multiple
                onChange={(event) => { setDocuments(Array.from(event.target.files || [])); setShowReview(false); }}
                style={{ color: "#ddd", maxWidth: "100%" }}
              />
            </label>
            {documents.length > 0 && (
              <ul style={{ color: "#ddd", margin: 0, paddingLeft: "1.2rem", fontSize: ".82rem" }}>
                {documents.map((file, index) => <li key={index}>{file.name}</li>)}
              </ul>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: ".75rem" }}>
              <label style={{ display: "grid", gap: ".35rem", color: "#bbb", fontSize: ".85rem" }}>
                Usuario del referente
                <input value={currentUser?.username || ""} readOnly style={{ ...inputStyle, background: "#242424", color: "#fff", borderColor: "#444" }} />
              </label>
              <label style={{ display: "grid", gap: ".35rem", color: "#bbb", fontSize: ".85rem" }}>
                Correo electrónico
                <input value={currentUser?.email || ""} readOnly style={{ ...inputStyle, background: "#242424", color: "#fff", borderColor: "#444" }} />
              </label>
            </div>
          </section>

          <section style={{ border: "1px solid #343434", borderRadius: "12px", padding: "1rem", display: "grid", gap: ".5rem" }}>
            <h3 style={{ color: "#fff", margin: 0 }}>3. Categorías y planteles</h3>
            <p style={{ color: "#d1d5db", margin: 0, lineHeight: 1.5 }}>
              Las categorías y listas de buena fe se administrarán como parte permanente de la institución. No necesitás seleccionar un torneo para registrar el club.
            </p>
          </section>

          {formError && <p role="alert" style={{ color: "#ff8a8a", margin: 0, fontWeight: 700, whiteSpace: "pre-wrap", textAlign: "left" }}>{formError}</p>}
          <button type="submit" style={{ width: "100%", padding: ".9rem 1rem", border: "1px solid #fff", borderRadius: "9px", background: "#b5122a", color: "#fff", fontWeight: 900, letterSpacing: ".04em", cursor: "pointer" }}>
            REVISAR INSCRIPCIÓN INSTITUCIONAL
          </button>
        </form>

        {showReview && (
          <section style={{ marginTop: "1.25rem", border: "1px solid #b5122a", borderRadius: "12px", padding: "1rem", background: "#171717" }}>
            <h3 style={{ color: "#fff", marginTop: 0 }}>4. Confirmación</h3>
            <p style={{ color: "#fff" }}><strong>Club:</strong> {clubName.trim()}</p>
            <p style={{ color: "#fff" }}><strong>Domicilio:</strong> {clubAddress.trim()}</p>
            <p style={{ color: "#fff" }}><strong>Localidad:</strong> {locality.trim()}</p>
            <p style={{ color: "#fff" }}><strong>Tipo de cancha:</strong> {courtType.trim() || "No informado"}</p>
            <p style={{ color: "#fff" }}><strong>Contacto:</strong> {referentePhone.trim() || "No informado"}</p>
            <p style={{ color: "#fff" }}><strong>Escudo:</strong> {clubImage?.name || "Sin imagen"}</p>
            <p style={{ color: "#fff" }}><strong>Documentación adjunta:</strong> {documents.length ? documents.map((file) => file.name).join(", ") : "No se adjuntaron archivos"}</p>
            <p style={{ color: "#ffcf7a", fontSize: ".85rem", lineHeight: 1.5 }}>
              La solicitud institucional quedará pendiente de aprobación de FEFUTIN. No se inscribirá al club en ningún torneo en esta etapa.
            </p>
            {formError && <p role="alert" style={{ color: "#ff8a8a", fontWeight: 700, whiteSpace: "pre-wrap" }}>{formError}</p>}
            <button type="button" onClick={handleSendRegistration} disabled={saving} style={{ width: "100%", padding: ".9rem 1rem", border: "1px solid #fff", borderRadius: "9px", background: saving ? "#555" : "#b5122a", color: "#fff", fontWeight: 900, cursor: saving ? "wait" : "pointer" }}>
              {saving ? "ENVIANDO INSCRIPCIÓN..." : "ENVIAR SOLICITUD DE ALTA A FEFUTIN"}
            </button>
          </section>
        )}
      </section>
    </div>
  );
}
