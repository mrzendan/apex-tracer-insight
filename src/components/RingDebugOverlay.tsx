import { useState } from "react";
import { testGameRingGeometry } from "@/lib/test-game-data";

type CoordSystem = "roi-norm" | "map-norm";

/**
 * Дебаг-оверлей для калибровки геометрии колец. Включается флагом ?debug=1.
 * Рисует все 6 колец одновременно в выбранной системе координат и сравнивает
 * её с тем, что вернул ring_locator на Python (см. reports/debug/_all_rings_on_roi.jpg).
 */
export function RingDebugOverlay({
  matchId,
  scale,
}: {
  matchId: string;
  scale: number;
}) {
  const enabled =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("debug") === "1";
  const [system, setSystem] = useState<CoordSystem>("roi-norm");

  // Пока только m-test-g1 имеет реальную геометрию из ring_locator.
  const geom = matchId.startsWith("m-test") ? testGameRingGeometry : null;
  if (!enabled || !geom?.phases?.length) return null;

  const minimap = geom.minimap; // [x, y, w, h] видео (для подписи)
  const mapBounds = geom.map_bounds_in_roi; // {x,y,w,h} ROI
  const roiW = minimap?.[2] ?? 1;
  const roiH = minimap?.[3] ?? 1;

  const palette = [
    "#ff5050", "#ffb43c", "#fff03c", "#50f078", "#50c8ff", "#c878ff",
  ];

  // Конвертация фазы в нормализованные [0..1] координаты квадратной карты,
  // т.е. то, что MapCanvas ожидает в RingPhase.{cx,cy,r}.
  const project = (p: typeof geom.phases![number]) => {
    if (system === "map-norm") {
      if (p.cx_map_norm == null || p.cy_map_norm == null || p.r_map_norm == null) {
        return null;
      }
      return { cx: p.cx_map_norm, cy: p.cy_map_norm, r: p.r_map_norm };
    }
    // roi-norm: то же, что сейчас рисует прод (cx_norm/cy_norm/r_norm).
    if (p.cx_norm == null || p.cy_norm == null || p.r_norm == null) return null;
    return { cx: p.cx_norm, cy: p.cy_norm, r: p.r_norm };
  };

  const sw = (n: number) => n / Math.max(scale, 0.0001);

  return (
    <>
      <svg
        viewBox="0 0 1000 1000"
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 h-full w-full pointer-events-none"
      >
        {/* Прямоугольник map_bounds_in_roi — только в режиме roi-norm */}
        {system === "roi-norm" && mapBounds && minimap && (
          <rect
            x={(mapBounds.x / roiW) * 1000}
            y={(mapBounds.y / roiH) * 1000}
            width={(mapBounds.w / roiW) * 1000}
            height={(mapBounds.h / roiH) * 1000}
            fill="none"
            stroke="#00ff80"
            strokeOpacity={0.9}
            strokeWidth={sw(2)}
            strokeDasharray={`${sw(6)} ${sw(4)}`}
          />
        )}
        {geom.phases.map((p) => {
          const pos = project(p);
          if (!pos) return null;
          const col = palette[(p.ring - 1) % palette.length];
          const cx = pos.cx * 1000;
          const cy = pos.cy * 1000;
          const r = pos.r * 1000;
          return (
            <g key={p.ring}>
              <circle
                cx={cx} cy={cy} r={r}
                fill="none" stroke={col} strokeWidth={sw(2)}
                strokeDasharray={`${sw(4)} ${sw(3)}`}
              />
              <line x1={cx - sw(8)} y1={cy} x2={cx + sw(8)} y2={cy}
                stroke={col} strokeWidth={sw(1.5)} />
              <line x1={cx} y1={cy - sw(8)} x2={cx} y2={cy + sw(8)}
                stroke={col} strokeWidth={sw(1.5)} />
              <text x={cx + sw(10)} y={cy - sw(10)}
                fontSize={sw(20)} fontWeight={800} fill={col}
                fontFamily="Manrope, sans-serif"
                stroke="rgba(0,0,0,0.85)" strokeWidth={sw(0.7)}
                paintOrder="stroke">
                R{p.ring} · {p.geometry_confidence ?? "?"}
              </text>
              <text x={cx + sw(10)} y={cy + sw(12)}
                fontSize={sw(13)} fill="#fff"
                fontFamily="JetBrains Mono, monospace"
                stroke="rgba(0,0,0,0.85)" strokeWidth={sw(0.6)}
                paintOrder="stroke">
                {pos.cx.toFixed(3)}, {pos.cy.toFixed(3)} · r={pos.r.toFixed(3)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* HUD-уголок: переключатель системы координат */}
      <div className="pointer-events-auto absolute left-4 top-4 z-30 rounded-sm border border-border-strong bg-surface-2/95 px-3 py-2 text-xs shadow-md backdrop-blur">
        <div className="label-eyebrow mb-1 text-xs text-primary">Ring debug</div>
        <div className="text-mono text-xs text-muted-foreground">
          ROI {minimap?.join("×") ?? "—"}
        </div>
        {mapBounds && (
          <div className="text-mono text-xs text-muted-foreground">
            map_bounds {mapBounds.x},{mapBounds.y} · {mapBounds.w}×{mapBounds.h}
          </div>
        )}
        <div className="mt-1.5 flex gap-1">
          {(["roi-norm", "map-norm"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSystem(s)}
              disabled={s === "map-norm" && !mapBounds}
              className={`text-mono rounded-sm border px-1.5 py-0.5 text-xs uppercase tracking-wider transition-colors ${
                system === s
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-surface text-muted-foreground hover:text-foreground"
              } ${s === "map-norm" && !mapBounds ? "opacity-40" : ""}`}
              title={s === "map-norm" && !mapBounds
                ? "Нет cx_map_norm — добавь map_bounds_in_roi в zones.vod.json и перегенерируй"
                : undefined}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}