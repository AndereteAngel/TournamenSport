import { useState } from "react";
import "./demo.css";

const initialTournaments = [
  { id: 1, name: "Copa de Campeones", game: "Fútbol", format: "Liga", players: 8, status: "En curso", progress: 68, image: "https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=1000&q=85" },
  { id: 2, name: "Desafío de Amigos", game: "Fútbol", format: "Todos contra todos", players: 6, status: "Inscripciones", progress: 20, image: "https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=1000&q=85" },
  { id: 3, name: "Copa Relámpago", game: "Fútbol", format: "Eliminación", players: 16, status: "Finalizado", progress: 100, image: "https://images.unsplash.com/photo-1517466787929-bc90951d0974?auto=format&fit=crop&w=1000&q=85" },
];
const players = [
  { name: "Angel10", country: "🇦🇷", pts: 18, played: 7 },
  { name: "Futbolero23", country: "🇦🇷", pts: 15, played: 7 },
  { name: "MatiGol", country: "🇺🇾", pts: 12, played: 7 },
  { name: "LaBestia", country: "🇨🇱", pts: 9, played: 7 },
];
const matches = [
  { a: "Angel10", b: "MatiGol", score: "3 - 1", state: "Finalizado" },
  { a: "Futbolero23", b: "LaBestia", score: "2 - 2", state: "Finalizado" },
  { a: "Angel10", b: "Futbolero23", score: "— : —", state: "Próximo" },
];
export default function DemoApp() {
  const [section, setSection] = useState("Inicio");
  const [tournaments, setTournaments] = useState(initialTournaments);
  const [selected, setSelected] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [format, setFormat] = useState("Liga");
  const [notice, setNotice] = useState("");
  const active = tournaments.find(t => t.id === selected) || tournaments[0];
  const nav = ["Inicio", "Torneos", "Clasificación", "Partidos"];
  function createTournament(e) {
    e.preventDefault();
    if (!name.trim()) return;
    const item = { id: Date.now(), name: name.trim(), game: "Fútbol", format, players: 1, status: "Inscripciones", progress: 5, image: "https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=1000&q=85" };
    setTournaments(prev => [item, ...prev]);
    setSelected(item.id); setSection("Torneos"); setShowCreate(false); setName("");
    setNotice("Torneo de demostración creado. No se guardó en una base de datos.");
  }
  return <div className="sport-demo">
    <div className="demo-ribbon"><span>● MODO DEMOSTRACIÓN</span><span>Datos ficticios · No se guardan cambios</span></div>
    <header className="sport-header">
      <button className="sport-brand" onClick={() => setSection("Inicio")}><span className="brand-ball">TS</span><span>TOURNAMEN<span className="brand-accent">SPORT</span><small>COMPETÍ. JUGÁ. GANÁ.</small></span></button>
      <div className="demo-user"><span className="avatar">A</span><span><b>Angel10</b><small>Jugador de prueba</small></span></div>
    </header>
    <nav className="sport-nav">{nav.map(item => <button key={item} className={section === item ? "active" : ""} onClick={() => setSection(item)}>{item}</button>)}</nav>
    <main className="sport-main">
      {notice && <div className="demo-notice">{notice}<button onClick={() => setNotice("")}>×</button></div>}
      {section === "Inicio" && <>
        <section className="sport-hero"><div className="hero-copy"><span className="eyebrow">TU PRÓXIMO DESAFÍO EMPIEZA ACÁ</span><h1>EL JUEGO<br/>SE GANA <em>JUGANDO.</em></h1><p>Creá torneos, competí con amigos y seguí cada resultado en un solo lugar.</p><button className="primary-btn" onClick={() => setShowCreate(true)}>＋ CREAR TORNEO</button></div><div className="hero-art"><img src="https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=1100&q=90" alt="Estadio de fútbol iluminado"/><div className="hero-shade"/><div className="hero-tag">TU CANCHA. TUS REGLAS.</div></div></section>
        <div className="section-heading"><div><span className="eyebrow">CENTRO DE COMPETENCIA</span><h2>Tu actividad</h2></div><button className="text-btn" onClick={() => setSection("Torneos")}>Ver todos →</button></div>
        <div className="stat-grid"><div className="stat-card"><span>TORNEOS</span><b>{tournaments.length.toString().padStart(2,"0")}</b><small>En tu espacio</small></div><div className="stat-card"><span>EN CURSO</span><b>{tournaments.filter(t=>t.status==="En curso").length.toString().padStart(2,"0")}</b><small>Competencias activas</small></div><div className="stat-card"><span>PARTIDOS</span><b>07</b><small>Jugados en la demo</small></div><div className="stat-card"><span>POSICIÓN</span><b>#01</b><small>Clasificación de prueba</small></div></div>
        <div className="section-heading"><div><span className="eyebrow">ELEGÍ TU RETO</span><h2>Torneos destacados</h2></div><button className="text-btn" onClick={() => setSection("Torneos")}>Explorar →</button></div>
        <TournamentCards tournaments={tournaments.slice(0,3)} onSelect={t=>{setSelected(t.id);setSection("Torneos")}}/>
      </>}
      {section === "Torneos" && <><div className="page-heading"><span className="eyebrow">COMPETENCIAS</span><h1>Torneos</h1><p>Explorá competencias de ejemplo o creá la tuya.</p><button className="primary-btn" onClick={()=>setShowCreate(true)}>＋ CREAR TORNEO</button></div><TournamentCards tournaments={tournaments} onSelect={t=>setSelected(t.id)}/><section className="detail-panel"><div className="detail-title"><div><span className="eyebrow">DETALLE DEL TORNEO</span><h2>{active.name}</h2></div><span className="status-pill">{active.status}</span></div><div className="detail-meta"><span>⚽ {active.game}</span><span>♟ {active.players} participantes</span><span>▤ {active.format}</span></div><div className="progress-track"><span style={{width:active.progress+"%"}}/></div><small>{active.progress}% de progreso de ejemplo</small><h3>Tabla de posiciones</h3><Standings/></section></>}
      {section === "Clasificación" && <><div className="page-heading"><span className="eyebrow">RANKING DE LA COMPETENCIA</span><h1>Clasificación</h1><p>Los puntos y jugadores de esta tabla son ficticios.</p></div><Standings/></>}
      {section === "Partidos" && <><div className="page-heading"><span className="eyebrow">CALENDARIO</span><h1>Partidos</h1><p>Resultados de muestra para recorrer la experiencia.</p></div><div className="match-list">{matches.map((m,i)=><div className="match-row" key={i}><span className="match-state">{m.state}</span><b>{m.a}</b><strong>{m.score}</strong><b>{m.b}</b></div>)}</div></>}
    </main>
    <footer className="sport-footer"><span>TOURNAMENSPORT</span><span>Una nueva forma de vivir la competencia.</span><span>DEMO · 2026</span></footer>
    {showCreate && <div className="modal-backdrop" onClick={()=>setShowCreate(false)}><form className="create-modal" onSubmit={createTournament} onClick={e=>e.stopPropagation()}><button type="button" className="modal-close" onClick={()=>setShowCreate(false)}>×</button><span className="eyebrow">NUEVA COMPETENCIA</span><h2>Crear torneo</h2><label>Nombre del torneo<input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="Ej. Copa de los Amigos" maxLength={60} required/></label><label>Formato<select value={format} onChange={e=>setFormat(e.target.value)}><option>Liga</option><option>Todos contra todos</option><option>Eliminación</option></select></label><p>En esta demo, el torneo solo existe durante esta sesión.</p><button className="primary-btn" type="submit">CREAR TORNEO DE PRUEBA</button></form></div>}
  </div>;
}
function TournamentCards({tournaments,onSelect}) {
  return <div className="tournament-grid">{tournaments.map(t=><article className="tournament-card" key={t.id}><div className="tournament-photo"><img src={t.image} alt="Cancha de fútbol" loading="lazy"/><span className="status-pill">{t.status}</span></div><div className="tournament-info"><span className="eyebrow">{t.game} · {t.format}</span><h3>{t.name}</h3><div className="card-meta"><span>♟ {t.players} jugadores</span><span>{t.progress}% completado</span></div><div className="progress-track"><span style={{width:t.progress+"%"}}/></div><button className="outline-btn" onClick={()=>onSelect(t)}>VER TORNEO →</button></div></article>)}</div>;
}
function Standings() {
  return <div className="standings-wrap"><table className="standings-table"><thead><tr><th>#</th><th>Jugador</th><th>PJ</th><th>PTS</th></tr></thead><tbody>{players.map((p,i)=><tr key={p.name}><td><span className={i===0?"rank-first":"rank"}>{String(i+1).padStart(2,"0")}</span></td><td><span className="player-cell"><span>{p.country}</span><b>{p.name}</b></span></td><td>{p.played}</td><td><strong>{p.pts}</strong></td></tr>)}</tbody></table></div>;
}
