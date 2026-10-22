import { useEffect, useState } from "react";
import { TCIcon } from "./TCIcon";
import { supabase } from "../supabaseClient";
import { TournamentNotice, useTournamentNotice } from "./TournamentNotice";

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
        game: "Clash Royale 1v1",
        format: "groups_playoff",
        numGroups: 2,
        qualifiersPerGroup: 2,
        isPublic: true,
        participantsInput: "",
        maxParticipants: 16,
      };
    }

    const participants = getParticipantsFromTournament();

    return {
      title: initialData.title || "",
      game: initialData.game || "Clash Royale 1v1",
      format: initialData.format || "groups_playoff",
      numGroups:
        initialData.format === "league" ? 1 : initialData.groups?.length || 2,
      qualifiersPerGroup: initialData.qualifiers_per_group || 2,
      isPublic: initialData.is_public !== false,
      participantsInput: participants.join("\n"),
      maxParticipants: initialData.max_participants || 16,
    };
  };

  const [formData, setFormData] = useState(getInitialFormData());
  const { notice, showNotice, clearNotice } = useTournamentNotice();
  const [registeredProfiles, setRegisteredProfiles] = useState([]);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [profileSearch, setProfileSearch] = useState("");
  const [selectedProfileIds, setSelectedProfileIds] = useState([]);
  const [profileError, setProfileError] = useState("");

  const loadRegisteredProfiles = async () => {
    setLoadingProfiles(true);
    setProfileError("");
    const { data, error } = await supabase
      .rpc("list_registered_players");

    if (error) {
      console.error("Error al cargar perfiles:", error);
      setProfileError("No se pudo cargar la lista. Revisá los permisos de lectura de profiles en Supabase. También podés ingresar los nombres manualmente.");
      setLoadingProfiles(false);
      return;
    }

    setRegisteredProfiles(data || []);
    setLoadingProfiles(false);
  };

  // =========================================================
  // ACTUALIZAR FORMULARIO AL ENTRAR EN EDICIÓN
  // =========================================================

  useEffect(() => {
    setFormData(getInitialFormData());
  }, [initialData, isEditing]);

  // =========================================================
  // GUARDAR
  // =========================================================

  const handleSubmit = (e) => {
    e.preventDefault();

    const manualTeams = formData.participantsInput
      .split("\n")
      .map((name) => name.trim())
      .filter((name) => name.length > 0);

    const selectedTeams = !isEditing
      ? registeredProfiles
          .filter((profile) => selectedProfileIds.includes(profile.id))
          .map((profile) => String(profile.username || "").trim())
          .filter(Boolean)
      : [];

    const teams = [...new Map(
      [...selectedTeams, ...manualTeams].map((name) => [name.toLocaleLowerCase("es"), name])
    ).values()];

    if (isEditing) {
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
        showNotice(`Seleccionaste ${teams.length} jugadores, pero el cupo máximo es ${formData.maxParticipants}.`);
        return;
      }
    }

    onSave({
      ...formData,
      maxParticipants: Number(formData.maxParticipants),
      teams,
    });
  };

  return (
    <>
      <TournamentNotice notice={notice} onClose={clearNotice} />
      <div className="cr-card" style={{ maxWidth: "520px" }}>
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
          {isEditing ? <><TCIcon name="settings" size={20} /> Modificar Torneo</> : <><TCIcon name="sword" size={20} /> Configurar Torneo</>}
        </h2>

        <button
          onClick={onCancel}
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
            placeholder="Ej: Copa Suprema de Clanes"
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

        {/* ===================================================
            JUEGO + FORMATO
            =================================================== */}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "0.75rem",
          }}
        >
          {/* JUEGO */}

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
              Videojuego
            </label>

            <select
              value={formData.game}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  game: e.target.value,
                })
              }
              className="cr-input"
              style={{
                cursor: "pointer",
              }}
            >
              <option value="Clash Royale 1v1">Clash Royale 1v1</option>

              <option value="Brawl Stars">Brawl Stars</option>

              <option value="EA Sports FC 26">EA Sports FC 26</option>

              <option value="Valorant">Valorant</option>
            </select>
          </div>

          {/* FORMATO */}

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
              Formato
            </label>

            <select
              value={formData.format}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  format: e.target.value,
                })
              }
              className="cr-input"
              style={{
                cursor: "pointer",
              }}
            >
              <option value="groups_playoff">Grupos + Playoffs</option>

              <option value="single_elimination">Playoff</option>

              <option value="league">Todos contra Todos</option>
            </select>
          </div>
        </div>

        {/* ===================================================
            VISIBILIDAD
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
            Visibilidad del Torneo
          </label>

          <select
            value={formData.isPublic ? "public" : "private"}
            onChange={(e) =>
              setFormData({
                ...formData,
                isPublic: e.target.value === "public",
              })
            }
            className="cr-input"
            style={{
              cursor: "pointer",
            }}
          >
            <option value="public">Público (Muestra código en la lista)</option>

            <option value="private">Privado (Oculta código)</option>
          </select>
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
                <option value={1}>1 clasificado</option>

                <option value={2}>2 clasificados</option>
              </select>
            </div>
          </div>
        )}

        {!isEditing ? (
          <>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: "bold", textTransform: "uppercase", color: "#d1d5db", marginBottom: "4px" }}>
                Cupo máximo de participantes
              </label>
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
              <span style={{ fontSize: "10px", color: "#9ca3af", marginTop: "4px", display: "block" }}>
                Podés cargar los jugadores ahora o completar la lista antes de iniciar el torneo.
              </span>
            </div>

            <div style={{ padding: "0.85rem", border: "1px solid rgba(96,165,250,0.45)", borderRadius: "10px", background: "rgba(27,95,168,0.12)" }}>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: "bold", textTransform: "uppercase", color: "#d1d5db", marginBottom: "8px" }}>
                Jugadores registrados
              </label>
              <button type="button" onClick={loadRegisteredProfiles} disabled={loadingProfiles} style={{ width: "100%", padding: "0.65rem", borderRadius: "8px", background: "#1b5fa8", border: "1px solid #60a5fa", color: "#fff", cursor: loadingProfiles ? "wait" : "pointer", fontWeight: "bold" }}>
                {loadingProfiles ? "Cargando jugadores..." : registeredProfiles.length ? "↻ Actualizar lista de jugadores" : "🔎 Buscar cuentas registradas"}
              </button>
              {profileError && <p role="alert" style={{ color: "#fca5a5", fontSize: "0.75rem", lineHeight: 1.4 }}>{profileError}</p>}
              {registeredProfiles.length > 0 && (
                <>
                  <input type="search" value={profileSearch} onChange={(e) => setProfileSearch(e.target.value)} placeholder="Filtrar por alias..." aria-label="Filtrar jugadores registrados" className="cr-input" style={{ marginTop: "0.65rem" }} />
                  <div style={{ maxHeight: "190px", overflowY: "auto", display: "grid", gap: "0.35rem", marginTop: "0.55rem" }}>
                    {registeredProfiles.filter((profile) => {
                      const query = profileSearch.trim().toLocaleLowerCase("es");
                      return !query || String(profile.username || "").toLocaleLowerCase("es").includes(query);
                    }).map((profile) => (
                      <label key={profile.id} style={{ display: "flex", alignItems: "center", gap: "0.55rem", padding: "0.5rem", borderRadius: "7px", background: "#121019", color: "#e5e7eb", fontSize: "0.82rem", cursor: "pointer" }}>
                        <input type="checkbox" checked={selectedProfileIds.includes(profile.id)} onChange={(e) => setSelectedProfileIds((prev) => e.target.checked ? [...prev, profile.id] : prev.filter((id) => id !== profile.id))} />
                        <span>{profile.username || "Sin alias"}</span>
                      </label>
                    ))}
                  </div>
                  <p style={{ color: "#93c5fd", fontSize: "0.75rem", marginBottom: 0 }}>Seleccionados: {selectedProfileIds.length}</p>
                </>
              )}
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: "bold", textTransform: "uppercase", color: "#d1d5db", marginBottom: "4px" }}>
                Agregar jugadores manualmente (opcional)
              </label>
              <textarea
                placeholder={"ReyAzul99\nPrincesaPoder\nPekkaMaster"}
                rows={4}
                value={formData.participantsInput}
                onChange={(e) => setFormData({ ...formData, participantsInput: e.target.value })}
                className="cr-input"
                style={{ resize: "vertical", fontFamily: "inherit" }}
              />
              <span style={{ fontSize: "10px", color: "#9ca3af", marginTop: "4px", display: "block" }}>
                Escribí un alias por línea. Los duplicados se eliminan automáticamente.
              </span>
            </div>
          </>
        ) : (
        <>
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
            Participantes (Uno por línea)
          </label>

          <textarea
            placeholder={"ReyAzul99\nPrincesaPoder\nPekkaMaster\nMontapuercosX"}
            rows={5}
            value={formData.participantsInput}
            onChange={(e) =>
              setFormData({
                ...formData,
                participantsInput: e.target.value,
              })
            }
            required
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
            : <><TCIcon name="sword" size={16} /> Crear Torneo</>}
        </button>
      </form>
      </div>
    </>
  );
}
