import AppShell from "../ui/AppShell";
import Tabs from "../ui/Tabs";
import { EventCatalogList } from "./EventsIndex";
import EventSchedule from "./EventSchedule";

function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface)" }}>
      <div style={{ fontWeight: 700 }}>{title}</div>
      <p style={{ marginTop: 6, color: "var(--text-muted)" }}>{description}</p>
    </div>
  );
}

export default function ContentIndex() {
  return (
    <AppShell>
      <h1>Content</h1>
      <p style={{ color: "var(--text-muted)" }}>Focused, community-backed guides with events at the center.</p>

      <Tabs
        tabs={[
          {
            id: "events",
            label: "Events",
            content: <EventCatalogList />,
          },
          {
            id: "schedule",
            label: "Schedule",
            content: <EventSchedule />,
          },
          {
            id: "gear",
            label: "Gear",
            content: (
              <ComingSoon
                title="Best gear paths"
                description="Curated sets with recommended runes. Coming soon."
              />
            ),
          },
        ]}
        initialActiveId="events"
      />
    </AppShell>
  );
}
