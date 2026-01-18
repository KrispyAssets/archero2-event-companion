import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import AppShell from "../ui/AppShell";
import Tabs from "../ui/Tabs";
import TasksTracker from "../ui/components/TasksTracker";
import ToolsHost from "../ui/components/ToolsHost";
import { useEventCatalog } from "../catalog/useEventCatalog";
import { useToolsCatalog } from "../catalog/useToolsCatalog";
import type { FaqItem, GuideContentBlock, GuideSection } from "../catalog/types";

function getGuideAnchorId(sectionId: string): string {
  return `guide-${sectionId}`;
}

function getFaqAnchorId(faqId: string): string {
  return `faq-${faqId}`;
}

function LinkIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M9.2 14.8a3.5 3.5 0 0 1 0-4.95l3.65-3.65a3.5 3.5 0 0 1 4.95 4.95l-1.6 1.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.8 9.2a3.5 3.5 0 0 1 0 4.95l-3.65 3.65a3.5 3.5 0 0 1-4.95-4.95l1.6-1.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
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

function resolveImageSrc(src: string): string {
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) {
    return src;
  }
  if (src.startsWith("/")) return src;
  return `${import.meta.env.BASE_URL}${src}`;
}

function renderGuideBlocks(blocks: GuideContentBlock[]) {
  if (!blocks.length) return null;
  return blocks.map((block, index) => {
    if (block.type === "paragraph") {
      return (
        <p key={`p-${index}-${block.text.slice(0, 12)}`} style={{ margin: "8px 0" }}>
          {block.text}
        </p>
      );
    }
    return (
      <figure key={`img-${index}-${block.src}`} style={{ margin: "12px 0" }}>
        <img
          src={resolveImageSrc(block.src)}
          alt={block.alt ?? ""}
          style={{ maxWidth: "100%", borderRadius: 10, border: "1px solid #e5e7eb", display: "block" }}
        />
        {block.caption ? <figcaption style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>{block.caption}</figcaption> : null}
      </figure>
    );
  });
}

function GuideSectionView({
  section,
  copiedAnchor,
  onCopyLink,
}: {
  section: GuideSection;
  copiedAnchor: string;
  onCopyLink: (anchorId: string) => void;
}) {
  const anchorId = getGuideAnchorId(section.sectionId);
  return (
    <details id={anchorId} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: "8px 12px", background: "#fff", scrollMarginTop: 90 }}>
      <summary className="detailsSummary" style={{ cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
        <span aria-hidden="true" className="detailsChevron">
          ▸
        </span>
        <span style={{ flex: 1 }}>{section.title}</span>
        <span style={{ fontSize: 12, color: "#6b7280", minWidth: 52, textAlign: "right" }}>
          {copiedAnchor === anchorId ? "Copied" : ""}
        </span>
        <button
          type="button"
          onClick={() => onCopyLink(anchorId)}
          aria-label="Copy link to section"
          style={{ background: "transparent", border: "none", padding: 0, display: "flex", alignItems: "center", cursor: "pointer" }}
        >
          <LinkIcon />
        </button>
      </summary>
      <div style={{ marginTop: 8 }}>{renderGuideBlocks(section.blocks)}</div>
      {section.subsections && section.subsections.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          {section.subsections.map((child) => (
            <GuideSectionView key={child.sectionId} section={child} copiedAnchor={copiedAnchor} onCopyLink={onCopyLink} />
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
  const lastHandledAnchorRef = useRef<string>("");

  const decodedEventId = useMemo(() => {
    try {
      return eventId ? decodeURIComponent(eventId) : "";
    } catch {
      return eventId ?? "";
    }
  }, [eventId]);

  const eventState = useEventCatalog(decodedEventId);
  const toolState = useToolsCatalog(eventState.status === "ready" ? eventState.event.toolRefs.map((ref) => ref.toolId) : []);

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
    if (lastHandledAnchorRef.current === activeAnchor) return;
    lastHandledAnchorRef.current = activeAnchor;
    const anchorEl = document.getElementById(activeAnchor);
    let parent = anchorEl?.parentElement ?? null;
    while (parent) {
      if (parent.tagName === "DETAILS") {
        (parent as HTMLDetailsElement).open = true;
      }
      parent = parent.parentElement;
    }
    if (anchorEl && anchorEl.tagName === "DETAILS") {
      (anchorEl as HTMLDetailsElement).open = true;
    }
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
  }, [eventState.status, activeAnchor]);

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
            <GuideSectionView key={section.sectionId} section={section} copiedAnchor={copiedAnchor} onCopyLink={copyAnchorLink} />
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
          <input type="text" value={faqQuery} onChange={(e) => setFaqQuery(e.target.value)} placeholder="Search FAQ..." style={{ maxWidth: 420 }} />
          {filteredFaq.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {filteredFaq.map((item) => (
                <details
                  key={item.faqId}
                  id={getFaqAnchorId(item.faqId)}
                  style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: "8px 12px", background: "#fff", scrollMarginTop: 90 }}
                >
                  <summary className="detailsSummary" style={{ cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                    <span aria-hidden="true" className="detailsChevron">
                      ▸
                    </span>
                    <span style={{ flex: 1 }}>{item.question}</span>
                    <span style={{ fontSize: 12, color: "#6b7280", minWidth: 52, textAlign: "right" }}>
                      {copiedAnchor === getFaqAnchorId(item.faqId) ? "Copied" : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => copyAnchorLink(getFaqAnchorId(item.faqId))}
                      aria-label="Copy link to FAQ"
                      style={{ background: "transparent", border: "none", padding: 0, display: "flex", alignItems: "center", cursor: "pointer" }}
                    >
                      <LinkIcon />
                    </button>
                  </summary>
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

      <style>{`
        .detailsSummary {
          list-style: none;
        }
        .detailsSummary::-webkit-details-marker {
          display: none;
        }
        .detailsChevron {
          display: inline-flex;
          transition: transform 0.15s ease;
        }
        details[open] > summary .detailsChevron {
          transform: rotate(90deg);
        }
      `}</style>

      <Tabs tabs={tabs} activeId={activeTabId} onActiveIdChange={setActiveTabId} />
    </AppShell>
  );
}
