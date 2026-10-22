import "./index.css";
import "./tc-icons.css";

import React from "react";
import ReactDOM from "react-dom/client";
import TournamenSportApp from "./App.jsx";
import DemoApp from "./DemoApp.jsx";

const hasSupabaseConfig =
  Boolean(import.meta.env.VITE_SUPABASE_URL) &&
  Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY);

function SetupRequired() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px", background: "radial-gradient(circle at top, #123b35, #071321 65%)", color: "#f8fafc", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ width: "min(100%, 620px)", padding: "clamp(24px, 5vw, 44px)", border: "1px solid rgba(134,239,172,.35)", borderRadius: "22px", background: "rgba(5, 18, 29, .94)", boxShadow: "0 24px 70px rgba(0,0,0,.4)" }}>
        <div style={{ color: "#86efac", fontSize: "12px", fontWeight: 900, letterSpacing: ".2em" }}>CONFIGURACIÓN INICIAL</div>
        <h1 style={{ fontSize: "clamp(30px, 7vw, 48px)", margin: "12px 0", lineHeight: 1 }}>TournamenSport</h1>
        <p style={{ color: "#cbd5e1", lineHeight: 1.7 }}>La copia independiente ya está preparada. Para activar la aplicación, conectá un proyecto Supabase exclusivo para TournamenSport; así los usuarios y torneos de TournamentClash quedan separados.</p>
        <ol style={{ color: "#e2e8f0", lineHeight: 1.9, paddingLeft: "22px" }}>
          <li>Creá un proyecto nuevo en Supabase.</li>
          <li>Configurá <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code> en tu entorno local o en Netlify.</li>
          <li>Creá en ese proyecto las tablas, políticas RLS y funciones requeridas por la aplicación.</li>
          <li>Volvé a compilar y desplegar.</li>
        </ol>
        <p style={{ color: "#94a3b8", fontSize: "13px" }}>No pegues aquí claves service_role ni reutilices las credenciales de TournamentClash.</p>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {hasSupabaseConfig ? <TournamenSportApp /> : <DemoApp />}
  </React.StrictMode>
);
