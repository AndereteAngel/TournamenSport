import { useEffect, useState } from "react";
import { TCIcon } from "./TCIcon";
import { supabase } from "../supabaseClient";
import { TournamentNotice, useTournamentNotice } from "./TournamentNotice";

const TOURNAMENT_BRANCHES = ["Infantil", "Femenino", "Mayores"];
const CATEGORY_OPTIONS = {
  "Año de nacimiento": Array.from({ length: 17 }, (_, index) => String(2008 + index)),
  División: ["Primera", "Reserva", "Tercera", "Cuarta", "Quinta", "Sexta"],
  Formativa: ["Premini", "Mini", "Infantiles", "Menores", "Cadetes", "Juveniles", "Sub-14", "Sub-16", "Sub-18", "Sub-21"],
  Personalizada: [],
};

export function CreateTournament({
  onSave,
  onCancel,
  isEditing = false,
  initialData = null,
}) {
  // =========================================================
  // OBTENER PARTICIPANTES ACTUALES
  // =========================================================

  const getParticipantsFromTournament = () => {
    if (!initialData?.groups) return [];

    const participants = [];

    initialData.groups.forEach((group) => {
      (group.teams || []).forEach((team) => {
        if (!participants.includes(team)) {
          participants.push(team);
        }
      });
    });

    return participants;
  };

  // =========================================================
  // DATOS INICIALES
  // =========================================================

  const getInitialFormData = () => {
    if (!isEditing || !initialData) {
      return {
        title: "",
        game: "Fútbol",
        division: "Infantil",
        categoryType: "Año de nacimiento",
        categoryDetail: "2008",
        categoryConfig: [],
        format: "groups_playoff",
        numGroups: 2,
        qualifiersPerGroup: 2,
        isPublic: true,
        participantsInput: "",
        maxParticipants: 16,
      };
    }

    const participants = getParticipantsFromTournament();
    const registrationGroup = initialData.groups?.find((group) => group?.name === "__INSCRIPCIONES__");
    const savedCategoryConfig = Array.isArray(registrationGroup?.category_config)
      ? registrationGroup.category_config
      : [];
    const sports = ["Fútbol", "Futsal", "Básquet", "Vóley", "Handball", "Hockey", "Rugby", "Tenis", "Atletismo", "Natación", "Otro deporte"];
    const storedGame = String(initialData.game || "Fútbol");
    const gameParts = storedGame.split(" · ").map((part) => part.trim());
    const divisionFromStoredGame = gameParts.find((part) => ["Infantil", "Femenino", "Mayores"].includes(part)) || "Infantil";
    const categoryIndex = gameParts.length - 1;
    const detailFromStoredGame = categoryIndex > 0 ? gameParts[categoryIndex] : "";
    const gameFromStoredValue = gameParts[0] || "Fútbol";
    const categoryDetail = String(initialData.category_detail || detailFromStoredGame || "").trim();
    const knownDivisions = ["Primera", "Reserva", "Tercera", "Cuarta", "Quinta", "Sexta", "Otra división"];
    const knownFormative = ["Premini", "Mini", "Infantiles", "Menores", "Cadetes", "Juveniles", "Sub-14", "Sub-16", "Sub-18", "Sub-21", "Otra categoría"];
    const inferredCategoryType = /^\d{4}$/.test(categoryDetail)
      ? "Año de nacimiento"
      : knownDivisions.includes(categoryDetail)
        ? "División"
        : knownFormative.includes(categoryDetail)
          ? "Formativa"
          : "Personalizada";

    return {
      title: initialData.title || "",
      game: sports.includes(gameFromStoredValue) ? gameFromStoredValue : "Fútbol",
      division: divisionFromStoredGame,
      categoryType: initialData.category_type || inferredCategoryType,
      categoryDetail,
      categoryConfig: savedCategoryConfig.length
        ? savedCategoryConfig
        : [{ division: divisionFromStoredGame, categoryType: initialData.category_type || inferredCategoryType, categories: categoryDetail ? [categoryDetail] : [] }],
      format: initialData.format || "groups_playoff",
      numGroups:
        initialData.format === "league" ? 1 : initialData.groups?.length || 2,
      qualifiersPerGroup: initialData.qualifiers_per_group || 2,
      isPublic: initialData.is_public !== false,
      participantsInput: participants.join("\n"),
      maxParticipants: initialData.max_participants || initialData.groups?.find((group) => group?.name === "__INSCRIPCIONES__")?.capacity || 16,
    };
  };

  const [formData, setFormData] = useState(getInitialFormData());
  const { notice, showNotice, clearNotice } = useTournamentNotice();
  const [teamsCatalog, setTeamsCatalog] = useState([]);
  const [loadingTeamsCatalog, setLoadingTeamsCatalog] = useState(false);
  const [teamSearch, setTeamSearch] = useState("");
  const [selectedTeamIds, setSelectedTeamIds] = useState([]);
  const [teamCatalogError, setTeamCatalogError] = useState("");
  const [customCategoryInputs, setCustomCategoryInputs] = useState({});

  const updateBranchConfig = (division, changes) => {
    setFormData((prev) => {
      const current = prev.categoryConfig || [];
      const existing = current.find((item) => item.division === division);
      const updated = existing
        ? current.map((item) => item.division === division ? { ...item, ...changes } : item)
        : [...current, { division, categoryType: "Año de nacimiento", categories: [], ...changes }];
      return { ...prev, categoryConfig: updated };
    });
  };

  const toggleBranch = (division, checked) => {
    setFormData((prev) => ({
      ...prev,
      categoryConfig: checked
        ? [...(prev.categoryConfig || []), { division, categoryType: "Año de nacimiento", categories: [] }]
        : (prev.categoryConfig || []).filter((item) => item.division !== division),
    }));
  };

  const toggleCategory = (division, category, checked) => {
    const branch = (formData.categoryConfig || []).find((item) => item.division === division);
    const categories = branch?.categories || [];
    updateBranchConfig(division, {
      categories: checked
        ? [...new Set([...categories, category])]
        : categories.filter((item) => item !== category),
    });
  };

  const addCustomCategory = (division) => {
    const value = String(customCategoryInputs[division] || "").trim();
    if (!value) return;
    const branch = (formData.categoryConfig || []).find((item) => item.division === division);
    if ((branch?.categories || []).some((item) => item.toLocaleLowerCase("es") === value.toLocaleLowerCase("es"))) return;
    updateBranchConfig(division, { categories: [...(branch?.categories || []), value] });
    setCustomCategoryInputs((prev) => ({ ...prev, [division]: "" }));
  };

  const loadTeamsCatalog = async () => {
    setLoadingTeamsCatalog(true);
    setTeamCatalogError("");
    const [
      { data: catalogData, error: catalogError },
      { data: tournamentData, error: tournamentsError },
    ] = await Promise.all([
      supabase.from("teams_catalog").select("id, name").order("name", { ascending: true }),
      supabase.from("tournaments").select("groups"),
    ]);

    const historicalNames = (tournamentData || []).flatMap((tournament) =>
      (tournament.groups || []).flatMap((group) =>
        Array.isArray(group?.teams) ? group.teams : []
      )
    );

    const mergedTeams = new Map();
    (catalogData || []).forEach((team) => {
      const name = String(team.name || "").trim();
      if (name) mergedTeams.set(name.toLocaleLowerCase("es"), { ...team, name });
    });
    historicalNames.forEach((rawName) => {
      const name = String(rawName || "").trim();
      const key = name.toLocaleLowerCase("es");
      if (name && !mergedTeams.has(key)) {
        mergedTeams.set(key, { id: `historical-${key}`, name });
      }
    });

    if (catalogError) {
      console.error("Error al cargar catálogo de equipos:", catalogError);
    }
    if (tournamentsError) {
      console.error("Error al recuperar equipos de torneos anteriores:", tournamentsError);
    }

    setTeamsCatalog([...mergedTeams.values()].sort((a, b) => a.name.localeCompare(b.name, "es")));
    if (catalogError && tournamentsError) {
      setTeamCatalogError("Supabase no permitió leer el catálogo ni los torneos anteriores. Revisá las políticas SELECT de ambas tablas.");
    } else if (catalogError) {
      setTeamCatalogError("No se pudo leer el catálogo permanente; se muestran los equipos recuperados de torneos anteriores.");
    }
    setLoadingTeamsCatalog(false);
  };

  // =========================================================
  // ACTUALIZAR FORMULARIO AL ENTRAR EN EDICIÓN
  // =========================================================

  useEffect(() => {
    setFormData(getInitialFormData());
  }, [initialData, isEditing]);

  useEffect(() => {
    loadTeamsCatalog();
  }, []);

  // =========================================================
  // GUARDAR
  // =========================================================

  const handleSubmit = (e) => {
    e.preventDefault();

    const manualTeams = formData.participantsInput
      .split("\n")
      .map((name) => name.trim())
      .filter((name) => name.length > 0);

    const selectedTeams = teamsCatalog
      .filter((profile) => selectedTeamIds.includes(profile.id))
      .map((profile) => String(profile.name || "").trim())
      .filter(Boolean);

    const enteredTeams = [...new Map(
      [...selectedTeams, ...manualTeams].map((name) => [name.toLocaleLowerCase("es"), name])
    ).values()];

    // Al modificar un torneo, si no se editó la lista, conservar los equipos existentes.
    const existingTeams = isEditing ? getParticipantsFromTournament() : [];
    const teams = enteredTeams.length > 0 ? enteredTeams : existingTeams;

    if (isEditing && String(initialData?.status || "").trim().toLocaleLowerCase("es") !== "inscripciones") {
      const minimumParticipants = formData.format === "single_elimination" ? 2 : 4;
      if (teams.length < minimumParticipants) {
        showNotice(
          formData.format === "single_elimination"
            ? "Necesitas al menos 2 participantes para armar un Playoff."
            : "Necesitas al menos 4 participantes para armar el torneo."
        );
        return;
      }

      if (formData.format === "groups_playoff" && teams.length < formData.numGroups) {
        showNotice(`Para armar ${formData.numGroups} grupos necesitás al menos ${formData.numGroups} participantes.`);
        return;
      }
    } else {
      if (!Number.isInteger(Number(formData.maxParticipants)) || Number(formData.maxParticipants) < 4 || Number(formData.maxParticipants) > 256) {
        showNotice("El cupo máximo debe ser un número entre 4 y 256.");
        return;
      }
      if (teams.length > Number(formData.maxParticipants)) {
        showNotice(`Seleccionaste ${teams.length} equipos, pero el cupo máximo es ${formData.maxParticipants}.`);
        return;
      }
    }

    const validCategoryConfig = (formData.categoryConfig || []).filter(
      (branch) => Array.isArray(branch.categories) && branch.categories.length > 0
    );
    if (!validCategoryConfig.length) {
      showNotice("Seleccioná al menos una rama y una categoría habilitada para el torneo.");
      return;
    }

    onSave({
      ...formData,
      game: "Fútbol",
      category_config: validCategoryConfig,
      maxParticipants: Number(formData.maxParticipants),
      teams,
    });
  };

  return (
    <>
      <TournamentNotice notice={notice} onClose={clearNotice} />
      <div className="cr-card sports-card" style={{ maxWidth: "620px" }}>
      <div className="cr-card-glow"></div>

      {/* =====================================================
          CABECERA
          ===================================================== */}

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
            fontSize: "1.2rem",
            textAlign: "left",
          }}
        >
          {isEditing ? <><TCIcon name="settings" size={20} /> Modificar Torneo</> : <><TCIcon name="trophy" size={20} /> Crear torneo deportivo</>}
        </h2>


      </div>

      {/* =====================================================
          AVISO DE EDICIÓN
          ===================================================== */}

      {isEditing && (
        <div
          style={{
            marginBottom: "1rem",
            padding: "0.75rem",
            borderRadius: "8px",
            background: "rgba(27, 95, 168, 0.25)",
            border: "1px solid rgba(96, 165, 250, 0.4)",
            color: "#bfdbfe",
            fontSize: "0.75rem",
            lineHeight: "1.4",
          }}
        >
          <TCIcon name="info" size={15} /> Modificá solamente los datos que necesites. Los partidos y
          resultados existentes se conservarán siempre que no hagas un cambio
          estructural.
        </div>
      )}

      {/* =====================================================
          FORMULARIO
          ===================================================== */}

      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        }}
      >
        {/* ===================================================
            NOMBRE
            =================================================== */}

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
            Nombre del Torneo
          </label>

          <input
            type="text"
            placeholder="Ej.: Copa Primavera de Fútbol"
            value={formData.title}
            onChange={(e) =>
              setFormData({
                ...formData,
                title: e.target.value,
              })
            }
            required
            className="cr-input"
          />
        </div>

        {/* RAMAS Y CATEGORÍAS HABILITADAS */}
        <div style={{ padding: "0.9rem", border: "1px solid rgba(181,18,42,0.55)", borderRadius: "10px", background: "rgba(181,18,42,0.08)" }}>
          <label className="sports-label">Ramas y categorías del torneo</label>
          <p className="sports-help">Activá las ramas que tendrá el torneo y elegí las categorías en las que podrán inscribirse los clubes.</p>
          <div style={{ display: "grid", gap: "0.65rem", marginTop: "0.75rem" }}>
            {TOURNAMENT_BRANCHES.map((division) => {
              const branch = (formData.categoryConfig || []).find((item) => item.division === division);
              const selectedCategories = branch?.categories || [];
              const options = CATEGORY_OPTIONS[branch?.categoryType || "Año de nacimiento"] || [];
              return (
                <div key={division} style={{ padding: "0.75rem", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.16)", background: "rgba(0,0,0,0.2)" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.55rem", color: "#fff", fontWeight: 800, cursor: "pointer" }}>
                    <input type="checkbox" checked={Boolean(branch)} onChange={(e) => toggleBranch(division, e.target.checked)} />
                    {division}
                  </label>
                  {branch && (
                    <div style={{ marginTop: "0.75rem" }}>
                      <label className="sports-label">Tipo de categorías</label>
                      <select
                        value={branch.categoryType || "Año de nacimiento"}
                        onChange={(e) => updateBranchConfig(division, { categoryType: e.target.value, categories: [] })}
                        className="cr-input sports-input"
                      >
                        <option value="Año de nacimiento">Año de nacimiento</option>
                        <option value="División">División competitiva</option>
                        <option value="Formativa">Formativas</option>
                        <option value="Personalizada">Personalizadas</option>
                      </select>
                      {options.length > 0 && (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(105px, 1fr))", gap: "0.4rem", marginTop: "0.65rem" }}>
                          {options.map((category) => (
                            <label key={category} style={{ display: "flex", alignItems: "center", gap: "0.35rem", color: "#fff", fontSize: "0.8rem" }}>
                              <input type="checkbox" checked={selectedCategories.includes(category)} onChange={(e) => toggleCategory(division, category, e.target.checked)} />
                              {category}
                            </label>
                          ))}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: "0.45rem", marginTop: "0.7rem" }}>
                        <input
                          value={customCategoryInputs[division] || ""}
                          onChange={(e) => setCustomCategoryInputs((prev) => ({ ...prev, [division]: e.target.value }))}
                          placeholder="Agregar otra categoría"
                          className="cr-input"
                          style={{ minWidth: 0, flex: 1 }}
                        />
                        <button type="button" onClick={() => addCustomCategory(division)} className="cr-btn-gold" style={{ padding: "0.55rem 0.75rem" }}>Agregar</button>
                      </div>
                      {selectedCategories.length > 0 && (
                        <p style={{ color: "#fff", fontSize: "0.78rem", margin: "0.65rem 0 0" }}>
                          Habilitadas: {selectedCategories.join(" · ")}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* FÚTBOL ES EL ÚNICO DEPORTE DE FEFUTIN */}
        <input type="hidden" value="Fútbol" />
        <div>
          <label className="sports-label">Formato de competencia</label>
          <select value={formData.format} onChange={(e) => setFormData({ ...formData, format: e.target.value })} className="cr-input sports-input">
            <option value="groups_playoff">Grupos + eliminatorias</option>
            <option value="single_elimination">Eliminación directa</option>
            <option value="league">Todos contra todos</option>
          </select>
        </div>

        <div>
          <label className="sports-label">Tipo de categoría</label>
          <select value={formData.categoryType} onChange={(e) => setFormData({ ...formData, categoryType: e.target.value, categoryDetail: "" })} className="cr-input sports-input">
            <option value="Año de nacimiento">Año de nacimiento</option>
            <option value="División">División competitiva (Primera, Reserva...)</option>
            <option value="Formativa">Formativas (Mini, Premini...)</option>
            <option value="Personalizada">Categoría personalizada</option>
          </select>
        </div>

        <div>
          <label className="sports-label">Categoría / división</label>
          {formData.categoryType === "Año de nacimiento" ? (
            <select value={formData.categoryDetail} onChange={(e) => setFormData({ ...formData, categoryDetail: e.target.value })} className="cr-input sports-input" required>
              <option value="">Seleccioná el año</option>
              {Array.from({ length: 17 }, (_, index) => 2008 + index).map((year) => <option key={year} value={String(year)}>{year}</option>)}
            </select>
          ) : formData.categoryType === "División" ? (
            <select value={formData.categoryDetail} onChange={(e) => setFormData({ ...formData, categoryDetail: e.target.value })} className="cr-input sports-input" required>
              <option value="">Seleccioná la división</option>
              {["Primera", "Reserva", "Tercera", "Cuarta", "Quinta", "Sexta", "Otra división"].map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          ) : formData.categoryType === "Formativa" ? (
            <select value={formData.categoryDetail} onChange={(e) => setFormData({ ...formData, categoryDetail: e.target.value })} className="cr-input sports-input" required>
              <option value="">Seleccioná la categoría</option>
              {["Premini", "Mini", "Infantiles", "Menores", "Cadetes", "Juveniles", "Sub-14", "Sub-16", "Sub-18", "Sub-21", "Otra categoría"].map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          ) : (
            <input value={formData.categoryDetail} onChange={(e) => setFormData({ ...formData, categoryDetail: e.target.value })} placeholder="Escribí la categoría o división" className="cr-input sports-input" required />
          )}
          <span className="sports-help">Las categorías varían según el deporte y la federación. Podés definir una opción propia.</span>
        </div>

        {/* ===================================================
            GRUPOS
            =================================================== */}

        {formData.format === "groups_playoff" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "0.75rem",
            }}
          >
            {/* CANTIDAD DE GRUPOS */}

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
                Cantidad de Grupos
              </label>

              <select
                value={formData.numGroups}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    numGroups: Number(e.target.value),
                  })
                }
                className="cr-input"
                style={{
                  cursor: "pointer",
                }}
              >
                <option value={2}>2 Grupos</option>

                <option value={3}>3 Grupos</option>

                <option value={4}>4 Grupos</option>

                <option value={5}>5 Grupos</option>

                <option value={6}>6 Grupos</option>

                <option value={7}>7 Grupos</option>

                <option value={8}>8 Grupos</option>
              </select>
            </div>

            {/* CLASIFICADOS */}

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
                Clasificados por Grupo
              </label>

              <select
                value={formData.qualifiersPerGroup}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    qualifiersPerGroup: Number(e.target.value),
                  })
                }
                className="cr-input"
                style={{
                  cursor: "pointer",
                }}
              >
                <option value={2}>2 clasificados</option>
                <option value={4}>4 clasificados</option>
                <option value={6}>6 clasificados</option>
                <option value={8}>8 clasificados</option>
              </select>
            </div>
          </div>
        )}

        {!isEditing ? (
          <div style={{ padding: "0.9rem", border: "1px solid rgba(181,18,42,0.55)", borderRadius: "10px", background: "rgba(181,18,42,0.08)" }}>
            <label className="sports-label">Cupo máximo total del torneo</label>
            <input
              type="number"
              min="4"
              max="256"
              step="1"
              value={formData.maxParticipants}
              onChange={(e) => setFormData({ ...formData, maxParticipants: e.target.value })}
              required
              className="cr-input"
            />
            <span className="sports-help">Este límite es general para el torneo. No cargues equipos en esta etapa.</span>
            <strong style={{ color: "#fff", display: "block", margin: "0.7rem 0 0.4rem" }}>El torneo quedará abierto a inscripciones</strong>
            <p style={{ color: "#d1d5db", fontSize: "0.82rem", lineHeight: 1.5, margin: 0 }}>
              No necesitás cargar equipos ahora. Una vez creado, los clubes podrán inscribirse en las ramas y categorías habilitadas. La organización de grupos y partidos se realizará más adelante, cuando las inscripciones estén confirmadas.
            </p>
          </div>
        ) : (
        <>
        {/* ===================================================
            AGREGAR USUARIOS REGISTRADOS AL TORNEO
            =================================================== */}

        <div style={{ padding: "0.85rem", border: "1px solid rgba(96,165,250,0.45)", borderRadius: "10px", background: "rgba(27,95,168,0.12)" }}>
          <label style={{ display: "block", fontSize: "0.75rem", fontWeight: "bold", textTransform: "uppercase", color: "#d1d5db", marginBottom: "8px" }}>
            Agregar desde el catálogo de equipos
          </label>
          <button type="button" onClick={loadTeamsCatalog} disabled={loadingTeamsCatalog} style={{ width: "100%", padding: "0.65rem", borderRadius: "8px", background: "#1b5fa8", border: "1px solid #60a5fa", color: "#fff", cursor: loadingTeamsCatalog ? "wait" : "pointer", fontWeight: "bold" }}>
            {loadingTeamsCatalog ? "Cargando equipos..." : teamsCatalog.length ? "↻ Actualizar catálogo" : "🔎 Cargar equipos disponibles"}
          </button>
          {teamCatalogError && <p role="alert" style={{ color: "#fca5a5", fontSize: "0.75rem", lineHeight: 1.4 }}>{teamCatalogError}</p>}
          {teamsCatalog.length > 0 && (
            <>
              <input type="search" value={teamSearch} onChange={(e) => setTeamSearch(e.target.value)} placeholder="Buscar equipo..." aria-label="Filtrar equipos disponibles" className="cr-input" style={{ marginTop: "0.65rem" }} />
              <div style={{ maxHeight: "190px", overflowY: "auto", display: "grid", gap: "0.35rem", marginTop: "0.55rem" }}>
                {teamsCatalog.filter((profile) => {
                  const query = teamSearch.trim().toLocaleLowerCase("es");
                  return !query || String(profile.name || "").toLocaleLowerCase("es").includes(query);
                }).map((profile) => {
                  const username = String(profile.name || "").trim();
                  const alreadyParticipant = formData.participantsInput
                    .split("\\n")
                    .some((name) => name.trim().toLocaleLowerCase("es") === username.toLocaleLowerCase("es"));
                  return (
                    <label key={profile.id} style={{ display: "flex", alignItems: "center", gap: "0.55rem", padding: "0.5rem", borderRadius: "7px", background: "#121019", color: alreadyParticipant ? "#6b7280" : "#e5e7eb", fontSize: "0.82rem", cursor: alreadyParticipant ? "not-allowed" : "pointer" }}>
                      <input type="checkbox" checked={alreadyParticipant || selectedTeamIds.includes(profile.id)} disabled={alreadyParticipant || !username} onChange={(e) => setSelectedTeamIds((prev) => e.target.checked ? [...prev, profile.id] : prev.filter((id) => id !== profile.id))} />
                      <span>{username || "Sin alias"}</span>
                      {alreadyParticipant && <span>✓ Ya participa</span>}
                    </label>
                  );
                })}
              </div>
              <p style={{ color: "#93c5fd", fontSize: "0.75rem", marginBottom: 0 }}>Equipos nuevos seleccionados: {selectedTeamIds.filter((id) => {
                const profile = teamsCatalog.find((item) => item.id === id);
                const username = String(profile?.name || "").trim().toLocaleLowerCase("es");
                return username && !formData.participantsInput.split("\\n").some((name) => name.trim().toLocaleLowerCase("es") === username);
              }).length}</p>
            </>
          )}
        </div>

        {/* ===================================================
            PARTICIPANTES
            =================================================== */}

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
            Participantes (uno por línea)</label>

          <textarea
            placeholder={"Club Atlético Norte\nDeportivo Central\nEscuela Municipal\nClub Social"}
            rows={5}
            value={formData.participantsInput}
            onChange={(e) =>
              setFormData({
                ...formData,
                participantsInput: e.target.value,
              })
            }
            className="cr-input"
            style={{
              resize: "vertical",
              fontFamily: "inherit",
            }}
          />

          <span
            style={{
              fontSize: "10px",
              color: "#9ca3af",
              marginTop: "4px",
              display: "block",
            }}
          >
            Escribe o pega los nombres de los jugadores separados por saltos de
            línea.
          </span>
        </div>
        </>
        )}

        {/* ===================================================
            BOTÓN
            =================================================== */}

        <button
          type="submit"
          className="cr-btn-gold"
          style={{
            marginTop: "0.5rem",
          }}
        >
          {isEditing
            ? "💾 Guardar modificaciones"
            : <><TCIcon name="trophy" size={16} /> Crear torneo</>}
        </button>
      </form>
      <button
        type="button"
        onClick={onCancel}
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
        <span aria-hidden="true">←</span> Volver
      </button>
      </div>
    </>
  );
}
