import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCatalogIndex } from "../catalog/useCatalogIndex";

type ScheduleEntry = {
  eventId: string;
  start: string;
  end: string;
  label?: string;
};

type ScheduleFile = {
  events?: ScheduleEntry[];
};

type ScheduleState = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; entries: ScheduleEntry[] };

type DayCell = {
  date: Date;
  entries: ScheduleEntryView[];
};

type ScheduleEntryView = ScheduleEntry & {
  title: string;
  startMs: number;
  endMs: number;
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
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const startWeekday = firstDay.getUTCDay();

    const cells: DayCell[] = [];
    for (let i = 0; i < startWeekday; i += 1) {
      const date = new Date(Date.UTC(year, month, i - startWeekday + 1));
      cells.push({ date, entries: [] });
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(Date.UTC(year, month, day));
      const dayStart = Date.UTC(year, month, day, 0, 0, 0, 0);
      const dayEnd = Date.UTC(year, month, day, 23, 59, 59, 999);
      const entries = scheduleEntries.filter((entry) => entry.startMs <= dayEnd && entry.endMs >= dayStart);
      cells.push({ date, entries });
    }

    const totalCells = Math.ceil(cells.length / 7) * 7;
    for (let i = cells.length; i < totalCells; i += 1) {
      const date = new Date(Date.UTC(year, month, daysInMonth + (i - cells.length) + 1));
      cells.push({ date, entries: [] });
    }

    return { year, month, cells };
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 8 }}>
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div key={day} style={{ fontSize: 12, color: "var(--text-subtle)", textAlign: "center" }}>
              {day}
            </div>
          ))}
          {calendar.cells.map((cell, index) => {
            const isCurrentMonth = cell.date.getUTCMonth() === calendar.month;
            const isToday = isSameUtcDay(cell.date, now);
            const displayEntries = cell.entries.slice(0, 2);
            const extraCount = cell.entries.length - displayEntries.length;
            return (
              <div
                key={`${cell.date.toISOString()}-${index}`}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: 8,
                  minHeight: 86,
                  background: isToday ? "var(--highlight)" : "var(--surface)",
                  opacity: isCurrentMonth ? 1 : 0.45,
                  display: "grid",
                  gap: 6,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 12 }}>{cell.date.getUTCDate()}</div>
                {displayEntries.length ? (
                  <div style={{ display: "grid", gap: 4 }}>
                    {displayEntries.map((entry) => (
                      <Link
                        key={`${entry.eventId}-${entry.start}`}
                        to={`/event/${encodeURIComponent(entry.eventId)}`}
                        style={{
                          fontSize: 11,
                          color: "var(--text)",
                          background: "var(--surface-2)",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          padding: "2px 6px",
                          textDecoration: "none",
                          display: "block",
                        }}
                      >
                        {entry.label ?? entry.title}
                      </Link>
                    ))}
                    {extraCount > 0 ? (
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>+{extraCount} more</div>
                    ) : null}
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: "var(--text-subtle)" }}>No events</div>
                )}
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
