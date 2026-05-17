import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

export const Route = createFileRoute("/admin/diagrams")({ component: DiagramsPage });

// ------------------------------ Types ------------------------------
type NodeKind = "start" | "process" | "decision" | "data" | "io" | "end";
type FlowNode = { id: string; label: string; kind: NodeKind; x: number; y: number; w?: number; h?: number };
type FlowEdge = { id: string; from: string; to: string; label?: string };
type Flow = { id: string; name: string; description: string; nodes: FlowNode[]; edges: FlowEdge[] };

const STORAGE_KEY = "apex-stats:diagrams-v1";
const PREFS_KEY = "apex-stats:diagrams-prefs-v1";

type ArrowStyle = "triangle" | "open" | "circle" | "diamond" | "none";
type Theme = "color" | "mono";
type Prefs = { theme: Theme; arrow: ArrowStyle; current: string };
const defaultPrefs: Prefs = { theme: "color", arrow: "triangle", current: "ingestion" };

const uid = (p = "id") => `${p}_${Math.random().toString(36).slice(2, 9)}`;

// ------------------------------ Seed presets ------------------------------
function seed(): Flow[] {
  const node = (id: string, label: string, kind: NodeKind, x: number, y: number, w = 200, h = 64): FlowNode =>
    ({ id, label, kind, x, y, w, h });
  const edge = (from: string, to: string, label?: string): FlowEdge => ({ id: uid("e"), from, to, label });

  const ingestion: Flow = {
    id: "ingestion",
    name: "Data ingestion pipeline",
    description: "VOD source → frames → HUD detection → match_maps writes.",
    nodes: [
      node("src", "VOD source\n(Twitch / YouTube / local)", "io", 40, 40, 220),
      node("dl", "Stream / download", "process", 40, 160),
      node("split", "Map split\nstart/end markers", "process", 40, 280),
      node("frames", "Frame sampler", "process", 320, 280),
      node("hud", "HUD detection\n(zones, OCR)", "process", 600, 280),
      node("dec", "Match valid?", "decision", 600, 420, 200, 80),
      node("ok", "Persist match_maps", "data", 880, 420),
      node("err", "Mark process failed", "end", 880, 540),
    ],
    edges: [
      edge("src", "dl"),
      edge("dl", "split"),
      edge("split", "frames"),
      edge("frames", "hud"),
      edge("hud", "dec"),
      edge("dec", "ok", "yes"),
      edge("dec", "err", "no"),
    ],
  };

  const analysis: Flow = {
    id: "analysis",
    name: "Match analysis flow",
    description: "Per-map enrichment: minimap, ring, camera, team detection.",
    nodes: [
      node("mm", "match_map ready", "start", 40, 40),
      node("para", "Spawn parallel\nworkers", "process", 40, 160),
      node("mini", "Minimap track\n(homography)", "process", 320, 60),
      node("ring", "Ring detector", "process", 320, 160),
      node("cam", "Camera target", "process", 320, 260),
      node("team", "Team / HSV\nclassifier", "process", 320, 360),
      node("merge", "Merge results", "process", 620, 200),
      node("write", "Write events\n(ring/camera/result)", "data", 880, 200),
      node("done", "process: done", "end", 880, 320),
    ],
    edges: [
      edge("mm", "para"),
      edge("para", "mini"),
      edge("para", "ring"),
      edge("para", "cam"),
      edge("para", "team"),
      edge("mini", "merge"),
      edge("ring", "merge"),
      edge("cam", "merge"),
      edge("team", "merge"),
      edge("merge", "write"),
      edge("write", "done"),
    ],
  };

  const auth: Flow = {
    id: "auth",
    name: "Auth & audit flow",
    description: "Admin sign-in, role lookup, audited mutations.",
    nodes: [
      node("login", "Admin sign-in", "start", 40, 40),
      node("ses", "Create auth_session", "process", 40, 160),
      node("role", "Lookup user_roles", "process", 40, 280),
      node("dec", "Has role?", "decision", 320, 280, 200, 80),
      node("ui", "Open admin UI", "process", 600, 200),
      node("act", "Mutate entity", "process", 600, 340),
      node("aud", "Write audit_log", "data", 880, 340),
      node("deny", "Reject 403", "end", 320, 440),
    ],
    edges: [
      edge("login", "ses"),
      edge("ses", "role"),
      edge("role", "dec"),
      edge("dec", "ui", "yes"),
      edge("dec", "deny", "no"),
      edge("ui", "act"),
      edge("act", "aud"),
    ],
  };

  const viewer: Flow = {
    id: "viewer",
    name: "Viewer playback",
    description: "Client loads match → fetches events → renders sync overlays.",
    nodes: [
      node("open", "User opens /matches/:id", "start", 40, 40),
      node("meta", "Fetch match\n+ match_maps", "data", 40, 160),
      node("vod", "Resolve VOD source", "process", 40, 280),
      node("evts", "Fetch ring & camera\nevents", "data", 320, 160),
      node("zones", "Fetch map_zones\n+ polygons", "data", 320, 280),
      node("render", "Render minimap\n+ HUD overlays", "process", 620, 220),
      node("sync", "Sync to playhead", "process", 880, 220),
      node("ui", "Interactive viewer", "end", 880, 340),
    ],
    edges: [
      edge("open", "meta"),
      edge("meta", "vod"),
      edge("meta", "evts"),
      edge("meta", "zones"),
      edge("vod", "render"),
      edge("evts", "render"),
      edge("zones", "render"),
      edge("render", "sync"),
      edge("sync", "ui"),
    ],
  };

  return [ingestion, analysis, auth, viewer];
}

function loadFlows(): Flow[] {
  if (typeof window === "undefined") return seed();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seed();
    return JSON.parse(raw) as Flow[];
  } catch { return seed(); }
}
function loadPrefs(): Prefs {
  if (typeof window === "undefined") return defaultPrefs;
  try { const r = localStorage.getItem(PREFS_KEY); return r ? { ...defaultPrefs, ...JSON.parse(r) } : defaultPrefs; }
  catch { return defaultPrefs; }
}

// ------------------------------ Geometry ------------------------------
function nodeRect(n: FlowNode) { return { w: n.w ?? 200, h: n.h ?? 64 }; }
function nodeCenter(n: FlowNode) { const { w, h } = nodeRect(n); return { cx: n.x + w / 2, cy: n.y + h / 2 }; }
function edgePath(a: FlowNode, b: FlowNode) {
  const A = nodeCenter(a); const B = nodeCenter(b);
  const ra = nodeRect(a); const rb = nodeRect(b);
  // pick exit/entry side based on dominant direction
  const dx = B.cx - A.cx; const dy = B.cy - A.cy;
  const horizontal = Math.abs(dx) > Math.abs(dy);
  let ax: number, ay: number, bx: number, by: number;
  if (horizontal) {
    ax = dx > 0 ? a.x + ra.w : a.x; ay = A.cy;
    bx = dx > 0 ? b.x : b.x + rb.w; by = B.cy;
  } else {
    ax = A.cx; ay = dy > 0 ? a.y + ra.h : a.y;
    bx = B.cx; by = dy > 0 ? b.y : b.y + rb.h;
  }
  const c1x = horizontal ? (ax + bx) / 2 : ax;
  const c1y = horizontal ? ay : (ay + by) / 2;
  const c2x = horizontal ? (ax + bx) / 2 : bx;
  const c2y = horizontal ? by : (ay + by) / 2;
  return { d: `M${ax},${ay} C${c1x},${c1y} ${c2x},${c2y} ${bx},${by}`, mx: (ax + bx) / 2, my: (ay + by) / 2 };
}

// ------------------------------ Component ------------------------------
function DiagramsPage() {
  const [flows, setFlows] = useState<Flow[]>(loadFlows);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [selected, setSelected] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 20, y: 20 });
  const [zoom, setZoom] = useState(1);
  const dragRef = useRef<{ id: string; ox: number; oy: number } | null>(null);
  const panRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(flows)); }, [flows]);
  useEffect(() => { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }, [prefs]);

  const flow = flows.find((f) => f.id === prefs.current) ?? flows[0];
  const mono = prefs.theme === "mono";
  const m = {
    canvasBg: mono ? "#ffffff" : "var(--background)",
    gridColor: mono ? "rgba(0,0,0,0.08)" : "color-mix(in oklab, var(--border) 60%, transparent)",
    ink: mono ? "#000000" : "var(--foreground)",
    inkSoft: mono ? "rgba(0,0,0,0.55)" : "var(--muted-foreground)",
    border: mono ? "#000000" : "var(--border)",
    borderSoft: mono ? "rgba(0,0,0,0.35)" : "var(--border)",
    fill: mono ? "#ffffff" : "var(--surface)",
    fillAlt: mono ? "#f0f0f0" : "var(--surface-2)",
    accent: mono ? "#000000" : "var(--primary)",
    selStroke: mono ? "#000000" : "var(--primary)",
  };
  const stroke = m.ink;

  const mutate = (fn: (list: Flow[]) => Flow[]) => setFlows((list) => fn(structuredClone(list)));
  const mutateFlow = (fn: (f: Flow) => void) =>
    mutate((list) => list.map((f) => (f.id === flow.id ? (fn(f), f) : f)));

  const addNode = (kind: NodeKind) => {
    const id = uid("n");
    mutateFlow((f) => {
      f.nodes.push({ id, label: kind.toUpperCase(), kind, x: -pan.x / zoom + 60, y: -pan.y / zoom + 60, w: 200, h: 64 });
    });
    setSelected(id);
  };
  const renameNode = (id: string, label: string) => mutateFlow((f) => { const n = f.nodes.find((n) => n.id === id); if (n) n.label = label; });
  const setNodeKind = (id: string, kind: NodeKind) => mutateFlow((f) => { const n = f.nodes.find((n) => n.id === id); if (n) n.kind = kind; });
  const deleteNode = (id: string) => mutateFlow((f) => {
    f.nodes = f.nodes.filter((n) => n.id !== id);
    f.edges = f.edges.filter((e) => e.from !== id && e.to !== id);
  });
  const addEdge = (from: string, to: string) => mutateFlow((f) => { f.edges.push({ id: uid("e"), from, to }); });
  const deleteEdge = (id: string) => mutateFlow((f) => { f.edges = f.edges.filter((e) => e.id !== id); });
  const [connect, setConnect] = useState<string | null>(null);

  // ----- Drag / Pan / Zoom -----
  const svgPoint = (e: React.MouseEvent) => {
    const svg = svgRef.current; if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    return { x: (e.clientX - r.left - pan.x) / zoom, y: (e.clientY - r.top - pan.y) / zoom };
  };
  const onNodeDown = (e: React.MouseEvent, n: FlowNode) => {
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    e.stopPropagation();
    setSelected(n.id);
    const pt = svgPoint(e);
    dragRef.current = { id: n.id, ox: pt.x - n.x, oy: pt.y - n.y };
  };
  const onCanvasDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as Element).closest("[data-node]")) return;
    setSelected(null);
    panRef.current = { sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y };
  };
  const onMove = (e: React.MouseEvent) => {
    if (dragRef.current) {
      const pt = svgPoint(e); const { id, ox, oy } = dragRef.current;
      mutateFlow((f) => { const n = f.nodes.find((n) => n.id === id); if (n) { n.x = pt.x - ox; n.y = pt.y - oy; } });
    } else if (panRef.current) {
      setPan({ x: panRef.current.ox + (e.clientX - panRef.current.sx), y: panRef.current.oy + (e.clientY - panRef.current.sy) });
    }
  };
  const onUp = () => { dragRef.current = null; panRef.current = null; };
  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom((z) => Math.max(0.4, Math.min(2, z * (e.deltaY > 0 ? 0.9 : 1.1))));
  };

  const nodesById = useMemo(() => Object.fromEntries(flow.nodes.map((n) => [n.id, n] as const)), [flow.nodes]);
  const selNode = selected ? nodesById[selected] : undefined;

  const shape = (n: FlowNode, isSel: boolean) => {
    const { w, h } = nodeRect(n);
    const stk = isSel ? m.selStroke : m.borderSoft;
    const sw = isSel ? 2 : 1;
    const fill = n.kind === "start" || n.kind === "end" ? m.fillAlt : m.fill;
    if (n.kind === "decision") {
      const cx = w / 2, cy = h / 2;
      return <polygon points={`${cx},0 ${w},${cy} ${cx},${h} 0,${cy}`} fill={fill} stroke={stk} strokeWidth={sw} />;
    }
    if (n.kind === "data") {
      const skew = 14;
      return <polygon points={`${skew},0 ${w},0 ${w - skew},${h} 0,${h}`} fill={fill} stroke={stk} strokeWidth={sw} />;
    }
    if (n.kind === "io") {
      return <rect width={w} height={h} rx={h / 2} ry={h / 2} fill={fill} stroke={stk} strokeWidth={sw} />;
    }
    if (n.kind === "start" || n.kind === "end") {
      return <rect width={w} height={h} rx={h / 2} ry={h / 2} fill={fill} stroke={stk} strokeWidth={sw} />;
    }
    return <rect width={w} height={h} rx={6} fill={fill} stroke={stk} strokeWidth={sw} />;
  };

  const arrowId = `dia-${prefs.arrow}`;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <h1 className="text-sm font-bold uppercase tracking-wider">Diagrams</h1>
        <span className="text-mono text-[10px] text-muted-foreground">{flow.nodes.length} blocks · {flow.edges.length} arrows</span>
        <div className="ml-2 flex items-center gap-1 rounded-sm border border-border bg-surface-2 p-0.5">
          {flows.map((f) => (
            <button key={f.id} onClick={() => setPrefs((p) => ({ ...p, current: f.id }))}
              className={`px-2 py-0.5 text-[10px] uppercase tracking-wider rounded-sm ${prefs.current === f.id ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
              {f.name}
            </button>
          ))}
        </div>
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
            <option value="open">› Open</option>
            <option value="circle">● Circle</option>
            <option value="diamond">◆ Diamond</option>
            <option value="none">— None</option>
          </select>
          <div className="ml-2 flex items-center gap-1">
            {(["process", "decision", "data", "io", "start", "end"] as NodeKind[]).map((k) => (
              <button key={k} onClick={() => addNode(k)} className="rounded-sm border border-border bg-surface-2 px-1.5 py-1 text-[10px] uppercase tracking-wider hover:bg-muted">+ {k}</button>
            ))}
          </div>
          <button onClick={() => { setFlows(seed()); setSelected(null); }} className="rounded-sm border border-border bg-surface-2 px-2 py-1 text-[10px] uppercase tracking-wider hover:bg-muted">Reset</button>
          <div className="text-mono ml-2 text-[10px] text-muted-foreground">zoom {(zoom * 100).toFixed(0)}%</div>
          <button onClick={() => setZoom((z) => Math.min(2, z * 1.1))} className="rounded-sm border border-border bg-surface-2 px-2 py-1 text-[10px] hover:bg-muted">+</button>
          <button onClick={() => setZoom((z) => Math.max(0.4, z * 0.9))} className="rounded-sm border border-border bg-surface-2 px-2 py-1 text-[10px] hover:bg-muted">−</button>
          <button onClick={() => { setZoom(1); setPan({ x: 20, y: 20 }); }} className="rounded-sm border border-border bg-surface-2 px-2 py-1 text-[10px] hover:bg-muted">Fit</button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1 overflow-hidden" style={{ background: m.canvasBg }} onWheel={onWheel}>
          <svg
            ref={svgRef}
            className="block h-full w-full"
            style={{ background: `repeating-linear-gradient(0deg, transparent 0 23px, ${m.gridColor} 23px 24px), repeating-linear-gradient(90deg, transparent 0 23px, ${m.gridColor} 23px 24px)` }}
            onMouseDown={onCanvasDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={onUp}
          >
            <defs>
              <marker id="dia-triangle" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill={stroke} />
              </marker>
              <marker id="dia-open" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10" fill="none" stroke={stroke} strokeWidth="1.5" />
              </marker>
              <marker id="dia-circle" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <circle cx="5" cy="5" r="4" fill="none" stroke={stroke} strokeWidth="1.5" />
              </marker>
              <marker id="dia-diamond" viewBox="0 0 12 10" refX="11" refY="5" markerWidth="9" markerHeight="8" orient="auto-start-reverse">
                <path d="M0,5 L6,0 L12,5 L6,10 z" fill="none" stroke={stroke} strokeWidth="1.5" />
              </marker>
            </defs>

            <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
              {/* Edges */}
              {flow.edges.map((e) => {
                const a = nodesById[e.from]; const b = nodesById[e.to];
                if (!a || !b) return null;
                const { d, mx, my } = edgePath(a, b);
                const endId = prefs.arrow === "none" ? undefined : `url(#${arrowId})`;
                return (
                  <g key={e.id} className="cursor-pointer" onClick={(ev) => { ev.stopPropagation(); deleteEdge(e.id); }}>
                    <path d={d} fill="none" stroke="transparent" strokeWidth={16} />
                    <path d={d} fill="none" stroke={stroke} strokeWidth={1.5} markerEnd={endId} />
                    {e.label && (
                      <g>
                        <rect x={mx - 14} y={my - 9} width={28} height={14} rx={3} fill={m.fillAlt} stroke={m.borderSoft} />
                        <text x={mx} y={my + 1} textAnchor="middle" fontSize={10} fill={m.ink}>{e.label}</text>
                      </g>
                    )}
                  </g>
                );
              })}

              {/* Nodes */}
              {flow.nodes.map((n) => {
                const isSel = selected === n.id;
                const { w, h } = nodeRect(n);
                const lines = n.label.split("\n");
                return (
                  <g key={n.id} data-node transform={`translate(${n.x} ${n.y})`} onMouseDown={(e) => onNodeDown(e, n)}
                     onDoubleClick={(e) => { e.stopPropagation(); if (connect) { addEdge(connect, n.id); setConnect(null); } else { setConnect(n.id); } }}>
                    {shape(n, isSel)}
                    <text x={w / 2} y={h / 2 - (lines.length - 1) * 6} textAnchor="middle" fontSize={12} fontWeight={600} fill={m.ink}>
                      {lines.map((ln, i) => <tspan key={i} x={w / 2} dy={i === 0 ? 0 : 14}>{ln}</tspan>)}
                    </text>
                    <text x={6} y={12} fontSize={8} fill={m.inkSoft} className="font-mono uppercase">{n.kind}</text>
                  </g>
                );
              })}
            </g>
          </svg>

          {connect && (
            <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-sm border border-primary/40 bg-primary/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
              Double-click another node to connect · <button className="underline" onClick={() => setConnect(null)}>cancel</button>
            </div>
          )}
        </div>

        <aside className="flex w-[300px] shrink-0 flex-col border-l border-border bg-surface">
          <div className="label-eyebrow border-b border-border px-3 py-2 text-[10px]">Inspector</div>
          <div className="flex-1 overflow-y-auto p-3 text-xs">
            <div className="label-eyebrow mb-1 text-[10px]">Diagram</div>
            <div className="mb-3 rounded-sm border border-border bg-background p-2 text-[11px]">
              <div className="font-semibold">{flow.name}</div>
              <div className="mt-1 text-muted-foreground">{flow.description}</div>
            </div>

            {!selNode && <div className="text-muted-foreground">Select a block, or double-click two blocks to connect them with an arrow. Click an arrow to delete it.</div>}

            {selNode && (
              <div className="space-y-3">
                <div>
                  <div className="label-eyebrow mb-1 text-[10px]">Label</div>
                  <textarea value={selNode.label} onChange={(e) => renameNode(selNode.id, e.target.value)}
                    rows={3} className="w-full rounded-sm border border-border bg-background px-2 py-1 font-mono text-xs" />
                </div>
                <div>
                  <div className="label-eyebrow mb-1 text-[10px]">Shape</div>
                  <div className="flex flex-wrap gap-1">
                    {(["start", "process", "decision", "data", "io", "end"] as NodeKind[]).map((k) => (
                      <button key={k} onClick={() => setNodeKind(selNode.id, k)}
                        className={`rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${selNode.kind === k ? "border-primary/40 bg-primary/15 text-primary" : "border-border bg-background hover:bg-muted"}`}>
                        {k}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { if (connect === selNode.id) setConnect(null); else setConnect(selNode.id); }}
                    className={`flex-1 rounded-sm border px-2 py-1 text-[10px] uppercase ${connect === selNode.id ? "border-primary/40 bg-primary/15 text-primary" : "border-border bg-background hover:bg-muted"}`}>
                    {connect === selNode.id ? "Cancel connect" : "Connect →"}
                  </button>
                  <button onClick={() => { deleteNode(selNode.id); setSelected(null); }} className="flex-1 rounded-sm border border-destructive/40 bg-destructive/10 px-2 py-1 text-[10px] uppercase text-destructive hover:bg-destructive/20">Delete</button>
                </div>
              </div>
            )}
          </div>
          <div className="border-t border-border p-2 text-[10px] text-muted-foreground">
            Drag canvas to pan · Ctrl/⌘+wheel to zoom · drag block to move · double-click two blocks to draw an arrow · click an arrow to remove it.
          </div>
        </aside>
      </div>
    </div>
  );
}
