import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

const PHOTO_BUCKET = "fefutin-jornada-photos";

const formatDate = (value) => {
  if (!value) return "Fecha sin registrar";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" });
};

export function FefutinSheetArchive({ mode = "archive", currentUser, assignedMatches = [], onBack }) {
  const [section, setSection] = useState("digital");
  const [sheets, setSheets] = useState([]);
  const [voidedSheetIds, setVoidedSheetIds] = useState(() => new Set());
  const [voidedPhotoIds, setVoidedPhotoIds] = useState(() => new Set());
  const [playersBySheet, setPlayersBySheet] = useState({});
  const [photos, setPhotos] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedTournamentId, setSelectedTournamentId] = useState("");
  const [jornadaDate, setJornadaDate] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  });
  const [jornadaLabel, setJornadaLabel] = useState("");
  const [photoFile, setPhotoFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");

  const assignedTournaments = useMemo(() => {
    const unique = new Map();
    assignedMatches.forEach((item) => {
      if (item?.tournament?.id && !unique.has(item.tournament.id)) {
        unique.set(item.tournament.id, {
          id: item.tournament.id,
          title: item.tournamentTitle || item.tournament.title || "Torneo FEFUTIN",
        });
      }
    });
    return [...unique.values()];
  }, [assignedMatches]);

  const loadArchive = async () => {
    setLoading(true);
    setError("");
    const [
      { data: sheetRows, error: sheetsError },
      { data: photoRows, error: photosError },
      { data: tournamentRows, error: tournamentsError },
      { data: voidedRows, error: voidedError },
    ] = await Promise.all([
      supabase.from("fefutin_match_sheets").select("*").order("updated_at", { ascending: false }),
      supabase.from("fefutin_jornada_photos").select("*").order("jornada_date", { ascending: false }),
      supabase.from("tournaments").select("id, title"),
      supabase.from("fefutin_voided_match_sheets").select("sheet_id, photo_ids"),
    ]);

    // La tabla de anulaciones es complementaria: la migración de archivo vigente
    // no la crea. Su ausencia no debe impedir consultar planillas cerradas y fotos.
    const optionalVoidedTableMissing = ["42P01", "PGRST205"].includes(voidedError?.code);
    if (voidedError && optionalVoidedTableMissing) {
      console.warn("Archivo FEFUTIN: tabla opcional de anulaciones no instalada; se continúa sin marcas de anulación.", voidedError);
    }

    if (sheetsError || photosError || tournamentsError || (voidedError && !optionalVoidedTableMissing)) {
      console.error("Error al cargar el archivo FEFUTIN:", { sheetsError, photosError, tournamentsError, voidedError });
      const failedQuery = sheetsError ? "fefutin_match_sheets" :
        photosError ? "fefutin_jornada_photos" :
        tournamentsError ? "tournaments" : "fefutin_voided_match_sheets";
      const failure = sheetsError || photosError || tournamentsError || voidedError;
      setError(`No se pudo cargar ${failedQuery}: ${failure?.message || failure?.details || "error de consulta o permisos"}`);
      setLoading(false);
      return;
    }

    const closedSheets = (sheetRows || []).filter((sheet) =>
      ["cerrada", "cerrado"].includes(String(sheet.estado || "").trim().toLocaleLowerCase("es"))
    );
    const sheetIds = closedSheets.map((sheet) => sheet.id);
    let playersMap = {};

    if (sheetIds.length) {
      const { data: playerRows, error: playersError } = await supabase
        .from("fefutin_match_sheet_players")
        .select("*")
        .in("match_sheet_id", sheetIds);
      if (playersError) {
        console.error("Error al cargar jugadores de planillas cerradas:", playersError);
        setError("Se encontraron planillas cerradas, pero no se pudieron consultar sus jugadores.");
        setLoading(false);
        return;
      }
      playersMap = (playerRows || []).reduce((acc, player) => {
        (acc[player.match_sheet_id] ||= []).push(player);
        return acc;
      }, {});
    }

    const photoItems = await Promise.all((photoRows || []).map(async (photo) => {
      const { data, error: urlError } = await supabase.storage
        .from(PHOTO_BUCKET)
        .createSignedUrl(photo.storage_path, 60 * 30);
      return { ...photo, signedUrl: urlError ? "" : data?.signedUrl || "" };
    }));

    setSheets(closedSheets);
    setVoidedSheetIds(new Set((voidedRows || []).map((item) => String(item.sheet_id))));
    setVoidedPhotoIds(new Set((voidedRows || []).flatMap((item) => item.photo_ids || []).map(String)));
    setPlayersBySheet(playersMap);
    setPhotos(photoItems);
    setTournaments(tournamentRows || []);
    setLoading(false);
  };

  useEffect(() => {
    if (mode === "archive") loadArchive();
  }, [mode]);

  useEffect(() => {
    if (assignedTournaments.length && !selectedTournamentId) {
      setSelectedTournamentId(assignedTournaments[0].id);
    }
  }, [assignedTournaments, selectedTournamentId]);

  const uploadPhoto = async (event) => {
    event.preventDefault();
    if (!currentUser?.id || !selectedTournamentId || !jornadaDate || !photoFile || uploading) return;
    setUploading(true);
    setError("");
    setNotice("");

    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(photoFile.type)) {
      setError("La foto debe estar en formato JPG, PNG o WEBP.");
      setUploading(false);
      return;
    }
    if (photoFile.size > 12 * 1024 * 1024) {
      setError("La imagen no puede superar los 12 MB.");
      setUploading(false);
      return;
    }

    const extension = photoFile.name.split(".").pop()?.toLowerCase() || "jpg";
    const storagePath = `${currentUser.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
    const tournament = assignedTournaments.find((item) => item.id === selectedTournamentId);

    try {
      const { error: uploadError } = await supabase.storage
        .from(PHOTO_BUCKET)
        .upload(storagePath, photoFile, { contentType: photoFile.type, upsert: false });
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from("fefutin_jornada_photos").insert({
        tournament_id: selectedTournamentId,
        jornada_date: jornadaDate,
        jornada_label: jornadaLabel.trim() || null,
        referee_id: currentUser.id,
        referee_name: currentUser.username || null,
        storage_path: storagePath,
        original_filename: photoFile.name,
      });
      if (insertError) {
        await supabase.storage.from(PHOTO_BUCKET).remove([storagePath]);
        throw insertError;
      }

      setPhotoFile(null);
      setJornadaLabel("");
      setNotice(`Foto de la jornada de ${tournament?.title || "la competencia"} guardada correctamente.`);
    } catch (uploadError) {
      console.error("No se pudo guardar la foto de la jornada:", uploadError);
      setError(uploadError.message || "No se pudo guardar la foto. Intentá nuevamente.");
    } finally {
      setUploading(false);
    }
  };

  const getTournamentTitle = (id) =>
    tournaments.find((item) => item.id === id)?.title || "Torneo FEFUTIN";

  const getScore = (sheet, players) => ({
    local: (players || []).filter((player) => String(player.club || "").trim().toLocaleLowerCase("es") === String(sheet.club_local || "").trim().toLocaleLowerCase("es")).reduce((sum, player) => sum + Number(player.goles || 0), 0),
    visitor: (players || []).filter((player) => String(player.club || "").trim().toLocaleLowerCase("es") === String(sheet.club_visitante || "").trim().toLocaleLowerCase("es")).reduce((sum, player) => sum + Number(player.goles || 0), 0),
  });

  const [filterBranch, setFilterBranch] = useState("");
  const [filterTournament, setFilterTournament] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [documentViewBySheet, setDocumentViewBySheet] = useState({});

  const getTournamentBranch = (tournament) => {
    const parts = String(tournament?.game || "").split("·").map((part) => part.trim());
    return parts.find((part) => ["Infantil", "Femenino", "Mayores"].includes(part)) || "Sin rama";
  };
  const getTournamentCategory = (tournament) => {
    const parts = String(tournament?.game || "").split("·").map((part) => part.trim());
    return parts.length > 2 ? parts.slice(2).join(" · ") : "Sin categoría";
  };
  const archivedTournaments = [...tournaments].sort((a, b) =>
    String(a.title || "Torneo sin nombre").localeCompare(String(b.title || "Torneo sin nombre"), "es")
  );
  const branches = [...new Set(archivedTournaments.map(getTournamentBranch))]
    .filter((branch) => branch !== "Sin rama")
    .sort((a, b) => a.localeCompare(b, "es"));
  const tournamentsForBranch = archivedTournaments.filter((tournament) =>
    !filterBranch || getTournamentBranch(tournament) === filterBranch
  );
  const sheetsForSelectedTournament = sheets.filter((sheet) =>
    !filterTournament || String(sheet.tournament_id) === String(filterTournament)
  );
  const selectedTournament = archivedTournaments.find((item) => String(item.id) === String(filterTournament));
  const categories = [...new Set([
    ...sheetsForSelectedTournament.map((sheet) => String(sheet.categoria || "").trim()),
    ...(selectedTournament ? [getTournamentCategory(selectedTournament)] : []),
  ].filter((category) => category && category !== "Sin categoría"))]
    .sort((a, b) => a.localeCompare(b, "es", { numeric: true }));

  const filteredSheets = sheets.filter((sheet) => {
    const tournament = archivedTournaments.find((item) => String(item.id) === String(sheet.tournament_id));
    return (!filterBranch || getTournamentBranch(tournament) === filterBranch) &&
      (!filterTournament || String(sheet.tournament_id) === String(filterTournament)) &&
      (!filterCategory || String(sheet.categoria || getTournamentCategory(tournament)) === filterCategory);
  });

  const filteredPhotos = photos.filter((photo) => {
    const photoTournament = archivedTournaments.find((item) => String(item.id) === String(photo.tournament_id));
    const relatedSheets = sheets.filter((sheet) => isPhotoForSheet(photo, sheet));
    const matchesCategory = !filterCategory || (
      photo.document_type === "category"
        ? String(photo.categoria || "") === filterCategory
        : relatedSheets.some((sheet) => String(sheet.categoria || "") === filterCategory)
    );
    const photoJornada = String(photo.jornada_label || "").trim().toLocaleLowerCase("es");
    const selectedJornada = String(filterJornada || "").trim().toLocaleLowerCase("es");
    const matchesJornada = !filterJornada || (
      photoJornada === selectedJornada ||
      photoJornada === `jornada ${selectedJornada}` ||
      relatedSheets.some((sheet) => String(sheet.jornada || "").trim() === String(filterJornada))
    );
    return (!filterBranch || getTournamentBranch(photoTournament) === filterBranch) &&
      (!filterTournament || String(photo.tournament_id) === String(filterTournament)) &&
      matchesCategory;
  });

  const isPhotoForSheet = (photo, sheet) => {
    if (String(photo.tournament_id) !== String(sheet.tournament_id)) return false;

    const sheetIsVoided = voidedSheetIds.has(String(sheet.id));
    const photoIsVoided = voidedPhotoIds.has(String(photo.id));
    if (sheetIsVoided) return photoIsVoided;
    if (photoIsVoided) return false;

    if (photo.document_type === "category") return String(photo.match_sheet_id) === String(sheet.id);
    const photoJornada = String(photo.jornada_label || "").trim().toLocaleLowerCase("es");
    const sheetJornada = String(sheet.jornada || "").trim().toLocaleLowerCase("es");
    const sameJornada = photoJornada && (
      photoJornada === sheetJornada ||
      photoJornada === `jornada ${sheetJornada}`
    );
    const sameDate = photo.jornada_date && sheet.fecha_partido &&
      photo.jornada_date === sheet.fecha_partido;

    // Si la planilla no tiene fecha y la foto no tiene jornada identificada,
    // la mostramos como respaldo para que el documento físico no quede oculto.
    const missingAssociationData = !sheet.fecha_partido && !photoJornada;

    return Boolean(sameJornada || sameDate || missingAssociationData);
  };

  const photosForSheet = (sheet) => photos.filter((photo) => isPhotoForSheet(photo, sheet));

  return (
    <main className="tc-form-screen" style={{ width: "100%", maxWidth: "100%", minWidth: 0, minHeight: "70vh", padding: "0", color: "#fff", boxSizing: "border-box" }}>
      <section style={{ width: "100%", maxWidth: "100%", minWidth: 0, margin: 0, padding: "clamp(.85rem, 2vw, 1.25rem)", background: "#101010", border: "1px solid #b5122a", borderRadius: "14px", boxSizing: "border-box" }}>
        <button type="button" className="tc-form-back" onClick={onBack}>← Volver</button>
        <h2 style={{ color: "#fff", margin: "1rem 0 .35rem", letterSpacing: ".06em" }}>
          {mode === "upload" ? "FOTO DE PLANILLA GENERAL" : "ARCHIVO DE PLANILLAS"}
        </h2>
        <p style={{ color: "#bbb", fontSize: ".82rem", marginTop: 0, lineHeight: 1.5 }}>
          {mode === "upload"
            ? "Subí una foto legible de la planilla general de la jornada, firmada por los dos referentes."
            : "Buscá una jornada o partido y elegí qué documento querés consultar."}
        </p>

        {mode === "upload" ? (
          <form onSubmit={uploadPhoto} style={{ display: "grid", gap: ".8rem", marginTop: "1rem" }}>
            <label style={{ display: "grid", gap: ".35rem", color: "#eee", fontSize: ".82rem" }}>
              Torneo
              <select required value={selectedTournamentId} onChange={(event) => setSelectedTournamentId(event.target.value)} style={{ padding: ".75rem", borderRadius: "8px", background: "#fff", color: "#171c27", border: "1px solid #777" }}>
                {assignedTournaments.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </label>
            <label style={{ display: "grid", gap: ".35rem", color: "#eee", fontSize: ".82rem" }}>
              Fecha de la jornada
              <input type="date" required value={jornadaDate} onChange={(event) => setJornadaDate(event.target.value)} style={{ padding: ".7rem", borderRadius: "8px", background: "#fff", color: "#171c27", border: "1px solid #777" }} />
            </label>
            <label style={{ display: "grid", gap: ".35rem", color: "#eee", fontSize: ".82rem" }}>
              Número o identificación de jornada (opcional)
              <input value={jornadaLabel} onChange={(event) => setJornadaLabel(event.target.value)} placeholder="Ej.: Jornada 1" style={{ padding: ".7rem", borderRadius: "8px", background: "#fff", color: "#171c27", border: "1px solid #777" }} />
            </label>
            <label style={{ display: "grid", gap: ".4rem", color: "#eee", fontSize: ".82rem" }}>
              Foto de la planilla general firmada
              <input type="file" accept="image/jpeg,image/png,image/webp" required onChange={(event) => setPhotoFile(event.target.files?.[0] || null)} style={{ padding: ".65rem", borderRadius: "8px", background: "#171c27", color: "#fff", border: "1px solid #555" }} />
              <small style={{ color: "#aaa" }}>JPG, PNG o WEBP · Máximo 12 MB.</small>
            </label>
            {error && <p role="alert" style={{ color: "#fca5a5", margin: 0 }}>{error}</p>}
            {notice && <p role="status" style={{ color: "#86efac", margin: 0 }}>{notice}</p>}
            <button type="submit" disabled={uploading || !assignedTournaments.length} style={{ padding: ".8rem", border: "1px solid #b5122a", borderRadius: "8px", background: "#b5122a", color: "#fff", fontWeight: 900, cursor: "pointer", opacity: uploading ? .65 : 1 }}>
              {uploading ? "GUARDANDO FOTO..." : "GUARDAR FOTO DE LA JORNADA"}
            </button>
            {!assignedTournaments.length && <p style={{ color: "#fca5a5", fontSize: ".8rem" }}>No tenés designaciones que permitan asociar la foto a un torneo.</p>}
          </form>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: ".65rem", margin: "1rem 0" }}>
              <label style={{ display: "grid", gap: ".3rem", color: "#eee", fontSize: ".76rem", fontWeight: 800 }}>
                RAMA
                <select value={filterBranch} onChange={(event) => {
                  setFilterBranch(event.target.value);
                  setFilterTournament("");
                  setFilterCategory("");
                }} style={{ minWidth: 0, padding: ".7rem", borderRadius: "8px", background: "#fff", color: "#171c27", border: "1px solid #777" }}>
                  <option value="">Todas las ramas</option>
                  {branches.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label style={{ display: "grid", gap: ".3rem", color: "#eee", fontSize: ".76rem", fontWeight: 800 }}>
                TORNEO
                <select value={filterTournament} onChange={(event) => {
                  setFilterTournament(event.target.value);
                  setFilterCategory("");
                }} style={{ minWidth: 0, padding: ".7rem", borderRadius: "8px", background: "#fff", color: "#171c27", border: "1px solid #777" }}>
                  <option value="">Todos los torneos</option>
                  {tournamentsForBranch.map((item) => <option key={item.id} value={item.id}>{item.title || "Torneo sin nombre"}</option>)}
                </select>
              </label>
              <label style={{ display: "grid", gap: ".3rem", color: "#eee", fontSize: ".76rem", fontWeight: 800 }}>
                CATEGORÍA
                <select value={filterCategory} onChange={(event) => setFilterCategory(event.target.value)} style={{ minWidth: 0, padding: ".7rem", borderRadius: "8px", background: "#fff", color: "#171c27", border: "1px solid #777" }}>
                  <option value="">Todas</option>
                  {categories.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".5rem", margin: "1rem 0 .7rem" }}>
              <strong style={{ color: "#fff", fontSize: ".85rem" }}>PARTIDOS ENCONTRADOS</strong>
              <span style={{ color: "#bbb", fontSize: ".75rem" }}>{filteredSheets.length} resultado(s)</span>
            </div>
            {loading ? <p style={{ color: "#ccc", textAlign: "center", padding: "1.5rem" }}>Cargando archivo...</p> : error ? <p role="alert" style={{ color: "#fca5a5" }}>{error}</p> : (
              <div style={{ display: "grid", gap: ".75rem" }}>
                {filteredSheets.map((sheet) => {
                  const players = playersBySheet[sheet.id] || [];
                  const score = getScore(sheet, players);
                  const relatedPhotos = photosForSheet(sheet);
                  const selectedView = documentViewBySheet[sheet.id] || "digital";
                  return (
                    <article key={sheet.id} style={{ border: "1px solid #b5122a", borderRadius: "10px", background: "#171c27", padding: ".85rem" }}>
                      <strong style={{ color: "#fff", display: "block", lineHeight: 1.45 }}>{sheet.club_local} {score.local} - {score.visitor} {sheet.club_visitante}</strong>
                      {voidedSheetIds.has(String(sheet.id)) && (
                        <strong style={{ display: "inline-block", marginTop: ".35rem", padding: ".25rem .45rem", border: "1px solid #b5122a", borderRadius: "5px", color: "#f3a0ad", fontSize: ".68rem", letterSpacing: ".05em" }}>
                          RESULTADO ANULADO · SOLO HISTORIAL
                        </strong>
                      )}
                      <small style={{ display: "block", color: "#bbb", marginTop: ".25rem" }}>{getTournamentTitle(sheet.tournament_id)} · {sheet.categoria || "Sin categoría"} · {sheet.jornada ? `Jornada ${sheet.jornada}` : "Jornada sin indicar"} · {formatDate(sheet.fecha_partido)}</small>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".55rem", marginTop: ".8rem" }}>
                        <button type="button" onClick={() => setDocumentViewBySheet((previous) => ({ ...previous, [sheet.id]: "digital" }))} style={{ padding: ".65rem .35rem", border: "1px solid #b5122a", borderRadius: "8px", background: selectedView === "digital" ? "#b5122a" : "#101010", color: "#fff", fontWeight: 900, fontSize: ".75rem" }}>PLANILLA DIGITAL</button>
                        <button type="button" onClick={() => setDocumentViewBySheet((previous) => ({ ...previous, [sheet.id]: "physical" }))} style={{ padding: ".65rem .35rem", border: "1px solid #b5122a", borderRadius: "8px", background: selectedView === "physical" ? "#b5122a" : "#101010", color: "#fff", fontWeight: 900, fontSize: ".75rem" }}>PLANILLA FÍSICA</button>
                      </div>
                      {selectedView === "digital" ? (
                        <div style={{ marginTop: ".8rem", borderTop: "1px solid #444", paddingTop: ".7rem" }}>
                          <p style={{ margin: ".2rem 0", color: "#ddd", fontSize: ".8rem" }}>Sede: {sheet.sede || "Sin registrar"} · Árbitro: {sheet.arbitro_designado || "Sin registrar"}</p>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: ".7rem", marginTop: ".65rem" }}>
                            {[sheet.club_local, sheet.club_visitante].map((club) => (
                              <div key={club}>
                                <strong style={{ color: "#f3a0ad", fontSize: ".78rem" }}>{club}</strong>
                                {players.filter((player) => String(player.club || "").trim().toLocaleLowerCase("es") === String(club || "").trim().toLocaleLowerCase("es")).map((player) => (
                                  <div key={player.id} style={{ display: "flex", justifyContent: "space-between", gap: ".4rem", padding: ".25rem 0", borderBottom: "1px solid #333", color: "#eee", fontSize: ".76rem" }}>
                                    <span>{player.apellido} {player.nombre}</span><strong>{Number(player.goles || 0)} gol(es)</strong>
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div style={{ marginTop: ".8rem", borderTop: "1px solid #444", paddingTop: ".7rem" }}>
                          {relatedPhotos.length ? relatedPhotos.map((photo) => (
                            <div key={photo.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(100px, 160px)", gap: ".7rem", alignItems: "center", marginTop: ".4rem" }}>
                              <div>
                                <strong style={{ color: "#fff", fontSize: ".8rem" }}>{photo.document_type === "category" ? `Planilla firmada · ${photo.categoria || sheet.categoria || "Categoría"}` : (photo.jornada_label || "Planilla general de jornada")}</strong>
                                <small style={{ display: "block", color: "#aaa", marginTop: ".2rem" }}>Firmada · {formatDate(photo.jornada_date)} · {photo.referee_name || "Árbitro sin identificar"}</small>
                                {photo.signedUrl && <a href={photo.signedUrl} target="_blank" rel="noreferrer" style={{ color: "#f3a0ad", display: "inline-block", marginTop: ".35rem", fontSize: ".78rem" }}>Abrir foto</a>}
                              </div>
                              {photo.signedUrl ? <a href={photo.signedUrl} target="_blank" rel="noreferrer"><img src={photo.signedUrl} alt={photo.document_type === "category" ? "Planilla de categoría firmada" : "Planilla general de jornada firmada"} style={{ width: "100%", maxHeight: "125px", objectFit: "cover", borderRadius: "6px" }} /></a> : <span style={{ color: "#fca5a5", fontSize: ".75rem" }}>Foto sin acceso disponible</span>}
                            </div>
                          )) : <p style={{ color: "#f0c3ca", fontSize: ".8rem", margin: 0 }}>Pendiente de archivo: todavía no se cargó la foto física de esta jornada.</p>}
                        </div>
                      )}
                    </article>
                  );
                })}
                {filteredPhotos.filter((photo) => !sheets.some((sheet) =>
                  isPhotoForSheet(photo, sheet)
                )).map((photo) => (
                  <article key={`photo-${photo.id}`} style={{ border: "1px solid #555", borderRadius: "10px", background: "#171c27", padding: ".85rem" }}>
                    <strong style={{ color: "#fff" }}>{getTournamentTitle(photo.tournament_id)} · {photo.jornada_label || "Jornada"}</strong>
                    <small style={{ display: "block", color: "#bbb", margin: ".25rem 0 .6rem" }}>{formatDate(photo.jornada_date)} · {photo.referee_name || "Árbitro sin identificar"}</small>
                    {photo.signedUrl ? <a href={photo.signedUrl} target="_blank" rel="noreferrer" style={{ color: "#f3a0ad" }}>Abrir planilla física de la jornada</a> : <span style={{ color: "#fca5a5", fontSize: ".8rem" }}>Foto sin acceso disponible</span>}
                  </article>
                ))}
                {!filteredSheets.length && !filteredPhotos.length && <p style={{ color: "#bbb", textAlign: "center", padding: "1.2rem" }}>No hay documentos que coincidan con esos filtros.</p>}
              </div>
            )}
            <button type="button" className="tc-form-back" onClick={loadArchive} disabled={loading} style={{ marginTop: "1rem" }}>↻ Actualizar archivo</button>
          </>
        )}
      </section>
    </main>
  );
}
