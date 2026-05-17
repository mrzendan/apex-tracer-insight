import { useEffect, useRef, useState, type ReactNode } from "react";

export const W = 1920;
export const H = 1080;

export function V2Canvas({ children }: { children: ReactNode }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const update = () => {
      const el = wrapRef.current; if (!el) return;
      const r = el.getBoundingClientRect();
      setScale(Math.min(r.width / W, r.height / H));
    };
    update();
    const ro = new ResizeObserver(update);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-[#f5f1e8]">
      <div
        className="absolute left-1/2 top-1/2 bg-[#f5f1e8] text-[#1a1714]"
        style={{
          width: W, height: H,
          marginLeft: -W / 2, marginTop: -H / 2,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
          fontFamily: "'Inter', 'Manrope', system-ui, sans-serif",
        }}
      >
        {children}
      </div>
    </div>
  );
}