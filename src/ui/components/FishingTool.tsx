import { useEffect, useMemo, useState } from "react";
import type { ToolFishingCalculator } from "../../catalog/types";

type FishingToolData = {
  schemaVersion: number;
  sets: FishingToolSet[];
  fishTypes: FishingFishType[];
  lastLakeId: string;
  lastLakeMultiplier: number;
  weightsByLake: Record<string, Record<string, number>>;
  ticketsPerKgByLake?: Record<string, number>;
  brokenLinesMax?: number;
};

type FishingToolSet = {
  setId: string;
  label: string;
  lakes: FishingLake[];
};

type FishingLake = {
  lakeId: string;
  label: string;
  fish: FishingFish[];
};

type FishingFish = {
  fishId: string;
  typeId: string;
  name: string;
  image?: string;
};

type FishingFishType = {
  typeId: string;
  label: string;
  rarity: "rare" | "epic" | "legendary";
  baseCount: number;
};

type LakeState = {
  remainingByTypeId: Record<string, number>;
  poolsCompleted: number;
  legendaryCaught: number;
  fishCaught: number;
};

type HistoryEntry = {
  entryId: string;
  lakeId: string;
  typeId: string;
  fishName: string;
  rarity: FishingFishType["rarity"];
  timestamp: number;
  prevLakeState: LakeState;
};

type ToolState = {
  activeSetId: string;
  activeLakeIdBySet: Record<string, string>;
  lakeStatesBySet: Record<string, Record<string, LakeState>>;
  brokenLinesBySet: Record<string, number>;
  historyBySet: Record<string, HistoryEntry[]>;
  goalTicketsBySet: Record<string, number | null>;
};

type DataState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: FishingToolData };

const STORAGE_PREFIX = "archero2_tool_state_";

function resolvePath(path: string) {
  if (!path) return "";
  return `${import.meta.env.BASE_URL}${path}`;
}

function buildFullCounts(data: FishingToolData, lakeId: string): Record<string, number> {
  const multiplier = lakeId === data.lastLakeId ? data.lastLakeMultiplier : 1;
  return data.fishTypes.reduce((acc, fishType) => {
    acc[fishType.typeId] = fishType.baseCount * multiplier;
    return acc;
  }, {} as Record<string, number>);
}

function clampNumber(value: number, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function formatNumber(value: number | null, fractionDigits = 0) {
  if (value === null || Number.isNaN(value)) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits: fractionDigits });
}

function getLegendaryTypeId(data: FishingToolData) {
  return data.fishTypes.find((type) => type.rarity === "legendary")?.typeId ?? "";
}

export default function FishingToolView({ tool }: { tool: ToolFishingCalculator }) {
  const [dataState, setDataState] = useState<DataState>({ status: "loading" });
  const [toolState, setToolState] = useState<ToolState | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      try {
        const response = await fetch(resolvePath(tool.dataPath), { cache: "no-cache" });
        if (!response.ok) {
          throw new Error(`Failed to load tool data: ${response.status} ${response.statusText}`);
        }
        const json = (await response.json()) as FishingToolData;
        if (!cancelled) {
          setDataState({ status: "ready", data: json });
        }
      } catch (error) {
        if (!cancelled) {
          setDataState({ status: "error", error: error instanceof Error ? error.message : "Unknown error" });
        }
      }
    }
    loadData();
    return () => {
      cancelled = true;
    };
  }, [tool.dataPath]);

  useEffect(() => {
    if (dataState.status !== "ready") return;
    const data = dataState.data;
    const storageKey = `${STORAGE_PREFIX}${tool.toolId}`;
    const raw = localStorage.getItem(storageKey);
    let stored: ToolState | null = null;
    if (raw) {
      try {
        stored = JSON.parse(raw) as ToolState;
      } catch {
        stored = null;
      }
    }

    const defaultSetId = tool.defaultSetId ?? data.sets[0]?.setId ?? "";
    const activeSetId = stored?.activeSetId && data.sets.some((set) => set.setId === stored?.activeSetId) ? stored.activeSetId : defaultSetId;

    const nextState: ToolState = {
      activeSetId,
      activeLakeIdBySet: {},
      lakeStatesBySet: {},
      brokenLinesBySet: {},
      historyBySet: {},
      goalTicketsBySet: {},
    };

    for (const set of data.sets) {
      const storedLakeStates = stored?.lakeStatesBySet?.[set.setId] ?? {};
      const nextLakeStates: Record<string, LakeState> = {};
      for (const lake of set.lakes) {
        const storedLake = storedLakeStates[lake.lakeId];
        const fullCounts = buildFullCounts(data, lake.lakeId);
        const remainingByTypeId = storedLake?.remainingByTypeId
          ? { ...fullCounts, ...storedLake.remainingByTypeId }
          : fullCounts;
        nextLakeStates[lake.lakeId] = {
          remainingByTypeId,
          poolsCompleted: storedLake?.poolsCompleted ?? 0,
          legendaryCaught: storedLake?.legendaryCaught ?? 0,
          fishCaught: storedLake?.fishCaught ?? 0,
        };
      }

      nextState.lakeStatesBySet[set.setId] = nextLakeStates;
      const storedActiveLake = stored?.activeLakeIdBySet?.[set.setId];
      nextState.activeLakeIdBySet[set.setId] =
        storedActiveLake && set.lakes.some((lake) => lake.lakeId === storedActiveLake)
          ? storedActiveLake
          : set.lakes[0]?.lakeId ?? "";
      nextState.brokenLinesBySet[set.setId] = stored?.brokenLinesBySet?.[set.setId] ?? 0;
      nextState.historyBySet[set.setId] = stored?.historyBySet?.[set.setId] ?? [];
      nextState.goalTicketsBySet[set.setId] = stored?.goalTicketsBySet?.[set.setId] ?? null;
    }

    setToolState(nextState);
  }, [dataState, tool.defaultSetId, tool.toolId]);

  useEffect(() => {
    if (!toolState) return;
    const storageKey = `${STORAGE_PREFIX}${tool.toolId}`;
    localStorage.setItem(storageKey, JSON.stringify(toolState));
  }, [tool.toolId, toolState]);

  const derived = useMemo(() => {
    if (dataState.status !== "ready" || !toolState) return null;
    const data = dataState.data;
    const set = data.sets.find((entry) => entry.setId === toolState.activeSetId);
    if (!set) return null;
    const lakeId = toolState.activeLakeIdBySet[set.setId] ?? set.lakes[0]?.lakeId ?? "";
    const lake = set.lakes.find((entry) => entry.lakeId === lakeId);
    if (!lake) return null;
    const lakeState = toolState.lakeStatesBySet[set.setId]?.[lake.lakeId];
    if (!lakeState) return null;

    return { data, set, lake, lakeState };
  }, [dataState, toolState]);

  if (dataState.status === "loading") {
    return <p>Loading fishing tool…</p>;
  }

  if (dataState.status === "error") {
    return <p style={{ color: "var(--danger)" }}>Tool error: {dataState.error}</p>;
  }

  if (!toolState || !derived) {
    return <p style={{ color: "var(--danger)" }}>Tool data not ready.</p>;
  }

  const { data, set, lake, lakeState } = derived;
  const legendaryTypeId = getLegendaryTypeId(data);
  const brokenLinesMax = data.brokenLinesMax ?? 120;
  const history = toolState.historyBySet[set.setId] ?? [];
  const lastThree = history.slice(-3).reverse();

  const totalFishRemaining = Object.values(lakeState.remainingByTypeId).reduce((sum, count) => sum + count, 0);
  const legendaryRemaining = lakeState.remainingByTypeId[legendaryTypeId] ?? 0;
  const legendaryChance = totalFishRemaining > 0 ? (legendaryRemaining / totalFishRemaining) * 100 : 0;

  const weightsForLake = data.weightsByLake[lake.lakeId] ?? {};
  const ticketsPerKg = data.ticketsPerKgByLake?.[lake.lakeId] ?? null;
  const weightRemaining = Object.entries(lakeState.remainingByTypeId).reduce((sum, [typeId, count]) => {
    return sum + count * (weightsForLake[typeId] ?? 0);
  }, 0);
  const ticketsRemaining = ticketsPerKg ? weightRemaining * ticketsPerKg : null;

  const totalLegendaryCaught = Object.values(toolState.lakeStatesBySet[set.setId] ?? {}).reduce(
    (sum, entry) => sum + entry.legendaryCaught,
    0
  );
  const totalFishCaught = Object.values(toolState.lakeStatesBySet[set.setId] ?? {}).reduce(
    (sum, entry) => sum + entry.fishCaught,
    0
  );

  const avgTicketsPerFish = (() => {
    if (!ticketsPerKg) return null;
    const fullCounts = buildFullCounts(data, lake.lakeId);
    const totalWeight = Object.entries(fullCounts).reduce((sum, [typeId, count]) => {
      return sum + count * (weightsForLake[typeId] ?? 0);
    }, 0);
    const fishCount = Object.values(fullCounts).reduce((sum, count) => sum + count, 0);
    if (!fishCount) return null;
    return (totalWeight / fishCount) * ticketsPerKg;
  })();

  const goalTickets = toolState.goalTicketsBySet[set.setId] ?? null;
  const estimatedFishForGoal =
    goalTickets && avgTicketsPerFish ? Math.ceil(goalTickets / avgTicketsPerFish) : null;

  function updateToolState(updater: (prev: ToolState) => ToolState) {
    setToolState((prev) => (prev ? updater(prev) : prev));
  }

  function setActiveSet(setId: string) {
    updateToolState((prev) => ({ ...prev, activeSetId: setId }));
  }

  function setActiveLake(lakeId: string) {
    updateToolState((prev) => ({
      ...prev,
      activeLakeIdBySet: { ...prev.activeLakeIdBySet, [set.setId]: lakeId },
    }));
  }

  function resetLake(lakeId: string) {
    updateToolState((prev) => {
      const nextLakeStates = { ...prev.lakeStatesBySet[set.setId] };
      const existing = nextLakeStates[lakeId];
      if (!existing) return prev;
      nextLakeStates[lakeId] = {
        ...existing,
        remainingByTypeId: buildFullCounts(data, lakeId),
      };
      return { ...prev, lakeStatesBySet: { ...prev.lakeStatesBySet, [set.setId]: nextLakeStates } };
    });
  }

  function catchFish(typeId: string) {
    if (!lakeState.remainingByTypeId[typeId]) return;
    const fish = lake.fish.find((entry) => entry.typeId === typeId);
    if (!fish) return;

    updateToolState((prev) => {
      const nextLakeStates = { ...prev.lakeStatesBySet[set.setId] };
      const currentLakeState = nextLakeStates[lake.lakeId];
      if (!currentLakeState || currentLakeState.remainingByTypeId[typeId] <= 0) {
        return prev;
      }
      const prevLakeState: LakeState = {
        remainingByTypeId: { ...currentLakeState.remainingByTypeId },
        poolsCompleted: currentLakeState.poolsCompleted,
        legendaryCaught: currentLakeState.legendaryCaught,
        fishCaught: currentLakeState.fishCaught,
      };
      const nextRemaining = { ...currentLakeState.remainingByTypeId };
      nextRemaining[typeId] = Math.max(0, nextRemaining[typeId] - 1);

      let poolsCompleted = currentLakeState.poolsCompleted;
      const nextFishCaught = currentLakeState.fishCaught + 1;
      const nextLegendaryCaught =
        currentLakeState.legendaryCaught + (typeId === legendaryTypeId ? 1 : 0);

      const remainingTotal = Object.values(nextRemaining).reduce((sum, count) => sum + count, 0);
      if (remainingTotal === 0) {
        poolsCompleted += 1;
        Object.assign(nextRemaining, buildFullCounts(data, lake.lakeId));
      }

      nextLakeStates[lake.lakeId] = {
        remainingByTypeId: nextRemaining,
        poolsCompleted,
        legendaryCaught: nextLegendaryCaught,
        fishCaught: nextFishCaught,
      };

      const nextHistory = [...(prev.historyBySet[set.setId] ?? [])];
      nextHistory.push({
        entryId: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        lakeId: lake.lakeId,
        typeId,
        fishName: fish.name,
        rarity: data.fishTypes.find((type) => type.typeId === typeId)?.rarity ?? "rare",
        timestamp: Date.now(),
        prevLakeState,
      });

      return {
        ...prev,
        lakeStatesBySet: { ...prev.lakeStatesBySet, [set.setId]: nextLakeStates },
        historyBySet: { ...prev.historyBySet, [set.setId]: nextHistory.slice(-200) },
      };
    });
  }

  function catchWholePool() {
    updateToolState((prev) => {
      const nextLakeStates = { ...prev.lakeStatesBySet[set.setId] };
      const currentLakeState = nextLakeStates[lake.lakeId];
      if (!currentLakeState) return prev;
      const prevLakeState: LakeState = {
        remainingByTypeId: { ...currentLakeState.remainingByTypeId },
        poolsCompleted: currentLakeState.poolsCompleted,
        legendaryCaught: currentLakeState.legendaryCaught,
        fishCaught: currentLakeState.fishCaught,
      };

      const remainingCounts = currentLakeState.remainingByTypeId;
      const remainingTotal = Object.values(remainingCounts).reduce((sum, count) => sum + count, 0);
      if (!remainingTotal) return prev;

      const legendaryRemainingCount = remainingCounts[legendaryTypeId] ?? 0;
      nextLakeStates[lake.lakeId] = {
        remainingByTypeId: buildFullCounts(data, lake.lakeId),
        poolsCompleted: currentLakeState.poolsCompleted + 1,
        legendaryCaught: currentLakeState.legendaryCaught + legendaryRemainingCount,
        fishCaught: currentLakeState.fishCaught + remainingTotal,
      };

      const nextHistory = [...(prev.historyBySet[set.setId] ?? [])];
      nextHistory.push({
        entryId: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        lakeId: lake.lakeId,
        typeId: legendaryTypeId,
        fishName: "Pool cleared",
        rarity: "legendary",
        timestamp: Date.now(),
        prevLakeState,
      });

      return {
        ...prev,
        lakeStatesBySet: { ...prev.lakeStatesBySet, [set.setId]: nextLakeStates },
        historyBySet: { ...prev.historyBySet, [set.setId]: nextHistory.slice(-200) },
      };
    });
  }

  function undoLast() {
    updateToolState((prev) => {
      const nextHistory = [...(prev.historyBySet[set.setId] ?? [])];
      const last = nextHistory.pop();
      if (!last) return prev;
      const nextLakeStates = { ...prev.lakeStatesBySet[set.setId] };
      nextLakeStates[last.lakeId] = {
        remainingByTypeId: { ...last.prevLakeState.remainingByTypeId },
        poolsCompleted: last.prevLakeState.poolsCompleted,
        legendaryCaught: last.prevLakeState.legendaryCaught,
        fishCaught: last.prevLakeState.fishCaught,
      };
      return {
        ...prev,
        lakeStatesBySet: { ...prev.lakeStatesBySet, [set.setId]: nextLakeStates },
        historyBySet: { ...prev.historyBySet, [set.setId]: nextHistory },
      };
    });
  }

  function updateBrokenLines(delta: number) {
    updateToolState((prev) => {
      const current = prev.brokenLinesBySet[set.setId] ?? 0;
      const next = clampNumber(current + delta, 0, brokenLinesMax);
      return {
        ...prev,
        brokenLinesBySet: { ...prev.brokenLinesBySet, [set.setId]: next },
      };
    });
  }

  function setGoalTickets(value: number | null) {
    updateToolState((prev) => ({
      ...prev,
      goalTicketsBySet: { ...prev.goalTicketsBySet, [set.setId]: value },
    }));
  }

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 16, padding: 16, background: "var(--surface)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>{tool.title}</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 12, color: "var(--text-muted)" }}>Set</label>
          <select value={set.setId} onChange={(e) => setActiveSet(e.target.value)}>
            {data.sets.map((option) => (
              <option key={option.setId} value={option.setId}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {tool.description ? <p style={{ marginTop: 6 }}>{tool.description}</p> : null}

      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)" }}>Select a Lake</div>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
            {set.lakes.map((entry) => {
              const entryState = toolState.lakeStatesBySet[set.setId]?.[entry.lakeId];
              const remaining = entryState
                ? Object.values(entryState.remainingByTypeId).reduce((sum, count) => sum + count, 0)
                : 0;
              const legendaryLeft = entryState?.remainingByTypeId[legendaryTypeId] ?? 0;
              const odds = remaining > 0 ? (legendaryLeft / remaining) * 100 : 0;
              const active = entry.lakeId === lake.lakeId;
              return (
                <button
                  key={entry.lakeId}
                  type="button"
                  onClick={() => setActiveLake(entry.lakeId)}
                  style={{
                    border: active ? "2px solid var(--accent)" : "1px solid var(--border)",
                    background: active ? "var(--highlight)" : "var(--surface-2)",
                    color: "var(--text)",
                    padding: "10px 12px",
                    borderRadius: 12,
                    textAlign: "left",
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{entry.label}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {remaining} fish • {odds.toFixed(1)}% legendary
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10 }}>
            {data.fishTypes.map((fishType) => {
              const fish = lake.fish.find((entry) => entry.typeId === fishType.typeId);
              const remaining = lakeState.remainingByTypeId[fishType.typeId] ?? 0;
              return (
                <button
                  key={fishType.typeId}
                  type="button"
                  onClick={() => catchFish(fishType.typeId)}
                  style={{
                    border: "1px solid var(--border)",
                    background: "var(--surface-2)",
                    borderRadius: 12,
                    padding: "10px 8px",
                    textAlign: "center",
                    fontWeight: 600,
                  }}
                >
                  {fish?.image ? (
                    <img
                      src={resolvePath(fish.image)}
                      alt={fish?.name ?? fishType.label}
                      style={{ width: 44, height: 44, objectFit: "contain", marginBottom: 6 }}
                    />
                  ) : (
                    <div style={{ fontSize: 18, marginBottom: 6 }}>{fishType.label}</div>
                  )}
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{fish?.name ?? fishType.label}</div>
                  <div style={{ fontSize: 13 }}>{remaining} left</div>
                </button>
              );
            })}
          </div>

          <button type="button" className="secondary" onClick={catchWholePool}>
            Catch Whole Pool
          </button>
        </div>

        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface-2)" }}>
          <div style={{ fontWeight: 700 }}>Pool Stats</div>
          <div style={{ display: "grid", gap: 6, marginTop: 8, fontSize: 14 }}>
            <div>Fish remaining: {totalFishRemaining}</div>
            <div>Chance next fish is Legendary: {legendaryChance.toFixed(1)}%</div>
            <div>Weight remaining: {formatNumber(weightRemaining, 1)} kg</div>
            <div>Tickets remaining: {ticketsPerKg ? formatNumber(ticketsRemaining, 0) : "Add ticket data"}</div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="secondary" onClick={() => resetLake(lake.lakeId)}>
              Refill Lake
            </button>
            <button type="button" className="secondary" onClick={undoLast} disabled={!history.length}>
              Undo Last
            </button>
          </div>

          <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Broken Lines</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 700 }}>
                {toolState.brokenLinesBySet[set.setId] ?? 0}/{brokenLinesMax}
              </div>
              <button type="button" className="secondary" onClick={() => updateBrokenLines(1)}>
                +1 Break
              </button>
              <button type="button" className="secondary" onClick={() => updateBrokenLines(-1)}>
                -1 Break
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => updateBrokenLines(-brokenLinesMax)}
              >
                Reset
              </button>
            </div>
          </div>

          <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
            <div style={{ fontWeight: 700 }}>Totals</div>
            <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
              <div>Total Fish Caught: {totalFishCaught}</div>
              <div>Total Legendary Fish Caught: {totalLegendaryCaught}</div>
            </div>
          </div>

          <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Lake Progress</div>
            <div style={{ display: "grid", gap: 6 }}>
              {set.lakes.map((entry) => {
                const entryState = toolState.lakeStatesBySet[set.setId]?.[entry.lakeId];
                return (
                  <div key={entry.lakeId} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <div>{entry.label}</div>
                    <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
                      Pools: {entryState?.poolsCompleted ?? 0} • Legendary: {entryState?.legendaryCaught ?? 0}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Ticket Goal Estimate</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="text"
                inputMode="numeric"
                placeholder="Goal tickets"
                value={goalTickets === null ? "" : goalTickets}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^\d]/g, "");
                  setGoalTickets(raw ? Number(raw) : null);
                }}
                style={{ maxWidth: 140 }}
              />
              <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
                {avgTicketsPerFish && goalTickets
                  ? `~${formatNumber(estimatedFishForGoal)} fish needed (avg ${avgTicketsPerFish.toFixed(1)} tickets/fish)`
                  : "Add a goal to estimate fish needed."}
              </div>
            </div>
          </div>

          <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Recent Catches</div>
            {lastThree.length ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {lastThree.map((entry) => (
                  <div
                    key={entry.entryId}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 999,
                      background: "var(--surface-2)",
                      border: "1px solid var(--border)",
                      fontSize: 12,
                    }}
                  >
                    {entry.fishName}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: "var(--text-muted)" }}>No catches yet.</div>
            )}
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: "pointer" }}>History ({history.length})</summary>
              <div style={{ marginTop: 8, display: "grid", gap: 6, maxHeight: 180, overflow: "auto" }}>
                {history
                  .slice()
                  .reverse()
                  .map((entry) => {
                    const lakeLabel = set.lakes.find((l) => l.lakeId === entry.lakeId)?.label ?? entry.lakeId;
                    return (
                      <div key={entry.entryId} style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {lakeLabel}: {entry.fishName}
                      </div>
                    );
                  })}
              </div>
            </details>
          </div>
        </div>
      </div>
    </div>
  );
}
