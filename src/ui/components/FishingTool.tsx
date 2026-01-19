import { useEffect, useMemo, useState } from "react";
import type { TaskDefinition, ToolFishingCalculator } from "../../catalog/types";
import { buildTaskGroups, computeEarned, computeRemaining } from "../../catalog/taskGrouping";
import { getEventProgressState } from "../../state/userStateStore";

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
  activeLakeId: string;
  lakeStates: Record<string, LakeState>;
  brokenLines: number;
  history: HistoryEntry[];
  goalMode: "silver" | "gold" | "both";
  currentSilverTickets: number | null;
  targetSilverTickets: number | null;
  silverEstimateLakeId: string | null;
  currentGoldTickets: number | null;
  targetGoldTickets: number | null;
};

type DataState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: FishingToolData };

const STORAGE_PREFIX = "archero2_tool_state_";
const dataCache = new Map<string, FishingToolData>();
const toolStateCache = new Map<string, ToolState>();

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

function getFishTypeLabel(typeId: string, rarity: FishingFishType["rarity"]) {
  if (rarity === "legendary") return "Legendary";
  if (rarity === "epic") {
    if (typeId.endsWith("_1")) return "Small Epic";
    if (typeId.endsWith("_2")) return "Large Epic";
    return "Epic";
  }
  if (rarity === "rare") {
    if (typeId.endsWith("_1")) return "Small Rare";
    if (typeId.endsWith("_2")) return "Medium Rare";
    if (typeId.endsWith("_3")) return "Large Rare";
    return "Rare";
  }
  return rarity;
}

function sumCounts(values: Record<string, number>) {
  return Object.values(values).reduce((sum, count) => sum + count, 0);
}

function getAvgTicketsPerFish(
  data: FishingToolData,
  lakeId: string
): number | null {
  const ticketsPerKg = data.ticketsPerKgByLake?.[lakeId];
  if (!ticketsPerKg) return null;
  const fullCounts = buildFullCounts(data, lakeId);
  const weightsForLake = data.weightsByLake[lakeId] ?? {};
  const totalWeight = Object.entries(fullCounts).reduce((sum, [typeId, count]) => {
    return sum + count * (weightsForLake[typeId] ?? 0);
  }, 0);
  const fishCount = sumCounts(fullCounts);
  if (!fishCount) return null;
  return (totalWeight / fishCount) * ticketsPerKg;
}

export default function FishingToolView({
  tool,
  eventId,
  eventVersion,
  tasks,
}: {
  tool: ToolFishingCalculator;
  eventId?: string;
  eventVersion?: number;
  tasks?: TaskDefinition[];
}) {
  const [dataState, setDataState] = useState<DataState>(() => {
    const cached = dataCache.get(tool.dataPath);
    return cached ? { status: "ready", data: cached } : { status: "loading" };
  });
  const [toolState, setToolState] = useState<ToolState | null>(() => {
    return toolStateCache.get(tool.toolId) ?? null;
  });
  const [breakStep, setBreakStep] = useState(1);
  const [taskTick, setTaskTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      try {
        const cached = dataCache.get(tool.dataPath);
        if (cached) {
          setDataState({ status: "ready", data: cached });
          return;
        }
        const response = await fetch(resolvePath(tool.dataPath), { cache: "no-cache" });
        if (!response.ok) {
          throw new Error(`Failed to load tool data: ${response.status} ${response.statusText}`);
        }
        const json = (await response.json()) as FishingToolData;
        if (!cancelled) {
          dataCache.set(tool.dataPath, json);
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
    const activeSetId =
      stored?.activeSetId && data.sets.some((set) => set.setId === stored?.activeSetId)
        ? stored.activeSetId
        : defaultSetId;

    const nextState: ToolState = {
      activeSetId,
      activeLakeId: "",
      lakeStates: {},
      brokenLines: 0,
      history: [],
      goalMode: stored?.goalMode ?? "silver",
      currentSilverTickets: stored?.currentSilverTickets ?? null,
      targetSilverTickets: stored?.targetSilverTickets ?? stored?.goalTickets ?? null,
      silverEstimateLakeId: stored?.silverEstimateLakeId ?? data.lastLakeId ?? baseSet.lakes[0]?.lakeId ?? null,
      currentGoldTickets: stored?.currentGoldTickets ?? null,
      targetGoldTickets: stored?.targetGoldTickets ?? null,
    };

    const baseSet = data.sets[0];
    const legacySetKey = stored?.activeSetId ?? activeSetId;
    const storedLakeStates =
      stored?.lakeStates ??
      stored?.lakeStatesBySet?.[legacySetKey] ??
      {};
    const nextLakeStates: Record<string, LakeState> = {};
    for (const lake of baseSet.lakes) {
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

    const storedActiveLake =
      stored?.activeLakeId ??
      stored?.activeLakeIdBySet?.[legacySetKey];
    nextState.activeLakeId =
      storedActiveLake && baseSet.lakes.some((lake) => lake.lakeId === storedActiveLake)
        ? storedActiveLake
        : baseSet.lakes[0]?.lakeId ?? "";
    nextState.lakeStates = nextLakeStates;
    nextState.brokenLines = stored?.brokenLines ?? stored?.brokenLinesBySet?.[legacySetKey] ?? 0;
    nextState.history = stored?.history ?? stored?.historyBySet?.[legacySetKey] ?? [];
    nextState.goalMode = stored?.goalMode ?? "silver";
    nextState.currentSilverTickets = stored?.currentSilverTickets ?? null;
    nextState.targetSilverTickets = stored?.targetSilverTickets ?? stored?.goalTickets ?? null;
    nextState.silverEstimateLakeId =
      stored?.silverEstimateLakeId ?? data.lastLakeId ?? baseSet.lakes[0]?.lakeId ?? null;
    nextState.currentGoldTickets = stored?.currentGoldTickets ?? null;
    nextState.targetGoldTickets = stored?.targetGoldTickets ?? null;

    setToolState(nextState);
    toolStateCache.set(tool.toolId, nextState);
  }, [dataState, tool.defaultSetId, tool.toolId]);

  useEffect(() => {
    if (!toolState) return;
    const storageKey = `${STORAGE_PREFIX}${tool.toolId}`;
    localStorage.setItem(storageKey, JSON.stringify(toolState));
    toolStateCache.set(tool.toolId, toolState);
  }, [tool.toolId, toolState]);

  useEffect(() => {
    function handleStateChange() {
      setTaskTick((prev) => prev + 1);
    }
    window.addEventListener("archero2_user_state", handleStateChange);
    return () => window.removeEventListener("archero2_user_state", handleStateChange);
  }, []);

  const derived = useMemo(() => {
    if (dataState.status !== "ready" || !toolState) return null;
    const data = dataState.data;
    const set = data.sets.find((entry) => entry.setId === toolState.activeSetId);
    if (!set) return null;
    const lakeId = toolState.activeLakeId ?? set.lakes[0]?.lakeId ?? "";
    const lake = set.lakes.find((entry) => entry.lakeId === lakeId);
    if (!lake) return null;
    const lakeState = toolState.lakeStates[lake.lakeId];
    if (!lakeState) return null;

    return { data, set, lake, lakeState };
  }, [dataState, toolState]);

  const taskTotals = useMemo(() => {
    if (!eventId || !eventVersion || !tasks?.length) return null;
    void taskTick;
    const progress = getEventProgressState(eventId, eventVersion);
    const groups = buildTaskGroups(tasks);
    return groups.reduce(
      (acc, group) => {
        const state = progress.tasks[group.groupId] ?? { progressValue: 0, flags: { isCompleted: false, isClaimed: false } };
        acc.earned += computeEarned(group.tiers, state.progressValue);
        acc.remaining += computeRemaining(group.tiers, state.progressValue);
        return acc;
      },
      { earned: 0, remaining: 0 }
    );
  }, [eventId, eventVersion, tasks, taskTick]);

  const lakeRecommendations = useMemo(() => {
    if (dataState.status !== "ready" || !toolState) return null;
    const data = dataState.data;
    const set = data.sets.find((entry) => entry.setId === toolState.activeSetId);
    if (!set) return null;
    const legendaryTypeId = getLegendaryTypeId(data);
    const goldCurrent = toolState.currentGoldTickets ?? null;
    const goldTarget = toolState.targetGoldTickets ?? null;
    const goldRemaining =
      goldCurrent !== null && goldTarget !== null ? Math.max(0, goldTarget - goldCurrent) : null;
    if (!goldRemaining) return null;
    let best: { lakeId: string; expectedOne: number } | null = null;
    for (const entry of set.lakes) {
      const estimate = getLegendaryRangeForLake(entry.lakeId, 1, data, toolState.lakeStates, legendaryTypeId);
      if (!estimate) continue;
      if (!best || estimate.expectedOne < best.expectedOne) {
        best = { lakeId: entry.lakeId, expectedOne: estimate.expectedOne };
      }
    }
    return best;
  }, [dataState, toolState]);

  const goldRange = useMemo(() => {
    if (dataState.status !== "ready" || !toolState) return null;
    const data = dataState.data;
    const legendaryTypeId = getLegendaryTypeId(data);
    const goldCurrent = toolState.currentGoldTickets ?? null;
    const goldTarget = toolState.targetGoldTickets ?? null;
    const goldRemaining =
      goldCurrent !== null && goldTarget !== null ? Math.max(0, goldTarget - goldCurrent) : null;
    if (!goldRemaining || !lakeRecommendations) return null;
    return getLegendaryRangeForLake(
      lakeRecommendations.lakeId,
      goldRemaining,
      data,
      toolState.lakeStates,
      legendaryTypeId
    );
  }, [dataState, toolState, lakeRecommendations]);

  if (dataState.status === "loading") {
    return <p>Loading fishing tool…</p>;
  }

  if (dataState.status === "error") {
    return <p style={{ color: "var(--danger)" }}>Tool error: {dataState.error}</p>;
  }

  if (!toolState || !derived) {
    return <p>Loading fishing tool…</p>;
  }

  const { data, set, lake, lakeState } = derived;
  const legendaryTypeId = getLegendaryTypeId(data);
  const brokenLinesMax = data.brokenLinesMax ?? 120;
  const history = toolState.history ?? [];
  const lastThree = history.slice(-3).reverse();

  const totalFishRemaining = sumCounts(lakeState.remainingByTypeId);
  const legendaryRemaining = lakeState.remainingByTypeId[legendaryTypeId] ?? 0;
  const legendaryChance = totalFishRemaining > 0 ? (legendaryRemaining / totalFishRemaining) * 100 : 0;

  const weightsForLake = data.weightsByLake[lake.lakeId] ?? {};
  const ticketsPerKg = data.ticketsPerKgByLake?.[lake.lakeId] ?? null;
  const weightRemaining = Object.entries(lakeState.remainingByTypeId).reduce((sum, [typeId, count]) => {
    return sum + count * (weightsForLake[typeId] ?? 0);
  }, 0);
  const ticketsRemaining = ticketsPerKg ? weightRemaining * ticketsPerKg : null;

  const totalLegendaryCaught = Object.values(toolState.lakeStates ?? {}).reduce(
    (sum, entry) => sum + entry.legendaryCaught,
    0
  );
  const totalFishCaught = Object.values(toolState.lakeStates ?? {}).reduce(
    (sum, entry) => sum + entry.fishCaught,
    0
  );

  const avgTicketsPerFish = getAvgTicketsPerFish(data, lake.lakeId);
  const silverEstimateLakeId = toolState.silverEstimateLakeId ?? data.lastLakeId;
  const avgTicketsPerFishSilver = silverEstimateLakeId ? getAvgTicketsPerFish(data, silverEstimateLakeId) : null;

  const silverCurrent = toolState.currentSilverTickets ?? null;
  const silverTarget = toolState.targetSilverTickets ?? null;
  const silverRemaining = silverCurrent !== null && silverTarget !== null ? Math.max(0, silverTarget - silverCurrent) : null;
  const silverFishNeeded =
    silverRemaining !== null && avgTicketsPerFishSilver ? Math.ceil(silverRemaining / avgTicketsPerFishSilver) : null;
  const luresRemainingFromTasks = taskTotals?.remaining ?? null;
  const luresEarnedFromTasks = taskTotals?.earned ?? null;
  const silverLureShortfall =
    silverFishNeeded !== null && luresRemainingFromTasks !== null ? Math.max(0, silverFishNeeded - luresRemainingFromTasks) : null;
  const silverGemCost = silverLureShortfall !== null ? silverLureShortfall * 150 : null;

  function getLegendaryRangeForLake(
    lakeId: string,
    goal: number,
    data: FishingToolData,
    lakeStates: Record<string, LakeState>,
    legendaryTypeId: string
  ) {
    if (goal <= 0) return null;
    const state = lakeStates[lakeId];
    if (!state) return null;
    const remainingFish = sumCounts(state.remainingByTypeId);
    const remainingLegendary = state.remainingByTypeId[legendaryTypeId] ?? 0;
    const fullCounts = buildFullCounts(data, lakeId);
    const fullFish = sumCounts(fullCounts);
    const fullLegendary = fullCounts[legendaryTypeId] ?? 0;
    if (!fullLegendary) return null;
    const expectedFull = fullFish / fullLegendary;
    const bestOne = remainingLegendary > 0 ? 1 : remainingFish + 1;
    const worstOne = remainingLegendary > 0 ? remainingFish - remainingLegendary + 1 : remainingFish + fullFish;
    const expectedOne =
      remainingLegendary > 0 ? (remainingFish + 1) / (remainingLegendary + 1) : remainingFish + expectedFull;
    return {
      best: bestOne + (goal - 1),
      expected: expectedOne + (goal - 1) * expectedFull,
      worst: worstOne + (goal - 1) * fullFish,
      expectedOne,
    };
  }

  const goldCurrent = toolState.currentGoldTickets ?? null;
  const goldTarget = toolState.targetGoldTickets ?? null;
  const goldRemaining = goldCurrent !== null && goldTarget !== null ? Math.max(0, goldTarget - goldCurrent) : null;

  function updateToolState(updater: (prev: ToolState) => ToolState) {
    setToolState((prev) => (prev ? updater(prev) : prev));
  }

  function setActiveSet(setId: string) {
    updateToolState((prev) => ({ ...prev, activeSetId: setId }));
  }

  function setActiveLake(lakeId: string) {
    updateToolState((prev) => ({
      ...prev,
      activeLakeId: lakeId,
    }));
  }

  function resetLake(lakeId: string) {
    updateToolState((prev) => {
      const nextLakeStates = { ...prev.lakeStates };
      const existing = nextLakeStates[lakeId];
      if (!existing) return prev;
      nextLakeStates[lakeId] = {
        ...existing,
        remainingByTypeId: buildFullCounts(data, lakeId),
      };
      return { ...prev, lakeStates: nextLakeStates };
    });
  }

  function resetLakeProgress(lakeId: string) {
    updateToolState((prev) => {
      const nextLakeStates = { ...prev.lakeStates };
      const existing = nextLakeStates[lakeId];
      if (!existing) return prev;
      nextLakeStates[lakeId] = {
        remainingByTypeId: buildFullCounts(data, lakeId),
        poolsCompleted: 0,
        legendaryCaught: 0,
        fishCaught: 0,
      };
      return { ...prev, lakeStates: nextLakeStates };
    });
  }

  function catchFish(typeId: string) {
    if (!lakeState.remainingByTypeId[typeId]) return;
    const fish = lake.fish.find((entry) => entry.typeId === typeId);
    if (!fish) return;

    updateToolState((prev) => {
      const nextLakeStates = { ...prev.lakeStates };
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

      const nextHistory = [...(prev.history ?? [])];
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
        lakeStates: nextLakeStates,
        history: nextHistory.slice(-200),
      };
    });
  }

  function catchWholePool() {
    updateToolState((prev) => {
      const nextLakeStates = { ...prev.lakeStates };
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

      const nextHistory = [...(prev.history ?? [])];
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
        lakeStates: nextLakeStates,
        history: nextHistory.slice(-200),
      };
    });
  }

  function undoLast() {
    updateToolState((prev) => {
      const nextHistory = [...(prev.history ?? [])];
      const last = nextHistory.pop();
      if (!last) return prev;
      const nextLakeStates = { ...prev.lakeStates };
      nextLakeStates[last.lakeId] = {
        remainingByTypeId: { ...last.prevLakeState.remainingByTypeId },
        poolsCompleted: last.prevLakeState.poolsCompleted,
        legendaryCaught: last.prevLakeState.legendaryCaught,
        fishCaught: last.prevLakeState.fishCaught,
      };
      return {
        ...prev,
        lakeStates: nextLakeStates,
        history: nextHistory,
      };
    });
  }

  function updateBrokenLines(delta: number) {
    updateToolState((prev) => {
      const current = prev.brokenLines ?? 0;
      const next = clampNumber(current + delta, 0, brokenLinesMax);
      return {
        ...prev,
        brokenLines: next,
      };
    });
  }

  function setGoalMode(mode: ToolState["goalMode"]) {
    updateToolState((prev) => ({
      ...prev,
      goalMode: mode,
    }));
  }

  function setSilverEstimateLake(lakeId: string) {
    updateToolState((prev) => ({
      ...prev,
      silverEstimateLakeId: lakeId,
    }));
  }

  function setTicketValue(key: "currentSilverTickets" | "targetSilverTickets" | "currentGoldTickets" | "targetGoldTickets", value: number | null) {
    updateToolState((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  function resetAllProgress() {
    updateToolState((prev) => {
      const nextLakeStates: Record<string, LakeState> = {};
      for (const entry of set.lakes) {
        nextLakeStates[entry.lakeId] = {
          remainingByTypeId: buildFullCounts(data, entry.lakeId),
          poolsCompleted: 0,
          legendaryCaught: 0,
          fishCaught: 0,
        };
      }
      return {
        ...prev,
        lakeStates: nextLakeStates,
        brokenLines: 0,
        history: [],
      };
    });
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
              const entryState = toolState.lakeStates[entry.lakeId];
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
              const typeLabel = getFishTypeLabel(fishType.typeId, fishType.rarity);
              const displayName = fish?.name ?? typeLabel;
              const rarityStyle =
                fishType.rarity === "legendary"
                  ? { background: "#F2A31A", border: "1px solid #E79A14" }
                  : fishType.rarity === "epic"
                  ? { background: "#9B6BFF", border: "1px solid #8D5CFA" }
                  : { background: "#0E84FF", border: "1px solid #0A7CF2" };
              return (
                <button
                  key={fishType.typeId}
                  type="button"
                  onClick={() => catchFish(fishType.typeId)}
                  style={{
                    border: rarityStyle.border,
                    background: rarityStyle.background,
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
                    <div style={{ fontSize: 18, marginBottom: 6 }}>{typeLabel}</div>
                  )}
                  <div style={{ fontSize: 12, color: "#0A0A0A" }}>{displayName}</div>
                  <div style={{ fontSize: 13, color: "#0A0A0A" }}>{remaining} left</div>
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
            <div>Estimated Weight Remaining: {formatNumber(weightRemaining, 1)} kg</div>
            <div>Estimated Silver Tickets Remaining: {ticketsPerKg ? formatNumber(ticketsRemaining, 0) : "Add ticket data"}</div>
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
                {toolState.brokenLines ?? 0}/{brokenLinesMax}
              </div>
              <select value={breakStep} onChange={(e) => setBreakStep(Number(e.target.value))}>
                {[1, 2, 3, 5, 10].map((value) => (
                  <option key={value} value={value}>
                    +{value}
                  </option>
                ))}
              </select>
              <button type="button" className="secondary" onClick={() => updateBrokenLines(breakStep)}>
                Add Breaks
              </button>
              <button type="button" className="secondary" onClick={() => updateBrokenLines(-breakStep)}>
                Remove Breaks
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
                const entryState = toolState.lakeStates[entry.lakeId];
                return (
                  <div key={entry.lakeId} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <div>
                      <div>{entry.label}</div>
                      <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
                        Pools: {entryState?.poolsCompleted ?? 0} • Legendary: {entryState?.legendaryCaught ?? 0}
                      </div>
                    </div>
                    <button type="button" className="ghost" onClick={() => resetLakeProgress(entry.lakeId)}>
                      Reset
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Ticket Goals</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ fontSize: 12, color: "var(--text-muted)" }}>Goal Type</label>
              <select value={toolState.goalMode} onChange={(e) => setGoalMode(e.target.value as ToolState["goalMode"])}>
                <option value="silver">Silver Tickets</option>
                <option value="gold">Golden Tickets</option>
                <option value="both">Both</option>
              </select>
            </div>

            {toolState.goalMode !== "gold" ? (
              <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                <div style={{ fontWeight: 700 }}>Silver Tickets</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                    Current Silver Tickets
                    <input
                      type="text"
                      inputMode="numeric"
                      value={silverCurrent === null ? "" : silverCurrent}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^\d]/g, "");
                        setTicketValue("currentSilverTickets", raw ? Number(raw) : null);
                      }}
                      style={{ maxWidth: 160 }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                    Silver Tickets Goal
                    <input
                      type="text"
                      inputMode="numeric"
                      value={silverTarget === null ? "" : silverTarget}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^\d]/g, "");
                        setTicketValue("targetSilverTickets", raw ? Number(raw) : null);
                      }}
                      style={{ maxWidth: 160 }}
                    />
                  </label>
                </div>
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  {silverRemaining === null
                    ? "Enter current and goal silver tickets."
                    : silverRemaining === 0
                    ? "Goal reached."
                    : `Using ${set.lakes.find((entry) => entry.lakeId === data.lastLakeId)?.label ?? data.lastLakeId} for estimates.`}
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <label style={{ fontSize: 12, color: "var(--text-muted)" }}>Estimate lake</label>
                  <select
                    value={silverEstimateLakeId ?? ""}
                    onChange={(e) => setSilverEstimateLake(e.target.value)}
                  >
                    {set.lakes.map((entry) => (
                      <option key={entry.lakeId} value={entry.lakeId}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </div>
                {silverRemaining ? (
                  <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
                    <div>
                      Estimated fish needed:{" "}
                      <b>{silverFishNeeded !== null ? formatNumber(silverFishNeeded) : "—"}</b>
                    </div>
                    <div>
                      Lures earned from tasks:{" "}
                      <b>{luresEarnedFromTasks !== null ? formatNumber(luresEarnedFromTasks) : "—"}</b>
                    </div>
                    <div>
                      Lures remaining from tasks:{" "}
                      <b>{luresRemainingFromTasks !== null ? formatNumber(luresRemainingFromTasks) : "—"}</b>
                    </div>
                    <div>
                      Lure shortfall:{" "}
                      <b>{silverLureShortfall !== null ? formatNumber(silverLureShortfall) : "—"}</b>
                    </div>
                    <div>
                      Estimated gem cost:{" "}
                      <b>{silverGemCost !== null ? formatNumber(silverGemCost) : "—"}</b>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {toolState.goalMode !== "silver" ? (
              <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                <div style={{ fontWeight: 700 }}>Golden Tickets</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                    Current Golden Tickets
                    <input
                      type="text"
                      inputMode="numeric"
                      value={goldCurrent === null ? "" : goldCurrent}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^\d]/g, "");
                        setTicketValue("currentGoldTickets", raw ? Number(raw) : null);
                      }}
                      style={{ maxWidth: 160 }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                    Golden Tickets Goal
                    <input
                      type="text"
                      inputMode="numeric"
                      value={goldTarget === null ? "" : goldTarget}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^\d]/g, "");
                        setTicketValue("targetGoldTickets", raw ? Number(raw) : null);
                      }}
                      style={{ maxWidth: 160 }}
                    />
                  </label>
                </div>
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  {goldRemaining === null
                    ? "Enter current and goal golden tickets."
                    : goldRemaining === 0
                    ? "Goal reached."
                    : lakeRecommendations
                    ? `Recommended lake: ${set.lakes.find((entry) => entry.lakeId === lakeRecommendations.lakeId)?.label ?? lakeRecommendations.lakeId}.`
                    : "Add a goal to see a recommended lake."}
                </div>
                {goldRemaining && goldRange ? (
                  <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
                    <div>
                      Estimated fish needed (best / expected / worst):{" "}
                      <b>
                        {formatNumber(Math.ceil(goldRange.best))} / {formatNumber(Math.ceil(goldRange.expected))} /{" "}
                        {formatNumber(Math.ceil(goldRange.worst))}
                      </b>
                    </div>
                    <div style={{ color: "var(--text-muted)" }}>
                      Based on current pools in the recommended lake.
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
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

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="button" className="ghost" onClick={resetAllProgress}>
              Reset All Progress
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
