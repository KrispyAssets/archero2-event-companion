import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate, useNavigationType, useParams } from "react-router-dom";
import AppShell from "../ui/AppShell";
import Tabs from "../ui/Tabs";
import TasksTracker from "../ui/components/TasksTracker";
import ToolsHost from "../ui/components/ToolsHost";
import { useEventCatalog } from "../catalog/useEventCatalog";
import { getEventShopQuantities, setEventShopQuantity } from "../state/userStateStore";
import { useSharedItems } from "../catalog/useSharedItems";
import { useToolsCatalog } from "../catalog/useToolsCatalog";
import type { DataSection, EventCatalogFull, FaqItem, GuideContentBlock, GuideSection } from "../catalog/types";

function getGuideAnchorId(sectionId: string): string {
  return `guide-${sectionId}`;
}

function getDataAnchorId(sectionId: string): string {
  return `data-${sectionId}`;
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

function isSafeExternalHref(href: string): boolean {
  try {
    const url = new URL(href, window.location.origin);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

function getTabForAnchor(anchorId: string): string | null {
  if (anchorId.startsWith("guide-")) return "guide";
  if (anchorId.startsWith("data-")) return "data";
  if (anchorId.startsWith("faq-")) return "faq";
  if (anchorId.startsWith("task-")) return "tasks";
  return null;
}

function renderTextSegmentWithAnchors(
  segment: string,
  dataTitles: Map<string, string>,
  onAnchorClick: (anchorId: string) => void,
  sharedItems: Record<string, { label: string; link?: string; linkEnabled?: boolean }>,
  keyPrefix: string,
  options?: { currentAnchorId?: string; disableItemLinks?: boolean }
) {
  const parts = segment.split(/(#data-[A-Za-z0-9_-]+)/g);
  return parts.map((part, index) => {
    if (part.startsWith("#data-")) {
      const anchorId = part.slice(1);
      const label = anchorId === "data-lake_averages" ? "See Lake Averages" : dataTitles.get(anchorId) ?? "Open Data";
      return (
        <a
          key={`${keyPrefix}-data-${index}`}
          href={`#${anchorId}`}
          onClick={(e) => {
            e.preventDefault();
            onAnchorClick(anchorId);
          }}
          style={{ marginLeft: 6 }}
        >
          {label}
        </a>
      );
    }
    const tokenParts = part.split(/\{item:([A-Za-z0-9_-]+(?:\|nolink)?)\}/g);
    const nodes: ReactNode[] = [];
    for (let tokenIndex = 0; tokenIndex < tokenParts.length; tokenIndex += 1) {
      const tokenPart = tokenParts[tokenIndex];
      if (tokenIndex % 2 === 1) {
        const [itemIdRaw, tokenFlag] = tokenPart.split("|");
        const itemId = itemIdRaw;
        const item = sharedItems[itemId];
        let label = item?.label ?? itemId.replace(/_/g, " ");
        const link = item?.link;
        const linkEnabled = item?.linkEnabled !== false;
        const tokenNoLink = tokenFlag === "nolink";
        let suffix = "";
        const nextText = tokenParts[tokenIndex + 1];
        if (typeof nextText === "string") {
          if (nextText.startsWith("'s")) {
            suffix = "'s";
            tokenParts[tokenIndex + 1] = nextText.slice(2);
          } else if (nextText.startsWith("es")) {
            suffix = "es";
            tokenParts[tokenIndex + 1] = nextText.slice(2);
          } else if (nextText.startsWith("s")) {
            suffix = "s";
            tokenParts[tokenIndex + 1] = nextText.slice(1);
          }
        }
        if (suffix) label += suffix;
        if (
          link &&
          linkEnabled &&
          !tokenNoLink &&
          !options?.disableItemLinks &&
          link !== `#${options?.currentAnchorId}`
        ) {
          if (link.startsWith("#")) {
            const anchorId = link.slice(1);
            nodes.push(
              <a
                key={`${keyPrefix}-token-${index}-${tokenIndex}`}
                href={link}
                onClick={(e) => {
                  e.preventDefault();
                  onAnchorClick(anchorId);
                }}
              >
                {label}
              </a>
            );
          } else {
            if (isSafeExternalHref(link)) {
              nodes.push(
                <a key={`${keyPrefix}-token-${index}-${tokenIndex}`} href={link} target="_blank" rel="noreferrer">
                  {label}
                </a>
              );
            } else {
              nodes.push(<span key={`${keyPrefix}-token-${index}-${tokenIndex}`}>{label}</span>);
            }
          }
        } else {
          nodes.push(<span key={`${keyPrefix}-token-${index}-${tokenIndex}`}>{label}</span>);
        }
      } else if (tokenPart) {
        nodes.push(<span key={`${keyPrefix}-text-${index}-${tokenIndex}`}>{tokenPart}</span>);
      }
    }
    return nodes;
  });
}

function renderParagraphWithLinks(
  paragraph: string,
  dataTitles: Map<string, string>,
  onAnchorClick: (anchorId: string) => void,
  sharedItems: Record<string, { label: string }>,
  keyPrefix: string,
  onImageClick?: (src: string) => void,
  onImagePreview?: (src: string) => void
) {
  const nodes: ReactNode[] = [];
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let cursor = 0;
  let match = linkRegex.exec(paragraph);

  while (match) {
    const [full, label, href] = match;
    const start = match.index;
    if (start > cursor) {
      nodes.push(
        ...renderTextSegmentWithAnchors(
          paragraph.slice(cursor, start),
          dataTitles,
          onAnchorClick,
          sharedItems,
          `${keyPrefix}-seg-${cursor}`
        )
      );
    }

    if (href.startsWith("image:")) {
      const raw = href.slice("image:".length);
      const [imageSrc, ...flags] = raw.split("|");
      const wantsPreview = flags.includes("preview");
      nodes.push(
        <button
          key={`${keyPrefix}-link-${start}`}
          type="button"
          className="ghost"
          onClick={() => {
            if (wantsPreview) {
              onImagePreview?.(imageSrc);
              return;
            }
            onImageClick?.(imageSrc);
          }}
          style={{ padding: 0, fontSize: "inherit" }}
        >
          {label}
        </button>
      );
    } else if (href.startsWith("#")) {
      const anchorId = href.slice(1);
      nodes.push(
        <a
          key={`${keyPrefix}-link-${start}`}
          href={href}
          onClick={(e) => {
            e.preventDefault();
            onAnchorClick(anchorId);
          }}
        >
          {label}
        </a>
      );
    } else {
      if (isSafeExternalHref(href)) {
        nodes.push(
          <a key={`${keyPrefix}-link-${start}`} href={href} target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        );
      } else {
        nodes.push(<span key={`${keyPrefix}-link-${start}`}>{label}</span>);
      }
    }

    cursor = start + full.length;
    match = linkRegex.exec(paragraph);
  }

  if (cursor < paragraph.length) {
    nodes.push(
      ...renderTextSegmentWithAnchors(
        paragraph.slice(cursor),
        dataTitles,
        onAnchorClick,
        sharedItems,
        `${keyPrefix}-seg-${cursor}`
      )
    );
  }

  return nodes;
}

function renderParagraphOrImage(
  paragraph: string,
  dataTitles: Map<string, string>,
  onAnchorClick: (anchorId: string) => void,
  sharedItems: Record<string, { label: string }>,
  keyPrefix: string,
  onImageClick?: (src: string) => void,
  onImagePreview?: (src: string) => void
) {
  const trimmed = paragraph.trim();
  const imageMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"([^\"]+)\")?\)$/);
  if (imageMatch) {
    const alt = imageMatch[1] || undefined;
    const src = imageMatch[2];
    const caption = imageMatch[3] || undefined;
    return (
      <figure
        key={`${keyPrefix}-image`}
        style={{ margin: "12px 0", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}
      >
        <img
          src={resolveImageSrc(src)}
          alt={alt ?? ""}
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
          data-zoom-src={resolveImageSrc(src)}
        />
        {caption ? <figcaption style={{ fontSize: 12, color: "var(--text-subtle)", marginTop: 6 }}>{caption}</figcaption> : null}
      </figure>
    );
  }
  return (
    <p key={`${keyPrefix}-text`} style={{ margin: "8px 0" }}>
      {renderParagraphWithLinks(paragraph, dataTitles, onAnchorClick, sharedItems, keyPrefix, onImageClick, onImagePreview)}
    </p>
  );
}

function renderFaqAnswer(
  item: FaqItem,
  dataTitles: Map<string, string>,
  onAnchorClick: (anchorId: string) => void,
  sharedItems: Record<string, { label: string }>,
  onImageClick?: (src: string) => void,
  onImagePreview?: (src: string) => void
) {
  if (item.answerBlocks?.length) {
    return renderGuideBlocks(item.answerBlocks, dataTitles, onAnchorClick, sharedItems, onImageClick, onImagePreview);
  }
  if (!item.answer) return null;
  return item.answer
    .split(/\n{2,}/)
    .map((paragraph, index) =>
      renderParagraphOrImage(paragraph, dataTitles, onAnchorClick, sharedItems, `faq-${index}`, onImageClick, onImagePreview)
    );
}

function resolveImageSrc(src: string): string {
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) {
    return src;
  }
  if (src.startsWith("/")) return src;
  return `${import.meta.env.BASE_URL}${src}`;
}

function renderGuideBlocks(
  blocks: GuideContentBlock[],
  dataTitles: Map<string, string>,
  onAnchorClick: (anchorId: string) => void,
  sharedItems: Record<string, { label: string }>,
  onImageClick?: (src: string) => void,
  onImagePreview?: (src: string) => void
) {
  if (!blocks.length) return null;
  return blocks.map((block, index) => {
    if (block.type === "paragraph") {
      return renderParagraphOrImage(
        block.text,
        dataTitles,
        onAnchorClick,
        sharedItems,
        `guide-${index}`,
        onImageClick,
        onImagePreview
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

    const isMilestoneRow = block.images.every((image) => image.src.includes("vv_milestones_"));
    return (
      <div
        key={`row-${index}`}
        style={{
          display: "flex",
          flexWrap: isMilestoneRow ? "nowrap" : "wrap",
          gap: 12,
          justifyContent: "center",
          margin: "12px 0",
          overflowX: isMilestoneRow ? "auto" : "visible",
        }}
      >
        {block.images.map((image, imageIndex) => {
          const isMilestone = image.src.includes("vv_milestones_");
          const figureMaxWidth = isMilestone ? 160 : 240;
          const imageStyle = {
            width: "100%",
            maxHeight: isMilestone ? 360 : 260,
            objectFit: "contain" as const,
            borderRadius: isMilestone ? 6 : 10,
            border: isMilestone ? "none" : "1px solid var(--border)",
            display: "block",
            cursor: "zoom-in",
          };
          return (
          <figure
            key={`row-${index}-${image.src}-${imageIndex}`}
            style={{
              margin: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              flex: `1 1 ${figureMaxWidth}px`,
              maxWidth: figureMaxWidth,
            }}
          >
            <img
              src={resolveImageSrc(image.src)}
              alt={image.alt ?? ""}
              style={imageStyle}
              data-zoom-src={resolveImageSrc(image.src)}
            />
            {image.caption ? <figcaption style={{ fontSize: 12, color: "var(--text-subtle)", marginTop: 6 }}>{image.caption}</figcaption> : null}
          </figure>
        );
        })}
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
        } else if (block.type === "paragraph") {
          const inlineMatches = [...block.text.matchAll(/\[([^\]]+)\]\(image:([^)]+)\)/g)];
          for (const match of inlineMatches) {
            const alt = match[1] ?? "";
            const raw = match[2] ?? "";
            const [src] = raw.split("|");
            if (!src) continue;
            out.push({
              src: resolveImageSrc(src),
              alt,
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

function collectGuideAnchorIds(sections: GuideSection[], out: string[] = []): string[] {
  for (const section of sections) {
    out.push(getGuideAnchorId(section.sectionId));
    if (section.subsections?.length) {
      collectGuideAnchorIds(section.subsections, out);
    }
  }
  return out;
}

function collectFaqImages(items: FaqItem[]): GuideImageItem[] {
  const images: GuideImageItem[] = [];
  for (const item of items) {
    if (item.answerBlocks?.length) {
      for (const block of item.answerBlocks) {
        if (block.type === "image") {
          images.push({
            src: resolveImageSrc(block.src),
            alt: block.alt ?? "",
            caption: block.caption,
          });
        } else if (block.type === "image_row") {
          for (const image of block.images) {
            images.push({
              src: resolveImageSrc(image.src),
              alt: image.alt ?? "",
              caption: image.caption,
            });
          }
        } else if (block.type === "paragraph") {
          const inlineMatches = [...block.text.matchAll(/\[([^\]]+)\]\(image:([^)]+)\)/g)];
          for (const match of inlineMatches) {
            const alt = match[1] ?? "";
            const raw = match[2] ?? "";
            const [src] = raw.split("|");
            if (!src) continue;
            images.push({
              src: resolveImageSrc(src),
              alt,
            });
          }
          const markdownMatches = [...block.text.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"([^\"]+)\")?\)/g)];
          for (const match of markdownMatches) {
            const alt = match[1] ?? "";
            const src = match[2];
            const caption = match[3];
            if (!src) continue;
            images.push({
              src: resolveImageSrc(src),
              alt,
              caption,
            });
          }
        }
      }
      continue;
    }

    const paragraphs = item.answer.split(/\n{2,}/);
    for (const paragraph of paragraphs) {
      const trimmed = paragraph.trim();
      const imageMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"([^\"]+)\")?\)$/);
      if (!imageMatch) continue;
      const alt = imageMatch[1] || "";
      const src = imageMatch[2];
      const caption = imageMatch[3] || undefined;
      images.push({
        src: resolveImageSrc(src),
        alt,
        caption,
      });
    }
    const inlineMatches = [...item.answer.matchAll(/\[([^\]]+)\]\(image:([^)]+)\)/g)];
    for (const match of inlineMatches) {
      const alt = match[1] ?? "";
      const raw = match[2] ?? "";
      const [src] = raw.split("|");
      if (!src) continue;
      images.push({
        src: resolveImageSrc(src),
        alt,
      });
    }
    const markdownMatches = [...item.answer.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"([^\"]+)\")?\)/g)];
    for (const match of markdownMatches) {
      const alt = match[1] ?? "";
      const src = match[2];
      const caption = match[3];
      if (!src) continue;
      images.push({
        src: resolveImageSrc(src),
        alt,
        caption,
      });
    }
  }
  return images;
}

function collectDataAnchorIds(sections: DataSection[], out: string[] = []): string[] {
  for (const section of sections) {
    out.push(getDataAnchorId(section.sectionId));
    if (section.subsections?.length) {
      collectDataAnchorIds(section.subsections, out);
    }
  }
  return out;
}

function GuideSectionView({
  section,
  copiedAnchor,
  onCopyLink,
  onAnchorClick,
  tabId,
  openState,
  onToggleOpen,
  dataTitles,
  sharedItems,
  onImageClick,
  onImagePreview,
}: {
  section: GuideSection;
  copiedAnchor: string;
  onCopyLink: (anchorId: string) => void;
  onAnchorClick: (anchorId: string) => void;
  tabId: string;
  openState: Record<string, boolean>;
  onToggleOpen: (tabId: string, anchorId: string, isOpen: boolean) => void;
  dataTitles: Map<string, string>;
  sharedItems: Record<string, { label: string }>;
  onImageClick?: (src: string) => void;
  onImagePreview?: (src: string) => void;
}) {
  const anchorId = getGuideAnchorId(section.sectionId);
  return (
    <details
      id={anchorId}
      open={Boolean(openState[anchorId])}
      onToggle={(e) => onToggleOpen(tabId, anchorId, (e.currentTarget as HTMLDetailsElement).open)}
      style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px", background: "var(--surface)", scrollMarginTop: 90 }}
    >
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
      <div style={{ marginTop: 8 }}>
        {renderGuideBlocks(section.blocks, dataTitles, onAnchorClick, sharedItems, onImageClick, onImagePreview)}
      </div>
      {section.subsections && section.subsections.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          {section.subsections.map((child) => (
            <GuideSectionView
              key={child.sectionId}
              section={child}
              copiedAnchor={copiedAnchor}
              onCopyLink={onCopyLink}
              onAnchorClick={onAnchorClick}
              tabId={tabId}
              openState={openState}
              onToggleOpen={onToggleOpen}
              dataTitles={dataTitles}
              sharedItems={sharedItems}
              onImageClick={onImageClick}
              onImagePreview={onImagePreview}
            />
          ))}
        </div>
      ) : null}
    </details>
  );
}

export default function EventDetail() {
  const { eventId } = useParams();
  const decodedEventId = useMemo(() => {
    try {
      return eventId ? decodeURIComponent(eventId) : "";
    } catch {
      return eventId ?? "";
    }
  }, [eventId]);
  const devModeEnabled = useMemo(() => import.meta.env.DEV && localStorage.getItem("dev_mode") === "1", []);
  const eventState = useEventCatalog(decodedEventId);

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

  if (eventState.status === "ready" && eventState.event.status === "coming_soon" && !devModeEnabled) {
    return (
      <AppShell>
        <h1>{eventState.event.title}</h1>
        <p style={{ color: "var(--text-muted)" }}>Coming Soon</p>
      </AppShell>
    );
  }

  return <EventDetailContent event={eventState.event} />;
}

function DataSectionView({
  section,
  copiedAnchor,
  onCopyLink,
  onAnchorClick,
  tabId,
  openState,
  onToggleOpen,
  dataTitles,
  sharedItems,
  onImageClick,
  onImagePreview,
}: {
  section: DataSection;
  copiedAnchor: string;
  onCopyLink: (anchorId: string) => void;
  onAnchorClick: (anchorId: string) => void;
  tabId: string;
  openState: Record<string, boolean>;
  onToggleOpen: (tabId: string, anchorId: string, isOpen: boolean) => void;
  dataTitles: Map<string, string>;
  sharedItems: Record<string, { label: string }>;
  onImageClick?: (src: string) => void;
  onImagePreview?: (src: string) => void;
}) {
  const anchorId = getDataAnchorId(section.sectionId);
  return (
    <details
      id={anchorId}
      open={Boolean(openState[anchorId])}
      onToggle={(e) => onToggleOpen(tabId, anchorId, (e.currentTarget as HTMLDetailsElement).open)}
      style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px", background: "var(--surface)", scrollMarginTop: 90 }}
    >
      <summary className="detailsSummary" style={{ cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
        <span aria-hidden="true" className="detailsChevron">
          ▸
        </span>
        <span style={{ flex: 1 }}>{section.title}</span>
        <span style={{ fontSize: 12, color: "var(--text-subtle)", minWidth: 52, textAlign: "right" }}>{copiedAnchor === anchorId ? "Copied" : ""}</span>
        <button
          type="button"
          onClick={() => onCopyLink(anchorId)}
          aria-label="Copy link to data section"
          style={{ background: "transparent", border: "none", padding: 0, display: "flex", alignItems: "center", cursor: "pointer" }}
        >
          <LinkIcon />
        </button>
      </summary>
      <div style={{ marginTop: 8 }}>
        {renderGuideBlocks(section.blocks, dataTitles, onAnchorClick, sharedItems, onImageClick, onImagePreview)}
      </div>
      {section.subsections && section.subsections.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          {section.subsections.map((child) => (
            <DataSectionView
              key={child.sectionId}
              section={child}
              copiedAnchor={copiedAnchor}
              onCopyLink={onCopyLink}
              onAnchorClick={onAnchorClick}
              tabId={tabId}
              openState={openState}
              onToggleOpen={onToggleOpen}
              dataTitles={dataTitles}
              sharedItems={sharedItems}
              onImageClick={onImageClick}
              onImagePreview={onImagePreview}
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

function EventDetailContent({ event }: { event: EventCatalogFull }) {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const [faqQuery, setFaqQuery] = useState("");
  const [activeAnchor, setActiveAnchor] = useState("");
  const [activeTabId, setActiveTabId] = useState("tasks");
  const [copiedAnchor, setCopiedAnchor] = useState("");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lightboxScale, setLightboxScale] = useState(1);
  const [inlinePreviewSrc, setInlinePreviewSrc] = useState<string | null>(null);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [tasksSheetOffset, setTasksSheetOffset] = useState(0);
  const [tasksSheetDragging, setTasksSheetDragging] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [shopQuantities, setShopQuantities] = useState<Record<string, number>>({});
  const [activeShopItemId, setActiveShopItemId] = useState<string | null>(null);
  const [openDetailsByTab, setOpenDetailsByTab] = useState<Record<string, Record<string, boolean>>>({});
  const [lastActiveTabByEvent, setLastActiveTabByEvent] = useState<Record<string, string>>({});
  const tasksScrollRef = useRef<HTMLDivElement | null>(null);
  const tasksSheetStartRef = useRef<number | null>(null);
  const tasksSheetStartOffsetRef = useRef(0);
  const tasksSheetDragActiveRef = useRef(false);
  const tasksSheetCloseTimerRef = useRef<number | null>(null);
  const tasksSheetPointerInScrollRef = useRef(false);
  const scrollPositionsRef = useRef<Map<string, number>>(new Map());
  const programmaticNavRef = useRef(false);
  const pendingScrollRestoreRef = useRef<number | null>(null);
  const scrollUpdateRef = useRef<number | null>(null);
  const pendingTabRef = useRef<string | null>(null);
  const uiRestoredRef = useRef(false);
  const allowUiSaveRef = useRef(false);
  const restoredUiRef = useRef(false);
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

  const restoreScrollLock = useCallback(() => {
    if (!scrollLockRef.current) return;
    const lockedScrollY = scrollLockRef.current.scrollY;
    document.body.style.overflow = scrollLockRef.current.bodyOverflow;
    document.body.style.paddingRight = scrollLockRef.current.bodyPaddingRight;
    document.documentElement.style.overflow = scrollLockRef.current.htmlOverflow;
    document.body.style.position = scrollLockRef.current.bodyPosition;
    document.body.style.top = scrollLockRef.current.bodyTop;
    document.body.style.width = scrollLockRef.current.bodyWidth;
    scrollLockRef.current = null;
    window.scrollTo(0, lockedScrollY);
  }, []);

  useEffect(() => {
    const saved = getEventShopQuantities(event.eventId, event.eventVersion);
    if (Object.keys(saved).length) {
      setShopQuantities(saved);
    }
  }, [event.eventId, event.eventVersion]);

  const urlTab = useMemo(() => new URLSearchParams(location.search).get("tab") ?? "", [location.search]);
  const isFreshEntry = navigationType === "PUSH" && !urlTab && !location.hash;

  const toolState = useToolsCatalog(event.toolRefs.map((ref) => ref.toolId));
  const sharedItemsState = useSharedItems();
  const sharedItems = sharedItemsState.status === "ready" ? sharedItemsState.items : {};
  const guideImages = useMemo(() => {
    const images = collectGuideImages(event.guideSections);
    return images.concat(collectFaqImages(event.faqItems));
  }, [event]);
  const shopSections = event.shop?.sections ?? [];
  const prevShopOpenRef = useRef(false);

  function normalizeRarity(value?: string) {
    if (!value) return undefined;
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  }

  function setShopQuantity(shopItemId: string, value: number) {
    const next = Math.max(0, value);
    setShopQuantities((prev) => ({ ...prev, [shopItemId]: next }));
    setEventShopQuantity(event.eventId, event.eventVersion, shopItemId, next);
  }

  const shopTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const section of shopSections) {
      for (const item of section.items) {
        const qty = shopQuantities[item.shopItemId] ?? 0;
        if (qty <= 0) continue;
        totals[item.costItemId] = (totals[item.costItemId] ?? 0) + qty * item.cost;
      }
    }
    return totals;
  }, [shopQuantities, shopSections]);

  function applyShopToPurchaseGoals() {
    const numericPurchase: Record<string, number> = {};
    const numericGold: Record<string, number> = {};
    for (const section of shopSections) {
      for (const item of section.items) {
        if (!item.goalGroup || !item.goalKey) continue;
        const qty = shopQuantities[item.shopItemId] ?? 0;
        if (qty <= 0) continue;
        if (item.goalGroup === "silver") {
          numericPurchase[item.goalKey] = (numericPurchase[item.goalKey] ?? 0) + qty;
        } else if (item.goalGroup === "gold") {
          numericGold[item.goalKey] = (numericGold[item.goalKey] ?? 0) + qty;
        }
      }
    }

    const purchaseCounts = {
      etchedRune: numericPurchase.etchedRune ?? 0,
      blessingRune: numericPurchase.blessingRune ?? 0,
      artifact: numericPurchase.artifact ?? 0,
    };
    const goldPurchaseCounts = {
      etchedRune: numericGold.etchedRune ?? 0,
      advancedEnchantium: numericGold.advancedEnchantium ?? 0,
      ruinShovelBundle: numericGold.ruinShovelBundle ?? 0,
      promisedShovelBundle: numericGold.promisedShovelBundle ?? 0,
      chromaticKeyBundle: numericGold.chromaticKeyBundle ?? 0,
    };

    const normalizedPurchase = {
      etchedRune: purchaseCounts.etchedRune > 0 ? purchaseCounts.etchedRune : null,
      blessingRune: purchaseCounts.blessingRune > 0 ? purchaseCounts.blessingRune : null,
      artifact: purchaseCounts.artifact > 0 ? purchaseCounts.artifact : null,
    };
    const normalizedGold = {
      etchedRune: goldPurchaseCounts.etchedRune > 0 ? goldPurchaseCounts.etchedRune : null,
      advancedEnchantium: goldPurchaseCounts.advancedEnchantium > 0 ? goldPurchaseCounts.advancedEnchantium : null,
      ruinShovelBundle: goldPurchaseCounts.ruinShovelBundle > 0 ? goldPurchaseCounts.ruinShovelBundle : null,
      promisedShovelBundle: goldPurchaseCounts.promisedShovelBundle > 0 ? goldPurchaseCounts.promisedShovelBundle : null,
      chromaticKeyBundle: goldPurchaseCounts.chromaticKeyBundle > 0 ? goldPurchaseCounts.chromaticKeyBundle : null,
    };

    const stateKey = "archero2.tool.fishing_companion.v1";
    const storageKey = `archero2_tool_state_${stateKey}`;
    try {
      const existingRaw = localStorage.getItem(storageKey);
      const existing = existingRaw ? (JSON.parse(existingRaw) as Record<string, unknown>) : {};
      const nextState = {
        ...existing,
        purchaseCounts: normalizedPurchase,
        goldPurchaseCounts: normalizedGold,
      };
      localStorage.setItem(storageKey, JSON.stringify(nextState));
      window.dispatchEvent(
        new CustomEvent("purchase-goals-apply", {
          detail: { stateKey, purchaseCounts: normalizedPurchase, goldPurchaseCounts: normalizedGold },
        })
      );
    } catch (error) {
      console.error("Failed to apply purchase goals from shop.", error);
    }
  }

  useEffect(() => {
    const wasOpen = prevShopOpenRef.current;
    prevShopOpenRef.current = shopOpen;
    if (!wasOpen || shopOpen || !shopSections.length) return;
    const timeout = window.setTimeout(() => {
      applyShopToPurchaseGoals();
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [shopOpen, shopQuantities, shopSections]);

  function openGuideImageBySrc(src: string) {
    if (!src) return;
    const resolved = resolveImageSrc(src);
    const index = guideImages.findIndex((item) => item.src === resolved);
    setLightboxIndex(index >= 0 ? index : 0);
    setLightboxScale(1);
    touchStartXRef.current = null;
    touchDeltaXRef.current = 0;
    pinchStartDistanceRef.current = null;
    pinchStartScaleRef.current = 1;
  }

  function openInlinePreview(src: string) {
    if (!src) return;
    setInlinePreviewSrc(resolveImageSrc(src));
  }

  function closeInlinePreview() {
    setInlinePreviewSrc(null);
  }

  useEffect(() => {
    const key = `archero2_event_ui_${event.eventId}`;
    if (isFreshEntry) {
      setActiveTabId("tools");
      setOpenDetailsByTab({});
      scrollPositionsRef.current = new Map();
      uiRestoredRef.current = true;
      restoredUiRef.current = true;
      allowUiSaveRef.current = true;
      return;
    }
    const raw = sessionStorage.getItem(key);
    if (!raw) {
      uiRestoredRef.current = true;
      allowUiSaveRef.current = true;
      return;
    }
    try {
      const parsed = JSON.parse(raw) as {
        activeTabId?: string;
        openDetailsByTab?: Record<string, Record<string, boolean>>;
        scrollPositions?: Record<string, number>;
      };
      const urlTab = new URLSearchParams(window.location.search).get("tab");
      const hasHash = Boolean(window.location.hash);
      const savedScrollPositions = parsed.scrollPositions ?? {};
      if (!hasHash && !urlTab && parsed.activeTabId) {
        setActiveTabId(parsed.activeTabId);
        setLastActiveTabByEvent((prev) => ({ ...prev, [event.eventId]: parsed.activeTabId! }));
        restoredUiRef.current = true;
        const saved = savedScrollPositions[`tab:${parsed.activeTabId}`];
        if (typeof saved === "number") {
          pendingScrollRestoreRef.current = saved;
        }
      }
      if (parsed.openDetailsByTab) {
        setOpenDetailsByTab(parsed.openDetailsByTab);
      }
      if (parsed.scrollPositions) {
        scrollPositionsRef.current = new Map(
          Object.entries(parsed.scrollPositions).map(([key, value]) => [key, Number(value)])
        );
      }
      uiRestoredRef.current = true;
      window.requestAnimationFrame(() => {
        allowUiSaveRef.current = true;
      });
    } catch {
      // Ignore stored UI state parse errors.
      uiRestoredRef.current = true;
      allowUiSaveRef.current = true;
    }
  }, [event.eventId, isFreshEntry]);

  useEffect(() => {
    if (!uiRestoredRef.current) return;
    if (!allowUiSaveRef.current) return;
    const key = `archero2_event_ui_${event.eventId}`;
    const payload = {
      activeTabId,
      openDetailsByTab,
      scrollPositions: Object.fromEntries(scrollPositionsRef.current),
    };
    sessionStorage.setItem(key, JSON.stringify(payload));
  }, [event.eventId, activeTabId, openDetailsByTab]);

  function setDetailOpen(tabId: string, anchorId: string, isOpen: boolean) {
    setOpenDetailsByTab((prev) => {
      const nextTab = { ...(prev[tabId] ?? {}) };
      if (isOpen) {
        nextTab[anchorId] = true;
      } else {
        delete nextTab[anchorId];
      }
      return { ...prev, [tabId]: nextTab };
    });
  }

  function setAllDetails(tabId: string, anchorIds: string[], isOpen: boolean) {
    setOpenDetailsByTab((prev) => {
      if (!isOpen) {
        return { ...prev, [tabId]: {} };
      }
      const nextTab: Record<string, boolean> = {};
      for (const anchorId of anchorIds) {
        nextTab[anchorId] = true;
      }
      return { ...prev, [tabId]: nextTab };
    });
  }

  function getTabFromLocation() {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    return tab;
  }

  function storeScrollPosition() {
    const hash = window.location.hash.replace(/^#/, "");
    if (hash) {
      let decodedHash = hash;
      try {
        decodedHash = decodeURIComponent(hash);
      } catch {
        decodedHash = hash;
      }
      scrollPositionsRef.current.set(decodedHash, window.scrollY);
      return;
    }
    scrollPositionsRef.current.set(`tab:${activeTabId}`, window.scrollY);
  }

  useEffect(() => {
    function syncHash() {
      if (programmaticNavRef.current) {
        programmaticNavRef.current = false;
        return;
      }
      const hash = window.location.hash.replace(/^#/, "");
      let decodedHash = hash;
      try {
        decodedHash = decodeURIComponent(hash);
      } catch {
        decodedHash = hash;
      }
      if (!programmaticNavRef.current) {
        if (decodedHash) {
          const saved = scrollPositionsRef.current.get(decodedHash);
          pendingScrollRestoreRef.current = typeof saved === "number" ? saved : null;
        } else {
          const tabKey = getTabFromLocation() ?? activeTabId;
          const saved = scrollPositionsRef.current.get(`tab:${tabKey}`);
          pendingScrollRestoreRef.current = typeof saved === "number" ? saved : null;
        }
      } else {
        programmaticNavRef.current = false;
        pendingScrollRestoreRef.current = null;
      }
      setActiveAnchor(decodedHash);
      if (!decodedHash) {
        const nextTab = getTabFromLocation();
        if (nextTab && nextTab !== activeTabId) setActiveTabId(nextTab);
      }
    }

    syncHash();
    window.addEventListener("hashchange", syncHash);
    window.addEventListener("popstate", syncHash);
    return () => {
      window.removeEventListener("hashchange", syncHash);
      window.removeEventListener("popstate", syncHash);
    };
  }, [event.eventId]);

  useEffect(() => {
    function handleScroll() {
      if (scrollUpdateRef.current !== null) return;
      scrollUpdateRef.current = window.requestAnimationFrame(() => {
        scrollUpdateRef.current = null;
        storeScrollPosition();
      });
    }
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (scrollUpdateRef.current !== null) {
        window.cancelAnimationFrame(scrollUpdateRef.current);
        scrollUpdateRef.current = null;
      }
    };
  }, [event.eventId]);

  useEffect(() => {
    const nextTab = getTabForAnchor(activeAnchor);
    if (nextTab) {
      setActiveTabId(nextTab);
    }
  }, [activeAnchor, tasksOpen]);

  useEffect(() => {
    setLastActiveTabByEvent((prev) => {
      if (prev[event.eventId] === activeTabId) return prev;
      return { ...prev, [event.eventId]: activeTabId };
    });
  }, [event.eventId, activeTabId]);

  useEffect(() => {
    if (pendingScrollRestoreRef.current !== null) {
      const y = pendingScrollRestoreRef.current;
      pendingScrollRestoreRef.current = null;
      window.scrollTo({ top: y, behavior: "auto" });
      return;
    }
    if (!activeAnchor) return;
    if (activeAnchor.startsWith("task-")) {
      if (!tasksOpen) {
        openTasksSheet();
        return;
      }
      if (lastHandledAnchorRef.current === activeAnchor) return;
      lastHandledAnchorRef.current = activeAnchor;
      const taskEl = document.getElementById(activeAnchor);
      if (taskEl) {
        taskEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
    if (lastHandledAnchorRef.current === activeAnchor) return;
    lastHandledAnchorRef.current = activeAnchor;
    const anchorEl = document.getElementById(activeAnchor);
    const tabForAnchor = getTabForAnchor(activeAnchor) ?? activeTabId;
    let parent = anchorEl?.parentElement ?? null;
    while (parent) {
      if (parent.tagName === "DETAILS") {
        (parent as HTMLDetailsElement).open = true;
        if (parent.id) {
          setDetailOpen(tabForAnchor, parent.id, true);
        }
      }
      parent = parent.parentElement;
    }
    if (anchorEl && anchorEl.tagName === "DETAILS") {
      (anchorEl as HTMLDetailsElement).open = true;
      if (anchorEl.id) {
        setDetailOpen(tabForAnchor, anchorEl.id, true);
      }
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
  }, [activeAnchor, tasksOpen]);

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
    if (activeAnchor.startsWith("task-")) {
      setActiveAnchor("");
    }
    if (tasksSheetCloseTimerRef.current !== null) {
      window.clearTimeout(tasksSheetCloseTimerRef.current);
    }
    tasksSheetCloseTimerRef.current = window.setTimeout(() => {
      setTasksOpen(false);
      setTasksSheetOffset(0);
    }, 240);
  }

  useEffect(() => {
    if (isFreshEntry) return;
    const hash = window.location.hash.replace(/^#/, "");
    const nextAnchor = hash ? decodeURIComponent(hash) : "";
    const nextTab = nextAnchor ? getTabForAnchor(nextAnchor) : null;
    const storedTab = lastActiveTabByEvent[event.eventId] ?? null;

    if (pendingTabRef.current && urlTab !== pendingTabRef.current) {
      return;
    }
    if (pendingTabRef.current && urlTab === pendingTabRef.current) {
      pendingTabRef.current = null;
    }

    if (nextTab) {
      if (activeTabId !== nextTab) {
        setActiveTabId(nextTab);
      }
      return;
    }

    if (urlTab) {
      if (activeTabId !== urlTab) {
        setActiveTabId(urlTab);
      }
      if (!hash) {
        if (activeAnchor) {
          setActiveAnchor("");
        }
        const saved = scrollPositionsRef.current.get(`tab:${urlTab}`);
        if (typeof saved === "number") {
          pendingScrollRestoreRef.current = saved;
        }
      }
    } else if (!restoredUiRef.current) {
      const next = nextTab ?? storedTab ?? "tasks";
      if (activeTabId !== next) {
        setActiveTabId(next);
      }
    }
  }, [activeAnchor, activeTabId, event.eventId, isFreshEntry, lastActiveTabByEvent, urlTab]);

  useEffect(() => {
    if (activeTabId === "faq") return;
    if (faqQuery) {
      setFaqQuery("");
    }
  }, [activeTabId, faqQuery]);

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
    const shouldLock = tasksOpen || lightboxIndex !== null || inlinePreviewSrc !== null || shopOpen;
    if (!shouldLock) {
      restoreScrollLock();
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
  }, [inlinePreviewSrc, lightboxIndex, restoreScrollLock, shopOpen, tasksOpen]);

  useEffect(() => {
    return () => {
      restoreScrollLock();
    };
  }, [restoreScrollLock]);

  function openTasksSheet() {
    const height = Math.round(window.innerHeight * 0.8);
    setTasksSheetOffset(height);
    setTasksOpen(true);
  }

  async function copyAnchorLink(anchorId: string) {
    const hash = `#${encodeURIComponent(anchorId)}`;
    if (window.location.hash !== hash) {
      storeScrollPosition();
      programmaticNavRef.current = true;
      const params = new URLSearchParams(location.search);
      params.set("tab", getTabForAnchor(anchorId) ?? activeTabId);
      navigate({ pathname: location.pathname, search: `?${params.toString()}`, hash }, { replace: false });
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

  const dataTitles = useMemo(() => {
    const map = new Map<string, string>();
    function walk(sections: GuideSection[]) {
      for (const section of sections) {
        map.set(getDataAnchorId(section.sectionId), section.title);
        if (section.subsections?.length) walk(section.subsections);
      }
    }
    walk(event.dataSections);
    return map;
  }, [event]);

  const effectiveToolCount = toolState.status === "ready" ? toolState.tools.length : event.sections.toolCount;

  const defaultTabId = useMemo(() => {
    const candidates = [
      { id: "tools", hidden: effectiveToolCount === 0 },
      { id: "guide", hidden: event.sections.guideSectionCount === 0 },
      { id: "faq", hidden: event.sections.faqCount === 0 },
      { id: "data", hidden: event.sections.dataSectionCount === 0 },
    ];
    return candidates.find((tab) => !tab.hidden)?.id ?? "guide";
  }, [effectiveToolCount, event]);

  useEffect(() => {
    if (!defaultTabId) return;
    const hash = window.location.hash.replace(/^#/, "");
    if (urlTab || hash) return;
    if (activeTabId !== defaultTabId) {
      setActiveTabId(defaultTabId);
      setActiveAnchor("");
    }
    const params = new URLSearchParams(location.search);
    params.set("tab", defaultTabId);
    navigate({ pathname: location.pathname, search: `?${params.toString()}`, hash: "" }, { replace: true });
  }, [activeTabId, defaultTabId, location.pathname, location.search, navigate, urlTab]);

  const ev = event;
  const filteredFaq = filterFaqItems(ev.faqItems, faqQuery);

  function navigateToAnchor(anchorId: string) {
    const hash = `#${encodeURIComponent(anchorId)}`;
    if (window.location.hash !== hash) {
      storeScrollPosition();
      programmaticNavRef.current = true;
      const params = new URLSearchParams(location.search);
      params.set("tab", getTabForAnchor(anchorId) ?? activeTabId);
      navigate({ pathname: location.pathname, search: `?${params.toString()}`, hash }, { replace: false });
    } else {
      setActiveAnchor(anchorId);
    }
    const nextTab = getTabForAnchor(anchorId);
    if (nextTab) {
      setActiveTabId(nextTab);
      if (anchorId.startsWith(`${nextTab}-`)) {
        setDetailOpen(nextTab, anchorId, true);
      }
    }
  }

  function handleTabChange(nextTabId: string) {
    if (nextTabId === activeTabId) return;
    storeScrollPosition();
    programmaticNavRef.current = true;
    pendingTabRef.current = nextTabId;
    setActiveTabId(nextTabId);
    setActiveAnchor("");
    const params = new URLSearchParams(location.search);
    params.set("tab", nextTabId);
    navigate({ pathname: location.pathname, search: `?${params.toString()}`, hash: "" }, { replace: false });
    const saved = scrollPositionsRef.current.get(`tab:${nextTabId}`);
    if (typeof saved === "number") {
      pendingScrollRestoreRef.current = saved;
    }
  }

  const tabs = [
    {
      id: "tools",
      label: `Tools (${effectiveToolCount})`,
      hidden: effectiveToolCount === 0,
      content:
        toolState.status === "loading" ? (
          <p>Loading tools…</p>
        ) : toolState.status === "error" ? (
          <p style={{ color: "var(--danger)" }}>Tools error: {toolState.error}</p>
        ) : toolState.status === "ready" && toolState.tools.length ? (
          <ToolsHost
            tools={toolState.tools}
            eventId={ev.eventId}
            eventVersion={ev.eventVersion}
            tasks={ev.tasks}
            taskGroupLabels={ev.taskGroupLabels}
            guidedRoutePath={ev.guidedRoutePath}
          />
        ) : (
          <p>No tools available for this event yet.</p>
        ),
    },
    {
      id: "guide",
      label: `Guide (${ev.sections.guideSectionCount})`,
      content: ev.guideSections.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }} onClick={handleGuideImageClick}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              className="ghost"
              onClick={() => setAllDetails("guide", collectGuideAnchorIds(ev.guideSections), true)}
            >
              Expand all
            </button>
            <button type="button" className="ghost" onClick={() => setAllDetails("guide", [], false)}>
              Collapse all
            </button>
          </div>
          {ev.guideSections.map((section) => (
            <GuideSectionView
              key={section.sectionId}
              section={section}
              copiedAnchor={copiedAnchor}
              onCopyLink={copyAnchorLink}
              onAnchorClick={navigateToAnchor}
              tabId="guide"
              openState={openDetailsByTab.guide ?? {}}
              onToggleOpen={setDetailOpen}
              dataTitles={dataTitles}
              sharedItems={sharedItems}
              onImageClick={openGuideImageBySrc}
              onImagePreview={openInlinePreview}
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
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }} onClick={handleGuideImageClick}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              className="ghost"
              onClick={() => setAllDetails("faq", filteredFaq.map((item) => getFaqAnchorId(item.faqId)), true)}
            >
              Expand all
            </button>
            <button type="button" className="ghost" onClick={() => setAllDetails("faq", [], false)}>
              Collapse all
            </button>
          </div>
          <input type="text" value={faqQuery} onChange={(e) => setFaqQuery(e.target.value)} placeholder="Search FAQ..." style={{ maxWidth: 420 }} />
          {filteredFaq.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {filteredFaq.map((item) => (
                <details
                  key={item.faqId}
                  id={getFaqAnchorId(item.faqId)}
                  open={Boolean((openDetailsByTab.faq ?? {})[getFaqAnchorId(item.faqId)])}
                  onToggle={(e) =>
                    setDetailOpen("faq", getFaqAnchorId(item.faqId), (e.currentTarget as HTMLDetailsElement).open)
                  }
                  style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px", background: "var(--surface)", scrollMarginTop: 90 }}
                >
                  <summary className="detailsSummary" style={{ cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                    <span aria-hidden="true" className="detailsChevron">
                      ▸
                    </span>
                    <span style={{ flex: 1 }}>
                      {renderTextSegmentWithAnchors(item.question, dataTitles, navigateToAnchor, sharedItems, "faq-title")}
                    </span>
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
                  <div style={{ marginTop: 8 }}>
                    {renderFaqAnswer(item, dataTitles, navigateToAnchor, sharedItems, openGuideImageBySrc, openInlinePreview)}
                  </div>
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
      id: "data",
      label: `Data (${ev.sections.dataSectionCount})`,
      hidden: ev.sections.dataSectionCount === 0,
      content: ev.dataSections.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              className="ghost"
              onClick={() => setAllDetails("data", collectDataAnchorIds(ev.dataSections), true)}
            >
              Expand all
            </button>
            <button type="button" className="ghost" onClick={() => setAllDetails("data", [], false)}>
              Collapse all
            </button>
          </div>
          {ev.dataSections.map((section) => (
            <DataSectionView
              key={section.sectionId}
              section={section}
              copiedAnchor={copiedAnchor}
              onCopyLink={copyAnchorLink}
              onAnchorClick={navigateToAnchor}
              tabId="data"
              openState={openDetailsByTab.data ?? {}}
              onToggleOpen={setDetailOpen}
              dataTitles={dataTitles}
              sharedItems={sharedItems}
              onImageClick={openGuideImageBySrc}
              onImagePreview={openInlinePreview}
            />
          ))}
        </div>
      ) : (
        <p>No data sections yet.</p>
      ),
    },
    {
      id: "tasks",
      label: `Tasks (${ev.sections.taskCount})`,
      hidden: true,
      content: (
        <TasksTracker
          eventId={ev.eventId}
          eventVersion={ev.eventVersion}
          tasks={ev.tasks}
          taskGroupLabels={ev.taskGroupLabels}
          rewardAssets={ev.rewardAssets}
        />
      ),
    },
  ];

  return (
    <AppShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h1>{ev.title}</h1>
          {ev.taskCosts && ev.taskCosts.length ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {ev.taskCosts.map((cost) => (
                <span
                  key={cost.key}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 999,
                    padding: "2px 8px",
                    fontSize: 12,
                    background: "var(--surface-2)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <img
                    src={`${import.meta.env.BASE_URL}catalog/shared/items/currencies/${
                      cost.key === "gems"
                        ? "icon_gem.png"
                        : cost.key === "chromatic_keys"
                          ? "icon_chromatic_key.png"
                          : cost.key === "obsidian_keys"
                            ? "icon_obsidian_key.png"
                            : cost.key === "wish_tokens"
                              ? "icon_wish_coin.png"
                              : "icon_shovel.png"
                    }`}
                    alt=""
                    width={16}
                    height={16}
                    style={{ display: "block" }}
                  />
                  {cost.amount.toLocaleString()}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {shopSections.length ? (
            <button type="button" className="secondary" onClick={() => setShopOpen(true)}>
              Shop
            </button>
          ) : null}
          <button type="button" className="secondary" onClick={openTasksSheet}>
            Tasks
          </button>
        </div>
      </div>
      {(ev.status === "coming_soon" ? "Coming Soon" : ev.subtitle) ? (
        <p style={{ marginTop: 8 }}>{ev.status === "coming_soon" ? "Coming Soon" : ev.subtitle}</p>
      ) : null}
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
        .inlinePreviewOverlay {
          position: fixed;
          inset: 0;
          background: var(--overlay);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          z-index: 45;
        }
        .inlinePreviewCard {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 12px;
          max-width: min(360px, 85vw);
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
        }
        .inlinePreviewImage {
          width: 100%;
          max-height: 45vh;
          object-fit: contain;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.15);
          cursor: pointer;
          display: block;
        }
        .inlinePreviewActions {
          display: flex;
          justify-content: flex-end;
          margin-top: 8px;
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

      <Tabs tabs={tabs} activeId={activeTabId} onActiveIdChange={handleTabChange} />

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

      {inlinePreviewSrc ? (
        <div
          className="inlinePreviewOverlay"
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeInlinePreview();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") closeInlinePreview();
          }}
        >
          <div className="inlinePreviewCard">
            <img
              src={inlinePreviewSrc}
              alt=""
              className="inlinePreviewImage"
              onClick={() => openGuideImageBySrc(inlinePreviewSrc)}
            />
            <div className="inlinePreviewActions">
              <button type="button" className="secondary" onClick={closeInlinePreview}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {shopOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShopOpen(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--overlay)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            zIndex: 45,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(980px, 96vw)",
              maxHeight: "90vh",
              overflow: "auto",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 16,
              display: "grid",
              gap: 14,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontSize: 18, fontWeight: 800 }}>Event Shop</div>
              <button type="button" className="secondary" onClick={() => setShopOpen(false)}>
                Close
              </button>
            </div>
            {shopSections.length ? (
              shopSections.map((section) => (
                <div key={section.sectionId} style={{ display: "grid", gap: 10 }}>
                  {section.title ? <div style={{ fontWeight: 700 }}>{section.title}</div> : null}
                  <div
                    style={{
                      display: "grid",
                      gap: 12,
                      gridTemplateColumns: "repeat(auto-fit, 160px)",
                      justifyContent: "start",
                      alignItems: "stretch",
                    }}
                  >
                    {section.items.map((item) => {
                      const qty = shopQuantities[item.shopItemId] ?? 0;
                      const shared = item.itemId ? sharedItems[item.itemId] : undefined;
                      const label = item.label ?? shared?.label ?? item.shopItemId;
                      const bundle = item.bundleSize ?? 1;
                      const description =
                        item.description ?? (bundle > 1 ? `Bundle: ${bundle} ${label}` : `Purchase: 1 ${label}`);
                      const costShared = sharedItems[item.costItemId];
                      const maxQty = item.maxQty ?? null;
                      const canIncrement = maxQty === null || qty < maxQty;
                      const sharedLabel = shared?.label;
                      const baseLabel =
                        item.label && (!item.itemId || item.label !== item.itemId) ? item.label : sharedLabel ?? item.label;
                      const fallbackLabel = shared?.fallbackLabel ?? baseLabel ?? label;
                      const shortLabel = shared?.shortLabel ?? fallbackLabel?.slice(0, 1) ?? label.slice(0, 1);
                      const costFallbackLabel = costShared?.fallbackLabel ?? costShared?.label ?? item.costItemId;
                      const costShortLabel = costShared?.shortLabel ?? costFallbackLabel.slice(0, 1);
                      const rarity = normalizeRarity(item.rarityOverride ?? shared?.rarity);
                      const showRarity = shared?.showRarity ?? false;
                      const displayLabel =
                        showRarity && rarity && baseLabel && !baseLabel.toLowerCase().startsWith(rarity.toLowerCase())
                          ? `${rarity} ${baseLabel}`
                          : baseLabel;

                      return (
                        <div
                          key={item.shopItemId}
                          style={{
                            textAlign: "left",
                            padding: 12,
                            borderRadius: 10,
                            border: "1px solid var(--border)",
                            background: "var(--surface-2)",
                            display: "grid",
                            gap: 8,
                            minHeight: 210,
                            height: "100%",
                          }}
                        >
                          <div style={{ display: "grid", gap: 8, justifyItems: "center", textAlign: "center" }}>
                            <div
                              style={{
                                fontWeight: 700,
                                minHeight: 36,
                                lineHeight: 1.15,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                textAlign: "center",
                              }}
                            >
                              {displayLabel}
                            </div>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() =>
                                setActiveShopItemId((prev) => (prev === item.shopItemId ? null : item.shopItemId))
                              }
                              style={{ padding: 0, border: "none", background: "transparent" }}
                              aria-label={`Show details for ${label}`}
                            >
                              <div style={{ position: "relative", width: 48, height: 48 }}>
                                {rarity ? (
                                  <img
                                    src={`${import.meta.env.BASE_URL}catalog/shared/items/frames/Frame_Quality_${rarity}.png`}
                                    alt=""
                                    width={48}
                                    height={48}
                                    style={{ position: "absolute", inset: 0, display: "block" }}
                                  />
                                ) : null}
                                {shared?.icon ? (
                                  <img
                                    src={`${import.meta.env.BASE_URL}${shared.icon}`}
                                    alt=""
                                    width={32}
                                    height={32}
                                    style={{
                                      position: "absolute",
                                      left: "50%",
                                      top: "50%",
                                      transform: "translate(-50%, -50%) translateY(-2px)",
                                      display: "block",
                                      borderRadius: 8,
                                    }}
                                  />
                                ) : (
                                  <div
                                    style={{
                                      position: "absolute",
                                      left: "50%",
                                      top: "50%",
                                      transform: "translate(-50%, -50%) translateY(-2px)",
                                      width: 32,
                                      height: 32,
                                      borderRadius: 8,
                                      border: "1px solid var(--border)",
                                      display: "grid",
                                      placeItems: "center",
                                      fontWeight: 700,
                                      background: "var(--surface)",
                                    }}
                                  >
                                    {shortLabel}
                                  </div>
                                )}
                                {item.bundleSize && item.bundleSize > 1 ? (
                                  <div
                                    style={{
                                      position: "absolute",
                                      right: -2,
                                      bottom: -2,
                                      background: "var(--surface-2)",
                                      border: "1px solid var(--border)",
                                      borderRadius: 10,
                                      padding: "1px 4px",
                                      fontSize: 10,
                                      fontWeight: 700,
                                      lineHeight: 1,
                                    }}
                                  >
                                    {item.bundleSize}
                                  </div>
                                ) : null}
                              </div>
                            </button>
                            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                              Purchases left: {maxQty ?? 999}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" }}>
                              {costShared?.icon ? (
                                <img
                                  src={`${import.meta.env.BASE_URL}${costShared.icon}`}
                                  alt=""
                                  width={16}
                                  height={16}
                                  style={{ display: "block" }}
                                />
                              ) : (
                                <span style={{ fontWeight: 700 }}>{costShortLabel}</span>
                              )}
                              {item.cost.toLocaleString()}
                            </div>
                            {activeShopItemId === item.shopItemId ? (
                              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{description}</div>
                            ) : null}
                          </div>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "32px minmax(0, 1fr) 32px",
                              alignItems: "center",
                              justifyItems: "center",
                              gap: 8,
                              width: "100%",
                            }}
                          >
                            <button
                              type="button"
                              className="secondary"
                              disabled={qty <= 0}
                              onClick={() => setShopQuantity(item.shopItemId, qty - 1)}
                              style={{ width: 32, padding: "4px 0" }}
                            >
                              -
                            </button>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={qty ? qty : ""}
                              placeholder="0"
                              onChange={(e) => {
                                const raw = e.target.value.replace(/[^\d]/g, "");
                                const next = raw ? Number(raw) : 0;
                                setShopQuantity(item.shopItemId, maxQty !== null ? Math.min(maxQty, next) : next);
                              }}
                              style={{ width: "100%", minWidth: 0, textAlign: "center" }}
                            />
                            <button
                              type="button"
                              className="secondary"
                              disabled={!canIncrement}
                              onClick={() => setShopQuantity(item.shopItemId, qty + 1)}
                              style={{ width: 32, padding: "4px 0" }}
                            >
                              +
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            ) : (
              <div style={{ color: "var(--text-muted)" }}>No shop items configured for this event.</div>
            )}
            <div style={{ display: "grid", gap: 8, paddingTop: 6 }}>
              <div style={{ fontWeight: 700 }}>Total Costs</div>
              {Object.keys(shopTotals).length ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, minHeight: 28 }}>
                  {Object.entries(shopTotals).map(([itemId, amount]) => {
                    const item = sharedItems[itemId];
                    const totalsFallbacks: Record<string, string> = {
                      silver_tickets: "Silver Ticket",
                      golden_tickets: "Golden Ticket",
                    };
                    const label = item?.label ?? totalsFallbacks[itemId] ?? itemId.replace(/_/g, " ");
                    const fallbackLabel = item?.fallbackLabel ?? label;
                    return (
                      <div
                        key={itemId}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          border: "1px solid var(--border)",
                          borderRadius: 999,
                          padding: "4px 10px",
                          background: "var(--surface-2)",
                          fontSize: 12,
                        }}
                      >
                        {item?.icon ? (
                          <img
                            src={`${import.meta.env.BASE_URL}${item.icon}`}
                            alt={fallbackLabel}
                            width={16}
                            height={16}
                            style={{ display: "block" }}
                          />
                        ) : (
                          <span style={{ fontWeight: 700 }}>{fallbackLabel}</span>
                        )}
                        {amount.toLocaleString()}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "var(--text-muted)", minHeight: 28, display: "flex", alignItems: "center" }}>
                  Select items to see totals.
                </div>
              )}
            </div>
          </div>
        </div>
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
              taskGroupLabels={ev.taskGroupLabels}
              rewardAssets={ev.rewardAssets}
              scrollContainerRef={tasksScrollRef}
            />
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
