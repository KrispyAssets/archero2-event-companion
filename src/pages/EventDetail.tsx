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
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
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
    if (block.type === "image") {
      return (
        <figure
          key={`img-${index}-${block.src}`}
          style={{ margin: "12px 0", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}
        >
          <img
            src={resolveImageSrc(block.src)}
            alt={block.alt ?? ""}
          style={{
            maxWidth: "100%",
            maxHeight: 420,
            width: "100%",
            objectFit: "contain",
            borderRadius: 10,
            border: "1px solid var(--border)",
            display: "block",
            cursor: "zoom-in",
          }}
            data-zoom-src={resolveImageSrc(block.src)}
          />
        {block.caption ? <figcaption style={{ fontSize: 12, color: "var(--text-subtle)", marginTop: 6 }}>{block.caption}</figcaption> : null}
        </figure>
      );
    }

    return (
      <div key={`row-${index}`} style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center", margin: "12px 0" }}>
        {block.images.map((image, imageIndex) => (
          <figure
            key={`row-${index}-${image.src}-${imageIndex}`}
            style={{
              margin: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              flex: "1 1 180px",
              maxWidth: 240,
            }}
          >
            <img
              src={resolveImageSrc(image.src)}
              alt={image.alt ?? ""}
              style={{
                width: "100%",
                maxHeight: 260,
                objectFit: "contain",
                borderRadius: 10,
                border: "1px solid var(--border)",
                display: "block",
                cursor: "zoom-in",
              }}
              data-zoom-src={resolveImageSrc(image.src)}
            />
            {image.caption ? <figcaption style={{ fontSize: 12, color: "var(--text-subtle)", marginTop: 6 }}>{image.caption}</figcaption> : null}
          </figure>
        ))}
      </div>
    );
  });
}

type GuideImageItem = {
  src: string;
  alt: string;
  caption?: string;
};

function collectGuideImages(sections: GuideSection[], out: GuideImageItem[] = []): GuideImageItem[] {
  for (const section of sections) {
    for (const block of section.blocks) {
      if (block.type === "image") {
        out.push({
          src: resolveImageSrc(block.src),
          alt: block.alt ?? "",
          caption: block.caption,
        });
      } else if (block.type === "image_row") {
        for (const image of block.images) {
          out.push({
            src: resolveImageSrc(image.src),
            alt: image.alt ?? "",
            caption: image.caption,
          });
        }
      }
    }
    if (section.subsections?.length) {
      collectGuideImages(section.subsections, out);
    }
  }
  return out;
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
    <details id={anchorId} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px", background: "var(--surface)", scrollMarginTop: 90 }}>
      <summary className="detailsSummary" style={{ cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
        <span aria-hidden="true" className="detailsChevron">
          ▸
        </span>
        <span style={{ flex: 1 }}>{section.title}</span>
        <span style={{ fontSize: 12, color: "var(--text-subtle)", minWidth: 52, textAlign: "right" }}>{copiedAnchor === anchorId ? "Copied" : ""}</span>
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
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lightboxScale, setLightboxScale] = useState(1);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [tasksSheetOffset, setTasksSheetOffset] = useState(0);
  const [tasksSheetDragging, setTasksSheetDragging] = useState(false);
  const tasksScrollRef = useRef<HTMLDivElement | null>(null);
  const tasksSheetStartRef = useRef<number | null>(null);
  const tasksSheetStartOffsetRef = useRef(0);
  const tasksSheetDragActiveRef = useRef(false);
  const tasksSheetCloseTimerRef = useRef<number | null>(null);
  const tasksSheetPointerInScrollRef = useRef(false);
  const scrollLockRef = useRef<{
    bodyOverflow: string;
    bodyPaddingRight: string;
    htmlOverflow: string;
    bodyPosition: string;
    bodyTop: string;
    bodyWidth: string;
    scrollY: number;
  } | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const touchDeltaXRef = useRef(0);
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartScaleRef = useRef(1);
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
  const guideImages = useMemo(() => (eventState.status === "ready" ? collectGuideImages(eventState.event.guideSections) : []), [eventState]);

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

  function handleGuideImageClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const img = target.closest("img");
    if (!img) return;
    const zoomSrc = img.getAttribute("data-zoom-src");
    if (!zoomSrc) return;
    e.preventDefault();
    const index = guideImages.findIndex((item) => item.src === zoomSrc);
    setLightboxIndex(index >= 0 ? index : 0);
    setLightboxScale(1);
    touchStartXRef.current = null;
    touchDeltaXRef.current = 0;
    pinchStartDistanceRef.current = null;
    pinchStartScaleRef.current = 1;
  }

  function closeLightbox() {
    setLightboxIndex(null);
    setLightboxScale(1);
  }

  function clampScale(value: number) {
    return Math.min(3, Math.max(1, value));
  }

  function showPrev() {
    if (lightboxIndex === null || !guideImages.length) return;
    setLightboxIndex((lightboxIndex - 1 + guideImages.length) % guideImages.length);
    setLightboxScale(1);
  }

  function showNext() {
    if (lightboxIndex === null || !guideImages.length) return;
    setLightboxIndex((lightboxIndex + 1) % guideImages.length);
    setLightboxScale(1);
  }

  function closeTasksSheet() {
    const height = Math.round(window.innerHeight * 0.8);
    setTasksSheetOffset(height);
    setTasksSheetDragging(false);
    tasksSheetStartRef.current = null;
    tasksSheetStartOffsetRef.current = 0;
    if (tasksSheetCloseTimerRef.current !== null) {
      window.clearTimeout(tasksSheetCloseTimerRef.current);
    }
    tasksSheetCloseTimerRef.current = window.setTimeout(() => {
      setTasksOpen(false);
      setTasksSheetOffset(0);
    }, 240);
  }

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
      if (tasksSheetCloseTimerRef.current !== null) {
        window.clearTimeout(tasksSheetCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!tasksOpen) return;
    window.requestAnimationFrame(() => {
      setTasksSheetOffset(0);
    });
  }, [tasksOpen]);

  useEffect(() => {
    const shouldLock = tasksOpen || lightboxIndex !== null;
    if (!shouldLock) {
      if (scrollLockRef.current) {
        const lockedScrollY = scrollLockRef.current.scrollY;
        document.body.style.overflow = scrollLockRef.current.bodyOverflow;
        document.body.style.paddingRight = scrollLockRef.current.bodyPaddingRight;
        document.documentElement.style.overflow = scrollLockRef.current.htmlOverflow;
        document.body.style.position = scrollLockRef.current.bodyPosition;
        document.body.style.top = scrollLockRef.current.bodyTop;
        document.body.style.width = scrollLockRef.current.bodyWidth;
        scrollLockRef.current = null;
        window.scrollTo(0, lockedScrollY);
      }
      return;
    }

    if (!scrollLockRef.current) {
      scrollLockRef.current = {
        bodyOverflow: document.body.style.overflow,
        bodyPaddingRight: document.body.style.paddingRight,
        htmlOverflow: document.documentElement.style.overflow,
        bodyPosition: document.body.style.position,
        bodyTop: document.body.style.top,
        bodyWidth: document.body.style.width,
        scrollY: window.scrollY,
      };
    }

    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.body.style.paddingRight = scrollbarWidth > 0 ? `${scrollbarWidth}px` : "";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollLockRef.current.scrollY}px`;
    document.body.style.width = "100%";
  }, [tasksOpen, lightboxIndex]);

  function openTasksSheet() {
    const height = Math.round(window.innerHeight * 0.8);
    setTasksSheetOffset(height);
    setTasksOpen(true);
  }

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
        <p style={{ color: "var(--danger)" }}>Error: {eventState.error}</p>
      </AppShell>
    );
  }

  const ev = eventState.event;
  const filteredFaq = filterFaqItems(ev.faqItems, faqQuery);

  const tabs = [
    {
      id: "tools",
      label: `Tools (${ev.sections.toolCount})`,
      hidden: ev.sections.toolCount === 0,
      content:
        toolState.status === "loading" ? (
          <p>Loading tools…</p>
        ) : toolState.status === "error" ? (
          <p style={{ color: "var(--danger)" }}>Tools error: {toolState.error}</p>
        ) : toolState.status === "ready" && toolState.tools.length ? (
          <ToolsHost tools={toolState.tools} />
        ) : (
          <p>No tools available for this event yet.</p>
        ),
    },
    {
      id: "guide",
      label: `Guide (${ev.sections.guideSectionCount})`,
      content: ev.guideSections.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }} onClick={handleGuideImageClick}>
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
                  style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px", background: "var(--surface)", scrollMarginTop: 90 }}
                >
                  <summary className="detailsSummary" style={{ cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                    <span aria-hidden="true" className="detailsChevron">
                      ▸
                    </span>
                    <span style={{ flex: 1 }}>{item.question}</span>
                    <span style={{ fontSize: 12, color: "var(--text-subtle)", minWidth: 52, textAlign: "right" }}>
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
                    <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-subtle)" }}>Tags: {item.tags.join(", ")}</div>
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
      id: "tasks",
      label: `Tasks (${ev.sections.taskCount})`,
      hidden: true,
      content: <TasksTracker eventId={ev.eventId} eventVersion={ev.eventVersion} tasks={ev.tasks} />,
    },
  ];

  return (
    <AppShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1>{ev.title}</h1>
        <button type="button" className="secondary" onClick={openTasksSheet}>
          Tasks
        </button>
      </div>
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
        .lightboxOverlay {
          position: fixed;
          inset: 0;
          background: var(--overlay);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: column;
          padding: 24px;
          z-index: 50;
          touch-action: none;
        }
        .lightboxImage {
          max-width: min(1200px, 96vw);
          max-height: 90vh;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.2);
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
          background: var(--surface-2);
        }
        .lightboxClose {
          position: fixed;
          top: 16px;
          right: 16px;
          background: rgba(15, 23, 42, 0.75);
          color: #fff;
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 999px;
          padding: 8px 12px;
          cursor: pointer;
          z-index: 51;
        }
        .tasksModalOverlay {
          position: fixed;
          inset: 0;
          background: var(--overlay);
          display: flex;
          align-items: flex-end;
          justify-content: center;
          z-index: 60;
          overflow: hidden;
          overscroll-behavior: contain;
          touch-action: none;
        }
        .tasksModal {
          width: 100%;
          height: 80vh;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          background: var(--surface);
          border-radius: 16px 16px 0 0;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
          padding: 12px 16px 16px;
          transform: translateY(var(--tasks-sheet-offset, 0px));
          transition: transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
          touch-action: none;
        }
        .tasksModal.dragging {
          transition: none;
        }
        .tasksModalHandle {
          width: 88px;
          height: 10px;
          border-radius: 999px;
          background: var(--border);
          margin: 4px auto 8px;
        }
        .tasksModalHeader {
          display: grid;
          align-items: center;
          gap: 12px;
          margin-bottom: 12px;
        }
        .tasksModalClose {
          border: 1px solid var(--border);
          background: var(--surface);
          border-radius: 999px;
          padding: 6px 10px;
          cursor: pointer;
        }
      `}</style>

      <Tabs tabs={tabs} activeId={activeTabId} onActiveIdChange={setActiveTabId} />

      {lightboxIndex !== null ? (
        <>
          <div
            className="lightboxOverlay"
            role="button"
            tabIndex={0}
            onClick={(e) => {
              if (e.target === e.currentTarget) closeLightbox();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeLightbox();
              if (e.key === "ArrowLeft") showPrev();
              if (e.key === "ArrowRight") showNext();
              if (e.key === "Enter" || e.key === " ") {
                if (e.target === e.currentTarget) closeLightbox();
              }
            }}
            onTouchStart={(e) => {
              if (e.touches.length === 1) {
                touchStartXRef.current = e.touches[0].clientX;
                touchDeltaXRef.current = 0;
              } else if (e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                pinchStartDistanceRef.current = Math.hypot(dx, dy);
                pinchStartScaleRef.current = lightboxScale;
              }
            }}
            onTouchMove={(e) => {
              if (e.touches.length === 2 && pinchStartDistanceRef.current) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const distance = Math.hypot(dx, dy);
                const nextScale = clampScale((distance / pinchStartDistanceRef.current) * pinchStartScaleRef.current);
                setLightboxScale(nextScale);
              } else if (e.touches.length === 1 && touchStartXRef.current !== null && lightboxScale === 1) {
                touchDeltaXRef.current = e.touches[0].clientX - touchStartXRef.current;
              }
            }}
            onTouchEnd={() => {
              if (touchStartXRef.current !== null && lightboxScale === 1) {
                const delta = touchDeltaXRef.current;
                if (Math.abs(delta) > 60) {
                  if (delta > 0) showPrev();
                  else showNext();
                }
              }
              touchStartXRef.current = null;
              touchDeltaXRef.current = 0;
              pinchStartDistanceRef.current = null;
            }}
          >
            <img
              src={guideImages[lightboxIndex]?.src}
              alt={guideImages[lightboxIndex]?.alt ?? ""}
              className="lightboxImage"
              style={{ transform: `scale(${lightboxScale})` }}
            />
            {guideImages[lightboxIndex]?.caption ? (
              <div style={{ color: "var(--text-muted)", marginTop: 12, fontSize: 13, textAlign: "center" }}>
                {guideImages[lightboxIndex]?.caption}
              </div>
            ) : null}
          </div>
          <button type="button" className="lightboxClose" onClick={closeLightbox}>
            Close
          </button>
        </>
      ) : null}

      {tasksOpen ? (
        <div
          className="tasksModalOverlay"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeTasksSheet();
          }}
        >
          <div
            className={`tasksModal${tasksSheetDragging ? " dragging no-select" : ""}`}
            style={{ ["--tasks-sheet-offset" as string]: `${tasksSheetOffset}px` }}
            onPointerDown={(e) => {
              tasksSheetStartRef.current = e.clientY;
              tasksSheetStartOffsetRef.current = tasksSheetOffset;
              tasksSheetDragActiveRef.current = false;
              tasksSheetPointerInScrollRef.current =
                tasksScrollRef.current !== null && tasksScrollRef.current.contains(e.target as Node);
            }}
            onPointerMove={(e) => {
              if (tasksSheetStartRef.current === null) return;
              const deltaY = e.clientY - tasksSheetStartRef.current;
              const scrollEl = tasksScrollRef.current;
              const scrollTop = scrollEl ? scrollEl.scrollTop : 0;
              const inScrollArea = tasksSheetPointerInScrollRef.current;
              const startThreshold = 1;
              if (
                !tasksSheetDragActiveRef.current &&
                deltaY > 0 &&
                Math.abs(deltaY) >= startThreshold &&
                (!inScrollArea || scrollTop <= 0)
              ) {
                tasksSheetDragActiveRef.current = true;
                setTasksSheetDragging(true);
                (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
                e.preventDefault();
              }
              if (!tasksSheetDragActiveRef.current) return;
              const height = Math.round(window.innerHeight * 0.8);
              const nextOffset = Math.max(
                0,
                Math.min(height, tasksSheetStartOffsetRef.current + (e.clientY - tasksSheetStartRef.current))
              );
              setTasksSheetOffset(nextOffset);
            }}
            onPointerUp={() => {
              if (tasksSheetDragActiveRef.current) {
                setTasksSheetDragging(false);
                if (tasksSheetOffset > Math.round(window.innerHeight * 0.8 * 0.15)) {
                  closeTasksSheet();
                } else {
                  setTasksSheetOffset(0);
                }
              }
              tasksSheetStartRef.current = null;
              tasksSheetDragActiveRef.current = false;
              tasksSheetPointerInScrollRef.current = false;
            }}
            onPointerCancel={() => {
              setTasksSheetDragging(false);
              setTasksSheetOffset(0);
              tasksSheetStartRef.current = null;
              tasksSheetDragActiveRef.current = false;
              tasksSheetPointerInScrollRef.current = false;
            }}
          >
            <div
              className="tasksModalHandle"
              role="button"
              tabIndex={0}
              aria-label="Drag to close tasks panel"
              onKeyDown={(e) => {
                if (e.key === "Escape") closeTasksSheet();
              }}
            />
            <div className="tasksModalHeader" style={{ gridTemplateColumns: "1fr auto 1fr" }}>
              <div />
              <div style={{ fontWeight: 800, fontSize: 18, textAlign: "center" }}>Task Tracker</div>
              <div />
            </div>
            <TasksTracker
              eventId={ev.eventId}
              eventVersion={ev.eventVersion}
              tasks={ev.tasks}
              scrollContainerRef={tasksScrollRef}
            />
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
