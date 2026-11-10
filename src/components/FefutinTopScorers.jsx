import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

export function FefutinTopScorers({ tournament, onBack }) {
  const [scorers, setScorers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const loadScorers = async () => {
      setLoading(true);
      setError("");
      try {
        if (!supabase) throw new Error("No hay conexión con Supabase configurada.");
        const { data, error: queryError } = await supabase.rpc(
          "get_fefutin_tournament_top_scorers",
          { p_tournament_id: tournament.id }
        );
        if (queryError) throw queryError;
        if (!cancelled) setScorers(data || []);
      } catch (err) {
        console.error("Error al cargar la tabla de goleadores:", err);
        if (!cancelled) setError(err.message || "No se pudo cargar la tabla de goleadores.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    if (tournament?.id) loadScorers();
    return () => { cancelled = true; };
  }, [tournament?.id]);

  return (
    <section style={{ width: "100%", maxWidth: "900px", margin: "0 auto", padding: "1rem", boxSizing: "border-box", color: "#fff" }}>
      <div style={{ background: "#080808", border: "1px solid #b5122a", borderRadius: "12px", padding: "1rem", boxSizing: "border-box" }}>
        <div style={{ borderBottom: "1px solid rgba(181,18,42,.75)", paddingBottom: ".8rem", marginBottom: ".8rem" }}>
          <div style={{ color: "#b5122a", fontSize: ".72rem", fontWeight: 900, letterSpacing: ".12em" }}>FEFUTIN · ESTADÍSTICAS</div>
          <h2 style={{ margin: ".35rem 0", color: "#fff", fontSize: "1.25rem" }}>TABLA DE GOLEADORES</h2>
          <p style={{ margin: 0, color: "#d1d5db", fontSize: ".9rem" }}>{tournament?.title || "Torneo"}</p>
          <p style={{ margin: ".35rem 0 0", color: "#9ca3af", fontSize: ".78rem" }}>Goles contabilizados únicamente en planillas cerradas.</p>
        </div>

        {loading ? (
          <p style={{ color: "#d1d5db", textAlign: "center" }}>Cargando goleadores...</p>
        ) : error ? (
          <p role="alert" style={{ color: "#fca5a5", textAlign: "center" }}>{error}</p>
        ) : scorers.length === 0 ? (
          <p style={{ color: "#d1d5db", textAlign: "center", padding: "1rem .25rem" }}>Todavía no hay goles registrados en planillas cerradas de este torneo.</p>
        ) : (
          <div style={{ display: "grid", gap: ".45rem" }}>
            <div style={{ display: "grid", gridTemplateColumns: "34px minmax(0,1fr) 58px", gap: ".55rem", padding: ".45rem .6rem", color: "#9ca3af", fontSize: ".7rem", fontWeight: 900, letterSpacing: ".06em" }}>
              <span>#</span><span>JUGADOR · CLUB</span><span style={{ textAlign: "center" }}>GOLES</span>
            </div>
            {scorers.map((item, index) => (
              <div key={item.player_id + "-" + item.club} style={{ display: "grid", gridTemplateColumns: "34px minmax(0,1fr) 58px", alignItems: "center", gap: ".55rem", padding: ".7rem .6rem", background: "#171c27", border: "1px solid rgba(181,18,42,.55)", borderRadius: "8px" }}>
                <strong style={{ color: "#fff", textAlign: "center" }}>{index + 1}</strong>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ display: "block", color: "#fff", fontSize: ".9rem", overflowWrap: "anywhere" }}>{item.jugador || "Jugador"}</strong>
                  <span style={{ display: "block", color: "#d1d5db", fontSize: ".78rem", marginTop: ".15rem", overflowWrap: "anywhere" }}>{item.club || "Sin club"}</span>
                </div>
                <strong style={{ color: "#fff", textAlign: "center", fontSize: "1.1rem" }}>{item.goles}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: ".9rem" }}>
        <button type="button" className="tc-form-back" onClick={onBack}>← Volver al torneo</button>
      </div>
    </section>
  );
}
