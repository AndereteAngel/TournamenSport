import {
  calculateGroupStandings,
  generatePlayoffBrackets,
} from "./utils/tournamentLogic";
import { Component, useEffect, useState } from "react";

import { CreateTournament } from "./components/CreateTournament";
import { GroupStageView } from "./components/GroupStageView";
import { Navbar } from "./components/Navbar";
import { RefereeCarnets } from "./components/RefereeCarnets";
import { TCIcon } from "./components/TCIcon";
import { TournamentNotice, useTournamentNotice } from "./components/TournamentNotice";
import { PlayoffBracket } from "./components/PlayoffBracket";
import { ChampionCelebration } from "./components/ChampionCelebration";
import { ReferenteInscripcion } from "./components/ReferenteInscripcion";
import { ReferenteEquipos } from "./components/ReferenteEquipos";
import { FefutinClubTournamentRequests, ReferenteTorneoSolicitudes } from "./components/FefutinClubTournamentRequests";
import { FefutinPlayerApprovals } from "./components/FefutinPlayerApprovals";
import { FefutinTopScorers } from "./components/FefutinTopScorers";
import { FefutinSheetArchive } from "./components/FefutinSheetArchive";
import { supabase } from "./supabaseClient";

// La categoría se guarda dentro de "game" al crear el torneo (ej.: "Fútbol · 2012").
// También leemos las columnas específicas si existen en torneos anteriores/nuevos.
const getTournamentCategory = (tournament) => {
  const explicitCategory = String(
    tournament?.category_detail || tournament?.category_type || ""
  ).trim();
  if (explicitCategory) return explicitCategory;

  const game = String(tournament?.game || "");
  const separatorIndex = game.lastIndexOf(" · ");
  if (separatorIndex >= 0) {
    const categoryFromGame = game.slice(separatorIndex + 3).trim();
    if (categoryFromGame) return categoryFromGame;
  }

  return "Sin categoría";
};

const getFefutinMatchDate = (round) => {
  const date = new Date(2026, 10, 21, 12, 0, 0);
  date.setDate(date.getDate() + (Math.max(1, Number(round) || 1) - 1) * 7);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const adminTournamentButtonStyle = {
  width: "auto",
  maxWidth: "fit-content",
  padding: "0.45rem 0.75rem",
  fontSize: "0.68rem",
  lineHeight: 1.2,
  borderWidth: "2px",
  borderBottomWidth: "3px",
  borderRadius: "8px",
  boxShadow: "0 3px 0 #422200, 0 5px 10px rgba(255,156,0,0.2)",
};


class RefereePreJornadaErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error("Error en Pre-jornada:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <main style={{ background:"#171c27", color:"#fff", border:"2px solid #b5122a", borderRadius:"12px", padding:"1rem", margin:"1rem auto", maxWidth:"900px" }}>
          <h2 style={{ color:"#fff" }}>ERROR EN PRE-JORNADA</h2>
          <p>La pantalla detectó un error y evitó quedar completamente negra.</p>
          <pre style={{ whiteSpace:"pre-wrap", overflowWrap:"anywhere", background:"#fff", color:"#171c27", padding:"1rem", borderRadius:"8px" }}>{String(this.state.error?.message || this.state.error)}</pre>
          <button type="button" onClick={this.props.onBack} style={{ background:"#fff", color:"#171c27", border:"1px solid #b5122a", borderRadius:"8px", padding:".7rem 1rem" }}>← Volver</button>
        </main>
      );
    }
    return this.props.children;
  }
}

function RefereePreJornada({ onBack }) {
  const [torneos, setTorneos] = useState([]);
  const [arbitros, setArbitros] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [ramaSeleccionada, setRamaSeleccionada] = useState("");
  const [competenciaKey, setCompetenciaKey] = useState("");
  const [categoriaSeleccionada, setCategoriaSeleccionada] = useState("Todas");
  const [partidoKey, setPartidoKey] = useState("");
  const [paginaPartidos, setPaginaPartidos] = useState(0);
  const [mensaje, setMensaje] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const [{ data: ts, error: te }, { data: ps, error: pe }] = await Promise.all([
          supabase.from("tournaments").select("*").order("title"),
          supabase.from("profiles").select("id, username, role, approval_status, deactivated_at").eq("role", "arbitro").order("username")
        ]);
        if (!activo) return;
        if (te || pe) setMensaje(te?.message || pe?.message || "No se pudieron cargar los datos.");
        setTorneos(ts || []);
        setArbitros((ps || []).filter(p => p.approval_status === "aprobado" && !p.deactivated_at));
      } catch (error) {
        if (!activo) return;
        setMensaje("Error al cargar Pre-jornada: " + String(error?.message || error));
      } finally {
        if (activo) setCargando(false);
      }
    })();
    return () => { activo = false; };
  }, []);

  const textoSeguro = valor => {
    if (valor == null) return "";
    if (typeof valor === "string" || typeof valor === "number") return String(valor);
    if (typeof valor === "object") {
      return String(valor.name || valor.nombre || valor.team_name || valor.teamName || valor.club_name || valor.club || valor.label || valor.title || "");
    }
    return "";
  };
  // Resolver la rama dentro de este componente: getTournamentDivision pertenece
  // al componente principal y no está disponible en este ámbito.
  const obtenerRama = torneo => {
    const partes = String(torneo?.game || "").split("·").map(p => p.trim());
    const explicita = partes.find(p => ["Infantil", "Femenino", "Mayores"].includes(p));
    if (explicita) return explicita;
    const referencia = (textoSeguro(getTournamentCategory(torneo)) + " " + String(torneo?.game || "")).toLocaleLowerCase("es");
    if (/femenin|mujer/.test(referencia)) return "Femenino";
    if (/mayor|adult|senior|primera/.test(referencia)) return "Mayores";
    return "Infantil";
  };
  const obtenerCategoria = torneo => textoSeguro(getTournamentCategory(torneo)) || "General";
  const ramas = [{ value:"Infantil", label:"Infantiles" }, { value:"Femenino", label:"Femenino" }, { value:"Mayores", label:"Mayores" }];
  const torneosRama = torneos.filter(t => obtenerRama(t).toLocaleLowerCase("es") === ramaSeleccionada.toLocaleLowerCase("es"));
  const claveCompetencia = t => String(t?.title || "").trim().toLocaleLowerCase("es") + "|" +
    String(t?.created_by_user_id || t?.created_by || "").trim().toLocaleLowerCase("es");
  const competencias = [...new Map(torneosRama.map(t => [claveCompetencia(t), {
    key: claveCompetencia(t),
    title: String(t.title || "Competencia sin nombre").trim(),
  }])).values()].sort((a,b) => a.title.localeCompare(b.title, "es"));
  const competencia = competencias.find(c => c.key === competenciaKey);
  const torneosCompetencia = competencia
    ? torneosRama.filter(t => claveCompetencia(t) === competencia.key)
    : [];
  const categorias = [...new Set(torneosCompetencia.map(obtenerCategoria))]
    .sort((a,b) => a.localeCompare(b, "es", { numeric:true }));
  const torneosFiltrados = categoriaSeleccionada === "Todas"
    ? torneosCompetencia
    : torneosCompetencia.filter(t => obtenerCategoria(t) === categoriaSeleccionada);

  const esPartidoValido = match => {
    const equipo1 = textoSeguro(match?.team1).trim();
    const equipo2 = textoSeguro(match?.team2).trim();
    return Boolean(equipo1 && equipo2) &&
      equipo1.toLocaleLowerCase("es") !== "pasaje directo" &&
      equipo2.toLocaleLowerCase("es") !== "pasaje directo";
  };

  // Una jornada agrupa el cruce entre dos clubes en todas las categorías
  // de la misma competencia. El filtro de categoría limita qué cruces se muestran,
  // pero la designación se aplica a todas las categorías de ese mismo cruce.
  const normalizarEquipo = valor => textoSeguro(valor).trim().toLocaleLowerCase("es")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const claveEnfrentamiento = match => [
    normalizarEquipo(match?.team1),
    normalizarEquipo(match?.team2),
  ].sort().join("::");

  const partidosDeCompetencia = torneosCompetencia.flatMap(torneo =>
    (Array.isArray(torneo?.groups) ? torneo.groups : []).flatMap((grupo, groupIndex) => {
      if (grupo?.name === "__INSCRIPCIONES__") return [];
      return (Array.isArray(grupo?.matches) ? grupo.matches : [])
        .map((match, matchIndex) => ({
          torneoId: torneo.id,
          grupoIndex: groupIndex,
          matchIndex,
          match,
          categoria: obtenerCategoria(torneo),
        }))
        .filter(item => esPartidoValido(item.match));
    })
  );

  const partidosPorEnfrentamiento = new Map();
  partidosDeCompetencia.forEach(item => {
    const key = claveEnfrentamiento(item.match);
    if (!partidosPorEnfrentamiento.has(key)) partidosPorEnfrentamiento.set(key, []);
    partidosPorEnfrentamiento.get(key).push(item);
  });

  const jornadasMap = new Map();
  torneosFiltrados.forEach(torneo => {
    (Array.isArray(torneo?.groups) ? torneo.groups : []).forEach(grupo => {
      if (grupo?.name === "__INSCRIPCIONES__") return;
      (Array.isArray(grupo?.matches) ? grupo.matches : []).forEach(match => {
        if (!esPartidoValido(match)) return;
        const key = claveEnfrentamiento(match);
        if (!key || jornadasMap.has(key)) return;
        const partidosJornada = partidosPorEnfrentamiento.get(key) || [];
        jornadasMap.set(key, {
          key,
          match,
          team1: textoSeguro(match.team1),
          team2: textoSeguro(match.team2),
          partidos: partidosJornada,
          categorias: [...new Set(partidosJornada.map(item => item.categoria))]
            .sort((a, b) => a.localeCompare(b, "es", { numeric: true })),
        });
      });
    });
  });
  const jornadas = [...jornadasMap.values()].sort((a, b) =>
    (a.team1 + " " + a.team2).localeCompare(b.team1 + " " + b.team2, "es")
  );
  const partidosPorPagina = 30;
  const inicio = paginaPartidos * partidosPorPagina;
  const partidosPagina = jornadas.slice(inicio, inicio + partidosPorPagina);
  const hayMasPartidos = jornadas.length > inicio + partidosPorPagina;
  const partido = partidosPagina.find(item => item.key === partidoKey);
  const idsArbitrosJornada = partido
    ? [...new Set(partido.partidos.map(item => item.match?.referee_id || ""))]
    : [];
  const refereeIdJornada = idsArbitrosJornada.length === 1 ? idsArbitrosJornada[0] : "";
  const designacionParcial = Boolean(partido && idsArbitrosJornada.length > 1);
  const arbitroAsignado = refereeIdJornada
    ? arbitros.find(a => a.id === refereeIdJornada)
    : null;

  const designarPartido = async refereeId => {
    if (!partido || guardando) return;
    setGuardando(true);
    setMensaje("");

    const actualizaciones = new Map();
    partido.partidos.forEach(item => {
      const torneo = torneos.find(t => t.id === item.torneoId);
      if (!torneo) return;
      if (!actualizaciones.has(torneo.id)) {
        actualizaciones.set(torneo.id, {
          torneo,
          grupos: (torneo.groups || []).map(grupo => ({
            ...grupo,
            matches: Array.isArray(grupo?.matches) ? [...grupo.matches] : [],
          })),
        });
      }
      const actualizacion = actualizaciones.get(torneo.id);
      const grupo = actualizacion.grupos[item.grupoIndex];
      if (!grupo?.matches?.[item.matchIndex]) return;
      grupo.matches[item.matchIndex] = {
        ...grupo.matches[item.matchIndex],
        referee_id: refereeId,
      };
    });

    if (!actualizaciones.size) {
      setGuardando(false);
      setMensaje("No se encontraron partidos para esta jornada.");
      return;
    }

    const resultados = await Promise.all([...actualizaciones.values()].map(({ torneo, grupos }) =>
      supabase.from("tournaments").update({ groups: grupos }).eq("id", torneo.id)
    ));
    const error = resultados.find(resultado => resultado.error)?.error;
    setGuardando(false);
    if (error) {
      setMensaje("No se pudo completar la designación de toda la jornada: " + error.message);
      return;
    }

    const gruposPorTorneo = new Map([...actualizaciones.entries()].map(([id, item]) => [id, item.grupos]));
    setTorneos(prev => prev.map(t => gruposPorTorneo.has(t.id)
      ? { ...t, groups: gruposPorTorneo.get(t.id) }
      : t
    ));
    setMensaje("Árbitro asignado a toda la jornada: " + partido.partidos.length +
      " partido(s) en " + partido.categorias.length + " categoría(s).");
  };

  const estilo = { background:"#171c27", color:"#fff", border:"1px solid #b5122a", borderRadius:"12px", padding:"1rem", width:"100%" };
  const selector = { background:"#fff", color:"#171c27", border:"1px solid #b5122a", borderRadius:"9px", padding:".7rem", width:"100%", marginTop:".5rem" };
  if (cargando) return <section style={{...estilo, textAlign:"center"}}><h2>PRE-JORNADA</h2><p>Cargando competencias y árbitros…</p></section>;

  return <main style={{maxWidth:"1000px", margin:"0 auto", paddingBottom:"2rem", color:"#fff"}}>
    <section style={{...estilo, marginBottom:"1rem"}}>
      <h2 style={{textAlign:"center", marginTop:0}}>PRE-JORNADA · DESIGNACIONES</h2>
      <label style={{display:"block", marginTop:".8rem"}}>1. Rama
        <select value={ramaSeleccionada} onChange={e=>{setRamaSeleccionada(e.target.value);setCompetenciaKey("");setCategoriaSeleccionada("Todas");setPartidoKey("");setPaginaPartidos(0);setMensaje("");}} style={selector}>
          <option value="">Elegí la rama</option>
          {ramas.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </label>
      {ramaSeleccionada && <label style={{display:"block", marginTop:".8rem"}}>2. Competencia
        <select value={competenciaKey} onChange={e=>{setCompetenciaKey(e.target.value);setCategoriaSeleccionada("Todas");setPartidoKey("");setPaginaPartidos(0);setMensaje("");}} style={selector}>
          <option value="">Elegí la competencia</option>
          {competencias.map(c=><option key={c.key} value={c.key}>{c.title}</option>)}
        </select>
      </label>}
      {competencia && <label style={{display:"block", marginTop:".8rem"}}>3. Categorías
        <select value={categoriaSeleccionada} onChange={e=>{setCategoriaSeleccionada(e.target.value);setPartidoKey("");setPaginaPartidos(0);setMensaje("");}} style={selector}>
          <option value="Todas">Todas las categorías</option>
          {categorias.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
      </label>}
    </section>

    {competencia && <>
      <h3 style={{margin:".5rem 0 1rem",textAlign:"center"}}>{competencia.title} · {ramaSeleccionada} · {categoriaSeleccionada === "Todas" ? "Todas las categorías" : categoriaSeleccionada}</h3>
      {!partidosPagina.length && paginaPartidos === 0 ? <p style={{...estilo,textAlign:"center"}}>Todavía no hay jornadas para esta selección.</p> :
        !partido ? <>
          <p style={{textAlign:"center",color:"#fff"}}>Jornadas desde la {paginaPartidos * partidosPorPagina + 1} · Página {paginaPartidos + 1} · Mostrando {partidosPagina.length} jornadas</p>
          <section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:".8rem"}}>
          {partidosPagina.map(item=><button key={item.key} type="button" onClick={()=>{setPartidoKey(item.key);setMensaje("");}} style={{...estilo,textAlign:"center",cursor:"pointer"}}>
            <span style={{display:"block",fontSize:".75rem",color:"#fca5a5",fontWeight:700,marginBottom:".45rem"}}>{item.categorias.join(" · ")}</span>
            <strong style={{fontSize:"1rem"}}>{item.team1} <span style={{color:"#fca5a5"}}>VS</span> {item.team2}</strong>
            <span style={{display:"block",fontSize:".82rem",marginTop:".55rem",color:"#d1d5db"}}>{item.partidos.length} partido(s) en esta jornada · Árbitro: {(() => { const ids = [...new Set(item.partidos.map(p => p.match?.referee_id || ""))]; return ids.length > 1 ? "Designación parcial" : (arbitros.find(a => a.id === ids[0])?.username || "Sin designar"); })()}</span>
            <span style={{display:"block",fontWeight:800,marginTop:".65rem",color:"#fff"}}>{(() => { const ids = [...new Set(item.partidos.map(p => String(p.match?.referee_id || "").trim()))]; const designada = ids.length === 1 && Boolean(ids[0]) && item.partidos.length > 0 && item.partidos.every(p => String(p.match?.referee_id || "").trim() === ids[0]); return designada ? "🔒 Jornada designada" : "Designar jornada completa →"; })()}</span>
          </button>)}
          </section>
          {(paginaPartidos > 0 || hayMasPartidos) && <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:".8rem",flexWrap:"wrap",marginTop:"1rem"}}>
            <button type="button" disabled={paginaPartidos===0} onClick={()=>setPaginaPartidos(p=>Math.max(0,p-1))} style={{background:"#fff",color:"#171c27",border:"1px solid #b5122a",borderRadius:"8px",padding:".7rem 1rem",fontWeight:700,opacity:paginaPartidos===0?.5:1}}>← Anterior</button>
            <span style={{color:"#fff"}}>Página {paginaPartidos+1}</span>
            <button type="button" disabled={!hayMasPartidos} onClick={()=>setPaginaPartidos(p=>p+1)} style={{background:"#fff",color:"#171c27",border:"1px solid #b5122a",borderRadius:"8px",padding:".7rem 1rem",fontWeight:700,opacity:!hayMasPartidos?.5:1}}>Siguiente →</button>
          </div>}
        </> :
        <section style={{display:"grid",gap:".85rem"}}>
          <button type="button" onClick={()=>{setPartidoKey("");setMensaje("");}} style={{justifySelf:"start",background:"transparent",color:"#fff",border:"1px solid #b5122a",borderRadius:"8px",padding:".55rem .8rem"}}>← Volver a los enfrentamientos</button>
          <section style={{...estilo,textAlign:"center"}}>
            <div style={{fontSize:".8rem",color:"#fca5a5",fontWeight:700,marginBottom:".5rem"}}>{competencia.title} · {partido.categorias.join(" · ")}</div>
            <h3 style={{margin:".2rem 0 1rem"}}>{partido.team1} <span style={{color:"#fca5a5"}}>VS</span> {partido.team2}</h3>
            <h4 style={{margin:"0 0 .5rem"}}>DESIGNAR ÁRBITRO PARA TODA LA JORNADA</h4>
            <p style={{fontSize:".85rem",color:"#d1d5db"}}>{arbitroAsignado ? "🔒 Jornada designada. La asignación queda bloqueada para directivos y administración: " + arbitroAsignado.username : (designacionParcial ? "La jornada tiene designaciones diferentes o incompletas. Elegí un árbitro para unificar todos sus partidos." : "Elegí un árbitro. Se asignará a todos los partidos de este cruce en las categorías de la competencia.")}</p>
            {arbitros.length ? <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(135px,1fr))",gap:".6rem"}}>
              {arbitros.map(arbitro=><button key={arbitro.id} type="button" disabled={guardando || Boolean(refereeIdJornada && !designacionParcial)} onClick={()=>designarPartido(arbitro.id)} style={{background:refereeIdJornada===arbitro.id && !designacionParcial?"#b5122a":"#fff",color:refereeIdJornada===arbitro.id && !designacionParcial?"#fff":"#171c27",border:"1px solid #b5122a",borderRadius:"9px",padding:".85rem",fontWeight:800,cursor:guardando || Boolean(refereeIdJornada && !designacionParcial)?"not-allowed":"pointer",opacity:guardando || Boolean(refereeIdJornada && !designacionParcial)?0.65:1}}>
                {guardando ? "Guardando…" : (refereeIdJornada && !designacionParcial ? (refereeIdJornada === arbitro.id ? "🔒 Jornada designada · " + arbitro.username : arbitro.username) : arbitro.username)}
              </button>)}
            </div> : <p>No hay árbitros aprobados y activos para designar.</p>}
          </section>
        </section>
      }
    </>}
    {mensaje && <p role="status" style={{color:"#fff",background:"#b5122a",padding:".75rem",borderRadius:"8px",marginTop:"1rem"}}>{mensaje}</p>}
    <button type="button" className="tc-form-back" onClick={onBack} style={{marginTop:"1.2rem"}}>← Volver</button>
  </main>;
}

function RefereeStats({ onBack, canManageAccess = false, onDeactivateReferee }) {
  const [perfiles, setPerfiles] = useState([]);
  const [carnets, setCarnets] = useState([]);
  const [fotosCarnets, setFotosCarnets] = useState({});
  const [torneos, setTorneos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [arbitroSeleccionado, setArbitroSeleccionado] = useState(null);
  const [arbitroDesignacionAbierto, setArbitroDesignacionAbierto] = useState(null);
  const [arbitroParaDesignar, setArbitroParaDesignar] = useState(null);
  const [mesCalendario, setMesCalendario] = useState(() => {
    const hoy = new Date();
    return new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  });
  const [diaCalendarioSeleccionado, setDiaCalendarioSeleccionado] = useState(null);
  const [partidoParaDesignar, setPartidoParaDesignar] = useState("");
  const [guardandoDesignacion, setGuardandoDesignacion] = useState(false);
  const [mensajeDesignacion, setMensajeDesignacion] = useState("");

  const cargarEstadisticas = async () => {
    setLoading(true);
    setError("");
    const [
      { data: perfilesData, error: perfilesError },
      { data: torneosData, error: torneosError },
      { data: carnetsData, error: carnetsError },
    ] = await Promise.all([
      supabase.from("profiles")
        .select("id, username, role, approval_status, deactivated_at")
        .order("username", { ascending: true }),
      supabase.from("tournaments").select("*"),
      supabase.rpc("get_fefutin_referee_carnets"),
    ]);

    if (perfilesError || torneosError) {
      console.error("Error al cargar estadísticas arbitrales:", { perfilesError, torneosError });
      setError(perfilesError
        ? "No se pudo cargar la lista de árbitros. Revisá los permisos de lectura de profiles en Supabase."
        : "No se pudieron cargar los torneos para calcular las estadísticas.");
      setLoading(false);
      return;
    }

    if (carnetsError) {
      console.warn("No se pudieron cargar los nombres de los carnets; se usará el nombre del perfil:", carnetsError);
    }
    setPerfiles(perfilesData || []);
    setCarnets(carnetsData || []);
    setTorneos(torneosData || []);
    setLoading(false);
  };

  useEffect(() => {
    cargarEstadisticas();
  }, []);

  useEffect(() => {
    let activo = true;
    const cargarFotosCarnets = async () => {
      const rutas = (carnets || []).filter((carnet) => carnet?.id && carnet?.photo_path);
      const entradas = await Promise.all(rutas.map(async (carnet) => {
        const { data, error } = await supabase.storage
          .from("fefutin-carnets")
          .createSignedUrl(carnet.photo_path, 300);
        return [carnet.id, error ? "" : data?.signedUrl || ""];
      }));
      if (activo) setFotosCarnets(Object.fromEntries(entradas));
    };
    cargarFotosCarnets();
    return () => { activo = false; };
  }, [carnets]);

  const estadisticasPorId = {};
  const registrarPartido = (match, tournament) => {
    const refereeId = match?.referee_id;
    const scoreLocal = Number(match?.score1);
    const scoreVisitante = Number(match?.score2);
    const team1 = String(match?.team1 || "").trim();
    const team2 = String(match?.team2 || "").trim();

    if (!refereeId ||
        match?.score1 === null || match?.score1 === undefined ||
        match?.score2 === null || match?.score2 === undefined ||
        !Number.isFinite(scoreLocal) || !Number.isFinite(scoreVisitante) ||
        !team1 || !team2 ||
        team1.toLocaleLowerCase("es") === "pasaje directo" ||
        team2.toLocaleLowerCase("es") === "pasaje directo") return;

    if (!estadisticasPorId[refereeId]) {
      const perfil = perfiles.find((item) => item.id === refereeId);
      const carnet = carnets.find((item) => item.id === refereeId);
      estadisticasPorId[refereeId] = {
        id: refereeId,
        nombre: [carnet?.first_name, carnet?.last_name].filter(Boolean).join(" ") || perfil?.username || carnet?.username || "Árbitro",
        partidos: 0,
        victoriasLocales: 0,
        victoriasVisitantes: 0,
        empates: 0,
        golesLocal: 0,
        golesVisitante: 0,
        golesTotales: 0,
        porRama: {},
      };
    }

    const stats = estadisticasPorId[refereeId];
    const rama = String(tournament?.game || "").split(" · ")[1] || "Sin rama";
    stats.partidos += 1;
    if (scoreLocal > scoreVisitante) stats.victoriasLocales += 1;
    else if (scoreVisitante > scoreLocal) stats.victoriasVisitantes += 1;
    else stats.empates += 1;
    stats.golesLocal += scoreLocal;
    stats.golesVisitante += scoreVisitante;
    stats.golesTotales += scoreLocal + scoreVisitante;
    stats.porRama[rama] = (stats.porRama[rama] || 0) + 1;
  };

  torneos.forEach((tournament) => {
    (Array.isArray(tournament.groups) ? tournament.groups : []).forEach((group) => {
      (Array.isArray(group?.matches) ? group.matches : []).forEach((match) => registrarPartido(match, tournament));
    });
    (Array.isArray(tournament.playoffs) ? tournament.playoffs : []).forEach((round) => {
      (Array.isArray(round) ? round : []).forEach((match) => registrarPartido(match, tournament));
    });
  });

  perfiles
    .filter((perfil) => perfil.role === "arbitro" && perfil.approval_status === "aprobado" && !perfil.deactivated_at)
    .forEach((perfil) => {
      if (!estadisticasPorId[perfil.id]) {
        const carnet = carnets.find((item) => item.id === perfil.id);
        estadisticasPorId[perfil.id] = {
          id: perfil.id,
          nombre: [carnet?.first_name, carnet?.last_name].filter(Boolean).join(" ") || perfil.username || carnet?.username || "Árbitro",
          partidos: 0,
          victoriasLocales: 0,
          victoriasVisitantes: 0,
          empates: 0,
          golesLocal: 0,
          golesVisitante: 0,
          golesTotales: 0,
          porRama: {},
        };
      }
    });

  const estadisticas = Object.values(estadisticasPorId)
    .sort((a, b) => b.partidos - a.partidos || a.nombre.localeCompare(b.nombre, "es"));
  const arbitroActual = estadisticas.find((item) => item.id === arbitroSeleccionado);

  const [detalleTarjetaArbitro, setDetalleTarjetaArbitro] = useState(null);
  const obtenerJornadasDeArbitro = (refereeId) => {
    const normalizarEquipo = (valor) => String(valor || "").trim().toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const obtenerRama = (tournament) => {
      const partes = String(tournament?.game || "").split("·").map((parte) => parte.trim());
      const ramaExplicita = partes.find((parte) => ["Infantil", "Femenino", "Mayores"].includes(parte));
      if (ramaExplicita) return ramaExplicita;
      const referencia = (String(tournament?.game || "") + " " + String(tournament?.category_detail || "")).toLocaleLowerCase("es");
      if (/femenin|mujer/.test(referencia)) return "Femenino";
      if (/mayor|adult|senior|primera/.test(referencia)) return "Mayores";
      return "Infantil";
    };
    const jornadas = new Map();
    const registrarPartido = (tournament, match, instancia, incluirTodasLasCategorias = false) => {
      const team1 = String(match?.team1 || "").trim();
      const team2 = String(match?.team2 || "").trim();
      if (!team1 || !team2 ||
          normalizarEquipo(team1) === "pasaje directo" || normalizarEquipo(team2) === "pasaje directo") return;
      const rama = obtenerRama(tournament);
      const propietario = String(tournament?.created_by_user_id || tournament?.created_by || "").trim().toLocaleLowerCase("es");
      const competencia = [String(tournament?.title || "Torneo sin nombre").trim().toLocaleLowerCase("es"), propietario, rama.toLocaleLowerCase("es")].join("|");
      const categoriaPartes = String(tournament?.game || "").split("·").map((parte) => parte.trim());
      const categoria = String(tournament?.category_detail || categoriaPartes[categoriaPartes.length - 1] || getTournamentCategory(tournament) || "Sin categoría").trim();
      const cruce = [normalizarEquipo(team1), normalizarEquipo(team2)].sort().join("::");
      // Primero se identifican las jornadas asignadas al árbitro; luego se completan
      // con los partidos de todas las categorías de ese mismo torneo y enfrentamiento.
      const key = competencia + "::" + cruce;
      if (!jornadas.has(key)) {
        if (!incluirTodasLasCategorias && match?.referee_id === refereeId) {
          jornadas.set(key, {
            key, torneo: tournament.title || "Torneo sin nombre", rama, propietario, etapa: "Jornada de competencia",
            team1, team2, team1Normalizado: normalizarEquipo(team1), team2Normalizado: normalizarEquipo(team2),
            partidos: 0, partidosJugados: 0, goles: 0, puntosTeam1: 0, puntosTeam2: 0,
            categoriasSet: new Set(), detallesPartidos: [],
          });
        } else {
          return;
        }
      }
      if (!incluirTodasLasCategorias && match?.referee_id !== refereeId) return;
      const jornada = jornadas.get(key);
      const score1 = Number(match?.score1);
      const score2 = Number(match?.score2);
      const resultadoCargado = match?.score1 != null && match?.score2 != null && Number.isFinite(score1) && Number.isFinite(score2);
      const puntosPartidoTeam1 = resultadoCargado ? (score1 > score2 ? 3 : score1 < score2 ? 1 : 2) : 0;
      const puntosPartidoTeam2 = resultadoCargado ? (score2 > score1 ? 3 : score2 < score1 ? 1 : 2) : 0;
      const mismoOrden = normalizarEquipo(team1) === jornada.team1Normalizado;
      const puntosTeam1 = mismoOrden ? puntosPartidoTeam1 : puntosPartidoTeam2;
      const puntosTeam2 = mismoOrden ? puntosPartidoTeam2 : puntosPartidoTeam1;
      const clave = String(tournament.id || tournament.title) + "::" + String(match.id || instancia + "::" + team1 + "::" + team2);
      if (jornada.detallesPartidos.some((partido) => partido.clave === clave)) return;
      jornada.partidos += 1;
      if (resultadoCargado) {
        jornada.partidosJugados += 1;
        jornada.goles += score1 + score2;
        jornada.puntosTeam1 += puntosTeam1;
        jornada.puntosTeam2 += puntosTeam2;
      }
      jornada.categoriasSet.add(categoria);
      jornada.detallesPartidos.push({
        clave, categoria, team1, team2, score1: resultadoCargado ? score1 : null, score2: resultadoCargado ? score2 : null,
        resultadoCargado, puntosTeam1, puntosTeam2, instancia,
        fechaOrden: match?.result_loaded_at ? new Date(match.result_loaded_at).getTime() : 0,
      });
    };
    const recorrerPartidos = (incluirTodasLasCategorias) => {
      torneos.forEach((tournament) => {
        (Array.isArray(tournament.groups) ? tournament.groups : []).forEach((group) => {
          if (group?.name === "__INSCRIPCIONES__") return;
          (Array.isArray(group?.matches) ? group.matches : []).forEach((match) => registrarPartido(tournament, match, group?.name || "Fase de grupos", incluirTodasLasCategorias));
        });
        (Array.isArray(tournament.playoffs) ? tournament.playoffs : []).forEach((round, roundIndex) => {
          (Array.isArray(round) ? round : []).forEach((match) => registrarPartido(tournament, match, "Eliminatorias · Ronda " + (roundIndex + 1), incluirTodasLasCategorias));
        });
      });
    };
    // Primera pasada: jornadas que efectivamente tiene designadas este árbitro.
    recorrerPartidos(false);
    // Segunda pasada: todas las categorías del mismo torneo y cruce, aunque el
    // partido todavía no tenga árbitro asignado o resultado cargado.
    recorrerPartidos(true);
    // La planilla debe listar TODAS las categorías de la competencia y rama,
    // incluso si en alguna categoría todavía no existe el cruce cargado.
    jornadas.forEach((jornada) => {
      torneos.forEach((tournament) => {
        const ramaTorneo = obtenerRama(tournament);
        const propietarioTorneo = String(tournament?.created_by_user_id || tournament?.created_by || "").trim().toLocaleLowerCase("es");
        const competenciaTorneo = [
          String(tournament?.title || "Torneo sin nombre").trim().toLocaleLowerCase("es"),
          propietarioTorneo,
          ramaTorneo.toLocaleLowerCase("es"),
        ].join("|");
        const competenciaJornada = [
          String(jornada.torneo || "Torneo sin nombre").trim().toLocaleLowerCase("es"),
          jornada.propietario,
          jornada.rama.toLocaleLowerCase("es"),
        ].join("|");
        if (competenciaTorneo !== competenciaJornada) return;
        const partesCategoria = String(tournament?.game || "").split("·").map((parte) => parte.trim());
        const categoria = String(tournament?.category_detail || tournament?.category_type || partesCategoria[partesCategoria.length - 1] || getTournamentCategory(tournament) || "Sin categoría").trim();
        if (!categoria || categoria === "Sin categoría" || jornada.categoriasSet.has(categoria)) return;
        jornada.categoriasSet.add(categoria);
        jornada.detallesPartidos.push({
          clave: String(tournament.id || tournament.title) + "::categoria-sin-cruce::" + categoria,
          categoria,
          team1: jornada.team1,
          team2: jornada.team2,
          score1: null,
          score2: null,
          resultadoCargado: false,
          puntosTeam1: 0,
          puntosTeam2: 0,
          instancia: "Pendiente de fixture",
          fechaOrden: 0,
        });
      });
    });
    return [...jornadas.values()].map((jornada) => ({
      ...jornada,
      categorias: [...jornada.categoriasSet].sort((a, b) => a.localeCompare(b, "es", { numeric: true })),
      detallesPartidos: jornada.detallesPartidos.sort((a, b) => a.categoria.localeCompare(b.categoria, "es", { numeric: true }) || a.instancia.localeCompare(b.instancia, "es")),
    })).sort((a, b) => a.team1.localeCompare(b.team1, "es") || a.team2.localeCompare(b.team2, "es"));
  };

  const imprimirPlanillaJornada = (jornada) => {
    const ventana = window.open("", "_blank", "width=900,height=700");
    if (!ventana) {
      setError("El navegador bloqueó la ventana de impresión. Permití las ventanas emergentes para imprimir la planilla.");
      return;
    }
    const escaparHtml = (valor) => String(valor == null ? "" : valor).replace(/[&<>"']/g, (caracter) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
    })[caracter]);
    const filas = jornada.detallesPartidos.map((partido) =>
      "<tr><td>" + escaparHtml(partido.categoria) + "</td><td>" +
      escaparHtml(partido.team1 + " " + (partido.resultadoCargado ? partido.score1 + " - " + partido.score2 : "— - —") + " " + partido.team2) +
      "</td><td class=\"points\">" + (partido.resultadoCargado ? partido.puntosTeam1 : "—") +
      "</td><td class=\"points\">" + (partido.resultadoCargado ? partido.puntosTeam2 : "—") + "</td></tr>"
    ).join("");
    const documento = "<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\"><title>Planilla de jornada FEFUTIN</title>" +
      "<style>@page{size:A4 portrait;margin:14mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#171c27;margin:0}" +
      ".top{border-bottom:4px solid #b5122a;padding-bottom:12px;margin-bottom:18px}.brand{color:#b5122a;font-size:13px;font-weight:900;letter-spacing:3px}" +
      "h1{font-size:23px;margin:8px 0 4px}.meta{font-size:12px;color:#555}.match{font-size:17px;font-weight:800;margin:18px 0 6px}" +
      "table{width:100%;border-collapse:collapse;margin-top:18px;font-size:12px}th{background:#171c27;color:#fff;text-align:left;padding:10px 8px}" +
      "td{padding:10px 8px;border-bottom:1px solid #d7dbe1}td.points,th.points{text-align:center;font-weight:800;width:12%}" +
      ".totals{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:18px}.total{border:1px solid #b5122a;border-radius:8px;padding:12px}" +
      ".total span{display:block;color:#555;font-size:11px;text-transform:uppercase}.total strong{display:block;font-size:22px;margin-top:4px}" +
      ".foot{margin-top:24px;padding-top:10px;border-top:1px solid #ddd;color:#777;font-size:10px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>" +
      "<header class=\"top\"><div class=\"brand\">FEFUTIN</div><h1>PLANILLA OFICIAL DE JORNADA</h1>" +
      "<div class=\"meta\">" + escaparHtml(jornada.torneo) + " · Rama " + escaparHtml(jornada.rama) + " · " + escaparHtml(jornada.etapa) + "</div>" +
      "<div class=\"match\">" + escaparHtml(jornada.team1) + " vs. " + escaparHtml(jornada.team2) + "</div></header>" +
      "<table><thead><tr><th>Categoría</th><th>Resultado</th><th class=\"points\">" + escaparHtml(jornada.team1) + "</th><th class=\"points\">" + escaparHtml(jornada.team2) + "</th></tr></thead><tbody>" + filas + "</tbody></table>" +
      "<div class=\"totals\"><div class=\"total\"><span>Total " + escaparHtml(jornada.team1) + "</span><strong>" + jornada.puntosTeam1 + " puntos</strong></div>" +
      "<div class=\"total\"><span>Total " + escaparHtml(jornada.team2) + "</span><strong>" + jornada.puntosTeam2 + " puntos</strong></div></div>" +
      "<div class=\"foot\">Puntuación institucional por partido: ganado 3 puntos · empatado 2 puntos · perdido 1 punto. El árbitro no recibe puntos.</div></body></html>";
    ventana.document.open();
    ventana.document.write(documento);
    ventana.document.close();
    window.setTimeout(() => { ventana.focus(); ventana.print(); }, 300);
  };

  const imprimirPlanillaGenericaJornada = (jornada) => {
    const ventana = window.open("", "_blank", "width=900,height=700");
    if (!ventana) {
      setError("El navegador bloqueó la ventana de impresión. Permití las ventanas emergentes para imprimir la planilla.");
      return;
    }
    const escaparHtml = (valor) => String(valor == null ? "" : valor).replace(/[&<>"']/g, (caracter) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
    })[caracter]);
    const filas = jornada.detallesPartidos.map((partido) =>
      "<tr><td>" + escaparHtml(partido.categoria) + "</td><td>" + escaparHtml(partido.team1) +
      " <span class=\"blank\"></span> - <span class=\"blank\"></span> " + escaparHtml(partido.team2) +
      "</td><td class=\"write\"></td></tr>"
    ).join("");
    const nombreArbitro = arbitroActual?.nombre || "________________________________";
    const carnetArbitro = carnets.find((item) => item.id === arbitroSeleccionado);
    const matricula = carnetArbitro?.referee_number || "________________";
    const documento = "<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\"><title>Planilla en blanco de jornada FEFUTIN</title>" +
      "<style>@page{size:A4 portrait;margin:14mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#171c27;margin:0}" +
      ".top{border-bottom:4px solid #b5122a;padding-bottom:12px;margin-bottom:16px}.brand{color:#b5122a;font-size:13px;font-weight:900;letter-spacing:3px}" +
      "h1{font-size:22px;margin:8px 0 5px}.meta{font-size:11px;color:#555;line-height:1.6}.match{font-size:17px;font-weight:900;margin-top:12px}" +
      "table{width:100%;border-collapse:collapse;margin-top:16px;font-size:11px}th{background:#171c27;color:#fff;text-align:left;padding:9px 7px}" +
      "td{height:42px;padding:8px 7px;border-bottom:1px solid #cfd3da}.write{width:18%;border-left:1px solid #d7dbe1}" +
      ".blank{display:inline-block;width:24px;height:20px;border-bottom:1px solid #171c27;vertical-align:middle}.ref{margin-top:12px;font-size:11px}" +
      ".signatures{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:42px;page-break-inside:avoid}.signature{padding-top:9px;border-top:1px solid #171c27;text-align:center;font-size:11px;line-height:1.8}" +
      ".signature strong{display:block;font-size:12px}.note{margin-top:22px;font-size:9px;color:#666;border-top:1px solid #ddd;padding-top:8px}" +
      "@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>" +
      "<header class=\"top\"><div class=\"brand\">FEFUTIN</div><h1>PLANILLA DE JORNADA · PARA COMPLETAR</h1>" +
      "<div class=\"meta\">" + escaparHtml(jornada.torneo) + " · Rama " + escaparHtml(jornada.rama) + "<br>" + escaparHtml(jornada.etapa) + "</div>" +
      "<div class=\"match\">" + escaparHtml(jornada.team1) + " vs. " + escaparHtml(jornada.team2) + "</div>" +
      "<div class=\"meta\" style=\"margin-top:8px\"><strong>CATEGORÍAS INCLUIDAS:</strong> " + escaparHtml(jornada.categorias.join(" · ")) + "</div>" +
      "<div class=\"ref\">Árbitro: " + escaparHtml(nombreArbitro) + " · Matrícula: " + escaparHtml(matricula) + "</div></header>" +
      "<table><thead><tr><th>Categoría</th><th>Resultado (goles)</th><th>Observaciones</th></tr></thead><tbody>" + filas + "</tbody></table>" +
      "<section class=\"signatures\"><div class=\"signature\"><strong>REFERENTE LOCAL</strong>" + escaparHtml(jornada.team1) +
      "<br>Nombre y apellido: __________________________<br>Firma: __________________________</div>" +
      "<div class=\"signature\"><strong>REFERENTE VISITANTE</strong>" + escaparHtml(jornada.team2) +
      "<br>Nombre y apellido: __________________________<br>Firma: __________________________</div></section>" +
      "<div class=\"note\">Planilla genérica para completar durante la jornada. Los resultados y las firmas deben verificarse al cierre de cada encuentro.</div></body></html>";
    ventana.document.open();
    ventana.document.write(documento);
    ventana.document.close();
    window.setTimeout(() => { ventana.focus(); ventana.print(); }, 300);
  };
  const obtenerPartidosDeArbitro = (refereeId) => torneos.flatMap((tournament) => {
    const grupos = (Array.isArray(tournament.groups) ? tournament.groups : []).flatMap((group, groupIndex) =>
      (Array.isArray(group?.matches) ? group.matches : []).filter((match) =>
        match?.referee_id === refereeId &&
        match?.score1 !== null && match?.score1 !== undefined &&
        match?.score2 !== null && match?.score2 !== undefined &&
        Number.isFinite(Number(match.score1)) && Number.isFinite(Number(match.score2)) &&
        String(match.team1 || "").trim() && String(match.team2 || "").trim() &&
        String(match.team1).trim().toLocaleLowerCase("es") !== "pasaje directo" &&
        String(match.team2).trim().toLocaleLowerCase("es") !== "pasaje directo"
      ).map((match, matchIndex) => ({
        ...match,
        torneo: tournament.title || "Torneo sin nombre",
        rama: String(tournament.game || "").split(" · ")[1] || "Sin rama",
        categoria: getTournamentCategory(tournament),
        instancia: group?.name || `Grupo ${groupIndex + 1}`,
        fechaOrden: match.result_loaded_at ? new Date(match.result_loaded_at).getTime() : 0,
        clave: `${tournament.id}-grupo-${groupIndex}-partido-${matchIndex}`,
      }))
    );
    const playoffs = (Array.isArray(tournament.playoffs) ? tournament.playoffs : []).flatMap((round, roundIndex) =>
      (Array.isArray(round) ? round : []).filter((match) =>
        match?.referee_id === refereeId &&
        match?.score1 !== null && match?.score1 !== undefined &&
        match?.score2 !== null && match?.score2 !== undefined &&
        Number.isFinite(Number(match.score1)) && Number.isFinite(Number(match.score2)) &&
        String(match.team1 || "").trim() && String(match.team2 || "").trim() &&
        String(match.team1).trim().toLocaleLowerCase("es") !== "pasaje directo" &&
        String(match.team2).trim().toLocaleLowerCase("es") !== "pasaje directo"
      ).map((match, matchIndex) => ({
        ...match,
        torneo: tournament.title || "Torneo sin nombre",
        rama: String(tournament.game || "").split(" · ")[1] || "Sin rama",
        categoria: getTournamentCategory(tournament),
        instancia: `Eliminatorias · Ronda ${roundIndex + 1}`,
        fechaOrden: match.result_loaded_at ? new Date(match.result_loaded_at).getTime() : 0,
        clave: `${tournament.id}-playoff-${roundIndex}-partido-${matchIndex}`,
      }))
    );
    return [...grupos, ...playoffs];
  }).sort((a, b) => b.fechaOrden - a.fechaOrden);

  const obtenerDiaCalendarioDePartido = (fecha) => {
    if (!fecha) return null;
    const instante = new Date(fecha);
    if (Number.isNaN(instante.getTime())) return null;
    const partes = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(instante);
    const valores = Object.fromEntries(partes.map((parte) => [parte.type, parte.value]));
    return `${valores.year}-${valores.month}-${valores.day}`;
  };

  const partidosDisponibles = torneos.flatMap((tournament) => {
    const partidosGrupo = (Array.isArray(tournament.groups) ? tournament.groups : []).flatMap((group, groupIndex) =>
      (Array.isArray(group?.matches) ? group.matches : []).map((match, matchIndex) => ({
        tournamentId: tournament.id,
        tournamentTitle: tournament.title || "Torneo sin nombre",
        rama: String(tournament.game || "").split(" · ")[1] || "Sin rama",
        instancia: group?.name || `Grupo ${groupIndex + 1}`,
        team1: match?.team1 || "",
        team2: match?.team2 || "",
        refereeId: match?.referee_id || "",
        key: `${tournament.id}::grupo::${groupIndex}::${matchIndex}`,
        phase: "grupo",
        groupIndex,
        matchIndex,
      })).filter((match) => match.team1 && match.team2 &&
        String(match.team1).trim().toLocaleLowerCase("es") !== "pasaje directo" &&
        String(match.team2).trim().toLocaleLowerCase("es") !== "pasaje directo")
    );
    const partidosPlayoff = (Array.isArray(tournament.playoffs) ? tournament.playoffs : []).flatMap((round, roundIndex) =>
      (Array.isArray(round) ? round : []).map((match, matchIndex) => ({
        tournamentId: tournament.id,
        tournamentTitle: tournament.title || "Torneo sin nombre",
        rama: String(tournament.game || "").split(" · ")[1] || "Sin rama",
        instancia: `Eliminatorias · Ronda ${roundIndex + 1}`,
        team1: match?.team1 || "",
        team2: match?.team2 || "",
        refereeId: match?.referee_id || "",
        key: `${tournament.id}::playoff::${roundIndex}::${matchIndex}`,
        phase: "playoff",
        roundIndex,
        matchIndex,
      })).filter((match) => match.team1 && match.team2 &&
        String(match.team1).trim().toLocaleLowerCase("es") !== "pasaje directo" &&
        String(match.team2).trim().toLocaleLowerCase("es") !== "pasaje directo")
    );
    return [...partidosGrupo, ...partidosPlayoff];
  });

  const guardarDesignacion = async () => {
    if (!canManageAccess || !arbitroParaDesignar || !partidoParaDesignar) return;
    const [tournamentId, phase, firstIndex, secondIndex] = partidoParaDesignar.split("::");
    const tournament = torneos.find((item) => String(item.id) === tournamentId);
    if (!tournament) {
      setMensajeDesignacion("No se encontró el torneo seleccionado. Actualizá la ficha e intentá nuevamente.");
      return;
    }
    const groups = Array.isArray(tournament.groups) ? tournament.groups.map((group) => ({
      ...group,
      matches: Array.isArray(group?.matches) ? [...group.matches] : [],
    })) : [];
    const playoffs = Array.isArray(tournament.playoffs) ? tournament.playoffs.map((round) => Array.isArray(round) ? [...round] : []) : [];
    if (phase === "grupo" && groups[Number(firstIndex)]?.matches?.[Number(secondIndex)]) {
      groups[Number(firstIndex)].matches[Number(secondIndex)] = {
        ...groups[Number(firstIndex)].matches[Number(secondIndex)],
        referee_id: arbitroParaDesignar,
      };
    } else if (phase === "playoff" && playoffs[Number(firstIndex)]?.[Number(secondIndex)]) {
      playoffs[Number(firstIndex)][Number(secondIndex)] = {
        ...playoffs[Number(firstIndex)][Number(secondIndex)],
        referee_id: arbitroSeleccionado,
      };
    } else {
      setMensajeDesignacion("No se encontró el partido seleccionado.");
      return;
    }
    setGuardandoDesignacion(true);
    setMensajeDesignacion("");
    const { error: updateError } = await supabase.from("tournaments")
      .update({ groups, playoffs })
      .eq("id", tournament.id);
    setGuardandoDesignacion(false);
    if (updateError) {
      console.error("Error al guardar designación arbitral:", updateError);
      setMensajeDesignacion(updateError.message || "No se pudo guardar la designación.");
      return;
    }
    setTorneos((previous) => previous.map((item) => item.id === tournament.id ? { ...item, groups, playoffs } : item));
    setPartidoParaDesignar("");
    setArbitroDesignacionAbierto(null);
    setArbitroParaDesignar(null);
    setMensajeDesignacion("Designación guardada correctamente.");
  };
  const partidosDirigidos = arbitroSeleccionado
    ? torneos.flatMap((tournament) => {
        const partidosGrupos = (Array.isArray(tournament.groups) ? tournament.groups : []).flatMap((group, groupIndex) =>
          (Array.isArray(group?.matches) ? group.matches : [])
            .filter((match) =>
              match?.referee_id === arbitroSeleccionado &&
              match?.score1 !== null && match?.score1 !== undefined &&
              match?.score2 !== null && match?.score2 !== undefined &&
              Number.isFinite(Number(match.score1)) &&
              Number.isFinite(Number(match.score2)) &&
              String(match.team1 || "").trim() &&
              String(match.team2 || "").trim() &&
              String(match.team1 || "").trim().toLocaleLowerCase("es") !== "pasaje directo" &&
              String(match.team2 || "").trim().toLocaleLowerCase("es") !== "pasaje directo"
            )
            .map((match, matchIndex) => ({
              ...match,
              torneo: tournament.title || "Torneo sin nombre",
              rama: String(tournament.game || "").split(" · ")[1] || "Sin rama",
              instancia: group?.name || `Grupo ${groupIndex + 1}`,
              orden: match.result_loaded_at ? new Date(match.result_loaded_at).getTime() : 0,
              clave: `${tournament.id || tournament.title}-grupo-${groupIndex}-partido-${matchIndex}`,
            }))
        );

        const partidosPlayoffs = (Array.isArray(tournament.playoffs) ? tournament.playoffs : []).flatMap((round, roundIndex) =>
          (Array.isArray(round) ? round : [])
            .filter((match) =>
              match?.referee_id === arbitroSeleccionado &&
              match?.score1 !== null && match?.score1 !== undefined &&
              match?.score2 !== null && match?.score2 !== undefined &&
              Number.isFinite(Number(match.score1)) &&
              Number.isFinite(Number(match.score2)) &&
              String(match.team1 || "").trim() &&
              String(match.team2 || "").trim() &&
              String(match.team1 || "").trim().toLocaleLowerCase("es") !== "pasaje directo" &&
              String(match.team2 || "").trim().toLocaleLowerCase("es") !== "pasaje directo"
            )
            .map((match, matchIndex) => ({
              ...match,
              torneo: tournament.title || "Torneo sin nombre",
              rama: String(tournament.game || "").split(" · ")[1] || "Sin rama",
              instancia: `Eliminatorias · Ronda ${roundIndex + 1}`,
              orden: match.result_loaded_at ? new Date(match.result_loaded_at).getTime() : 0,
              clave: `${tournament.id || tournament.title}-playoff-${roundIndex}-partido-${matchIndex}`,
            }))
        );

        return [...partidosGrupos, ...partidosPlayoffs];
      }).sort((a, b) => b.orden - a.orden)
    : [];

  const actividadCalendario = {};
  const obtenerDiaArgentina = (fecha) => {
    if (!fecha) return null;
    const instante = new Date(fecha);
    if (Number.isNaN(instante.getTime())) return null;
    const partes = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instante);
    const valores = Object.fromEntries(partes.map((parte) => [parte.type, parte.value]));
    return `${valores.year}-${valores.month}-${valores.day}`;
  };

  if (arbitroSeleccionado) {
    const registrarActividadCalendario = (match) => {
      if (match?.referee_id !== arbitroSeleccionado ||
          match?.score1 === null || match?.score1 === undefined ||
          match?.score2 === null || match?.score2 === undefined) return;
      const dia = obtenerDiaArgentina(match.result_loaded_at);
      if (!dia) return;
      actividadCalendario[dia] = (actividadCalendario[dia] || 0) + 1;
    };

    torneos.forEach((tournament) => {
      (Array.isArray(tournament.groups) ? tournament.groups : []).forEach((group) => {
        (Array.isArray(group?.matches) ? group.matches : []).forEach(registrarActividadCalendario);
      });
      (Array.isArray(tournament.playoffs) ? tournament.playoffs : []).forEach((round) => {
        (Array.isArray(round) ? round : []).forEach(registrarActividadCalendario);
      });
    });
  }

  const anioCalendario = mesCalendario.getFullYear();
  const numeroMesCalendario = mesCalendario.getMonth();
  const cantidadDiasMes = new Date(anioCalendario, numeroMesCalendario + 1, 0).getDate();
  const primerDiaSemana = (new Date(anioCalendario, numeroMesCalendario, 1).getDay() + 6) % 7;
  const claveDiaCalendario = (dia) => `${anioCalendario}-${String(numeroMesCalendario + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  const fechaHoyCalendario = obtenerDiaArgentina(new Date().toISOString());
  const cantidadActividadDiaSeleccionado = diaCalendarioSeleccionado
    ? actividadCalendario[diaCalendarioSeleccionado] || 0
    : 0;

  const tarjetaMetrica = (etiqueta, valor, color = "#fff") => (
    <div style={{ background: "#171c27", border: "1px solid #b5122a", borderRadius: "12px", padding: "0.9rem", textAlign: "center" }}>
      <div style={{ color: "#c7cbd1", fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase" }}>{etiqueta}</div>
      <div style={{ color, fontSize: "1.65rem", fontWeight: 900, marginTop: "0.25rem" }}>{valor}</div>
    </div>
  );

  if (loading || error) {
    return (
      <div className="referee-stat-card" style={{ width: "100%", maxWidth: "1100px", margin: "0 auto", textAlign: "center" }}>
        <h2 className="cr-title">ÁRBITROS · ESTADÍSTICAS</h2>
        <p style={{ color: error ? "#f87171" : "#d1d5db" }}>{error || "Cargando estadísticas arbitrales..."}</p>
        {error && <button type="button" className="cr-btn-gold" onClick={cargarEstadisticas}>Reintentar</button>}
        <div><button type="button" className="tc-form-back" onClick={onBack} style={{ marginTop: "1rem" }}>← Volver</button></div>
      </div>
    );
  }

  if (arbitroActual) {
    return (
      <div style={{ width: "100%", maxWidth: "1100px", margin: "0 auto", paddingBottom: "2rem" }}>
        <section className="referee-stat-card" style={{ marginBottom: "1rem" }}>
          
          <h2 className="cr-title" style={{ marginBottom: "4px" }}>{arbitroActual.nombre}</h2>
          <p style={{ color: "#d1d5db", margin: 0, fontSize: "0.82rem" }}>Ficha individual · Estadísticas arbitrales</p>
        </section>

        <section className="referee-stat-card" style={{ marginBottom: "1rem", padding: "1rem", background: "linear-gradient(145deg, #202633 0%, #11151d 78%)", border: "1px solid #343d4b", borderTop: "3px solid #b5122a", borderRadius: "14px", boxShadow: "0 7px 18px rgba(0,0,0,.24)" }}>
          <button type="button" aria-expanded={detalleTarjetaArbitro === "ficha:individual"} onClick={() => setDetalleTarjetaArbitro(detalleTarjetaArbitro === "ficha:individual" ? null : "ficha:individual")} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.8rem", background: "transparent", border: 0, color: "#fff", padding: 0, cursor: "pointer", textAlign: "left", appearance: "none" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "0.8rem", minWidth: 0 }}>
              
              <span style={{ display: "block", minWidth: 0, flex: 1, background: "#050505", border: "1px solid #343a46", borderRadius: "9px", padding: "0.7rem 0.8rem", textAlign: "center" }}>
                <strong style={{ display: "block", fontSize: "0.88rem", letterSpacing: "0.045em" }}>DATOS INDIVIDUALES</strong>
                <span style={{ display: "block", color: "#b8c0cc", fontSize: "0.72rem", marginTop: "0.28rem", lineHeight: 1.4 }}>{arbitroActual.partidos} partidos · {partidosDirigidos.length} resultados registrados</span>
              </span>
            </span>
            <span aria-hidden="true" style={{ width: "32px", height: "32px", flex: "0 0 32px", display: "grid", placeItems: "center", borderRadius: "50%", background: detalleTarjetaArbitro === "ficha:individual" ? "#b5122a" : "#303947", color: "#fff", fontSize: "1rem", transition: "background .2s" }}>{detalleTarjetaArbitro === "ficha:individual" ? "−" : "+"}</span>
          </button>
          {detalleTarjetaArbitro === "ficha:individual" && <>
          <p style={{ color: "#d1d5db", fontSize: "0.78rem", margin: "0.8rem 0" }}>Estadísticas, calendario de actividad y partidos dirigidos de este árbitro.</p>
          <section className="referee-stat-card" style={{ marginBottom: "1rem" }}>
          <h3 style={{ color: "#fff", marginTop: 0 }}>Resultados dirigidos</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))", gap: "0.75rem" }}>
            {tarjetaMetrica("Partidos", arbitroActual.partidos)}
            {tarjetaMetrica("Victorias locales", arbitroActual.victoriasLocales, "#86efac")}
            {tarjetaMetrica("Empates", arbitroActual.empates, "#facc15")}
            {tarjetaMetrica("Victorias visitantes", arbitroActual.victoriasVisitantes, "#93c5fd")}
          </div>
        </section>

        <section className="referee-stat-card" style={{ marginBottom: "1rem" }}>
          <h3 style={{ color: "#fff", marginTop: 0 }}>Goles en sus partidos</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))", gap: "0.75rem" }}>
            {tarjetaMetrica("Goles locales", arbitroActual.golesLocal)}
            {tarjetaMetrica("Goles visitantes", arbitroActual.golesVisitante)}
            {tarjetaMetrica("Goles totales", arbitroActual.golesTotales, "#facc15")}
          </div>
        </section>

        <section className="referee-stat-card">
          <h3 style={{ color: "#fff", marginTop: 0 }}>Partidos por rama</h3>
          {Object.keys(arbitroActual.porRama).length ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.65rem" }}>
              {Object.entries(arbitroActual.porRama).map(([rama, cantidad]) => (
                <div key={rama} style={{ background: "#171c27", borderRadius: "10px", padding: "0.8rem", color: "#fff", border: "1px solid #34313d" }}>
                  <strong>{rama}</strong><div style={{ color: "#d1d5db", marginTop: "0.25rem" }}>{cantidad} partidos</div>
                </div>
              ))}
            </div>
          ) : <p style={{ color: "#d1d5db" }}>Todavía no registra partidos.</p>}
        </section>

        <section className="referee-stat-card" style={{ marginTop: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <div>
              <h3 style={{ color: "#fff", margin: 0 }}>Actividad de carga</h3>
              <p style={{ color: "#d1d5db", fontSize: "0.78rem", margin: "0.25rem 0 0" }}>Días en los que registró resultados</p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <button type="button" className="tc-form-back" aria-label="Mes anterior" onClick={() => { setMesCalendario(new Date(anioCalendario, numeroMesCalendario - 1, 1)); setDiaCalendarioSeleccionado(null); }}>‹</button>
              <strong style={{ color: "#fff", minWidth: "135px", textAlign: "center", textTransform: "capitalize" }}>
                {mesCalendario.toLocaleDateString("es-AR", { month: "long", year: "numeric" })}
              </strong>
              <button type="button" className="tc-form-back" aria-label="Mes siguiente" onClick={() => { setMesCalendario(new Date(anioCalendario, numeroMesCalendario + 1, 1)); setDiaCalendarioSeleccionado(null); }}>›</button>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: "0.35rem", marginTop: "1rem" }}>
            {["L", "M", "M", "J", "V", "S", "D"].map((dia, index) => (
              <div key={`${dia}-${index}`} style={{ color: "#aeb4bf", textAlign: "center", fontSize: "0.72rem", fontWeight: 800, padding: "0.35rem 0" }}>{dia}</div>
            ))}
            {Array.from({ length: primerDiaSemana }, (_, index) => (
              <div key={`vacio-${index}`} />
            ))}
            {Array.from({ length: cantidadDiasMes }, (_, index) => {
              const dia = index + 1;
              const clave = claveDiaCalendario(dia);
              const cantidad = actividadCalendario[clave] || 0;
              const seleccionado = diaCalendarioSeleccionado === clave;
              const esHoy = fechaHoyCalendario === clave;
              return (
                <button
                  key={clave}
                  type="button"
                  onClick={() => setDiaCalendarioSeleccionado(seleccionado ? null : clave)}
                  aria-label={`${dia}: ${cantidad} resultados cargados`}
                  style={{
                    minWidth: 0,
                    aspectRatio: "1",
                    borderRadius: "9px",
                    border: seleccionado ? "2px solid #fff" : esHoy ? "1px solid #facc15" : cantidad ? "1px solid #b5122a" : "1px solid #343a46",
                    background: cantidad ? "#b5122a" : "#171c27",
                    color: "#fff",
                    fontWeight: cantidad ? 900 : 600,
                    cursor: "pointer",
                    padding: "0.2rem",
                    boxShadow: seleccionado ? "0 0 0 2px rgba(181,18,42,0.35)" : "none",
                  }}
                >
                  <span>{dia}</span>
                  {cantidad > 0 && <span style={{ display: "block", fontSize: "0.58rem", lineHeight: 1.1 }}>{cantidad}</span>}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", marginTop: "0.8rem", color: "#d1d5db", fontSize: "0.72rem" }}>
            <span style={{ width: "11px", height: "11px", borderRadius: "3px", background: "#b5122a", display: "inline-block" }} />
            Día con resultados cargados
          </div>
          {diaCalendarioSeleccionado && (
            <p style={{ color: "#fff", margin: "0.8rem 0 0", fontSize: "0.82rem" }}>
              {new Date(`${diaCalendarioSeleccionado}T12:00:00`).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })}: <strong>{cantidadActividadDiaSeleccionado} {cantidadActividadDiaSeleccionado === 1 ? "resultado cargado" : "resultados cargados"}</strong>
            </p>
          )}
          {Object.keys(actividadCalendario).length === 0 && (
            <p style={{ color: "#aeb4bf", fontSize: "0.75rem", margin: "0.8rem 0 0" }}>El calendario comenzará a marcar actividad con las próximas cargas de resultados. Los registros anteriores no tienen fecha de carga guardada.</p>
          )}
        </section>


        <section className="referee-stat-card" style={{ marginTop: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.85rem" }}>
            <div>
              <h3 style={{ color: "#fff", margin: 0 }}>Partidos dirigidos</h3>
              <p style={{ color: "#d1d5db", fontSize: "0.78rem", margin: "0.25rem 0 0" }}>Encuentros con resultado cargado por este árbitro</p>
            </div>
            <strong style={{ color: "#fff", background: "#b5122a", borderRadius: "20px", padding: "0.3rem 0.7rem", fontSize: "0.8rem" }}>{partidosDirigidos.length}</strong>
          </div>
          {partidosDirigidos.length === 0 ? (
            <p style={{ color: "#aeb4bf", margin: 0 }}>Todavía no hay partidos con resultados cargados para este árbitro.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
              {partidosDirigidos.map((partido) => (
                <article key={partido.clave} style={{ background: "#171c27", border: "1px solid #343a46", borderLeft: "3px solid #b5122a", borderRadius: "10px", padding: "0.8rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.55rem" }}>
                    <strong style={{ color: "#fff", fontSize: "0.82rem" }}>{partido.torneo}</strong>
                    <span style={{ color: "#aeb4bf", fontSize: "0.7rem" }}>{partido.result_loaded_at && !Number.isNaN(new Date(partido.result_loaded_at).getTime()) ? new Date(partido.result_loaded_at).toLocaleDateString("es-AR") : "Fecha no registrada"}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)", alignItems: "center", gap: "0.5rem" }}>
                    <strong style={{ color: "#fff", fontSize: "0.82rem", overflowWrap: "anywhere" }}>{partido.team1}</strong>
                    <span style={{ color: "#fff", background: "#080808", border: "1px solid #b5122a", borderRadius: "8px", padding: "0.35rem 0.6rem", fontWeight: 900, whiteSpace: "nowrap" }}>{partido.score1} - {partido.score2}</span>
                    <strong style={{ color: "#fff", fontSize: "0.82rem", textAlign: "right", overflowWrap: "anywhere" }}>{partido.team2}</strong>
                  </div>
                  <div style={{ color: "#aeb4bf", fontSize: "0.7rem", marginTop: "0.55rem" }}>{partido.rama} · {partido.instancia}</div>
                </article>
              ))}
            </div>
          )}
        </section>
          </>}
        </section>

        <section className="referee-stat-card" style={{ marginTop: "1rem", padding: "1rem", background: "linear-gradient(145deg, #202633 0%, #11151d 78%)", border: "1px solid #343d4b", borderTop: "3px solid #b5122a", borderRadius: "14px", boxShadow: "0 7px 18px rgba(0,0,0,.24)" }}>
          <button type="button" aria-expanded={detalleTarjetaArbitro === "ficha:jornada"} onClick={() => setDetalleTarjetaArbitro(detalleTarjetaArbitro === "ficha:jornada" ? null : "ficha:jornada")} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.8rem", background: "transparent", border: 0, color: "#fff", padding: 0, cursor: "pointer", textAlign: "left", appearance: "none" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "0.8rem", minWidth: 0 }}>
              
              <span style={{ display: "block", minWidth: 0, flex: 1, background: "#050505", border: "1px solid #343a46", borderRadius: "9px", padding: "0.7rem 0.8rem", textAlign: "center" }}>
                <strong style={{ display: "block", fontSize: "0.88rem", letterSpacing: "0.045em" }}>DATOS POR JORNADA</strong>
                <span style={{ display: "block", color: "#b8c0cc", fontSize: "0.72rem", marginTop: "0.28rem", lineHeight: 1.4 }}>{obtenerJornadasDeArbitro(arbitroSeleccionado).length} jornadas registradas · Cruces y categorías</span>
              </span>
            </span>
            <span aria-hidden="true" style={{ width: "32px", height: "32px", flex: "0 0 32px", display: "grid", placeItems: "center", borderRadius: "50%", background: detalleTarjetaArbitro === "ficha:jornada" ? "#b5122a" : "#303947", color: "#fff", fontSize: "1rem", transition: "background .2s" }}>{detalleTarjetaArbitro === "ficha:jornada" ? "−" : "+"}</span>
          </button>
          {detalleTarjetaArbitro === "ficha:jornada" && <>
          <p style={{ color: "#d1d5db", fontSize: "0.78rem", margin: "0.8rem 0" }}>Resumen exclusivo de los cruces y jornadas dirigidos por este árbitro.</p>
          {(() => {
            const jornadas = obtenerJornadasDeArbitro(arbitroSeleccionado);
            return jornadas.length ? (
              <div style={{ display: "grid", gap: "0.65rem" }}>
                {jornadas.map((jornada) => (
                  <article key={jornada.key} style={{ background: "#171c27", border: "1px solid #343a46", borderLeft: "3px solid #b5122a", borderRadius: "10px", padding: "0.8rem" }}>
                    <strong style={{ display: "block", color: "#fff", fontSize: "0.82rem" }}>{jornada.torneo} · {jornada.rama}</strong>
                    <div style={{ color: "#ff9aa8", fontSize: "0.82rem", fontWeight: 800, marginTop: "0.3rem" }}>{jornada.team1} vs. {jornada.team2}</div>
                    <div style={{ color: "#aeb7c5", fontSize: "0.7rem", marginTop: "0.2rem" }}>{jornada.etapa}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: "0.45rem", marginTop: "0.65rem" }}>
                      {tarjetaMetrica("Partidos", jornada.partidos)}
                      {tarjetaMetrica("Jugados", jornada.partidosJugados)}
                      {tarjetaMetrica("Categorías", jornada.categorias.length)}
                      {tarjetaMetrica("Goles", jornada.goles)}
                    </div>
                    <div style={{ display: "grid", gap: "0.4rem", marginTop: "0.7rem" }}>
                      {jornada.detallesPartidos.map((partido) => (
                        <div key={partido.clave} style={{ display: "grid", gridTemplateColumns: "minmax(0, 0.8fr) minmax(0, 1.5fr)", gap: "0.35rem 0.6rem", alignItems: "center", padding: "0.55rem 0.6rem", background: "#080b10", border: "1px solid #343a46", borderRadius: "8px" }}>
                          <strong style={{ color: "#ff9aa8", fontSize: "0.72rem" }}>{partido.categoria}</strong>
                          <strong style={{ color: "#fff", fontSize: "0.75rem", textAlign: "right" }}>{partido.team1} {partido.resultadoCargado ? partido.score1 + " - " + partido.score2 : "— - —"} {partido.team2}</strong>
                          <span style={{ gridColumn: "1 / -1", color: "#d1d5db", fontSize: "0.68rem" }}>{jornada.team1}: <strong style={{ color: "#fff" }}>{partido.resultadoCargado ? partido.puntosTeam1 + " pts" : "Pendiente"}</strong> · {jornada.team2}: <strong style={{ color: "#fff" }}>{partido.resultadoCargado ? partido.puntosTeam2 + " pts" : "Pendiente"}</strong></span>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginTop: "0.7rem" }}>
                      <div style={{ background: "#080b10", border: "1px solid #b5122a", borderRadius: "8px", padding: "0.65rem" }}>
                        <span style={{ display: "block", color: "#aeb7c5", fontSize: "0.65rem" }}>TOTAL {jornada.team1.toLocaleUpperCase("es")}</span>
                        <strong style={{ color: "#fff", fontSize: "1.05rem" }}>{jornada.puntosTeam1} puntos</strong>
                      </div>
                      <div style={{ background: "#080b10", border: "1px solid #b5122a", borderRadius: "8px", padding: "0.65rem" }}>
                        <span style={{ display: "block", color: "#aeb7c5", fontSize: "0.65rem" }}>TOTAL {jornada.team2.toLocaleUpperCase("es")}</span>
                        <strong style={{ color: "#fff", fontSize: "1.05rem" }}>{jornada.puntosTeam2} puntos</strong>
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0.55rem", marginTop: "0.75rem" }}>
                      <button type="button" onClick={() => imprimirPlanillaGenericaJornada(jornada)} style={{ width: "100%", padding: "0.65rem 0.8rem", borderRadius: "8px", border: "1px solid #b5122a", background: "#b5122a", color: "#fff", fontSize: "0.72rem", fontWeight: 900, cursor: "pointer" }}>
                        🖨 IMPRIMIR PLANILLA EN BLANCO
                      </button>
                      <button type="button" onClick={() => imprimirPlanillaJornada(jornada)} style={{ width: "100%", padding: "0.65rem 0.8rem", borderRadius: "8px", border: "1px solid #b5122a", background: "#241015", color: "#fff", fontSize: "0.72rem", fontWeight: 900, cursor: "pointer" }}>
                        🖨 IMPRIMIR PLANILLA CON RESULTADOS
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : <p style={{ color: "#aeb4bf", margin: 0 }}>Todavía no tiene jornadas designadas para este árbitro.</p>;
          })()}
          </>}
        </section>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
          <button type="button" className="tc-form-back" onClick={() => setArbitroSeleccionado(null)}>← Volver a todos</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", maxWidth: "1100px", margin: "0 auto", paddingBottom: "2rem" }}>
      <section className="referee-stat-card" style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <div>
            <h2 className="cr-title" style={{ marginBottom: "4px" }}>ÁRBITROS · ESTADÍSTICAS</h2>
            <p style={{ color: "#d1d5db", margin: 0, fontSize: "0.82rem" }}>Consultá y compará el rendimiento de todos los árbitros</p>
          </div>
          <button type="button" onClick={cargarEstadisticas} className="tc-form-back">↻ Actualizar</button>
        </div>
      </section>

      {estadisticas.length === 0 ? (
        <section className="referee-stat-card"><p style={{ color: "#d1d5db" }}>Todavía no hay árbitros aprobados para mostrar.</p></section>
      ) : (
        <div className="referee-stats-grid" style={{ display: "grid", gap: "0.9rem", alignItems: "stretch" }}>
          {estadisticas.map((arbitro) => (
            <article
              key={arbitro.id}
              className="referee-stat-card referee-mini-card"
              style={{ position: "relative", minWidth: 0, width: "100%", minHeight: "218px", boxSizing: "border-box", textAlign: "left", color: "#fff", display: "flex", flexDirection: "column", gap: "0.75rem", background: "linear-gradient(145deg, #202633 0%, #11151d 78%)", border: "1px solid #343d4b", borderTop: "3px solid #b5122a", padding: "1rem", borderRadius: "14px", boxShadow: "0 7px 18px rgba(0,0,0,.24)" }}
            >
              <button
                type="button"
                onClick={() => setArbitroSeleccionado(arbitro.id)}
                aria-label={"Ver credencial de " + arbitro.nombre}
                className="referee-stat-card-button"
                style={{ width: "100%", minWidth: 0, textAlign: "left", color: "#fff", cursor: "pointer", display: "flex", flexDirection: "column", gap: "0.65rem", background: "transparent", border: 0, padding: 0 }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.6rem", paddingBottom: "0.65rem", borderBottom: "1px solid #343d4b" }}>
                  <span style={{ color: "#ff9aa8", fontSize: "0.65rem", fontWeight: 900, letterSpacing: "0.12em" }}>FEFUTIN</span>
                  <span style={{ color: "#aeb7c5", fontSize: "0.62rem", fontWeight: 800, letterSpacing: "0.08em" }}>CREDENCIAL DE ÁRBITRO</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "76px minmax(0,1fr)", alignItems: "start", gap: "0.85rem", padding: "0.45rem 0" }}>
                  <div style={{ width: "76px", height: "96px", flex: "0 0 76px", display: "grid", placeItems: "center", overflow: "hidden", borderRadius: "8px", background: "#080b10", border: "2px solid #b5122a", color: "#fff", fontSize: "1.8rem" }}>
                    {fotosCarnets[arbitro.id]
                      ? <img src={fotosCarnets[arbitro.id]} alt={"Foto de " + arbitro.nombre} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : <span aria-hidden="true">⚽</span>}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", color: "#aeb7c5", fontSize: "0.62rem", fontWeight: 800, letterSpacing: "0.1em", marginBottom: "0.25rem" }}>ÁRBITRO</span>
                    <strong style={{ display: "block", color: "#fff", fontSize: "clamp(0.9rem, 1.3vw, 1.08rem)", lineHeight: 1.25, overflowWrap: "anywhere" }}>{arbitro.nombre}</strong>
                    <div style={{ display: "grid", gap: "0.28rem", marginTop: "0.5rem" }}>
                      <span style={{ color: "#ff9aa8", fontSize: "0.62rem", fontWeight: 900, letterSpacing: "0.06em" }}>MATRÍCULA</span>
                      <strong style={{ color: "#fff", fontSize: "0.78rem", overflowWrap: "anywhere" }}>{carnets.find((item) => item.id === arbitro.id)?.referee_number || "A completar"}</strong>
                      <span style={{ color: "#aeb7c5", fontSize: "0.72rem", overflowWrap: "anywhere" }}>{carnets.find((item) => item.id === arbitro.id)?.locality || "Localidad a completar"}</span>
                      <span style={{ color: "#aeb7c5", fontSize: "0.68rem" }}>Nacimiento: {carnets.find((item) => item.id === arbitro.id)?.birth_date ? new Date(carnets.find((item) => item.id === arbitro.id).birth_date + "T12:00:00").toLocaleDateString("es-AR") : "A completar"}</span>
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.7rem", background: "#080b10", border: "1px solid #343d4b", borderRadius: "10px", padding: "0.7rem 0.85rem" }}>
                  <div>
                    <strong style={{ display: "block", color: "#fff", fontSize: "1.8rem", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{obtenerJornadasDeArbitro(arbitro.id).length}</strong>
                    <span style={{ display: "block", color: "#ff9aa8", fontSize: "0.64rem", fontWeight: 900, letterSpacing: "0.08em", marginTop: "0.25rem" }}>JORNADAS DIRIGIDAS</span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <strong style={{ display: "block", color: "#fff", fontSize: "1.2rem", lineHeight: 1 }}>{arbitro.partidos}</strong>
                    <span style={{ display: "block", color: "#aeb7c5", fontSize: "0.6rem", fontWeight: 800, marginTop: "0.25rem" }}>PARTIDOS</span>
                  </div>
                </div>
                <span className="referee-mini-detail" style={{ color: "#ff9aa8", fontSize: "0.66rem", fontWeight: 800, letterSpacing: "0.08em", borderTop: "1px solid #343d4b", paddingTop: "0.65rem", marginTop: "auto", display: "flex", justifyContent: "space-between" }}>VER CREDENCIAL <span aria-hidden="true">→</span></span>
              </button>

              {canManageAccess && (
                <div style={{ display: "grid", gap: "0.5rem", marginTop: "auto" }}>
                  <button
                    type="button"
                    className="cr-btn-gold"
                    onClick={() => {
                      const abrir = arbitroDesignacionAbierto !== arbitro.id;
                      setArbitroDesignacionAbierto(abrir ? arbitro.id : null);
                      setArbitroParaDesignar(abrir ? arbitro.id : null);
                      setPartidoParaDesignar("");
                      setMensajeDesignacion("");
                    }}
                    style={{ width: "100%", padding: "0.65rem 0.75rem", fontSize: "0.78rem" }}
                  >
                    {arbitroDesignacionAbierto === arbitro.id ? "Cerrar designación" : "＋ Designar partido"}
                  </button>
                  {arbitroDesignacionAbierto === arbitro.id && (
                    <div style={{ display: "grid", gap: "0.5rem", padding: "0.7rem", borderRadius: "9px", background: "#080808", border: "1px solid #b5122a" }}>
                      <strong style={{ color: "#fff", fontSize: "0.78rem" }}>Asignar partido a {arbitro.nombre}</strong>
                      <select
                        aria-label={`Seleccionar partido para ${arbitro.nombre}`}
                        value={partidoParaDesignar}
                        onChange={(event) => setPartidoParaDesignar(event.target.value)}
                        style={{ width: "100%", minWidth: 0, boxSizing: "border-box", padding: "0.7rem", borderRadius: "8px", border: "1px solid #b5122a", background: "#171c27", color: "#fff", fontSize: "0.75rem" }}
                      >
                        <option value="">Elegir torneo y partido...</option>
                        {partidosDisponibles.map((partido) => (
                          <option key={partido.key} value={partido.key}>
                            {partido.tournamentTitle} · {partido.rama} · {partido.instancia} · {partido.team1} vs. {partido.team2}{partido.refereeId ? " · Ya tiene árbitro (se reemplazará)" : " · Sin designar"}
                          </option>
                        ))}
                      </select>
                      {partidoParaDesignar && (
                        <p style={{ color: "#f1b5c0", fontSize: "0.7rem", margin: 0 }}>
                          {(() => { const seleccionado = partidosDisponibles.find((item) => item.key === partidoParaDesignar); const actual = seleccionado?.refereeId ? estadisticas.find((item) => item.id === seleccionado.refereeId)?.nombre || "otro árbitro" : "Sin árbitro asignado"; return `Actualmente: ${actual}. Se asignará a ${arbitro.nombre}.`; })()}
                        </p>
                      )}
                      <button type="button" className="cr-btn-gold" disabled={!partidoParaDesignar || guardandoDesignacion} onClick={guardarDesignacion} style={{ opacity: !partidoParaDesignar || guardandoDesignacion ? 0.55 : 1, padding: "0.6rem", fontSize: "0.75rem" }}>
                        {guardandoDesignacion ? "Guardando..." : "Confirmar designación"}
                      </button>
                      {mensajeDesignacion && <p role="status" style={{ color: mensajeDesignacion.includes("correctamente") ? "#86efac" : "#fca5a5", fontSize: "0.72rem", margin: 0 }}>{mensajeDesignacion}</p>}
                      {partidosDisponibles.length === 0 && <p style={{ color: "#aeb4bf", fontSize: "0.72rem", margin: 0 }}>No hay partidos disponibles en los torneos cargados.</p>}
                    </div>
                  )}
                </div>
              )}
              {canManageAccess && (
                <button
                  type="button"
                  title="Dar de baja árbitro"
                  aria-label={`Dar de baja a ${arbitro.nombre}`}
                  onClick={async (event) => {
                    event.stopPropagation();
                    if (!onDeactivateReferee) return;
                    const resultado = await onDeactivateReferee(arbitro);
                    if (resultado) {
                      setArbitroSeleccionado(null);
                      await cargarEstadisticas();
                    }
                  }}
                  style={{ position: "absolute", top: "0.65rem", right: "0.65rem", width: "34px", height: "34px", display: "grid", placeItems: "center", borderRadius: "8px", border: "1px solid #b5122a", background: "#391018", color: "#fff", cursor: "pointer", zIndex: 2 }}
                >
                  <TCIcon name="trash" size={16} />
                </button>
              )}
            </article>
          ))}
        </div>
      )}

      <p style={{ color: "#aaa", fontSize: "0.72rem", marginBottom: 0, marginTop: "1rem" }}>
        Se cuentan partidos con resultado completo y árbitro identificado. Los registros anteriores a la identificación del árbitro no se atribuyen retroactivamente.
      </p>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
        <button type="button" className="tc-form-back" onClick={onBack}>← Volver al inicio</button>
      </div>
    </div>
  );
}


function AdminStats({ onBack }) {
  const [visitas, setVisitas] = useState([]);
  const [perfiles, setPerfiles] = useState([]);
  const [torneosStats, setTorneosStats] = useState([]);
  const [errorArbitrosStats, setErrorArbitrosStats] = useState("");
  const [loadingStats, setLoadingStats] = useState(true);
  const [errorStats, setErrorStats] = useState("");
  const [busquedaJugador, setBusquedaJugador] = useState("");
  const [jugadorExpandido, setJugadorExpandido] = useState(null);
  const [fechaFiltroVisitas, setFechaFiltroVisitas] = useState(() => {
    const hoy = new Date();
    return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
  });

  const cargarEstadisticas = async () => {
    setLoadingStats(true);
    setErrorStats("");

    const [
      { data: visitasData, error: visitasError },
      { data: perfilesData, error: perfilesError },
      { data: torneosData, error: torneosError },
    ] = await Promise.all([
      supabase
        .from("visitas")
        .select(
          "id, created_at, user_id, username, email, device, started_at, last_seen_at, duration_seconds"
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("profiles")
        .select("id, username, email, created_at, role, approval_status, deactivated_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("tournaments")
        .select("*"),
    ]);

    if (visitasError || perfilesError) {
      console.error("Error al obtener estadísticas:", {
        visitasError,
        perfilesError,
      });
      setErrorStats(
        perfilesError
          ? "No se pudo cargar la lista de jugadores registrados. Revisá los permisos de lectura de profiles en Supabase."
          : "No se pudieron cargar las estadísticas de visitas."
      );
      setLoadingStats(false);
      return;
    }

    setVisitas((visitasData || []).filter((visita) => visita.user_id));
    setPerfiles(perfilesData || []);
    setTorneosStats(torneosError ? [] : (torneosData || []));
    setErrorArbitrosStats(torneosError
      ? "No se pudieron consultar los torneos para calcular las estadísticas arbitrales."
      : "");
    if (torneosError) console.error("Error al obtener torneos para estadísticas arbitrales:", torneosError);
    setLoadingStats(false);
  };

  useEffect(() => {
    cargarEstadisticas();
  }, []);

  const formatearFecha = (fecha) => {
    if (!fecha) return "-";

    return new Date(fecha).toLocaleString("es-AR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  };

  const formatearDuracion = (segundos) => {
    const total = Number(segundos || 0);

    if (total < 60) {
      return `${total}s`;
    }

    const minutos = Math.floor(total / 60);
    const segundosRestantes = total % 60;

    if (minutos < 60) {
      return `${minutos}m ${segundosRestantes}s`;
    }

    const horas = Math.floor(minutos / 60);
    const minutosRestantes = minutos % 60;

    return `${horas}h ${minutosRestantes}m`;
  };

  const esVisitaDeHoy = (visita) => {
    const fecha = new Date(visita.created_at);
    const ahora = new Date();

    return (
      fecha.getDate() === ahora.getDate() &&
      fecha.getMonth() === ahora.getMonth() &&
      fecha.getFullYear() === ahora.getFullYear()
    );
  };

  const visitasDeHoy = visitas
    .filter(esVisitaDeHoy)
    .sort(
      (a, b) =>
        new Date(b.started_at || b.created_at) -
        new Date(a.started_at || a.created_at)
    );

  const visitasHoy = visitasDeHoy.length;

  const visitasFechaSeleccionada = visitas
    .filter((visita) => {
      const fecha = new Date(visita.started_at || visita.created_at);
      if (Number.isNaN(fecha.getTime())) return false;
      const fechaLocal = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-${String(fecha.getDate()).padStart(2, "0")}`;
      return fechaLocal === fechaFiltroVisitas;
    })
    .sort(
      (a, b) =>
        new Date(b.started_at || b.created_at) -
        new Date(a.started_at || a.created_at)
    );

  const usuariosRegistrados = perfiles.length;

  const visitasMobile = visitas.filter(
    (visita) => visita.device === "mobile"
  ).length;

  const visitasDesktop = visitas.filter(
    (visita) => visita.device === "desktop"
  ).length;

  const tiempoTotal = visitas.reduce(
    (total, visita) => total + Number(visita.duration_seconds || 0),
    0
  );

  const tiempoPromedio =
    visitas.length > 0 ? Math.round(tiempoTotal / visitas.length) : 0;

  const sesionesActivas = visitas
    .filter((visita) => {
      if (!visita.last_seen_at) return false;
      const diferencia = Date.now() - new Date(visita.last_seen_at).getTime();
      return diferencia >= 0 && diferencia <= 5 * 60 * 1000;
    })
    .sort(
      (a, b) =>
        new Date(b.last_seen_at).getTime() -
        new Date(a.last_seen_at).getTime()
    )
    .filter((visita, index, lista) => {
      const clave = visita.user_id || visita.id;
      return lista.findIndex((otra) => (otra.user_id || otra.id) === clave) === index;
    });

  const usuariosActivos = sesionesActivas.length;

  // =========================================================
  // VISITAS POR DÍA
  // =========================================================

  const visitasPorDia = {};

  visitas.forEach((visita) => {
    const fecha = new Date(visita.created_at);

    const dia = fecha.toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit",
    });

    visitasPorDia[dia] = (visitasPorDia[dia] || 0) + 1;
  });

  const diasOrdenados = Object.entries(visitasPorDia).slice(0, 14);

  // =========================================================
  // VISITAS POR HORA
  // =========================================================

  const visitasPorHora = Array.from({ length: 24 }, () => 0);

  visitas.forEach((visita) => {
    const hora = new Date(visita.created_at).getHours();

    visitasPorHora[hora]++;
  });

  // =========================================================
  // JUGADORES REGISTRADOS: salen de profiles, no de visitas.
  // Así aparecen también quienes todavía nunca entraron.
  // =========================================================

  const actividadPorUsuario = {};

  visitas
    .filter((visita) => visita.user_id)
    .forEach((visita) => {
      const id = visita.user_id;

      if (!actividadPorUsuario[id]) {
        actividadPorUsuario[id] = {
          visitas: 0,
          tiempo: 0,
          ultimaVisita: null,
          device: visita.device || "",
        };
      }

      actividadPorUsuario[id].visitas += 1;
      actividadPorUsuario[id].tiempo += Number(visita.duration_seconds || 0);

      if (
        !actividadPorUsuario[id].ultimaVisita ||
        new Date(visita.created_at) >
          new Date(actividadPorUsuario[id].ultimaVisita)
      ) {
        actividadPorUsuario[id].ultimaVisita = visita.last_seen_at || visita.created_at;
        actividadPorUsuario[id].device = visita.device || actividadPorUsuario[id].device;
      }
    });

  const jugadores = [...perfiles]
    .map((perfil) => {
      const actividad = actividadPorUsuario[perfil.id] || {};

      return {
        id: perfil.id,
        username: perfil.username || "Jugador",
        email: perfil.email || "",
        creadoEn: perfil.created_at || null,
        visitas: actividad.visitas || 0,
        tiempo: actividad.tiempo || 0,
        ultimaVisita: actividad.ultimaVisita || null,
        device: actividad.device || "",
      };
    })
    .sort((a, b) =>
      a.username.localeCompare(b.username, "es", { sensitivity: "base" })
    );

  const jugadoresFiltrados = jugadores.filter((jugador) => {
    const busqueda = busquedaJugador.trim().toLocaleLowerCase("es");
    if (!busqueda) return true;
    return (
      jugador.username.toLocaleLowerCase("es").includes(busqueda) ||
      jugador.email.toLocaleLowerCase("es").includes(busqueda)
    );
  });

  // Estadísticas arbitrales: se leen los marcadores ya guardados en cada partido.
  // referee_id identifica al árbitro que realizó la última carga/corrección del resultado.
  const estadisticasArbitrosPorId = {};
  const registrarPartidoArbitrado = (match, tournament) => {
    const refereeId = match?.referee_id;
    const scoreLocal = Number(match?.score1);
    const scoreVisitante = Number(match?.score2);
    const team1 = String(match?.team1 || "").trim();
    const team2 = String(match?.team2 || "").trim();

    if (!refereeId ||
        match?.score1 === null || match?.score1 === undefined ||
        match?.score2 === null || match?.score2 === undefined ||
        !Number.isFinite(scoreLocal) || !Number.isFinite(scoreVisitante) ||
        !team1 || !team2 ||
        team1.toLocaleLowerCase("es") === "pasaje directo" ||
        team2.toLocaleLowerCase("es") === "pasaje directo") return;

    if (!estadisticasArbitrosPorId[refereeId]) {
      const perfil = perfiles.find((item) => item.id === refereeId);
      estadisticasArbitrosPorId[refereeId] = {
        id: refereeId,
        nombre: perfil?.username || "Árbitro",
        partidos: 0,
        golesLocal: 0,
        golesVisitante: 0,
        golesTotales: 0,
        porRama: {},
      };
    }

    const stats = estadisticasArbitrosPorId[refereeId];
    const partesJuego = String(tournament?.game || "").split(" · ");
    const rama = partesJuego[1] || "Sin rama";
    stats.partidos += 1;
    stats.golesLocal += scoreLocal;
    stats.golesVisitante += scoreVisitante;
    stats.golesTotales += scoreLocal + scoreVisitante;
    stats.porRama[rama] = (stats.porRama[rama] || 0) + 1;
  };

  torneosStats.forEach((tournament) => {
    (Array.isArray(tournament.groups) ? tournament.groups : []).forEach((group) => {
      (Array.isArray(group?.matches) ? group.matches : []).forEach((match) => {
        registrarPartidoArbitrado(match, tournament);
      });
    });
    (Array.isArray(tournament.playoffs) ? tournament.playoffs : []).forEach((round) => {
      (Array.isArray(round) ? round : []).forEach((match) => {
        registrarPartidoArbitrado(match, tournament);
      });
    });
  });

  // También mostramos árbitros aprobados que todavía no registraron partidos.
  perfiles
    .filter((perfil) => perfil.role === "arbitro" && perfil.approval_status === "aprobado")
    .forEach((perfil) => {
      if (!estadisticasArbitrosPorId[perfil.id]) {
        estadisticasArbitrosPorId[perfil.id] = {
          id: perfil.id,
          nombre: perfil.username || "Árbitro",
          partidos: 0,
          golesLocal: 0,
          golesVisitante: 0,
          golesTotales: 0,
          porRama: {},
        };
      }
    });

  const estadisticasArbitros = Object.values(estadisticasArbitrosPorId)
    .sort((a, b) => b.partidos - a.partidos || a.nombre.localeCompare(b.nombre, "es"));

  if (loadingStats) {
    return (
      <div
        className="cr-card tc-stats-screen"
        style={{
          maxWidth: "1000px",
          margin: "auto",
          textAlign: "center",
        }}
      >
        <h2 className="cr-title"><TCIcon name="chart" /> Estadísticas</h2>

        <p style={{ color: "#9ca3af" }}>Cargando estadísticas...</p>
      </div>
    );
  }

  if (errorStats) {
    return (
      <div
        className="cr-card tc-stats-screen"
        style={{
          maxWidth: "1000px",
          margin: "auto",
          textAlign: "center",
        }}
      >
        <h2 className="cr-title"><TCIcon name="chart" /> Estadísticas</h2>

        <p style={{ color: "#f87171" }}>{errorStats}</p>

        <button
          onClick={onBack}
          className="cr-btn-gold"
          style={{ marginTop: "1rem" }}
        >
          ← Volver
        </button>
      </div>
    );
  }

  return (
    <div
      className="tc-stats-screen"
      style={{
        width: "100%",
        maxWidth: "1100px",
        margin: "0 auto",
        paddingBottom: "2rem",
      }}
    >
      {/* HEADER */}

      <div
        className="cr-card"
        style={{
          marginBottom: "1rem",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "1rem",
            flexWrap: "wrap",
          }}
        >
          <div>
            <h2 className="cr-title" style={{ marginBottom: "4px" }}>
              <TCIcon name="chart" /> Estadísticas
            </h2>

            <p
              style={{
                color: "#9ca3af",
                margin: 0,
                fontSize: "0.8rem",
              }}
            >
              Panel privado de FEFUTIN
            </p>
          </div>

          <div
            style={{
              display: "flex",
              gap: "0.5rem",
            }}
          >
            <button
              onClick={cargarEstadisticas}
              style={{
                padding: "0.5rem 0.8rem",
                background: "#1b5fa8",
                border: "1px solid #3b82f6",
                color: "#fff",
                borderRadius: "7px",
                cursor: "pointer",
                fontWeight: "bold",
              }}
            >
              <TCIcon name="refresh" /> Actualizar
            </button>

            <button
              onClick={onBack}
              style={{
                padding: "0.5rem 0.8rem",
                background: "transparent",
                border: "1px solid #4b5563",
                color: "#d1d5db",
                borderRadius: "7px",
                cursor: "pointer",
                fontWeight: "bold",
              }}
            >
              ← Volver
            </button>
          </div>
        </div>
      </div>

      {/* RESUMEN */}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "0.75rem",
          marginBottom: "1rem",
        }}
      >
        {[
          ["eye", "Sesiones registradas", visitas.length],
          ["calendar", "Sesiones hoy", visitasHoy],
          ["users", "Jugadores", usuariosRegistrados],
          ["bolt", "Activos", usuariosActivos],
          ["clock", "Tiempo promedio", formatearDuracion(tiempoPromedio)],
        ].map(([icono, titulo, valor]) => (
          <div
            key={titulo}
            className="cr-card"
            style={{
              padding: "1rem",
              textAlign: "center",
            }}
          >
            <div className="tc-stat-icon"><TCIcon name={icono} size={23} /></div>

            <div
              style={{
                color: "#9ca3af",
                fontSize: "0.7rem",
                textTransform: "uppercase",
                fontWeight: "bold",
                marginTop: "4px",
              }}
            >
              {titulo}
            </div>

            <div
              style={{
                color: "#ffd700",
                fontSize: "1.4rem",
                fontWeight: 900,
                marginTop: "4px",
              }}
            >
              {valor}
            </div>
          </div>
        ))}
      </div>

      {/* ESTADÍSTICAS DE ÁRBITROS */}
      <div className="cr-card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ color: "#fff", marginTop: 0, marginBottom: "0.45rem" }}>
          <TCIcon name="chart" /> Estadísticas de árbitros
        </h3>
        <p style={{ color: "#9ca3af", fontSize: "0.75rem", marginTop: 0 }}>
          Se cuentan los partidos con resultado completo y árbitro identificado. Los resultados cargados antes de registrar al árbitro no se atribuyen retroactivamente.
        </p>

        {errorArbitrosStats ? (
          <p style={{ color: "#f87171" }}>{errorArbitrosStats}</p>
        ) : estadisticasArbitros.length === 0 ? (
          <p style={{ color: "#9ca3af" }}>Todavía no hay partidos registrados por árbitros.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: "620px", borderCollapse: "collapse", color: "#fff", fontSize: "0.8rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #4b5563", color: "#d1d5db", textAlign: "left" }}>
                  <th style={{ padding: "0.65rem 0.45rem" }}>Árbitro</th>
                  <th style={{ padding: "0.65rem 0.45rem", textAlign: "center" }}>Partidos</th>
                  <th style={{ padding: "0.65rem 0.45rem" }}>Ramas</th>
                  <th style={{ padding: "0.65rem 0.45rem", textAlign: "center" }}>Goles local</th>
                  <th style={{ padding: "0.65rem 0.45rem", textAlign: "center" }}>Goles visitante</th>
                  <th style={{ padding: "0.65rem 0.45rem", textAlign: "center" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {estadisticasArbitros.map((arbitro) => (
                  <tr key={arbitro.id} style={{ borderBottom: "1px solid #2d2b3b" }}>
                    <td style={{ padding: "0.7rem 0.45rem", fontWeight: 800 }}>{arbitro.nombre}</td>
                    <td style={{ padding: "0.7rem 0.45rem", textAlign: "center", color: "#facc15", fontWeight: 900 }}>{arbitro.partidos}</td>
                    <td style={{ padding: "0.7rem 0.45rem", color: "#d1d5db" }}>
                      {Object.entries(arbitro.porRama).length
                        ? Object.entries(arbitro.porRama).map(([rama, cantidad]) => `${rama}: ${cantidad}`).join(" · ")
                        : "Sin partidos"}
                    </td>
                    <td style={{ padding: "0.7rem 0.45rem", textAlign: "center" }}>{arbitro.golesLocal}</td>
                    <td style={{ padding: "0.7rem 0.45rem", textAlign: "center" }}>{arbitro.golesVisitante}</td>
                    <td style={{ padding: "0.7rem 0.45rem", textAlign: "center", color: "#facc15", fontWeight: 900 }}>{arbitro.golesTotales}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* DISPOSITIVOS */}

      <div
        className="cr-card"
        style={{
          marginBottom: "1rem",
        }}
      >
        <h3
          style={{
            color: "#fff",
            marginTop: 0,
            marginBottom: "1rem",
          }}
        >
          <TCIcon name="devices" /> Dispositivos
        </h3>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "1rem",
          }}
        >
          <div
            style={{
              padding: "1rem",
              background: "#121019",
              borderRadius: "8px",
              textAlign: "center",
            }}
          >
            <div className="tc-stat-icon"><TCIcon name="mobile" size={25} /></div>

            <strong
              style={{
                color: "#fff",
                display: "block",
                marginTop: "5px",
              }}
            >
              Mobile
            </strong>

            <span style={{ color: "#9ca3af" }}>{visitasMobile} visitas</span>
          </div>

          <div
            style={{
              padding: "1rem",
              background: "#121019",
              borderRadius: "8px",
              textAlign: "center",
            }}
          >
            <div className="tc-stat-icon"><TCIcon name="desktop" size={25} /></div>

            <strong
              style={{
                color: "#fff",
                display: "block",
                marginTop: "5px",
              }}
            >
              Desktop
            </strong>

            <span style={{ color: "#9ca3af" }}>{visitasDesktop} visitas</span>
          </div>
        </div>
      </div>

      {/* VISITAS POR DÍA */}

      <div
        className="cr-card"
        style={{
          marginBottom: "1rem",
        }}
      >
        <h3
          style={{
            color: "#fff",
            marginTop: 0,
            marginBottom: "1rem",
          }}
        >
          <TCIcon name="calendar" /> Visitas por día
        </h3>

        {diasOrdenados.length === 0 ? (
          <p style={{ color: "#9ca3af" }}>Todavía no hay datos.</p>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.45rem",
            }}
          >
            {diasOrdenados.map(([dia, cantidad]) => (
              <div
                key={dia}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                }}
              >
                <span
                  style={{
                    width: "55px",
                    color: "#d1d5db",
                    fontSize: "0.8rem",
                  }}
                >
                  {dia}
                </span>

                <div
                  style={{
                    flex: 1,
                    height: "22px",
                    background: "#121019",
                    borderRadius: "5px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(
                        100,
                        (cantidad /
                          Math.max(
                            1,
                            Math.max(...Object.values(visitasPorDia))
                          )) *
                          100
                      )}%`,
                      height: "100%",
                      background: "linear-gradient(90deg, #1b5fa8, #60a5fa)",
                    }}
                  />
                </div>

                <strong
                  style={{
                    width: "30px",
                    textAlign: "right",
                    color: "#ffd700",
                  }}
                >
                  {cantidad}
                </strong>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* VISITAS POR HORA */}

      <div
        className="cr-card"
        style={{
          marginBottom: "1rem",
        }}
      >
        <h3
          style={{
            color: "#fff",
            marginTop: 0,
            marginBottom: "1rem",
          }}
        >
          🕐 Visitas por horario
        </h3>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(55px, 1fr))",
            gap: "0.4rem",
          }}
        >
          {visitasPorHora.map((cantidad, hora) => (
            <div
              key={hora}
              style={{
                background: "#121019",
                borderRadius: "6px",
                padding: "0.5rem 0.2rem",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  color: "#9ca3af",
                  fontSize: "0.65rem",
                }}
              >
                {String(hora).padStart(2, "0")}h
              </div>

              <strong
                style={{
                  color: cantidad > 0 ? "#ffd700" : "#4b5563",
                  fontSize: "0.9rem",
                }}
              >
                {cantidad}
              </strong>
            </div>
          ))}
        </div>
      </div>

      {/* JUGADORES REGISTRADOS */}

      <div className="cr-card" style={{ marginBottom: "1rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.75rem",
            flexWrap: "wrap",
            marginBottom: "1rem",
          }}
        >
          <h3 style={{ color: "#fff", margin: 0 }}><TCIcon name="users" /> Jugadores registrados</h3>
          <span style={{ color: "#9ca3af", fontSize: "0.8rem" }}>
            {jugadores.length} cuentas
          </span>
        </div>

        <input
          type="search"
          value={busquedaJugador}
          onChange={(e) => setBusquedaJugador(e.target.value)}
          placeholder="Buscar por alias o correo..."
          aria-label="Buscar jugador por alias o correo"
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "0.75rem",
            marginBottom: "1rem",
            borderRadius: "8px",
            border: "1px solid #3b82f6",
            background: "#121019",
            color: "#fff",
            outline: "none",
          }}
        />

        {jugadoresFiltrados.length === 0 ? (
          <p style={{ color: "#9ca3af" }}>
            {jugadores.length === 0
              ? "No hay jugadores registrados."
              : "No hay jugadores que coincidan con la búsqueda."}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {jugadoresFiltrados.map((jugador, index) => (
              <div
                key={jugador.id}
                style={{
                  background: "#121019",
                  border: "1px solid #2d2b3b",
                  borderRadius: "8px",
                  padding: "0.75rem",
                  display: "grid",
                  gridTemplateColumns: "30px minmax(0, 1fr) repeat(2, auto)",
                  gap: "0.75rem",
                  alignItems: "center",
                }}
              >
                <strong style={{ color: "#ffd700" }}>#{index + 1}</strong>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ color: "#fff", display: "block", overflowWrap: "anywhere" }}>
                    {jugador.username}
                  </strong>
                  <span style={{ color: "#60a5fa", fontSize: "0.75rem", display: "block", overflowWrap: "anywhere" }}>
                    <TCIcon name="mail" size={13} /> {jugador.email || "Email no registrado"}
                  </span>
                  <span style={{ color: "#9ca3af", fontSize: "0.7rem", display: "block", marginTop: "3px" }}>
                    Registro: {formatearFecha(jugador.creadoEn)}
                  </span>
                  <span style={{ color: "#9ca3af", fontSize: "0.7rem", display: "block", marginTop: "2px" }}>
                    Última visita: {formatearFecha(jugador.ultimaVisita)}
                  </span>
                </div>
                <div style={{ textAlign: "center" }}>
                  <span style={{ color: "#9ca3af", fontSize: "0.65rem", display: "block" }}>Visitas</span>
                  <strong style={{ color: "#60a5fa" }}>{jugador.visitas}</strong>
                </div>
                <div style={{ textAlign: "center" }}>
                  <span style={{ color: "#9ca3af", fontSize: "0.65rem", display: "block" }}>Dispositivo</span>
                  <span>{jugador.device === "mobile" ? <TCIcon name="mobile" size={16} /> : jugador.device === "desktop" ? <TCIcon name="desktop" size={16} /> : "—"}</span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setJugadorExpandido(
                      jugadorExpandido === jugador.id ? null : jugador.id
                    )
                  }
                  aria-expanded={jugadorExpandido === jugador.id}
                  style={{
                    gridColumn: "2 / -1",
                    justifySelf: "start",
                    padding: "0.45rem 0.7rem",
                    borderRadius: "6px",
                    border: "1px solid #3b82f6",
                    background: "rgba(27, 95, 168, 0.25)",
                    color: "#bfdbfe",
                    cursor: "pointer",
                    fontWeight: "bold",
                    fontSize: "0.75rem",
                  }}
                >
                  {jugadorExpandido === jugador.id
                    ? "▲ Ocultar actividad"
                    : <><TCIcon name="chart" size={14} /> Ver actividad</>}
                </button>
                {jugadorExpandido === jugador.id && (
                  <div
                    style={{
                      gridColumn: "1 / -1",
                      borderTop: "1px solid #2d2b3b",
                      paddingTop: "0.75rem",
                      marginTop: "0.25rem",
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                        gap: "0.5rem",
                        marginBottom: "0.75rem",
                      }}
                    >
                      <div style={{ background: "#1b1a25", borderRadius: "6px", padding: "0.6rem" }}>
                        <span style={{ color: "#9ca3af", fontSize: "0.7rem", display: "block" }}>Tiempo acumulado</span>
                        <strong style={{ color: "#ffd700" }}>{formatearDuracion(jugador.tiempo)}</strong>
                      </div>
                      <div style={{ background: "#1b1a25", borderRadius: "6px", padding: "0.6rem" }}>
                        <span style={{ color: "#9ca3af", fontSize: "0.7rem", display: "block" }}>Sesiones registradas</span>
                        <strong style={{ color: "#60a5fa" }}>{jugador.visitas}</strong>
                      </div>
                    </div>
                    {visitas
                      .filter((visita) => visita.user_id === jugador.id)
                      .sort(
                        (a, b) =>
                          new Date(b.started_at || b.created_at) -
                          new Date(a.started_at || a.created_at)
                      ).length === 0 ? (
                        <p style={{ color: "#9ca3af", fontSize: "0.8rem", marginBottom: 0 }}>
                          Este jugador todavía no tiene visitas registradas.
                        </p>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                          {visitas
                            .filter((visita) => visita.user_id === jugador.id)
                            .sort(
                              (a, b) =>
                                new Date(b.started_at || b.created_at) -
                                new Date(a.started_at || a.created_at)
                            )
                            .map((visita) => (
                              <div
                                key={visita.id}
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  flexWrap: "wrap",
                                  gap: "0.5rem",
                                  padding: "0.6rem",
                                  borderRadius: "6px",
                                  background: "#121019",
                                }}
                              >
                                <div>
                                  <span style={{ color: "#d1d5db", display: "block", fontSize: "0.78rem" }}>
                                    <TCIcon name="calendar" size={13} /> {formatearFecha(visita.started_at || visita.created_at)}
                                  </span>
                                  <span style={{ color: "#9ca3af", fontSize: "0.7rem" }}>
                                    Última actividad: {formatearFecha(visita.last_seen_at)}
                                  </span>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                  <span style={{ color: "#60a5fa", display: "block", fontSize: "0.75rem" }}>
                                    {visita.device === "mobile" ? <><TCIcon name="mobile" size={13} /> Móvil</> : visita.device === "desktop" ? <><TCIcon name="desktop" size={13} /> PC</> : "Dispositivo —"}
                                  </span>
                                  <span style={{ color: "#9ca3af", fontSize: "0.7rem" }}>
                                    Duración: {formatearDuracion(visita.duration_seconds)}
                                  </span>
                                </div>
                              </div>
                            ))}
                        </div>
                      )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ACTIVIDAD RECIENTE */}

      <div className="cr-card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ color: "#fff", marginTop: 0, marginBottom: "1rem" }}>
          <TCIcon name="bolt" /> Quiénes están conectados
        </h3>
        <p style={{ color: "#9ca3af", fontSize: "0.75rem", marginTop: "-0.5rem" }}>
          Actividad registrada durante los últimos 5 minutos.
        </p>

        {sesionesActivas.length === 0 ? (
          <p style={{ color: "#9ca3af" }}>No hay actividad reciente registrada.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {sesionesActivas.map((visita) => (
              <div
                key={visita.user_id || visita.id}
                style={{
                  background: "#121019",
                  border: "1px solid #2d2b3b",
                  borderRadius: "8px",
                  padding: "0.75rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "0.75rem",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <strong style={{ color: "#fff", display: "block" }}>
                    {visita.username || "Visitante anónimo"}
                  </strong>
                  <span style={{ color: "#9ca3af", fontSize: "0.75rem" }}>
                    {visita.email || (visita.user_id ? "Email no registrado" : "Sin iniciar sesión")}
                  </span>
                </div>
                <span style={{ color: "#34d399", fontSize: "0.75rem" }}>
                  ● Activo · {formatearFecha(visita.last_seen_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* HISTORIAL DE VISITAS POR FECHA */}

      <div className="cr-card">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.75rem",
            flexWrap: "wrap",
            marginBottom: "1rem",
          }}
        >
          <h3 style={{ color: "#fff", margin: 0 }}>
            <TCIcon name="calendar" /> Historial de visitas ({visitasFechaSeleccionada.length})
          </h3>
          <label style={{ color: "#d1d5db", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            Fecha:
            <input
              type="date"
              value={fechaFiltroVisitas}
              onChange={(e) => setFechaFiltroVisitas(e.target.value)}
              aria-label="Filtrar historial por fecha"
              style={{
                padding: "0.5rem",
                borderRadius: "6px",
                border: "1px solid #3b82f6",
                background: "#121019",
                color: "#fff",
                colorScheme: "dark",
              }}
            />
          </label>
        </div>

        {visitasFechaSeleccionada.length === 0 ? (
          <p style={{ color: "#9ca3af" }}>No hay visitas registradas para esta fecha.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {visitasFechaSeleccionada.map((visita) => (
              <div
                key={visita.id}
                style={{
                  background: "#121019",
                  border: "1px solid #2d2b3b",
                  borderRadius: "8px",
                  padding: "0.75rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "0.75rem",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <strong style={{ color: "#fff", display: "block" }}>
                    {visita.username || "Visitante anónimo"}
                  </strong>
                  <span style={{ color: "#9ca3af", fontSize: "0.75rem", overflowWrap: "anywhere" }}>
                    {visita.email || (visita.user_id ? "Email no registrado" : "Sin iniciar sesión")}
                  </span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ color: "#60a5fa", fontSize: "0.75rem", display: "block" }}>
                    {formatearFecha(visita.started_at || visita.created_at)}
                  </span>
                  <span style={{ color: "#9ca3af", fontSize: "0.7rem" }}>
                    {visita.device === "mobile" ? <><TCIcon name="mobile" size={13} /> Móvil</> : visita.device === "desktop" ? <><TCIcon name="desktop" size={13} /> PC</> : "Dispositivo desconocido"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FefutinVisitorPromoCarousel() {
  const [activeSlide, setActiveSlide] = useState(0);
  const [paused, setPaused] = useState(false);

  const slides = [
    {
      eyebrow: "FEFUTIN · TODO EN UN LUGAR",
      title: "SEGUÍ CADA COMPETENCIA",
      description: "Consultá torneos, fixtures, resultados y tablas desde una sola app.",
      symbol: "⚽",
      accent: "red",
      footer: "TORNEOS · FIXTURES · RESULTADOS",
    },
    {
      eyebrow: "EL GOL TIENE SU LUGAR",
      title: "TABLA DE GOLEADORES",
      description: "Descubrí cómo se vive la emoción del gol en nuestras competencias.",
      symbol: "🥅",
      accent: "gold",
      footer: "ESTADÍSTICAS DE COMPETENCIA",
    },
    {
      eyebrow: "UNA GRAN FAMILIA",
      title: "MÁS DE 50 CLUBES",
      description: "Clubes y comunidades unidos por la pasión y el crecimiento del fútbol.",
      symbol: "🛡️",
      accent: "white",
      footer: "MÁS CLUBES · MÁS ENCUENTROS · MÁS PASIÓN",
    },
    {
      eyebrow: "PASIÓN, FORMACIÓN Y COMPETENCIA",
      title: "HISTORIA QUE NOS RESPALDA",
      description: "Una trayectoria que nos impulsa a seguir construyendo competencia permanente.",
      symbol: "🏆",
      accent: "red",
      footer: "TRADICIÓN QUE SIGUE EN JUEGO",
    },
  ];

  useEffect(() => {
    if (paused) return undefined;
    const timer = window.setInterval(() => {
      setActiveSlide((current) => (current + 1) % slides.length);
    }, 5200);
    return () => window.clearInterval(timer);
  }, [paused, slides.length]);

  const moveSlide = (direction) => {
    setActiveSlide((current) => (current + direction + slides.length) % slides.length);
  };

  return (
    <section
      className="fefutin-visitor-promo"
      aria-label="Conocé FEFUTIN"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setPaused(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") setPaused(false);
      }}
    >
      <style>{`
        .fefutin-visitor-promo{position:relative;width:100%;margin:1.15rem 0 1.35rem;overflow:hidden;border:1px solid rgba(181,18,42,.8);border-radius:18px;background:linear-gradient(135deg,#10131a 0%,#171c27 65%,#260b12 100%);box-shadow:0 12px 28px rgba(0,0,0,.24);color:#fff}
        .fefutin-visitor-promo-head{display:flex;align-items:center;justify-content:space-between;gap:.7rem;padding:.8rem 1rem .25rem}
        .fefutin-visitor-promo-label{font-size:.67rem;font-weight:900;letter-spacing:.16em;color:#f3a0ad}
        .fefutin-visitor-promo-controls{display:flex;gap:.4rem}
        .fefutin-visitor-promo-controls button{width:31px;height:31px;display:grid;place-items:center;padding:0;border:1px solid rgba(255,255,255,.3);border-radius:50%;background:#202632;color:#fff;font-size:1.1rem;cursor:pointer}
        .fefutin-visitor-promo-controls button:hover,.fefutin-visitor-promo-controls button:focus-visible{background:#b5122a;border-color:#fff;outline:none}
        .fefutin-visitor-promo-window{overflow:hidden}
        .fefutin-visitor-promo-track{display:flex;transition:transform 650ms cubic-bezier(.22,.75,.25,1);will-change:transform}
        .fefutin-visitor-promo-slide{position:relative;box-sizing:border-box;flex:0 0 100%;min-width:0;min-height:205px;display:grid;grid-template-columns:minmax(0,1fr) 112px;align-items:center;gap:1rem;padding:1.2rem 1.25rem 1.1rem}
        .fefutin-visitor-promo-slide:before{content:"";position:absolute;inset:auto -35px -80px auto;width:210px;height:210px;border:1px solid rgba(255,255,255,.08);border-radius:50%;pointer-events:none}
        .fefutin-visitor-promo-copy{position:relative;z-index:1;min-width:0}
        .fefutin-visitor-promo-eyebrow{display:block;margin-bottom:.45rem;color:#f3a0ad;font-size:.66rem;font-weight:900;letter-spacing:.11em}
        .fefutin-visitor-promo-title{display:block;margin:0;color:#fff;font-size:clamp(1.05rem,3.5vw,1.55rem);font-weight:1000;line-height:1.12;letter-spacing:.015em}
        .fefutin-visitor-promo-description{max-width:490px;margin:.55rem 0 0;color:#e5e7eb;font-size:.83rem;line-height:1.5}
        .fefutin-visitor-promo-footer{display:block;margin-top:.85rem;color:#f3a0ad;font-size:.61rem;font-weight:900;letter-spacing:.09em}
        .fefutin-visitor-promo-art{position:relative;z-index:1;width:104px;height:104px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.35);border-radius:24px;background:linear-gradient(145deg,rgba(181,18,42,.9),rgba(23,28,39,.96));box-shadow:0 10px 22px rgba(0,0,0,.3);font-size:3.15rem;transform:rotate(4deg)}
        .fefutin-visitor-promo-slide[data-accent="gold"] .fefutin-visitor-promo-art{background:linear-gradient(145deg,#6d4b12,#171c27);border-color:#e9c46a}
        .fefutin-visitor-promo-slide[data-accent="white"] .fefutin-visitor-promo-art{background:linear-gradient(145deg,#f8fafc,#9ca3af);color:#171c27;border-color:#fff}
        .fefutin-visitor-promo-bottom{display:flex;align-items:center;justify-content:center;gap:.42rem;padding:0 1rem .85rem}
        .fefutin-visitor-promo-dot{width:7px;height:7px;padding:0;border:0;border-radius:99px;background:#6b7280;cursor:pointer;transition:width 250ms ease,background 250ms ease}
        .fefutin-visitor-promo-dot[aria-current="true"]{width:23px;background:#b5122a}
        .fefutin-visitor-promo-dot:focus-visible{outline:2px solid #fff;outline-offset:3px}
        @media(max-width:480px){.fefutin-visitor-promo-slide{min-height:190px;grid-template-columns:minmax(0,1fr) 78px;gap:.6rem;padding:1rem .85rem}.fefutin-visitor-promo-art{width:72px;height:72px;border-radius:18px;font-size:2.35rem}.fefutin-visitor-promo-title{font-size:1.05rem}.fefutin-visitor-promo-description{font-size:.75rem}.fefutin-visitor-promo-footer{font-size:.55rem;line-height:1.35}.fefutin-visitor-promo-head{padding:.7rem .8rem .15rem}}
        @media(prefers-reduced-motion:reduce){.fefutin-visitor-promo-track,.fefutin-visitor-promo-dot{transition:none}}
      `}</style>
      <div className="fefutin-visitor-promo-head">
        <span className="fefutin-visitor-promo-label">DESCUBRÍ FEFUTIN</span>
        <div className="fefutin-visitor-promo-controls" aria-label="Controles del carrusel">
          <button type="button" onClick={() => moveSlide(-1)} aria-label="Card anterior">‹</button>
          <button type="button" onClick={() => moveSlide(1)} aria-label="Card siguiente">›</button>
        </div>
      </div>
      <div className="fefutin-visitor-promo-window" aria-live="off">
        <div className="fefutin-visitor-promo-track" style={{ transform: `translateX(-${activeSlide * 100}%)` }}>
          {slides.map((slide, index) => (
            <article className="fefutin-visitor-promo-slide" data-accent={slide.accent} key={slide.title} aria-hidden={activeSlide !== index}>
              <div className="fefutin-visitor-promo-copy">
                <span className="fefutin-visitor-promo-eyebrow">{slide.eyebrow}</span>
                <h3 className="fefutin-visitor-promo-title">{slide.title}</h3>
                <p className="fefutin-visitor-promo-description">{slide.description}</p>
                <span className="fefutin-visitor-promo-footer">{slide.footer}</span>
              </div>
              <div className="fefutin-visitor-promo-art" aria-hidden="true">{slide.symbol}</div>
            </article>
          ))}
        </div>
      </div>
      <div className="fefutin-visitor-promo-bottom" aria-label="Seleccionar card">
        {slides.map((slide, index) => (
          <button
            type="button"
            className="fefutin-visitor-promo-dot"
            key={slide.title}
            aria-label={`Mostrar card ${index + 1}: ${slide.title}`}
            aria-current={activeSlide === index ? "true" : "false"}
            onClick={() => setActiveSlide(index)}
          />
        ))}
      </div>
    </section>
  );
}

export function TournamenSportApp() {
  const {
    notice,
    showNotice,
    clearNotice,
    confirmation,
    confirmTournament,
    resolveConfirmation,
  } = useTournamentNotice();
  const [currentUser, setCurrentUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [pendingAccessRequests, setPendingAccessRequests] = useState([]);
  const [pendingPlayerApprovalsCount, setPendingPlayerApprovalsCount] = useState(0);
  const [pendingClubTournamentRequestsCount, setPendingClubTournamentRequestsCount] = useState(0);
  const [loadingAccessRequests, setLoadingAccessRequests] = useState(false);
  const [accessActionError, setAccessActionError] = useState("");
  const [refereeApprovalForms, setRefereeApprovalForms] = useState({});
  const [processingAccessId, setProcessingAccessId] = useState(null);
  const [activeClubs, setActiveClubs] = useState([]);
  const [loadingActiveClubs, setLoadingActiveClubs] = useState(false);
  const [removingClubTournamentId, setRemovingClubTournamentId] = useState(null);
  const [activeReferees, setActiveReferees] = useState([]);
  const [loadingActiveReferees, setLoadingActiveReferees] = useState(false);
  const [deactivatingRefereeId, setDeactivatingRefereeId] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [authInput, setAuthInput] = useState({ email: "", password: "" });
  const [authMode, setAuthMode] = useState("login");
  const [registerInput, setRegisterInput] = useState({ username: "", requestedRole: "arbitro" });
  const [activeView, setActiveView] = useState("home");
  const [managementInboxTab, setManagementInboxTab] = useState("torneos");
  const [showWhoWeAre, setShowWhoWeAre] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [activeTournament, setActiveTournament] = useState(null);
  const [refereeMatchToOpen, setRefereeMatchToOpen] = useState(null);
  const [topScorersReturnView, setTopScorersReturnView] = useState("groups");
  const [fefutinTournamentClubs, setFefutinTournamentClubs] = useState([]);
  const [referenteParticipations, setReferenteParticipations] = useState([]);
  const [referenteMatchClubs, setReferenteMatchClubs] = useState([]);
  const [loadingFefutinTournamentClubs, setLoadingFefutinTournamentClubs] = useState(false);
  const [showChampionCard, setShowChampionCard] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [tournaments, setTournaments] = useState([]);
  const [tournamentCategoryFilter, setTournamentCategoryFilter] = useState("Todas");
  const [tournamentDivisionFilter, setTournamentDivisionFilter] = useState("Todas");
  const [divisionCategorySearch, setDivisionCategorySearch] = useState("");
  const [activeDivisionTournamentIndex, setActiveDivisionTournamentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [editingTournament, setEditingTournament] = useState(false);
  const [deletingTournamentId, setDeletingTournamentId] = useState(null);
  const [registeredProfiles, setRegisteredProfiles] = useState([]);
  const [loadingRegisteredProfiles, setLoadingRegisteredProfiles] = useState(false);
  const [registeredProfilesSearch, setRegisteredProfilesSearch] = useState("");
  const [selectedRegisteredProfileIds, setSelectedRegisteredProfileIds] = useState([]);
  const isAdmin = currentUser?.role === "admin";
  const isDirectivo = currentUser?.role === "directivo";
  const isArbitro = currentUser?.role === "arbitro";
  const isReferente = currentUser?.role === "referente";
  const isPublicVisitor = !currentUser || currentUser?.role === "visitante";
  const canAccessClubManagement =
    isAdmin || isDirectivo ||
    (isReferente && currentUser?.approvalStatus === "aprobado");
  const canManageTournaments = isAdmin || isDirectivo;
  const canViewStatistics = isAdmin;
  const canViewRefereeStats = isAdmin || isDirectivo || isArbitro;
  const canDeleteTournaments = isAdmin || isDirectivo;
  const canManageAccess = isAdmin || isDirectivo;
  const [catalogSeeded, setCatalogSeeded] = useState(false);

  const saveTeamsToCatalog = async (teams) => {
    const uniqueTeams = [...new Map(
      (teams || [])
        .map((name) => String(name || "").trim())
        .filter(Boolean)
        .map((name) => [name.toLocaleLowerCase("es"), name])
    ).values()];

    if (!uniqueTeams.length) return null;

    const { error } = await supabase
      .from("teams_catalog")
      .upsert(
        uniqueTeams.map((name) => ({ name })),
        { onConflict: "normalized_name", ignoreDuplicates: true }
      );

    if (error) console.error("No se pudo actualizar el catálogo histórico de equipos:", error);
    return error;
  };

  useEffect(() => {
    if (!isAdmin || catalogSeeded || !tournaments.length) return;

    const historicalTeams = tournaments.flatMap((tournament) =>
      (Array.isArray(tournament?.groups) ? tournament.groups : []).flatMap((group) =>
        Array.isArray(group?.teams) ? group.teams : []
      )
    );

    if (!historicalTeams.length) {
      setCatalogSeeded(true);
      return;
    }

    saveTeamsToCatalog(historicalTeams).then((error) => {
      if (!error) setCatalogSeeded(true);
    });
  }, [isAdmin, tournaments, catalogSeeded]);

  useEffect(() => {
    if (!authReady) return;
    if (!canManageAccess && activeView === "access-requests") setActiveView("home");
    if ((!canManageTournaments && ["create", "edit", "join"].includes(activeView)) ||
        (!canViewStatistics && activeView === "stats") ||
        (!canViewRefereeStats && activeView === "referee-stats") ||
        (!canAccessClubManagement && ["referente-inscripcion", "referente-equipos", "referente-torneos", "referente-solicitar-torneo"].includes(activeView)) ||
        (!isArbitro && activeView === "referee-carnets") ||
        (!canManageAccess && activeView === "referee-carnet-directory") ||
        (!canManageAccess && activeView === "sheet-archive") ||
        (!isArbitro && activeView === "referee-sheet-photo")) {
      setActiveView("home");
      setActiveTournament(null);
    }
  }, [authReady, isAdmin, canManageTournaments, canViewStatistics, canViewRefereeStats, canManageAccess, canAccessClubManagement, isArbitro, activeView]);

  useEffect(() => {
    document.documentElement.dataset.tcTheme = "clash";
    document.body.dataset.tcTheme = "clash";
    try {
      localStorage.removeItem("tc_visual_theme");
    } catch {
      // El tema Clash queda como opción fija aunque el almacenamiento esté bloqueado.
    }
  }, []);

  // =========================================================
  // RECUPERAR SESIÓN
  // =========================================================

  useEffect(() => {
    let mounted = true;

    const loadCurrentUser = async () => {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (error) {
        console.error("Error al recuperar sesión:", error);
        if (mounted) setAuthReady(true);
        return;
      }

      if (!session?.user) {
        if (mounted) {
          setCurrentUser(null);
          setAuthReady(true);
        }
        return;
      }

      const user = await buildCurrentUser(session.user);

      if (!user) {
        if (mounted) {
          setCurrentUser(null);
          setAuthReady(true);
        }
        await supabase.auth.signOut();
        return;
      }

      if (mounted) {
        setCurrentUser(user);
        setAuthReady(true);
      }
    };

    loadCurrentUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // La carga inicial ya la resuelve getSession() y el inicio de sesión
      // lo resuelve handleAuthSubmit(). Evitamos ejecutar buildCurrentUser()
      // dos veces en paralelo para esos mismos eventos.
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN") return;

      if (!session?.user) {
        if (mounted) {
          setCurrentUser(null);
          setAuthReady(true);
        }
        return;
      }

      // No ejecutar consultas a Supabase dentro de onAuthStateChange:
      // el callback se dispara mientras el cliente gestiona el bloqueo de auth.
      // Diferimos la carga del perfil para evitar bloquear el inicio/cambio de sesión.
      const authUser = session.user;
      setTimeout(async () => {
        if (!mounted) return;

        const user = await buildCurrentUser(authUser);
        if (mounted) {
          setCurrentUser(user);
          setAuthReady(true);
        }
        if (!user && mounted) await supabase.auth.signOut();
      }, 0);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const buildCurrentUser = async (authUser) => {
    if (!authUser) return null;

    const [{ data: profile, error: profileError }, { data: accessRows, error: accessError }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, username, email, club_id")
        .eq("id", authUser.id)
        .maybeSingle(),
      supabase.rpc("get_my_fefutin_access"),
    ]);

    if (profileError || accessError) {
      console.error("Error al obtener perfil o permisos:", { profileError, accessError });
      return null;
    }

    const access = Array.isArray(accessRows) ? accessRows[0] : null;
    if (!profile || !access || access.approval_status === "baja" || access.deactivated_at) {
      return null;
    }

    return {
      id: authUser.id,
      username: profile.username || authUser.user_metadata?.username || "Jugador",
      email: authUser.email || profile.email || "",
      clubId: profile.club_id || null,
      role: access.role || "visitante",
      requestedRole: access.requested_role || null,
      approvalStatus: access.approval_status || "aprobado",
      approvedAt: access.approved_at || null,
    };
  };

  useEffect(() => {
    if (canManageAccess) {
      loadActiveReferees();
      loadActiveClubs();
    } else {
      setActiveReferees([]);
      setActiveClubs([]);
    }
  }, [canManageAccess, currentUser?.id]);

  useEffect(() => {
    if (!canManageAccess) {
      setPendingAccessRequests([]);
      setPendingPlayerApprovalsCount(0);
      setPendingClubTournamentRequestsCount(0);
      return;
    }

    // El buzón de Admin tiene sus propias consultas. Pausamos el sondeo
    // del resumen mientras está abierto para no duplicar la carga de jugadores.
    if (activeView === "access-requests") return;

    let cancelled = false;
    const loadPendingOverview = async () => {
      if (!cancelled) await refreshPendingRequests();
    };

    loadPendingOverview();
    const intervalId = window.setInterval(loadPendingOverview, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [canManageAccess, currentUser?.id, activeView]);

  const loadActiveClubs = async () => {
    if (!canManageAccess) return;
    setLoadingActiveClubs(true);
    const { data, error } = await supabase.rpc("get_fefutin_active_clubs");
    if (error) {
      console.error("Error al cargar clubes habilitados:", error);
      setAccessActionError(error.message || "No se pudieron cargar los clubes habilitados.");
    } else setActiveClubs(data || []);
    setLoadingActiveClubs(false);
  };

  const handleRemoveClubTournament = async (club, tournament) => {
    if (!canManageAccess || !tournament?.id || removingClubTournamentId) return;
    const confirmado = window.confirm(
      `¿Querés quitar la inscripción de ${club.club_name} en "${tournament.title}"? El club y sus demás torneos seguirán habilitados.`
    );
    if (!confirmado) return;
    setRemovingClubTournamentId(tournament.id);
    const { error } = await supabase.rpc("remove_fefutin_club_tournament", { p_club_tournament_id: tournament.id });
    if (error) setAccessActionError(error.message || "No se pudo quitar la inscripción del torneo.");
    else {
      setAccessActionError("");
      await loadActiveClubs();
      showNotice("La inscripción del club en ese torneo fue quitada. El club continúa habilitado.");
    }
    setRemovingClubTournamentId(null);
  };

  const refreshPendingRequests = async () => {
    if (!canManageAccess) return;
    setLoadingAccessRequests(true);

    const [
      { data: accessRows, error: accessError },
      { data: pendingPlayers, error: pendingPlayersError },
      { data: pendingClubTournamentRequests, error: pendingClubTournamentRequestsError },
    ] = await Promise.all([
      supabase.rpc("get_fefutin_pending_requests"),
      supabase.rpc("get_fefutin_pending_players"),
      supabase.rpc("get_fefutin_pending_club_tournament_requests"),
    ]);

    if (accessError) {
      console.error("Error al actualizar solicitudes de acceso:", accessError);
      setAccessActionError(accessError.message || "No se pudieron actualizar las solicitudes.");
    } else {
      setPendingAccessRequests(accessRows || []);
    }

    if (pendingPlayersError) {
      console.error("Error al consultar altas pendientes de jugadores:", pendingPlayersError);
      setAccessActionError((current) => current || pendingPlayersError.message || "No se pudieron consultar las altas de jugadores.");
      setPendingPlayerApprovalsCount(0);
    } else {
      setPendingPlayerApprovalsCount(Array.isArray(pendingPlayers) ? pendingPlayers.length : 0);
    }

    if (pendingClubTournamentRequestsError) {
      console.error("Error al consultar solicitudes de participación en torneos:", pendingClubTournamentRequestsError);
      setAccessActionError((current) => current || pendingClubTournamentRequestsError.message || "No se pudieron consultar las solicitudes de participación.");
      setPendingClubTournamentRequestsCount(0);
    } else {
      setPendingClubTournamentRequestsCount(Array.isArray(pendingClubTournamentRequests) ? pendingClubTournamentRequests.length : 0);
    }

    if (!accessError && !pendingPlayersError && !pendingClubTournamentRequestsError) setAccessActionError("");
    setLoadingAccessRequests(false);
  };

  const loadActiveReferees = async () => {
    if (!canManageAccess) return;
    setLoadingActiveReferees(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, email")
      .eq("role", "arbitro")
      .eq("approval_status", "aprobado")
      .is("deactivated_at", null)
      .order("username", { ascending: true });

    if (error) {
      console.error("Error al cargar árbitros activos:", error);
      setAccessActionError("No se pudo cargar la lista de árbitros activos.");
    } else {
      setActiveReferees(data || []);
    }
    setLoadingActiveReferees(false);
  };

  const handleDeactivateReferee = async (referee) => {
    if (!canManageAccess || !referee?.id || deactivatingRefereeId) return;
    const nombre = referee.username || referee.email || "este árbitro";
    const confirmado = window.confirm(
      `¿Querés dar de baja a ${nombre}? No podrá volver a ingresar, pero se conservarán sus partidos y estadísticas históricas.`
    );
    if (!confirmado) return;

    setDeactivatingRefereeId(referee.id);
    const { error } = await supabase.rpc("deactivate_fefutin_referee", {
      p_user_id: referee.id,
    });

    if (error) {
      console.error("Error al dar de baja al árbitro:", error);
      setAccessActionError(error.message || "No se pudo dar de baja al árbitro.");
      setDeactivatingRefereeId(null);
      return false;
    } else {
      setAccessActionError("");
      await loadActiveReferees();
      showNotice(`✅ ${nombre} fue dado de baja. Su historial quedó conservado.`);
      setDeactivatingRefereeId(null);
      return true;
    }
  };

  const updateRefereeApprovalForm = (userId, field, value) => {
    setRefereeApprovalForms((current) => ({
      ...current,
      [userId]: { ...(current[userId] || {}), [field]: value },
    }));
  };

  const handleAccessDecision = async (userId, decision, request = null) => {
    if (processingAccessId) return;
    setProcessingAccessId(userId);
    setAccessActionError("");
    try {
      if (decision === "approve" && request?.requested_role === "arbitro") {
        const data = refereeApprovalForms[userId] || {};
        const firstName = String(data.first_name || "").trim();
        const lastName = String(data.last_name || "").trim();
        const refereeNumber = String(data.referee_number || "").trim();
        const locality = String(data.locality || "").trim();
        const birthDate = data.birth_date || null;
        const photoFile = data.photo_file || null;

        if (!firstName || !lastName || !refereeNumber || !locality) {
          throw new Error("Completá nombre, apellido, matrícula y localidad antes de aprobar el alta.");
        }
        if (photoFile && photoFile.size > 5 * 1024 * 1024) {
          throw new Error("La fotografía no puede superar los 5 MB.");
        }
        if (photoFile && !["image/jpeg", "image/png", "image/webp"].includes(photoFile.type)) {
          throw new Error("La fotografía debe ser JPG, PNG o WEBP.");
        }

        let photoPath = null;
        if (photoFile) {
          photoPath = userId + "/photo";
          const { error: uploadError } = await supabase.storage
            .from("fefutin-carnets")
            .upload(photoPath, photoFile, { upsert: true, contentType: photoFile.type });
          if (uploadError) throw uploadError;
        }

        const { error } = await supabase.rpc("approve_fefutin_referee_with_carnet", {
          p_user_id: userId,
          p_first_name: firstName,
          p_last_name: lastName,
          p_referee_number: refereeNumber,
          p_locality: locality,
          p_birth_date: birthDate,
          p_photo_path: photoPath,
        });
        if (error) throw error;
      } else {
        const rpcName = decision === "approve" ? "approve_fefutin_access" : "reject_fefutin_access";
        const { error } = await supabase.rpc(rpcName, { p_user_id: userId });
        if (error) throw error;
      }
      setRefereeApprovalForms((current) => {
        const next = { ...current };
        delete next[userId];
        return next;
      });
      await refreshPendingRequests();
      if (decision === "approve" && request?.requested_role === "arbitro") {
        await loadActiveReferees();
        showNotice("Árbitro aprobado y carnet creado correctamente.");
      }
    } catch (error) {
      console.error("Error al procesar solicitud de acceso:", error);
      setAccessActionError(error.message || "No se pudo procesar la solicitud.");
    } finally {
      setProcessingAccessId(null);
    }
  };

  // =========================================================
  // REGISTRAR ACTIVIDAD DE USUARIOS AUTENTICADOS
  // =========================================================

  useEffect(() => {
    // La pantalla de acceso/registro no cuenta como navegación dentro de la app.
    if (!currentUser) return;

    let cancelado = false;

    const obtenerVisitaId = () => {
      let visitaId = sessionStorage.getItem("tournamentclash_visita_id");

      if (!visitaId) {
        visitaId = crypto.randomUUID();
        sessionStorage.setItem("tournamentclash_visita_id", visitaId);
      }

      return visitaId;
    };

    const registrarOAsociarVisita = async () => {
      const visitaId = obtenerVisitaId();
      const device = window.innerWidth <= 768 ? "mobile" : "desktop";
      const ahora = new Date().toISOString();

      const { data: visitaExistente, error: errorBusqueda } = await supabase
        .from("visitas")
        .select("id, user_id, started_at")
        .eq("id", visitaId)
        .maybeSingle();

      if (cancelado) return;

      if (errorBusqueda) {
        console.error("Error al buscar la visita actual:", errorBusqueda);
        return;
      }

      if (!visitaExistente) {
        const { error } = await supabase.from("visitas").insert({
          id: visitaId,
          user_id: currentUser?.id || null,
          username: currentUser?.username || null,
          email: currentUser?.email || null,
          device,
          started_at: ahora,
          last_seen_at: ahora,
          duration_seconds: 0,
        });

        if (error) console.error("Error al registrar visita:", error);
        return;
      }

      const actualizacion = {
        last_seen_at: ahora,
        device,
      };

      if (currentUser) {
        actualizacion.user_id = currentUser.id;
        actualizacion.username = currentUser.username;
        actualizacion.email = currentUser.email || null;
      }

      const { error: errorActualizacion } = await supabase
        .from("visitas")
        .update(actualizacion)
        .eq("id", visitaId);

      if (errorActualizacion) {
        console.error("Error al actualizar la visita:", errorActualizacion);
      }
    };

    const actualizarTiempo = async () => {
      const visitaId = sessionStorage.getItem("tournamentclash_visita_id");
      if (!visitaId) return;

      const { data, error } = await supabase
        .from("visitas")
        .select("started_at")
        .eq("id", visitaId)
        .maybeSingle();

      if (error || !data?.started_at || cancelado) return;

      const inicio = new Date(data.started_at);
      const ahora = new Date();
      const segundos = Math.max(0, Math.floor((ahora - inicio) / 1000));

      const { error: errorActualizacion } = await supabase
        .from("visitas")
        .update({
          last_seen_at: ahora.toISOString(),
          duration_seconds: segundos,
        })
        .eq("id", visitaId);

      if (errorActualizacion) {
        console.error("Error al actualizar tiempo de visita:", errorActualizacion);
      }
    };

    registrarOAsociarVisita();

    const intervalo = setInterval(actualizarTiempo, 30000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        registrarOAsociarVisita();
      } else {
        actualizarTiempo();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelado = true;
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [currentUser]);

  useEffect(() => {
    fetchTournaments();
  }, [currentUser]);

  useEffect(() => {
    let cancelled = false;
    const loadReferenteParticipations = async () => {
      if (!isReferente) {
        setReferenteParticipations([]);
        setReferenteMatchClubs([]);
        return;
      }
      const { data, error } = await supabase.rpc("get_fefutin_my_teams");
      if (cancelled) return;
      if (error) {
        console.error("Error al cargar las inscripciones del referente:", error);
        setReferenteParticipations([]);
      } else {
        setReferenteParticipations(data || []);
      }
    };
    loadReferenteParticipations();
    return () => { cancelled = true; };
  }, [isReferente, currentUser?.id]);

  useEffect(() => {
    let cancelled = false;
    const loadFefutinTournamentClubs = async () => {
      const tournamentId = activeTournament?.id;
      if (!tournamentId) {
        setFefutinTournamentClubs([]);
        setLoadingFefutinTournamentClubs(false);
        return;
      }

      setLoadingFefutinTournamentClubs(true);
      const { data, error } = await supabase.rpc("get_fefutin_tournament_clubs", {
        p_tournament_id: tournamentId,
      });

      if (cancelled) return;
      if (error) {
        console.error("Error al cargar clubes FEFUTIN del torneo:", error);
        setFefutinTournamentClubs([]);
      } else {
        setFefutinTournamentClubs(data || []);
      }
      setLoadingFefutinTournamentClubs(false);
    };

    loadFefutinTournamentClubs();
    return () => {
      cancelled = true;
    };
  }, [activeTournament?.id, activeTournament?.status]);

  const fetchTournaments = async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("tournaments")
      .select("*")
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      console.error("Error al obtener torneos:", error);
    } else {
      const freshTournaments = data || [];
      setTournaments(freshTournaments);
      if (activeTournament?.id) {
        const refreshedActiveTournament = freshTournaments.find((item) => item.id === activeTournament.id);
        if (refreshedActiveTournament) setActiveTournament(refreshedActiveTournament);
      }
    }

    setLoading(false);
  };

  // =========================================================
  // ELIMINAR TORNEO - SOLO ADMIN
  // =========================================================

  const handleDeleteTournament = async (tournament) => {
    if (!currentUser || !canDeleteTournaments) {
      showNotice("❌ No tenés permisos para eliminar torneos.");
      return;
    }

    if (!tournament?.id) {
      showNotice("❌ No se pudo identificar el torneo.");
      return;
    }

    const confirmar = await confirmTournament(
      `⚠️ ELIMINAR TORNEO\n\n` +
        `"${tournament.title}"\n\n` +
        `Se eliminarán sus inscripciones, planteles, planillas, resultados e historial asociado.\n` +
        `Los clubes y el registro general de jugadores se conservarán.\n\n` +
        `Esta acción es permanente. ¿Querés continuar?`
    );

    if (!confirmar) return;

    setDeletingTournamentId(tournament.id);

    try {
      const { data: deletionResult, error } = await supabase.rpc(
        "delete_fefutin_tournament",
        { p_tournament_id: tournament.id }
      );

      if (error) {
        console.error("Error al eliminar torneo:", error);
        showNotice(
          `❌ Supabase no pudo eliminar el torneo.\n\n${error.message || "Revisá los permisos y la migración de eliminación."}`
        );
        return;
      }

      const photoPaths = Array.isArray(deletionResult?.photo_storage_paths)
        ? deletionResult.photo_storage_paths.filter((path) => typeof path === "string" && path.trim())
        : [];

      let storageCleanupWarning = "";
      if (photoPaths.length) {
        const { error: storageError } = await supabase.storage
          .from("fefutin-jornada-photos")
          .remove(photoPaths);

        if (storageError) {
          console.error("El torneo se eliminó, pero quedaron archivos de fotos en Storage:", storageError, photoPaths);
          storageCleanupWarning =
            "\n\n⚠️ El torneo ya se eliminó de la base de datos, pero no se pudieron borrar todos los archivos de fotos. Revisá Storage en Supabase.";
        }
      }

      setTournaments((prev) => prev.filter((t) => t.id !== tournament.id));

      if (activeTournament?.id === tournament.id) {
        setActiveTournament(null);
        setActiveView("home");
        setEditingTournament(false);
      }

      showNotice(
        storageCleanupWarning
          ? `✅ Torneo eliminado correctamente.${storageCleanupWarning}`
          : "✅ Torneo y sus datos asociados eliminados correctamente. Los clubes y jugadores del registro general se conservaron."
      );
    } catch (error) {
      console.error("Error inesperado al eliminar torneo:", error);
      showNotice("❌ Ocurrió un error inesperado al intentar eliminar el torneo.");
    } finally {
      setDeletingTournamentId(null);
    }
  };

  // =========================================================
  // AUTENTICACIÓN Y SOLICITUDES DE ACCESO
  // =========================================================

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    const username = registerInput.username.trim();
    const email = authInput.email.trim().toLowerCase();
    const password = authInput.password.trim();
    const requestedRole = registerInput.requestedRole;

    if (username.length < 3) {
      showNotice("Ingresá un nombre de al menos 3 caracteres.");
      return;
    }
    if (!email || password.length < 6) {
      showNotice("Ingresá un email válido y una contraseña de al menos 6 caracteres.");
      return;
    }
    if (!["directivo", "arbitro", "referente"].includes(requestedRole)) {
      showNotice("Seleccioná si solicitás acceso como directivo, árbitro o referente.");
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username, requested_role: requestedRole },
      },
    });

    if (error) {
      console.error("Error al registrar solicitud:", error);
      showNotice(error.message?.toLowerCase().includes("already")
        ? "Ese email ya está registrado. Probá iniciar sesión."
        : "No se pudo crear la cuenta. Revisá los datos e intentá nuevamente.");
      return;
    }

    setAuthInput({ email: "", password: "" });
    setRegisterInput({ username: "", requestedRole: "arbitro" });
    setAuthMode("login");

    if (data.session && data.user) {
      const user = await buildCurrentUser(data.user);
      if (user) {
        setCurrentUser(user);
        setActiveView("home");
      }
    }

    showNotice("✅ Solicitud enviada. Tu cuenta queda como visitante hasta que FEFUTIN apruebe el rol solicitado. Si Supabase requiere confirmar el email, revisá tu correo.");
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();

    const email = authInput.email.trim().toLowerCase();
    const password = authInput.password.trim();

    if (!email || !password) {
      showNotice("❌ Ingresá tu email y contraseña.");
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error("Error al iniciar sesión:", error);

      showNotice("❌ Email o contraseña incorrectos.");

      return;
    }

    const user = await buildCurrentUser(data.user);

    if (!user) {
      await supabase.auth.signOut();
      showNotice("⛔ La cuenta está desactivada o no tiene un perfil habilitado. Contactá a FEFUTIN.");
      return;
    }

    setCurrentUser(user);
    if (user.approvalStatus === "pendiente") {
      showNotice("Tu solicitud de acceso está pendiente de aprobación. Mientras tanto podés consultar la plataforma pública.");
    } else if (user.approvalStatus === "desestimado") {
      showNotice("Tu solicitud de acceso fue desestimada. Tu cuenta conserva acceso como visitante.");
    } else if (user.role === "visitante") {
      showNotice("Ingresaste como visitante. Podés consultar la información pública de FEFUTIN.");
    } else if (user.role === "arbitro") {
      showNotice("Ingresaste como árbitro. Tenés acceso a la consulta de torneos y resultados.");
    } else if (user.role === "directivo") {
      showNotice("Ingresaste como directivo. Tenés acceso a las funciones de gestión habilitadas para tu rol.");
    }

    setAuthInput({
      email: "",
      password: "",
    });
    setActiveView("home");
  };

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("Error al cerrar sesión:", error);
      return;
    }

    // La próxima persona que inicie sesión tendrá
    // una visita completamente nueva.
    sessionStorage.removeItem("tournamentclash_visita_id");

    setCurrentUser(null);
    setActiveView("home");
    setActiveTournament(null);
    setEditingTournament(false);
    setJoinCodeInput("");
  };

  const handleGoHome = () => {
    setActiveTournament(null);
    setActiveView("home");
    setEditingTournament(false);
  };

  // =========================================================
  // CREAR TORNEO
  // =========================================================

  const handleCreateTournamentSubmit = async (config) => {
    if (!canManageTournaments) {
      showNotice("❌ Solo un administrador o directivo puede crear torneos.");
      setActiveView("home");
      return;
    }

    const configuredBranches = Array.isArray(config.category_config) ? config.category_config : [];
    const categoryEntries = configuredBranches.flatMap((branch) =>
      (Array.isArray(branch.categories) ? branch.categories : []).map((category) => ({
        division: String(branch.division || "").trim(),
        categoryType: String(branch.categoryType || config.categoryType || "").trim(),
        category: String(category || "").trim(),
      }))
    ).filter((entry) => entry.division && entry.category);

    if (!categoryEntries.length) {
      showNotice("Seleccioná al menos una combinación de rama y categoría.");
      return;
    }

    const tournamentsToCreate = categoryEntries.map((entry) => {
      const randomCode = "TS-" + Math.floor(1000 + Math.random() * 9000);
      const registrationGroup = {
        id: 0,
        name: "__INSCRIPCIONES__",
        teams: [],
        matches: [],
        capacity: Number(config.maxParticipants),
        numGroups: config.format === "groups_playoff" ? Number(config.numGroups) : 1,
        category_config: [{
          division: entry.division,
          categoryType: entry.categoryType,
          categories: [entry.category],
        }],
      };

      return {
        code: randomCode,
        title: config.title,
        game: `Fútbol · ${entry.division} · ${entry.category}`,
        format: config.format,
        qualifiers_per_group: config.qualifiersPerGroup,
        is_public: config.isPublic,
        created_by_user_id: currentUser.id,
        created_by: currentUser.username,
        groups: [registrationGroup],
        playoffs: null,
        status: "Inscripciones",
      };
    });

    const { data, error } = await supabase
      .from("tournaments")
      .insert(tournamentsToCreate)
      .select();

    if (error) {
      console.error("Error detallado al guardar los torneos en Supabase:", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      const reason = error.message || error.details || "Error sin descripción";
      showNotice(`❌ Supabase rechazó la creación: ${reason}`);
      return;
    }

    if (data && data.length > 0) {
      setActiveTournament(null);
      setTournaments((prev) => [...data, ...prev]);
      setTournamentDivisionFilter("Todas");
      setTournamentCategoryFilter("Todas");
      setActiveView("division-tournaments");
      showNotice(`Se crearon ${data.length} torneos, uno por cada combinación de rama y categoría. Todos quedan abiertos para recibir inscripciones.`);
    }
  };

  const handleRegisterForTournament = async (tournament) => {
    if (!isAdmin || !tournament?.id) return;

    const { data: latest, error: fetchError } = await supabase
      .from("tournaments")
      .select("id, groups, status")
      .eq("id", tournament.id)
      .maybeSingle();

    if (fetchError || !latest) {
      console.error("Error al consultar inscripción:", fetchError);
      showNotice("No se pudo comprobar el estado de las inscripciones. Intentá de nuevo.");
      return;
    }

    if (String(latest.status || "").trim().toLocaleLowerCase("es") !== "inscripciones") {
      showNotice("🔒 Las inscripciones ya están cerradas.");
      await fetchTournaments();
      return;
    }

    const groups = Array.isArray(latest.groups) ? [...latest.groups] : [];
    const registrationIndex = groups.findIndex((group) => group?.name === "__INSCRIPCIONES__");
    if (registrationIndex < 0) {
      showNotice("No se encontró la lista de inscriptos de este torneo.");
      return;
    }

    const registration = { ...groups[registrationIndex] };
    const participants = Array.isArray(registration.teams) ? [...registration.teams] : [];
    if (participants.some((name) => String(name).toLocaleLowerCase("es") === currentUser.username.toLocaleLowerCase("es"))) {
      showNotice("Ya estás inscripto en este torneo.");
      return;
    }

    const capacity = Number(registration.capacity || 0);
    if (capacity > 0 && participants.length >= capacity) {
      showNotice("🚫 El cupo de este torneo ya está completo.");
      await fetchTournaments();
      return;
    }

    participants.push(currentUser.username);
    registration.teams = participants;
    groups[registrationIndex] = registration;

    const { data: updatedRows, error: updateError } = await supabase
      .from("tournaments")
      .update({ groups })
      .eq("id", tournament.id)
      .eq("status", "Inscripciones")
      .select();

    if (updateError || !updatedRows?.length) {
      console.error("Error al guardar la inscripción:", updateError);
      showNotice("No se pudo completar la inscripción. Puede que el torneo haya comenzado o se haya completado el cupo.");
      await fetchTournaments();
      return;
    }

    const updatedTournament = updatedRows[0];
    setTournaments((prev) => prev.map((item) => item.id === updatedTournament.id ? updatedTournament : item));
    if (activeTournament?.id === updatedTournament.id) setActiveTournament(updatedTournament);
    showNotice(`✅ ¡Te inscribiste en "${updatedTournament.title}"!`);
  };

  const handleLoadRegisteredProfiles = async () => {
    setLoadingRegisteredProfiles(true);
    const { data, error } = await supabase.rpc("list_registered_players");
    setLoadingRegisteredProfiles(false);
    if (error) {
      console.error("Error al cargar usuarios registrados:", error);
      showNotice("No se pudo cargar la lista de jugadores. Verificá que la función segura list_registered_players esté creada en Supabase.");
      return;
    }
    setRegisteredProfiles(data || []);
    setSelectedRegisteredProfileIds([]);
  };

  const handleAddSelectedRegisteredProfiles = async () => {
    if (!activeTournament?.id || !currentUser) return;
    if (!canManageTournaments) {
      showNotice("Solo un administrador o directivo puede agregar participantes.");
      return;
    }
    const { data: latest, error: fetchError } = await supabase.from("tournaments")
      .select("id, title, groups, status").eq("id", activeTournament.id).maybeSingle();
    if (fetchError || !latest) {
      console.error("Error al consultar torneo:", fetchError);
      showNotice("No se pudo actualizar el torneo. Volvé a intentarlo.");
      return;
    }
    if (String(latest.status || "").trim().toLocaleLowerCase("es") !== "inscripciones") {
      showNotice("Las inscripciones ya están cerradas.");
      await fetchTournaments();
      return;
    }
    const groups = Array.isArray(latest.groups) ? [...latest.groups] : [];
    const index = groups.findIndex((group) => group?.name === "__INSCRIPCIONES__");
    if (index < 0) {
      showNotice("No se encontró la lista de inscriptos.");
      return;
    }
    const registration = { ...groups[index] };
    const participants = Array.isArray(registration.teams) ? [...registration.teams] : [];
    const capacity = Number(registration.capacity || 0);
    const chosenProfiles = registeredProfiles.filter((profile) => selectedRegisteredProfileIds.includes(profile.id));
    const alreadyRegistered = new Set(participants.map((name) => String(name).toLocaleLowerCase("es")));
    const namesToAdd = chosenProfiles.map((profile) => String(profile.username || "").trim())
      .filter((name) => name && !alreadyRegistered.has(name.toLocaleLowerCase("es")));
    if (!namesToAdd.length) {
      showNotice("Seleccioná al menos un usuario que todavía no esté inscripto.");
      return;
    }
    if (capacity > 0 && participants.length + namesToAdd.length > capacity) {
      showNotice(`La selección supera el cupo. Hay ${participants.length}/${capacity} inscriptos y seleccionaste ${namesToAdd.length} usuarios nuevos.`);
      return;
    }
    registration.teams = [...participants, ...namesToAdd];
    groups[index] = registration;
    const { data: updatedRows, error: updateError } = await supabase.from("tournaments")
      .update({ groups }).eq("id", activeTournament.id).eq("status", "Inscripciones").select();
    if (updateError || !updatedRows?.length) {
      console.error("Error al guardar participantes seleccionados:", updateError);
      showNotice(updateError?.message
        ? `Supabase rechazó la actualización: ${updateError.message}`
        : "No se pudo guardar la lista. Puede que el torneo haya cambiado de estado.");
      return;
    }
    const updatedTournament = updatedRows[0];
    setActiveTournament(updatedTournament);
    setTournaments((prev) => prev.map((item) => item.id === updatedTournament.id ? updatedTournament : item));
    setSelectedRegisteredProfileIds([]);
    showNotice(`Se agregaron ${namesToAdd.length} participante(s) al torneo.`);
  };

  const handleStartRegistrationTournament = async () => {
    if (!activeTournament?.id) return;

    if (!canManageTournaments) {
      showNotice("Solo un administrador o directivo puede dar comienzo al torneo.");
      return;
    }

    const participants = [...new Set(
      (fefutinTournamentClubs || [])
        .map((club) => String(club.club_name || "").trim())
        .filter(Boolean)
    )];
    const registration = (activeTournament.groups || []).find((group) => group?.name === "__INSCRIPCIONES__");
    const fixtureGeneration = String(registration?.fixtureGeneration || "");
    const matchIdPrefix = fixtureGeneration ? `${fixtureGeneration}-` : "";
    const configuredGroups = activeTournament.format === "groups_playoff"
      ? Number(registration?.numGroups || 2)
      : 1;
    const numGroups = activeTournament.format === "groups_playoff"
      ? Math.max(1, Math.min(configuredGroups, Math.floor(participants.length / 2)))
      : 1;

    if (participants.length < 2) {
      showNotice("Se necesitan al menos 2 clubes aprobados e inscriptos para iniciar la competencia.");
      return;
    }

    const detalleInicio = activeTournament.format === "single_elimination" ? "Las inscripciones se cerrarán y se generarán las llaves de eliminación directa." : "Las inscripciones se cerrarán y se generarán los grupos y partidos.";
    const confirmar = await confirmTournament(`¿Dar comienzo a "${activeTournament.title}" con ${participants.length} participantes? ${detalleInicio}`);
    if (!confirmar) return;

    const isDirectElimination = activeTournament.format === "single_elimination";
    const isLeague = activeTournament.format === "league";
    const shuffled = isDirectElimination
      ? [...participants]
      : [...participants].sort(() => Math.random() - 0.5);
    let groups;
    let playoffs = null;

    if (isDirectElimination) {
      // Sin fase de grupos no hay tabla de posiciones: se respeta el orden
      // de inscripción como orden inicial y no se mezclan los participantes.
      groups = [{
        id: 1,
        name: "Llaves de eliminación",
        teams: shuffled,
        matches: [],
      }];
      playoffs = generatePlayoffBrackets(shuffled);
    } else if (isLeague) {
      // Calendario todos contra todos: cada equipo juega una vez por fecha.
      // En liga respetamos el orden de inscripción para que el calendario sea previsible.
      const scheduleTeams = [...participants];
      if (scheduleTeams.length % 2 !== 0) scheduleTeams.push(null);
      const totalRounds = scheduleTeams.length - 1;
      const rounds = [];

      for (let roundIndex = 0; roundIndex < totalRounds; roundIndex++) {
        const roundMatches = [];
        for (let i = 0; i < scheduleTeams.length / 2; i++) {
          const home = scheduleTeams[i];
          const away = scheduleTeams[scheduleTeams.length - 1 - i];
          if (home && away) {
            roundMatches.push({
              round: roundIndex + 1,
              team1: home,
              team2: away,
              score1: null,
              score2: null,
            });
          }
        }
        rounds.push(roundMatches);
        scheduleTeams.splice(1, 0, scheduleTeams.pop());
      }

      // Ordenar las fechas para que el primer participante juegue primero
      // contra el segundo, luego el tercero, etc. (ej.: 1-2 / 3-4).
      const participantOrder = new Map(participants.map((name, index) => [name, index]));
      rounds.sort((a, b) => {
        const opponentA = a.find((match) => match.team1 === participants[0] || match.team2 === participants[0]);
        const opponentB = b.find((match) => match.team1 === participants[0] || match.team2 === participants[0]);
        const indexA = participantOrder.get(opponentA?.team1 === participants[0] ? opponentA.team2 : opponentA?.team1) ?? 0;
        const indexB = participantOrder.get(opponentB?.team1 === participants[0] ? opponentB.team2 : opponentB?.team1) ?? 0;
        return indexA - indexB;
      });

      // Optimizar la localía sobre el calendario completo, no partido por partido.
      // Cada partido puede invertir su orientación; buscamos minimizar repeticiones
      // consecutivas y mantener equilibrados los totales de local/visitante.
      const fixtures = rounds.flatMap((roundMatches, roundIndex) =>
        [...roundMatches]
          .sort((a, b) => {
            const firstA = Math.min(participantOrder.get(a.team1) ?? 0, participantOrder.get(a.team2) ?? 0);
            const firstB = Math.min(participantOrder.get(b.team1) ?? 0, participantOrder.get(b.team2) ?? 0);
            return firstA - firstB;
          })
          .map((match, matchIndex) => ({
            ...match,
            round: roundIndex + 1,
            id: `fecha-${roundIndex + 1}-partido-${matchIndex + 1}`,
          }))
      );

      // Buscamos alternar localía en los partidos consecutivos que juega cada
      // equipo, manteniendo el reparto total lo más equilibrado posible.
      const evaluateOrientation = (orientation) => {
        const venuesByTeam = new Map(participants.map((team) => [team, []]));
        fixtures.forEach((match, index) => {
          const home = orientation[index] ? match.team2 : match.team1;
          const away = orientation[index] ? match.team1 : match.team2;
          venuesByTeam.get(home)?.push({ round: match.round, venue: "L" });
          venuesByTeam.get(away)?.push({ round: match.round, venue: "V" });
        });

        let imbalance = 0;
        let repeats = 0;
        let longRuns = 0;
        let localRepeatRuns = 0;
        let visitorRepeatRuns = 0;
        venuesByTeam.forEach((venues) => {
          venues.sort((a, b) => a.round - b.round);
          let local = 0;
          let visitor = 0;
          let streak = 1;
          for (let i = 0; i < venues.length; i++) {
            if (venues[i].venue === "L") local++;
            else visitor++;
            if (i > 0) {
              if (venues[i].venue === venues[i - 1].venue) {
                repeats++;
                streak++;
                if (venues[i].venue === "L") localRepeatRuns++;
                else visitorRepeatRuns++;
                if (streak >= 3) longRuns++;
              } else {
                streak = 1;
              }
            }
          }
          const minimumDifference = venues.length % 2;
          imbalance += Math.max(0, Math.abs(local - visitor) - minimumDifference);
        });
        // Una repetición de local se compensa con una repetición de visitante.
        // Es preferible alternar, pero si no se puede, evitamos que los
        // equipos acumulen rachas de un solo tipo de localía.
        const repeatImbalance = Math.abs(localRepeatRuns - visitorRepeatRuns);
        return imbalance * 100000 + repeatImbalance * 5000 + repeats * 1000 + longRuns * 100;
      };

      let seed = participants.reduce((sum, name, index) => {
        for (let i = 0; i < name.length; i++) sum = (sum * 31 + name.charCodeAt(i)) >>> 0;
        return (sum + index + 1) >>> 0;
      }, 20261023);
      const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };

      let bestOrientation = fixtures.map(() => false);
      let bestScore = evaluateOrientation(bestOrientation);
      const iterations = Math.max(2500, fixtures.length * fixtures.length * 20);

      // Reinicios deterministas y búsqueda global aproximada: prioriza que
      // cada equipo alterne local/visitante y evita desequilibrios como 5-1.
      for (let attempt = 0; attempt < 48; attempt++) {
        let orientation = fixtures.map(() => random() < 0.5);
        let currentScore = evaluateOrientation(orientation);
        let temperature = 1500;

        for (let step = 0; step < iterations; step++) {
          const candidate = [...orientation];
          const first = Math.floor(random() * fixtures.length);
          candidate[first] = !candidate[first];
          if (fixtures.length > 1 && random() < 0.3) {
            let second = Math.floor(random() * fixtures.length);
            if (second === first) second = (second + 1) % fixtures.length;
            candidate[second] = !candidate[second];
          }

          const candidateScore = evaluateOrientation(candidate);
          const delta = candidateScore - currentScore;
          if (delta < 0 || random() < Math.exp(-delta / temperature)) {
            orientation = candidate;
            currentScore = candidateScore;
          }
          temperature *= 0.996;
          if (currentScore < bestScore) {
            bestScore = currentScore;
            bestOrientation = [...orientation];
          }
          if (bestScore === 0) break;
        }
        if (bestScore === 0) break;
      }

      const matches = fixtures.map((match, index) => {
        const shouldReverse = bestOrientation[index];
        const home = shouldReverse ? match.team2 : match.team1;
        const away = shouldReverse ? match.team1 : match.team2;
        return {
          ...match,
          team1: home,
          team2: away,
          homeTeam: home,
          awayTeam: away,
          match_date: getFefutinMatchDate(match.round),
        };
      });
      groups = [{
        id: 1,
        name: "Todos contra todos",
        teams: shuffled,
        matches,
      }];
    } else {
      groups = Array.from({ length: numGroups }, (_, index) => ({
        id: index + 1,
        name: `Grupo ${String.fromCharCode(65 + index)}`,
        teams: [],
        matches: [],
      }));

      shuffled.forEach((team, index) => groups[index % numGroups].teams.push(team));
      groups.forEach((group) => {
        const teams = group.teams;
        for (let i = 0; i < teams.length; i++) {
          for (let j = i + 1; j < teams.length; j++) {
            group.matches.push({
              id: `${matchIdPrefix}${teams[i]}-${teams[j]}`,
              team1: teams[i],
              team2: teams[j],
              score1: null,
              score2: null,
            });
          }
        }
      });
    }

    const { data, error } = await supabase
      .from("tournaments")
      .update({ groups, playoffs, status: "En curso" })
      .eq("id", activeTournament.id)
      .eq("status", "Inscripciones")
      .select();

    if (error || !data?.length) {
      console.error("Error al iniciar torneo:", error);
      showNotice("No se pudo iniciar el torneo. Puede que ya haya comenzado; actualizá la lista e intentá de nuevo.");
      await fetchTournaments();
      return;
    }

    setActiveTournament(data[0]);
    setTournaments((prev) => prev.map((item) => item.id === data[0].id ? data[0] : item));
    setActiveView(data[0].format === "single_elimination" ? "playoffs" : "groups");
    showNotice(data[0].format === "single_elimination"
      ? "🏆 ¡Torneo en marcha! Se generaron las llaves de eliminación directa."
      : "🏆 ¡Torneo en marcha! Los grupos y partidos se generaron automáticamente.");
  };

  // =========================================================
  // EDITAR TORNEO
  // =========================================================

  const tournamentHasResults = (tournament) => {
    const groupMatches = (tournament?.groups || []).flatMap((group) => group.matches || []);
    const playoffRounds = Array.isArray(tournament?.playoffs) ? tournament.playoffs : [];
    const playoffMatches = playoffRounds.flatMap((round) => Array.isArray(round) ? round : []);
    return [...groupMatches, ...playoffMatches].some(
      (match) =>
        match.score1 !== null &&
        match.score1 !== undefined &&
        match.score2 !== null &&
        match.score2 !== undefined &&
        match.team1 !== "Pasaje Directo" &&
        match.team2 !== "Pasaje Directo"
    );
  };

  const isTournamentAdmin = canManageTournaments;

  const handleEditTournamentSubmit = async (config) => {
    if (!activeTournament) return;

    if (!isTournamentAdmin) {
      showNotice("❌ Solo el administrador puede modificar este torneo.");
      return;
    }

    if (tournamentHasResults(activeTournament)) {
      showNotice(
        "🔒 Este torneo ya tiene resultados cargados. No se puede modificar su organización para proteger los partidos existentes."
      );
      return;
    }

    if (String(activeTournament.status || "").trim().toLocaleLowerCase("es") === "inscripciones") {
      const groups = Array.isArray(activeTournament.groups) ? [...activeTournament.groups] : [];
      const registrationIndex = groups.findIndex((group) => group?.name === "__INSCRIPCIONES__");
      if (registrationIndex < 0) {
        showNotice("No se encontró la lista de inscriptos de este torneo.");
        return;
      }

      const registration = {
        ...groups[registrationIndex],
        teams: Array.isArray(config.teams) ? config.teams : [],
        capacity: Number(config.maxParticipants),
        numGroups: config.format === "groups_playoff" ? Number(config.numGroups) : 1,
        category_config: Array.isArray(config.category_config) ? config.category_config : [],
      };
      groups[registrationIndex] = registration;

      const updatedTournament = {
        ...activeTournament,
        title: config.title,
        game: config.game,
        format: config.format,
        qualifiers_per_group: config.qualifiersPerGroup,
        is_public: config.isPublic,
        groups,
      };

      const { data, error } = await supabase
        .from("tournaments")
        .update({
          title: updatedTournament.title,
          game: updatedTournament.game,
          format: updatedTournament.format,
          qualifiers_per_group: updatedTournament.qualifiers_per_group,
          is_public: updatedTournament.is_public,
          groups: updatedTournament.groups,
        })
        .eq("id", updatedTournament.id)
        .select();

      if (error || !data?.length) {
        console.error("Error al modificar la configuración de inscripciones:", error);
        showNotice(error?.message || "No se pudieron guardar los cambios del torneo.");
        return;
      }

      const catalogError = await saveTeamsToCatalog(config.teams);
      setActiveTournament(data[0]);
      setTournaments((prev) => prev.map((item) => item.id === data[0].id ? data[0] : item));
      setEditingTournament(false);
      setActiveView("groups");
      showNotice(catalogError
        ? "La configuración se guardó, pero no se pudo actualizar el catálogo de equipos."
        : "Configuración del torneo actualizada. Las inscripciones siguen abiertas."
      );
      return;
    }

    const shuffled = [...config.teams].sort(() => 0.5 - Math.random());
    const isDirectElimination = config.format === "single_elimination";
    const numGroups = config.format === "groups_playoff" ? config.numGroups : 1;
    const groups = [];

    if (isDirectElimination) {
      groups.push({
        id: 1,
        name: "Llaves de eliminación",
        teams: shuffled,
        matches: [],
      });
    } else {
      for (let i = 0; i < numGroups; i++) {
        groups.push({
          id: i + 1,
          name: `Grupo ${String.fromCharCode(65 + i)}`,
          teams: [],
          matches: [],
        });
      }

      shuffled.forEach((team, idx) => {
        groups[idx % numGroups].teams.push(team);
      });

      groups.forEach((group) => {
        const groupMatches = [];
        const t = group.teams;

        for (let i = 0; i < t.length; i++) {
          for (let j = i + 1; j < t.length; j++) {
            groupMatches.push({
              id: `${t[i]}-${t[j]}`,
              team1: t[i],
              team2: t[j],
              score1: null,
              score2: null,
            });
          }
        }

        group.matches = groupMatches;
      });
    }

    const updatedTournament = {
      ...activeTournament,
      title: config.title,
      game: config.game,
      format: config.format,
      qualifiers_per_group: config.qualifiersPerGroup,
      is_public: config.isPublic,
      groups,
      playoffs: isDirectElimination ? generatePlayoffBrackets(shuffled) : null,
    };

    const { data, error } = await supabase
      .from("tournaments")
      .update({
        title: updatedTournament.title,
        game: updatedTournament.game,
        format: updatedTournament.format,
        qualifiers_per_group: updatedTournament.qualifiers_per_group,
        is_public: updatedTournament.is_public,
        groups: updatedTournament.groups,
        playoffs: updatedTournament.playoffs,
      })
      .eq("id", updatedTournament.id)
      .select();

    if (error) {
      console.error("Error al modificar torneo:", error);

      showNotice("❌ No se pudieron guardar los cambios.");

      return;
    }

    if (data && data.length > 0) {
      const catalogError = await saveTeamsToCatalog(config.teams);
      setActiveTournament(data[0]);

      setTournaments((prev) =>
        prev.map((t) => (t.id === data[0].id ? data[0] : t))
      );

      setEditingTournament(false);
      if (data[0].format === "single_elimination" && data[0].playoffs?.length) {
        setActiveView("playoffs");
      } else if (data[0].format !== "single_elimination") {
        setActiveView("groups");
      }

      showNotice(catalogError
        ? "El torneo se modificó, pero no se pudo actualizar el catálogo de equipos."
        : "✅ Torneo modificado correctamente."
      );
    }
  };

  const handleUpdateTournamentInSupabase = async (updatedTournament) => {
    if (!canManageTournaments) {
      showNotice("❌ Solo un administrador o directivo puede modificar torneos y resultados.");
      return;
    }
    const currentStatus = String(activeTournament?.status || updatedTournament?.status || "")
      .trim()
      .toLocaleLowerCase("es");
    if (currentStatus === "finalizado") {
      showNotice("🔒 Este torneo ya está finalizado. No se pueden modificar sus resultados.");
      return;
    }

    setActiveTournament(updatedTournament);

    const { error } = await supabase
      .from("tournaments")
      .update({
        groups: updatedTournament.groups,
        playoffs: updatedTournament.playoffs,
        status: updatedTournament.status,
      })
      .eq("id", updatedTournament.id);

    if (error) {
      console.error("Error al actualizar la tabla en Supabase:", error);
    } else {
      setTournaments((prev) =>
        prev.map((t) => (t.id === updatedTournament.id ? updatedTournament : t))
      );
    }
  };

  const handleCloseMatch = async ({ phase, groupIndex, roundIndex, matchId }) => {
    if ((!isArbitro && !isAdmin && !isDirectivo) || !activeTournament?.id) {
      showNotice("No tenés permisos para cerrar partidos.");
      return false;
    }
    const { data, error } = await supabase.rpc("referee_close_match_from_sheet", {
      p_tournament_id: activeTournament.id,
      p_phase: phase,
      p_match_id: matchId,
      p_group_index: groupIndex ?? null,
      p_round_index: roundIndex ?? null,
    });
    if (error) {
      showNotice(error.message || "No se pudo cerrar el partido.");
      return false;
    }
    const updatedTournament = data?.id ? data : Array.isArray(data) ? data[0] : null;
    if (!updatedTournament?.id) {
      showNotice("Supabase no devolvió el torneo actualizado.");
      return false;
    }
    setActiveTournament(updatedTournament);
    setTournaments((prev) => prev.map((item) => item.id === updatedTournament.id ? updatedTournament : item));
    showNotice("Partido cerrado correctamente. La planilla quedó bloqueada.");
    return true;
  };

  // =========================================================
  // UNIRSE A TORNEO
  // =========================================================

  const handleJoinTournamentSubmit = (e) => {
    e.preventDefault();
    if (!canManageTournaments) {
      showNotice("⛔ Solo un administrador o directivo puede gestionar inscripciones.");
      setActiveView("home");
      return;
    }

    const cleanCode = joinCodeInput.trim().toUpperCase();

    const found = tournaments.find((t) => t.code === cleanCode);

    if (!found) {
      showNotice("❌ Código de torneo no encontrado en la base de datos.");
      return;
    }

    setActiveTournament(found);

    if (found.playoffs && found.playoffs.length > 0) {
      setActiveView("playoffs");
    } else {
      setActiveView("groups");
    }
  };

  // =========================================================
  // PLAYOFFS
  // =========================================================

  const handleProceedToPlayoffs = () => {
    if (!canManageTournaments) return;
    const qualifiedTeams = [];

    activeTournament.groups.forEach((group) => {
      const standings = calculateGroupStandings(group.teams, group.matches);
      const topTeams = standings.slice(
        0,
        Number(activeTournament.qualifiers_per_group || 1)
      );

      topTeams.forEach((team) => {
        qualifiedTeams.push({
          ...team,
          groupId: group.id,
          groupName: group.name,
          groupPosition: standings.findIndex((entry) => entry.name === team.name) + 1,
        });
      });
    });

    // Orden general de los clasificados: puntos, diferencia de gol y goles a favor.
    // Si siguen igualados, se conserva el orden de grupo y la posición dentro de este.
    qualifiedTeams.sort((a, b) =>
      b.points - a.points ||
      b.goalDifference - a.goalDifference ||
      b.goalsFor - a.goalsFor ||
      a.groupId - b.groupId ||
      a.groupPosition - b.groupPosition
    );

    const playoffs = generatePlayoffBrackets(
      qualifiedTeams.map((team) => team.name)
    );

    const updated = {
      ...activeTournament,
      playoffs,
    };

    handleUpdateTournamentInSupabase(updated);

    setActiveView("playoffs");
  };

  const handleFinishTournament = async () => {
    if (!canManageTournaments || !activeTournament) return;
    const format = String(activeTournament?.format || "").trim().toLocaleLowerCase("es");

    if (format === "league") {
      const groups = Array.isArray(activeTournament?.groups) ? activeTournament.groups : [];
      const matches = groups.flatMap((group) => group.matches || []);
      const playedMatches = matches.filter((match) =>
        match.score1 !== null && match.score1 !== undefined &&
        match.score2 !== null && match.score2 !== undefined
      );
      if (!playedMatches.length) {
        showNotice("⚠️ Para finalizar una liga tiene que haberse jugado al menos un partido.");
        return;
      }
    } else {
      const groups = Array.isArray(activeTournament?.groups) ? activeTournament.groups : [];
      const groupMatches = groups.flatMap((group) => group.matches || []);
      const rawPlayoffs = Array.isArray(activeTournament?.playoffs) ? activeTournament.playoffs : [];
      const rounds = rawPlayoffs.length && !Array.isArray(rawPlayoffs[0]) ? [rawPlayoffs] : rawPlayoffs;
      const allMatches = [...groupMatches, ...rounds.flatMap((round) => round || [])];
      const hasIncompleteMatch = allMatches.some((match) => {
        const isBye = match.team1 === "Pasaje Directo" || match.team2 === "Pasaje Directo";
        if (isBye) return false;
        return match.score1 === null || match.score1 === undefined ||
          match.score2 === null || match.score2 === undefined;
      });

      if (!rounds.length || hasIncompleteMatch) {
        showNotice("⚠️ Para finalizar el torneo, primero hay que completar todos los partidos y las llaves eliminatorias.");
        return;
      }

      const finalRound = rounds[rounds.length - 1];
      const finalMatch = Array.isArray(finalRound)
        ? finalRound.find((match) => match.stage === "final") ||
          (finalRound.length === 1 ? finalRound[0] : null)
        : null;
      const champion = finalMatch?.winner ||
        (finalMatch && Number(finalMatch.score1) !== Number(finalMatch.score2)
          ? Number(finalMatch.score1) > Number(finalMatch.score2) ? finalMatch.team1 : finalMatch.team2
          : null);

      if (!champion || champion === "Empate (Definir)") {
        showNotice("⚠️ No se puede finalizar: la gran final debe tener un ganador.");
        return;
      }
    }

    const finishedObj = { ...activeTournament, status: "Finalizado" };
    const { error } = await supabase
      .from("tournaments")
      .update({ status: "Finalizado", groups: finishedObj.groups, playoffs: finishedObj.playoffs })
      .eq("id", finishedObj.id);

    if (error) {
      console.error("Error al finalizar el torneo:", error);
      showNotice("❌ No se pudo finalizar el torneo. Intentá nuevamente.");
      return;
    }

    setActiveTournament(finishedObj);
    setTournaments((prev) => prev.map((t) => t.id === finishedObj.id ? finishedObj : t));
    setShowChampionCard(true);
  };

  const tournamentCategories = [...new Set(
    tournaments.map((tournament) =>
      getTournamentCategory(tournament)
    ).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "es"));

  const getTournamentDivision = (tournament) => {
    const parts = String(tournament?.game || "").split(" · ").map((part) => part.trim());
    const explicitDivision = parts.find((part) => ["Infantil", "Femenino", "Mayores"].includes(part));
    if (explicitDivision) return explicitDivision;
    const category = `${getTournamentCategory(tournament)} ${tournament?.game || ""}`.toLocaleLowerCase("es");
    if (/femenin|mujer/.test(category)) return "Femenino";
    if (/mayor|adult|senior|primera/.test(category)) return "Mayores";
    return "Infantil";
  };

  const filteredTournaments = tournaments.flatMap((tournament) => {
    const registrationGroup = (Array.isArray(tournament.groups) ? tournament.groups : [])
      .find((group) => group?.name === "__INSCRIPCIONES__");
    const configuredBranches = Array.isArray(registrationGroup?.category_config)
      ? registrationGroup.category_config
      : [];

    const categoryEntries = configuredBranches.flatMap((branch) =>
      (Array.isArray(branch.categories) ? branch.categories : []).map((category) => ({
        division: String(branch.division || "").trim(),
        categoryType: String(branch.categoryType || "").trim(),
        category: String(category || "").trim(),
      }))
    ).filter((entry) => entry.division && entry.category);

    const displayTournaments = categoryEntries.length
      ? categoryEntries.map((entry) => {
          const displayGame = `Fútbol · ${entry.division} · ${entry.category}`;
          const displayGroups = (Array.isArray(tournament.groups) ? tournament.groups : []).map((group) =>
            group?.name === "__INSCRIPCIONES__"
              ? { ...group, category_config: [{ division: entry.division, categoryType: entry.categoryType, categories: [entry.category] }] }
              : group
          );
          return {
            ...tournament,
            game: displayGame,
            groups: displayGroups,
            displayKey: `${tournament.id}-${entry.division}-${entry.category}`,
          };
        })
      : [{ ...tournament, displayKey: String(tournament.id) }];

    return displayTournaments.filter((displayTournament) => {
      const matchesCategory = tournamentCategoryFilter === "Todas" ||
        getTournamentCategory(displayTournament) === tournamentCategoryFilter;
      const matchesDivision = tournamentDivisionFilter === "Todas" ||
        getTournamentDivision(displayTournament) === tournamentDivisionFilter;
      return matchesCategory && matchesDivision;
    });
  });

  const assignedRefereeMatches = isArbitro ? tournaments.flatMap((tournament) =>
    (Array.isArray(tournament.groups) ? tournament.groups : []).flatMap((group, groupIndex) =>
      (Array.isArray(group?.matches) ? group.matches : [])
        .map((match) => ({
          tournament,
          tournamentTitle: tournament.title || "Torneo FEFUTIN",
          category: getTournamentCategory(tournament),
          groupName: group?.name || `Grupo ${groupIndex + 1}`,
          groupIndex,
          matchId: match?.id,
          team1: match?.team1 || "",
          team2: match?.team2 || "",
          refereeClosed: Boolean(match?.referee_closed),
          round: match?.round || null,
        }))
        .filter((item) => item.matchId != null && item.team1 && item.team2 &&
          item.team1.toLocaleLowerCase("es") !== "pasaje directo" &&
          item.team2.toLocaleLowerCase("es") !== "pasaje directo" &&
          (tournament.groups[groupIndex].matches || []).some((candidate) =>
            candidate?.id === item.matchId && candidate?.referee_id === currentUser?.id
          ))
    )
  ) : [];
  const hasPendingRefereeAssignments = assignedRefereeMatches.some((match) => !match.refereeClosed);
  const referenteNextMatch = (() => {
    if (!isReferente || !referenteParticipations.length || !tournaments.length) return null;
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const normalize = (value) => String(value || "").trim().toLocaleLowerCase("es");
    const candidates = [];
    referenteParticipations.forEach((participation) => {
      const tournament = tournaments.find((item) =>
        normalize(item.title) === normalize(participation.tournament_title) &&
        (normalize(participation.category_label) === normalize(getTournamentCategory(item)) ||
          normalize(participation.category_label).endsWith(normalize(getTournamentCategory(item))))
      );
      if (!tournament) return;
      (tournament.groups || []).forEach((group, groupIndex) => {
        (group?.matches || []).forEach((match) => {
          const isMyClub = normalize(match.team1) === normalize(participation.club_name) || normalize(match.team2) === normalize(participation.club_name);
          if (!isMyClub || !match.team1 || !match.team2) return;
          const round = Number(match.round || 1);
          const matchDate = match.match_date || getFefutinMatchDate(round);
          if (matchDate < todayKey) return;
          if (match.score1 !== null && match.score1 !== undefined && match.score2 !== null && match.score2 !== undefined) return;
          candidates.push({ tournament, participation, match, groupIndex, round, matchDate });
        });
      });
    });
    candidates.sort((a, b) => a.matchDate.localeCompare(b.matchDate) || a.round - b.round);
    return candidates[0] || null;
  })();

  useEffect(() => {
    let cancelled = false;
    const loadMatchClubs = async () => {
      if (!isReferente || !referenteNextMatch?.tournament?.id) {
        setReferenteMatchClubs([]);
        return;
      }
      const { data, error } = await supabase.rpc("get_fefutin_tournament_clubs", {
        p_tournament_id: referenteNextMatch.tournament.id,
      });
      if (cancelled) return;
      if (error) {
        console.error("No se pudieron cargar los escudos del próximo encuentro:", error);
        setReferenteMatchClubs([]);
      } else setReferenteMatchClubs(data || []);
    };
    loadMatchClubs();
    return () => { cancelled = true; };
  }, [isReferente, referenteNextMatch?.tournament?.id]);

  const openTournament = (tournament) => {
    setActiveTournament(tournament);
    setActiveView(
      tournament.playoffs && tournament.playoffs.length > 0
        ? "playoffs"
        : "groups"
    );
  };

  const renderDivisionCard = (division, image, label) => (
    <section className="tc-home-division-section" key={division}>
      <button
        type="button"
        className="tc-home-division-card"
        onClick={() => {
          setTournamentDivisionFilter(division);
          setTournamentCategoryFilter("Todas");
          setDivisionCategorySearch("");
          setActiveView("division-tournaments");
        }}
      >
        <img src={image} alt="" />
        <span>{label}</span>
      </button>
    </section>
  );


  return (
    <div className="cr-container tc-theme-clash">
      {showWelcome && activeView !== "admin-login" && (
        <section className="fefutin-welcome" aria-label="Bienvenida a FEFUTIN">
          <div className="fefutin-welcome-panel">
            <img src="https://fefutin.wordpress.com/wp-content/uploads/2017/03/fefutin-logo-grande1.png?h=184&w=166" alt="Logo histórico de FEFUTIN" className="fefutin-welcome-logo" />
            <div className="fefutin-welcome-kicker">FEDERACIÓN DE FÚTBOL INFANTIL</div>
            <h1>FEFUTIN</h1>
            <p>Pasión, formación y competencia.</p>
            <button type="button" onClick={() => setShowWelcome(false)}>BIENVENIDOS</button>
          </div>
        </section>
      )}
      <TournamentNotice
        notice={notice}
        onClose={clearNotice}
        confirmation={confirmation}
        onResolveConfirmation={resolveConfirmation}
      />
      {showChampionCard && activeTournament?.status === "Finalizado" && (
        <ChampionCelebration
          tournament={activeTournament}
          onClose={() => setShowChampionCard(false)}
        />
      )}
      <Navbar
          onGoHome={handleGoHome}
          currentTitle={activeTournament?.title}
          tournamentCode={activeTournament?.code}
          currentUser={currentUser}
          tournaments={tournaments}
          isAdmin={isAdmin}
          canManageAccess={canManageAccess}
          pendingAccessCount={pendingAccessRequests.length}
          onGoAccessRequests={() => { setAccessActionError(""); setActiveView("access-requests"); }}
          onGoStats={() => setActiveView("stats")}
          isArbitro={isArbitro}
          onGoMyCarnet={() => setActiveView("referee-carnets")}
          onGoCarnetDirectory={() => setActiveView("referee-carnet-directory")}
          onAdminClick={() => setActiveView("admin-login")}
          onLogout={handleLogout}
        />

      {activeView === "admin-login" && !isAdmin ? (
        <div className="tc-form-screen tc-auth-screen">
        <div className="cr-card tc-auth-card" style={{ margin: "auto" }}>
          <div className="cr-card-glow"></div>

          <div
            style={{
              textAlign: "center",
              marginBottom: "1.5rem",
            }}
          >
            <img
              src="https://fefutin.wordpress.com/wp-content/uploads/2017/03/fefutin-logo-grande1.png?h=184&w=166"
              alt="Escudo original de FEFUTIN"
              className="tc-login-crest"
            />

            <div className="tc-auth-kicker"><span></span> PLATAFORMA DE TORNEOS DEPORTIVOS <span></span></div>
            <h1 className="cr-logo-title">FEFUTIN</h1>
            <p className="tc-auth-tagline">Ingresá a la plataforma de FEFUTIN.</p>
          </div>

          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
            <button type="button" onClick={() => setAuthMode("login")} className={authMode === "login" ? "cr-btn-gold" : "tc-form-back"} style={{ flex: 1, padding: "0.65rem" }}>Ingresar</button>
            <button type="button" onClick={() => setAuthMode("register")} className={authMode === "register" ? "cr-btn-gold" : "tc-form-back"} style={{ flex: 1, padding: "0.65rem" }}>Solicitar acceso</button>
          </div>

          <form
            className="tc-auth-form"
            onSubmit={authMode === "register" ? handleRegisterSubmit : handleAuthSubmit}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
            }}
          >
            {authMode === "register" && <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: "bold", textTransform: "uppercase", color: "#d1d5db", marginBottom: "4px" }}>Nombre y apellido</label>
              <input type="text" placeholder="Ej: Juan Pérez" value={registerInput.username} onChange={(e) => setRegisterInput({ ...registerInput, username: e.target.value })} required minLength={3} className="cr-input" />
            </div>}

            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.75rem",
                  fontWeight: "bold",
                  textTransform: "uppercase",
                  color: "#d1d5db",
                  marginBottom: "4px",
                }}
              >
                <span className="tc-auth-field-icon" aria-hidden="true">✉</span> Email
              </label>

              <input
                type="email"
                placeholder="Ej: jugador@gmail.com"
                value={authInput.email}
                onChange={(e) =>
                  setAuthInput({
                    ...authInput,
                    email: e.target.value,
                  })
                }
                required
                className="cr-input"
              />
            </div>

            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.75rem",
                  fontWeight: "bold",
                  textTransform: "uppercase",
                  color: "#d1d5db",
                  marginBottom: "4px",
                }}
              >
                <span><span className="tc-auth-field-icon" aria-hidden="true">◆</span> Contraseña</span>
                {true && (
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#60a5fa",
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      cursor: "pointer",
                      padding: "2px 0 2px 8px",
                      textTransform: "none",
                    }}
                  >
                    {showPassword ? "Ocultar" : "Mostrar"}
                  </button>
                )}
              </label>

              <input
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={authInput.password}
                onChange={(e) =>
                  setAuthInput({
                    ...authInput,
                    password: e.target.value,
                  })
                }
                required
                className="cr-input"
              />
            </div>

            {authMode === "register" && <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: "bold", textTransform: "uppercase", color: "#d1d5db", marginBottom: "4px" }}>Solicito acceso como</label>
              <select value={registerInput.requestedRole} onChange={(e) => setRegisterInput({ ...registerInput, requestedRole: e.target.value })} className="cr-input" required>
                <option value="arbitro">Árbitro</option>
                <option value="referente">Referente de equipo</option>
                <option value="directivo">Directivo</option>
              </select>
              <p style={{ color: "#9ca3af", fontSize: "0.75rem", lineHeight: 1.45, margin: "0.35rem 0 0" }}>La solicitud debe ser aprobada por un administrador o directivo de FEFUTIN. Mientras tanto tendrás acceso público como visitante.</p>
            </div>}

            <button
              type="submit"
              className="cr-btn-gold tc-auth-submit"
              style={{
                marginTop: "0.5rem",
                padding: "0.55rem 1rem",
                borderBottom: "3px solid #522b00",
              }}
            >
              <><TCIcon name="shield" size={17} /> {authMode === "register" ? "Enviar solicitud" : "Ingresar"}</>
            </button>

            <div style={{ textAlign: "center", marginTop: "0.5rem" }}>
              <button type="button" onClick={() => { setActiveView("home"); setAuthMode("login"); setAuthInput({ email: "", password: "" }); setRegisterInput({ username: "", requestedRole: "arbitro" }); }} style={{ background: "transparent", border: "none", color: "#9ca3af", fontSize: "0.8rem", cursor: "pointer" }}>
                ← Volver a la plataforma pública
              </button>
            </div>
          </form>
        </div>
        </div>
      ) : activeView === "access-requests" && canManageAccess ? (
        <div className="tc-form-screen" style={{ padding: "0", minHeight: "70vh" }}>
          <section className="cr-card" style={{ width: "100%", maxWidth: "100%", margin: "0", padding: "clamp(1rem, 3vw, 2rem)", boxSizing: "border-box" }}>
            <button type="button" className="tc-form-back" onClick={() => setActiveView("home")}>← Volver</button>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", margin: "1rem 0 1.5rem" }}>
              <div>
                <p style={{ color: "#b5122a", fontWeight: 900, letterSpacing: "0.12em", fontSize: "0.72rem", margin: 0 }}>GESTIÓN DE USUARIOS</p>
                <h2 className="cr-title" style={{ margin: "0.35rem 0" }}>CENTRO DE GESTIÓN FEFUTIN</h2>
                <p style={{ color: "var(--tc-text, #fff)", opacity: 0.75, margin: 0 }}>Organizá todos los llamados y registros desde estas tres secciones.</p>
              </div>
              <button type="button" className="tc-form-back" onClick={refreshPendingRequests} disabled={loadingAccessRequests}>↻ Actualizar</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 210px), 1fr))", gap: ".8rem", margin: "1rem 0 1.4rem" }}>
              {[
                { id: "torneos", title: "TORNEOS", subtitle: "Clubes e inscripciones", count: activeClubs.length + pendingAccessRequests.filter((r) => r.requested_role === "referente" || r.requested_role === "directivo").length + pendingClubTournamentRequestsCount, icon: "🏆" },
                { id: "jugadores", title: "JUGADORES", subtitle: "Llamados, altas y carnets", count: "GESTIÓN", icon: "⚽" },
                { id: "arbitros", title: "ÁRBITROS", subtitle: "Solicitudes, carnets y estadísticas", count: activeReferees.length + pendingAccessRequests.filter((r) => r.requested_role === "arbitro").length, icon: "🟨" },
              ].map((item) => {
                const selected = managementInboxTab === item.id;
                return <button key={item.id} type="button" onClick={() => setManagementInboxTab(item.id)} aria-pressed={selected}
                  style={{ textAlign: "left", cursor: "pointer", border: selected ? "2px solid #b5122a" : "1px solid #555", borderRadius: "12px", background: selected ? "#391018" : "#111", color: "#fff", padding: "1rem", boxShadow: selected ? "0 0 0 2px rgba(181,18,42,.18)" : "none" }}>
                  <span style={{ fontSize: "1.5rem" }}>{item.icon}</span>
                  <strong style={{ display: "block", marginTop: ".45rem", fontSize: ".95rem", letterSpacing: ".06em" }}>{item.title}</strong>
                  <span style={{ display: "block", color: "#ccc", fontSize: ".76rem", marginTop: ".2rem" }}>{item.subtitle}</span>
                  <span style={{ display: "inline-block", marginTop: ".7rem", color: "#fff", background: "#b5122a", borderRadius: "20px", padding: ".22rem .6rem", fontSize: ".68rem", fontWeight: 800 }}>{item.count}</span>
                </button>;
              })}
            </div>
            {accessActionError && <div role="alert" style={{ border: "1px solid #b5122a", color: "#fff", background: "#391018", borderRadius: "8px", padding: "0.8rem", marginBottom: "1rem" }}>{accessActionError}</div>}
            {managementInboxTab !== "jugadores" && (loadingAccessRequests ? (
              <p style={{ color: "#fff", textAlign: "center", padding: "2rem" }}>Cargando solicitudes...</p>
            ) : pendingAccessRequests.filter((request) => managementInboxTab === "arbitros" ? request.requested_role === "arbitro" : request.requested_role !== "arbitro").length === 0 ? (
              <div style={{ border: "1px solid #555", borderRadius: "12px", padding: "2rem 1rem", textAlign: "center", color: "#fff" }}>
                <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>✓</div>
                <strong>{managementInboxTab === "arbitros" ? "No hay solicitudes de árbitros pendientes" : "No hay solicitudes de clubes o directivos pendientes"}</strong>
                <p style={{ opacity: 0.7, marginBottom: 0 }}>Cuando alguien solicite acceso como árbitro, referente o directivo, aparecerá aquí.</p>
              </div>
            ) : (
              <div style={{ display: "grid", gap: "0.85rem" }}>
                {pendingAccessRequests.filter((request) => managementInboxTab === "arbitros" ? request.requested_role === "arbitro" : request.requested_role !== "arbitro").map((request) => (
                  <article key={request.id} style={{ border: "1px solid #b5122a", borderRadius: "12px", background: "#111", padding: "1rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ color: "#fff", display: "block", fontSize: "1rem" }}>{request.username || "Sin nombre"}</strong>
                      <span style={{ color: "#ddd", display: "block", overflowWrap: "anywhere", fontSize: "0.88rem" }}>{request.email || "Sin email"}</span>
                      <span style={{ display: "inline-block", marginTop: "0.5rem", color: "#fff", background: "#8f1026", borderRadius: "20px", padding: "0.25rem 0.65rem", fontSize: "0.72rem", fontWeight: 800 }}>{request.requested_role === "directivo" ? "SOLICITA SER DIRECTIVO" : request.requested_role === "referente" ? "SOLICITA SER REFERENTE DE EQUIPO" : "SOLICITA SER ÁRBITRO"}</span>
                      {request.requested_role === "referente" && request.club_name && (
                        <div style={{ marginTop: ".8rem", padding: ".8rem", border: "1px solid #5b2630", borderRadius: "9px", background: "#1b1114" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: ".8rem" }}>
                            {request.logo_path && <img src={supabase.storage.from("fefutin-clubs").getPublicUrl(request.logo_path).data.publicUrl} alt={`Escudo de ${request.club_name}`} style={{ width: "64px", height: "64px", objectFit: "contain", borderRadius: "8px", background: "#fff" }} />}
                            <div>
                              <strong style={{ color: "#fff", display: "block" }}>{request.club_name}</strong>
                              <span style={{ color: "#ddd", fontSize: ".82rem" }}>{request.headquarters_address}</span>
                            </div>
                          </div>
                          {Array.isArray(request.selected_tournaments) && request.selected_tournaments.length > 0 && (
                            <div style={{ marginTop: ".7rem" }}>
                              <strong style={{ color: "#ffb3bf", fontSize: ".78rem" }}>TORNEOS SOLICITADOS</strong>
                              {request.selected_tournaments.map((item, index) => (
                                <div key={`${request.id}-torneo-${index}`} style={{ color: "#eee", fontSize: ".82rem", marginTop: ".25rem" }}>
                                  {item.title} · {item.category_label}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {request.requested_role === "referente" && !request.club_name && (
                        <small style={{ display: "block", color: "#fbbf24", marginTop: ".5rem" }}>Todavía no completó la ficha institucional del club.</small>
                      )}
                      <small style={{ display: "block", color: "#aaa", marginTop: "0.4rem" }}>Recibida: {request.created_at ? new Date(request.created_at).toLocaleString("es-AR") : "—"}</small>
                    </div>
                    {request.requested_role === "arbitro" && (
                      <div style={{ width: "100%", marginTop: ".9rem", padding: ".9rem", border: "1px solid #6d2632", borderRadius: "10px", background: "#1a1013" }}>
                        <strong style={{ display: "block", color: "#ffb3bf", fontSize: ".78rem", letterSpacing: ".06em", marginBottom: ".7rem" }}>DATOS PARA CREAR EL CARNET</strong>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,190px),1fr))", gap: ".65rem" }}>
                          <label style={{ display: "grid", gap: ".25rem", color: "#eee", fontSize: ".76rem", fontWeight: 700 }}>Nombre
                            <input required value={refereeApprovalForms[request.id]?.first_name || ""} onChange={(e) => updateRefereeApprovalForm(request.id, "first_name", e.target.value)} style={{ width: "100%", minWidth: 0, boxSizing: "border-box", padding: ".65rem", borderRadius: "7px", border: "1px solid #555", background: "#090909", color: "#fff" }} />
                          </label>
                          <label style={{ display: "grid", gap: ".25rem", color: "#eee", fontSize: ".76rem", fontWeight: 700 }}>Apellido
                            <input required value={refereeApprovalForms[request.id]?.last_name || ""} onChange={(e) => updateRefereeApprovalForm(request.id, "last_name", e.target.value)} style={{ width: "100%", minWidth: 0, boxSizing: "border-box", padding: ".65rem", borderRadius: "7px", border: "1px solid #555", background: "#090909", color: "#fff" }} />
                          </label>
                          <label style={{ display: "grid", gap: ".25rem", color: "#eee", fontSize: ".76rem", fontWeight: 700 }}>Matrícula
                            <input required value={refereeApprovalForms[request.id]?.referee_number || ""} onChange={(e) => updateRefereeApprovalForm(request.id, "referee_number", e.target.value)} style={{ width: "100%", minWidth: 0, boxSizing: "border-box", padding: ".65rem", borderRadius: "7px", border: "1px solid #555", background: "#090909", color: "#fff" }} />
                          </label>
                          <label style={{ display: "grid", gap: ".25rem", color: "#eee", fontSize: ".76rem", fontWeight: 700 }}>Localidad
                            <input required value={refereeApprovalForms[request.id]?.locality || ""} onChange={(e) => updateRefereeApprovalForm(request.id, "locality", e.target.value)} style={{ width: "100%", minWidth: 0, boxSizing: "border-box", padding: ".65rem", borderRadius: "7px", border: "1px solid #555", background: "#090909", color: "#fff" }} />
                          </label>
                          <label style={{ display: "grid", gap: ".25rem", color: "#eee", fontSize: ".76rem", fontWeight: 700 }}>Fecha de nacimiento
                            <input type="date" value={refereeApprovalForms[request.id]?.birth_date || ""} onChange={(e) => updateRefereeApprovalForm(request.id, "birth_date", e.target.value)} style={{ width: "100%", minWidth: 0, boxSizing: "border-box", padding: ".65rem", borderRadius: "7px", border: "1px solid #555", background: "#090909", color: "#fff", colorScheme: "dark" }} />
                          </label>
                          <label style={{ display: "grid", gap: ".25rem", color: "#eee", fontSize: ".76rem", fontWeight: 700 }}>Fotografía (JPG, PNG o WEBP · máx. 5 MB)
                            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => updateRefereeApprovalForm(request.id, "photo_file", e.target.files?.[0] || null)} style={{ width: "100%", minWidth: 0, boxSizing: "border-box", padding: ".55rem", borderRadius: "7px", border: "1px solid #555", background: "#090909", color: "#fff" }} />
                          </label>
                        </div>
                        <small style={{ display: "block", color: "#aaa", marginTop: ".55rem" }}>El carnet se crea al aprobar. Nombre, apellido, matrícula y localidad son obligatorios; fecha y foto pueden completarse después.</small>
                      </div>
                    )}
                    <div style={{ display: "flex", gap: "0.55rem", flexWrap: "wrap", marginTop: ".75rem" }}>
                      <button type="button" className="cr-btn-gold" disabled={processingAccessId === request.id} onClick={() => handleAccessDecision(request.id, "approve", request)}>{processingAccessId === request.id ? "Procesando..." : request.requested_role === "arbitro" ? "Aprobar y crear carnet" : "Aprobar"}</button>
                      <button type="button" className="tc-form-back" disabled={processingAccessId === request.id} onClick={() => handleAccessDecision(request.id, "reject", request)}>Desestimar</button>
                    </div>
                  </article>
                ))}
              </div>
            ))}

            {managementInboxTab === "jugadores" && <FefutinPlayerApprovals />}

            {managementInboxTab === "torneos" && <div style={{ borderTop: "1px solid #3a3a3a", marginTop: "1.75rem", paddingTop: "1.4rem" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.9rem" }}>
                <div>
                  <h3 style={{ color: "#fff", margin: 0 }}>CLUBES HABILITADOS</h3>
                  <p style={{ color: "#aaa", fontSize: "0.82rem", margin: "0.3rem 0 0" }}>Administrá las inscripciones de cada club sin eliminar los torneos de FEFUTIN.</p>
                </div>
                <button type="button" className="tc-form-back" onClick={loadActiveClubs} disabled={loadingActiveClubs}>↻ Actualizar clubes</button>
              </div>
              {loadingActiveClubs ? (
                <p style={{ color: "#ddd", textAlign: "center", padding: "1rem" }}>Cargando clubes habilitados...</p>
              ) : activeClubs.length === 0 ? (
                <p style={{ color: "#aaa", padding: "0.5rem 0" }}>Todavía no hay clubes habilitados.</p>
              ) : (
                <div style={{ display: "grid", gap: "0.8rem" }}>
                  {activeClubs.map((club) => (
                    <article key={club.club_id} style={{ border: "1px solid #b5122a", borderRadius: "10px", background: "#111", padding: "0.9rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap" }}>
                        {club.logo_path && <img src={supabase.storage.from("fefutin-clubs").getPublicUrl(club.logo_path).data.publicUrl} alt={`Escudo de ${club.club_name}`} style={{ width: "58px", height: "58px", objectFit: "contain", borderRadius: "8px", background: "#fff" }} />}
                        <div style={{ minWidth: 0 }}>
                          <strong style={{ color: "#fff", display: "block" }}>{club.club_name}</strong>
                          <span style={{ color: "#ccc", fontSize: "0.82rem", display: "block" }}>{club.headquarters_address}</span>
                          <span style={{ color: "#aaa", fontSize: "0.78rem" }}>Referente: {club.referente_name || "Sin nombre"} · {club.referente_email || "Sin email"}</span>
                        </div>
                      </div>
                      <div style={{ marginTop: "0.8rem", borderTop: "1px solid #3a3a3a", paddingTop: "0.7rem" }}>
                        <strong style={{ color: "#ffb3bf", fontSize: "0.76rem" }}>TORNEOS INSCRIPTOS</strong>
                        {Array.isArray(club.tournaments) && club.tournaments.length > 0 ? club.tournaments.map((tournament) => (
                          <div key={tournament.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.6rem", flexWrap: "wrap", marginTop: "0.55rem", padding: "0.55rem", background: "#1b1b1b", borderRadius: "8px" }}>
                            <span style={{ color: "#fff", fontSize: "0.84rem" }}>{tournament.title} · {tournament.category_label}</span>
                            <button type="button" className="tc-form-back" onClick={() => handleRemoveClubTournament(club, tournament)} disabled={removingClubTournamentId === tournament.id} style={{ borderColor: "#b5122a", color: "#fff", background: "#391018", opacity: removingClubTournamentId === tournament.id ? 0.6 : 1 }}>
                              {removingClubTournamentId === tournament.id ? "Quitando..." : "Quitar inscripción"}
                            </button>
                          </div>
                        )) : <p style={{ color: "#aaa", fontSize: "0.82rem", marginBottom: 0 }}>Este club no tiene torneos vinculados.</p>}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>}

            {managementInboxTab === "torneos" && <FefutinClubTournamentRequests onChanged={async () => { await loadActiveClubs(); await refreshPendingRequests(); }} />}

            {managementInboxTab === "arbitros" && <div style={{ borderTop: "1px solid #3a3a3a", marginTop: "1.75rem", paddingTop: "1.4rem" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.9rem" }}>
                <div>
                  <h3 style={{ color: "#fff", margin: 0 }}>ÁRBITROS ACTIVOS</h3>
                  <p style={{ color: "#aaa", fontSize: "0.82rem", margin: "0.3rem 0 0" }}>Desde aquí podés dar de baja una cuenta sin borrar sus partidos ni sus estadísticas.</p>
                </div>
                <button type="button" className="tc-form-back" onClick={loadActiveReferees} disabled={loadingActiveReferees}>↻ Actualizar árbitros</button>
              </div>

              {loadingActiveReferees ? (
                <p style={{ color: "#ddd", textAlign: "center", padding: "1rem" }}>Cargando árbitros...</p>
              ) : activeReferees.length === 0 ? (
                <p style={{ color: "#aaa", padding: "0.5rem 0" }}>No hay árbitros activos para mostrar.</p>
              ) : (
                <div style={{ display: "grid", gap: "0.7rem" }}>
                  {activeReferees.map((referee) => (
                    <article key={referee.id} style={{ border: "1px solid #444", borderRadius: "10px", background: "#111", padding: "0.85rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.8rem", flexWrap: "wrap" }}>
                      <div style={{ minWidth: 0 }}>
                        <strong style={{ color: "#fff", display: "block" }}>{referee.username || "Árbitro sin nombre"}</strong>
                        <span style={{ color: "#aaa", fontSize: "0.82rem", overflowWrap: "anywhere" }}>{referee.email || "Sin email registrado"}</span>
                      </div>
                      <button
                        type="button"
                        className="tc-form-back"
                        onClick={() => handleDeactivateReferee(referee)}
                        disabled={deactivatingRefereeId === referee.id}
                        style={{ borderColor: "#b5122a", color: "#fff", background: "#391018", opacity: deactivatingRefereeId === referee.id ? 0.6 : 1 }}
                      >
                        {deactivatingRefereeId === referee.id ? "Procesando..." : "Dar de baja"}
                      </button>
                    </article>
                  ))}
                </div>
              )}
              <div style={{ marginTop: "1.2rem" }}>
                <RefereeCarnets currentUser={currentUser} canManage={true} onBack={() => setManagementInboxTab("arbitros")} />
                <RefereeStats onBack={() => setManagementInboxTab("arbitros")} canManageAccess={true} onDeactivateReferee={handleDeactivateReferee} />
              </div>
            </div>}
          </section>
        </div>
      ) : activeView === "referee-carnets" && isArbitro ? (
        <RefereeCarnets currentUser={currentUser} canManage={false} onBack={() => setActiveView("home")} />
      ) : activeView === "referee-carnet-directory" && canManageAccess ? (
        <RefereeCarnets currentUser={currentUser} canManage={true} onBack={() => setActiveView("home")} />
      ) : activeView === "stats" && isAdmin ? (
        <div className="tc-form-screen tc-stats-screen">
          <AdminStats onBack={() => setActiveView("home")} />
        </div>
      ) : activeView === "referee-pre-jornada" && canManageAccess ? (
        <div className="tc-form-screen tc-stats-screen">
          <RefereePreJornadaErrorBoundary onBack={() => setActiveView("home")}>
            <RefereePreJornada onBack={() => setActiveView("home")} />
          </RefereePreJornadaErrorBoundary>
        </div>
      ) : activeView === "referee-stats" && canViewRefereeStats ? (
        <div className="tc-form-screen tc-stats-screen">
          <RefereeStats onBack={() => setActiveView("home")} canManageAccess={canManageAccess} onDeactivateReferee={handleDeactivateReferee} />
        </div>
      ) : activeView === "sheet-archive" && canManageAccess ? (
        <FefutinSheetArchive mode="archive" currentUser={currentUser} onBack={() => setActiveView("home")} />
      ) : activeView === "referee-sheet-photo" && isArbitro ? (
        <FefutinSheetArchive mode="upload" currentUser={currentUser} assignedMatches={assignedRefereeMatches} onBack={() => setActiveView("referee-designations")} />
      ) : activeView === "referee-designations" && isArbitro ? (
        <div className="tc-form-screen" style={{ padding: "1rem", minHeight: "70vh" }}>
          <section style={{ width: "100%", maxWidth: "900px", margin: "auto", padding: "1rem", background: "#101010", border: "1px solid #b5122a", borderRadius: "12px", color: "#fff" }}>
            <button type="button" className="tc-form-back" onClick={() => setActiveView("home")}>← Volver</button>
            <h2 style={{ color: "#fff", margin: "1rem 0 .35rem", letterSpacing: ".06em" }}>MIS DESIGNACIONES</h2>
            <p style={{ color: "#ccc", fontSize: ".82rem", marginTop: 0 }}>Partidos asignados a tu cuenta arbitral.</p>
            <button type="button" onClick={() => setActiveView("referee-sheet-photo")} style={{ width: "100%", margin: ".6rem 0 1rem", padding: ".75rem", border: "1px solid #b5122a", borderRadius: "8px", background: "#b5122a", color: "#fff", fontWeight: 900, cursor: "pointer" }}>📷 SUBIR FOTO DE PLANILLA GENERAL FIRMADA</button>
            {assignedRefereeMatches.length === 0 ? (
              <p style={{ color: "#ddd", padding: "1rem 0" }}>No tenés partidos designados actualmente.</p>
            ) : (
              <div style={{ display: "grid", gap: ".7rem" }}>
                {assignedRefereeMatches.map((item, index) => (
                  <article key={`${item.tournament.id}-${item.groupIndex}-${item.matchId}`} style={{ border: "1px solid #b5122a", borderRadius: "10px", padding: ".85rem", background: "#171c27" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: ".5rem", alignItems: "center", flexWrap: "wrap" }}>
                      <strong style={{ color: "#fff", fontSize: ".8rem" }}>{item.tournamentTitle}</strong>
                      <span style={{ color: item.refereeClosed ? "#86efac" : "#fca5a5", fontSize: ".68rem", fontWeight: 900 }}>{item.refereeClosed ? "PARTIDO CERRADO" : "PENDIENTE"}</span>
                    </div>
                    <div style={{ color: "#ddd", fontSize: ".75rem", margin: ".35rem 0" }}>{item.category} · {item.groupName}{item.round ? ` · Fecha ${item.round}` : ""}</div>
                    <div style={{ color: "#fff", fontWeight: 900, textAlign: "center", padding: ".55rem 0" }}>{item.team1} <span style={{ color: "#b5122a" }}>VS.</span> {item.team2}</div>
                    <button type="button" onClick={() => {
                      setActiveTournament(item.tournament);
                      setRefereeMatchToOpen({ groupIndex: item.groupIndex, matchId: item.matchId });
                      setActiveView("groups");
                    }} style={{ width: "100%", padding: ".65rem", border: "1px solid #b5122a", borderRadius: "7px", background: "#fff", color: "#171c27", fontWeight: 900, cursor: "pointer" }}>
                      {item.refereeClosed ? "VER PLANILLA" : "ABRIR PLANILLA"}
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : activeView === "division-tournaments" ? (
        <div className="tc-form-screen tc-division-tournaments-screen">
          <section className="cr-card" style={{ width: "100%", maxWidth: "980px", margin: "auto", background: "#080808", backgroundColor: "#080808", color: "#fff", border: "1px solid #b5122a" }}>
            <button type="button" className="tc-form-back" onClick={() => setActiveView("home")}>
              <span aria-hidden="true">←</span> Volver
            </button>
            <div className="tc-division-heading-search">
              <div className="tc-home-panel-art">
                <div><span>FEFUTIN</span><strong>FÚTBOL · {tournamentDivisionFilter.toLocaleUpperCase("es")}</strong></div>
              </div>
              <h2 className="cr-title">TORNEOS DE {tournamentDivisionFilter.toLocaleUpperCase("es")}</h2>
              <div className="tc-division-search">
                <span aria-hidden="true">⌕</span>
                <input
                  type="search"
                  value={divisionCategorySearch}
                  onChange={(event) => setDivisionCategorySearch(event.target.value)}
                  placeholder="Buscar por categoría o torneo..."
                  aria-label={`Buscar torneos de ${tournamentDivisionFilter} por categoría o nombre`}
                />
                {divisionCategorySearch && (
                  <button type="button" onClick={() => setDivisionCategorySearch("")} aria-label="Limpiar búsqueda">×</button>
                )}
              </div>
            </div>
            {(() => {
              const branchTournaments = tournaments.filter((t) => getTournamentDivision(t) === tournamentDivisionFilter);
              const query = divisionCategorySearch.trim().toLocaleLowerCase("es");
              const visibleTournaments = branchTournaments.filter((t) => {
                const category = getTournamentCategory(t);
                return !query ||
                  String(t.title || "").toLocaleLowerCase("es").includes(query) ||
                  String(category || "").toLocaleLowerCase("es").includes(query);
              });

              if (!branchTournaments.length) {
                return <p style={{ color: "#fff" }}>Todavía no hay torneos creados en esta rama.</p>;
              }
              if (!visibleTournaments.length) {
                return <p className="tc-division-search-empty">No encontramos torneos para “{divisionCategorySearch}”. Probá con otra categoría o nombre.</p>;
              }

              return (
                <div
                  className="tc-division-tournament-carousel"
                  aria-label={`Carrusel de torneos de ${tournamentDivisionFilter}`}
                  onScroll={(event) => {
                    const container = event.currentTarget;
                    const center = container.getBoundingClientRect().left + container.clientWidth / 2;
                    let nearest = 0;
                    let distance = Infinity;
                    Array.from(container.children).forEach((card, index) => {
                      const rect = card.getBoundingClientRect();
                      const cardCenter = rect.left + rect.width / 2;
                      const currentDistance = Math.abs(center - cardCenter);
                      if (currentDistance < distance) { distance = currentDistance; nearest = index; }
                    });
                    setActiveDivisionTournamentIndex(nearest);
                  }}
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    width: "100%",
                    maxWidth: "100%",
                    minWidth: 0,
                    boxSizing: "border-box",
                    gap: 0,
                    marginTop: "1rem",
                    overflowX: "auto",
                    overflowY: "hidden",
                    padding: "2rem max(1rem, calc((100% - 300px) / 2)) 1.5rem",
                    scrollSnapType: "x mandatory",
                    scrollPaddingInline: "max(1rem, calc((100% - 300px) / 2))",
                    WebkitOverflowScrolling: "touch",
                    scrollbarWidth: "thin",
                    perspective: "900px",
                  }}
                >
                  {visibleTournaments.map((t) => {
                    const category = getTournamentCategory(t);
                    return (
                      <div
                        key={t.id}
                        style={{
                          position: "relative",
                          flex: "0 0 min(76%, 330px)",
                          width: "min(76%, 330px)",
                          maxWidth: "330px",
                          minWidth: "245px",
                          boxSizing: "border-box",
                          alignSelf: "center",
                          scrollSnapAlign: "center",
                          zIndex: activeDivisionTournamentIndex === visibleTournaments.indexOf(t) ? 3 : 1,
                          marginLeft: visibleTournaments.indexOf(t) === 0 ? 0 : "-58px",
                          transform: `translateY(${activeDivisionTournamentIndex === visibleTournaments.indexOf(t) ? "-3px" : "7px"}) scale(${activeDivisionTournamentIndex === visibleTournaments.indexOf(t) ? 1.08 : 0.78}) rotateY(${activeDivisionTournamentIndex > visibleTournaments.indexOf(t) ? "7deg" : activeDivisionTournamentIndex < visibleTournaments.indexOf(t) ? "-7deg" : "0deg"})`,
                          opacity: Math.abs(activeDivisionTournamentIndex - visibleTournaments.indexOf(t)) > 2 ? 0.58 : activeDivisionTournamentIndex === visibleTournaments.indexOf(t) ? 1 : 0.82,
                          transition: "transform 260ms cubic-bezier(.2,.8,.2,1), opacity 260ms ease, box-shadow 260ms ease",
                        }}
                      >
                        <button
                          type="button"
                          className="tc-home-division-tournament tc-division-tournament-card"
                          onClick={() => openTournament(t)}
                          style={{
                            background: "#171717",
                            backgroundColor: "#171717",
                            color: "#fff",
                            border: "1px solid #b5122a",
                            width: "100%",
                            height: "100%",
                            paddingRight: canDeleteTournaments ? "48px" : undefined,
                          }}
                        >
                          <strong>{t.title || "Torneo sin nombre"}</strong>
                          <span>Fútbol · {category}</span>
                          <small>{t.status || "En preparación"}</small>
                        </button>
                        {canDeleteTournaments && (
                          <button
                            type="button"
                            title="Eliminar torneo"
                            aria-label={`Eliminar torneo ${t.title || "sin nombre"}`}
                            disabled={deletingTournamentId === t.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleDeleteTournament(t);
                            }}
                            style={{
                              position: "absolute",
                              top: "8px",
                              right: "8px",
                              zIndex: 3,
                              width: "32px",
                              height: "32px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              padding: 0,
                              color: "#f87171",
                              background: deletingTournamentId === t.id ? "#374151" : "rgba(127,29,29,.45)",
                              border: "1px solid rgba(239,68,68,.75)",
                              borderRadius: "7px",
                              cursor: deletingTournamentId === t.id ? "not-allowed" : "pointer",
                            }}
                          >
                            {deletingTournamentId === t.id ? "…" : <TCIcon name="trash" size={17} />}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </section>
        </div>
      ) : activeView === "referente-solicitar-torneo" && isReferente && currentUser?.approvalStatus === "aprobado" && currentUser?.clubId ? (
        <ReferenteTorneoSolicitudes
          tournaments={tournaments}
          currentUser={currentUser}
          onBack={() => setActiveView("home")}
          onSubmitted={() => showNotice("La solicitud quedó pendiente de aprobación por Admin o Directivo.")}
        />
      ) : activeView === "referente-inscripcion" && canAccessClubManagement ? (
        <ReferenteInscripcion
          tournaments={tournaments}
          currentUser={currentUser}
          onBack={() => setActiveView("home")}
          onSubmitted={async () => {
            const { data: { user } } = await supabase.auth.getUser();
            const refreshedUser = await buildCurrentUser(user);
            setCurrentUser(refreshedUser);
            setActiveView("home");
            showNotice("✅ Inscripción enviada. Quedó pendiente de aprobación por administración o un directivo.");
          }}
        />
      ) : ["referente-equipos", "referente-torneos"].includes(activeView) && canAccessClubManagement ? (
        <ReferenteEquipos
          currentUser={currentUser}
          mode={activeView === "referente-torneos" ? "torneos" : "equipos"}
          readOnly={isAdmin || isDirectivo}
          onBack={() => setActiveView("home")}
          onOpenTeams={() => setActiveView("referente-equipos")}
          onOpenTournament={(participation) => {
            const normalizeTournamentText = (value) => String(value || "").trim().toLocaleLowerCase("es");
            const participationCategory = normalizeTournamentText(participation?.category_label);
            const tournament = tournaments.find((item) => {
              const tournamentCategory = normalizeTournamentText(getTournamentCategory(item));
              return normalizeTournamentText(item.title) === normalizeTournamentText(participation?.tournament_title) &&
                (participationCategory === tournamentCategory || participationCategory.endsWith(tournamentCategory));
            });
            if (!tournament) {
              showNotice("No encontramos esta competencia en la lista actual. Actualizá los torneos e intentá nuevamente.");
              return;
            }
            openTournament(tournament);
          }}
        />
      ) : activeView === "home" ? (
        <div className="tc-home-screen">
        <div
          className="cr-card tc-home-panel"
          style={{
            width: "100%",
            maxWidth: "980px",
            margin: "auto",
          }}
        >
          <div className="tc-home-panel-art" aria-label="FEFUTIN — Fútbol formativo">
            <img src="/WhatsApp%20Image%202026-10-31%20at%2010.45.37.jpeg" alt="Escudo Liga FEFUTIN" />
            <div>
              <span>FEFUTIN</span>
              <strong>FÚTBOL FORMATIVO</strong>
            </div>
          </div>
          <div className="tc-home-divisions" aria-label="Divisiones de la liga">
            {renderDivisionCard("Infantil", "/WhatsApp%20Image%202026-10-31%20at%2010.45.23.jpeg", "INFANTIL")}
            {renderDivisionCard("Femenino", "/WhatsApp%20Image%202026-10-30%20at%2021.11.20.jpeg", "FEMENINO")}
            {renderDivisionCard("Mayores", "/WhatsApp%20Image%202026-10-30%20at%2020.59.32.jpeg", "MAYORES")}
          </div>
          {isPublicVisitor && <FefutinVisitorPromoCarousel />}
          {isReferente && (
            <section aria-label="Próximo encuentro de mi club" style={{ margin: "1rem 0", padding: "1rem", border: "2px solid #b5122a", borderRadius: "14px", background: "linear-gradient(135deg, #171c27, #090a0e)", color: "#fff", overflow: "hidden" }}>
              <div style={{ color: "#f3a0ad", fontSize: ".72rem", fontWeight: 900, letterSpacing: ".12em", textAlign: "center", marginBottom: ".8rem" }}>PRÓXIMO ENCUENTRO</div>
              {referenteNextMatch ? (() => {
                const { match, participation, tournament, round, matchDate } = referenteNextMatch;
                const homeIsMine = String(match.team1).trim().toLocaleLowerCase("es") === String(participation.club_name).trim().toLocaleLowerCase("es");
                const homeName = match.team1;
                const awayName = match.team2;
                const homeClub = referenteMatchClubs.find((club) => String(club.club_name).trim().toLocaleLowerCase("es") === String(homeName).trim().toLocaleLowerCase("es"));
                const awayClub = referenteMatchClubs.find((club) => String(club.club_name).trim().toLocaleLowerCase("es") === String(awayName).trim().toLocaleLowerCase("es"));
                const homeLogo = homeClub?.logo_path ? supabase.storage.from("fefutin-clubs").getPublicUrl(homeClub.logo_path).data.publicUrl : homeIsMine && participation.logo_path ? supabase.storage.from("fefutin-clubs").getPublicUrl(participation.logo_path).data.publicUrl : "";
                const awayLogo = awayClub?.logo_path ? supabase.storage.from("fefutin-clubs").getPublicUrl(awayClub.logo_path).data.publicUrl : !homeIsMine && participation.logo_path ? supabase.storage.from("fefutin-clubs").getPublicUrl(participation.logo_path).data.publicUrl : "";
                const formattedDate = new Date(matchDate + "T12:00:00").toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
                return <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: ".6rem" }}>
                    {[{ name: homeName, logo: homeLogo }, { name: awayName, logo: awayLogo }].map((club, index) => (
                      <div key={club.name} style={{ minWidth: 0, textAlign: "center", animation: "fefutinNextShield 2.8s ease-in-out infinite", animationDelay: index ? ".25s" : "0s" }}>
                        <div style={{ height: "76px", display: "grid", placeItems: "center", marginBottom: ".35rem" }}>
                          {club.logo ? <img src={club.logo} alt={`Escudo de ${club.name}`} style={{ maxWidth: "72px", maxHeight: "72px", objectFit: "contain", filter: "drop-shadow(0 4px 8px rgba(0,0,0,.4))" }} /> : <span style={{ fontSize: "2.5rem" }}>⚽</span>}
                        </div>
                        <strong style={{ display: "block", fontSize: ".82rem", lineHeight: 1.25, overflowWrap: "anywhere" }}>{club.name}</strong>
                      </div>
                    ))}
                    <strong style={{ color: "#f3a0ad", fontSize: "1.1rem", gridColumn: "2", gridRow: "1" }}>VS</strong>
                  </div>
                  <div style={{ textAlign: "center", marginTop: ".85rem", color: "#fff", fontSize: ".82rem", fontWeight: 800, textTransform: "capitalize" }}>{formattedDate}</div>
                  <div style={{ textAlign: "center", marginTop: ".25rem", color: "#f3a0ad", fontSize: ".76rem", fontWeight: 800 }}>{getTournamentCategory(tournament)} · FECHA {round}</div>
                  <style>{`@keyframes fefutinNextShield { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }`}</style>
                </>;
              })() : <p style={{ margin: 0, color: "#e5e7eb", fontSize: ".82rem", lineHeight: 1.5, textAlign: "center" }}>Todavía no hay un próximo encuentro programado para tu club. Cuando se cargue el fixture, aparecerá acá.</p>}
            </section>
          )}

          <button
            type="button"
            className="tc-home-about-card tc-home-about-card-shine"
            onClick={() => setShowWhoWeAre(true)}
          >
            <span className="tc-home-about-icon">⚽</span>
            <span className="tc-home-about-copy">
              <strong>QUIÉNES SOMOS</strong>
              <small>Conocé la liga y nuestros valores</small>
            </span>
            <span className="tc-home-about-arrow">→</span>
          </button>

          {isArbitro && assignedRefereeMatches.length > 0 && (
            <button
              type="button"
              onClick={() => setActiveView("referee-designations")}
              aria-label={`Ver mis designaciones: ${assignedRefereeMatches.length} partidos`}
              className="tc-home-designations-card"
              style={{ width: "100%", display: "flex", alignItems: "center", gap: ".8rem", margin: "1rem 0", padding: "1rem", background: "#fff", border: "2px solid #b5122a", borderRadius: "12px", color: "#171c27", textAlign: "left", cursor: "pointer", boxShadow: "0 3px 12px rgba(181,18,42,.12)" }}
            >
              <span aria-hidden="true" style={{ width: "12px", height: "12px", flex: "0 0 12px", borderRadius: "50%", background: "#dc2626", boxShadow: "0 0 0 4px rgba(220,38,38,.12)" }} />
              <span style={{ flex: 1 }}>
                <strong style={{ display: "block", color: "#171c27", fontSize: ".9rem", letterSpacing: ".07em" }}>DESIGNACIONES</strong>
                <small style={{ display: "block", color: "#444", marginTop: ".2rem" }}>{assignedRefereeMatches.length} partido(s) asignado(s) · Abrir planillas</small>
              </span>
              <span aria-hidden="true" style={{ color: "#b5122a", fontSize: "1.3rem", fontWeight: 900 }}>→</span>
            </button>
          )}

          {canManageAccess && (
            <section
              aria-label="Organización de jornadas"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: ".85rem",
                width: "100%",
                margin: "1rem 0"
              }}
            >
              <div style={{ minWidth: 0, padding: ".9rem", display: "flex", flexDirection: "column", gap: ".75rem", background: "#171c27", border: "1px solid #b5122a", borderRadius: "14px", color: "#fff" }}>
                <strong style={{ color: "#fff", fontSize: ".95rem", letterSpacing: ".08em", textAlign: "center" }}>PRE-JORNADA</strong>
                <button
                  type="button"
                  onClick={() => setActiveView("referee-pre-jornada")}
                  style={{ minWidth: 0, minHeight: "92px", padding: ".8rem .55rem", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: ".45rem", background: "#fff", border: "1px solid #b5122a", borderRadius: "10px", color: "#171c27", textAlign: "center", cursor: "pointer" }}
                >
                  <span aria-hidden="true" style={{ width: "58px", height: "58px", minWidth: "58px", display: "flex", alignItems: "center", justifyContent: "center", background: "#b5122a", border: "2px solid #171c27", borderRadius: "15px", boxShadow: "0 4px 10px rgba(181,18,42,.28)" }}>
                    <svg aria-hidden="true" viewBox="0 0 48 48" width="44" height="44" style={{ display: "block", width: "44px", height: "44px", maxWidth: "none" }} xmlns="http://www.w3.org/2000/svg">
                      <rect x="7" y="10" width="34" height="31" rx="4" fill="none" stroke="#ffffff" strokeWidth="3.2" />
                      <path d="M15 6v8M33 6v8M7 19h34" fill="none" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" />
                      <circle cx="19" cy="27" r="4" fill="none" stroke="#ffffff" strokeWidth="3" />
                      <path d="M12.5 37c.8-4 3.1-6 6.5-6 2 0 3.5.7 4.6 2M29 27h7M29 33h7" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  </span>
                  <strong style={{ fontSize: ".78rem", lineHeight: 1.25 }}>DESIGNACIÓN DE ÁRBITROS</strong>
                  <small style={{ color: "#4b5563", fontSize: ".7rem", lineHeight: 1.3 }}>Gestioná árbitros y asignaciones</small>
                </button>
              </div>
              <div style={{ minWidth: 0, padding: ".9rem", display: "flex", flexDirection: "column", gap: ".75rem", background: "#171c27", border: "1px solid #b5122a", borderRadius: "14px", color: "#fff" }}>
                <strong style={{ color: "#fff", fontSize: ".95rem", letterSpacing: ".08em", textAlign: "center" }}>POST-JORNADA</strong>
                <button
                  type="button"
                  onClick={() => setActiveView("sheet-archive")}
                  style={{ minWidth: 0, minHeight: "92px", padding: ".8rem .55rem", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: ".45rem", background: "#fff", border: "1px solid #b5122a", borderRadius: "10px", color: "#171c27", textAlign: "center", cursor: "pointer" }}
                >
                  <span aria-hidden="true" style={{ width: "58px", height: "58px", minWidth: "58px", display: "flex", alignItems: "center", justifyContent: "center", background: "#b5122a", border: "2px solid #171c27", borderRadius: "15px", boxShadow: "0 4px 10px rgba(181,18,42,.28)" }}>
                    <svg aria-hidden="true" viewBox="0 0 48 48" width="44" height="44" style={{ display: "block", width: "44px", height: "44px", maxWidth: "none" }} xmlns="http://www.w3.org/2000/svg">
                      <path d="M13 8h17l7 7v25H13a3 3 0 0 1-3-3V11a3 3 0 0 1 3-3Z" fill="none" stroke="#ffffff" strokeWidth="3.2" strokeLinejoin="round" />
                      <path d="M30 8v8h7M17 23h16M17 29h16M17 35h10" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
                      <path d="M6 15v25a3 3 0 0 0 3 3h23" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  </span>
                  <strong style={{ fontSize: ".78rem", lineHeight: 1.25 }}>ARCHIVO DE PLANILLAS</strong>
                  <small style={{ color: "#4b5563", fontSize: ".7rem", lineHeight: 1.3 }}>Planillas digitales y fotos firmadas</small>
                </button>
              </div>
            </section>
          )}

          {(canAccessClubManagement || (isReferente && currentUser?.clubId)) && (
            <section aria-label="Gestión de clubes" style={{ margin: "1.25rem 0", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: ".85rem" }}>
              {isReferente && currentUser?.clubId && currentUser?.approvalStatus === "aprobado" ? (
                <button type="button" onClick={() => setActiveView("referente-solicitar-torneo")} style={{ minHeight: "132px", padding: "1.1rem", display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: ".45rem", textAlign: "left", background: "#171c27", border: "1px solid #b5122a", borderRadius: "12px", color: "#fff", cursor: "pointer" }}>
                  <span style={{ fontSize: "1.6rem" }}>🏆</span>
                  <strong style={{ fontSize: ".9rem", letterSpacing: ".04em" }}>NUEVA PARTICIPACIÓN</strong>
                  <span style={{ color: "#d1d5db", fontSize: ".8rem", lineHeight: 1.4 }}>Solicitá que tu club participe en otros torneos. La habilitación requiere aprobación.</span>
                </button>
              ) : isReferente && currentUser?.clubId ? (
                <div role="status" style={{ minHeight: "132px", padding: "1.1rem", display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: ".45rem", textAlign: "left", background: "#171c27", border: "1px solid #b5122a", borderRadius: "12px", color: "#fff" }}>
                  <span style={{ fontSize: "1.6rem" }}>⌛</span>
                  <strong style={{ fontSize: ".9rem", letterSpacing: ".04em" }}>CLUB REGISTRADO</strong>
                  <span style={{ color: "#facc15", fontSize: ".88rem", fontWeight: 800 }}>PENDIENTE DE APROBACIÓN</span>
                  <span style={{ color: "#d1d5db", fontSize: ".8rem", lineHeight: 1.4 }}>La habilitación institucional todavía está pendiente.</span>
                </div>
              ) : canAccessClubManagement ? (
                <button type="button" onClick={() => setActiveView("referente-inscripcion")} style={{ minHeight: "132px", padding: "1.1rem", display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: ".45rem", textAlign: "left", background: "#171c27", border: "1px solid #b5122a", borderRadius: "12px", color: "#fff", cursor: "pointer" }}>
                  <span style={{ fontSize: "1.6rem" }}>📝</span>
                  <strong style={{ fontSize: ".9rem", letterSpacing: ".04em" }}>INSCRIPCIÓN</strong>
                  <span style={{ color: "#d1d5db", fontSize: ".8rem", lineHeight: 1.4 }}>Inscribí tu club en las competencias</span>
                </button>
              ) : null}
              {canAccessClubManagement && (
                <>
                  <button type="button" onClick={() => setActiveView("referente-equipos")} style={{ minHeight: "132px", padding: "1.1rem", display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: ".45rem", textAlign: "left", background: "#171c27", border: "1px solid #b5122a", borderRadius: "12px", color: "#fff", cursor: "pointer" }}>
                    <span style={{ fontSize: "1.6rem" }}>⚽</span>
                    <strong style={{ fontSize: ".9rem", letterSpacing: ".04em" }}>{isReferente ? "MI CLUB" : "FICHA DE EQUIPOS"}</strong>
                    <span style={{ color: "#d1d5db", fontSize: ".8rem", lineHeight: 1.4 }}>{isReferente ? "Datos institucionales y carnets de jugadores" : "Club, equipos y jugadores"}</span>
                  </button>
                  <button type="button" onClick={() => setActiveView("referente-torneos")} style={{ minHeight: "132px", padding: "1.1rem", display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: ".45rem", textAlign: "left", background: "#171c27", border: "1px solid #b5122a", borderRadius: "12px", color: "#fff", cursor: "pointer" }}>
                    <span style={{ fontSize: "1.6rem" }}>🏆</span>
                    <strong style={{ fontSize: ".9rem", letterSpacing: ".04em" }}>MIS TORNEOS</strong>
                    <span style={{ color: "#d1d5db", fontSize: ".8rem", lineHeight: 1.4 }}>Acceso directo a las competencias de tu club</span>
                  </button>
                </>
              )}
            </section>
          )}

          {canManageAccess && (() => {
            const totalPendingGeneral = pendingAccessRequests.length + pendingPlayerApprovalsCount + pendingClubTournamentRequestsCount;
            const hasPendingGeneral = !loadingAccessRequests && totalPendingGeneral > 0;
            return (
              <>
                <style>{`
                  @keyframes fefutinGeneralPendingPulse {
                    0%, 100% { box-shadow: 0 0 0 1px rgba(181,18,42,.25), 0 0 8px rgba(181,18,42,.18); border-color: #b5122a; }
                    50% { box-shadow: 0 0 0 2px rgba(255,255,255,.5), 0 0 19px rgba(181,18,42,.85); border-color: #fff; }
                  }
                  @media (prefers-reduced-motion: reduce) {
                    .tc-home-general-approvals-pending { animation: none !important; }
                  }
                `}</style>
                <button
                  type="button"
                  className={"tc-home-about-card tc-home-referee-card" + (hasPendingGeneral ? " tc-home-general-approvals-pending" : "")}
                  onClick={() => { setAccessActionError(""); setActiveView("access-requests"); }}
                  aria-label={"Abrir altas generales" + (hasPendingGeneral ? ", " + totalPendingGeneral + " solicitudes pendientes" : "")}
                  aria-live="polite"
                  style={{ position: "relative", animation: hasPendingGeneral ? "fefutinGeneralPendingPulse 1.7s ease-in-out infinite" : "none" }}
                >
                  <span className="tc-home-about-icon tc-home-referee-icon" aria-hidden="true">⚽</span>
                  <span className="tc-home-about-copy">
                    <strong>ALTAS GENERALES</strong>
                    <small>{hasPendingGeneral ? totalPendingGeneral + " solicitud" + (totalPendingGeneral === 1 ? "" : "es") + " pendiente" + (totalPendingGeneral === 1 ? "" : "s") + " · Revisá y gestioná las altas" : "Gestioná solicitudes, jugadores, clubes y árbitros"}</small>
                  </span>
                  {hasPendingGeneral && (
                    <span style={{ position: "absolute", top: "-9px", right: "-8px", minWidth: "25px", height: "25px", padding: "0 .35rem", display: "grid", placeItems: "center", boxSizing: "border-box", borderRadius: "999px", border: "2px solid #fff", background: "#b5122a", color: "#fff", fontSize: ".72rem", fontWeight: 900, boxShadow: "0 0 12px rgba(255,255,255,.45)" }}>
                      {totalPendingGeneral}
                    </span>
                  )}
                  <span className="tc-home-about-arrow">→</span>
                </button>
              </>
            );
          })()}

          {isArbitro && (
            <button
              type="button"
              className="tc-home-about-card tc-home-referee-card"
              onClick={() => setActiveView("referee-stats")}
            >
              <span className="tc-home-about-icon tc-home-referee-icon" aria-hidden="true">
                <svg viewBox="0 0 48 48" width="27" height="27" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="19" cy="12" r="6" stroke="currentColor" strokeWidth="2.8" />
                  <path d="M8.5 36.5v-4.2c0-6.2 4.7-10.8 10.5-10.8 3.1 0 5.8 1.2 7.7 3.3" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
                  <path d="M29 25.5 39.5 29l-3.2 9.2-10.5-3.6L29 25.5Z" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" />
                  <path d="m31.5 29.5 4.2 1.4M29.8 33.3l4.2 1.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M25.5 25.8 28 22l5.2 1.7-1.4 4.1" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="tc-home-about-copy">
                <strong>ÁRBITROS</strong>
                <small>Consultá y compará las estadísticas arbitrales</small>
              </span>
              <span className="tc-home-about-arrow">→</span>
            </button>
          )}

          {showWhoWeAre && (
            <div className="tc-about-overlay" onClick={() => setShowWhoWeAre(false)}>
              <section
                className="tc-about-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="tc-about-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="tc-about-accent" />
                <button
                  type="button"
                  className="tc-about-close"
                  aria-label="Cerrar"
                  onClick={() => setShowWhoWeAre(false)}
                >×</button>
                <span className="tc-about-eyebrow">FEFUTIN · FÚTBOL FORMATIVO</span>
                <h2 id="tc-about-title">¿QUIÉNES SOMOS?</h2>
                <p>
                  FEFUTIN es una comunidad deportiva que encuentra en el fútbol mucho más
                  que una competencia: un lugar para aprender, compartir, superarse y
                  construir vínculos. A través de sus torneos, busca que chicos, chicas,
                  jóvenes y adultos puedan disfrutar del deporte y sentirse parte de un
                  espacio de encuentro.
                </p>
                <p>
                  Las publicaciones institucionales históricas de FEFUTIN ya reflejaban
                  su vínculo con la organización y difusión de torneos de fútbol infantil
                  y femenino. Esta plataforma reúne hoy la información de las divisiones
                  Infantil, Femenino y Mayores, para acercar sus competencias a jugadores,
                  familias, equipos y acompañantes.
                </p>
                <h3>NUESTRAS DIVISIONES</h3>
                <div className="tc-about-divisions">
                  <div><strong>INFANTIL</strong><span>Formación, aprendizaje y diversión. Crecer jugando y compartiendo en equipo.</span></div>
                  <div><strong>FEMENINO</strong><span>Un espacio para competir, desarrollar el talento y fortalecer la participación.</span></div>
                  <div><strong>MAYORES</strong><span>La pasión por el fútbol continúa: encuentro, competencia y compañerismo.</span></div>
                </div>
                <h3>NUESTROS VALORES</h3>
                <div className="tc-about-values">
                  <div><strong>RESPETO</strong><span>Por compañeros, rivales, familias y árbitros.</span></div>
                  <div><strong>INCLUSIÓN</strong><span>Un lugar donde todos y todas puedan participar.</span></div>
                  <div><strong>FORMACIÓN</strong><span>Aprender, crecer y mejorar dentro y fuera de la cancha.</span></div>
                  <div><strong>COMPAÑERISMO</strong><span>Construir equipo desde la solidaridad y el juego limpio.</span></div>
                </div>
                <div className="tc-about-footer">UNIDOS POR EL DEPORTE · CRECIENDO EN EQUIPO</div>
              </section>
            </div>
          )}
          {(isAdmin || isDirectivo || isArbitro || isReferente) && <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "1.5rem",
              paddingBottom: "1rem",
              borderBottom: "1px solid #2d2b3b",
            }}
            className="tc-admin-profile-row"
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
              }}
            >
              <div className="tc-admin-crown">
                <TCIcon name={isAdmin ? "crown" : "user"} size={22} />
              </div>

              <div>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: "bold",
                    color: "#9ca3af",
                    textTransform: "uppercase",
                    display: "block",
                  }}
                  className="tc-admin-label"
                >
                  {isAdmin ? "Administrador" : isDirectivo ? "Directivo" : isArbitro ? "Árbitro" : "Referente"}
                </span>

                <h2
                  style={{
                    fontSize: "1.1rem",
                    fontWeight: 900,
                    color: "#ffd700",
                    margin: 0,
                  }}
                  className="tc-admin-username"
                >
                  {currentUser.username}
                </h2>
              </div>
            </div>

            <button
              className="tc-home-logout"
              onClick={handleLogout}
              style={{
                padding: "0.35rem 0.75rem",
                backgroundColor: "rgba(127, 29, 29, 0.4)",
                border: "1px solid rgba(239, 68, 68, 0.5)",
                color: "#f87171",
                fontWeight: "bold",
                borderRadius: "6px",
                fontSize: "0.75rem",
                cursor: "pointer",
              }}
            >
              Cerrar Sesión
            </button>
          </div>}

          {/* BOTÓN ADMIN */}

          {isAdmin && (
            <button
              className="tc-home-admin-action"
              onClick={() => setActiveView("stats")}
              style={{
                width: "100%",
                marginBottom: "1rem",
                padding: "0.75rem",
                background: "linear-gradient(to right, #111827, #1e3a5f)",
                border: "1px solid #60a5fa",
                color: "#fff",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: "bold",
              }}
            >
              <TCIcon name="chart" size={17} /> Ver estadísticas
            </button>
          )}

          {canManageTournaments && <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr)",
              gap: "0.75rem",
              marginBottom: "1.5rem",
            }}
            className="tc-home-actions"
          >
            <button
              className="tc-home-action tc-home-action-create"
              onClick={() => setActiveView("create")}
              style={{
                padding: "1rem",
                background: "linear-gradient(to bottom, #1b5fa8, #0f3768)",
                border: "2px solid rgba(96, 165, 250, 0.5)",
                borderRadius: "10px",
                textAlign: "left",
                cursor: "pointer",
                color: "#fff",
              }}
            >
              <div className="tc-home-action-icon">
                <TCIcon name="trophy" size={25} />
              </div>

              <h3
                style={{
                  fontWeight: 900,
                  fontSize: "0.85rem",
                  margin: "0 0 2px 0",
                }}
              >
                Armar Torneo
              </h3>

              <p
                style={{
                  fontSize: "10px",
                  color: "#bfdbfe",
                  margin: 0,
                }}
              >
                Sincronizado en la nube
              </p>
            </button>


          </div>}

          <div className="tc-home-tournaments" style={{ display: "none" }}>
            <div
              className="tc-home-tournaments-heading"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "0.75rem",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
              >
                <TCIcon name="bolt" size={17} />

                <h3
                  style={{
                    fontWeight: 900,
                    fontSize: "0.85rem",
                    textTransform: "uppercase",
                    color: "#e5e7eb",
                    margin: 0,
                  }}
                >
                  Torneos en la Nube
                </h3>
              </div>

              <button
                onClick={fetchTournaments}
                className="tc-home-refresh"
                title="Actualizar lista de torneos"
                aria-label="Actualizar lista de torneos"
              >
                <TCIcon name="refresh" size={14} />
              </button>
            </div>

            <div style={{ marginBottom: "0.75rem" }}>
              <label
                htmlFor="tournament-category-filter"
                style={{
                  display: "block",
                  marginBottom: "0.35rem",
                  color: "#d1d5db",
                  fontSize: "0.72rem",
                  fontWeight: 800,
                  textTransform: "uppercase",
                }}
              >
                {tournamentDivisionFilter === "Todas" ? "Buscar torneos por categoría" : `Torneos de ${tournamentDivisionFilter}`} · <button type="button" className="tc-home-filter-reset" onClick={() => { setTournamentDivisionFilter("Todas"); setTournamentCategoryFilter("Todas"); }}>Ver todas las divisiones</button>
              </label>
              <select
                id="tournament-category-filter"
                value={tournamentCategoryFilter}
                onChange={(e) => { setTournamentCategoryFilter(e.target.value); setTournamentDivisionFilter("Todas"); }}
                className="cr-input"
                style={{ width: "100%" }}
              >
                <option value="Todas">Todas las categorías</option>
                {tournamentCategories.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </div>

            {loading ? (
              <p
                style={{
                  textAlign: "center",
                  color: "#9ca3af",
                  fontSize: "0.85rem",
                }}
              >
                Cargando torneos...
              </p>
            ) : filteredTournaments.length === 0 ? (
              <p
                style={{
                  textAlign: "center",
                  color: "#9ca3af",
                  fontSize: "0.85rem",
                }}
              >
                No hay torneos activos creados aún.
              </p>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                  maxHeight: "240px",
                  overflowY: "auto",
                }}
              >
                {filteredTournaments.map((t) => (
                  <div
                    className="tc-home-tournament-item tc-home-tournament-card"
                    key={t.displayKey || t.id}
                    onClick={() => openTournament(t)}
                    style={{
                      position: "relative",
                      display: "grid",
                      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                      alignItems: "center",
                      gap: "8px",
                      padding: canDeleteTournaments ? "42px 10px 10px" : "10px",
                      backgroundColor: "#171c27",
                      border: "1px solid rgba(255,255,255,.28)",
                      borderLeft: "4px solid #b5122a",
                      borderRadius: "10px",
                      cursor: "pointer",
                    }}
                  >
                    {canDeleteTournaments && (
                      <button
                        type="button"
                        title="Eliminar torneo"
                        aria-label={`Eliminar torneo ${t.title}`}
                        disabled={deletingTournamentId === t.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteTournament(t);
                        }}
                        style={{
                          position: "absolute",
                          top: "7px",
                          right: "7px",
                          width: "30px",
                          height: "30px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: deletingTournamentId === t.id ? "#374151" : "rgba(127,29,29,.35)",
                          border: "1px solid rgba(239,68,68,.65)",
                          borderRadius: "7px",
                          color: "#f87171",
                          cursor: deletingTournamentId === t.id ? "not-allowed" : "pointer",
                          padding: 0,
                          zIndex: 2,
                        }}
                      >
                        {deletingTournamentId === t.id ? "…" : <TCIcon name="trash" size={17} />}
                      </button>
                    )}
                    <div style={{ minWidth: 0, boxSizing: "border-box", minHeight: "38px", display: "flex", alignItems: "center", justifyContent: "center", padding: "7px 2px", color: "#fff", textAlign: "center", fontSize: ".95rem", fontWeight: 900, lineHeight: 1.25, overflowWrap: "anywhere", letterSpacing: ".02em", textShadow: "0 1px 2px rgba(0,0,0,.65)" }}>
                      {t.title}
                    </div>
                    <div style={{ minWidth: 0, boxSizing: "border-box", minHeight: "38px", display: "flex", alignItems: "center", justifyContent: "center", padding: "7px 2px", color: "#fff", textAlign: "center", fontSize: ".95rem", fontWeight: 900, lineHeight: 1.25, overflowWrap: "anywhere", letterSpacing: ".02em", textShadow: "0 1px 2px rgba(0,0,0,.65)" }}>
                      {getTournamentCategory(t)}
                    </div>
                    <div style={{ minWidth: 0, boxSizing: "border-box", minHeight: "38px", display: "flex", alignItems: "center", justifyContent: "center", padding: "7px 2px", color: "#fff", textAlign: "center", fontSize: ".95rem", fontWeight: 900, lineHeight: 1.25, overflowWrap: "anywhere", letterSpacing: ".02em", textShadow: "0 1px 2px rgba(0,0,0,.65)" }}>
                      {getTournamentDivision(t)}
                    </div>

                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        </div>
      ) : activeView === "create" && canManageTournaments ? (
        <div className="tc-form-screen tc-create-screen">
        <div className="tc-create-artwork">
          <img src="/WhatsApp%20Image%202026-10-31%20at%2010.45.37.jpeg" alt="Identidad visual de la Liga FEFUTIN" />
          <div><strong>ORGANIZÁ TU TORNEO</strong><span>Elegí el deporte, definí la categoría y prepará la competencia.</span></div>
        </div>
        <CreateTournament
          onSave={handleCreateTournamentSubmit}
          onCancel={() => setActiveView("home")}
        />
        </div>
      ) : activeView === "edit" && canManageTournaments ? (
        <div className="tc-form-screen tc-edit-screen">
        <CreateTournament
          isEditing={true}
          initialData={activeTournament}
          onSave={handleEditTournamentSubmit}
          onCancel={() => {
            setEditingTournament(false);
            setActiveView("groups");
          }}
        />
        </div>
      ) : activeView === "join" && canManageTournaments ? (
        <div className="tc-form-screen tc-join-screen">
        <div className="tc-join-artwork">
          <img src="/tournament-join.svg" alt="Ilustración de una competencia deportiva" />
        </div>
        <div
          className="cr-card"
          style={{
            maxWidth: "420px",
            margin: "auto",
          }}
        >
          <div className="cr-card-glow"></div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "1.5rem",
            }}
          >
            <h2
              className="cr-title"
              style={{
                fontSize: "1.1rem",
              }}
            >
              <TCIcon name="key" /> Unirse a Torneo
            </h2>

            <button
              onClick={() => setActiveView("home")}
              style={{
                background: "transparent",
                border: "none",
                color: "#9ca3af",
                cursor: "pointer",
                fontWeight: "bold",
                fontSize: "0.85rem",
              }}
            >
              <span className="tc-close-symbol" aria-hidden="true">✕</span> Volver
            </button>
          </div>

          <form
            onSubmit={handleJoinTournamentSubmit}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
            }}
          >
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.75rem",
                  fontWeight: "bold",
                  textTransform: "uppercase",
                  color: "#d1d5db",
                  marginBottom: "4px",
                }}
              >
                Buscá tu torneo por código de invitación
              </label>

              <input
                type="text"
                placeholder="Ej.: TS-4829"
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value)}
                required
                className="cr-input"
                style={{
                  textAlign: "center",
                  fontSize: "1.1rem",
                  letterSpacing: "2px",
                  fontWeight: 900,
                }}
              />
            </div>

            <button
              type="submit"
              className="cr-btn-gold"
              style={{
                marginTop: "0.5rem",
              }}
            >
              <TCIcon name="search" /> Buscar torneo
            </button>
          </form>
        </div>
        </div>
      ) : activeView === "top-scorers" && activeTournament ? (
        <FefutinTopScorers
          tournament={activeTournament}
          onBack={() => setActiveView(topScorersReturnView)}
        />
      ) : activeView === "groups" ? (
        <div
          className="tc-competition-screen tc-groups-screen"
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "1rem",
          }}
        >
          {String(activeTournament?.status || "").trim().toLocaleLowerCase("es") === "inscripciones" ? (
            <div className="cr-card" style={{ width: "100%", maxWidth: "900px", boxSizing: "border-box", background: "#080808", backgroundColor: "#080808", color: "#fff", border: "1px solid #b5122a" }}>
              <div className="cr-card-glow"></div>
              {(() => {
                const registration = (activeTournament.groups || []).find((group) => group?.name === "__INSCRIPCIONES__");
                const participants = [...new Set(
                  (fefutinTournamentClubs || [])
                    .map((club) => String(club.club_name || "").trim())
                    .filter(Boolean)
                )];
                const canManage = canManageTournaments;
                return (
                  <>
                    <h2 className="cr-title" style={{ marginBottom: "0.5rem" }}>📝 Inscripciones abiertas</h2>
                    <p style={{ color: "#9ca3af", marginTop: 0 }}>{activeTournament.title} · Estado: esperando inscripciones</p>
                    {Array.isArray(registration?.category_config) && registration.category_config.length > 0 && (
                      <div style={{ display: "grid", gap: "0.5rem", marginBottom: "1rem" }}>
                        {registration.category_config.map((branch) => (
                          <div key={branch.division} style={{ padding: "0.65rem", borderRadius: "8px", background: "#121019", border: "1px solid #2d2b3b" }}>
                            <strong style={{ color: "#fff" }}>{branch.division}</strong>
                            <p style={{ color: "#d1d5db", fontSize: "0.82rem", margin: "0.35rem 0 0" }}>{(branch.categories || []).join(" · ")}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <section style={{ marginBottom: "1rem", padding: "0.85rem", borderRadius: "10px", background: "#10090b", border: "1px solid #b5122a" }}>
                      <h3 style={{ color: "#fff", fontSize: "0.95rem", margin: "0 0 0.65rem" }}>🏟️ CLUBES INSCRIPTOS · FEFUTIN</h3>
                      {loadingFefutinTournamentClubs ? (
                        <p style={{ color: "#d1d5db", margin: 0 }}>Cargando clubes inscriptos...</p>
                      ) : fefutinTournamentClubs.length > 0 ? (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "0.6rem" }}>
                          {fefutinTournamentClubs.map((club) => (
                            <div key={club.club_tournament_id} style={{ display: "flex", alignItems: "center", gap: "0.7rem", padding: "0.7rem", borderRadius: "8px", background: "#121019", border: "1px solid #4b2029", color: "#fff" }}>
                              {club.logo_path ? (
                                <img src={supabase.storage.from("fefutin-clubs").getPublicUrl(club.logo_path).data.publicUrl} alt="" style={{ width: "42px", height: "42px", objectFit: "contain", borderRadius: "6px", background: "#fff", flexShrink: 0 }} />
                              ) : (
                                <div style={{ width: "42px", height: "42px", display: "grid", placeItems: "center", borderRadius: "6px", background: "#2a1117", color: "#fff", fontSize: "1.2rem", flexShrink: 0 }}>⚽</div>
                              )}
                              <div style={{ minWidth: 0 }}>
                                <strong style={{ display: "block", color: "#fff", overflowWrap: "anywhere" }}>{club.club_name}</strong>
                                <span style={{ display: "block", color: "#f1b5c0", fontSize: "0.78rem", marginTop: "0.2rem" }}>{club.category_label || "Categoría sin especificar"}</span>
                                <span style={{ display: "block", color: "#9ca3af", fontSize: "0.72rem", marginTop: "0.2rem" }}>
                                  {club.team_status === "presentada" ? `Lista de buena fe presentada · ${club.player_count || 0} jugadores` : club.team_status === "borrador" ? "Lista de buena fe en preparación" : "Equipo todavía sin ficha"}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p style={{ color: "#9ca3af", margin: 0 }}>Todavía no hay clubes habilitados inscriptos en este torneo.</p>
                      )}
                    </section>
                    {participants.length ? (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.5rem", marginBottom: "1rem" }}>
                        {participants.map((name, index) => (
                          <div key={name} style={{ padding: "0.65rem", borderRadius: "8px", background: "#121019", border: "1px solid #2d2b3b", color: "#fff" }}>
                            <span style={{ color: "#ffd700", marginRight: "0.4rem" }}>#{index + 1}</span>{name}
                          </div>
                        ))}
                      </div>
                    ) : <p style={{ color: "#9ca3af" }}>Todavía no hay clubes inscriptos.</p>}
                    <p style={{ color: "#9ca3af", fontSize: "0.8rem" }}>El creador dará comienzo al torneo cuando esté listo. Al iniciar, se cerrarán las inscripciones y se sortearán los grupos y partidos.</p>
                    {canManage && (
                      <>
                        <button type="button" className="cr-btn-gold" onClick={handleStartRegistrationTournament} disabled={loadingFefutinTournamentClubs || fefutinTournamentClubs.length < 2} style={{ width: "100%", marginTop: "0.5rem", opacity: loadingFefutinTournamentClubs || fefutinTournamentClubs.length < 2 ? 0.55 : 1, cursor: loadingFefutinTournamentClubs || fefutinTournamentClubs.length < 2 ? "not-allowed" : "pointer" }}>
                          <TCIcon name="flag" /> {loadingFefutinTournamentClubs ? "Cargando clubes..." : fefutinTournamentClubs.length < 2 ? "Esperando 2 clubes aprobados" : "Cerrar inscripción e iniciar torneo"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingTournament(true);
                            setActiveView("edit");
                          }}
                          style={{
                            display: "block",
                            width: "auto",
                            margin: "1rem 0 0 auto",
                            padding: "0.25rem 0",
                            background: "transparent",
                            border: "none",
                            boxShadow: "none",
                            color: "#fff",
                            fontSize: "0.85rem",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          ← Volver a configuración
                        </button>
                      </>
                    )}
                  </>
                );
              })()}
            </div>
          ) : (
            <GroupStageView
              tournament={activeTournament}
              onUpdateTournament={handleUpdateTournamentInSupabase}
              onProceedToPlayoffs={handleProceedToPlayoffs}
              onOpenTopScorers={() => {
                setTopScorersReturnView("groups");
                setActiveView("top-scorers");
              }}
              currentUser={currentUser}
              isAdmin={canManageTournaments}
              isReferee={isArbitro}
              isReferente={isReferente}
              onCloseMatch={handleCloseMatch}
              openAssignedMatch={refereeMatchToOpen}
              onAssignedMatchOpened={() => setRefereeMatchToOpen(null)}
              clubLogos={fefutinTournamentClubs.map((club) => ({
                name: club.club_name,
                url: club.logo_path ? supabase.storage.from("fefutin-clubs").getPublicUrl(club.logo_path).data.publicUrl : "",
              }))}
            />
          )}

          {(isTournamentAdmin || isAdmin) && activeTournament.status !== "Finalizado" && String(activeTournament.status || "").trim().toLocaleLowerCase("es") !== "inscripciones" && (
            <div
              style={{
                width: "100%",
                maxWidth: "900px",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: "0.5rem",
                flexWrap: "wrap",
                marginTop: "0.25rem",
              }}
            >
              {isTournamentAdmin && (
                <button
                  onClick={() => {
                    if (tournamentHasResults(activeTournament)) {
                      showNotice(
                        "🔒 Este torneo ya tiene resultados cargados. No se puede modificar su organización."
                      );
                      return;
                    }

                    setEditingTournament(true);
                    setActiveView("edit");
                  }}
                  className="cr-btn-gold"
                  style={adminTournamentButtonStyle}
                >
                  <TCIcon name="settings" /> Modificar torneo
                </button>
              )}
              {(isTournamentAdmin || isAdmin) &&
                String(activeTournament.status || "").trim().toLocaleLowerCase("es") !== "finalizado" &&
                String(activeTournament.format || "").trim().toLocaleLowerCase("es") === "league" && (
                  <button
                    type="button"
                    onClick={handleFinishTournament}
                    className="cr-btn-gold"
                    style={adminTournamentButtonStyle}
                  >
                    <TCIcon name="flag" /> Finalizar torneo
                  </button>
                )}
            </div>
          )}
        </div>
      ) : (
        <div
          className="tc-competition-screen tc-playoffs-screen"
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "1rem",
          }}
        >
          <div style={{ width: "100%", maxWidth: "900px", display: "flex", justifyContent: "flex-end", margin: "0 auto 0.25rem" }}>
            <button
              type="button"
              onClick={() => {
                setTopScorersReturnView("playoffs");
                setActiveView("top-scorers");
              }}
              style={{ padding: "0.65rem 1rem", background: "#171c27", border: "1px solid #b5122a", borderRadius: "8px", color: "#fff", fontWeight: 800, cursor: "pointer" }}
            >
              ⚽ Goleadores
            </button>
          </div>
          <PlayoffBracket
            tournament={activeTournament}
            onUpdateTournament={handleUpdateTournamentInSupabase}
            onFinishTournament={handleFinishTournament}
            isAdmin={canManageTournaments}
            isReferee={isArbitro}
              isReferente={isReferente}
            currentUser={currentUser}
            onCloseMatch={handleCloseMatch}
            clubLogos={fefutinTournamentClubs.map((club) => ({
              name: club.club_name,
              url: club.logo_path ? supabase.storage.from("fefutin-clubs").getPublicUrl(club.logo_path).data.publicUrl : "",
            }))}
          />

          {(isTournamentAdmin || isAdmin) && activeTournament.status !== "Finalizado" && (
            <div
              style={{
                width: "100%",
                maxWidth: "600px",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: "0.5rem",
                flexWrap: "wrap",
                marginTop: "0.25rem",
              }}
            >
              {isTournamentAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    if (tournamentHasResults(activeTournament)) {
                      showNotice(
                        "🔒 Este torneo ya tiene resultados cargados. No se puede modificar su organización."
                      );
                      return;
                    }

                    setEditingTournament(true);
                    setActiveView("edit");
                  }}
                  className="cr-btn-gold"
                  style={adminTournamentButtonStyle}
                >
                  <TCIcon name="settings" /> Modificar torneo
                </button>
              )}
              {(isTournamentAdmin || isAdmin) && (
                <button
                  type="button"
                  onClick={handleFinishTournament}
                  className="cr-btn-gold"
                  style={adminTournamentButtonStyle}
                >
                  <TCIcon name="flag" /> Finalizar torneo
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {(activeView === "groups" || activeView === "playoffs") && (
        <div style={{ width: "100%", maxWidth: "900px", display: "flex", justifyContent: "flex-end", margin: "0.75rem auto 1.25rem", padding: "0 0.25rem", boxSizing: "border-box" }}>
          <button
            type="button"
            className="tc-form-back"
            onClick={() => {
              setActiveTournament(null);
              setActiveView("home");
            }}
          >
            ← Volver a torneos
          </button>
        </div>
      )}
    </div>
  );
}

export default TournamenSportApp;
