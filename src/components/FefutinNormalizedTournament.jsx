import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

const normalizeCategoryName = (value) => String(value || "").replace(/^Cat\.\s*/i, "").trim();

export function FefutinNormalizedTournament({ tournament, onBack, canManage = false, onStatusChange }) {
  const [estado, setEstado] = useState(tournament?.estado || (tournament?.status === "Inscripciones" ? "inscripcion" : "cerrado"));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [categoryRows, setCategoryRows] = useState([]);
  const [clubsByCategory, setClubsByCategory] = useState({});
  const [loadingClubs, setLoadingClubs] = useState(false);
  const [clubsError, setClubsError] = useState("");
  const categories = categoryRows.length
    ? categoryRows.map((item) => normalizeCategoryName(item.nombre)).filter(Boolean)
    : (Array.isArray(tournament?.normalizedCategories) ? tournament.normalizedCategories : []);
  const branch = tournament?.normalizedBranchName || "FEFUTIN";
  const turno = tournament?.normalizedTurno || "Turno sin especificar";
  const tournamentTitle = tournament?.title || "Torneo FEFUTIN";

  useEffect(() => {
    setEstado(tournament?.estado || (tournament?.status === "Inscripciones" ? "inscripcion" : "cerrado"));
    setMessage("");
  }, [tournament?.id, tournament?.estado, tournament?.status]);

  useEffect(() => {
    let cancelled = false;
    const loadCategoryClubs = async () => {
      if (!tournament?.id) {
        setCategoryRows([]);
        setClubsByCategory({});
        return;
      }

      setLoadingClubs(true);
      setClubsError("");
      const { data: categoriesData, error: categoriesError } = await supabase
        .from("fefutin_torneo_categorias")
        .select("id,nombre,sort_order,activa")
        .eq("torneo_id", tournament.id)
        .eq("activa", true)
        .order("sort_order", { ascending: true });

      if (cancelled) return;
      if (categoriesError) {
        setClubsError(categoriesError.message || "No se pudieron cargar las categorías.");
        setCategoryRows([]);
        setClubsByCategory({});
        setLoadingClubs(false);
        return;
      }

      const rows = categoriesData || [];
      setCategoryRows(rows);
      const categoryIds = rows.map((item) => item.id);
      if (!categoryIds.length) {
        setClubsByCategory({});
        setLoadingClubs(false);
        return;
      }

      const { data: competitions, error: competitionsError } = await supabase
        .from("fefutin_competencias")
        .select("id,categoria_id")
        .in("categoria_id", categoryIds);

      if (cancelled) return;
      if (competitionsError) {
        setClubsError(competitionsError.message || "No se pudieron cargar las competencias.");
        setClubsByCategory({});
        setLoadingClubs(false);
        return;
      }

      const competitionRows = competitions || [];
      const competitionIds = competitionRows.map((item) => item.id);
      if (!competitionIds.length) {
        setClubsByCategory({});
        setLoadingClubs(false);
        return;
      }

      const { data: links, error: linksError } = await supabase
        .from("fefutin_competencia_clubes")
        .select("competencia_id,club_id,estado")
        .in("competencia_id", competitionIds)
        .eq("estado", "habilitado");

      if (cancelled) return;
      if (linksError) {
        setClubsError(linksError.message || "No se pudieron cargar los clubes inscriptos.");
        setClubsByCategory({});
        setLoadingClubs(false);
        return;
      }

      const linkRows = links || [];
      const clubIds = [...new Set(linkRows.map((item) => item.club_id).filter(Boolean))];
      let clubRows = [];
      if (clubIds.length) {
        const { data, error } = await supabase
          .from("fefutin_clubs")
          .select("id,name,logo_path")
          .in("id", clubIds);
        if (cancelled) return;
        if (error) {
          setClubsError(error.message || "No se pudieron cargar los nombres de los clubes.");
          setClubsByCategory({});
          setLoadingClubs(false);
          return;
        }
        clubRows = data || [];
      }

      const clubById = new Map(clubRows.map((club) => [String(club.id), club]));
      const categoryIdByCompetition = new Map(competitionRows.map((item) => [String(item.id), String(item.categoria_id)]));
      const next = {};
      linkRows.forEach((link) => {
        const categoryId = categoryIdByCompetition.get(String(link.competencia_id));
        const club = clubById.get(String(link.club_id));
        if (!categoryId || !club) return;
        if (!next[categoryId]) next[categoryId] = [];
        if (!next[categoryId].some((item) => item.id === club.id)) next[categoryId].push(club);
      });

      if (!cancelled) {
        setClubsByCategory(next);
        setLoadingClubs(false);
      }
    };

    loadCategoryClubs();
    return () => { cancelled = true; };
  }, [tournament?.id]);

  const toggleRegistration = async () => {
    if (!canManage || saving || !tournament?.id) return;
    const nextEstado = estado === "inscripcion" ? "cerrado" : "inscripcion";
    setSaving(true);
    setMessage("");
    const { error } = await supabase
      .from("fefutin_torneos")
      .update({ estado: nextEstado, updated_at: new Date().toISOString() })
      .eq("id", tournament.id);
    if (error) {
      setMessage(error.message || "No se pudo actualizar el estado de inscripción.");
    } else {
      setEstado(nextEstado);
      onStatusChange?.(nextEstado);
      setMessage(nextEstado === "inscripcion"
        ? "Inscripciones habilitadas. Los referentes ya pueden enviar solicitudes."
        : "Inscripciones cerradas. No se aceptarán nuevas solicitudes.");
    }
    setSaving(false);
  };

  return (
    <main
      className="tc-form-screen"
      style={{
        width: "100%",
        maxWidth: "900px",
        margin: "0 auto",
        padding: "1rem",
        boxSizing: "border-box",
        color: "#fff",
      }}
    >
      <button type="button" className="tc-form-back" onClick={onBack}>
        ← Volver a torneos
      </button>

      <header
        style={{
          margin: "1rem 0",
          padding: "1.35rem 1rem",
          textAlign: "center",
          background: "linear-gradient(135deg, #171c27, #090909)",
          border: "1px solid #b5122a",
          borderRadius: "14px",
        }}
      >
        <small style={{ color: "#f3a0ad", fontWeight: 900, letterSpacing: ".12em" }}>
          FEFUTIN · {branch.toLocaleUpperCase("es")} · {turno.toLocaleUpperCase("es")}
        </small>
        <h1 style={{ color: "#fff", margin: ".65rem 0 .35rem", fontSize: "clamp(1.35rem, 5vw, 2rem)" }}>
          {tournamentTitle}
        </h1>
        <p style={{ color: "#d1d5db", margin: 0 }}>
          Cada categoría funciona como una competencia independiente.
        </p>
      </header>

      <section
        style={{
          marginBottom: "1rem",
          padding: "1rem",
          border: "1px solid #555",
          borderRadius: "12px",
          background: "#111",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".75rem", flexWrap: "wrap" }}>
          <div>
            <strong style={{ color: estado === "inscripcion" ? "#86efac" : "#fca5a5" }}>
              {estado === "inscripcion" ? "INSCRIPCIONES ABIERTAS" : "INSCRIPCIONES CERRADAS"}
            </strong>
            <p style={{ color: "#ccc", margin: ".3rem 0 0", fontSize: ".82rem" }}>
              {estado === "inscripcion" ? "Los referentes habilitados pueden solicitar la participación de su club." : "Los referentes no pueden enviar nuevas solicitudes."}
            </p>
          </div>
          {canManage && (
            <button type="button" onClick={toggleRegistration} disabled={saving}
              style={{ border: "1px solid #fff", borderRadius: "8px", padding: ".7rem .9rem", background: estado === "inscripcion" ? "#3b1119" : "#166534", color: "#fff", fontWeight: 900, cursor: saving ? "wait" : "pointer" }}>
              {saving ? "GUARDANDO..." : estado === "inscripcion" ? "CERRAR INSCRIPCIONES" : "HABILITAR INSCRIPCIONES"}
            </button>
          )}
        </div>
        {message && <p role="status" style={{ color: "#fff", margin: ".75rem 0 0", padding: ".6rem", background: "#171c27", borderRadius: "7px" }}>{message}</p>}
      </section>

      <section
        style={{
          padding: "1rem",
          border: "1px solid rgba(181,18,42,.75)",
          borderRadius: "12px",
          background: "#0b0b0b",
        }}
      >
        <h2 style={{ margin: "0 0 .85rem", color: "#fff", fontSize: "1.05rem" }}>
          CATEGORÍAS DEL TORNEO
        </h2>
        {clubsError && <p role="alert" style={{ color: "#fca5a5", fontSize: ".8rem" }}>No se pudieron mostrar los clubes: {clubsError}</p>}
        {categories.length ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: ".65rem" }}>
            {categories.map((category) => (
              <article
                key={category}
                style={{
                  padding: ".9rem .65rem",
                  textAlign: "center",
                  borderRadius: "9px",
                  border: "1px solid #b5122a",
                  background: "#171c27",
                  minWidth: 0,
                }}
              >
                <span style={{ display: "block", color: "#f3a0ad", fontSize: ".68rem", fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", marginBottom: ".4rem" }}>
                  {tournamentTitle}
                </span>
                <strong style={{ display: "block", color: "#fff", fontSize: "1rem" }}>
                  Categoría {category}
                </strong>
                <span style={{ display: "block", color: "#d1d5db", fontSize: ".7rem", marginTop: ".35rem" }}>
                  {branch} · {turno}
                </span>
                <div style={{ display: "grid", gap: ".35rem", marginTop: ".55rem" }}>
                  {loadingClubs ? (
                    <span style={{ color: "#d1d5db", fontSize: ".72rem" }}>Cargando clubes...</span>
                  ) : (clubsByCategory[categoryRows.find((item) => normalizeCategoryName(item.nombre) === normalizeCategoryName(category))?.id] || []).length ? (
                    (clubsByCategory[categoryRows.find((item) => normalizeCategoryName(item.nombre) === normalizeCategoryName(category))?.id] || []).map((club) => (
                      <div key={club.id} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: ".4rem", padding: ".4rem", borderRadius: "7px", background: "#0b0b0b", border: "1px solid #555" }}>
                        {club.logo_path ? (
                          <img src={supabase.storage.from("fefutin-clubs").getPublicUrl(club.logo_path).data.publicUrl} alt="" style={{ width: "25px", height: "25px", objectFit: "contain", borderRadius: "4px", background: "#fff", flexShrink: 0 }} />
                        ) : null}
                        <strong style={{ color: "#fff", fontSize: ".76rem", overflowWrap: "anywhere" }}>{club.name}</strong>
                      </div>
                    ))
                  ) : (
                    <span style={{ color: "#f3a0ad", fontSize: ".72rem" }}>Sin clubes inscriptos</span>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p style={{ color: "#f3a0ad" }}>
            El torneo se creó, pero todavía no se pudieron cargar sus categorías.
          </p>
        )}
      </section>

      <section
        style={{
          marginTop: "1rem",
          padding: "1rem",
          border: "1px solid #555",
          borderRadius: "12px",
          background: "#111",
        }}
      >
        <h2 style={{ margin: "0 0 .45rem", color: "#fff", fontSize: "1.05rem" }}>
          TABLA GENERAL · {branch.toLocaleUpperCase("es")} · {turno.toLocaleUpperCase("es")}
        </h2>
        <p style={{ margin: 0, color: "#c8c8ce", lineHeight: 1.5, fontSize: ".88rem" }}>
          La tabla general se conectará cuando estén definidos y conectados los resultados de cada categoría. No se sumarán puntos hasta establecer esa regla.
        </p>
      </section>
    </main>
  );
}

export default FefutinNormalizedTournament;
