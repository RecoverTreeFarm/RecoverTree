import { Container, Panel, PageHeader, PlaceholderNote } from "@/components/pixel/ui";

const SECTIONS = [
  { t: "Users", d: "View, ban / unban, assign or remove Meeting Host role." },
  { t: "Meeting sessions", d: "View sessions and invalidate meeting codes." },
  { t: "Badges", d: "Manage badge definitions and award categories." },
  { t: "Audit log", d: "Every admin action is recorded here." },
];

export default function AdminPage() {
  return (
    <Container>
      <PageHeader
        title="Admin"
        subtitle="For Admin users only. Manage members, meetings, and awards. (Access control is not implemented in this shell.)"
        route="/admin"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {SECTIONS.map((s) => (
          <Panel key={s.t}>
            <h2 className="pixel-heading mb-2 text-lg">{s.t}</h2>
            <p className="text-xs text-[var(--rf-ink-soft)]">{s.d}</p>
            <button type="button" className="pixel-btn pixel-btn--secondary mt-3 text-xs" disabled>
              Open
            </button>
          </Panel>
        ))}
      </div>
      <PlaceholderNote>no data, roles, or actions are wired up yet</PlaceholderNote>
    </Container>
  );
}
