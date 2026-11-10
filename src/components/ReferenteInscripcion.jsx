import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

function getTournamentCategoryLabel(tournament) {
  const registrationGroup = (Array.isArray(tournament?.groups) ? tournament.groups : [])
    .find((group) => group?.name === "__INSCRIPCIONES__");
  const categoryConfig = Array.isArray(registrationGroup?.category_config)
    ? registrationGroup.category_config
    : [];
  const branch = categoryConfig[0];
  const division = String(branch?.division || "").trim();
  const category = Array.isArray(branch?.categories)
    ? String(branch.categories[0] || "").trim()
    : "";

  if (division && category) return `${division} · ${category}`;

  const parts = String(tournament?.game || "").split(" · ").map((part) => part.trim());
  return parts.length >= 3 ? `${parts[1]} · ${parts.slice(2).join(" · ")}` : "";
}

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

export function ReferenteInscripcion({ tournaments = [], currentUser, onBack, onSubmitted }) {
  const [clubName, setClubName] = useState("");
  const [clubAddress, setClubAddress] = useState("");
  const [courtType, setCourtType] = useState("");
  const [referentePhone, setReferentePhone] = useState("");
  const [clubImage, setClubImage] = useState(null);
  const [selectedTournaments, setSelectedTournaments] = useState({});
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

  const selectedItems = useMemo(
    () => tournaments
      .filter((tournament) => selectedTournaments[tournament.id])
      .map((tournament) => ({
        tournament,
        categories: selectedTournaments[tournament.id] || [],
      })),
    [tournaments, selectedTournaments]
  );

  const toggleTournament = (tournamentId) => {
    setSelectedTournaments((previous) => {
      const next = { ...previous };
      if (next[tournamentId]) {
        delete next[tournamentId];
      } else {
        const tournament = tournaments.find((item) => item.id === tournamentId);
        const categoryLabel = getTournamentCategoryLabel(tournament);
        next[tournamentId] = categoryLabel ? [categoryLabel] : [];
      }
      return next;
    });
    setShowReview(false);
  };

  const handleSendRegistration = async () => {
    if (saving) return;
    setSaving(true);
    setFormError("");

    const safeFileName = clubImage.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]/g, "-");
    const logoPath = `${currentUser.id}/${Date.now()}-${safeFileName}`;

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

    const tournamentSelections = selectedItems.map(({ tournament, categories }) => ({
      tournament_id: tournament.id,
      category_label: categories.join(" · "),
    }));

    const { error: registrationError } = await supabase.rpc(
      "submit_fefutin_club_registration",
      {
        p_name: clubName.trim(),
        p_headquarters_address: clubAddress.trim(),
        p_logo_path: logoPath,
        p_court_type: courtType.trim(),
        p_referente_phone: referentePhone.trim(),
        p_tournaments: tournamentSelections,
      }
    );

    if (registrationError) {
      console.error("Error al enviar la inscripción del club:", registrationError);
      await supabase.storage.from("fefutin-clubs").remove([logoPath]);
      setFormError(formatSupabaseError("ETAPA 2 — REGISTRO DEL CLUB (RPC)", registrationError));
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
    if (!clubImage) {
      setFormError("Seleccioná el escudo o una imagen del club.");
      return;
    }
    if (!selectedItems.length) {
      setFormError("Seleccioná al menos un torneo.");
      return;
    }
    if (selectedItems.some((item) => item.categories.length === 0)) {
      setFormError("Elegí al menos una categoría en cada torneo seleccionado.");
      return;
    }
    setFormError("");
    setShowReview(true);
  };

  return (
    <div className="tc-form-screen" style={{ width: "100%", maxWidth: "100%", minWidth: 0, padding: "1rem", minHeight: "70vh", boxSizing: "border-box" }}>
      <section className="cr-card" style={{ width: "100%", maxWidth: "100%", minWidth: 0, margin: 0, padding: "clamp(1rem, 2.5vw, 2rem)", boxSizing: "border-box", background: "#080808", color: "#fff", border: "1px solid #b5122a" }}>
        <button type="button" className="tc-form-back" onClick={onBack}>← Volver al inicio</button>
        <p style={{ color: "#b5122a", fontWeight: 900, letterSpacing: ".12em", fontSize: ".72rem", margin: "1.25rem 0 .35rem" }}>ÁREA DEL REFERENTE</p>
        <h2 className="cr-title" style={{ color: "#fff", margin: "0 0 .5rem" }}>INSCRIPCIÓN DEL CLUB</h2>
        <p style={{ color: "#d1d5db", lineHeight: 1.6, marginTop: 0 }}>
          Completá los datos institucionales y seleccioná los torneos y categorías en los que querés participar.
        </p>

        <form onSubmit={handleReview} style={{ display: "grid", gap: "1.25rem" }}>
          <section style={{ border: "1px solid #343434", borderRadius: "12px", padding: "1rem", display: "grid", gap: ".9rem" }}>
            <h3 style={{ color: "#fff", margin: 0 }}>Datos de la institución</h3>
            <label style={{ display: "grid", gap: ".45rem", color: "#fff", fontWeight: 700 }}>
              Nombre del club o institución *
              <input value={clubName} onChange={(event) => { setClubName(event.target.value); setShowReview(false); }} placeholder="Ej.: Club Atlético..." style={inputStyle} maxLength={100} required />
            </label>

            <label style={{ display: "grid", gap: ".45rem", color: "#fff", fontWeight: 700 }}>
              Domicilio de la sede *
              <input value={clubAddress} onChange={(event) => { setClubAddress(event.target.value); setShowReview(false); }} placeholder="Calle, número, localidad" style={inputStyle} maxLength={200} required />
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
                <span style={{ color: "#aaa", fontSize: ".78rem", fontWeight: 400 }}>Imagen obligatoria. Seleccionala desde tu dispositivo.</span>
              </label>
              <div style={{ width: "88px", height: "88px", borderRadius: "12px", border: "1px dashed #777", display: "grid", placeItems: "center", overflow: "hidden", background: "#171c27" }}>
                {imagePreview
                  ? <img src={imagePreview} alt="Vista previa del escudo del club" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                  : <span style={{ fontSize: "2rem" }}>⚽</span>}
              </div>
            </div>
          </section>

          <section style={{ border: "1px solid #343434", borderRadius: "12px", padding: "1rem", display: "grid", gap: ".85rem" }}>
            <div>
              <h3 style={{ color: "#fff", margin: "0 0 .3rem" }}>Datos del referente</h3>
              <p style={{ color: "#aaa", fontSize: ".82rem", margin: 0 }}>Estos datos se toman de tu cuenta y no hace falta volver a ingresarlos.</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: ".75rem" }}>
              <label style={{ display: "grid", gap: ".35rem", color: "#bbb", fontSize: ".85rem" }}>
                Usuario
                <input value={currentUser?.username || ""} readOnly style={{ ...inputStyle, background: "#242424", color: "#fff", borderColor: "#444" }} />
              </label>
              <label style={{ display: "grid", gap: ".35rem", color: "#bbb", fontSize: ".85rem" }}>
                Correo electrónico
                <input value={currentUser?.email || ""} readOnly style={{ ...inputStyle, background: "#242424", color: "#fff", borderColor: "#444" }} />
              </label>
            </div>
          </section>

          <section style={{ border: "1px solid #343434", borderRadius: "12px", padding: "1rem", display: "grid", gap: ".9rem" }}>
            <div>
              <h3 style={{ color: "#fff", margin: "0 0 .3rem" }}>Torneos disponibles</h3>
              <p style={{ color: "#aaa", fontSize: ".82rem", margin: 0 }}>Se muestran todos los torneos creados, sin filtrar por estado. Podés elegir más de uno.</p>
            </div>

            {tournaments.length === 0 ? (
              <p style={{ color: "#ddd", margin: 0 }}>Todavía no hay torneos creados.</p>
            ) : tournaments.map((tournament) => {
              const isSelected = Boolean(selectedTournaments[tournament.id]);
              return (
                <article key={tournament.id} style={{ border: isSelected ? "1px solid #b5122a" : "1px solid #444", borderRadius: "10px", padding: ".85rem", background: isSelected ? "rgba(181,18,42,.10)" : "#111" }}>
                  <label style={{ display: "flex", gap: ".7rem", alignItems: "flex-start", cursor: "pointer", color: "#fff" }}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleTournament(tournament.id)} style={{ accentColor: "#b5122a", width: "18px", height: "18px", marginTop: ".15rem" }} />
                    <span style={{ display: "grid", gap: ".2rem" }}>
                      <strong>{tournament.title || "Torneo sin nombre"}</strong>
                      <span style={{ color: "#aaa", fontSize: ".82rem" }}>{tournament.game || "Fútbol"} · {tournament.status || "Sin estado"}</span>
                    </span>
                  </label>
                  {isSelected && (
                    <div style={{ marginTop: ".75rem", paddingLeft: "1.7rem" }}>
                      <span style={{ color: "#fff", fontSize: ".88rem" }}>
                        Rama y categoría asignadas: <strong style={{ color: "#ffb3bf" }}>{getTournamentCategoryLabel(tournament) || "No se pudo identificar la categoría de este torneo"}</strong>
                      </span>
                    </div>
                  )}
                </article>
              );
            })}
          </section>

          {formError && <p role="alert" style={{ color: "#ff8a8a", margin: 0, fontWeight: 700, whiteSpace: "pre-wrap", textAlign: "left" }}>{formError}</p>}

          <button type="submit" style={{ width: "100%", padding: ".9rem 1rem", border: "1px solid #fff", borderRadius: "9px", background: "#b5122a", color: "#fff", fontWeight: 900, letterSpacing: ".04em", cursor: "pointer" }}>
            REVISAR INSCRIPCIÓN
          </button>
        </form>

        {showReview && (
          <section style={{ marginTop: "1.25rem", border: "1px solid #b5122a", borderRadius: "12px", padding: "1rem", background: "#171717" }}>
            <h3 style={{ color: "#fff", marginTop: 0 }}>Revisión de la inscripción</h3>
            <p style={{ color: "#fff" }}><strong>Club:</strong> {clubName.trim()}</p>
            <p style={{ color: "#fff" }}><strong>Domicilio:</strong> {clubAddress.trim()}</p>
            <p style={{ color: "#fff" }}><strong>Tipo de cancha:</strong> {courtType.trim() || "No informado"}</p>
            <p style={{ color: "#fff" }}><strong>Contacto del referente:</strong> {referentePhone.trim() || "No informado"}</p>
            <p style={{ color: "#fff" }}><strong>Escudo:</strong> {clubImage?.name || "Sin imagen seleccionada"}</p>
            {selectedItems.map(({ tournament, categories }) => (
              <div key={tournament.id} style={{ borderTop: "1px solid #444", paddingTop: ".65rem", marginTop: ".65rem" }}>
                <strong style={{ color: "#fff" }}>{tournament.title}</strong>
                <p style={{ color: "#ddd", margin: ".3rem 0 0" }}>{categories.join(" · ")}</p>
              </div>
            ))}
            <p style={{ color: "#ffcf7a", fontSize: ".85rem", lineHeight: 1.5, marginBottom: ".9rem" }}>
              Al enviar, la inscripción quedará pendiente de revisión. El club no se habilitará hasta que administración o un directivo la apruebe.
            </p>
            {formError && <p role="alert" style={{ color: "#ff8a8a", fontWeight: 700, whiteSpace: "pre-wrap", textAlign: "left" }}>{formError}</p>}
            <button
              type="button"
              onClick={handleSendRegistration}
              disabled={saving}
              style={{ width: "100%", padding: ".9rem 1rem", border: "1px solid #fff", borderRadius: "9px", background: saving ? "#555" : "#b5122a", color: "#fff", fontWeight: 900, cursor: saving ? "wait" : "pointer" }}
            >
              {saving ? "ENVIANDO INSCRIPCIÓN..." : "ENVIAR INSCRIPCIÓN PARA APROBACIÓN"}
            </button>
          </section>
        )}
      </section>
    </div>
  );
}
