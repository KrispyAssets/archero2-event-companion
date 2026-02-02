import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCatalogIndex } from "../catalog/useCatalogIndex";

type ScheduleEntry = {
  eventId: string;
  start: string;
  end: string;
  label?: string;
  icon?: string;
  accent?: string;
  titleColor?: string;
  extraText?: string;
  extraTextColor?: string;
  dateBadgeBg?: string;
  dateBadgeColor?: string;
};

type ScheduleFile = {
  events?: ScheduleEntry[];
};

type ScheduleState = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; entries: ScheduleEntry[] };

type ScheduleEntryView = ScheduleEntry & {
  title: string;
  startMs: number;
  endMs: number;
};

type WeekRow = {
  start: Date;
  dates: Date[];
};

function parseUtcDate(dateStr: string): { year: number; month: number; day: number } | null {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || !month || !day) return null;
  return { year, month, day };
}

function toUtcMs(parts: { year: number; month: number; day: number }, endOfDay = false): number {
  if (endOfDay) {
    return Date.UTC(parts.year, parts.month - 1, parts.day, 23, 59, 59, 999);
  }
  return Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0);
}

function formatRange(start: string, end: string): string {
  return `${start} → ${end}`;
}

function formatShortRange(start: string, end: string): string {
  const startParts = parseUtcDate(start);
  const endParts = parseUtcDate(end);
  if (!startParts || !endParts) return formatRange(start, end);
  return `${startParts.month}/${startParts.day} - ${endParts.month}/${endParts.day}`;
}

function hashHue(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % 360;
  }
  return hash;
}

function buildInitials(label: string): string {
  const parts = label.split(" ").filter((part) => part.length > 0);
  const letters = parts.slice(0, 2).map((part) => part.charAt(0));
  return letters.join("").toUpperCase() || label.slice(0, 2).toUpperCase();
}

function toTransparent(color: string): string {
  const trimmed = color.trim();
  if (trimmed.startsWith("hsla(")) {
    return trimmed.replace(/hsla\(([^)]+)\)/, "hsla($1, 0)");
  }
  if (trimmed.startsWith("hsl(")) {
    return trimmed.replace(/hsl\(([^)]+)\)/, "hsla($1, 0)");
  }
  if (trimmed.startsWith("rgba(")) {
    return trimmed.replace(/rgba\(([^)]+)\)/, "rgba($1, 0)");
  }
  if (trimmed.startsWith("rgb(")) {
    return trimmed.replace(/rgb\(([^)]+)\)/, "rgba($1, 0)");
  }
  const hex = trimmed.replace("#", "");
  if (hex.length === 3 || hex.length === 6) {
    const full =
      hex.length === 3
        ? hex
            .split("")
            .map((c) => c + c)
            .join("")
        : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, 0)`;
  }
  return "transparent";
}

function parseColorToRgb(color: string): { r: number; g: number; b: number } | null {
  const trimmed = color.trim();
  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return { r, g, b };
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return { r, g, b };
    }
    return null;
  }
  const rgbMatch = trimmed.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(",").map((p) => Number(p.trim()));
    if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
      return { r: parts[0], g: parts[1], b: parts[2] };
    }
    return null;
  }
  const hslMatch = trimmed.match(/^hsla?\(([^)]+)\)$/i);
  if (hslMatch) {
    const parts = hslMatch[1].split(",").map((p) => p.trim());
    if (parts.length < 3) return null;
    const h = Number(parts[0]);
    const s = Number(parts[1].replace("%", ""));
    const l = Number(parts[2].replace("%", ""));
    if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) return null;
    const sNorm = s / 100;
    const lNorm = l / 100;
    const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
    const hPrime = ((h % 360) + 360) % 360 / 60;
    const x = c * (1 - Math.abs((hPrime % 2) - 1));
    let r1 = 0;
    let g1 = 0;
    let b1 = 0;
    if (hPrime >= 0 && hPrime < 1) {
      r1 = c;
      g1 = x;
    } else if (hPrime < 2) {
      r1 = x;
      g1 = c;
    } else if (hPrime < 3) {
      g1 = c;
      b1 = x;
    } else if (hPrime < 4) {
      g1 = x;
      b1 = c;
    } else if (hPrime < 5) {
      r1 = x;
      b1 = c;
    } else {
      r1 = c;
      b1 = x;
    }
    const m = lNorm - c / 2;
    return {
      r: Math.round((r1 + m) * 255),
      g: Math.round((g1 + m) * 255),
      b: Math.round((b1 + m) * 255),
    };
  }
  return null;
}

function rgbToHsl(rgb: { r: number; g: number; b: number }): { h: number; s: number; l: number } {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
  }
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h, s: Math.round(s * 100), l: Math.round(l * 100) };
}

function luminance(rgb: { r: number; g: number; b: number }): number {
  const toLin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const r = toLin(rgb.r);
  const g = toLin(rgb.g);
  const b = toLin(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isSameUtcDay(date: Date, now: Date): boolean {
  return date.getUTCFullYear() === now.getUTCFullYear() && date.getUTCMonth() === now.getUTCMonth() && date.getUTCDate() === now.getUTCDate();
}

export default function EventSchedule() {
  const catalog = useCatalogIndex();
  const [scheduleState, setScheduleState] = useState<ScheduleState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const path = `${import.meta.env.BASE_URL}catalog/shared/event_schedule.json`;
        const res = await fetch(path, { cache: "no-cache" });
        if (!res.ok) throw new Error(`Failed to load schedule: ${res.status}`);
        const data = (await res.json()) as ScheduleFile;
        const entries = Array.isArray(data.events) ? data.events : [];
        if (!cancelled) setScheduleState({ status: "ready", entries });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!cancelled) setScheduleState({ status: "error", error: msg });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const now = new Date();
  const [monthCursor, setMonthCursor] = useState(() => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));

  const catalogEvents = catalog.status === "ready" ? catalog.events : [];
  const eventTitleById = useMemo(() => {
    if (!catalogEvents.length) return new Map<string, string>();
    return new Map(catalogEvents.map((ev) => [ev.eventId, ev.title]));
  }, [catalogEvents]);

  const scheduleEntries = useMemo<ScheduleEntryView[]>(() => {
    if (scheduleState.status !== "ready") return [];
    const mapped = scheduleState.entries
      .map((entry) => {
        const startParts = parseUtcDate(entry.start);
        const endParts = parseUtcDate(entry.end);
        if (!startParts || !endParts) return null;
        const title = eventTitleById.get(entry.eventId) ?? entry.eventId;
        return {
          ...entry,
          title,
          startMs: toUtcMs(startParts, false),
          endMs: toUtcMs(endParts, true),
        };
      })
      .filter((entry): entry is ScheduleEntryView => Boolean(entry));
    return mapped.sort((a, b) => a.startMs - b.startMs);
  }, [scheduleState, eventTitleById]);

  const calendar = useMemo(() => {
    const year = monthCursor.getUTCFullYear();
    const month = monthCursor.getUTCMonth();
    const firstDay = new Date(Date.UTC(year, month, 1));
    const lastDay = new Date(Date.UTC(year, month + 1, 0));
    const weekStart = 6;
    const startOffset = (firstDay.getUTCDay() - weekStart + 7) % 7;
    const endOffset = (weekStart - lastDay.getUTCDay() - 1 + 7) % 7;
    const start = new Date(Date.UTC(year, month, 1 - startOffset));
    const end = new Date(Date.UTC(year, month, lastDay.getUTCDate() + endOffset));
    const weeks: WeekRow[] = [];
    const dayMs = 24 * 60 * 60 * 1000;

    for (let time = start.getTime(); time <= end.getTime(); time += 7 * dayMs) {
      const dates: Date[] = [];
      for (let i = 0; i < 7; i += 1) {
        dates.push(new Date(time + i * dayMs));
      }
      weeks.push({ start: new Date(time), dates });
    }

    return { year, month, weeks };
  }, [monthCursor, scheduleEntries]);

  const monthStartMs = Date.UTC(calendar.year, calendar.month, 1, 0, 0, 0, 0);
  const monthEndMs = Date.UTC(calendar.year, calendar.month + 1, 0, 23, 59, 59, 999);
  const costIcons: Record<string, string> = {
    gems: `${import.meta.env.BASE_URL}catalog/shared/items/currencies/icon_gem.png`,
    chromatic_keys: `${import.meta.env.BASE_URL}catalog/shared/items/currencies/icon_chromatic_key.png`,
    obsidian_keys: `${import.meta.env.BASE_URL}catalog/shared/items/currencies/icon_obsidian_key.png`,
    wish_tokens: `${import.meta.env.BASE_URL}catalog/shared/items/currencies/icon_wish_coin.png`,
    promised_shovels: `${import.meta.env.BASE_URL}catalog/shared/items/currencies/icon_promised_shovel.png`,
    shovels: `${import.meta.env.BASE_URL}catalog/shared/items/currencies/icon_shovel.png`,
  };
  const costOrder = ["gems", "chromatic_keys", "obsidian_keys", "wish_tokens", "promised_shovels", "shovels"];
  const formatAmount = (value: number) => value.toLocaleString();

  const monthCostTotals = useMemo(() => {
    if (catalog.status !== "ready") return [];
    if (scheduleState.status !== "ready") return [];
    const eventsById = new Map(catalog.events.map((ev) => [ev.eventId, ev]));
    const totals = new Map<string, number>();
    for (const entry of scheduleEntries) {
      if (entry.startMs > monthEndMs || entry.endMs < monthStartMs) continue;
      const event = eventsById.get(entry.eventId);
      if (!event?.taskCosts?.length) continue;
      for (const cost of event.taskCosts) {
        totals.set(cost.key, (totals.get(cost.key) ?? 0) + cost.amount);
      }
    }
    const entries = Array.from(totals.entries());
    const indexOf = (key: string) => {
      const idx = costOrder.indexOf(key);
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
    };
    return entries
      .sort(([a], [b]) => {
        const aIdx = indexOf(a);
        const bIdx = indexOf(b);
        if (aIdx !== bIdx) return aIdx - bIdx;
        return a.localeCompare(b);
      })
      .map(([key, amount]) => ({ key, amount }));
  }, [catalog.status, catalogEvents, scheduleEntries, monthStartMs, monthEndMs, scheduleState.status]);

  const history = useMemo(() => {
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
    return scheduleEntries.filter((entry) => entry.endMs < todayUtc).sort((a, b) => b.endMs - a.endMs);
  }, [scheduleEntries, now]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>Event Calendar</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="secondary" onClick={() => setMonthCursor(new Date(Date.UTC(calendar.year, calendar.month - 1, 1)))}>
            Prev
          </button>
          <button type="button" className="secondary" onClick={() => setMonthCursor(new Date(Date.UTC(calendar.year, calendar.month + 1, 1)))}>
            Next
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14, color: "var(--text-muted)" }}>
        <span>{monthCursor.toLocaleString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })}</span>
        {monthCostTotals.length ? (
          <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 6, alignItems: "center", justifyContent: "flex-start" }}>
            <span style={{ fontSize: 11, color: "var(--text-subtle)", fontWeight: 600 }}>Costs</span>
            {monthCostTotals.map((cost) => (
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
                {costIcons[cost.key] ? (
                  <img src={costIcons[cost.key]} alt="" width={16} height={16} style={{ display: "block" }} />
                ) : null}
                {formatAmount(cost.amount)}
              </span>
            ))}
          </span>
        ) : null}
      </div>

      {scheduleState.status === "loading" && <div>Loading schedule…</div>}
      {scheduleState.status === "error" && <div style={{ color: "crimson" }}>Error: {scheduleState.error}</div>}

      {scheduleState.status === "ready" ? (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
            {["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"].map((day) => (
              <div
                key={day}
                style={{
                  fontSize: 12,
                  color: "var(--text-subtle)",
                  textAlign: "center",
                  padding: "4px 0",
                  background: "var(--surface-2)",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                }}
              >
                {day}
              </div>
            ))}
          </div>

          {calendar.weeks.map((week) => {
            const weekStartMs = week.dates[0].getTime();
            const weekEndMs = week.dates[6].getTime() + 24 * 60 * 60 * 1000 - 1;
            const weekEntries = scheduleEntries.filter((entry) => entry.startMs <= weekEndMs && entry.endMs >= weekStartMs);

            return (
              <div key={week.start.toISOString()} style={{ display: "grid", gap: 6 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
                  {week.dates.map((date) => {
                    const isCurrentMonth = date.getUTCMonth() === calendar.month;
                    const isToday = isSameUtcDay(date, now);
                    return (
                      <div
                        key={date.toISOString()}
                        style={{
                          padding: "6px 8px",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: isToday ? "var(--highlight)" : "var(--surface)",
                          opacity: isCurrentMonth ? 1 : 0.45,
                          fontSize: 12,
                          fontWeight: 700,
                          textAlign: "center",
                        }}
                      >
                        {date.getUTCDate()}
                      </div>
                    );
                  })}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                    gap: 6,
                    gridAutoRows: "minmax(30px, auto)",
                  }}
                >
                  {weekEntries.length ? (
                    weekEntries.map((entry) => {
                      const dayMs = 24 * 60 * 60 * 1000;
                      const rawStart = Math.floor((entry.startMs - weekStartMs) / dayMs);
                      const rawEnd = Math.floor((entry.endMs - weekStartMs) / dayMs);
                      const startIndex = Math.max(0, Math.min(6, rawStart));
                      const endIndex = Math.max(0, Math.min(6, rawEnd));
                      const continuesLeft = entry.startMs < monthStartMs && weekStartMs <= monthStartMs && weekEndMs >= monthStartMs;
                      const continuesRight = entry.endMs > monthEndMs && weekStartMs <= monthEndMs && weekEndMs >= monthEndMs;
                      const hue = hashHue(entry.eventId);
                      const baseColor = entry.accent ?? `hsl(${hue}, 70%, 70%)`;
                      const borderColor = entry.accent ?? `hsla(${hue}, 55%, 45%, 0.55)`;
                      const fadeInStop = continuesLeft ? 50 : 0;
                      const fadeOutStart = continuesRight ? 50 : 100;
                      const maskGradient = `linear-gradient(90deg, ${
                        continuesLeft ? "transparent" : "black"
                      } 0%, black ${fadeInStop}%, black ${fadeOutStart}%, ${continuesRight ? "transparent" : "black"} 100%)`;
                      const rgb = parseColorToRgb(baseColor);
                      const baseLum = rgb ? luminance(rgb) : 0.6;
                      const isDark = baseLum < 0.5;
                      const hsl = rgb ? rgbToHsl(rgb) : { h: hue, s: 55, l: 70 };
                      const pillLightness = isDark ? Math.min(88, hsl.l + 30) : Math.max(18, hsl.l - 30);
                      const titleColor = entry.titleColor ?? (isDark ? "#ffffff" : "#111111");
                      const dateBadgeBg = entry.dateBadgeBg ?? `hsl(${hsl.h}, ${Math.max(35, hsl.s)}%, ${pillLightness}%)`;
                      const dateBadgeColor = entry.dateBadgeColor ?? (pillLightness > 55 ? "#111111" : "#ffffff");
                      const title = entry.label ?? entry.title;
                      const initials = buildInitials(title);
                      const spanLength = endIndex - startIndex + 1;
                      const hasIcon = Boolean(entry.icon);
                      const layout = spanLength === 1 ? "compact" : spanLength <= 3 ? "stacked" : "inline";
                      const showDate = layout !== "compact";
                      const showIcon = hasIcon || layout === "compact";
                      const innerPadLeft = continuesLeft ? "50%" : "6px";
                      const innerPadRight = continuesRight ? "50%" : "6px";

                      return (
                        <Link
                          key={`${entry.eventId}-${entry.start}-${week.start.toISOString()}`}
                          to={`/event/${encodeURIComponent(entry.eventId)}`}
                          title={`${title} (${formatShortRange(entry.start, entry.end)})`}
                          style={{
                            gridColumn: `${startIndex + 1} / ${endIndex + 2}`,
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "6px 8px",
                            borderRadius: 10,
                            border: `1px solid ${borderColor}`,
                            background: baseColor,
                            color: titleColor,
                            textDecoration: "none",
                            overflow: "hidden",
                            minHeight: 30,
                            WebkitMaskImage: continuesLeft || continuesRight ? maskGradient : undefined,
                            maskImage: continuesLeft || continuesRight ? maskGradient : undefined,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: layout === "stacked" ? "flex-start" : "center",
                              gap: 8,
                              width: "100%",
                              minWidth: 0,
                              paddingLeft: innerPadLeft,
                              paddingRight: innerPadRight,
                            }}
                          >
                            {showIcon ? (
                              <div
                                style={{
                                  width: 24,
                                  height: 24,
                                  borderRadius: 6,
                                  background: "rgba(255,255,255,0.65)",
                                  border: "1px solid rgba(0,0,0,0.08)",
                                  display: "grid",
                                  placeItems: "center",
                                  fontSize: 11,
                                  fontWeight: 700,
                                  flexShrink: 0,
                                }}
                              >
                                {entry.icon ? (
                                  <img src={`${import.meta.env.BASE_URL}${entry.icon}`} alt="" width={18} height={18} style={{ display: "block" }} />
                                ) : (
                                  initials
                                )}
                              </div>
                            ) : null}
                            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", width: "100%" }}>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                  width: "100%",
                                  minWidth: 0,
                                  justifyContent: layout === "inline" ? "space-between" : "flex-start",
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: 12,
                                    fontWeight: 800,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                    color: titleColor,
                                  }}
                                >
                                  {title}
                                  {entry.extraText ? (
                                    <span style={{ color: entry.extraTextColor ?? "#c62828", fontWeight: 800, fontSize: 11 }}>{entry.extraText}</span>
                                  ) : null}
                                </span>
                                {showDate && layout === "inline" ? (
                                  <span
                                    style={{
                                      fontSize: 11,
                                      color: dateBadgeColor,
                                      background: dateBadgeBg,
                                      padding: "2px 6px",
                                      borderRadius: 999,
                                      fontWeight: 700,
                                      textAlign: "center",
                                      whiteSpace: "nowrap",
                                      marginLeft: 10,
                                    }}
                                  >
                                    {formatShortRange(entry.start, entry.end)}
                                  </span>
                                ) : null}
                              </div>
                              {showDate && layout === "stacked" ? (
                                <span
                                  style={{
                                    fontSize: 11,
                                    color: dateBadgeColor,
                                    background: dateBadgeBg,
                                    padding: "2px 6px",
                                    borderRadius: 999,
                                    fontWeight: 700,
                                    textAlign: "center",
                                    whiteSpace: "nowrap",
                                    alignSelf: "flex-start",
                                    marginTop: 4,
                                  }}
                                >
                                  {formatShortRange(entry.start, entry.end)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </Link>
                      );
                    })
                  ) : (
                    <div
                      style={{
                        gridColumn: "1 / -1",
                        border: "1px dashed var(--border)",
                        borderRadius: 10,
                        padding: "6px 10px",
                        fontSize: 12,
                        color: "var(--text-subtle)",
                      }}
                    >
                      No events this week.
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>Event History</div>
        {history.length ? (
          <div style={{ display: "grid", gap: 6 }}>
            {history.map((entry) => (
              <div
                key={`${entry.eventId}-${entry.start}`}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "8px 10px",
                  background: "var(--surface)",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <div style={{ fontWeight: 700 }}>{entry.label ?? entry.title}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{formatRange(entry.start, entry.end)}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No past events recorded.</div>
        )}
      </div>
    </div>
  );
}
