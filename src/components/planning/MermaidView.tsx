import { useEffect, useRef, useState } from "react";

/** Lazy-load mermaid only in the browser (avoids SSR issues). */
let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const m = mod.default;
      m.initialize({ startOnLoad: false, theme: "dark", securityLevel: "loose", fontFamily: "Inter, ui-sans-serif" });
      return m;
    });
  }
  return mermaidPromise;
}

let counter = 0;

export function MermaidView({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const id = `mmd-${++counter}-${Date.now().toString(36)}`;
    setError(null);
    getMermaid().then(async (mermaid) => {
      if (cancelled || !ref.current) return;
      try {
        const { svg } = await mermaid.render(id, code || "flowchart LR\n  empty[Empty]");
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        if (ref.current) ref.current.innerHTML = "";
      }
    });
    return () => { cancelled = true; };
  }, [code]);

  return (
    <div className="flex h-full w-full flex-col">
      {error && (
        <div className="m-2 rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-mono text-[11px] text-destructive whitespace-pre-wrap">
          {error}
        </div>
      )}
      <div ref={ref} className="mermaid-host flex flex-1 items-center justify-center overflow-auto p-4 [&_svg]:max-w-full [&_svg]:max-h-full" />
    </div>
  );
}