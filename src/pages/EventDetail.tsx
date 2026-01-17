import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import AppShell from "../ui/AppShell";
import Tabs from "../ui/Tabs";
import TasksTracker from "../ui/components/TasksTracker";
import ToolsHost from "../ui/components/ToolsHost";
import { useEventCatalog } from "../catalog/useEventCatalog";
import { useToolsCatalog } from "../catalog/useToolsCatalog";
import type { FaqItem, GuideSection } from "../catalog/types";

function renderBodyText(body: string) {
  if (!body) return null;
  return body.split(/\n{2,}/).map((paragraph, index) => (
    <p key={`${index}-${paragraph.slice(0, 12)}`} style={{ margin: "8px 0" }}>
      {paragraph}
    </p>
  ));
}

function GuideSectionView({ section }: { section: GuideSection }) {
  return (
    <details style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: "8px 12px", background: "#fff" }}>
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>{section.title}</summary>
      <div style={{ marginTop: 8 }}>{renderBodyText(section.body)}</div>
      {section.subsections && section.subsections.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          {section.subsections.map((child) => (
            <GuideSectionView key={child.sectionId} section={child} />
          ))}
        </div>
      ) : null}
    </details>
  );
}

function filterFaqItems(items: FaqItem[], query: string): FaqItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    const haystack = [item.question, item.answer, ...(item.tags ?? [])].join(" ").toLowerCase();
    return haystack.includes(q);
  });
}

export default function EventDetail() {
  const { eventId } = useParams();
  const [faqQuery, setFaqQuery] = useState("");

  const decodedEventId = useMemo(() => {
    try {
      return eventId ? decodeURIComponent(eventId) : "";
    } catch {
      return eventId ?? "";
    }
  }, [eventId]);

  const eventState = useEventCatalog(decodedEventId);
  const toolState = useToolsCatalog(
    eventState.status === "ready" ? eventState.event.toolRefs.map((ref) => ref.toolId) : []
  );

  if (eventState.status === "idle" || eventState.status === "loading") {
    return (
      <AppShell>
        <h1>Event</h1>
        <p>Loading event…</p>
      </AppShell>
    );
  }

  if (eventState.status === "error") {
    return (
      <AppShell>
        <h1>Event</h1>
        <p style={{ color: "crimson" }}>Error: {eventState.error}</p>
      </AppShell>
    );
  }

  const ev = eventState.event;
  const filteredFaq = filterFaqItems(ev.faqItems, faqQuery);

  const tabs = [
    {
      id: "tasks",
      label: `Tasks (${ev.sections.taskCount})`,
      content: <TasksTracker eventId={ev.eventId} eventVersion={ev.eventVersion} tasks={ev.tasks} />,
    },
    {
      id: "guide",
      label: `Guide (${ev.sections.guideSectionCount})`,
      content: ev.guideSections.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {ev.guideSections.map((section) => (
            <GuideSectionView key={section.sectionId} section={section} />
          ))}
        </div>
      ) : (
        <p>No guide sections yet.</p>
      ),
    },
    {
      id: "faq",
      label: `FAQ (${ev.sections.faqCount})`,
      content: ev.faqItems.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            type="text"
            value={faqQuery}
            onChange={(e) => setFaqQuery(e.target.value)}
            placeholder="Search FAQ..."
            style={{ maxWidth: 420 }}
          />
          {filteredFaq.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {filteredFaq.map((item) => (
                <details key={item.faqId} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: "8px 12px", background: "#fff" }}>
                  <summary style={{ cursor: "pointer", fontWeight: 700 }}>{item.question}</summary>
                  <div style={{ marginTop: 8 }}>{renderBodyText(item.answer)}</div>
                  {item.tags && item.tags.length > 0 ? (
                    <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>Tags: {item.tags.join(", ")}</div>
                  ) : null}
                </details>
              ))}
            </div>
          ) : (
            <p>No FAQ entries match your search.</p>
          )}
        </div>
      ) : (
        <p>No FAQ entries yet.</p>
      ),
    },
    {
      id: "tools",
      label: `Tools (${ev.sections.toolCount})`,
      hidden: ev.sections.toolCount === 0,
      content:
        toolState.status === "loading" ? (
          <p>Loading tools…</p>
        ) : toolState.status === "error" ? (
          <p style={{ color: "crimson" }}>Tools error: {toolState.error}</p>
        ) : toolState.status === "ready" && toolState.tools.length ? (
          <ToolsHost tools={toolState.tools} />
        ) : (
          <p>No tools available for this event yet.</p>
        ),
    },
  ];

  return (
    <AppShell>
      <h1>{ev.title}</h1>
      {ev.subtitle ? <p>{ev.subtitle}</p> : null}
      {ev.lastVerifiedDate ? <p style={{ fontSize: 13 }}>Last verified: {ev.lastVerifiedDate}</p> : null}

      <Tabs tabs={tabs} />
    </AppShell>
  );
}
