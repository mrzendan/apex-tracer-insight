import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

export const Route = createFileRoute("/admin/schema")({ component: SchemaEditor });

// ------------------------------ Types ------------------------------
type FieldType = "uuid" | "text" | "int" | "float" | "bool" | "timestamp" | "enum" | "jsonb";
type Field = { id: string; name: string; type: FieldType; pk?: boolean; nullable?: boolean };
type Block = { id: string; name: string; x: number; y: number; fields: Field[] };
type RelKind = "1-1" | "1-N" | "N-M";
type Relation = { id: string; fromBlock: string; fromField: string; toBlock: string; toField: string; kind: RelKind };
type SchemaDoc = { blocks: Block[]; relations: Relation[] };

const STORAGE_KEY = "apex-stats:schema-v1";
const PREFS_KEY = "apex-stats:schema-prefs-v1";
type ArrowStyle = "triangle" | "crowfoot" | "circle" | "diamond" | "none";
type Theme = "color" | "mono";
type Prefs = { theme: Theme; arrow: ArrowStyle };
const defaultPrefs: Prefs = { theme: "color", arrow: "crowfoot" };
function loadPrefs(): Prefs {
  if (typeof window === "undefined") return defaultPrefs;
  try { const r = localStorage.getItem(PREFS_KEY); return r ? { ...defaultPrefs, ...JSON.parse(r) } : defaultPrefs; }
  catch { return defaultPrefs; }
}
const uid = (p = "id") => `${p}_${Math.random().toString(36).slice(2, 9)}`;

// ------------------------------ Seed (proposed schema) ------------------------------
function seed(): SchemaDoc {
  const b = (name: string, x: number, y: number, fields: [string, FieldType, boolean?][]): Block => ({
    id: uid("b"),
    name,
    x,
    y,
    fields: fields.map(([n, t, pk]) => ({ id: uid("f"), name: n, type: t, pk })),
  });
  const tournaments = b("tournaments", 40, 40, [
    ["id", "uuid", true], ["name", "text"], ["start_date", "timestamp"], ["end_date", "timestamp"],
    ["year", "int"], ["type", "enum"], ["region", "enum"],
  ]);
  const matches = b("matches", 360, 40, [
    ["id", "uuid", true], ["tournament_id", "uuid"], ["name", "text"],
    ["day", "int"], ["matchup", "text"], ["video_title", "text"], ["vod_link", "text"],
  ]);
  const match_maps = b("match_maps", 700, 40, [
    ["id", "uuid", true], ["match_id", "uuid"], ["map_id", "uuid"],
    ["ordinal", "int"], ["start_offset_sec", "int"], ["duration_sec", "int"],
  ]);
  const maps = b("maps", 1040, 40, [
    ["id", "uuid", true], ["name", "text"], ["image_url", "text"],
  ]);
  const teams = b("teams", 40, 320, [
    ["id", "uuid", true], ["tag", "text"], ["name", "text"], ["color", "text"], ["logo_url", "text"],
  ]);
  const players = b("players", 40, 580, [
    ["id", "uuid", true], ["team_id", "uuid"], ["handle", "text"],
  ]);
  const match_teams = b("match_teams", 360, 320, [
    ["match_id", "uuid", true], ["team_id", "uuid", true], ["group_label", "text"],
  ]);
  const team_vods = b("team_vods", 360, 540, [
    ["match_id", "uuid", true], ["team_id", "uuid", true], ["url", "text"],
  ]);
  const map_results = b("map_results", 700, 320, [
    ["id", "uuid", true], ["match_map_id", "uuid"], ["team_id", "uuid"],
    ["placement", "int"], ["kills", "int"],
  ]);
  const processes = b("processes", 1040, 320, [
    ["id", "uuid", true], ["match_map_id", "uuid"], ["kind", "enum"],
    ["status", "enum"], ["progress", "int"], ["params", "jsonb"], ["result", "jsonb"],
  ]);
  const ring_events = b("ring_events", 700, 580, [
    ["id", "uuid", true], ["match_map_id", "uuid"], ["phase", "int"],
    ["start_sec", "int"], ["end_sec", "int"], ["center_x", "float"], ["center_y", "float"], ["radius", "float"],
  ]);
  const camera_events = b("camera_events", 1040, 580, [
    ["id", "uuid", true], ["match_map_id", "uuid"], ["t_sec", "int"],
    ["target_team_id", "uuid"], ["target_player", "text"],
  ]);
  const users = b("users", 1380, 40, [
    ["id", "uuid", true], ["email", "text"], ["created_at", "timestamp"],
  ]);
  const user_roles = b("user_roles", 1380, 240, [
    ["id", "uuid", true], ["user_id", "uuid"], ["role", "enum"],
  ]);

  const blocks = [
    tournaments, matches, match_maps, maps, teams, players, match_teams,
    team_vods, map_results, processes, ring_events, camera_events, users, user_roles,
  ];
  const F = (b: Block, n: string) => b.fields.find((f) => f.name === n)!.id;
  const rel = (from: Block, ff: string, to: Block, tf: string, kind: RelKind): Relation => ({
    id: uid("r"), fromBlock: from.id, fromField: F(from, ff), toBlock: to.id, toField: F(to, tf), kind,
  });
  const relations: Relation[] = [
    rel(matches, "tournament_id", tournaments, "id", "1-N"),
    rel(match_maps, "match_id", matches, "id", "1-N"),
    rel(match_maps, "map_id", maps, "id", "1-N"),
    rel(players, "team_id", teams, "id", "1-N"),
    rel(match_teams, "match_id", matches, "id", "N-M"),
    rel(match_teams, "team_id", teams, "id", "N-M"),
    rel(team_vods, "match_id", matches, "id", "N-M"),
    rel(team_vods, "team_id", teams, "id", "N-M"),
    rel(map_results, "match_map_id", match_maps, "id", "1-N"),
    rel(map_results, "team_id", teams, "id", "1-N"),
    rel(processes, "match_map_id", match_maps, "id", "1-N"),
    rel(ring_events, "match_map_id", match_maps, "id", "1-N"),
    rel(camera_events, "match_map_id", match_maps, "id", "1-N"),
    rel(camera_events, "target_team_id", teams, "id", "1-N"),
    rel(user_roles, "user_id", users, "id", "1-N"),
  ];
  return { blocks, relations };
}

function load(): SchemaDoc {
  if (typeof window === "undefined") return seed();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seed();
    return JSON.parse(raw) as SchemaDoc;
  } catch {
    return seed();
  }
}

// ------------------------------ Geometry ------------------------------
const BLOCK_W = 240;
const HEAD_H = 30;
const ROW_H = 22;
function blockHeight(b: Block) { return HEAD_H + b.fields.length * ROW_H + 8; }
function fieldAnchor(b: Block, fieldId: string, side: "left" | "right") {
  const idx = b.fields.findIndex((f) => f.id === fieldId);
  const y = b.y + HEAD_H + idx * ROW_H + ROW_H / 2;
  const x = side === "right" ? b.x + BLOCK_W : b.x;
  return { x, y };
}

// ------------------------------ Component ------------------------------
function SchemaEditor() {
  const [doc, setDoc] = useState<SchemaDoc>(load);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [selected, setSelected] = useState<{ blockId: string; fieldId?: string } | null>(null);
  const [selectedRel, setSelectedRel] = useState<string | null>(null);
  const [connect, setConnect] = useState<{ blockId: string; fieldId: string } | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const dragRef = useRef<{ blockId: string; ox: number; oy: number } | null>(null);
  const panRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(doc)); }, [doc]);
  useEffect(() => { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }, [prefs]);

  const mono = prefs.theme === "mono";
  const strokeColor = mono ? "var(--foreground)" : "var(--primary)";
  const strokeColorSoft = mono
    ? "color-mix(in oklab, var(--foreground) 55%, transparent)"
    : "color-mix(in oklab, var(--primary) 55%, transparent)";
  const headFill = mono ? "var(--surface-2)" : "color-mix(in oklab, var(--primary) 15%, transparent)";
  const rowSelFill = mono ? "color-mix(in oklab, var(--foreground) 10%, transparent)" : "color-mix(in oklab, var(--primary) 10%, transparent)";
  const accentSoft = mono ? "var(--foreground)" : "var(--accent)";

  const mutate = (fn: (d: SchemaDoc) => SchemaDoc) => setDoc((d) => fn(structuredClone(d)));

  const addBlock = () => {
    const id = uid("b");
    mutate((d) => {
      d.blocks.push({ id, name: "new_table", x: -pan.x / zoom + 60, y: -pan.y / zoom + 60, fields: [{ id: uid("f"), name: "id", type: "uuid", pk: true }] });
      return d;
    });
    setSelected({ blockId: id });
  };
  const deleteBlock = (id: string) => mutate((d) => {
    d.blocks = d.blocks.filter((b) => b.id !== id);
    d.relations = d.relations.filter((r) => r.fromBlock !== id && r.toBlock !== id);
    return d;
  });
  const renameBlock = (id: string, name: string) => mutate((d) => { const b = d.blocks.find((x) => x.id === id); if (b) b.name = name; return d; });
  const addField = (blockId: string) => mutate((d) => {
    const b = d.blocks.find((x) => x.id === blockId); if (!b) return d;
    b.fields.push({ id: uid("f"), name: "new_field", type: "text" });
    return d;
  });
  const removeField = (blockId: string, fieldId: string) => mutate((d) => {
    const b = d.blocks.find((x) => x.id === blockId); if (!b) return d;
    b.fields = b.fields.filter((f) => f.id !== fieldId);
    d.relations = d.relations.filter((r) => !(r.fromField === fieldId || r.toField === fieldId));
    return d;
  });
  const renameField = (blockId: string, fieldId: string, name: string) => mutate((d) => {
    const f = d.blocks.find((x) => x.id === blockId)?.fields.find((y) => y.id === fieldId);
    if (f) f.name = name; return d;
  });
  const setFieldType = (blockId: string, fieldId: string, type: FieldType) => mutate((d) => {
    const f = d.blocks.find((x) => x.id === blockId)?.fields.find((y) => y.id === fieldId);
    if (f) f.type = type; return d;
  });
  const togglePk = (blockId: string, fieldId: string) => mutate((d) => {
    const f = d.blocks.find((x) => x.id === blockId)?.fields.find((y) => y.id === fieldId);
    if (f) f.pk = !f.pk; return d;
  });
  const setRelKind = (relId: string, kind: RelKind) => mutate((d) => { const r = d.relations.find((x) => x.id === relId); if (r) r.kind = kind; return d; });
  const deleteRel = (relId: string) => mutate((d) => { d.relations = d.relations.filter((r) => r.id !== relId); return d; });

  // Drag a block
  const onBlockMouseDown = (e: React.MouseEvent, b: Block) => {
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    e.stopPropagation();
    setSelected({ blockId: b.id });
    const pt = svgPoint(e);
    dragRef.current = { blockId: b.id, ox: pt.x - b.x, oy: pt.y - b.y };
  };
  // Pan canvas
  const onCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as Element).closest("[data-block]")) return;
    setSelected(null);
    setSelectedRel(null);
    panRef.current = { sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y };
  };
  const svgPoint = (e: React.MouseEvent): { x: number; y: number } => {
    const svg = svgRef.current; if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return { x: (e.clientX - rect.left - pan.x) / zoom, y: (e.clientY - rect.top - pan.y) / zoom };
  };
  const onMove = (e: React.MouseEvent) => {
    if (dragRef.current) {
      const pt = svgPoint(e);
      const { blockId, ox, oy } = dragRef.current;
      setDoc((d) => {
        const next = { ...d, blocks: d.blocks.map((b) => b.id === blockId ? { ...b, x: pt.x - ox, y: pt.y - oy } : b) };
        return next;
      });
    } else if (panRef.current) {
      setPan({ x: panRef.current.ox + (e.clientX - panRef.current.sx), y: panRef.current.oy + (e.clientY - panRef.current.sy) });
    }
  };
  const onUp = () => { dragRef.current = null; panRef.current = null; };
  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const next = Math.max(0.4, Math.min(2, zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    setZoom(next);
  };

  // Connect mode
  const startConnect = (blockId: string, fieldId: string) => setConnect({ blockId, fieldId });
  const completeConnect = (blockId: string, fieldId: string) => {
    if (!connect) return;
    if (connect.blockId === blockId && connect.fieldId === fieldId) { setConnect(null); return; }
    mutate((d) => {
      d.relations.push({ id: uid("r"), fromBlock: connect.blockId, fromField: connect.fieldId, toBlock: blockId, toField: fieldId, kind: "1-N" });
      return d;
    });
    setConnect(null);
  };

  const blocksById = useMemo(() => Object.fromEntries(doc.blocks.map((b) => [b.id, b] as const)), [doc.blocks]);
  const selBlock = selected ? blocksById[selected.blockId] : undefined;
  const selField = selBlock && selected?.fieldId ? selBlock.fields.find((f) => f.id === selected.fieldId) : undefined;
  const selRel = selectedRel ? doc.relations.find((r) => r.id === selectedRel) : undefined;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <h1 className="text-sm font-bold uppercase tracking-wider">Schema editor</h1>
        <span className="text-mono text-[10px] text-muted-foreground">{doc.blocks.length} tables · {doc.relations.length} relations</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-sm border border-border bg-surface-2 p-0.5">
            {(["color", "mono"] as Theme[]).map((t) => (
              <button key={t} onClick={() => setPrefs((p) => ({ ...p, theme: t }))}
                className={`px-2 py-0.5 text-[10px] uppercase tracking-wider rounded-sm ${prefs.theme === t ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                {t === "color" ? "Color" : "B/W"}
              </button>
            ))}
          </div>
          <select value={prefs.arrow} onChange={(e) => setPrefs((p) => ({ ...p, arrow: e.target.value as ArrowStyle }))}
            className="rounded-sm border border-border bg-surface-2 px-2 py-1 text-[10px] uppercase tracking-wider">
            <option value="triangle">▶ Triangle</option>
            <option value="crowfoot">⋈ Crow's foot</option>
            <option value="circle">● Circle</option>
            <option value="diamond">◆ Diamond</option>
            <option value="none">— None</option>
          </select>
          <button onClick={addBlock} className="rounded-sm border border-primary/40 bg-primary/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-primary hover:bg-primary/25">+ Table</button>
          <button onClick={() => { setDoc(seed()); setSelected(null); setSelectedRel(null); }} className="rounded-sm border border-border bg-surface-2 px-2 py-1 text-[10px] uppercase tracking-wider hover:bg-muted">Reset to proposed</button>
          <div className="text-mono ml-2 text-[10px] text-muted-foreground">zoom {(zoom * 100).toFixed(0)}%</div>
          <button onClick={() => setZoom((z) => Math.min(2, z * 1.1))} className="rounded-sm border border-border bg-surface-2 px-2 py-1 text-[10px] hover:bg-muted">+</button>
          <button onClick={() => setZoom((z) => Math.max(0.4, z * 0.9))} className="rounded-sm border border-border bg-surface-2 px-2 py-1 text-[10px] hover:bg-muted">−</button>
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="rounded-sm border border-border bg-surface-2 px-2 py-1 text-[10px] hover:bg-muted">Fit</button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Canvas */}
        <div className="relative min-w-0 flex-1 overflow-hidden bg-background" onWheel={onWheel}>
          <svg
            ref={svgRef}
            className="block h-full w-full"
            style={{ background: "repeating-linear-gradient(0deg, transparent 0 23px, color-mix(in oklab, var(--border) 60%, transparent) 23px 24px), repeating-linear-gradient(90deg, transparent 0 23px, color-mix(in oklab, var(--border) 60%, transparent) 23px 24px)" }}
            onMouseDown={onCanvasMouseDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={onUp}
          >
            <defs>
              <marker id="ep-triangle" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill={strokeColor} />
              </marker>
              <marker id="ep-crowfoot" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
                <path d="M0,1 L11,6 L0,11 M6,1 L11,6 L6,11" fill="none" stroke={strokeColor} strokeWidth="1.5" />
              </marker>
              <marker id="ep-circle" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <circle cx="5" cy="5" r="4" fill="none" stroke={strokeColor} strokeWidth="1.5" />
              </marker>
              <marker id="ep-diamond" viewBox="0 0 12 10" refX="11" refY="5" markerWidth="8" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,5 L6,0 L12,5 L6,10 z" fill="none" stroke={strokeColor} strokeWidth="1.5" />
              </marker>
            </defs>

            <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
              {/* Relations */}
              {doc.relations.map((r) => {
                const fb = blocksById[r.fromBlock]; const tb = blocksById[r.toBlock];
                if (!fb || !tb) return null;
                const fromRight = (fb.x + BLOCK_W / 2) < (tb.x + BLOCK_W / 2);
                const a = fieldAnchor(fb, r.fromField, fromRight ? "right" : "left");
                const b2 = fieldAnchor(tb, r.toField, fromRight ? "left" : "right");
                const dx = Math.max(40, Math.abs(b2.x - a.x) / 2);
                const c1x = a.x + (fromRight ? dx : -dx);
                const c2x = b2.x + (fromRight ? -dx : dx);
                const d = `M${a.x},${a.y} C${c1x},${a.y} ${c2x},${b2.y} ${b2.x},${b2.y}`;
                const isSel = selectedRel === r.id;
                const endId = prefs.arrow === "none" ? undefined : `url(#ep-${prefs.arrow})`;
                const startId = r.kind === "N-M" && prefs.arrow !== "none" ? `url(#ep-${prefs.arrow})` : undefined;
                return (
                  <g key={r.id} className="cursor-pointer" onClick={(e) => { e.stopPropagation(); setSelectedRel(r.id); setSelected(null); }}>
                    <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
                    <path d={d} fill="none" stroke={isSel ? strokeColor : strokeColorSoft} strokeWidth={isSel ? 2 : 1.5}
                      markerEnd={endId}
                      markerStart={startId}
                    />
                    <text x={(a.x + b2.x) / 2} y={(a.y + b2.y) / 2 - 4} textAnchor="middle" className="text-mono" fontSize={10} fill="var(--muted-foreground)">{r.kind}</text>
                  </g>
                );
              })}

              {/* Pending connect preview */}
              {connect && (() => {
                const fb = blocksById[connect.blockId]; if (!fb) return null;
                const a = fieldAnchor(fb, connect.fieldId, "right");
                return <circle cx={a.x} cy={a.y} r={6} fill={strokeColor} />;
              })()}

              {/* Blocks */}
              {doc.blocks.map((b) => {
                const isSel = selected?.blockId === b.id;
                return (
                  <g key={b.id} data-block transform={`translate(${b.x} ${b.y})`} onMouseDown={(e) => onBlockMouseDown(e, b)}>
                    <rect width={BLOCK_W} height={blockHeight(b)} rx={6} className="fill-surface" stroke={isSel ? strokeColor : "var(--border)"} strokeWidth={isSel ? 1.5 : 1} />
                    <rect width={BLOCK_W} height={HEAD_H} rx={6} fill={isSel ? headFill : "var(--surface-2)"} />
                    <text x={10} y={20} className="font-mono" fontSize={12} fontWeight={700} fill="var(--foreground)">{b.name}</text>
                    <text x={BLOCK_W - 10} y={20} textAnchor="end" fontSize={9} fill="var(--muted-foreground)">{b.fields.length}</text>
                    {b.fields.map((f, i) => {
                      const y = HEAD_H + i * ROW_H;
                      const fSel = isSel && selected?.fieldId === f.id;
                      return (
                        <g key={f.id} onClick={(e) => { e.stopPropagation(); setSelected({ blockId: b.id, fieldId: f.id }); setSelectedRel(null); }}>
                          <rect x={1} y={y} width={BLOCK_W - 2} height={ROW_H} fill={fSel ? rowSelFill : "transparent"} />
                          <circle cx={0} cy={y + ROW_H / 2} r={4} fill={connect ? accentSoft : "var(--border)"} stroke="var(--surface)" strokeWidth={1}
                            data-no-drag
                            style={{ cursor: "crosshair" }}
                            onMouseDown={(e) => { e.stopPropagation(); if (connect) { completeConnect(b.id, f.id); } else { startConnect(b.id, f.id); } }}
                          />
                          <circle cx={BLOCK_W} cy={y + ROW_H / 2} r={4} fill={connect ? accentSoft : "var(--border)"} stroke="var(--surface)" strokeWidth={1}
                            data-no-drag
                            style={{ cursor: "crosshair" }}
                            onMouseDown={(e) => { e.stopPropagation(); if (connect) { completeConnect(b.id, f.id); } else { startConnect(b.id, f.id); } }}
                          />
                          <text x={10} y={y + 15} fontSize={11} className="font-mono" fill="var(--foreground)">
                            {f.pk ? "★ " : ""}{f.name}
                          </text>
                          <text x={BLOCK_W - 10} y={y + 15} textAnchor="end" fontSize={10} className="font-mono" fill="var(--muted-foreground)">{f.type}</text>
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            </g>
          </svg>

          {connect && (
            <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-sm border border-primary/40 bg-primary/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
              Click another field's port to connect · <button className="underline" onClick={() => setConnect(null)}>cancel</button>
            </div>
          )}
        </div>

        {/* Inspector */}
        <aside className="flex w-[300px] shrink-0 flex-col border-l border-border bg-surface">
          <div className="label-eyebrow border-b border-border px-3 py-2 text-[10px]">Inspector</div>
          <div className="flex-1 overflow-y-auto p-3 text-xs">
            {!selected && !selRel && <div className="text-muted-foreground">Select a table, field, or relation.</div>}

            {selRel && (
              <div className="space-y-2">
                <div className="label-eyebrow text-[10px]">Relation</div>
                <div className="text-mono rounded-sm border border-border bg-background p-2 text-[10px]">
                  {blocksById[selRel.fromBlock]?.name}.{blocksById[selRel.fromBlock]?.fields.find((f) => f.id === selRel.fromField)?.name}
                  <br />→ {blocksById[selRel.toBlock]?.name}.{blocksById[selRel.toBlock]?.fields.find((f) => f.id === selRel.toField)?.name}
                </div>
                <div className="flex gap-1">
                  {(["1-1", "1-N", "N-M"] as RelKind[]).map((k) => (
                    <button key={k} onClick={() => setRelKind(selRel.id, k)}
                      className={`flex-1 rounded-sm border px-2 py-1 text-[10px] ${selRel.kind === k ? "border-primary/40 bg-primary/15 text-primary" : "border-border bg-background hover:bg-muted"}`}>{k}</button>
                  ))}
                </div>
                <button onClick={() => { deleteRel(selRel.id); setSelectedRel(null); }} className="w-full rounded-sm border border-destructive/40 bg-destructive/10 px-2 py-1 text-[10px] uppercase text-destructive hover:bg-destructive/20">Delete relation</button>
              </div>
            )}

            {selBlock && (
              <div className="space-y-3">
                <div>
                  <div className="label-eyebrow mb-1 text-[10px]">Table</div>
                  <input value={selBlock.name} onChange={(e) => renameBlock(selBlock.id, e.target.value)} className="w-full rounded-sm border border-border bg-background px-2 py-1 font-mono text-xs" />
                </div>
                <div>
                  <div className="label-eyebrow mb-1 flex items-center justify-between text-[10px]">
                    <span>Fields ({selBlock.fields.length})</span>
                    <button onClick={() => addField(selBlock.id)} className="rounded-sm border border-border bg-background px-1.5 py-0.5 text-[10px] hover:bg-muted">+ field</button>
                  </div>
                  <ul className="space-y-1">
                    {selBlock.fields.map((f) => {
                      const isSel = selected?.fieldId === f.id;
                      return (
                        <li key={f.id} className={`rounded-sm border p-1.5 ${isSel ? "border-primary/40 bg-primary/5" : "border-border bg-background"}`} onClick={() => setSelected({ blockId: selBlock.id, fieldId: f.id })}>
                          <div className="flex items-center gap-1">
                            <button onClick={(e) => { e.stopPropagation(); togglePk(selBlock.id, f.id); }} title="Primary key" className={`text-mono w-5 rounded-sm border px-1 py-0.5 text-[10px] ${f.pk ? "border-primary/40 bg-primary/15 text-primary" : "border-border bg-surface-2 text-muted-foreground"}`}>★</button>
                            <input value={f.name} onChange={(e) => renameField(selBlock.id, f.id, e.target.value)} className="min-w-0 flex-1 rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]" />
                            <select value={f.type} onChange={(e) => setFieldType(selBlock.id, f.id, e.target.value as FieldType)} className="rounded-sm border border-border bg-surface-2 px-1 py-0.5 font-mono text-[10px]">
                              {(["uuid", "text", "int", "float", "bool", "timestamp", "enum", "jsonb"] as FieldType[]).map((t) => <option key={t}>{t}</option>)}
                            </select>
                            <button onClick={(e) => { e.stopPropagation(); removeField(selBlock.id, f.id); }} className="rounded-sm border border-destructive/40 bg-destructive/10 px-1 py-0.5 text-[10px] text-destructive hover:bg-destructive/20">×</button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => deleteBlock(selBlock.id)} className="flex-1 rounded-sm border border-destructive/40 bg-destructive/10 px-2 py-1 text-[10px] uppercase text-destructive hover:bg-destructive/20">Delete table</button>
                </div>
                {selField && (
                  <div className="rounded-sm border border-border bg-background p-2 text-[10px] text-muted-foreground">
                    Tip: drag from the port (●) on a field row to connect to another field.
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="border-t border-border p-2 text-[10px] text-muted-foreground">
            Drag canvas to pan · Ctrl/⌘+wheel to zoom · drag table header to move · click a port (●) then another to connect.
          </div>
        </aside>
      </div>
    </div>
  );
}