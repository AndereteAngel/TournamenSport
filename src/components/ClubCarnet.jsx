import { supabase } from "../supabaseClient";

export function ClubCarnet({ club }) {
  const logoUrl = club?.logo_path
    ? supabase.storage.from("fefutin-clubs").getPublicUrl(club.logo_path).data.publicUrl
    : "";

  if (!club) return null;

  return (
    <div style={{ width: "100%", maxWidth: "680px", margin: "1.25rem auto" }}>
      <article style={{ overflow: "hidden", border: "2px solid #b5122a", borderRadius: "18px", background: "linear-gradient(135deg,#292929 0%,#111 58%,#080808 100%)", color: "#fff", boxShadow: "0 12px 30px rgba(0,0,0,.35)" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".8rem", padding: ".9rem 1rem", background: "#b5122a" }}>
          <div>
            <p style={{ margin: 0, color: "#fff", fontWeight: 900, letterSpacing: ".12em" }}>FEFUTIN</p>
            <p style={{ margin: ".2rem 0 0", color: "#fff", fontSize: ".65rem", fontWeight: 800, letterSpacing: ".06em" }}>FEDERACIÓN DE FÚTBOL INFANTIL</p>
          </div>
          <img src="https://fefutin.wordpress.com/wp-content/uploads/2017/03/fefutin-logo-grande1.png?h=184&w=166" alt="Logo oficial de FEFUTIN" style={{ width: "54px", height: "54px", objectFit: "contain", padding: "3px", boxSizing: "border-box", background: "#fff", borderRadius: "8px" }} />
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "clamp(105px,28%,160px) minmax(0,1fr)", gap: "clamp(.8rem,3vw,1.2rem)", alignItems: "center", padding: "clamp(.9rem,3vw,1.3rem)" }}>
          <div style={{ aspectRatio: "1", display: "grid", placeItems: "center", overflow: "hidden", border: "2px solid #b5122a", borderRadius: "12px", background: "#fff" }}>
            {logoUrl ? <img src={logoUrl} alt={"Escudo de " + club.club_name} style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <span style={{ color: "#171c27", fontWeight: 900, fontSize: ".7rem" }}>SIN ESCUDO</span>}
          </div>
          <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
            <p style={{ margin: "0 0 .35rem", color: "#e7a0aa", fontSize: ".65rem", fontWeight: 900, letterSpacing: ".1em" }}>CREDENCIAL INSTITUCIONAL</p>
            <h3 style={{ margin: "0 0 .9rem", color: "#fff", fontSize: "clamp(1.05rem,4vw,1.4rem)", lineHeight: 1.2 }}>{club.club_name}</h3>
            <div style={{ borderBottom: "1px solid #454545", paddingBottom: ".55rem", marginBottom: ".55rem" }}>
              <p style={{ margin: 0, color: "#aaa", fontSize: ".62rem", fontWeight: 800, letterSpacing: ".08em" }}>NÚMERO DE AFILIACIÓN FEFUTIN</p>
              <p style={{ margin: ".2rem 0 0", color: "#fff", fontSize: "1.15rem", fontWeight: 900, letterSpacing: ".06em" }}>{club.affiliate_number || "PENDIENTE DE ASIGNACIÓN"}</p>
            </div>
            <p style={{ margin: 0, color: "#aaa", fontSize: ".62rem", fontWeight: 800, letterSpacing: ".08em" }}>DOMICILIO INSTITUCIONAL</p>
            <p style={{ margin: ".2rem 0 0", color: "#fff", fontSize: ".85rem", lineHeight: 1.4 }}>{club.headquarters_address || "Sin domicilio registrado"}</p>
          </div>
        </div>

        <footer style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".5rem", padding: ".65rem 1rem", borderTop: "1px solid #b5122a", background: "#090909" }}>
          <span style={{ color: "#ddd", fontSize: ".62rem", fontWeight: 800, letterSpacing: ".08em" }}>CLUB AFILIADO</span>
          <span style={{ color: "#e7a0aa", fontSize: ".6rem", fontWeight: 800 }}>CARNET DIGITAL · FEFUTIN</span>
        </footer>
      </article>
      <p style={{ color: "#aaa", fontSize: ".76rem", textAlign: "center", marginTop: ".8rem" }}>Credencial institucional del club registrada ante FEFUTIN.</p>
    </div>
  );
}

export default ClubCarnet;
