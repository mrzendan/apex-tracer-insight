import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  useAdminStore,
  addProcess,
  updateProcess,
  removeProcess,
  type AnalysisProcess,
  type ProcessPov,
  type MapTiming,
} from "@/lib/admin-store";
import { maps as allMaps } from "@/lib/mock-match";

export const Route = createFileRoute("/admin/processes")({ component: ProcessesAdmin });

const STATUS_COLORS: Record<AnalysisProcess["status"], string> = {
  draft: "bg-muted text-foreground/80",
  queued: "bg-primary/20 text-primary",
  running: "bg-warning/20 text-warning",
  done: "bg-success/20 text-success",
  failed: "bg-destructive/20 text-destructive",
};

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

const hhmmss = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
};
const parseHMS = (str: string): number | null => {
  const m = str.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = +(m[1] ?? 0), mm = +m[2], ss = +m[3];
  return h * 3600 + mm * 60 + ss;
};

/** Parse a typical ALGS-style stream title + description block. */
function parseAlgsTitle(text: string): {
  region?: string;
  tournamentName?: string;
  day?: string;
  matchup?: string;
  timings?: { label: string; sec: number }[];
} {
  const out: ReturnType<typeof parseAlgsTitle> = {};
  const region = text.match(/Region:\s*([^\n]+)/i)?.[1]?.trim();
  const tour = text.match(/Tournament:\s*([^\n]+)/i)?.[1]?.trim();
  const day = text.match(/Day:\s*([^\n]+)/i)?.[1]?.trim();
  const matchup = text.match(/Matchup:\s*([^\n]+)/i)?.[1]?.trim();
  if (region) out.region = region;
  if (tour) out.tournamentName = tour;
  if (day) out.day = day;
  if (matchup) out.matchup = matchup;

  // Fallback: parse from "ALGS Map POV - Americas - Split 1 - Americas Day 6 (Group B vs C) - May 3, 2026"
  if (!region || !tour) {
    const parts = text.split(/[-–]/).map((s) => s.trim());
    if (parts.length >= 4) {
      out.region ??= parts[1];
      out.tournamentName ??= `${parts[2]} - ${parts[1]}`;
      const dm = parts[3]?.match(/Day\s*(\d+)/i);
      if (dm) out.day ??= dm[1];
      const mm = text.match(/\(([^)]+)\)/);
      if (mm) out.matchup ??= mm[1];
    }
  }

  const timings: { label: string; sec: number }[] = [];
  const re = /(\d{1,2}:\d{2}:\d{2})\s*[-–]\s*([^\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const sec = parseHMS(m[1]);
    if (sec != null) timings.push({ label: m[2].trim(), sec });
  }
  if (timings.length) out.timings = timings;
  return out;
}

/** Mock metadata fetch — derives info from URL deterministically. */
function fetchVideoMeta(url: string): {
  title: string;
  channel: string;
  durationSec: number;
  tournamentHint?: string;
  matchHint?: string;
  maps?: MapTiming[];
  rawDescription?: string;
  region?: string;
  day?: string;
  matchup?: string;
} | null {
  if (!/^https?:\/\//i.test(url)) return null;
  const lower = url.toLowerCase();
  const tournamentHint = lower.includes("algs")
    ? "algs-2026-split-1"
    : lower.includes("esl")
      ? "esl-pro-league-12"
      : "scrims-eu-week-4";
  const guessMatch = (lower.match(/game[-_ ]?(\d+)/)?.[1] ?? "1");
  const mockDescription = `ALGS Map POV - Americas - Split 1 - Americas Day 6 (Group B vs C) - May 3, 2026

Region: Americas
Tournament: Split 1 - Americas
Day: 6
Matchup: Group B vs C

Timestamps:
00:00:00 - Pregame
00:06:57 - Game 1
00:34:17 - Game 2
01:08:30 - Game 3
01:46:45 - Game 4
02:13:04 - Game 5
02:41:27 - Game 6`;
  const parsed = parseAlgsTitle(mockDescription);
  const games = (parsed.timings ?? []).filter((t) => /game/i.test(t.label));
  const mapsParsed: MapTiming[] = games.map((g, i) => {
    const next = games[i + 1];
    const end = next ? next.sec : g.sec + 1500;
    return { mapId: allMaps[i % allMaps.length].id, startSec: g.sec, endSec: end };
  });
  return {
    title: mockDescription.split("\n")[0],
    channel: lower.includes("twitch") ? "Twitch · Official" : "YouTube · Caster",
    durationSec: 10800,
    tournamentHint,
    matchHint: `Game ${guessMatch}`,
    maps: mapsParsed.length ? mapsParsed : undefined,
    rawDescription: mockDescription,
    region: parsed.region,
    day: parsed.day,
    matchup: parsed.matchup,
  };
}

function ProcessesAdmin() {
  const { processes, matches, tournaments, teams } = useAdminStore();
  const [editing, setEditing] = useState<AnalysisProcess | null>(null);

  // Suggestions: matches whose tournament endDate is in the past and no process exists.
  const suggestions = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const analyzed = new Set(processes.map((p) => p.matchId));
    return matches.filter((m) => {
      if (analyzed.has(m.id)) return false;
      const t = tournaments.find((x) => x.id === m.tournamentId);
      return t ? t.endDate < today : false;
    });
  }, [processes, matches, tournaments]);

  const draft = (preset?: Partial<AnalysisProcess>) => {
    const tId = preset?.tournamentId ?? tournaments[0]?.id ?? "";
    const mId = preset?.matchId ?? matches.find((m) => m.tournamentId === tId)?.id ?? matches[0]?.id ?? "";
    setEditing({
      id: `p-${Date.now()}`,
      pov: "map",
      live: false,
      streamUrl: "",
      tournamentId: tId,
      matchId: mId,
      teamId: undefined,
      maps: [],
      status: "draft",
      createdAt: Date.now(),
      ...preset,
    });
  };

  const duplicate = editing
    ? processes.some((p) => p.matchId === editing.matchId && p.id !== editing.id && p.pov === editing.pov)
    : false;

  const save = (run: boolean) => {
    if (!editing) return;
    const exists = processes.some((p) => p.id === editing.id);
    const next: AnalysisProcess = { ...editing, status: run ? "queued" : editing.status };
    if (exists) updateProcess(editing.id, next);
    else addProcess(next);
    if (run) {
      // Simulate processing lifecycle
      setTimeout(() => updateProcess(next.id, { status: "running" }), 600);
      setTimeout(() => updateProcess(next.id, { status: "done" }), 3000);
    }
    setEditing(null);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
        <h1 className="text-sm font-bold uppercase tracking-wider">Processes</h1>
        <button
          onClick={() => draft()}
          className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:brightness-110"
        >
          + New process
        </button>
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {suggestions.length > 0 && (
          <section className="hud-panel p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="label-eyebrow">Suggested · finished without analysis</h2>
              <span className="text-mono text-[10px] text-muted-foreground">{suggestions.length}</span>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {suggestions.slice(0, 9).map((m) => {
                const t = tournaments.find((x) => x.id === m.tournamentId);
                return (
                  <button
                    key={m.id}
                    onClick={() => draft({ tournamentId: m.tournamentId, matchId: m.id })}
                    className="flex items-center justify-between rounded-sm border border-border bg-surface-2 px-3 py-2 text-left hover:border-primary/40"
                  >
                    <div>
                      <div className="text-xs font-semibold">{m.name}</div>
                      <div className="text-[10px] text-muted-foreground">{t?.name ?? m.tournamentId}</div>
                    </div>
                    <span className="text-mono text-[10px] text-primary">analyze →</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <section className="hud-panel overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-2">
              <tr className="label-eyebrow text-left text-[10px]">
                <th className="px-3 py-2">POV</th>
                <th className="px-3 py-2">Match</th>
                <th className="px-3 py-2">Tournament</th>
                <th className="px-3 py-2">Stream</th>
                <th className="px-3 py-2">Maps</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {processes.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-muted-foreground">No processes yet.</td></tr>
              )}
              {processes.map((p) => {
                const m = matches.find((x) => x.id === p.matchId);
                const t = tournaments.find((x) => x.id === p.tournamentId);
                return (
                  <tr key={p.id} className="border-b border-border">
                    <td className="px-3 py-2 text-xs">
                      <span className="rounded-sm border border-border bg-background px-1.5 py-0.5 text-mono uppercase">{p.pov} POV</span>
                      {p.live && <span className="ml-1 rounded-sm bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground">LIVE</span>}
                    </td>
                    <td className="px-3 py-2 text-xs font-semibold">{m?.name ?? p.matchId}</td>
                    <td className="px-3 py-2 text-xs">{t?.name ?? p.tournamentId}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[260px]" title={p.streamUrl}>{p.streamUrl || "—"}</td>
                    <td className="px-3 py-2 text-mono text-[10px]">{p.maps.length}</td>
                    <td className="px-3 py-2"><span className={`rounded-sm px-1.5 py-0.5 text-[10px] uppercase ${STATUS_COLORS[p.status]}`}>{p.status}</span></td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => setEditing({ ...p })} className="text-xs text-primary hover:underline mr-2">Edit</button>
                      <button onClick={() => { if (confirm("Delete process?")) removeProcess(p.id); }} className="text-xs text-destructive hover:underline">Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>

      {editing && (
        <ProcessEditor
          value={editing}
          duplicate={duplicate}
          tournaments={tournaments}
          matches={matches}
          teams={teams}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={() => save(false)}
          onRun={() => save(true)}
        />
      )}
    </div>
  );
}

function ProcessEditor({
  value, duplicate, tournaments, matches, teams, onChange, onClose, onSave, onRun,
}: {
  value: AnalysisProcess;
  duplicate: boolean;
  tournaments: ReturnType<typeof useAdminStore>["tournaments"];
  matches: ReturnType<typeof useAdminStore>["matches"];
  teams: ReturnType<typeof useAdminStore>["teams"];
  onChange: (p: AnalysisProcess) => void;
  onClose: () => void;
  onSave: () => void;
  onRun: () => void;
}) {
  const set = <K extends keyof AnalysisProcess>(k: K, v: AnalysisProcess[K]) =>
    onChange({ ...value, [k]: v });

  const fetchMeta = () => {
    const meta = fetchVideoMeta(value.streamUrl);
    if (!meta) {
      alert("Could not detect metadata from that URL");
      return;
    }
    const tournamentId = meta.tournamentHint && tournaments.some((t) => t.id === meta.tournamentHint)
      ? meta.tournamentHint
      : value.tournamentId;
    const matchByHint = meta.matchHint
      ? matches.find((m) => m.tournamentId === tournamentId && m.name.toLowerCase().includes(meta.matchHint!.toLowerCase()))
      : undefined;
    onChange({
      ...value,
      videoTitle: meta.title,
      videoChannel: meta.channel,
      videoDurationSec: meta.durationSec,
      tournamentId,
      matchId: matchByHint?.id ?? value.matchId,
      maps: meta.maps ?? value.maps,
    });
  };

  const matchOptions = matches.filter((m) => m.tournamentId === value.tournamentId);
  const povBtn = (pov: ProcessPov, label: string) => (
    <button
      onClick={() => set("pov", pov)}
      className={`flex-1 rounded-sm border px-3 py-2 text-xs font-semibold uppercase tracking-wider ${
        value.pov === pov ? "border-primary bg-primary/15 text-primary" : "border-border bg-background hover:bg-surface-2"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="hud-panel-strong w-full max-w-2xl max-h-[90vh] overflow-auto bg-surface p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wider">Analysis process</h3>
          <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <div className="space-y-4">
          <div>
            <div className="label-eyebrow mb-1.5 text-[10px]">Point of view</div>
            <div className="flex gap-2">
              {povBtn("map", "Map POV")}
              {povBtn("team", "Team POV")}
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs">
              <input type="checkbox" checked={value.live} onChange={(e) => set("live", e.target.checked)} />
              <span>LIVE — track stream in realtime</span>
              {value.live && <span className="rounded-sm bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground">LIVE</span>}
            </label>
          </div>

          <div>
            <div className="label-eyebrow mb-1.5 text-[10px]">Stream URL</div>
            <div className="flex gap-2">
              <input
                value={value.streamUrl}
                onChange={(e) => set("streamUrl", e.target.value)}
                onBlur={(e) => { if (e.target.value && !value.videoTitle) fetchMeta(); }}
                placeholder="https://twitch.tv/... or https://youtube.com/watch?v=..."
                className="flex-1 rounded-sm border border-border bg-background px-2 py-1.5 text-xs"
              />
              <button onClick={fetchMeta} className="rounded-sm border border-border bg-surface-2 px-3 py-1.5 text-xs hover:bg-muted">Fetch meta</button>
            </div>
            {value.videoTitle && (
              <div className="mt-1.5 rounded-sm border border-border bg-surface-2 px-2 py-1.5 text-[10px] text-muted-foreground">
                <div className="text-foreground">{value.videoTitle}</div>
                <div>{value.videoChannel} · {value.videoDurationSec ? mmss(value.videoDurationSec) : "—"}</div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="label-eyebrow mb-1.5 text-[10px]">Tournament</div>
              <select value={value.tournamentId} onChange={(e) => set("tournamentId", e.target.value)} className="w-full rounded-sm border border-border bg-background px-2 py-1.5 text-xs">
                {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <div className="label-eyebrow mb-1.5 text-[10px]">Match</div>
              <select value={value.matchId} onChange={(e) => set("matchId", e.target.value)} className="w-full rounded-sm border border-border bg-background px-2 py-1.5 text-xs">
                {matchOptions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                {matchOptions.length === 0 && <option value="">No matches in tournament</option>}
              </select>
            </div>
          </div>

          {value.pov === "team" && (
            <div>
              <div className="label-eyebrow mb-1.5 text-[10px]">Team</div>
              <select value={value.teamId ?? ""} onChange={(e) => set("teamId", e.target.value || undefined)} className="w-full rounded-sm border border-border bg-background px-2 py-1.5 text-xs">
                <option value="">— Select team —</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <div className="label-eyebrow text-[10px]">Map timings</div>
              <button
                onClick={() => onChange({ ...value, maps: [...value.maps, { mapId: allMaps[0].id, startSec: 0, endSec: 1200 }] })}
                className="text-xs text-primary hover:underline"
              >+ Add map</button>
            </div>
            <div className="space-y-1.5">
              {value.maps.length === 0 && <div className="text-[10px] text-muted-foreground">No maps configured. Fetch metadata or add manually.</div>}
              {value.maps.map((mp, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <select
                    value={mp.mapId}
                    onChange={(e) => onChange({ ...value, maps: value.maps.map((x, j) => j === i ? { ...x, mapId: e.target.value } : x) })}
                    className="flex-1 rounded-sm border border-border bg-background px-2 py-1 text-xs"
                  >
                    {allMaps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <input
                    type="number"
                    value={mp.startSec}
                    onChange={(e) => onChange({ ...value, maps: value.maps.map((x, j) => j === i ? { ...x, startSec: +e.target.value } : x) })}
                    className="w-20 rounded-sm border border-border bg-background px-2 py-1 text-xs text-mono"
                    placeholder="start s"
                  />
                  <input
                    type="number"
                    value={mp.endSec}
                    onChange={(e) => onChange({ ...value, maps: value.maps.map((x, j) => j === i ? { ...x, endSec: +e.target.value } : x) })}
                    className="w-20 rounded-sm border border-border bg-background px-2 py-1 text-xs text-mono"
                    placeholder="end s"
                  />
                  <button onClick={() => onChange({ ...value, maps: value.maps.filter((_, j) => j !== i) })} className="text-xs text-destructive">✕</button>
                </div>
              ))}
            </div>
          </div>

          {duplicate && (
            <div className="rounded-sm border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              ⚠ A {value.pov.toUpperCase()} POV process already exists for this match.
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-sm border border-border bg-surface-2 px-3 py-1.5 text-xs hover:bg-muted">Cancel</button>
          <button onClick={onSave} className="rounded-sm border border-border bg-background px-3 py-1.5 text-xs hover:bg-surface-2">Save draft</button>
          <button onClick={onRun} disabled={!value.matchId || !value.streamUrl} className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:brightness-110 disabled:opacity-40">
            ▶ Run analysis
          </button>
        </div>
      </div>
    </div>
  );
}