import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AppShell from "../ui/AppShell";
import { loadAllEventsFull, loadCatalogIndex } from "../catalog/loadCatalog";
import type { EventCatalogFull, FaqItem, GuideSection } from "../catalog/types";

type SearchItem = {
  id: string;
  eventId: string;
  eventTitle: string;
  kind: "event" | "guide" | "faq";
  title: string;
  content: string;
};

type SearchState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; items: SearchItem[] };

function flattenGuideSections(sections: GuideSection[], out: GuideSection[] = []): GuideSection[] {
  for (const section of sections) {
    out.push(section);
    if (section.subsections?.length) {
      flattenGuideSections(section.subsections, out);
    }
  }
  return out;
}

function buildSearchItems(events: EventCatalogFull[]): SearchItem[] {
  const items: SearchItem[] = [];

  for (const event of events) {
    const eventId = event.eventId;
    items.push({
      id: `event:${eventId}`,
      eventId,
      eventTitle: event.title,
      kind: "event",
      title: event.title,
      content: [event.title, event.subtitle ?? ""].join(" ").trim(),
    });

    const guideSections = flattenGuideSections(event.guideSections);
    for (const section of guideSections) {
      items.push({
        id: `guide:${eventId}:${section.sectionId}`,
        eventId,
        eventTitle: event.title,
        kind: "guide",
        title: section.title,
        content: [section.title, section.body].join(" ").trim(),
      });
    }

    for (const faq of event.faqItems) {
      items.push({
        id: `faq:${eventId}:${faq.faqId}`,
        eventId,
        eventTitle: event.title,
        kind: "faq",
        title: faq.question,
        content: [faq.question, faq.answer, ...(faq.tags ?? [])].join(" ").trim(),
      });
    }
  }

  return items;
}

function matchQuery(item: SearchItem, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const haystack = item.content.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function getSnippet(item: SearchItem, query: string): string {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return item.content.slice(0, 160);
  const idx = item.content.toLowerCase().indexOf(normalized);
  if (idx === -1) return item.content.slice(0, 160);
  const start = Math.max(0, idx - 60);
  return item.content.slice(start, start + 180);
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const index = await loadCatalogIndex();
        const events = await loadAllEventsFull(index.eventPaths);
        if (cancelled) return;
        const items = buildSearchItems(events);
        setState({ status: "ready", items });
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setState({ status: "error", error: msg });
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (state.status !== "ready") return [];
    return state.items.filter((item) => matchQuery(item, query));
  }, [state, query]);

  return (
    <AppShell>
      <h1>Search</h1>
      <p>Search across event titles, guides, and FAQs.</p>

      {state.status === "loading" ? <p>Building search index…</p> : null}
      {state.status === "error" ? <p style={{ color: "crimson" }}>Error: {state.error}</p> : null}

      {state.status === "ready" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search events, guides, FAQs…"
            style={{ maxWidth: 520 }}
          />
          <div style={{ fontSize: 13, color: "#6b7280" }}>{filtered.length} result(s)</div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {filtered.map((item) => (
              <div key={item.id} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fff" }}>
                <div style={{ fontSize: 12, textTransform: "uppercase", color: "#6b7280" }}>
                  {item.kind} • {item.eventTitle}
                </div>
                <div style={{ fontWeight: 700, marginTop: 4 }}>{item.title}</div>
                <div style={{ fontSize: 13, color: "#4b5563", marginTop: 6 }}>{getSnippet(item, query)}…</div>
                <div style={{ marginTop: 8 }}>
                  <Link to={`/event/${encodeURIComponent(item.eventId)}`}>Open event</Link>
                </div>
              </div>
            ))}
            {!filtered.length ? <p>No results found.</p> : null}
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
