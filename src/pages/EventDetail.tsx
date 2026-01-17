import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import AppShell from "../ui/AppShell";
import Tabs from "../ui/Tabs";
import TasksTracker from "../ui/components/TasksTracker";
import ToolsHost from "../ui/components/ToolsHost";
import { useEventCatalog } from "../catalog/useEventCatalog";
import { useToolsCatalog } from "../catalog/useToolsCatalog";
import type { FaqItem, GuideSection } from "../catalog/types";

function getGuideAnchorId(sectionId: string): string {
  return `guide-${sectionId}`;
}

function getFaqAnchorId(faqId: string): string {
  return `faq-${faqId}`;
}

function getTabForAnchor(anchorId: string): string | null {
  if (anchorId.startsWith("guide-")) return "guide";
  if (anchorId.startsWith("faq-")) return "faq";
  if (anchorId.startsWith("task-")) return "tasks";
  return null;
}

function renderBodyText(body: string) {
  if (!body) return null;
  return body.split(/\n{2,}/).map((paragraph, index) => (
    <p key={`${index}-${paragraph.slice(0, 12)}`} style={{ margin: "8px 0" }}>
      {paragraph}
    </p>
  ));
}

function sectionContainsAnchor(section: GuideSection, anchorId: string): boolean {
  if (getGuideAnchorId(section.sectionId) === anchorId) return true;
  return section.subsections?.some((child) => sectionContainsAnchor(child, anchorId)) ?? false;
}

function GuideSectionView({
  section,
  activeAnchor,
  copiedAnchor,
  onCopyLink,
}: {
  section: GuideSection;
  activeAnchor: string;
  copiedAnchor: string;
  onCopyLink: (anchorId: string) => void;
}) {
  const anchorId = getGuideAnchorId(section.sectionId);
  const isOpen = activeAnchor ? sectionContainsAnchor(section, activeAnchor) : false;
  return (
    <details
      id={anchorId}
      open={isOpen || undefined}
      style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: "8px 12px", background: "#fff", scrollMarginTop: 90 }}
    >
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>{section.title}</summary>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        <button type="button" onClick={() => onCopyLink(anchorId)}>
          Copy link
        </button>
        {copiedAnchor === anchorId ? <span style={{ fontSize: 12, color: "#6b7280" }}>Copied</span> : null}
      </div>
      <div style={{ marginTop: 8 }}>{renderBodyText(section.body)}</div>
      {section.subsections && section.subsections.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          {section.subsections.map((child) => (
            <GuideSectionView
              key={child.sectionId}
              section={child}
              activeAnchor={activeAnchor}
              copiedAnchor={copiedAnchor}
              onCopyLink={onCopyLink}
            />
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
  const [activeAnchor, setActiveAnchor] = useState("");
  const [activeTabId, setActiveTabId] = useState("tasks");
  const [copiedAnchor, setCopiedAnchor] = useState("");
  const copyTimerRef = useRef<number | null>(null);
  const scrollRetryRef = useRef<number | null>(null);

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

  useEffect(() => {
    function syncHash() {
      const hash = window.location.hash.replace(/^#/, "");
      try {
        setActiveAnchor(decodeURIComponent(hash));
      } catch {
        setActiveAnchor(hash);
      }
    }

    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => {
      window.removeEventListener("hashchange", syncHash);
    };
  }, [decodedEventId]);

  useEffect(() => {
    const nextTab = getTabForAnchor(activeAnchor);
    if (nextTab) {
      setActiveTabId(nextTab);
    }
  }, [activeAnchor]);

  useEffect(() => {
    if (eventState.status !== "ready") return;
    if (!activeAnchor) return;
    let attempts = 0;

    function tryScroll() {
      const el = document.getElementById(activeAnchor);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      attempts += 1;
      if (attempts < 6) {
        scrollRetryRef.current = window.requestAnimationFrame(tryScroll);
      }
    }

    scrollRetryRef.current = window.requestAnimationFrame(tryScroll);

    return () => {
      if (scrollRetryRef.current !== null) {
        window.cancelAnimationFrame(scrollRetryRef.current);
      }
    };
  }, [eventState.status, activeAnchor, activeTabId]);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const nextAnchor = hash ? decodeURIComponent(hash) : "";
    const nextTab = nextAnchor ? getTabForAnchor(nextAnchor) : null;
    setActiveTabId(nextTab ?? "tasks");
    setFaqQuery("");
  }, [decodedEventId]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  async function copyAnchorLink(anchorId: string) {
    const hash = `#${encodeURIComponent(anchorId)}`;
    if (window.location.hash !== hash) {
      window.location.hash = hash;
    }
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}${hash}`;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const el = document.createElement("textarea");
        el.value = url;
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        el.remove();
      }
      setCopiedAnchor(anchorId);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => setCopiedAnchor(""), 2000);
    } catch {
      setCopiedAnchor("");
    }
  }

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
            <GuideSectionView
              key={section.sectionId}
              section={section}
              activeAnchor={activeAnchor}
              copiedAnchor={copiedAnchor}
              onCopyLink={copyAnchorLink}
            />
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
                <details
                  key={item.faqId}
                  id={getFaqAnchorId(item.faqId)}
                  open={getFaqAnchorId(item.faqId) === activeAnchor || undefined}
                  style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: "8px 12px", background: "#fff", scrollMarginTop: 90 }}
                >
                  <summary style={{ cursor: "pointer", fontWeight: 700 }}>{item.question}</summary>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                    <button type="button" onClick={() => copyAnchorLink(getFaqAnchorId(item.faqId))}>
                      Copy link
                    </button>
                    {copiedAnchor === getFaqAnchorId(item.faqId) ? (
                      <span style={{ fontSize: 12, color: "#6b7280" }}>Copied</span>
                    ) : null}
                  </div>
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

      <Tabs tabs={tabs} activeId={activeTabId} onActiveIdChange={setActiveTabId} />
    </AppShell>
  );
}
