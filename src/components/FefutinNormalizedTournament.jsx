import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

export function FefutinNormalizedTournament({ tournament, onBack, canManage = false, onStatusChange }) {
  const [estado, setEstado] = useState(tournament?.estado || (tournament?.status === "Inscripciones" ? "inscripcion" : "cerrado"));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const categories = Array.isArray(tournament?.normalizedCategories)
    ? tournament.normalizedCategories
    : [];
  const branch = tournament?.normalizedBranchName || "FEFUTIN";
  const turno = tournament?.normalizedTurno || "Turno sin especificar";

  useEffect(() => {
    setEstado(tournament?.estado || (tournament?.status === "Inscripciones" ? "inscripcion" : "cerrado"));
    setMessage("");
  }, [tournament?.id, tournament?.estado, tournament?.status]);

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
          {tournament?.title || "Torneo FEFUTIN"}
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
        {categories.length ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(125px, 1fr))", gap: ".65rem" }}>
            {categories.map((category) => (
              <article
                key={category}
                style={{
                  padding: ".9rem .65rem",
                  textAlign: "center",
                  borderRadius: "9px",
                  border: "1px solid #b5122a",
                  background: "#171c27",
                }}
              >
                <strong style={{ display: "block", color: "#fff", fontSize: "1rem" }}>
                  Categoría {category}
                </strong>
                <span style={{ display: "block", color: "#f3a0ad", fontSize: ".72rem", marginTop: ".35rem" }}>
                  Competencia creada
                </span>
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
