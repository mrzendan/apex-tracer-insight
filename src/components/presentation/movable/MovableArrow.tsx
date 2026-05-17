import { useRef } from "react";
import { setLayout, useArrow, type ArrowLayout, type Pt } from "../store";
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
  const scale = useSlideScale();
  const startRef = useRef<{ pts: Pt[]; px: number; py: number; mode: "all" | number } | null>(null);

  const kx = viewW / pixelW / scale;
  const ky = viewH / pixelH / scale;

  const commit = (next: Pt[]) => setLayout(id, { pts: next });

  const onDown = (mode: "all" | number) => (e: React.PointerEvent) => {
    if (!editing) return;
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    startRef.current = { pts, px: e.clientX, py: e.clientY, mode };
  };
  const onMove = (e: React.PointerEvent) => {
    const s = startRef.current; if (!s) return;
    const dx = (e.clientX - s.px) * kx;
    const dy = (e.clientY - s.py) * ky;
    if (s.mode === "all") {
      commit(s.pts.map((p) => ({ x: p.x + dx, y: p.y + dy })));
    } else {
      const i = s.mode;
      commit(s.pts.map((p, idx) => idx === i ? { x: p.x + dx, y: p.y + dy } : p));
    }
  };
  const onUp = (e: React.PointerEvent) => {
    startRef.current = null;
    try { (e.currentTarget as Element).releasePointerCapture?.(e.pointerId); } catch {}
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
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2] ?? last;
  // Tail = midpoint of first segment, head = midpoint of last segment for label placement
  const segMid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const headMid = segMid(prev, last);
  const tailMid = segMid(pts[0], pts[1] ?? pts[0]);

  const pathD = pts.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(" ");

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
          {pts.map((p, i) => {
            const isMid = i !== 0 && i !== pts.length - 1;
            return (
              <circle
                key={`v-${i}`}
                cx={p.x} cy={p.y} r={isMid ? 7 : 9}
                fill={isMid ? "var(--warning)" : "var(--primary)"}
                stroke="var(--background)" strokeWidth="2"
                style={{ cursor: "grab", pointerEvents: "all" }}
                onPointerDown={onDown(i)} onPointerMove={onMove} onPointerUp={onUp}
                onContextMenu={removeCorner(i)}
              >
                <title>{isMid ? "Перетащить · ПКМ — удалить" : "Перетащить"}</title>
              </circle>
            );
          })}
          {/* Segment "+" buttons for inserting a corner */}
          {pts.slice(0, -1).map((p, i) => {
            const q = pts[i + 1];
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
            transform={`translate(${pts[0].x - 26}, ${pts[0].y - 26})`}
            onClick={(e) => { e.stopPropagation(); setPalOpen((o) => !o); }}
          >
            <circle cx={0} cy={0} r={9} fill={stroke} stroke="var(--background)" strokeWidth="2" />
            <title>Сменить цвет</title>
          </g>
          {palOpen && (
            <g transform={`translate(${pts[0].x - 26}, ${pts[0].y - 8})`} style={{ pointerEvents: "all" }}>
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
