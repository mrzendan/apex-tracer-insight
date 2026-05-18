import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { maps as allMaps } from "@/lib/mock-match";
import { useAdminStore } from "@/lib/admin-store";

export const Route = createFileRoute("/admin/minimap")({ component: MinimapAdmin });

const SRC_W = 1920;
const SRC_H = 1080;

type TrackPoint = { x: number; y: number; t: number };

function MinimapAdmin() {
  const { tournaments, matches, teams, zones } = useAdminStore();
  const minimapZone = zones.vod.find((z) => z.tag === "minimap");

  // Tournament → Match → Team (POV) → Map
  const [tournamentId, setTournamentId] = useState(tournaments[0]?.id ?? "");
  const tMatches = useMemo(() => matches.filter((m) => m.tournamentId === tournamentId), [matches, tournamentId]);
  const [matchId, setMatchId] = useState(tMatches[0]?.id ?? "");
  useEffect(() => { setMatchId(tMatches[0]?.id ?? ""); }, [tournamentId]);
  const match = matches.find((m) => m.id === matchId);
  const matchTeams = (match?.teamIds ?? []).map((id) => teams.find((t) => t.id === id)).filter(Boolean) as typeof teams;
  const [teamId, setTeamId] = useState(matchTeams[0]?.id ?? "");
  useEffect(() => { setTeamId(matchTeams[0]?.id ?? ""); }, [matchId]);
  const team = teams.find((t) => t.id === teamId);
  const povUrl = (match?.teamVods?.[teamId]) || "";

  const matchMapIds = (match?.mapIds && match.mapIds.length ? match.mapIds : match ? [match.mapId] : []);
  const [mapId, setMapId] = useState(matchMapIds[0] ?? allMaps[0].id);
  useEffect(() => { setMapId(matchMapIds[0] ?? allMaps[0].id); }, [matchId]);
  const map = allMaps.find((m) => m.id === mapId) ?? allMaps[0];

  // Analysis
  const [skipFrames, setSkipFrames] = useState(15); // process every Nth frame (~assumed 30fps)
  const [analyzing, setAnalyzing] = useState(false);
  const [track, setTrack] = useState<TrackPoint[]>([]);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(60);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastSampleFrameRef = useRef<number>(-1);
  const FPS = 30;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onLoaded = () => setDuration(v.duration || 60);
    const onTime = () => {
      setTime(v.currentTime);
      if (!analyzing) return;
      const frame = Math.floor(v.currentTime * FPS);
      if (lastSampleFrameRef.current < 0 || frame - lastSampleFrameRef.current >= skipFrames) {
        lastSampleFrameRef.current = frame;
        // Mock detection of player dot inside minimap → normalized [0..1] on full map.
        const t = v.currentTime;
        const px = 0.5 + Math.sin(t * 0.35 + 0.7) * 0.32 + (Math.sin(t * 1.7) * 0.04);
        const py = 0.5 + Math.cos(t * 0.28 + 1.3) * 0.28 + (Math.cos(t * 1.9) * 0.04);
        setTrack((arr) => [...arr, { x: clamp01(px), y: clamp01(py), t }]);
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [povUrl, analyzing, skipFrames]);

  const togglePlay = () => { const v = videoRef.current; if (!v) return; if (v.paused) v.play(); else v.pause(); };
  const seek = (t: number) => { const v = videoRef.current; if (v) v.currentTime = t; setTime(t); };

  const startAnalysis = () => {
    setTrack([]);
    lastSampleFrameRef.current = -1;
    setAnalyzing(true);
    const v = videoRef.current;
    if (v && v.paused) v.play();
  };
  const stopAnalysis = () => setAnalyzing(false);
  const clearTrack = () => { setTrack([]); lastSampleFrameRef.current = -1; };

  // Crop math for minimap region of the video (source 1920x1080).
  const mz = minimapZone;
  const cropAspect = mz ? mz.w / mz.h : 1;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-6">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold uppercase tracking-wider">Minimap analysis</h1>
          <span className="text-mono text-xs text-muted-foreground">·</span>
          <select value={tournamentId} onChange={(e) => setTournamentId(e.target.value)}
            className="rounded-sm border border-border bg-background px-2 py-1 text-xs">
            {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={matchId} onChange={(e) => setMatchId(e.target.value)}
            className="rounded-sm border border-border bg-background px-2 py-1 text-xs">
            {tMatches.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)}
            className="rounded-sm border border-border bg-background px-2 py-1 text-xs">
            {matchTeams.map((t) => <option key={t!.id} value={t!.id}>{t!.tag} · {t!.name}</option>)}
          </select>
          <select value={mapId} onChange={(e) => setMapId(e.target.value)}
            className="rounded-sm border border-border bg-background px-2 py-1 text-xs">
            {(matchMapIds.length ? matchMapIds : allMaps.map((m) => m.id)).map((id) => {
              const m = allMaps.find((x) => x.id === id);
              return <option key={id} value={id}>{m?.name ?? id}</option>;
            })}
          </select>
        </div>
        <div className="flex items-center gap-2">
          {analyzing ? (
            <button onClick={stopAnalysis} className="rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-destructive hover:bg-destructive/20">
              Stop analysis
            </button>
          ) : (
            <button onClick={startAnalysis} className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:brightness-110">
              Start analysis
            </button>
          )}
          <button onClick={clearTrack} className="rounded-sm border border-border bg-surface px-2 py-1 text-xs uppercase tracking-wider hover:bg-muted">
            Clear track
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 p-3">
            {/* POV VOD — cropped to minimap zone */}
            <div className="hud-panel relative flex min-h-0 flex-col overflow-hidden bg-black">
              <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5">
                <div className="label-eyebrow text-xs">
                  POV minimap{team ? ` · ${team.tag}` : ""}{mz ? ` · zone ${mz.w}×${mz.h} @ (${mz.x},${mz.y})` : " · no zone configured"}
                </div>
                <div className="text-mono text-xs text-muted-foreground">{fmt(time)} / {fmt(duration)}</div>
              </div>
              <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-black p-2">
                {!povUrl && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center p-4 text-center text-xs text-muted-foreground">
                    No POV VOD link for this team — add one in Matches → team VODs.
                  </div>
                )}
                <div
                  className="relative overflow-hidden border border-primary/40 bg-black"
                  style={{ aspectRatio: `${cropAspect}`, maxWidth: "100%", maxHeight: "100%", height: "100%", width: "auto" }}
                >
                  <video
                    ref={videoRef}
                    src={povUrl}
                    className="absolute top-0 h-full"
                    style={mz ? {
                      width: `${(SRC_W / mz.w) * 100}%`,
                      height: `${(SRC_H / mz.h) * 100}%`,
                      left: `${-(mz.x / mz.w) * 100}%`,
                      top: `${-(mz.y / mz.h) * 100}%`,
                      maxWidth: "none",
                    } : undefined}
                    playsInline
                    preload="metadata"
                    crossOrigin="anonymous"
                  />
                  {analyzing && (
                    <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1 rounded-sm bg-destructive/20 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-destructive">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" />
                      REC
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Full map with live track */}
            <div className="hud-panel relative flex min-h-0 flex-col overflow-hidden">
              <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5">
                <div className="label-eyebrow text-xs">Map · {map.name}</div>
                <div className="text-mono text-xs text-muted-foreground">{track.length} pt{track.length === 1 ? "" : "s"}</div>
              </div>
              <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-background p-2">
                <div className="relative" style={{ aspectRatio: "1 / 1", height: "100%", maxWidth: "100%" }}>
                  <img src={map.image} alt={map.name} className="absolute inset-0 h-full w-full object-contain" draggable={false} />
                  <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
                    {track.length >= 2 && (
                      <polyline
                        points={track.map((p) => `${p.x * 1000},${p.y * 1000}`).join(" ")}
                        fill="none"
                        stroke={team?.color ?? "#22d3a8"}
                        strokeWidth={2}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        opacity={0.85}
                      />
                    )}
                    {track.map((p, i) => (
                      <circle key={i} cx={p.x * 1000} cy={p.y * 1000}
                        r={i === track.length - 1 ? 7 : 3}
                        fill={team?.color ?? "#22d3a8"}
                        stroke="#000"
                        strokeWidth={i === track.length - 1 ? 2 : 1}
                        opacity={i === track.length - 1 ? 1 : 0.7}
                      />
                    ))}
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="shrink-0 border-t border-border bg-surface px-3 py-2">
            <div className="flex items-center gap-3">
              <button onClick={togglePlay} disabled={!povUrl} className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:brightness-110 disabled:opacity-40">
                {playing ? "Pause" : "Play"}
              </button>
              <span className="text-mono text-xs text-muted-foreground">{fmt(time)}</span>
              <input type="range" min={0} max={duration} step={0.05} value={time}
                onChange={(e) => seek(Number(e.target.value))} className="flex-1 accent-primary" />
              <span className="text-mono text-xs text-muted-foreground">{fmt(duration)}</span>
            </div>
          </div>
        </div>

        {/* Settings */}
        <aside className="w-80 shrink-0 overflow-auto border-l border-border bg-surface">
          <div className="border-b border-border px-4 py-3">
            <div className="label-eyebrow text-xs">Analysis settings</div>
          </div>
          <div className="space-y-4 p-4">
            <div>
              <div className="mb-1 flex items-baseline justify-between text-xs">
                <span className="text-muted-foreground uppercase tracking-wider">Skip frames</span>
                <span className="text-mono">{skipFrames}</span>
              </div>
              <input type="range" min={1} max={120} step={1} value={skipFrames}
                onChange={(e) => setSkipFrames(Number(e.target.value))} className="w-full accent-primary" />
              <div className="mt-1 text-xs text-muted-foreground">
                Sample once every {skipFrames} frame{skipFrames === 1 ? "" : "s"} (~{(skipFrames / FPS).toFixed(2)} s at {FPS}fps).
              </div>
            </div>

            <div className="border-t border-border pt-3">
              <div className="label-eyebrow mb-2 text-xs">Minimap zone (from Zones)</div>
              {mz ? (
                <div className="text-mono space-y-0.5 text-xs">
                  <div>x: {mz.x} · y: {mz.y}</div>
                  <div>w: {mz.w} · h: {mz.h}</div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  No minimap zone defined. Open Zones → VOD stream and add a zone with tag <span className="text-foreground">minimap</span>.
                </div>
              )}
            </div>

            <div className="border-t border-border pt-3">
              <div className="label-eyebrow mb-2 text-xs">Track ({track.length})</div>
              <div className="text-mono max-h-48 overflow-auto text-xs leading-5">
                {track.length === 0 && (
                  <div className="text-muted-foreground">Start analysis to plot points on the map.</div>
                )}
                {track.slice(-30).reverse().map((p, i) => (
                  <div key={i} className="flex justify-between text-muted-foreground">
                    <span>{fmt(p.t)}</span>
                    <span>{(p.x * 100).toFixed(1)}% · {(p.y * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }
function fmt(s: number) {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}