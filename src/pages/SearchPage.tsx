import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AppShell from "../ui/AppShell";
import { loadAllEventsFull, loadCatalogIndex } from "../catalog/loadCatalog";
import type { EventCatalogFull, FaqItem, GuideContentBlock, GuideSection, TaskDefinition } from "../catalog/types";

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

function formatRequirement(task: TaskDefinition): string {
  return `${task.requirementAction} ${task.requirementTargetValue} ${task.requirementObject} (${task.requirementScope})`;
}

function formatReward(task: TaskDefinition): string {
  return `Reward: ${task.rewardAmount} ${task.rewardType}`;
}

type TaskGroup = {
  groupId: string;
  title: string;
  tiers: TaskDefinition[];
};

function formatGroupTitle(action: string, object: string, scope: string): string {
  const label = `${action} ${object}`.replace(/_/g, " ");
  const scopeLabel = scope.replace(/_/g, " ");
  return `${label} (${scopeLabel})`;
}

function buildTaskGroups(tasks: TaskDefinition[]): TaskGroup[] {
  const map = new Map<string, TaskGroup>();
  for (const task of tasks) {
    const key = `${task.requirementAction}__${task.requirementObject}__${task.requirementScope}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        groupId: key,
        title: formatGroupTitle(task.requirementAction, task.requirementObject, task.requirementScope),
        tiers: [task],
      });
    } else {
      existing.tiers.push(task);
    }
  }
  return Array.from(map.values()).map((group) => ({
    ...group,
    tiers: group.tiers.sort((a, b) => a.requirementTargetValue - b.requirementTargetValue),
  }));
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
        title: group.title,
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
            <label style={{ fontSize: 13, color: "#374151" }}>
              Event filter
              <select
                value={selectedEventId}
                onChange={(e) => setSelectedEventId(e.target.value)}
                style={{ display: "block", marginTop: 6, maxWidth: 320 }}
              >
                <option value="">All events</option>
                {eventOptions.map((opt) => (
                  <option key={opt.eventId} value={opt.eventId}>
                    {opt.eventTitle}
                  </option>
                ))}
              </select>
            </label>
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
                      border: active ? "1px solid #111827" : "1px solid #e5e7eb",
                      background: active ? "#111827" : "#fff",
                      color: active ? "#fff" : "#374151",
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
            <div style={{ fontSize: 13, color: "#6b7280" }}>
              {requiresMinLength ? `Type at least ${minQueryLength} characters to search.` : "Type to search this event."}
            </div>
          ) : null}

          {hasQuery || showAllForEvent ? (
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
