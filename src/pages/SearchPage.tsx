import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AppShell from "../ui/AppShell";
import DropdownButton from "../ui/components/DropdownButton";
import { loadAllEventsFull, loadCatalogIndex } from "../catalog/loadCatalog";
import type { EventCatalogFull, GuideContentBlock, GuideSection } from "../catalog/types";
import { buildTaskGroups, getGroupTitle } from "../catalog/taskGrouping";

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

function getGuideParagraphText(blocks: GuideContentBlock[]): string {
  return blocks
    .filter((block) => block.type === "paragraph")
    .map((block) => block.text)
    .join(" ")
    .trim();
}

function getGuideSearchText(blocks: GuideContentBlock[]): string {
  const textParts: string[] = [];
  for (const block of blocks) {
    if (block.type === "paragraph") {
      textParts.push(block.text);
    } else if (block.type === "image") {
      if (block.alt) textParts.push(block.alt);
      if (block.caption) textParts.push(block.caption);
    } else if (block.type === "image_row") {
      for (const image of block.images) {
        if (image.alt) textParts.push(image.alt);
        if (image.caption) textParts.push(image.caption);
      }
    }
  }
  return textParts.join(" ").trim();
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
      const paragraphText = getGuideParagraphText(section.blocks);
      const searchText = getGuideSearchText(section.blocks);
      items.push({
        id: `guide:${eventId}:${section.sectionId}`,
        eventId,
        eventTitle: event.title,
        kind: "guide",
        title: section.title,
        content: [section.title, searchText].join(" ").trim(),
        description: paragraphText,
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

    const taskGroups = buildTaskGroups(event.tasks);
    for (const group of taskGroups) {
      const rewardTotal = group.tiers.reduce((sum, tier) => sum + tier.rewardAmount, 0);
      items.push({
        id: `task:${eventId}:${group.groupId}`,
        eventId,
        eventTitle: event.title,
        kind: "task",
        title: getGroupTitle(group.tiers[0].requirementAction, group.tiers[0].requirementObject, group.tiers[0].requirementScope),
        content: [group.title, `${rewardTotal} lures total`].join(" ").trim(),
        description: `Total reward: ${rewardTotal} lures`,
        anchor: `task-${group.groupId}`,
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
        <mark key={`${index}-${part}`} style={{ background: "var(--highlight)" }}>
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

function getTabForKind(kind: SearchItem["kind"]): string | null {
  switch (kind) {
    case "guide":
      return "guide";
    case "faq":
      return "faq";
    case "task":
      return "tasks";
    default:
      return null;
  }
}

function buildSearchResultUrl(item: SearchItem): string {
  const tab = getTabForKind(item.kind);
  const params = new URLSearchParams();
  if (tab) {
    params.set("tab", tab);
  }
  const search = params.toString();
  const hash = item.anchor ? `#${encodeURIComponent(item.anchor)}` : "";
  return `/event/${encodeURIComponent(item.eventId)}${search ? `?${search}` : ""}${hash}`;
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ status: "loading" });
  const minQueryLength = 3;
  const trimmedQuery = query.trim();
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedKinds, setSelectedKinds] = useState<Array<SearchItem["kind"]>>(["event", "guide", "faq", "task"]);
  const requiresMinLength = !selectedEventId;
  const hasQuery = requiresMinLength ? trimmedQuery.length >= minQueryLength : trimmedQuery.length > 0;
  const showAllForEvent = Boolean(selectedEventId) && trimmedQuery.length === 0;

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
    if (!hasQuery && !showAllForEvent) return [];
    return state.items.filter((item) => {
      if (selectedEventId && item.eventId !== selectedEventId) return false;
      if (!selectedKinds.includes(item.kind)) return false;
      if (showAllForEvent) return true;
      return matchQuery(item, query);
    });
  }, [state, query, hasQuery, selectedEventId, selectedKinds, showAllForEvent]);

  const eventOptions = useMemo(() => {
    if (state.status !== "ready") return [];
    const seen = new Map<string, string>();
    for (const item of state.items) {
      if (!seen.has(item.eventId)) {
        seen.set(item.eventId, item.eventTitle);
      }
    }
    return Array.from(seen.entries()).map(([eventId, eventTitle]) => ({ eventId, eventTitle }));
  }, [state]);

  function toggleKind(kind: SearchItem["kind"]) {
    setSelectedKinds((prev) => {
      if (prev.includes(kind)) {
        return prev.filter((k) => k !== kind);
      }
      return [...prev, kind];
    });
  }

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
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Event filter</span>
              <DropdownButton
                valueLabel={eventOptions.find((opt) => opt.eventId === selectedEventId)?.eventTitle ?? "All events"}
                options={[
                  { value: "", label: "All events" },
                  ...eventOptions.map((opt) => ({ value: opt.eventId, label: opt.eventTitle })),
                ]}
                onSelect={setSelectedEventId}
                minWidth={220}
              />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(["event", "guide", "faq", "task"] as const).map((kind) => {
                const active = selectedKinds.includes(kind);
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => toggleKind(kind)}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: active ? "1px solid var(--text)" : "1px solid var(--border)",
                      background: active ? "var(--accent)" : "var(--surface)",
                      color: active ? "var(--accent-contrast)" : "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    {getKindLabel(kind)}
                  </button>
                );
              })}
            </div>
          </div>
          {!hasQuery && !showAllForEvent ? (
            <div style={{ fontSize: 13, color: "var(--text-subtle)" }}>
              {requiresMinLength ? `Type at least ${minQueryLength} characters to search.` : "Type to search this event."}
            </div>
          ) : null}

          {hasQuery || showAllForEvent ? (
            <>
              <div style={{ fontSize: 13, color: "var(--text-subtle)" }}>{filtered.length} result(s)</div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {filtered.map((item) => (
                  <div key={item.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface)" }}>
                    <div style={{ fontSize: 12, textTransform: "uppercase", color: "var(--text-subtle)" }}>
                      {item.eventTitle} • {getKindLabel(item.kind)}
                    </div>
                    <div style={{ fontWeight: 700, marginTop: 4 }}>{highlightText(item.title, query)}</div>
                    {getSnippet(item, query) ? (
                      <div style={{ fontSize: 13, color: "var(--text-soft)", marginTop: 6 }}>
                        {highlightText(getSnippet(item, query), query)}…
                      </div>
                    ) : null}
                <div style={{ marginTop: 8 }}>
                  <Link to={buildSearchResultUrl(item)}>{getActionLabel(item.kind)}</Link>
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
