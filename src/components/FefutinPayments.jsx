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
  const [selectedChargeIds, setSelectedChargeIds] = useState([]);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");

  const isAdminOrDirectivo = ["admin", "directivo"].includes(currentUser?.role);
  const isReferente = currentUser?.role === "referente";

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
      const pendingIds = new Set((chargeResult.data || []).filter((item) => item.status === "pendiente").map((item) => item.id));
      setSelectedChargeIds((current) => current.filter((id) => pendingIds.has(id)));
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

  const pendingCharges = useMemo(
    () => charges.filter((item) => item.status === "pendiente"),
    [charges]
  );
  const selectedAmount = useMemo(
    () => pendingCharges.filter((item) => selectedChargeIds.includes(item.id))
      .reduce((sum, item) => sum + Number(item.amount || 0), 0),
    [pendingCharges, selectedChargeIds]
  );

  const toggleCharge = (chargeId) => {
    setSelectedChargeIds((current) => current.includes(chargeId)
      ? current.filter((id) => id !== chargeId)
      : [...current, chargeId]);
  };

  const toggleAllPending = () => {
    const allSelected = pendingCharges.length > 0
      && pendingCharges.every((item) => selectedChargeIds.includes(item.id));
    setSelectedChargeIds(allSelected ? [] : pendingCharges.map((item) => item.id));
  };

  const startCheckout = async () => {
    if (!isReferente || selectedChargeIds.length === 0 || checkoutLoading) return;
    setCheckoutLoading(true);
    setCheckoutError("");
    const { data, error: invokeError } = await supabase.functions.invoke("create-fefutin-payment", {
      body: { charge_ids: selectedChargeIds },
    });
    if (invokeError || !data?.checkout_url) {
      setCheckoutError(data?.error || invokeError?.message || "No se pudo iniciar el pago. Intentá nuevamente.");
      setCheckoutLoading(false);
      return;
    }
    window.location.assign(data.checkout_url);
  };

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

      {isReferente && pendingCharges.length > 0 && (
        <section style={{ ...card, marginBottom: "1rem", border: "1px solid #b5122a" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".75rem", flexWrap: "wrap" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "1rem" }}>Pagar fichajes pendientes</h2>
              <p style={{ margin: ".3rem 0 0", color: "#c4cad4", fontSize: ".78rem" }}>
                Seleccioná uno o varios jugadores para pagar juntos con Mercado Pago
              </p>
            </div>
            <button type="button" onClick={toggleAllPending} disabled={checkoutLoading}
              style={{ border: "1px solid #697386", borderRadius: 8, background: "#263244", color: "#fff", padding: ".55rem .7rem", fontWeight: 800, fontSize: ".75rem" }}>
              {pendingCharges.every((item) => selectedChargeIds.includes(item.id)) ? "Quitar selección" : "Seleccionar todos"}
            </button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".75rem", flexWrap: "wrap", marginTop: ".9rem" }}>
            <div>
              <div style={{ color: "#b9c1ce", fontSize: ".7rem", fontWeight: 800 }}>SELECCIONADOS: {selectedChargeIds.length}</div>
              <strong style={{ color: "#ffd1d8", fontSize: "1.25rem" }}>{money(selectedAmount)}</strong>
            </div>
            <button type="button" onClick={startCheckout} disabled={checkoutLoading || selectedChargeIds.length === 0}
              style={{ border: 0, borderRadius: 9, background: checkoutLoading || selectedChargeIds.length === 0 ? "#596273" : "#009ee3", color: "#fff", padding: ".8rem 1rem", fontWeight: 900, cursor: checkoutLoading || selectedChargeIds.length === 0 ? "not-allowed" : "pointer" }}>
              {checkoutLoading ? "Preparando pago…" : "PAGAR CON MERCADO PAGO"}
            </button>
          </div>
          {checkoutError && <p role="alert" style={{ color: "#ffd1d8", background: "#48212a", borderRadius: 8, padding: ".65rem", margin: ".8rem 0 0", fontSize: ".8rem" }}>{checkoutError}</p>}
          <p style={{ color: "#aeb7c5", fontSize: ".7rem", margin: ".65rem 0 0" }}>
            La deuda solo se marcará como pagada cuando Mercado Pago confirme la acreditación al servidor
          </p>
        </section>
      )}

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
                <article key={charge.id} style={{ display: "grid", gridTemplateColumns: isReferente && charge.status === "pendiente" ? "auto minmax(0,1fr) auto" : "minmax(0,1fr) auto", gap: ".5rem .8rem", alignItems: "center", padding: ".8rem", borderRadius: 10, background: "#202938", border: "1px solid #394456" }}>
                  {isReferente && charge.status === "pendiente" && (
                    <input
                      type="checkbox"
                      aria-label={`Seleccionar fichaje de ${player?.first_name || "jugador"} ${player?.last_name || ""}`}
                      checked={selectedChargeIds.includes(charge.id)}
                      onChange={() => toggleCharge(charge.id)}
                      disabled={checkoutLoading}
                      style={{ width: "20px", height: "20px", accentColor: "#b5122a" }}
                    />
                  )}
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
            Los pagos se realizan en el checkout seguro de Mercado Pago. La acreditación se confirma mediante una notificación firmada y una consulta de la orden en el servidor.
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

export function FefutinPaymentsHomeCard({ currentUser, onOpen }) {
  const [summary, setSummary] = useState({ count: 0, amount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: queryError } = await supabase
      .from("fefutin_player_charges")
      .select("id,amount,status");

    if (queryError) {
      setError("No se pudo consultar el estado de los pagos.");
      setSummary({ count: 0, amount: 0 });
    } else {
      const pending = (data || []).filter((charge) => charge.status === "pendiente");
      setSummary({
        count: pending.length,
        amount: pending.reduce((total, charge) => total + Number(charge.amount || 0), 0),
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSummary();
    const handleFocus = () => loadSummary();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [loadSummary]);

  return (
    <section aria-label="Acceso a pagos y compras" style={{
      width: "100%",
      maxWidth: "980px",
      margin: "0 auto 1rem",
      padding: "1rem",
      boxSizing: "border-box",
      border: "2px solid #b5122a",
      borderRadius: "14px",
      background: "linear-gradient(135deg, #202938 0%, #111722 100%)",
      color: "#fff",
      fontFamily: "'Montserrat', sans-serif",
      boxShadow: "0 8px 22px rgba(0,0,0,.22)",
    }}>
      <button type="button" onClick={onOpen} style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: ".85rem",
        width: "100%",
        padding: 0,
        border: 0,
        background: "transparent",
        color: "inherit",
        textAlign: "left",
        cursor: "pointer",
      }}>
        <span style={{ display: "flex", alignItems: "center", gap: ".8rem", minWidth: 0 }}>
          <span aria-hidden="true" style={{
            width: "44px", height: "44px", flex: "0 0 44px",
            display: "grid", placeItems: "center", borderRadius: "11px",
            background: "#b5122a", color: "#fff", fontSize: "1.35rem",
          }}>▣</span>
          <span style={{ minWidth: 0 }}>
            <strong style={{ display: "block", fontSize: "1rem", lineHeight: 1.25 }}>PAGOS Y COMPRAS</strong>
            <span style={{ display: "block", color: "#cbd5e1", fontSize: ".76rem", marginTop: ".2rem" }}>
              Fichajes, deudas y movimientos del club
            </span>
          </span>
        </span>
        <span aria-hidden="true" style={{ color: "#f3a0ad", fontSize: "1.5rem", fontWeight: 900 }}>›</span>
      </button>

      <div style={{
        marginTop: ".85rem",
        padding: ".75rem .85rem",
        borderRadius: "10px",
        background: error ? "#3b2028" : summary.count > 0 ? "#4a1d29" : "#202f3d",
        border: "1px solid " + (summary.count > 0 || error ? "#d64a61" : "#526174"),
      }}>
        {loading ? (
          <span style={{ color: "#e2e8f0", fontSize: ".8rem" }}>Consultando pagos pendientes…</span>
        ) : error ? (
          <span role="status" style={{ color: "#ffd1d8", fontSize: ".8rem", fontWeight: 700 }}>{error}</span>
        ) : summary.count > 0 ? (
          <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".7rem", flexWrap: "wrap" }}>
            <span style={{ color: "#fff", fontSize: ".82rem", fontWeight: 900 }}>
              ⚠ Tenés {summary.count} {summary.count === 1 ? "fichaje pendiente" : "fichajes pendientes"}. Entrá para revisar y gestionar el pago.
            </span>
            <strong style={{ color: "#fff", fontSize: "1rem", whiteSpace: "nowrap" }}>{money(summary.amount)}</strong>
          </span>
        ) : (
          <span style={{ color: "#cbd5e1", fontSize: ".8rem", fontWeight: 700 }}>
            No hay cargos pendientes de pago{currentUser?.role === "referente" ? " para tu club" : ""}.
          </span>
        )}
      </div>
    </section>
  );
}

