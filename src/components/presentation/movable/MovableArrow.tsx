import { useRef } from "react";
import { setLayout, useArrow, listBoxes, getBox, type ArrowLayout, type Pt, type Binding } from "../store";
import { useSlideScale } from "../SlideCanvas";
import { useColor, PALETTE } from "../ColorButton";
import { setText } from "../store";
import { useState } from "react";

type Props = {
  id: string;
  /** Default points. At least 2. */
  defaultArrow: ArrowLayout;
  editing: boolean;
  viewW: number;
  viewH: number;
  pixelW: number;
  pixelH: number;
  color?: string;
  dashed?: boolean;
  label1?: string;
  labelN?: string;
};

/** Polyline arrow with draggable endpoints, intermediate corners and tail/head labels. */
export function MovableArrow({
  id, defaultArrow, editing, viewW, viewH, pixelW, pixelH,
  color = "var(--cyan)", dashed, label1, labelN,
}: Props) {
  const a = useArrow(id, defaultArrow);
  const stroke = useColor(id, color);
  const [palOpen, setPalOpen] = useState(false);
  const pts = a.pts;
  const bindings: (Binding | null)[] = (a.bindings ?? new Array(pts.length).fill(null)).slice(0, pts.length);
  while (bindings.length < pts.length) bindings.push(null);
  // Resolve display points from bindings (so arrows follow moved/resized boxes).
  const displayPts: Pt[] = pts.map((p, i) => {
    const b = bindings[i];
    if (!b) return p;
    const box = getBox(b.boxId);
    if (!box) return p;
    return { x: box.x + box.w * b.ax, y: box.y + box.h * b.ay };
  });
  const scale = useSlideScale();
  const startRef = useRef<{ pts: Pt[]; px: number; py: number; mode: "all" | number } | null>(null);

  const kx = viewW / pixelW / scale;
  const ky = viewH / pixelH / scale;

  const commit = (next: Pt[], nextBindings: (Binding | null)[] = bindings) =>
    setLayout(id, { pts: next, bindings: nextBindings });

  /** Find the topmost registered box containing point p (in design coords). */
  const hitBox = (p: Pt): { id: string; box: { x: number; y: number; w: number; h: number } } | null => {
    const all = listBoxes();
    for (let i = all.length - 1; i >= 0; i--) {
      const { box } = all[i];
      if (p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h) return all[i];
    }
    return null;
  };

  const onDown = (mode: "all" | number) => (e: React.PointerEvent) => {
    if (!editing) return;
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    // Drag from the currently displayed positions (resolved bindings),
    // so a bound endpoint detaches cleanly under the cursor.
    startRef.current = { pts: displayPts.slice(), px: e.clientX, py: e.clientY, mode };
  };
  const onMove = (e: React.PointerEvent) => {
    const s = startRef.current; if (!s) return;
    const dx = (e.clientX - s.px) * kx;
    const dy = (e.clientY - s.py) * ky;
    if (s.mode === "all") {
      // Moving whole arrow: detach all bindings while dragging.
      commit(s.pts.map((p) => ({ x: p.x + dx, y: p.y + dy })), s.pts.map(() => null));
    } else {
      const i = s.mode;
      const nextPts = s.pts.map((p, idx) => idx === i ? { x: p.x + dx, y: p.y + dy } : p);
      const nextBindings = bindings.slice();
      nextBindings[i] = null; // detach while dragging
      commit(nextPts, nextBindings);
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const s = startRef.current;
    startRef.current = null;
    try { (e.currentTarget as Element).releasePointerCapture?.(e.pointerId); } catch {}
    if (!s) return;
    // Snap dragged vertex/vertices to box anchors if they were dropped over a box.
    const dx = (e.clientX - s.px) * kx;
    const dy = (e.clientY - s.py) * ky;
    const indices = s.mode === "all" ? s.pts.map((_, i) => i) : [s.mode];
    const nextPts = s.mode === "all"
      ? s.pts.map((p) => ({ x: p.x + dx, y: p.y + dy }))
      : s.pts.map((p, idx) => idx === s.mode ? { x: p.x + dx, y: p.y + dy } : p);
    const nextBindings = bindings.slice();
    for (const i of indices) {
      const p = nextPts[i];
      const hit = hitBox(p);
      if (hit) {
        const ax = Math.max(0, Math.min(1, (p.x - hit.box.x) / hit.box.w));
        const ay = Math.max(0, Math.min(1, (p.y - hit.box.y) / hit.box.h));
        nextBindings[i] = { boxId: hit.id, ax, ay };
      } else {
        nextBindings[i] = null;
      }
    }
    commit(nextPts, nextBindings);
  };

  // Insert a corner at midpoint of a segment.
  const insertCorner = (segIdx: number) => (e: React.MouseEvent) => {
    if (!editing) return;
    e.preventDefault(); e.stopPropagation();
    const p1 = pts[segIdx], p2 = pts[segIdx + 1];
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const next = [...pts.slice(0, segIdx + 1), mid, ...pts.slice(segIdx + 1)];
    commit(next);
  };
  // Remove a corner (only intermediate ones).
  const removeCorner = (i: number) => (e: React.MouseEvent) => {
    if (!editing) return;
    if (i === 0 || i === pts.length - 1) return;
    e.preventDefault(); e.stopPropagation();
    commit(pts.filter((_, idx) => idx !== i));
  };

  const markerId = `mv-arr-${id.replace(/[^a-z0-9]/gi, "_")}`;
  const rPts = displayPts;
  const last = rPts[rPts.length - 1];
  const prev = rPts[rPts.length - 2] ?? last;
  // Tail = midpoint of first segment, head = midpoint of last segment for label placement
  const segMid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const headMid = segMid(prev, last);
  const tailMid = segMid(rPts[0], rPts[1] ?? rPts[0]);

  const pathD = rPts.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(" ");

  return (
    <g>
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill={stroke} />
        </marker>
      </defs>
      {/* Wide invisible hit path for moving whole arrow */}
      <path
        d={pathD}
        fill="none"
        stroke="transparent"
        strokeWidth={editing ? 22 : 0}
        style={{ cursor: editing ? "move" : undefined, pointerEvents: editing ? "stroke" : "none" }}
        onPointerDown={onDown("all")} onPointerMove={onMove} onPointerUp={onUp}
      />
      <path
        d={pathD}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeDasharray={dashed ? "6 4" : undefined}
        markerEnd={`url(#${markerId})`}
        style={{ pointerEvents: "none" }}
      />
      {/* Labels on tail (N) and head (1) midpoints */}
      {label1 && (
        <g style={{ pointerEvents: "none" }}>
          <rect x={headMid.x - 22} y={headMid.y - 26} width="18" height="20" rx="3" fill="var(--background)" stroke={stroke} strokeOpacity="0.4" />
          <text x={headMid.x - 13} y={headMid.y - 11} fontSize="13" fontFamily="ui-monospace,monospace" fill={stroke} textAnchor="middle">{label1}</text>
        </g>
      )}
      {labelN && (
        <g style={{ pointerEvents: "none" }}>
          <rect x={tailMid.x + 4} y={tailMid.y + 6} width="18" height="20" rx="3" fill="var(--background)" stroke={stroke} strokeOpacity="0.4" />
          <text x={tailMid.x + 13} y={tailMid.y + 21} fontSize="13" fontFamily="ui-monospace,monospace" fill={stroke} textAnchor="middle">{labelN}</text>
        </g>
      )}
      {editing && (
        <>
          {/* Vertex handles */}
          {rPts.map((p, i) => {
            const isMid = i !== 0 && i !== rPts.length - 1;
            const bound = !!bindings[i];
            return (
              <circle
                key={`v-${i}`}
                cx={p.x} cy={p.y} r={isMid ? 7 : 9}
                fill={bound ? "var(--success)" : (isMid ? "var(--warning)" : "var(--primary)")}
                stroke="var(--background)" strokeWidth="2"
                style={{ cursor: "grab", pointerEvents: "all" }}
                onPointerDown={onDown(i)} onPointerMove={onMove} onPointerUp={onUp}
                onContextMenu={removeCorner(i)}
              >
                <title>{(bound ? "Привязано к блоку · " : "") + (isMid ? "Перетащить · ПКМ — удалить" : "Перетащить · бросьте на блок чтобы привязать")}</title>
              </circle>
            );
          })}
          {/* Segment "+" buttons for inserting a corner */}
          {rPts.slice(0, -1).map((p, i) => {
            const q = rPts[i + 1];
            const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
            return (
              <g key={`seg-${i}`} style={{ cursor: "copy", pointerEvents: "all" }} onClick={insertCorner(i)}>
                <circle cx={m.x} cy={m.y} r={8} fill="var(--background)" stroke={stroke} strokeOpacity="0.7" />
                <line x1={m.x - 4} y1={m.y} x2={m.x + 4} y2={m.y} stroke={stroke} strokeWidth="2" />
                <line x1={m.x} y1={m.y - 4} x2={m.x} y2={m.y + 4} stroke={stroke} strokeWidth="2" />
                <title>Добавить угол</title>
              </g>
            );
          })}
          {/* Color swatch button — opens palette inline */}
          <g
            style={{ cursor: "pointer", pointerEvents: "all" }}
            transform={`translate(${rPts[0].x - 26}, ${rPts[0].y - 26})`}
            onClick={(e) => { e.stopPropagation(); setPalOpen((o) => !o); }}
          >
            <circle cx={0} cy={0} r={9} fill={stroke} stroke="var(--background)" strokeWidth="2" />
            <title>Сменить цвет</title>
          </g>
          {palOpen && (
            <g transform={`translate(${rPts[0].x - 26}, ${rPts[0].y - 8})`} style={{ pointerEvents: "all" }}>
              <rect x={-6} y={0} width={PALETTE.length * 22 + 12} height={28} rx={6} fill="var(--surface)" stroke="var(--border)" />
              {PALETTE.map((c, i) => (
                <circle
                  key={c.value}
                  cx={6 + i * 22 + 8} cy={14} r={9}
                  fill={c.value}
                  stroke={c.value === stroke ? "var(--foreground)" : "var(--border)"}
                  strokeWidth={c.value === stroke ? 2 : 1}
                  style={{ cursor: "pointer" }}
                  onClick={(e) => { e.stopPropagation(); setText(`${id}.color`, c.value); setPalOpen(false); }}
                >
                  <title>{c.name}</title>
                </circle>
              ))}
            </g>
          )}
        </>
      )}
    </g>
  );
}
