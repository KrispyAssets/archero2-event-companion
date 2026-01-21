import AppShell from "../ui/AppShell";
import { Link } from "react-router-dom";
import { useCatalogIndex } from "../catalog/useCatalogIndex";

export function EventCatalogList() {
  const catalog = useCatalogIndex();
  const formatAmount = (value: number) => value.toLocaleString();
  const iconBase = `${import.meta.env.BASE_URL}catalog/shared/misc/`;
  const costIcons: Record<string, string> = {
    gems: `${iconBase}36px-Gem.png`,
    keys: `${iconBase}24px-Chromatic_Chest_Key.png`,
    shovels: `${iconBase}24px-Shovel.png`,
  };

  return (
    <>
      {catalog.status === "loading" && <p>Loading catalog…</p>}
      {catalog.status === "error" && <p style={{ color: "crimson" }}>Error: {catalog.error}</p>}

      {catalog.status === "ready" && (
        <>
          <div style={{ display: "grid", gap: 12 }}>
            {catalog.events.map((ev) => {
              const isComingSoon = ev.status === "coming_soon";
              const card = (
                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    padding: 12,
                    background: "var(--surface)",
                    opacity: isComingSoon ? 0.6 : 1,
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{ev.title}</div>
                  {ev.subtitle ? <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>{ev.subtitle}</div> : null}
                  {ev.taskCosts && ev.taskCosts.length ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
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
                          {costIcons[cost.key] ? (
                            <img src={costIcons[cost.key]} alt="" width={16} height={16} style={{ display: "block" }} />
                          ) : null}
                          {formatAmount(cost.amount)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              );

              if (isComingSoon) {
                return <div key={ev.eventId}>{card}</div>;
              }

              return (
                <Link
                  key={ev.eventId}
                  to={`/event/${encodeURIComponent(ev.eventId)}`}
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  {card}
                </Link>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

export default function EventsIndex() {
  return (
    <AppShell>
      <h1>Events</h1>
      <EventCatalogList />
    </AppShell>
  );
}
