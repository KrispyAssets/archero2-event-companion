import { useEffect, useMemo, useState } from "react";
import AppShell from "../ui/AppShell";
import { Link } from "react-router-dom";
import { useCatalogIndex } from "../catalog/useCatalogIndex";
import { useSharedItems } from "../catalog/useSharedItems";

export function EventCatalogList() {
  const catalog = useCatalogIndex();
  const sharedItemsState = useSharedItems();
  const sharedItems = sharedItemsState.status === "ready" ? sharedItemsState.items : {};
  const devModeEnabled = useMemo(() => import.meta.env.DEV && localStorage.getItem("dev_mode") === "1", []);
  const formatAmount = (value: number) => value.toLocaleString();
  const iconBase = `${import.meta.env.BASE_URL}catalog/shared/items/currencies/`;
  const costIcons: Record<string, string> = {
    gems: `${iconBase}icon_gem.png`,
    chromatic_keys: `${iconBase}icon_chromatic_key.png`,
    obsidian_keys: `${iconBase}icon_obsidian_key.png`,
    wish_tokens: `${iconBase}icon_wish_coin.png`,
    shovels: `${iconBase}icon_shovel.png`,
  };
  const [openRewardsEventId, setOpenRewardsEventId] = useState<string | null>(null);

  useEffect(() => {
    if (!openRewardsEventId) return;
    function handleClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(".eventInfoWrap")) return;
      setOpenRewardsEventId(null);
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [openRewardsEventId]);
  const events = catalog.status === "ready" ? catalog.events : [];
  const sortedEvents = useMemo(() => {
    if (catalog.status !== "ready") return [];
    const eventsCopy = [...events];
    eventsCopy.sort((a, b) => {
      const aActive = a.isActive ? 1 : 0;
      const bActive = b.isActive ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      const aHasDate = Boolean(a.scheduleStart);
      const bHasDate = Boolean(b.scheduleStart);
      if (aHasDate !== bHasDate) return aHasDate ? -1 : 1;
      if (aHasDate && bHasDate) {
        const aDate = a.scheduleStart ?? "";
        const bDate = b.scheduleStart ?? "";
        if (aDate !== bDate) return aDate.localeCompare(bDate);
      }
      if (a.scheduleStart && b.scheduleStart) {
        const aTier = a.tier === "secondary" ? 1 : 0;
        const bTier = b.tier === "secondary" ? 1 : 0;
        if (aTier !== bTier) return aTier - bTier;
      }
      const aComing = a.status === "coming_soon" ? 1 : 0;
      const bComing = b.status === "coming_soon" ? 1 : 0;
      if (aComing !== bComing) return aComing - bComing;
      return a.title.localeCompare(b.title);
    });
    return eventsCopy;
  }, [catalog.status, events]);

  return (
    <>
      {catalog.status === "loading" && <p>Loading catalog…</p>}
      {catalog.status === "error" && <p style={{ color: "crimson" }}>Error: {catalog.error}</p>}

      {catalog.status === "ready" && (
        <>
          <div style={{ display: "grid", gap: 12 }}>
            {sortedEvents.map((ev) => {
              const isComingSoon = ev.status === "coming_soon";
              const subtitleText = isComingSoon ? "Coming Soon" : ev.subtitle;
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
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 700 }}>{ev.title}</div>
                      {ev.isActive ? (
                        <span
                          style={{
                            borderRadius: 999,
                            padding: "2px 8px",
                            fontSize: 11,
                            fontWeight: 700,
                            letterSpacing: 0.4,
                            color: "var(--success)",
                            background: "var(--success-contrast)",
                            border: "1px solid var(--success)",
                          }}
                        >
                          ACTIVE
                        </span>
                      ) : null}
                    </div>
                    {ev.dateRangeLabel ? (
                      <span
                        style={{
                          borderRadius: 999,
                          padding: "2px 8px",
                          fontSize: 11,
                          fontWeight: 600,
                          color: "var(--text-subtle)",
                          background: "var(--surface-2)",
                          border: "1px solid var(--border)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {ev.dateRangeLabel}
                      </span>
                    ) : null}
                  </div>
                  {subtitleText ? <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>{subtitleText}</div> : null}
                  {((ev.taskCosts && ev.taskCosts.length) || (ev.taskRewards && ev.taskRewards.length)) ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8, alignItems: "center" }}>
                      {ev.taskCosts && ev.taskCosts.length ? (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
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
                      {ev.taskRewards && ev.taskRewards.length ? (
                        <div className="eventInfoWrap">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setOpenRewardsEventId((prev) => (prev === ev.eventId ? null : ev.eventId));
                            }}
                            aria-label="Show task rewards"
                            className="eventInfoButton"
                          >
                            i
                          </button>
                          {openRewardsEventId === ev.eventId ? (
                            <div
                              className="eventInfoPopover"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                            >
                              <div className="eventInfoTitle">Task Rewards</div>
                              <div style={{ display: "grid", gap: 6 }}>
                                {ev.taskRewards.map((reward) => {
                                  const shared = sharedItems[reward.key];
                                  const label = shared?.label ?? reward.label;
                                  const fallbackLabel = shared?.fallbackLabel ?? label;
                                  return (
                                    <div
                                      key={reward.key}
                                      style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}
                                    >
                                      {shared?.icon ? (
                                        <img
                                          src={`${import.meta.env.BASE_URL}${shared.icon}`}
                                          alt={fallbackLabel}
                                          width={16}
                                          height={16}
                                          style={{ display: "block" }}
                                        />
                                      ) : (
                                        <span style={{ fontWeight: 700 }}>{fallbackLabel}</span>
                                      )}
                                      <span>{formatAmount(reward.amount)}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );

              if (isComingSoon && !devModeEnabled) {
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
