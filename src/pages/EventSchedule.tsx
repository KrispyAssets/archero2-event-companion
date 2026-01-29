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

function isSameUtcDay(date: Date, now: Date): boolean {
  return (
    date.getUTCFullYear() === now.getUTCFullYear() &&
    date.getUTCMonth() === now.getUTCMonth() &&
    date.getUTCDate() === now.getUTCDate()
  );
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

  const eventTitleById = useMemo(() => {
    if (catalog.status !== "ready") return new Map<string, string>();
    return new Map(catalog.events.map((ev) => [ev.eventId, ev.title]));
  }, [catalog]);

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
    const start = new Date(Date.UTC(year, month, 1 - firstDay.getUTCDay()));
    const end = new Date(Date.UTC(year, month, lastDay.getUTCDate() + (6 - lastDay.getUTCDay())));
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

  const history = useMemo(() => {
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
    return scheduleEntries
      .filter((entry) => entry.endMs < todayUtc)
      .sort((a, b) => b.endMs - a.endMs);
  }, [scheduleEntries, now]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>Event Calendar</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="secondary"
            onClick={() => setMonthCursor(new Date(Date.UTC(calendar.year, calendar.month - 1, 1)))}
          >
            Prev
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setMonthCursor(new Date(Date.UTC(calendar.year, calendar.month + 1, 1)))}
          >
            Next
          </button>
        </div>
      </div>

      <div style={{ fontSize: 14, color: "var(--text-muted)" }}>
        {monthCursor.toLocaleString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })}
      </div>

      {scheduleState.status === "loading" && <div>Loading schedule…</div>}
      {scheduleState.status === "error" && <div style={{ color: "crimson" }}>Error: {scheduleState.error}</div>}

      {scheduleState.status === "ready" ? (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
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
                          textAlign: "right",
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
                      const continuesLeft = entry.startMs < weekStartMs;
                      const continuesRight = entry.endMs > weekEndMs;
                      const hue = hashHue(entry.eventId);
                      const baseColor = entry.accent ?? `hsla(${hue}, 70%, 70%, 0.78)`;
                      const edgeColor = entry.accent ? "transparent" : `hsla(${hue}, 70%, 70%, 0)`;
                      const background = `linear-gradient(90deg, ${
                        continuesLeft ? edgeColor : baseColor
                      } 0%, ${baseColor} 12%, ${baseColor} 88%, ${continuesRight ? edgeColor : baseColor} 100%)`;
                      const borderColor = entry.accent ?? `hsla(${hue}, 55%, 45%, 0.55)`;
                      const title = entry.label ?? entry.title;
                      const initials = buildInitials(title);

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
                            background,
                            color: "var(--text)",
                            textDecoration: "none",
                            overflow: "hidden",
                            minHeight: 30,
                          }}
                        >
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
                              <img
                                src={`${import.meta.env.BASE_URL}${entry.icon}`}
                                alt=""
                                width={18}
                                height={18}
                                style={{ display: "block" }}
                              />
                            ) : (
                              initials
                            )}
                          </div>
                          <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
                            <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {title}
                            </span>
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{formatShortRange(entry.start, entry.end)}</span>
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
