import { Link } from "@tanstack/react-router";

/** Square brand mark used in all page headers. */
export function BrandMark({ subtitle }: { subtitle?: string }) {
  return (
    <Link to="/" className="flex shrink-0 items-center gap-2.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-primary text-primary-foreground">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path d="M12 3 L21 20 H3 Z" />
        </svg>
      </div>
      <div className="leading-tight">
        <div className="text-sm font-bold tracking-tight">APEX STATS</div>
        {subtitle ? <div className="label-eyebrow text-[9px]">{subtitle}</div> : null}
      </div>
    </Link>
  );
}