import { useRef } from "react";
import { setLayout, useArrow, type ArrowLayout } from "../store";
import { useSlideScale } from "../SlideCanvas";

type Props = {
  id: string;
  defaultArrow: ArrowLayout;
  editing: boolean;
  /** SVG canvas size used for endpoint coordinates (must match the svg viewBox you draw arrows in). */
  viewW: number;
  viewH: number;
  /** Pixel size of the slide-design area covered by the SVG (left/right/top/bottom in 1920×1080 space). */
  pixelW: number;
  pixelH: number;
  color?: string;
  dashed?: boolean;
  label1?: string;
  labelN?: string;
};

/** Draggable SVG arrow with two endpoints. Coordinates live in the svg viewBox space. */
export function MovableArrow({
  id, defaultArrow, editing, viewW, viewH, pixelW, pixelH,
  color = "var(--cyan)", dashed, label1, labelN,
}: Props) {
  const a = useArrow(id, defaultArrow);
  const scale = useSlideScale();
  const startRef = useRef<{ a: ArrowLayout; px: number; py: number; mode: "p1" | "p2" | "move" } | null>(null);

  // px → viewBox conversion factor (also account for slide scale)
  const kx = viewW / pixelW / scale;
  const ky = viewH / pixelH / scale;

  const onDown = (mode: "p1" | "p2" | "move") => (e: React.PointerEvent) => {
    if (!editing) return;
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    startRef.current = { a, px: e.clientX, py: e.clientY, mode };
  };
  const onMove = (e: React.PointerEvent) => {
    const s = startRef.current; if (!s) return;
    const dx = (e.clientX - s.px) * kx;
    const dy = (e.clientY - s.py) * ky;
    let { x1, y1, x2, y2 } = s.a;
    if (s.mode === "p1" || s.mode === "move") { x1 = s.a.x1 + dx; y1 = s.a.y1 + dy; }
    if (s.mode === "p2" || s.mode === "move") { x2 = s.a.x2 + dx; y2 = s.a.y2 + dy; }
    setLayout(id, { x1, y1, x2, y2 });
  };
  const onUp = (e: React.PointerEvent) => {
    startRef.current = null;
    try { (e.currentTarget as Element).releasePointerCapture?.(e.pointerId); } catch {}
  };

  const markerId = `mv-arr-${id.replace(/[^a-z0-9]/gi, "_")}`;
  const midx = (a.x1 + a.x2) / 2;
  const midy = (a.y1 + a.y2) / 2;

  return (
    <g>
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill={color} />
        </marker>
      </defs>
      {/* Wide invisible hit line for "move" */}
      <line
        x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2}
        stroke="transparent" strokeWidth={editing ? 24 : 0}
        style={{ cursor: editing ? "move" : undefined, pointerEvents: editing ? "stroke" : "none" }}
        onPointerDown={onDown("move")} onPointerMove={onMove} onPointerUp={onUp}
      />
      <line
        x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2}
        stroke={color} strokeWidth={2} strokeDasharray={dashed ? "6 4" : undefined}
        markerEnd={`url(#${markerId})`}
        style={{ pointerEvents: "none" }}
      />
      {label1 && (
        <g style={{ pointerEvents: "none" }}>
          <rect x={midx - 22} y={midy - 26} width="18" height="20" rx="3" fill="var(--background)" stroke={color} strokeOpacity="0.4" />
          <text x={midx - 13} y={midy - 11} fontSize="13" fontFamily="ui-monospace,monospace" fill={color} textAnchor="middle">{label1}</text>
        </g>
      )}
      {labelN && (
        <g style={{ pointerEvents: "none" }}>
          <rect x={midx + 4} y={midy + 6} width="18" height="20" rx="3" fill="var(--background)" stroke={color} strokeOpacity="0.4" />
          <text x={midx + 13} y={midy + 21} fontSize="13" fontFamily="ui-monospace,monospace" fill={color} textAnchor="middle">{labelN}</text>
        </g>
      )}
      {editing && (
        <>
          <circle
            cx={a.x1} cy={a.y1} r={9}
            fill="var(--primary)" stroke="var(--background)" strokeWidth="2"
            style={{ cursor: "grab", pointerEvents: "all" }}
            onPointerDown={onDown("p1")} onPointerMove={onMove} onPointerUp={onUp}
          />
          <circle
            cx={a.x2} cy={a.y2} r={9}
            fill="var(--primary)" stroke="var(--background)" strokeWidth="2"
            style={{ cursor: "grab", pointerEvents: "all" }}
            onPointerDown={onDown("p2")} onPointerMove={onMove} onPointerUp={onUp}
          />
        </>
      )}
    </g>
  );
}