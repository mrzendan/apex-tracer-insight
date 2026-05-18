import type { Team } from "@/lib/mock-match";
import { useTheme } from "@/lib/theme";

type Props = {
  team: Pick<Team, "tag" | "name" | "color" | "logo" | "logoLight" | "logoDark">;
  size?: number;
  className?: string;
};

/** Renders the team logo when available, otherwise the site logo as fallback. */
export function TeamLogo({ team, size = 28, className = "" }: Props) {
  const dim = { width: size, height: size };
  const { theme } = useTheme();
  const src = theme === "light" ? (team.logoLight ?? team.logo) : (team.logoDark ?? team.logo);
  if (src) {
    return (
      <img
        src={src}
        alt={team.name}
        style={dim}
        className={`shrink-0 rounded-sm border border-border bg-surface-2 object-contain ${className}`}
      />
    );
  }
  return (
    <span
      style={dim}
      className={`flex shrink-0 items-center justify-center rounded-sm border border-border bg-surface-2 text-primary ${className}`}
      title={`${team.name} (site logo fallback)`}
    >
      <svg viewBox="0 0 24 24" width={size * 0.55} height={size * 0.55} fill="none" stroke="currentColor" strokeWidth={2.5}>
        <path d="M12 3 L21 20 H3 Z" />
      </svg>
    </span>
  );
}