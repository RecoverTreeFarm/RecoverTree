import Link from "next/link";

/** Chunky retro panel — our lightweight stand-in for a card. */
export function Panel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`pixel-panel p-5 ${className}`}>{children}</div>;
}

type BtnVariant = "primary" | "secondary" | "blue";
const variantClass: Record<BtnVariant, string> = {
  primary: "",
  secondary: "pixel-btn--secondary",
  blue: "pixel-btn--blue",
};

/** Pixel button rendered as a link (all navigation is via <Link>). */
export function PixelLink({
  href,
  children,
  variant = "primary",
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  variant?: BtnVariant;
  className?: string;
}) {
  return (
    <Link href={href} className={`pixel-btn ${variantClass[variant]} ${className}`}>
      {children}
    </Link>
  );
}

/** A small labelled stat chip (Fruits, Fertilizer, etc.). */
export function StatChip({
  label,
  value,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="pixel-panel flex items-center gap-2 px-3 py-2">
      {icon}
      <div className="leading-tight">
        <div className="text-lg font-extrabold">{value}</div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--rf-ink-soft)]">
          {label}
        </div>
      </div>
    </div>
  );
}

/** Centered page container with consistent padding. */
export function Container({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <main className={`mx-auto w-full max-w-5xl flex-1 px-4 py-8 ${className}`}>
      {children}
    </main>
  );
}

/** Page title block. */
export function PageHeader({
  title,
  subtitle,
  route,
}: {
  title: string;
  subtitle?: string;
  route?: string;
}) {
  return (
    <div className="mb-6">
      <h1 className="pixel-heading text-3xl text-[var(--rf-ink)]">{title}</h1>
      {subtitle && (
        <p className="mt-2 max-w-2xl text-sm text-[var(--rf-ink-soft)]">{subtitle}</p>
      )}
      {route && (
        <code className="mt-2 inline-block text-[11px] text-[var(--rf-ink-soft)]">
          route: {route}
        </code>
      )}
    </div>
  );
}

/** Standard placeholder-page notice so every route reads as "shell, not built". */
export function PlaceholderNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mt-4 inline-block rounded border-2 border-dashed border-[var(--rf-ink)] bg-[var(--rf-cream)] px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-[var(--rf-ink-soft)]"
    >
      🚧 Placeholder — {children}
    </p>
  );
}
