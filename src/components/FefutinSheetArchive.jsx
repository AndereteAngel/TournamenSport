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
    ] = await Promise.all([
      supabase.from("fefutin_match_sheets").select("*").order("updated_at", { ascending: false }),
      supabase.from("fefutin_jornada_photos").select("*").order("jornada_date", { ascending: false }),
      supabase.from("tournaments").select("id, title, game"),
    ]);

    if (sheetsError || photosError || tournamentsError) {
      console.error("Error al cargar el archivo FEFUTIN:", { sheetsError, photosError, tournamentsError });
      setError("No se pudo cargar el archivo. Revisá que hayas aplicado la migración de Archivo de Planillas en Supabase.");
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

  return (
    <main className="tc-form-screen" style={{ minHeight: "70vh", padding: "1rem", color: "#fff" }}>
      <section style={{ width: "100%", maxWidth: "980px", margin: "auto", padding: "1rem", background: "#101010", border: "1px solid #b5122a", borderRadius: "14px", boxSizing: "border-box" }}>
        <button type="button" className="tc-form-back" onClick={onBack}>← Volver</button>
        <h2 style={{ color: "#fff", margin: "1rem 0 .35rem", letterSpacing: ".06em" }}>
          {mode === "upload" ? "FOTO DE PLANILLA GENERAL" : "ARCHIVO DE PLANILLAS"}
        </h2>
        <p style={{ color: "#bbb", fontSize: ".82rem", marginTop: 0, lineHeight: 1.5 }}>
          {mode === "upload"
            ? "Subí una foto legible de la planilla general de la jornada, firmada por los dos referentes."
            : "Resguardo institucional de las planillas oficiales cerradas y las fotos de cada jornada."}
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: ".65rem", margin: "1rem 0" }}>
              <button type="button" onClick={() => setSection("digital")} style={{ padding: ".8rem .5rem", border: "1px solid #b5122a", borderRadius: "8px", background: section === "digital" ? "#b5122a" : "#171c27", color: "#fff", fontWeight: 900 }}>PLANILLAS DIGITALES</button>
              <button type="button" onClick={() => setSection("photos")} style={{ padding: ".8rem .5rem", border: "1px solid #b5122a", borderRadius: "8px", background: section === "photos" ? "#b5122a" : "#171c27", color: "#fff", fontWeight: 900 }}>FOTOS DE JORNADA</button>
            </div>
            {loading ? <p style={{ color: "#ccc", textAlign: "center", padding: "1.5rem" }}>Cargando archivo...</p> : error ? <p role="alert" style={{ color: "#fca5a5" }}>{error}</p> : section === "digital" ? (
              sheets.length ? (
                <div style={{ display: "grid", gap: ".75rem" }}>
                  {sheets.map((sheet) => {
                    const players = playersBySheet[sheet.id] || [];
                    const score = getScore(sheet, players);
                    return (
                      <details key={sheet.id} style={{ border: "1px solid #444", borderLeft: "3px solid #b5122a", borderRadius: "9px", background: "#171c27", padding: ".8rem" }}>
                        <summary style={{ cursor: "pointer", color: "#fff", fontWeight: 900, lineHeight: 1.5 }}>
                          {sheet.club_local} {score.local} - {score.visitor} {sheet.club_visitante}
                          <small style={{ display: "block", color: "#bbb", fontWeight: 500 }}>{getTournamentTitle(sheet.tournament_id)} · {sheet.categoria || "Sin categoría"} · {sheet.jornada ? `Jornada ${sheet.jornada}` : "Jornada sin indicar"} · {formatDate(sheet.fecha_partido)}</small>
                        </summary>
                        <div style={{ marginTop: ".8rem", borderTop: "1px solid #444", paddingTop: ".7rem" }}>
                          <p style={{ margin: ".2rem 0", color: "#ddd", fontSize: ".8rem" }}>Sede: {sheet.sede || "Sin registrar"}</p>
                          <p style={{ margin: ".2rem 0", color: "#ddd", fontSize: ".8rem" }}>Árbitro: {sheet.arbitro_designado || "Sin registrar"}</p>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".7rem", marginTop: ".8rem" }}>
                            {[sheet.club_local, sheet.club_visitante].map((club) => (
                              <div key={club}>
                                <strong style={{ color: "#f3a0ad", fontSize: ".78rem" }}>{club}</strong>
                                {(players.filter((player) => String(player.club || "").trim().toLocaleLowerCase("es") === String(club || "").trim().toLocaleLowerCase("es"))).map((player) => (
                                  <div key={player.id} style={{ display: "flex", justifyContent: "space-between", gap: ".4rem", padding: ".25rem 0", borderBottom: "1px solid #333", color: "#eee", fontSize: ".76rem" }}>
                                    <span>{player.apellido} {player.nombre}</span><strong>{Number(player.goles || 0)} gol(es)</strong>
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        </div>
                      </details>
                    );
                  })}
                </div>
              ) : <p style={{ color: "#bbb", textAlign: "center", padding: "1.2rem" }}>Todavía no hay planillas digitales cerradas para archivar.</p>
            ) : (
              photos.length ? (
                <div style={{ display: "grid", gap: ".75rem" }}>
                  {photos.map((photo) => (
                    <article key={photo.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(110px, 180px)", gap: ".8rem", alignItems: "center", padding: ".75rem", border: "1px solid #444", borderRadius: "9px", background: "#171c27" }}>
                      <div>
                        <strong style={{ color: "#fff", display: "block" }}>{getTournamentTitle(photo.tournament_id)}</strong>
                        <span style={{ color: "#ccc", fontSize: ".8rem" }}>{photo.jornada_label || "Jornada"} · {formatDate(photo.jornada_date)}</span>
                        <small style={{ display: "block", color: "#aaa", marginTop: ".25rem" }}>Árbitro: {photo.referee_name || "Sin identificar"}</small>
                        {photo.signedUrl ? <a href={photo.signedUrl} target="_blank" rel="noreferrer" style={{ color: "#f3a0ad", display: "inline-block", marginTop: ".45rem", fontSize: ".8rem" }}>Abrir foto</a> : <small style={{ color: "#fca5a5" }}>No se pudo generar el acceso a la imagen.</small>}
                      </div>
                      {photo.signedUrl ? <a href={photo.signedUrl} target="_blank" rel="noreferrer"><img src={photo.signedUrl} alt="Planilla general firmada" style={{ width: "100%", maxHeight: "130px", objectFit: "cover", borderRadius: "6px" }} /></a> : <div style={{ minHeight: "80px", display: "grid", placeItems: "center", color: "#888" }}>Sin vista previa</div>}
                    </article>
                  ))}
                </div>
              ) : <p style={{ color: "#bbb", textAlign: "center", padding: "1.2rem" }}>Todavía no hay fotos de jornadas cargadas.</p>
            )}
            <button type="button" className="tc-form-back" onClick={loadArchive} disabled={loading} style={{ marginTop: "1rem" }}>↻ Actualizar archivo</button>
          </>
        )}
      </section>
    </main>
  );
}
