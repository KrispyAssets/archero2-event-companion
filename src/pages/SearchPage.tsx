import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AppShell from "../ui/AppShell";
import { loadAllEventsFull, loadCatalogIndex } from "../catalog/loadCatalog";
import type { EventCatalogFull, FaqItem, GuideSection, TaskDefinition } from "../catalog/types";

type SearchItem = {
  id: string;
  eventId: string;
  eventTitle: string;
  kind: "event" | "guide" | "faq" | "task";
  title: string;
  content: string;
  description: string;
  anchor?: string;
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

function formatRequirement(task: TaskDefinition): string {
  return `${task.requirementAction} ${task.requirementTargetValue} ${task.requirementObject} (${task.requirementScope})`;
}

function formatReward(task: TaskDefinition): string {
  return `Reward: ${task.rewardAmount} ${task.rewardType}`;
}

function buildSearchItems(events: EventCatalogFull[]): SearchItem[] {
  const items: SearchItem[] = [];

  for (const event of events) {
    const eventId = event.eventId;
    const subtitle = event.subtitle ?? "";
    items.push({
      id: `event:${eventId}`,
      eventId,
      eventTitle: event.title,
      kind: "event",
      title: event.title,
      content: [event.title, subtitle].join(" ").trim(),
      description: subtitle,
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
        description: section.body,
        anchor: `guide-${section.sectionId}`,
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
        description: [faq.answer, ...(faq.tags ?? [])].join(" ").trim(),
        anchor: `faq-${faq.faqId}`,
      });
    }

    for (const task of event.tasks) {
      const requirement = formatRequirement(task);
      const reward = formatReward(task);
      items.push({
        id: `task:${eventId}:${task.taskId}`,
        eventId,
        eventTitle: event.title,
        kind: "task",
        title: requirement,
        content: [requirement, reward].join(" ").trim(),
        description: reward,
        anchor: `task-${task.taskId}`,
      });
    }
  }

  return items;
}

function matchQuery(item: SearchItem, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const haystack = [item.content, item.eventTitle, item.kind, getKindLabel(item.kind)].join(" ").toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function getSnippet(item: SearchItem, query: string): string {
  if (item.kind === "task") return item.description;
  const source = item.description || item.content;
  const normalized = query.trim().toLowerCase();
  if (!normalized) return source.slice(0, 160);
  const idx = source.toLowerCase().indexOf(normalized);
  if (idx === -1) return source.slice(0, 160);
  const start = Math.max(0, idx - 60);
  return source.slice(start, start + 180);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightText(text: string, query: string): React.ReactNode {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return text;

  const pattern = tokens.map((token) => escapeRegExp(token)).join("|");
  const regex = new RegExp(`(${pattern})`, "ig");
  const parts = text.split(regex);
  const tokenSet = new Set(tokens);

  return parts.map((part, index) => {
    if (tokenSet.has(part.toLowerCase())) {
      return (
        <mark key={`${index}-${part}`} style={{ background: "#fde68a" }}>
          {part}
        </mark>
      );
    }
    return <span key={`${index}-${part}`}>{part}</span>;
  });
}

function getKindLabel(kind: SearchItem["kind"]): string {
  switch (kind) {
    case "event":
      return "Event";
    case "guide":
      return "Guide";
    case "faq":
      return "FAQ";
    case "task":
      return "Task";
  }
}

function getActionLabel(kind: SearchItem["kind"]): string {
  switch (kind) {
    case "event":
      return "Open Event";
    case "guide":
      return "Open Guide Section";
    case "faq":
      return "Open FAQ";
    case "task":
      return "Go to Task";
  }
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ status: "loading" });
  const minQueryLength = 3;
  const hasQuery = query.trim().length >= minQueryLength;

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
    if (!hasQuery) return [];
    return state.items.filter((item) => matchQuery(item, query));
  }, [state, query, hasQuery]);

  return (
    <AppShell>
      <h1>Search</h1>
      <p>Search across event titles, guides, FAQs, and tasks.</p>

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
          {!hasQuery ? <div style={{ fontSize: 13, color: "#6b7280" }}>Type at least {minQueryLength} characters to search.</div> : null}

          {hasQuery ? (
            <>
              <div style={{ fontSize: 13, color: "#6b7280" }}>{filtered.length} result(s)</div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {filtered.map((item) => (
                  <div key={item.id} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fff" }}>
                <div style={{ fontSize: 12, textTransform: "uppercase", color: "#6b7280" }}>
                  {item.eventTitle} • {getKindLabel(item.kind)}
                </div>
                <div style={{ fontWeight: 700, marginTop: 4 }}>{highlightText(item.title, query)}</div>
                {getSnippet(item, query) ? (
                  <div style={{ fontSize: 13, color: "#4b5563", marginTop: 6 }}>
                    {highlightText(getSnippet(item, query), query)}…
                  </div>
                ) : null}
                <div style={{ marginTop: 8 }}>
                  <Link to={`/event/${encodeURIComponent(item.eventId)}${item.anchor ? `#${encodeURIComponent(item.anchor)}` : ""}`}>
                    {getActionLabel(item.kind)}
                  </Link>
                </div>
              </div>
            ))}
                {!filtered.length ? <p>No results found.</p> : null}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </AppShell>
  );
}
