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
  goalPreset: "silver-heavy" | "gold-efficient" | "custom";
  currentSilverTickets: number | null;
  targetSilverTickets: number | null;
  silverEstimateLakeId: string | null;
  currentGoldTickets: number | null;
  targetGoldTickets: number | null;
  currentLures: number | null;
  purchasedLures: number | null;
  currentGems: number | null;
  purchaseCounts: {
    etchedRune: number | null;
    blessedRune: number | null;
    artifact: number | null;
  };
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
      goalPreset: stored?.goalPreset ?? "custom",
      currentSilverTickets: stored?.currentSilverTickets ?? null,
      targetSilverTickets: stored?.targetSilverTickets ?? stored?.goalTickets ?? null,
      silverEstimateLakeId: stored?.silverEstimateLakeId ?? data.lastLakeId ?? baseSet.lakes[0]?.lakeId ?? null,
      currentGoldTickets: stored?.currentGoldTickets ?? null,
      targetGoldTickets: stored?.targetGoldTickets ?? null,
      currentLures: stored?.currentLures ?? null,
      purchasedLures: stored?.purchasedLures ?? null,
      currentGems: stored?.currentGems ?? null,
      purchaseCounts: stored?.purchaseCounts ?? { etchedRune: null, blessedRune: null, artifact: null },
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
    nextState.goalPreset = stored?.goalPreset ?? "custom";
    nextState.currentSilverTickets = stored?.currentSilverTickets ?? null;
    nextState.targetSilverTickets = stored?.targetSilverTickets ?? stored?.goalTickets ?? null;
    nextState.silverEstimateLakeId =
      stored?.silverEstimateLakeId ?? data.lastLakeId ?? baseSet.lakes[0]?.lakeId ?? null;
    nextState.currentGoldTickets = stored?.currentGoldTickets ?? null;
    nextState.targetGoldTickets = stored?.targetGoldTickets ?? null;
    nextState.currentLures = stored?.currentLures ?? null;
    nextState.purchasedLures = stored?.purchasedLures ?? null;
    nextState.currentGems = stored?.currentGems ?? null;
    nextState.purchaseCounts = stored?.purchaseCounts ?? { etchedRune: null, blessedRune: null, artifact: null };

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

  const baselineMin = 70000;
  const baselineMax = 130000;
  const baselineDefault = 120000;
  const silverGoalBaselineRaw = toolState?.targetSilverTickets ?? baselineDefault;
  const silverGoalBaseline = clampNumber(silverGoalBaselineRaw, baselineMin, baselineMax);

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
    const silverCurrent = toolState.currentSilverTickets ?? null;
    const silverTarget = toolState.targetSilverTickets ?? null;
    const silverRemaining =
      silverCurrent !== null && silverTarget !== null ? Math.max(0, silverTarget - silverCurrent) : null;
    const silverGoalBaselineRaw = silverTarget ?? baselineDefault;
    const silverGoalBaseline = clampNumber(silverGoalBaselineRaw, baselineMin, baselineMax);
    const silverWeight =
      silverRemaining && silverGoalBaseline > 0
        ? Math.min(1, Math.max(0.25, silverRemaining / silverGoalBaseline))
        : 0;

    const maxAvgTickets = Math.max(
      ...set.lakes.map((entry) => getAvgTicketsPerFish(data, entry.lakeId) ?? 0)
    );

    const quickThreshold = 10;
    let quickPick: { lakeId: string; remainingFish: number } | null = null;
    for (const entry of set.lakes) {
      const state = toolState.lakeStates[entry.lakeId];
      if (!state) continue;
      const remainingFish = sumCounts(state.remainingByTypeId);
      const remainingLegendary = state.remainingByTypeId[legendaryTypeId] ?? 0;
      if (remainingLegendary > 0 && remainingFish <= quickThreshold) {
        if (!quickPick || remainingFish < quickPick.remainingFish) {
          quickPick = { lakeId: entry.lakeId, remainingFish };
        }
      }
    }

    function scoreLake(lakeId: string, goal: number) {
      const estimate = getLegendaryRangeForLake(lakeId, goal, data, toolState.lakeStates, legendaryTypeId);
      if (!estimate) return null;
      const avgTicketsPerFish = getAvgTicketsPerFish(data, lakeId);
      const expectedFish = estimate.expected;
      const fishEquivalent =
        avgTicketsPerFish && maxAvgTickets > 0 ? (expectedFish * avgTicketsPerFish) / maxAvgTickets : 0;
      const riskAdjusted = expectedFish + estimate.worst * 0.5 + estimate.best * 0.25;
      const score = riskAdjusted - fishEquivalent * silverWeight;
      return { lakeId, avgTicketsPerFish, score };
    }

    if (quickPick && goldRemaining > 0) {
      const remainingGoal = Math.max(0, goldRemaining - 1);
      let bestRest: { lakeId: string; avgTicketsPerFish: number | null; score: number } | null = null;
      if (remainingGoal > 0) {
        for (const entry of set.lakes) {
          if (entry.lakeId === quickPick.lakeId) continue;
          const scored = scoreLake(entry.lakeId, remainingGoal);
          if (!scored) continue;
          if (!bestRest || scored.score < bestRest.score - 0.01) {
            bestRest = scored;
          }
        }
      }
      return {
        lakeId: quickPick.lakeId,
        avgTicketsPerFish: getAvgTicketsPerFish(data, quickPick.lakeId),
        score: -Infinity,
        silverWeight,
        quickPick: true,
        restLakeId: bestRest?.lakeId ?? null,
      };
    }

    let best:
      | {
          lakeId: string;
          avgTicketsPerFish: number | null;
          score: number;
          silverWeight: number;
          quickPick?: boolean;
          restLakeId?: string | null;
        }
      | null = null;
    for (const entry of set.lakes) {
      const scored = scoreLake(entry.lakeId, goldRemaining);
      if (!scored) continue;
      const { avgTicketsPerFish, score } = scored;
      if (!best || score < best.score - 0.01) {
        best = {
          lakeId: entry.lakeId,
          avgTicketsPerFish,
          score,
          silverWeight,
        };
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
    if (lakeRecommendations.quickPick && lakeRecommendations.restLakeId && goldRemaining > 1) {
      const first = getLegendaryRangeForLake(
        lakeRecommendations.lakeId,
        1,
        data,
        toolState.lakeStates,
        legendaryTypeId
      );
      const rest = getLegendaryRangeForLake(
        lakeRecommendations.restLakeId,
        goldRemaining - 1,
        data,
        toolState.lakeStates,
        legendaryTypeId
      );
      if (!first || !rest) return null;
      return {
        best: first.best + rest.best,
        expected: first.expected + rest.expected,
        worst: first.worst + rest.worst,
        expectedOne: first.expectedOne,
      };
    }
    return getLegendaryRangeForLake(
      lakeRecommendations.lakeId,
      goldRemaining,
      data,
      toolState.lakeStates,
      legendaryTypeId
    );
  }, [dataState, toolState, lakeRecommendations]);

  const suggestedSilverTarget = useMemo(() => {
    if (!toolState) return null;
    const counts = toolState.purchaseCounts;
    if (!counts) return null;
    const goldTarget = toolState.targetGoldTickets ?? 0;
    const etchedCount = counts.etchedRune ?? 0;
    const etchedViaGold = Math.min(etchedCount, Math.floor(goldTarget / 16));
    const etchedViaSilver = etchedCount - etchedViaGold;
    let total = 0;
    if (etchedViaSilver) total += etchedViaSilver * 32400;
    if (counts.blessedRune) total += counts.blessedRune * 4050;
    if (counts.artifact) total += counts.artifact * 184000;
    return total || null;
  }, [toolState?.purchaseCounts, toolState?.targetGoldTickets]);

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
  const currentLures = toolState.currentLures ?? null;
  const purchasedLures = toolState.purchasedLures ?? null;
  const currentGems = toolState.currentGems ?? null;
  const totalAvailableLures =
    currentLures !== null && luresRemainingFromTasks !== null
      ? currentLures + luresRemainingFromTasks + (purchasedLures ?? 0)
      : null;
  const purchasableLuresFromGems = currentGems !== null ? Math.floor(currentGems / 150) : null;
  const maxPossibleLures =
    totalAvailableLures !== null && purchasableLuresFromGems !== null
      ? totalAvailableLures + purchasableLuresFromGems
      : null;
  const silverLureShortfall =
    silverFishNeeded !== null && totalAvailableLures !== null ? Math.max(0, silverFishNeeded - totalAvailableLures) : null;
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
    const expectedOneFull = (fullFish + 1) / (fullLegendary + 1);
    const expectedOneRemaining =
      remainingLegendary > 0 ? (remainingFish + 1) / (remainingLegendary + 1) : null;

    function poolRange(totalFish: number, legendaryCount: number, target: number) {
      const best = target;
      const worst = totalFish - legendaryCount + target;
      const expected = (target * (totalFish + 1)) / (legendaryCount + 1);
      return { best, expected, worst };
    }

    if (goal <= remainingLegendary) {
      const range = poolRange(remainingFish, remainingLegendary, goal);
      return {
        ...range,
        expectedOne: expectedOneRemaining ?? expectedOneFull,
      };
    }

    const remainingGoal = goal - remainingLegendary;
    const fullPoolsBefore = Math.floor((remainingGoal - 1) / fullLegendary);
    const remainingInLast = remainingGoal - fullPoolsBefore * fullLegendary;

    const lastRange = poolRange(fullFish, fullLegendary, remainingInLast);
    const best = remainingFish + fullPoolsBefore * fullFish + lastRange.best;
    const expected = remainingFish + fullPoolsBefore * fullFish + lastRange.expected;
    const worst = remainingFish + fullPoolsBefore * fullFish + lastRange.worst;

    return {
      best,
      expected,
      worst,
      expectedOne: expectedOneRemaining ?? remainingFish + expectedOneFull,
    };
  }

  const goldCurrent = toolState.currentGoldTickets ?? null;
  const goldTarget = toolState.targetGoldTickets ?? null;
  const goldRemaining = goldCurrent !== null && goldTarget !== null ? Math.max(0, goldTarget - goldCurrent) : null;
  const goldExpectedLures = goldRange ? Math.ceil(goldRange.expected) : null;
  const goldLureShortfall =
    goldExpectedLures !== null && totalAvailableLures !== null ? Math.max(0, goldExpectedLures - totalAvailableLures) : null;
  const goldGemCost = goldLureShortfall !== null ? goldLureShortfall * 150 : null;

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

  function setGoalPreset(preset: ToolState["goalPreset"]) {
    if (preset === "custom") {
      updateToolState((prev) => ({ ...prev, goalPreset: "custom" }));
      return;
    }
    const presetValues =
      preset === "silver-heavy" ? { silver: 120000, gold: 16 } : { silver: 80000, gold: 16 };
    updateToolState((prev) => ({
      ...prev,
      goalPreset: preset,
      targetSilverTickets: presetValues.silver,
      targetGoldTickets: presetValues.gold,
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

  function setTargetTicketValue(key: "targetSilverTickets" | "targetGoldTickets", value: number | null) {
    updateToolState((prev) => ({
      ...prev,
      [key]: value,
      goalPreset: "custom",
    }));
  }

  function setResourceValue(
    key: "currentLures" | "purchasedLures" | "currentGems",
    value: number | null
  ) {
    updateToolState((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  function setPurchaseCount(key: keyof ToolState["purchaseCounts"], value: number | null) {
    updateToolState((prev) => ({
      ...prev,
      purchaseCounts: { ...prev.purchaseCounts, [key]: value },
      goalPreset: "custom",
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
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Purchase Goals</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ fontSize: 12, color: "var(--text-muted)" }}>Preset</label>
              <select value={toolState.goalPreset} onChange={(e) => setGoalPreset(e.target.value as ToolState["goalPreset"])}>
                <option value="silver-heavy">Silver-heavy (120k + 16 gold)</option>
                <option value="gold-efficient">Gold-efficient (80k + 16 gold)</option>
                <option value="custom">Custom</option>
              </select>
            </div>

            <div style={{ display: "grid", gap: 10, marginTop: 12, padding: 10, borderRadius: 10, background: "var(--surface-2)", border: "1px solid var(--border)" }}>
              <div style={{ fontWeight: 700 }}>Purchase Goals</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Etched runes can be purchased with 16 gold or 32,400 silver each.
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                  Etched Rune (32,400)
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Qty"
                    value={toolState.purchaseCounts.etchedRune === null ? "" : toolState.purchaseCounts.etchedRune}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^\d]/g, "");
                      setPurchaseCount("etchedRune", raw ? Number(raw) : null);
                    }}
                    style={{ maxWidth: 120 }}
                  />
                </label>
                <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                  Blessed Rune (4,050)
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Qty"
                    value={toolState.purchaseCounts.blessedRune === null ? "" : toolState.purchaseCounts.blessedRune}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^\d]/g, "");
                      setPurchaseCount("blessedRune", raw ? Number(raw) : null);
                    }}
                    style={{ maxWidth: 120 }}
                  />
                </label>
                <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                  Artifact (184,000)
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Qty"
                    value={toolState.purchaseCounts.artifact === null ? "" : toolState.purchaseCounts.artifact}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^\d]/g, "");
                      setPurchaseCount("artifact", raw ? Number(raw) : null);
                    }}
                    style={{ maxWidth: 120 }}
                  />
                </label>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, fontSize: 12 }}>
                <span>Suggested silver target: <b>{suggestedSilverTarget ? formatNumber(suggestedSilverTarget) : "—"}</b></span>
                {suggestedSilverTarget ? (
                  <button
                    type="button"
                    className="ghost"
                        onClick={() => setTargetTicketValue("targetSilverTickets", suggestedSilverTarget)}
                  >
                    Use Suggested
                  </button>
                ) : null}
              </div>
            </div>

            <div style={{ display: "grid", gap: 10, marginTop: 12, padding: 10, borderRadius: 10, background: "var(--surface-2)", border: "1px solid var(--border)" }}>
              <div style={{ fontWeight: 700 }}>Silver Tickets</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                  Current Silver Tickets
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Current"
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
                    placeholder="Target"
                    value={silverTarget === null ? "" : silverTarget}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^\d]/g, "");
                      setTargetTicketValue("targetSilverTickets", raw ? Number(raw) : null);
                    }}
                    style={{ maxWidth: 160 }}
                  />
                </label>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                  Current Lures
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="On hand"
                    value={currentLures === null ? "" : currentLures}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^\d]/g, "");
                      setResourceValue("currentLures", raw ? Number(raw) : null);
                    }}
                    style={{ maxWidth: 160 }}
                  />
                </label>
                <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                  Lures Bought
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Purchased"
                    value={purchasedLures === null ? "" : purchasedLures}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^\d]/g, "");
                      setResourceValue("purchasedLures", raw ? Number(raw) : null);
                    }}
                    style={{ maxWidth: 160 }}
                  />
                </label>
                <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                  Current Gems
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Gems"
                    value={currentGems === null ? "" : currentGems}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^\d]/g, "");
                      setResourceValue("currentGems", raw ? Number(raw) : null);
                    }}
                    style={{ maxWidth: 160 }}
                  />
                </label>
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
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                {silverRemaining === null
                  ? "Enter current and goal silver tickets."
                  : silverRemaining === 0
                  ? "Goal reached."
                  : `Using ${set.lakes.find((entry) => entry.lakeId === silverEstimateLakeId)?.label ?? silverEstimateLakeId} for estimates.`}
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
                    Lures available (now + tasks + bought):{" "}
                    <b>{totalAvailableLures !== null ? formatNumber(totalAvailableLures) : "—"}</b>
                  </div>
                  <div>
                    Max possible lures (incl. gems):{" "}
                    <b>{maxPossibleLures !== null ? formatNumber(maxPossibleLures) : "—"}</b>
                  </div>
                  <div>
                    Lure shortfall:{" "}
                    <b>{silverLureShortfall !== null ? formatNumber(silverLureShortfall) : "—"}</b>
                  </div>
                  <div>
                    Estimated gem cost:{" "}
                    <b>{silverGemCost !== null ? formatNumber(silverGemCost) : "—"}</b>
                  </div>
                  {currentGems !== null && silverGemCost !== null && currentGems < silverGemCost ? (
                    <div style={{ color: "var(--danger)" }}>
                      Not enough gems for the silver goal with current lures.
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div style={{ display: "grid", gap: 10, marginTop: 12, padding: 10, borderRadius: 10, background: "var(--surface-2)", border: "1px solid var(--border)" }}>
              <div style={{ fontWeight: 700 }}>Golden Tickets</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                  Current Golden Tickets
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Current"
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
                    placeholder="Target"
                    value={goldTarget === null ? "" : goldTarget}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^\d]/g, "");
                      setTargetTicketValue("targetGoldTickets", raw ? Number(raw) : null);
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
                  : lakeRecommendations?.quickPick && lakeRecommendations.restLakeId
                  ? `Quick legendary in ${set.lakes.find((entry) => entry.lakeId === lakeRecommendations.lakeId)?.label ?? lakeRecommendations.lakeId}, then switch to ${set.lakes.find((entry) => entry.lakeId === lakeRecommendations.restLakeId)?.label ?? lakeRecommendations.restLakeId}.`
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
                  <div>
                    Estimated gem cost (expected):{" "}
                    <b>{formatNumber(Math.ceil(goldRange.expected) * 150)}</b>
                  </div>
                  <div>
                    Lures available (now + tasks + bought):{" "}
                    <b>{totalAvailableLures !== null ? formatNumber(totalAvailableLures) : "—"}</b>
                  </div>
                  <div>
                    Max possible lures (incl. gems):{" "}
                    <b>{maxPossibleLures !== null ? formatNumber(maxPossibleLures) : "—"}</b>
                  </div>
                  <div>
                    Estimated silver tickets gained (expected):{" "}
                    <b>
                      {lakeRecommendations?.avgTicketsPerFish
                        ? formatNumber(goldRange.expected * lakeRecommendations.avgTicketsPerFish, 0)
                        : "—"}
                    </b>
                  </div>
                  {currentGems !== null && goldGemCost !== null && currentGems < goldGemCost ? (
                    <div style={{ color: "var(--danger)" }}>
                      Not enough gems for the golden goal with current lures.
                    </div>
                  ) : null}
                  <div style={{ color: "var(--text-muted)" }}>
                    Weighted by silver value (weight {formatNumber(lakeRecommendations?.silverWeight ?? 0, 2)} using baseline {formatNumber(silverGoalBaseline)}). Best-case assumes full pools between legendaries.
                  </div>
                </div>
              ) : null}
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
