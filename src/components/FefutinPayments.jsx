import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

const money = (value) => new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
}).format(Number(value || 0));

const statusLabel = {
  pendiente: "Pendiente de pago",
  pagado: "Pagado",
  exonerado: "Exonerado",
  anulado: "Anulado",
  pending: "En proceso",
  approved: "Acreditado",
  rejected: "Rechazado",
  cancelled: "Cancelado",
  refunded: "Reintegrado",
};

export function FefutinPayments({ currentUser, onBack }) {
  const [charges, setCharges] = useState([]);
  const [payments, setPayments] = useState([]);
  const [concept, setConcept] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const isAdminOrDirectivo = ["admin", "directivo"].includes(currentUser?.role);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const [chargeResult, paymentResult, conceptResult] = await Promise.all([
      supabase
        .from("fefutin_player_charges")
        .select(`
          id, club_id, amount, currency, status, created_at, paid_at, concept_name,
          player:fefutin_club_roster_players!inner(first_name,last_name,approval_status,
            roster:fefutin_club_rosters(category_label)),
          club:fefutin_clubs!inner(name)
        `)
        .order("created_at", { ascending: false }),
      supabase
        .from("fefutin_payments")
        .select("id,amount,currency,status,initiated_at,paid_at")
        .order("initiated_at", { ascending: false })
        .limit(12),
      supabase
        .from("fefutin_payment_concepts")
        .select("name,amount,currency")
        .eq("code", "FICHAJE_JUGADOR")
        .maybeSingle(),
    ]);

    if (chargeResult.error) {
      setError(chargeResult.error.message || "No se pudieron consultar los cargos.");
      setCharges([]);
    } else {
      setCharges(chargeResult.data || []);
    }
    if (!paymentResult.error) setPayments(paymentResult.data || []);
    if (!conceptResult.error) setConcept(conceptResult.data || null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    const pending = charges.filter((item) => item.status === "pendiente");
    const paid = charges.filter((item) => item.status === "pagado");
    const exceptional = charges.filter((item) => item.status === "exonerado");
    return {
      players: charges.length,
      pendingCount: pending.length,
      pendingAmount: pending.reduce((sum, item) => sum + Number(item.amount || 0), 0),
      paidCount: paid.length,
      paidAmount: paid.reduce((sum, item) => sum + Number(item.amount || 0), 0),
      exceptionalCount: exceptional.length,
    };
  }, [charges]);

  const card = {
    background: "#171C27",
    border: "1px solid #343c4b",
    borderRadius: 14,
    padding: "1rem",
    color: "#fff",
    minWidth: 0,
  };

  return (
    <main style={{ width: "100%", maxWidth: 1100, margin: "0 auto", padding: "1rem", color: "#fff", fontFamily: "'Montserrat', sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <div>
          <div style={{ color: "#f2a0ad", fontSize: ".72rem", fontWeight: 900, letterSpacing: ".13em" }}>GESTIÓN ECONÓMICA FEFUTIN</div>
          <h1 style={{ margin: ".25rem 0 0", fontSize: "clamp(1.35rem,4vw,2rem)", color: "#fff" }}>Pagos y compras</h1>
          <p style={{ margin: ".35rem 0 0", color: "#c4cad4", fontSize: ".88rem" }}>
            {isAdminOrDirectivo ? "Resumen general de cargos, pagos y deudas de los clubes." : "Estado de fichajes y deudas de tu club."}
          </p>
        </div>
        <div style={{ display: "flex", gap: ".5rem" }}>
          <button type="button" onClick={load} disabled={loading} style={{ border: "1px solid #626b7b", borderRadius: 9, background: "#222b39", color: "#fff", padding: ".65rem .8rem", fontWeight: 800 }}>
            {loading ? "Actualizando…" : "Actualizar"}
          </button>
          <button type="button" onClick={onBack} style={{ border: "1px solid #b5122a", borderRadius: 9, background: "#b5122a", color: "#fff", padding: ".65rem .8rem", fontWeight: 900 }}>
            Volver
          </button>
        </div>
      </div>

      {error && <div role="alert" style={{ ...card, borderColor: "#b5122a", color: "#ffd5dc", marginBottom: "1rem" }}>{error}</div>}

      <section style={{ ...card, marginBottom: "1rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "#c4cad4", fontSize: ".75rem", fontWeight: 800, letterSpacing: ".08em" }}>VALOR ACTUAL DEL FICHAJE</div>
          <div style={{ color: "#fff", fontSize: "1.65rem", fontWeight: 900, marginTop: ".25rem" }}>{money(concept?.amount ?? 20000)}</div>
          <div style={{ color: "#aeb7c5", fontSize: ".78rem" }}>Por jugador · el valor queda guardado en cada cargo</div>
        </div>
        <div style={{ background: "#252f3e", borderRadius: 10, padding: ".7rem .9rem", color: "#f4c5cc", fontSize: ".8rem", fontWeight: 800 }}>
          {concept?.name || "Fichaje de jugador"}
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: ".7rem", marginBottom: "1rem" }}>
        {[
          ["Jugadores con cargo", totals.players, "#fff"],
          ["Deuda pendiente", money(totals.pendingAmount), "#ffd1d8"],
          ["Cargos pendientes", totals.pendingCount, "#ffd1d8"],
          ["Total cobrado", money(totals.paidAmount), "#b7f0cf"],
          ["Fichajes pagados", totals.paidCount, "#b7f0cf"],
          ["Excepciones / exonerados", totals.exceptionalCount, "#f6d58b"],
        ].map(([label, value, color]) => (
          <div key={label} style={{ ...card, padding: ".85rem" }}>
            <div style={{ color: "#b9c1ce", fontSize: ".7rem", fontWeight: 800, minHeight: "2rem" }}>{label}</div>
            <div style={{ color, fontSize: "1.2rem", fontWeight: 900, overflowWrap: "anywhere" }}>{value}</div>
          </div>
        ))}
      </section>

      <section style={{ ...card, marginBottom: "1rem" }}>
        <h2 style={{ margin: "0 0 .8rem", fontSize: "1.05rem" }}>Fichajes y deudas por jugador</h2>
        {loading ? (
          <p style={{ color: "#c4cad4" }}>Cargando cargos…</p>
        ) : charges.length === 0 ? (
          <div style={{ border: "1px dashed #566174", borderRadius: 10, padding: "1rem", color: "#c4cad4", textAlign: "center" }}>
            Todavía no hay jugadores registrados con cargos de fichaje. Cada nueva alta generará automáticamente un cargo de {money(concept?.amount ?? 20000)}.
          </div>
        ) : (
          <div style={{ display: "grid", gap: ".65rem" }}>
            {charges.map((charge) => {
              const player = Array.isArray(charge.player) ? charge.player[0] : charge.player;
              const club = Array.isArray(charge.club) ? charge.club[0] : charge.club;
              const roster = Array.isArray(player?.roster) ? player.roster[0] : player?.roster;
              const paid = charge.status === "pagado";
              return (
                <article key={charge.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: ".5rem .8rem", alignItems: "center", padding: ".8rem", borderRadius: 10, background: "#202938", border: "1px solid #394456" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: "#fff", fontWeight: 900, overflowWrap: "anywhere" }}>{player?.last_name || ""}, {player?.first_name || "Jugador"}</div>
                    <div style={{ color: "#bdc6d3", fontSize: ".76rem", marginTop: ".2rem" }}>{club?.name || "Club"} · {roster?.category_label || "Categoría sin dato"}</div>
                    <div style={{ color: "#9faabc", fontSize: ".72rem", marginTop: ".2rem" }}>Alta: {new Date(charge.created_at).toLocaleDateString("es-AR")}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: "#fff", fontWeight: 900 }}>{money(charge.amount)}</div>
                    <span style={{ display: "inline-block", marginTop: ".3rem", borderRadius: 20, padding: ".25rem .5rem", fontSize: ".66rem", fontWeight: 900, color: paid ? "#b7f0cf" : charge.status === "exonerado" ? "#f6d58b" : "#ffd1d8", background: paid ? "#173b2c" : charge.status === "exonerado" ? "#493a1b" : "#48212a" }}>
                      {statusLabel[charge.status] || charge.status}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: ".8rem" }}>
        <div style={card}>
          <h2 style={{ margin: "0 0 .45rem", fontSize: "1rem" }}>Mercado Pago</h2>
          <p style={{ color: "#c4cad4", fontSize: ".82rem", lineHeight: 1.5, margin: 0 }}>
            La conexión de cobro online se habilitará cuando configuremos las credenciales privadas y la notificación segura de Mercado Pago. Ningún pago se marcará como acreditado solo por volver desde la página de pago.
          </p>
        </div>
        <div style={card}>
          <h2 style={{ margin: "0 0 .45rem", fontSize: "1rem" }}>Material oficial</h2>
          <p style={{ color: "#c4cad4", fontSize: ".82rem", lineHeight: 1.5, margin: 0 }}>
            El catálogo de productos y sus precios se incorporará en la siguiente etapa, usando esta misma sección y el registro de pagos.
          </p>
        </div>
      </section>

      {payments.length > 0 && (
        <section style={{ ...card, marginTop: "1rem" }}>
          <h2 style={{ margin: "0 0 .7rem", fontSize: "1rem" }}>Últimos movimientos de pago</h2>
          <div style={{ display: "grid", gap: ".5rem" }}>
            {payments.map((payment) => (
              <div key={payment.id} style={{ display: "flex", justifyContent: "space-between", gap: ".75rem", padding: ".65rem 0", borderBottom: "1px solid #394456", color: "#d8dee8", fontSize: ".82rem" }}>
                <span>{new Date(payment.initiated_at).toLocaleDateString("es-AR")} · {statusLabel[payment.status] || payment.status}</span>
                <strong>{money(payment.amount)}</strong>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
