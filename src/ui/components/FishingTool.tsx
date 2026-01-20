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

type GuidedRouteData = {
  schemaVersion: number;
  finalLakeId: string;
  poolSizes: Record<string, number>;
  options: GuidedRouteOption[];
};

type GuidedRouteOption = {
  optionId: string;
  title: string;
  summary?: string;
  disclaimer?: string;
  steps: GuidedRouteStep[];
};

type GuidedRouteStep = {
  stepId: string;
  lakeId: string;
  action: string;
  notes?: string;
  goal: {
    type: "manual_confirm" | "pools_cleared" | "legendary_caught" | "gold_target" | "weight_at_least";
    count: number;
    scope?: "lake" | "total";
    maxCount?: number;
    skipIfBrokenLinesOver?: number;
    onlyIfLegendaryBelow?: number;
    onlyIfLegendaryBelowScope?: "lake" | "total";
    warnIfBrokenLinesOver?: number;
  };
  skipIfBrokenLinesOver?: number;
  warnIfBrokenLinesOver?: number;
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
  currentLures: number | null;
  purchasedLures: number | null;
  currentGems: number | null;
  purchaseCounts: {
    etchedRune: number | null;
    blessedRune: number | null;
    artifact: number | null;
  };
  goldPurchaseCounts: {
    etchedRune: number | null;
    advancedEnchantium: number | null;
    ruinShovelBundle: number | null;
    promisedShovelBundle: number | null;
    chromaticKeyBundle: number | null;
  };
  guidedOptionId: string | null;
  guidedStepIndex: number;
  guidedCollapsed: boolean;
  guidedCurrentWeight: number | null;
};

type DataState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: FishingToolData };

type GuidedState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: GuidedRouteData };

const STORAGE_PREFIX = "archero2_tool_state_";
const dataCache = new Map<string, FishingToolData>();
const guidedCache = new Map<string, GuidedRouteData>();
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
  guidedRoutePath,
}: {
  tool: ToolFishingCalculator;
  eventId?: string;
  eventVersion?: number;
  tasks?: TaskDefinition[];
  guidedRoutePath?: string;
}) {
  const [dataState, setDataState] = useState<DataState>(() => {
    const cached = dataCache.get(tool.dataPath);
    return cached ? { status: "ready", data: cached } : { status: "loading" };
  });
  const [guidedState, setGuidedState] = useState<GuidedState>(() => {
    if (!guidedRoutePath) return { status: "idle" };
    const cached = guidedCache.get(guidedRoutePath);
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
    let cancelled = false;
    if (!guidedRoutePath) {
      setGuidedState({ status: "idle" });
      return;
    }
    async function loadGuidedRoute() {
      try {
        const cached = guidedCache.get(guidedRoutePath);
        if (cached) {
          setGuidedState({ status: "ready", data: cached });
          return;
        }
        const response = await fetch(resolvePath(guidedRoutePath), { cache: "no-cache" });
        if (!response.ok) {
          throw new Error(`Failed to load guided route: ${response.status} ${response.statusText}`);
        }
        const json = (await response.json()) as GuidedRouteData;
        if (!cancelled) {
          guidedCache.set(guidedRoutePath, json);
          setGuidedState({ status: "ready", data: json });
        }
      } catch (error) {
        if (!cancelled) {
          setGuidedState({ status: "error", error: error instanceof Error ? error.message : "Unknown error" });
        }
      }
    }
    loadGuidedRoute();
    return () => {
      cancelled = true;
    };
  }, [guidedRoutePath]);

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

    const baseSet = data.sets[0];
    const nextState: ToolState = {
      activeSetId,
      activeLakeId: "",
      lakeStates: {},
      brokenLines: 0,
      history: [],
      goalMode: stored?.goalMode ?? "silver",
      goalPreset: stored?.goalPreset ?? "custom",
      currentSilverTickets: stored?.currentSilverTickets ?? null,
      targetSilverTickets: stored?.targetSilverTickets ?? null,
      silverEstimateLakeId: stored?.silverEstimateLakeId ?? data.lastLakeId ?? baseSet.lakes[0]?.lakeId ?? null,
      currentGoldTickets: stored?.currentGoldTickets ?? null,
      currentLures: stored?.currentLures ?? null,
      purchasedLures: stored?.purchasedLures ?? null,
      currentGems: stored?.currentGems ?? null,
      purchaseCounts: stored?.purchaseCounts ?? { etchedRune: null, blessedRune: null, artifact: null },
      goldPurchaseCounts: stored?.goldPurchaseCounts ?? {
        etchedRune: 1,
        advancedEnchantium: null,
        ruinShovelBundle: null,
        promisedShovelBundle: null,
        chromaticKeyBundle: null,
      },
      guidedOptionId: stored?.guidedOptionId ?? null,
      guidedStepIndex: stored?.guidedStepIndex ?? 0,
      guidedCollapsed: stored?.guidedCollapsed ?? true,
      guidedCurrentWeight: stored?.guidedCurrentWeight ?? null,
    };
    const storedLakeStates =
      stored?.lakeStates ?? {};
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

    const storedActiveLake = stored?.activeLakeId;
    nextState.activeLakeId =
      storedActiveLake && baseSet.lakes.some((lake) => lake.lakeId === storedActiveLake)
        ? storedActiveLake
        : baseSet.lakes[0]?.lakeId ?? "";
    nextState.lakeStates = nextLakeStates;
    nextState.brokenLines = stored?.brokenLines ?? 0;
    nextState.history = stored?.history ?? [];
    nextState.goalMode = stored?.goalMode ?? "silver";
    nextState.goalPreset = stored?.goalPreset ?? "custom";
    nextState.currentSilverTickets = stored?.currentSilverTickets ?? null;
    nextState.targetSilverTickets = stored?.targetSilverTickets ?? null;
    nextState.silverEstimateLakeId =
      stored?.silverEstimateLakeId ?? data.lastLakeId ?? baseSet.lakes[0]?.lakeId ?? null;
    nextState.currentGoldTickets = stored?.currentGoldTickets ?? null;
    nextState.currentLures = stored?.currentLures ?? null;
    nextState.purchasedLures = stored?.purchasedLures ?? null;
    nextState.currentGems = stored?.currentGems ?? null;
    nextState.purchaseCounts = stored?.purchaseCounts ?? { etchedRune: null, blessedRune: null, artifact: null };
    nextState.goldPurchaseCounts = stored?.goldPurchaseCounts ?? {
      etchedRune: 1,
      advancedEnchantium: null,
      ruinShovelBundle: null,
      promisedShovelBundle: null,
      chromaticKeyBundle: null,
    };
    nextState.guidedOptionId = stored?.guidedOptionId ?? null;
    nextState.guidedStepIndex = stored?.guidedStepIndex ?? 0;
    nextState.guidedCollapsed = stored?.guidedCollapsed ?? true;
    nextState.guidedCurrentWeight = stored?.guidedCurrentWeight ?? null;

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

  const goldTarget = useMemo(() => {
    if (!toolState) return null;
    const counts = toolState.goldPurchaseCounts;
    if (!counts) return null;
    let total = 0;
    if (counts.etchedRune) total += counts.etchedRune * 16;
    if (counts.advancedEnchantium) total += counts.advancedEnchantium * 18;
    if (counts.ruinShovelBundle) total += counts.ruinShovelBundle * 1;
    if (counts.promisedShovelBundle) total += counts.promisedShovelBundle * 1;
    if (counts.chromaticKeyBundle) total += counts.chromaticKeyBundle * 4;
    return total || null;
  }, [toolState?.goldPurchaseCounts]);

  const suggestedSilverTarget = useMemo(() => {
    if (!toolState) return null;
    const counts = toolState.purchaseCounts;
    if (!counts) return null;
    const etchedCount = counts.etchedRune ?? 0;
    let total = 0;
    if (etchedCount) total += etchedCount * 32400;
    if (counts.blessedRune) total += counts.blessedRune * 4050;
    if (counts.artifact) total += counts.artifact * 184000;
    return total || null;
  }, [toolState?.purchaseCounts]);

  const effectiveSilverTarget = toolState?.targetSilverTickets ?? suggestedSilverTarget ?? null;
  const silverGoalBaselineRaw = effectiveSilverTarget ?? baselineDefault;
  const silverGoalBaseline = clampNumber(silverGoalBaselineRaw, baselineMin, baselineMax);

  const guidedOption = useMemo(() => {
    if (guidedState.status !== "ready" || !toolState) return null;
    const options = guidedState.data.options ?? [];
    const preferred = toolState.guidedOptionId
      ? options.find((option) => option.optionId === toolState.guidedOptionId)
      : null;
    return preferred ?? options[0] ?? null;
  }, [guidedState, toolState?.guidedOptionId]);

  const lakeRecommendations = useMemo(() => {
    if (dataState.status !== "ready" || !toolState) return null;
    const data = dataState.data;
    const set = data.sets.find((entry) => entry.setId === toolState.activeSetId);
    if (!set) return null;
    const legendaryTypeId = getLegendaryTypeId(data);
    const goldCurrent = toolState.currentGoldTickets ?? null;
    const goldRemaining =
      goldCurrent !== null && goldTarget !== null ? Math.max(0, goldTarget - goldCurrent) : null;
    if (!goldRemaining) return null;
    const lakeStates = toolState.lakeStates;
    const silverCurrent = toolState.currentSilverTickets ?? null;
    const silverTarget = effectiveSilverTarget;
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
      const estimate = getLegendaryRangeForLake(lakeId, goal, data, lakeStates, legendaryTypeId);
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
  }, [dataState, toolState, goldTarget, effectiveSilverTarget]);

  const goldRange = useMemo(() => {
    if (dataState.status !== "ready" || !toolState) return null;
    const data = dataState.data;
    const legendaryTypeId = getLegendaryTypeId(data);
    const goldCurrent = toolState.currentGoldTickets ?? null;
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
  }, [dataState, toolState, lakeRecommendations, goldTarget]);

  const guidedStepData = useMemo(() => {
    if (!toolState || !guidedOption || guidedState.status !== "ready") return null;
    const steps = guidedOption.steps ?? [];
    const stepIndex = Math.min(toolState.guidedStepIndex, Math.max(steps.length - 1, 0));
    const step = steps[stepIndex];
    if (!step) return null;
    const lakeStateForStep = toolState.lakeStates[step.lakeId];
    const brokenLinesUsed = toolState.brokenLines ?? 0;
    const skipThreshold = step.skipIfBrokenLinesOver ?? step.goal.skipIfBrokenLinesOver ?? null;
    const warnThreshold = step.warnIfBrokenLinesOver ?? step.goal.warnIfBrokenLinesOver ?? null;
    const warnMessage =
      warnThreshold !== null && brokenLinesUsed >= warnThreshold
        ? `You are over ${warnThreshold} snapped lines. Consider switching strategies.`
        : null;
    const shouldSkip = skipThreshold !== null && brokenLinesUsed >= skipThreshold;
    let progressLabel = "Awaiting progress";
    let completed = false;
    let offPathWarning: string | null = null;
    const totalLegendary = Object.values(toolState.lakeStates ?? {}).reduce(
      (sum, entry) => sum + (entry.legendaryCaught ?? 0),
      0
    );
    const lakeLegendary = lakeStateForStep?.legendaryCaught ?? 0;
    const currentWeight = toolState.guidedCurrentWeight ?? null;
    const onlyIfLegendaryBelow = step.goal.onlyIfLegendaryBelow;
    const onlyIfLegendaryBelowScope = step.goal.onlyIfLegendaryBelowScope ?? "lake";
    const legendaryValue =
      onlyIfLegendaryBelowScope === "total" ? totalLegendary : lakeLegendary;
    if (onlyIfLegendaryBelow !== undefined && legendaryValue >= onlyIfLegendaryBelow) {
      return {
        stepIndex,
        step,
        steps,
        lakeStateForStep,
        progressLabel: "Skipped (legendary target already met)",
        completed: false,
        shouldSkip: true,
        skipThreshold,
        offPathWarning: offPathWarning ?? warnMessage,
      };
    }
    if (step.goal.type === "manual_confirm") {
      progressLabel = "Manual step";
      completed = false;
    } else if (step.goal.type === "weight_at_least") {
      progressLabel =
        currentWeight !== null ? `${currentWeight} / ${step.goal.count}+ kg` : `0 / ${step.goal.count}+ kg`;
      completed = currentWeight !== null && currentWeight >= step.goal.count;
    } else if (step.goal.type === "gold_target") {
      const currentGold = toolState.currentGoldTickets ?? 0;
      const targetGold = goldTarget ?? 0;
      progressLabel = `${currentGold}/${targetGold} gold tickets`;
      completed = targetGold > 0 && currentGold >= targetGold;
    } else if (lakeStateForStep) {
      if (step.goal.type === "pools_cleared") {
        const currentPools = lakeStateForStep.poolsCompleted ?? 0;
        progressLabel = `${currentPools}/${step.goal.count} pools cleared`;
        completed = currentPools >= step.goal.count;
      } else if (step.goal.type === "legendary_caught") {
        const currentLeg =
          (step.goal.scope ?? "lake") === "total"
            ? totalLegendary
            : lakeStateForStep.legendaryCaught ?? 0;
        progressLabel = `${currentLeg}/${step.goal.count} legendaries caught`;
        completed = currentLeg >= step.goal.count;
        if (step.goal.maxCount !== undefined && currentLeg > step.goal.maxCount) {
          offPathWarning = `You are over the recommended legendary count (${step.goal.maxCount}+).`;
        }
      }
    } else {
      progressLabel = "No lake data";
    }

    return {
      stepIndex,
      step,
      steps,
      lakeStateForStep,
      progressLabel,
      completed,
      shouldSkip,
      skipThreshold,
      offPathWarning: offPathWarning ?? warnMessage,
    };
  }, [guidedOption, guidedState, toolState, goldTarget]);

  useEffect(() => {
    if (!guidedStepData) return;
    const shouldAdvance = guidedStepData.completed || guidedStepData.shouldSkip;
    if (!shouldAdvance) return;
    const nextIndex = Math.min(guidedStepData.steps.length - 1, guidedStepData.stepIndex + 1);
    if (nextIndex === guidedStepData.stepIndex) return;
    updateToolState((prev) => {
      if (!prev) return prev;
      const nextStep = guidedStepData.steps[nextIndex];
      if (!nextStep) {
        return { ...prev, guidedStepIndex: nextIndex };
      }
      const nextLakeId = prev.lakeStates[nextStep.lakeId] ? nextStep.lakeId : prev.activeLakeId;
      return {
        ...prev,
        guidedStepIndex: nextIndex,
        activeLakeId: nextLakeId,
      };
    });
  }, [guidedStepData]);

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

  const silverEstimateLakeId = toolState.silverEstimateLakeId ?? data.lastLakeId;
  const avgTicketsPerFishSilver = silverEstimateLakeId ? getAvgTicketsPerFish(data, silverEstimateLakeId) : null;

  const silverCurrent = toolState.currentSilverTickets ?? null;
  const silverTarget = effectiveSilverTarget;
  const silverRemaining = silverCurrent !== null && silverTarget !== null ? Math.max(0, silverTarget - silverCurrent) : null;
  const silverFishNeeded =
    silverRemaining !== null && avgTicketsPerFishSilver ? Math.ceil(silverRemaining / avgTicketsPerFishSilver) : null;
  const luresRemainingFromTasks = taskTotals?.remaining ?? null;
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
    updateToolState((prev) => {
      if (!prev) return prev;
      if (prev.lakeStates[lakeId]) {
        return { ...prev, activeLakeId: lakeId };
      }
      const fallback = Object.keys(prev.lakeStates)[0] ?? prev.activeLakeId;
      return { ...prev, activeLakeId: fallback };
    });
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
      preset === "silver-heavy"
        ? { etchedRune: 3, blessedRune: 4, artifact: null, goldEtched: 1 }
        : { etchedRune: 2, blessedRune: 4, artifact: null, goldEtched: 1 };
    updateToolState((prev) => ({
      ...prev,
      goalPreset: preset,
      targetSilverTickets: null,
      purchaseCounts: {
        etchedRune: presetValues.etchedRune,
        blessedRune: presetValues.blessedRune,
        artifact: presetValues.artifact,
      },
      goldPurchaseCounts: {
        etchedRune: presetValues.goldEtched,
        advancedEnchantium: null,
        ruinShovelBundle: null,
        promisedShovelBundle: null,
        chromaticKeyBundle: null,
      },
    }));
  }

  function setSilverEstimateLake(lakeId: string) {
    updateToolState((prev) => ({
      ...prev,
      silverEstimateLakeId: lakeId,
    }));
  }

  function setTicketValue(key: "currentSilverTickets" | "targetSilverTickets" | "currentGoldTickets", value: number | null) {
    updateToolState((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  function setTargetTicketValue(key: "targetSilverTickets", value: number | null) {
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

  function setGoldPurchaseCount(key: keyof ToolState["goldPurchaseCounts"], value: number | null) {
    updateToolState((prev) => ({
      ...prev,
      goldPurchaseCounts: { ...prev.goldPurchaseCounts, [key]: value },
      goalPreset: "custom",
    }));
  }

  function setGuidedOption(optionId: string) {
    updateToolState((prev) => ({
      ...prev,
      guidedOptionId: optionId,
      guidedStepIndex: 0,
      guidedCollapsed: false,
    }));
  }

  function setGuidedStepIndex(nextIndex: number) {
    updateToolState((prev) => ({
      ...prev,
      guidedStepIndex: Math.max(0, nextIndex),
    }));
  }

  function resetGuidedRoute() {
    updateToolState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        guidedStepIndex: 0,
      };
    });
  }

  function toggleGuidedCollapsed() {
    updateToolState((prev) => ({
      ...prev,
      guidedCollapsed: !prev.guidedCollapsed,
    }));
  }

  function setGuidedWeight(value: number | null) {
    updateToolState((prev) => ({
      ...prev,
      guidedCurrentWeight: value,
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
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface-2)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontWeight: 700 }}>Guided Route</div>
            <button type="button" className="ghost" onClick={toggleGuidedCollapsed}>
              {toolState.guidedCollapsed ? "Expand" : "Collapse"}
            </button>
          </div>
          {toolState.guidedCollapsed ? null : (
            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              {guidedState.status === "idle" ? (
                <div style={{ color: "var(--text-muted)" }}>No guided route for this event.</div>
              ) : guidedState.status === "loading" ? (
                <div style={{ color: "var(--text-muted)" }}>Loading guided route…</div>
              ) : guidedState.status === "error" ? (
                <div style={{ color: "var(--danger)" }}>Guided route error: {guidedState.error}</div>
              ) : guidedOption ? (
                <>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <label style={{ fontSize: 12, color: "var(--text-muted)" }}>Option</label>
                    <select
                      value={guidedOption.optionId}
                      onChange={(e) => setGuidedOption(e.target.value)}
                    >
                      {guidedState.data.options.map((option) => (
                        <option key={option.optionId} value={option.optionId}>
                          {option.title}
                        </option>
                      ))}
                    </select>
                    <label style={{ fontSize: 12, color: "var(--text-muted)" }}>Current Weight</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="kg"
                      value={toolState.guidedCurrentWeight === null ? "" : toolState.guidedCurrentWeight}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^\d]/g, "");
                        setGuidedWeight(raw ? Number(raw) : null);
                      }}
                      style={{ maxWidth: 120 }}
                    />
                  </div>
                  {guidedOption.summary ? (
                    <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{guidedOption.summary}</div>
                  ) : null}
                  {guidedOption.disclaimer ? (
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{guidedOption.disclaimer}</div>
                  ) : null}
                  {guidedStepData ? (
                    <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10, background: "var(--surface)" }}>
                      <div style={{ fontWeight: 700 }}>{guidedStepData.step.action}</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                        Lake: {set.lakes.find((entry) => entry.lakeId === guidedStepData.step.lakeId)?.label ?? guidedStepData.step.lakeId}
                      </div>
                      <div style={{ fontSize: 12, marginTop: 6 }}>{guidedStepData.progressLabel}</div>
                      {guidedStepData.step.notes ? (
                        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
                          {guidedStepData.step.notes}
                        </div>
                      ) : null}
                      {guidedStepData.shouldSkip ? (
                        <div style={{ color: "var(--warning)", fontSize: 12, marginTop: 6 }}>
                          Broken lines are over {guidedStepData.skipThreshold}. This step should be skipped.
                        </div>
                      ) : null}
                      {guidedStepData.offPathWarning ? (
                        <div style={{ color: "var(--warning)", fontSize: 12, marginTop: 6 }}>
                          {guidedStepData.offPathWarning}
                        </div>
                      ) : null}
                      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => {
                            const prevIndex = Math.max(0, guidedStepData.stepIndex - 1);
                            setGuidedStepIndex(prevIndex);
                            const prevStep = guidedStepData.steps[prevIndex];
                            if (prevStep && prevStep.lakeId && prevStep.lakeId !== lake.lakeId) {
                              setActiveLake(prevStep.lakeId);
                            }
                          }}
                          disabled={guidedStepData.stepIndex === 0}
                        >
                          Previous Step
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => setActiveLake(guidedStepData.step.lakeId)}
                        >
                          Go to {set.lakes.find((entry) => entry.lakeId === guidedStepData.step.lakeId)?.label ?? guidedStepData.step.lakeId}
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            const nextIndex = Math.min(
                              guidedStepData.steps.length - 1,
                              guidedStepData.stepIndex + 1
                            );
                            setGuidedStepIndex(nextIndex);
                            const nextStep = guidedStepData.steps[nextIndex];
                            if (nextStep && nextStep.lakeId && nextStep.lakeId !== lake.lakeId) {
                              setActiveLake(nextStep.lakeId);
                            }
                          }}
                        >
                          {guidedStepData.shouldSkip
                            ? "Skip Step"
                            : guidedStepData.completed
                            ? "Next Step"
                            : "Mark Step Complete"}
                        </button>
                        <button type="button" className="ghost" onClick={resetGuidedRoute}>
                          Reset Route
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ color: "var(--text-muted)" }}>No guided steps available.</div>
                  )}
                </>
              ) : (
                <div style={{ color: "var(--text-muted)" }}>No guided steps available.</div>
              )}
            </div>
          )}
        </div>
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
              <div style={{ fontWeight: 700 }}>Inputs</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Etched runes can be purchased with 16 gold or 32,400 silver each. Add them under the purchase type you plan to use.
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
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 12 }}>Golden Ticket Purchases</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={toolState.goldPurchaseCounts.etchedRune !== null}
                        onChange={(e) =>
                          setGoldPurchaseCount("etchedRune", e.target.checked ? 1 : null)
                        }
                      />
                      Etched Rune (16 gold)
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="Qty"
                      value={
                        toolState.goldPurchaseCounts.etchedRune === null
                          ? ""
                          : toolState.goldPurchaseCounts.etchedRune
                      }
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^\d]/g, "");
                        setGoldPurchaseCount("etchedRune", raw ? Number(raw) : null);
                      }}
                      style={{ maxWidth: 120 }}
                      disabled={toolState.goldPurchaseCounts.etchedRune === null}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={toolState.goldPurchaseCounts.advancedEnchantium !== null}
                        onChange={(e) =>
                          setGoldPurchaseCount("advancedEnchantium", e.target.checked ? 1 : null)
                        }
                      />
                      Advanced Enchantium (18 gold)
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="Qty"
                      value={
                        toolState.goldPurchaseCounts.advancedEnchantium === null
                          ? ""
                          : toolState.goldPurchaseCounts.advancedEnchantium
                      }
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^\d]/g, "");
                        setGoldPurchaseCount("advancedEnchantium", raw ? Number(raw) : null);
                      }}
                      style={{ maxWidth: 120 }}
                      disabled={toolState.goldPurchaseCounts.advancedEnchantium === null}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={toolState.goldPurchaseCounts.ruinShovelBundle !== null}
                        onChange={(e) =>
                          setGoldPurchaseCount("ruinShovelBundle", e.target.checked ? 1 : null)
                        }
                      />
                      Ruin Shovels (3 for 1 gold)
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="Bundles"
                      value={
                        toolState.goldPurchaseCounts.ruinShovelBundle === null
                          ? ""
                          : toolState.goldPurchaseCounts.ruinShovelBundle
                      }
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^\d]/g, "");
                        setGoldPurchaseCount("ruinShovelBundle", raw ? Number(raw) : null);
                      }}
                      style={{ maxWidth: 120 }}
                      disabled={toolState.goldPurchaseCounts.ruinShovelBundle === null}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={toolState.goldPurchaseCounts.promisedShovelBundle !== null}
                        onChange={(e) =>
                          setGoldPurchaseCount("promisedShovelBundle", e.target.checked ? 1 : null)
                        }
                      />
                      Promised Shovels (2 for 1 gold)
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="Bundles"
                      value={
                        toolState.goldPurchaseCounts.promisedShovelBundle === null
                          ? ""
                          : toolState.goldPurchaseCounts.promisedShovelBundle
                      }
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^\d]/g, "");
                        setGoldPurchaseCount("promisedShovelBundle", raw ? Number(raw) : null);
                      }}
                      style={{ maxWidth: 120 }}
                      disabled={toolState.goldPurchaseCounts.promisedShovelBundle === null}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={toolState.goldPurchaseCounts.chromaticKeyBundle !== null}
                        onChange={(e) =>
                          setGoldPurchaseCount("chromaticKeyBundle", e.target.checked ? 1 : null)
                        }
                      />
                      Chromatic Keys (5 for 4 gold)
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="Bundles"
                      value={
                        toolState.goldPurchaseCounts.chromaticKeyBundle === null
                          ? ""
                          : toolState.goldPurchaseCounts.chromaticKeyBundle
                      }
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^\d]/g, "");
                        setGoldPurchaseCount("chromaticKeyBundle", raw ? Number(raw) : null);
                      }}
                      style={{ maxWidth: 120 }}
                      disabled={toolState.goldPurchaseCounts.chromaticKeyBundle === null}
                    />
                  </label>
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, fontSize: 12 }}>
                <span>Computed silver target: <b>{suggestedSilverTarget ? formatNumber(suggestedSilverTarget) : "—"}</b></span>
                {suggestedSilverTarget ? (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setTargetTicketValue("targetSilverTickets", suggestedSilverTarget)}
                  >
                    Override Target
                  </button>
                ) : null}
              </div>
              <div style={{ fontSize: 12 }}>
                Computed gold target: <b>{goldTarget ? formatNumber(goldTarget) : "—"}</b>
              </div>
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
            </div>


            <div style={{ display: "grid", gap: 10, marginTop: 12, padding: 10, borderRadius: 10, background: "var(--surface-2)", border: "1px solid var(--border)" }}>
              <div style={{ fontWeight: 700 }}>Recommendations</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                {goldRemaining === null
                  ? "Select gold purchases and enter your current golden tickets."
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
                  {silverRemaining !== null ? (
                    <>
                      <div>
                        Estimated fish needed for purchase gap:{" "}
                        <b>{silverFishNeeded !== null ? formatNumber(silverFishNeeded) : "—"}</b>
                      </div>
                      <div>
                        Lure shortfall (purchase gap):{" "}
                        <b>{silverLureShortfall !== null ? formatNumber(silverLureShortfall) : "—"}</b>
                      </div>
                      <div>
                        Estimated gem cost (purchase gap):{" "}
                        <b>{silverGemCost !== null ? formatNumber(silverGemCost) : "—"}</b>
                      </div>
                    </>
                  ) : null}
                  {currentGems !== null && goldGemCost !== null && currentGems < goldGemCost ? (
                    <div style={{ color: "var(--danger)" }}>
                      Not enough gems for the golden goal with current lures.
                    </div>
                  ) : null}
                  {currentGems !== null && silverGemCost !== null && currentGems < silverGemCost ? (
                    <div style={{ color: "var(--danger)" }}>
                      Not enough gems for the purchase gap with current lures.
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
