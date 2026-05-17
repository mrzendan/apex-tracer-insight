import { useEffect, useRef, useState, type ReactNode } from "react";
import { EditableText } from "./EditableText";

export const SLIDE_W = 1920;
export const SLIDE_H = 1080;

export function SlideCanvas({ children, className }: { children: ReactNode; className?: string }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const update = () => {
      const el = wrapRef.current;
      if (!el) return;
      const { width, height } = el.getBoundingClientRect();
      setScale(Math.min(width / SLIDE_W, height / SLIDE_H));
    };
    update();
    const ro = new ResizeObserver(update);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className={"relative h-full w-full overflow-hidden " + (className ?? "")}>
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          width: SLIDE_W,
          height: SLIDE_H,
          marginLeft: -SLIDE_W / 2,
          marginTop: -SLIDE_H / 2,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function SlideHeader({
  titleId, subtitleId, titleDefault, subtitleDefault, editing,
}: {
  titleId: string; subtitleId: string;
  titleDefault: string; subtitleDefault: string; editing: boolean;
}) {
  return (
    <div className="px-24 pt-16">
      <div className="flex items-center justify-center gap-6">
        <div className="h-16 w-1.5 rounded-sm bg-primary" />
        <EditableText
          id={titleId}
          defaultValue={titleDefault}
          editing={editing}
          as="h1"
          className="text-center text-[64px] font-extrabold uppercase tracking-tight text-foreground"
        />
      </div>
      <EditableText
        id={subtitleId}
        defaultValue={subtitleDefault}
        editing={editing}
        as="p"
        className="mt-3 text-center text-[22px] text-muted-foreground"
      />
    </div>
  );
}