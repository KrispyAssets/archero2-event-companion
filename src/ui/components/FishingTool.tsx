import { useEffect, useMemo, useRef, useState } from "react";
import type { RewardAsset, TaskDefinition, TaskGroupLabelMap, ToolFishingCalculator, ToolPurchaseGoals } from "../../catalog/types";
import { buildTaskGroups, computeEarned, computeRemaining } from "../../catalog/taskGrouping";
import "./fishingTool.css";
import { getEventProgressState } from "../../state/userStateStore";
import DropdownButton from "./DropdownButton";

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

type GuidedGoal = {
  type: "manual_confirm" | "pools_cleared" | "legendary_caught" | "gold_target" | "weight_at_least" | "remaining_fish_at_most";
  count: number;
  scope?: "lake" | "total";
  maxCount?: number;
  skipIfBrokenLinesOver?: number;
  onlyIfLegendaryBelow?: number;
  onlyIfLegendaryBelowScope?: "lake" | "total";
  warnIfBrokenLinesOver?: number;
  warnMessage?: string;
};

type GuidedRouteMedia = {
  label?: string;
  images: Array<{ src: string; alt?: string; caption?: string }>;
};

type GuidedRouteStep = {
  stepId: string;
  lakeId: string;
  action: string;
  notes?: string;
  media?: GuidedRouteMedia;
  goal?: GuidedGoal;
  goalAll?: GuidedGoal[];
  goalAny?: GuidedGoal[];
  skipIfBrokenLinesOver?: number;
  warnIfBrokenLinesOver?: number;
  warnMessage?: string;
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
  action?: "catch" | "pool_clear" | "reset_lake" | "reset_lake_progress" | "reset_all";
  prevAllStates?: Record<string, LakeState>;
  prevBrokenLines?: number;
  prevGuidedWeight?: number | null;
  prevHistory?: HistoryEntry[];
  prevResetEpoch?: number | null;
};

type ToolState = {
  activeSetId: string;
  activeLakeId: string;
  lakeStates: Record<string, LakeState>;
  brokenLines: number;
  history: HistoryEntry[];
  resetHistoryEpoch: number | null;
  goalMode: "silver" | "gold" | "both";
  goalPreset: "silver-heavy" | "gold-efficient" | "custom";
  currentSilverTickets: number | null;
  targetSilverTickets: number | null;
  currentGoldTickets: number | null;
  currentLures: number | null;
  purchasedLures: number | null;
  currentGems: number | null;
  purchaseCounts: {
    etchedRune: number | null;
    blessingRune: number | null;
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
  guidedAutoAdvance: boolean;
};

type DataState = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; data: FishingToolData };

type GuidedState = { status: "idle" } | { status: "loading" } | { status: "error"; error: string } | { status: "ready"; data: GuidedRouteData };

const STORAGE_PREFIX = "archero2_tool_state_";
const dataCache = new Map<string, FishingToolData>();
const guidedCache = new Map<string, GuidedRouteData>();
const toolStateCache = new Map<string, ToolState>();
const TOOL_STATE_EVENT = "archero2_tool_state";

function getToolStateKey(tool: ToolFishingCalculator | ToolPurchaseGoals) {
  return tool.stateKey ?? tool.toolId;
}

function resolvePath(path: string) {
  if (!path) return "";
  return `${import.meta.env.BASE_URL}${path}`;
}

function buildFullCounts(data: FishingToolData, lakeId: string): Record<string, number> {
  const multiplier = lakeId === data.lastLakeId ? data.lastLakeMultiplier : 1;
  return data.fishTypes.reduce(
    (acc, fishType) => {
      acc[fishType.typeId] = fishType.baseCount * multiplier;
      return acc;
    },
    {} as Record<string, number>,
  );
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

function getAvgTicketsPerFish(data: FishingToolData, lakeId: string): number | null {
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
  taskGroupLabels,
  rewardAssets: _rewardAssets,
  guidedRoutePath,
  variant = "companion",
  showTitle = true,
}: {
  tool: ToolFishingCalculator | ToolPurchaseGoals;
  eventId?: string;
  eventVersion?: number;
  tasks?: TaskDefinition[];
  taskGroupLabels?: TaskGroupLabelMap;
  rewardAssets?: Record<string, RewardAsset>;
  guidedRoutePath?: string;
  variant?: "companion" | "purchase";
  showTitle?: boolean;
}) {
  const showCompanion = variant !== "purchase";
  const showPurchase = variant !== "companion";
  const stateKey = getToolStateKey(tool);
  const [dataState, setDataState] = useState<DataState>(() => {
    const cached = dataCache.get(tool.dataPath);
    return cached ? { status: "ready", data: cached } : { status: "loading" };
  });
  const [guidedState, setGuidedState] = useState<GuidedState>(() => {
    const routePath = guidedRoutePath;
    if (!routePath) return { status: "idle" };
    const cached = guidedCache.get(routePath);
    return cached ? { status: "ready", data: cached } : { status: "loading" };
  });
  const [toolState, setToolState] = useState<ToolState | null>(() => {
    return toolStateCache.get(stateKey) ?? null;
  });
  const [breakStep, setBreakStep] = useState(1);
  const [taskTick, setTaskTick] = useState(0);
  const [resetMenuOpen, setResetMenuOpen] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [showBreakOdds, setShowBreakOdds] = useState(false);
  const [openLakeInfoId, setOpenLakeInfoId] = useState<"pool" | "totals" | null>(null);
  const [guidedWeightInput, setGuidedWeightInput] = useState("");
  const guidedWeightEditingRef = useRef(false);
  const [guidedInfoOpen, setGuidedInfoOpen] = useState(false);
  const [guidedMediaOpen, setGuidedMediaOpen] = useState(false);
  const [guidedMediaLightbox, setGuidedMediaLightbox] = useState<{
    images: Array<{ src: string; alt?: string; caption?: string }>;
    index: number;
  } | null>(null);
  const resetMenuRef = useRef<HTMLDivElement | null>(null);

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
    const routePath = guidedRoutePath;
    async function loadGuidedRoute(route: string) {
      try {
        const cached = guidedCache.get(route);
        if (cached) {
          setGuidedState({ status: "ready", data: cached });
          return;
        }
        const response = await fetch(resolvePath(route), { cache: "no-cache" });
        if (!response.ok) {
          throw new Error(`Failed to load guided route: ${response.status} ${response.statusText}`);
        }
        const json = (await response.json()) as GuidedRouteData;
        if (!cancelled) {
          guidedCache.set(route, json);
          setGuidedState({ status: "ready", data: json });
        }
      } catch (error) {
        if (!cancelled) {
          setGuidedState({ status: "error", error: error instanceof Error ? error.message : "Unknown error" });
        }
      }
    }
    loadGuidedRoute(routePath);
    return () => {
      cancelled = true;
    };
  }, [guidedRoutePath]);

  useEffect(() => {
    if (dataState.status !== "ready") return;
    const data = dataState.data;
    const storageKey = `${STORAGE_PREFIX}${stateKey}`;
    let raw = localStorage.getItem(storageKey);
    if (!raw && stateKey !== tool.toolId) {
      raw = localStorage.getItem(`${STORAGE_PREFIX}${tool.toolId}`);
    }
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

    const baseSet = data.sets[0];
    const normalizedPurchaseCounts = stored?.purchaseCounts
      ? {
          etchedRune: stored.purchaseCounts.etchedRune ?? null,
          blessingRune:
            (stored.purchaseCounts as { blessingRune?: number | null }).blessingRune ??
            (stored.purchaseCounts as { blessedRune?: number | null }).blessedRune ??
            null,
          artifact: stored.purchaseCounts.artifact ?? null,
        }
      : { etchedRune: null, blessingRune: null, artifact: null };
    const nextState: ToolState = {
      activeSetId,
      activeLakeId: "",
      lakeStates: {},
      brokenLines: 0,
      history: [],
      resetHistoryEpoch: stored?.resetHistoryEpoch ?? null,
      goalMode: stored?.goalMode ?? "silver",
      goalPreset: stored?.goalPreset ?? "custom",
      currentSilverTickets: stored?.currentSilverTickets ?? null,
      targetSilverTickets: stored?.targetSilverTickets ?? null,
      currentGoldTickets: stored?.currentGoldTickets ?? null,
      currentLures: stored?.currentLures ?? null,
      purchasedLures: stored?.purchasedLures ?? null,
      currentGems: stored?.currentGems ?? null,
      purchaseCounts: normalizedPurchaseCounts,
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
      guidedAutoAdvance: stored?.guidedAutoAdvance ?? true,
    };
    const storedLakeStates = stored?.lakeStates ?? {};
    const nextLakeStates: Record<string, LakeState> = {};
    for (const lake of baseSet.lakes) {
      const storedLake = storedLakeStates[lake.lakeId];
      const fullCounts = buildFullCounts(data, lake.lakeId);
      const remainingByTypeId = storedLake?.remainingByTypeId ? { ...fullCounts, ...storedLake.remainingByTypeId } : fullCounts;
      nextLakeStates[lake.lakeId] = {
        remainingByTypeId,
        poolsCompleted: storedLake?.poolsCompleted ?? 0,
        legendaryCaught: storedLake?.legendaryCaught ?? 0,
        fishCaught: storedLake?.fishCaught ?? 0,
      };
    }

    const storedActiveLake = stored?.activeLakeId;
    nextState.activeLakeId =
      storedActiveLake && baseSet.lakes.some((lake) => lake.lakeId === storedActiveLake) ? storedActiveLake : (baseSet.lakes[0]?.lakeId ?? "");
    nextState.lakeStates = nextLakeStates;
    nextState.brokenLines = stored?.brokenLines ?? 0;
    nextState.history = stored?.history ?? [];
    nextState.resetHistoryEpoch = stored?.resetHistoryEpoch ?? null;
    nextState.goalMode = stored?.goalMode ?? "silver";
    nextState.goalPreset = stored?.goalPreset ?? "custom";
    nextState.currentSilverTickets = stored?.currentSilverTickets ?? null;
    nextState.targetSilverTickets = stored?.targetSilverTickets ?? null;
    nextState.currentGoldTickets = stored?.currentGoldTickets ?? null;
    nextState.currentLures = stored?.currentLures ?? null;
    nextState.purchasedLures = stored?.purchasedLures ?? null;
    nextState.currentGems = stored?.currentGems ?? null;
    nextState.purchaseCounts = normalizedPurchaseCounts;
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
    nextState.guidedAutoAdvance = stored?.guidedAutoAdvance ?? true;

    setToolState(nextState);
    toolStateCache.set(stateKey, nextState);
  }, [dataState, stateKey, tool.defaultSetId, tool.toolId]);

  function buildStoredToolState(state: ToolState) {
    const compactHistory = (state.history ?? []).slice(-50).map((entry) => {
      const { prevAllStates, prevHistory, ...rest } = entry;
      return rest;
    });
    return { ...state, history: compactHistory };
  }

  useEffect(() => {
    if (!toolState) return;
    const storageKey = `${STORAGE_PREFIX}${stateKey}`;
    try {
      localStorage.setItem(storageKey, JSON.stringify(buildStoredToolState(toolState)));
    } catch (error) {
      console.warn("Failed to persist tool state, trimming history.", error);
      try {
        localStorage.setItem(storageKey, JSON.stringify({ ...toolState, history: [] }));
      } catch (fallbackError) {
        console.warn("Failed to persist trimmed tool state.", fallbackError);
      }
    }
    toolStateCache.set(stateKey, toolState);
    window.dispatchEvent(new CustomEvent(TOOL_STATE_EVENT, { detail: { stateKey } }));
  }, [stateKey, toolState]);

  useEffect(() => {
    if (!confirmResetOpen) return;
    const { body } = document;
    const prevOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = prevOverflow;
    };
  }, [confirmResetOpen]);

  useEffect(() => {
    if (!guidedMediaLightbox) return;
    const { body } = document;
    const prevOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = prevOverflow;
    };
  }, [guidedMediaLightbox]);

  useEffect(() => {
    function handleToolStateEvent(event: Event) {
      const detail = (event as CustomEvent<{ stateKey?: string }>).detail;
      if (!detail?.stateKey || detail.stateKey !== stateKey) return;
      const cached = toolStateCache.get(stateKey);
      if (cached) {
        setToolState(cached);
      }
    }
    window.addEventListener(TOOL_STATE_EVENT, handleToolStateEvent);
    return () => window.removeEventListener(TOOL_STATE_EVENT, handleToolStateEvent);
  }, [stateKey]);

  useEffect(() => {
    function handlePurchaseGoalsApply(event: Event) {
      const detail = (event as CustomEvent<{
        stateKey?: string;
        purchaseCounts?: ToolState["purchaseCounts"];
        goldPurchaseCounts?: ToolState["goldPurchaseCounts"];
      }>).detail;
      if (!detail?.stateKey || detail.stateKey !== stateKey) return;
      setToolState((prev) =>
        prev
          ? {
              ...prev,
              purchaseCounts: detail.purchaseCounts ?? prev.purchaseCounts,
              goldPurchaseCounts: detail.goldPurchaseCounts ?? prev.goldPurchaseCounts,
            }
          : prev
      );
    }
    window.addEventListener("purchase-goals-apply", handlePurchaseGoalsApply);
    return () => window.removeEventListener("purchase-goals-apply", handlePurchaseGoalsApply);
  }, [stateKey]);

  useEffect(() => {
    if (!toolState) return;
    if (guidedWeightEditingRef.current) return;
    setGuidedWeightInput(toolState.guidedCurrentWeight === null ? "" : String(toolState.guidedCurrentWeight));
  }, [toolState?.guidedCurrentWeight]);

  useEffect(() => {
    function handleStateChange() {
      setTaskTick((prev) => prev + 1);
    }
    window.addEventListener("archero2_user_state", handleStateChange);
    return () => window.removeEventListener("archero2_user_state", handleStateChange);
  }, []);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!resetMenuRef.current || !target) return;
      if (!resetMenuRef.current.contains(target)) {
        setResetMenuOpen(false);
      }
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  useEffect(() => {
    if (!openLakeInfoId) return;
    function handleClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(".lakeInfoButton") || target.closest(".lakeInfoPopover")) {
        return;
      }
      setOpenLakeInfoId(null);
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [openLakeInfoId]);

  useEffect(() => {
    if (!guidedInfoOpen) return;
    function handleClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(".guidedInfoButton") || target.closest(".guidedInfoPopover")) {
        return;
      }
      setGuidedInfoOpen(false);
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [guidedInfoOpen]);

  useEffect(() => {
    if (!guidedMediaOpen) return;
    function handleClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(".guidedMediaButton") || target.closest(".guidedMediaPopover")) {
        return;
      }
      setGuidedMediaOpen(false);
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [guidedMediaOpen]);

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
    const groups = buildTaskGroups(tasks, taskGroupLabels);
    return groups.reduce(
      (acc, group) => {
        const state = progress.tasks[group.groupId] ?? { progressValue: 0, flags: { isCompleted: false, isClaimed: false } };
        acc.earned += computeEarned(group.tiers, state.progressValue);
        acc.remaining += computeRemaining(group.tiers, state.progressValue);
        return acc;
      },
      { earned: 0, remaining: 0 },
    );
  }, [eventId, eventVersion, tasks, taskGroupLabels, taskTick]);

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
    if (counts.blessingRune) total += counts.blessingRune * 4050;
    if (counts.artifact) total += counts.artifact * 184000;
    return total || null;
  }, [toolState?.purchaseCounts]);

  const effectiveSilverTarget = toolState?.targetSilverTickets ?? suggestedSilverTarget ?? null;
  const silverGoalBaselineRaw = effectiveSilverTarget ?? baselineDefault;
  const silverGoalBaseline = clampNumber(silverGoalBaselineRaw, baselineMin, baselineMax);

  const guidedOption = useMemo(() => {
    if (guidedState.status !== "ready" || !toolState) return null;
    const options = guidedState.data.options ?? [];
    const preferred = toolState.guidedOptionId ? options.find((option) => option.optionId === toolState.guidedOptionId) : null;
    return preferred ?? options[0] ?? null;
  }, [guidedState, toolState?.guidedOptionId]);

  const lakeRecommendations = useMemo(() => {
    if (dataState.status !== "ready" || !toolState) return null;
    const data = dataState.data;
    const set = data.sets.find((entry) => entry.setId === toolState.activeSetId);
    if (!set) return null;
    const legendaryTypeId = getLegendaryTypeId(data);
    const goldCurrent = toolState.currentGoldTickets ?? null;
    const goldRemaining = goldCurrent !== null && goldTarget !== null ? Math.max(0, goldTarget - goldCurrent) : null;
    const lakeStates = toolState.lakeStates;
    const silverCurrent = toolState.currentSilverTickets ?? null;
    const silverTarget = effectiveSilverTarget;
    const silverRemaining = silverCurrent !== null && silverTarget !== null ? Math.max(0, silverTarget - silverCurrent) : null;
    if ((!goldRemaining || goldRemaining === 0) && (!silverRemaining || silverRemaining === 0)) return null;

    const lakes = set.lakes;

    function bestSilverLake() {
      let best: { lakeId: string; avgTicketsPerFish: number; lakeIndex: number } | null = null;
      for (const [index, entry] of lakes.entries()) {
        const avg = getAvgTicketsPerFish(data, entry.lakeId);
        if (!avg) continue;
        if (!best || avg > best.avgTicketsPerFish + 0.01 || (Math.abs(avg - best.avgTicketsPerFish) < 0.01 && index > best.lakeIndex)) {
          best = { lakeId: entry.lakeId, avgTicketsPerFish: avg, lakeIndex: index };
        }
      }
      return best;
    }

    function bestGoldLake(remainingGold: number) {
      let best: { lakeId: string; expectedGoldLures: number; avgTicketsPerFish: number | null; lakeIndex: number } | null = null;
      for (const [index, entry] of lakes.entries()) {
        const estimate = getLegendaryRangeForLake(entry.lakeId, remainingGold, data, lakeStates, legendaryTypeId);
        if (!estimate) continue;
        const expectedGoldLures = estimate.expected;
        const avgTicketsPerFish = getAvgTicketsPerFish(data, entry.lakeId);
        if (
          !best ||
          expectedGoldLures < best.expectedGoldLures - 0.01 ||
          (Math.abs(expectedGoldLures - best.expectedGoldLures) < 0.01 && (avgTicketsPerFish ?? 0) > (best.avgTicketsPerFish ?? 0) + 0.01) ||
          (Math.abs(expectedGoldLures - best.expectedGoldLures) < 0.01 && (avgTicketsPerFish ?? 0) === (best.avgTicketsPerFish ?? 0) && index > best.lakeIndex)
        ) {
          best = { lakeId: entry.lakeId, expectedGoldLures, avgTicketsPerFish, lakeIndex: index };
        }
      }
      return best;
    }

    const silverLake = bestSilverLake();
    let goldLake = goldRemaining ? bestGoldLake(goldRemaining) : null;
    const silverPriorityLureSlack = 15;
    const silverOverrideGoldSave = 50;
    if (goldRemaining && silverRemaining && goldLake && silverLake) {
      const silverGoldEstimate = getLegendaryRangeForLake(silverLake.lakeId, goldRemaining, data, lakeStates, legendaryTypeId);
      if (
        silverGoldEstimate &&
        silverGoldEstimate.expected <= goldLake.expectedGoldLures + silverPriorityLureSlack
      ) {
        goldLake = {
          lakeId: silverLake.lakeId,
          expectedGoldLures: silverGoldEstimate.expected,
          avgTicketsPerFish: silverLake.avgTicketsPerFish,
          lakeIndex: silverLake.lakeIndex,
        };
      }
    }
    if (goldRemaining && goldLake && silverLake) {
      const silverGoldEstimate = getLegendaryRangeForLake(silverLake.lakeId, goldRemaining, data, lakeStates, legendaryTypeId);
      if (silverGoldEstimate && goldRemaining >= 3) {
        if (goldLake.expectedGoldLures + silverOverrideGoldSave >= silverGoldEstimate.expected) {
          goldLake = {
            lakeId: silverLake.lakeId,
            expectedGoldLures: silverGoldEstimate.expected,
            avgTicketsPerFish: silverLake.avgTicketsPerFish,
            lakeIndex: silverLake.lakeIndex,
          };
        }
      }
    }
    if (goldRemaining && !goldLake) return null;

    type Recommendation = {
      lakeId: string;
      avgTicketsPerFish: number | null;
      combinedLures: number;
      expectedGoldLures: number;
      luresForSilver: number;
      steps: { lakeId: string; lures: number }[];
      expectedSilverGain: number;
    };

    const goldLures = goldLake?.expectedGoldLures ?? 0;
    const silverLures = silverRemaining && silverLake ? Math.ceil(silverRemaining / silverLake.avgTicketsPerFish) : 0;
    const driverIsSilver = silverLures > goldLures;

    let recommendation: Recommendation;
    if (!goldRemaining || goldRemaining === 0) {
      recommendation = {
        lakeId: silverLake?.lakeId ?? lakes[0].lakeId,
        avgTicketsPerFish: silverLake?.avgTicketsPerFish ?? null,
        combinedLures: silverLures,
        expectedGoldLures: 0,
        luresForSilver: silverLures,
        steps: silverLake ? [{ lakeId: silverLake.lakeId, lures: silverLures }] : [],
        expectedSilverGain: silverLake ? silverLures * silverLake.avgTicketsPerFish : 0,
      };
    } else if (driverIsSilver && silverLake && goldLake) {
      recommendation = {
        lakeId: silverLake.lakeId,
        avgTicketsPerFish: silverLake.avgTicketsPerFish,
        combinedLures: silverLures + goldLures,
        expectedGoldLures: goldLures,
        luresForSilver: silverLures,
        steps: [
          { lakeId: silverLake.lakeId, lures: silverLures },
          { lakeId: goldLake.lakeId, lures: goldLures },
        ],
        expectedSilverGain: silverLures * silverLake.avgTicketsPerFish + goldLures * (goldLake.avgTicketsPerFish ?? 0),
      };
    } else if (goldLake) {
      const silverAfterGold =
        silverRemaining !== null && (goldLake.avgTicketsPerFish ?? 0) > 0
          ? Math.max(0, silverRemaining - goldLures * (goldLake.avgTicketsPerFish ?? 0))
          : silverRemaining ?? 0;
      const silverLuresAfterGold =
        silverLake && silverAfterGold > 0 ? Math.ceil(silverAfterGold / silverLake.avgTicketsPerFish) : 0;
      recommendation = {
        lakeId: goldLake.lakeId,
        avgTicketsPerFish: goldLake.avgTicketsPerFish,
        combinedLures: goldLures + silverLuresAfterGold,
        expectedGoldLures: goldLures,
        luresForSilver: silverLuresAfterGold,
        steps: [
          { lakeId: goldLake.lakeId, lures: goldLures },
          ...(silverLuresAfterGold > 0 && silverLake ? [{ lakeId: silverLake.lakeId, lures: silverLuresAfterGold }] : []),
        ],
        expectedSilverGain: goldLures * (goldLake.avgTicketsPerFish ?? 0) + silverLuresAfterGold * (silverLake?.avgTicketsPerFish ?? 0),
      };
    } else {
      recommendation = {
        lakeId: silverLake?.lakeId ?? lakes[0].lakeId,
        avgTicketsPerFish: silverLake?.avgTicketsPerFish ?? null,
        combinedLures: silverLures,
        expectedGoldLures: 0,
        luresForSilver: silverLures,
        steps: silverLake ? [{ lakeId: silverLake.lakeId, lures: silverLures }] : [],
        expectedSilverGain: silverLake ? silverLures * silverLake.avgTicketsPerFish : 0,
      };
    }

    const quickThreshold = 10;
    if (goldRemaining && goldRemaining > 0) {
      for (const entry of set.lakes) {
        const state = toolState.lakeStates[entry.lakeId];
        if (!state) continue;
        const remainingFish = sumCounts(state.remainingByTypeId);
        const remainingLegendary = state.remainingByTypeId[legendaryTypeId] ?? 0;
        if (remainingLegendary <= 0 || remainingFish > quickThreshold) continue;
        const quickRange = getLegendaryRangeForLake(entry.lakeId, 1, data, lakeStates, legendaryTypeId);
        if (!quickRange) continue;
        const quickLures = quickRange.expected;
        const quickAvgTickets = getAvgTicketsPerFish(data, entry.lakeId) ?? 0;
        const silverAfterQuick = silverRemaining !== null ? Math.max(0, silverRemaining - quickLures * quickAvgTickets) : null;
        const remainingGold = Math.max(0, goldRemaining - 1);
        const followGoldLake = remainingGold > 0 ? bestGoldLake(remainingGold) : null;
        const followSilverLake = bestSilverLake();
        if (!followGoldLake && !followSilverLake) continue;
        const followGoldLures = followGoldLake?.expectedGoldLures ?? 0;
        const followSilverLures =
          silverAfterQuick !== null && followSilverLake ? Math.ceil(silverAfterQuick / followSilverLake.avgTicketsPerFish) : 0;
        const followTotal = followGoldLures + followSilverLures;
        const totalLures = quickLures + followTotal;
        const totalSilverGain =
          quickLures * quickAvgTickets +
          followGoldLures * (followGoldLake?.avgTicketsPerFish ?? 0) +
          followSilverLures * (followSilverLake?.avgTicketsPerFish ?? 0);
        const improve = totalLures + 1 < recommendation.combinedLures;
        const nearTie = Math.abs(totalLures - recommendation.combinedLures) <= 3;
        if (improve || nearTie) {
          recommendation = {
            lakeId: (followSilverLake ?? followGoldLake)?.lakeId ?? entry.lakeId,
            avgTicketsPerFish: followSilverLake?.avgTicketsPerFish ?? followGoldLake?.avgTicketsPerFish ?? null,
            combinedLures: totalLures,
            expectedGoldLures: followGoldLures,
            luresForSilver: followSilverLures,
            steps: [
              { lakeId: entry.lakeId, lures: quickLures },
              ...(followGoldLures > 0 && followGoldLake ? [{ lakeId: followGoldLake.lakeId, lures: followGoldLures }] : []),
              ...(followSilverLures > 0 && followSilverLake ? [{ lakeId: followSilverLake.lakeId, lures: followSilverLures }] : []),
            ],
            expectedSilverGain: totalSilverGain,
          };
        }
      }
    }

    return recommendation;
  }, [dataState, toolState, goldTarget, effectiveSilverTarget]);

  const goldRange = useMemo(() => {
    if (dataState.status !== "ready" || !toolState) return null;
    const data = dataState.data;
    const legendaryTypeId = getLegendaryTypeId(data);
    const goldCurrent = toolState.currentGoldTickets ?? null;
    const goldRemaining = goldCurrent !== null && goldTarget !== null ? Math.max(0, goldTarget - goldCurrent) : null;
    if (!goldRemaining || !lakeRecommendations) return null;
    return getLegendaryRangeForLake(lakeRecommendations.lakeId, goldRemaining, data, toolState.lakeStates, legendaryTypeId);
  }, [dataState, toolState, lakeRecommendations, goldTarget]);

  const combinedLuresNeeded = useMemo(() => {
    if (!lakeRecommendations) return null;
    return lakeRecommendations.combinedLures ?? null;
  }, [lakeRecommendations]);

  const guidedStepData = useMemo(() => {
    if (!toolState || !guidedOption || guidedState.status !== "ready") return null;
    const steps = guidedOption.steps ?? [];
    const stepIndex = Math.min(toolState.guidedStepIndex, Math.max(steps.length - 1, 0));
    const step = steps[stepIndex];
    if (!step) return null;
    const lakeStateForStep = toolState.lakeStates[step.lakeId];
    const brokenLinesUsed = toolState.brokenLines ?? 0;
    const skipThreshold = step.skipIfBrokenLinesOver ?? step.goal?.skipIfBrokenLinesOver ?? null;
    const warnThreshold = step.warnIfBrokenLinesOver ?? step.goal?.warnIfBrokenLinesOver ?? skipThreshold ?? null;
    const warnMessageText = step.warnMessage ?? step.goal?.warnMessage;
    const warnMessage =
      warnThreshold !== null && brokenLinesUsed >= warnThreshold
        ? (warnMessageText ?? `You are over ${warnThreshold} snapped lines. Consider switching strategies.`)
        : null;
    const wrongLakeId = step.lakeId && toolState.activeLakeId !== step.lakeId ? toolState.activeLakeId : null;
    const wrongLakeTargetId = wrongLakeId ? step.lakeId : null;
    const shouldSkip = false;
    let progressLabel = "Awaiting progress";
    let completed = false;
    let offPathWarning: string | null = null;
    const totalLegendary = Object.values(toolState.lakeStates ?? {}).reduce((sum, entry) => sum + (entry.legendaryCaught ?? 0), 0);
    const lakeLegendary = lakeStateForStep?.legendaryCaught ?? 0;
    const currentWeight = toolState.guidedCurrentWeight ?? null;
    const onlyIfLegendaryBelow = step.goal?.onlyIfLegendaryBelow;
    const onlyIfLegendaryBelowScope = step.goal?.onlyIfLegendaryBelowScope ?? "lake";
    const legendaryValue = onlyIfLegendaryBelowScope === "total" ? totalLegendary : lakeLegendary;
    if (onlyIfLegendaryBelow !== undefined && legendaryValue >= onlyIfLegendaryBelow) {
      return {
        stepIndex,
        step,
        steps,
        lakeStateForStep,
        progressLabel: "Legendary target already met",
        progressLines: ["Legendary target already met"],
        progressEntries: [{ label: "Legendary target already met", completed: true }],
        completed: true,
        shouldSkip: false,
        skipThreshold,
        offPathWarning: offPathWarning ?? warnMessage,
        wrongLakeId,
        wrongLakeTargetId,
      };
    }
    const goals = step.goalAll ?? step.goalAny ?? (step.goal ? [step.goal] : []);
    const useAll = Boolean(step.goalAll);
    const useAny = Boolean(step.goalAny);

    function evaluateGoal(goal: GuidedGoal) {
      if (goal.type === "manual_confirm") {
        return { label: "Manual step", completed: false };
      }
      if (goal.type === "weight_at_least") {
        const label = currentWeight !== null ? `${currentWeight} / ${goal.count}+ kg` : `0 / ${goal.count}+ kg`;
        return { label, completed: currentWeight !== null && currentWeight >= goal.count };
      }
      if (goal.type === "gold_target") {
        const currentGold = toolState?.currentGoldTickets ?? 0;
        const targetGold = goldTarget ?? 0;
        return { label: `${currentGold}/${targetGold} gold tickets`, completed: targetGold > 0 && currentGold >= targetGold };
      }
      if (goal.type === "remaining_fish_at_most" && lakeStateForStep) {
        const remainingFish = sumCounts(lakeStateForStep.remainingByTypeId);
        const remainingToFish = Math.max(0, remainingFish - goal.count);
        return { label: remainingToFish > 0 ? `Fish ${remainingToFish} more` : "Step complete", completed: remainingFish <= goal.count };
      }
      if (lakeStateForStep) {
        if (goal.type === "pools_cleared") {
          const currentPools = lakeStateForStep.poolsCompleted ?? 0;
          return { label: `${currentPools}/${goal.count} pools cleared`, completed: currentPools >= goal.count };
        }
        if (goal.type === "legendary_caught") {
          const currentLeg = (goal.scope ?? "lake") === "total" ? totalLegendary : (lakeStateForStep.legendaryCaught ?? 0);
          const warning =
            goal.maxCount !== undefined && currentLeg > goal.maxCount ? `You are over the recommended legendary count (${goal.maxCount}+).` : null;
          return { label: `${currentLeg}/${goal.count} legendaries caught`, completed: currentLeg >= goal.count, warning };
        }
      }
      return { label: "No lake data", completed: false };
    }

    if (!goals.length) {
      progressLabel = "Awaiting progress";
      completed = false;
    } else {
      const statuses = goals.map((goal) => evaluateGoal(goal));
      progressLabel = statuses.map((status) => status.label).join(" | ");
      const progressLines = statuses.map((status) => status.label);
      completed = useAll
        ? statuses.every((status) => status.completed)
        : useAny
          ? statuses.some((status) => status.completed)
          : statuses[0].completed;
      offPathWarning = statuses.find((status) => status.warning)?.warning ?? offPathWarning;
      return {
        stepIndex,
        step,
        steps,
        lakeStateForStep,
        progressLabel,
        progressLines,
        progressEntries: statuses,
        completed,
        shouldSkip,
        skipThreshold,
        offPathWarning: offPathWarning ?? warnMessage,
        wrongLakeId,
        wrongLakeTargetId,
      };
    }

    return {
      stepIndex,
      step,
      steps,
      lakeStateForStep,
      progressLabel,
      progressLines: [progressLabel],
      progressEntries: [{ label: progressLabel, completed }],
      completed,
      shouldSkip,
      skipThreshold,
      offPathWarning: offPathWarning ?? warnMessage,
      wrongLakeId,
      wrongLakeTargetId,
    };
  }, [guidedOption, guidedState, toolState, goldTarget]);

  useEffect(() => {
    setGuidedMediaOpen(false);
  }, [guidedStepData?.step.stepId]);

  useEffect(() => {
    if (!guidedStepData || !toolState?.guidedAutoAdvance) return;
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
  }, [guidedStepData, toolState?.guidedAutoAdvance]);

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
  const historyVisible = history.filter((entry) => {
    if (entry.action === "reset_all") return false;
    if (!toolState.resetHistoryEpoch) return true;
    return entry.timestamp >= toolState.resetHistoryEpoch;
  });
  const recentCatchEntries = historyVisible.filter((entry) => entry.action === "catch" || entry.action === "pool_clear");
  const lastThree = recentCatchEntries.slice(-3).reverse();

  const totalFishRemaining = sumCounts(lakeState.remainingByTypeId);
  const legendaryRemaining = lakeState.remainingByTypeId[legendaryTypeId] ?? 0;
  const legendaryChance = totalFishRemaining > 0 ? (legendaryRemaining / totalFishRemaining) * 100 : 0;
  const expectedLuresNextLegendary = legendaryRemaining > 0 ? (totalFishRemaining + 1) / (legendaryRemaining + 1) : null;
  const breakChance = totalFishRemaining > 0 ? legendaryRemaining / totalFishRemaining : null;
  const breakLuresForChance = (targetChance: number) => {
    if (!breakChance) return null;
    return Math.ceil(Math.log(1 - targetChance) / Math.log(1 - breakChance));
  };

  const weightsForLake = data.weightsByLake[lake.lakeId] ?? {};
  const ticketsPerKg = data.ticketsPerKgByLake?.[lake.lakeId] ?? null;
  const weightRemaining = Object.entries(lakeState.remainingByTypeId).reduce((sum, [typeId, count]) => {
    return sum + count * (weightsForLake[typeId] ?? 0);
  }, 0);
  const ticketsRemaining = ticketsPerKg ? weightRemaining * ticketsPerKg : null;

  const totalLegendaryCaught = Object.values(toolState.lakeStates ?? {}).reduce((sum, entry) => sum + entry.legendaryCaught, 0);
  const totalFishCaught = Object.values(toolState.lakeStates ?? {}).reduce((sum, entry) => sum + entry.fishCaught, 0);
  const totalWeightCaught = Object.entries(toolState.lakeStates ?? {}).reduce((sum, [lakeId, entry]) => {
    const fullCounts = buildFullCounts(data, lakeId);
    const weightsForLakeEntry = data.weightsByLake[lakeId] ?? {};
    const remainingCounts = entry.remainingByTypeId;
    const lakeCaughtWeight = Object.entries(fullCounts).reduce((lakeSum, [typeId, fullCount]) => {
      const remaining = remainingCounts[typeId] ?? 0;
      const caughtCount = entry.poolsCompleted * fullCount + Math.max(0, fullCount - remaining);
      return lakeSum + caughtCount * (weightsForLakeEntry[typeId] ?? 0);
    }, 0);
    return sum + lakeCaughtWeight;
  }, 0);
  const ticketsPerKgMap = data.ticketsPerKgByLake ?? {};
  const hasAllTicketRates = Object.keys(toolState.lakeStates ?? {}).every((lakeId) => ticketsPerKgMap[lakeId] !== undefined);
  const totalTicketsGained = hasAllTicketRates
    ? Object.entries(toolState.lakeStates ?? {}).reduce((sum, [lakeId, entry]) => {
        const fullCounts = buildFullCounts(data, lakeId);
        const weightsForLakeEntry = data.weightsByLake[lakeId] ?? {};
        const remainingCounts = entry.remainingByTypeId;
        const lakeCaughtWeight = Object.entries(fullCounts).reduce((lakeSum, [typeId, fullCount]) => {
          const remaining = remainingCounts[typeId] ?? 0;
          const caughtCount = entry.poolsCompleted * fullCount + Math.max(0, fullCount - remaining);
          return lakeSum + caughtCount * (weightsForLakeEntry[typeId] ?? 0);
        }, 0);
        return sum + lakeCaughtWeight * (ticketsPerKgMap[lakeId] ?? 0);
      }, 0)
    : null;


  const silverCurrent = toolState.currentSilverTickets ?? null;
  const silverTarget = effectiveSilverTarget;
  const silverRemaining = silverCurrent !== null && silverTarget !== null ? Math.max(0, silverTarget - silverCurrent) : null;
  const avgTicketsPerFishSilver = lakeRecommendations?.avgTicketsPerFish ?? null;
  const silverFishNeeded = silverRemaining !== null && avgTicketsPerFishSilver ? Math.ceil(silverRemaining / avgTicketsPerFishSilver) : null;
  const luresRemainingFromTasks = taskTotals?.remaining ?? null;
  const currentLures = toolState.currentLures ?? null;
  const purchasedLures = toolState.purchasedLures ?? null;
  const currentGems = toolState.currentGems ?? null;
  const luresEarnedFromTasks = taskTotals?.earned ?? null;
  const estimatedGemLuresUsed =
    luresEarnedFromTasks !== null && currentLures !== null ? Math.max(0, totalFishCaught - luresEarnedFromTasks - currentLures) : null;
  const estimatedGemsSpent = estimatedGemLuresUsed !== null ? estimatedGemLuresUsed * 150 : null;
  const totalAvailableLures =
    currentLures !== null && luresRemainingFromTasks !== null ? currentLures + luresRemainingFromTasks + (purchasedLures ?? 0) : null;
  const purchasableLuresFromGems = currentGems !== null ? Math.floor(currentGems / 150) : null;
  const maxPossibleLures = totalAvailableLures !== null && purchasableLuresFromGems !== null ? totalAvailableLures + purchasableLuresFromGems : null;
  const silverLureShortfall = silverFishNeeded !== null && totalAvailableLures !== null ? Math.max(0, silverFishNeeded - totalAvailableLures) : null;
  const silverGemCost = silverLureShortfall !== null ? silverLureShortfall * 150 : null;

  function getLegendaryRangeForLake(
    lakeId: string,
    goal: number,
    data: FishingToolData,
    lakeStates: Record<string, LakeState>,
    legendaryTypeId: string,
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
    const expectedOneRemaining = remainingLegendary > 0 ? (remainingFish + 1) / (remainingLegendary + 1) : null;

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
  const goldLureShortfall = goldExpectedLures !== null && totalAvailableLures !== null ? Math.max(0, goldExpectedLures - totalAvailableLures) : null;
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
      const prevLakeState: LakeState = {
        remainingByTypeId: { ...existing.remainingByTypeId },
        poolsCompleted: existing.poolsCompleted,
        legendaryCaught: existing.legendaryCaught,
        fishCaught: existing.fishCaught,
      };
      nextLakeStates[lakeId] = {
        ...existing,
        remainingByTypeId: buildFullCounts(data, lakeId),
      };
      const prevHistory = prev.history ?? [];
      const nextHistory = prevHistory.filter((entry) => entry.lakeId !== lakeId);
      nextHistory.push({
        entryId: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        lakeId,
        typeId: "__reset__",
        fishName: "Refill lake",
        rarity: "rare",
        timestamp: Date.now(),
        prevLakeState,
        action: "reset_lake",
        prevHistory,
      });
      return { ...prev, lakeStates: nextLakeStates, history: nextHistory.slice(-100) };
    });
  }

  function resetLakeProgress(lakeId: string) {
    updateToolState((prev) => {
      const nextLakeStates = { ...prev.lakeStates };
      const existing = nextLakeStates[lakeId];
      if (!existing) return prev;
      const prevLakeState: LakeState = {
        remainingByTypeId: { ...existing.remainingByTypeId },
        poolsCompleted: existing.poolsCompleted,
        legendaryCaught: existing.legendaryCaught,
        fishCaught: existing.fishCaught,
      };
      nextLakeStates[lakeId] = {
        remainingByTypeId: buildFullCounts(data, lakeId),
        poolsCompleted: 0,
        legendaryCaught: 0,
        fishCaught: 0,
      };
      const prevHistory = prev.history ?? [];
      const nextHistory = prevHistory.filter((entry) => entry.lakeId !== lakeId);
      nextHistory.push({
        entryId: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        lakeId,
        typeId: "__reset__",
        fishName: "Reset lake progress",
        rarity: "rare",
        timestamp: Date.now(),
        prevLakeState,
        action: "reset_lake_progress",
        prevHistory,
      });
      return { ...prev, lakeStates: nextLakeStates, history: nextHistory.slice(-100) };
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
      const nextLegendaryCaught = currentLakeState.legendaryCaught + (typeId === legendaryTypeId ? 1 : 0);

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
        action: "catch",
      });

      return {
        ...prev,
        lakeStates: nextLakeStates,
        history: nextHistory.slice(-100),
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

      const nextHistory: HistoryEntry[] = [];
      nextHistory.push({
        entryId: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        lakeId: lake.lakeId,
        typeId: legendaryTypeId,
        fishName: "Pool cleared",
        rarity: "legendary",
        timestamp: Date.now(),
        prevLakeState,
        action: "pool_clear",
      });

      return {
        ...prev,
        lakeStates: nextLakeStates,
        history: nextHistory.slice(-100),
      };
    });
  }

  function undoLast() {
    updateToolState((prev) => {
      const nextHistory = [...(prev.history ?? [])];
      const last = nextHistory.pop();
      if (!last) return prev;
      if (last.action === "reset_all" && last.prevAllStates && last.prevHistory) {
        return {
          ...prev,
          lakeStates: last.prevAllStates,
          brokenLines: last.prevBrokenLines ?? prev.brokenLines,
          guidedCurrentWeight: last.prevGuidedWeight ?? prev.guidedCurrentWeight,
          history: last.prevHistory,
          resetHistoryEpoch: last.prevResetEpoch ?? prev.resetHistoryEpoch,
        };
      }
      if ((last.action === "reset_lake" || last.action === "reset_lake_progress") && last.prevHistory) {
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
          history: last.prevHistory,
        };
      }
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

  function setResourceValue(key: "currentLures" | "purchasedLures" | "currentGems", value: number | null) {
    updateToolState((prev) => ({
      ...prev,
      [key]: value,
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
        guidedCurrentWeight: null,
        guidedAutoAdvance: true,
      };
    });
  }

  function setGuidedWeight(value: number | null) {
    updateToolState((prev) => ({
      ...prev,
      guidedCurrentWeight: value,
    }));
  }

  function closeResetMenu() {
    setResetMenuOpen(false);
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
      const nextHistory = [...(prev.history ?? [])];
      const resetEpoch = Date.now();
      nextHistory.push({
        entryId: `${resetEpoch}-${Math.random().toString(36).slice(2, 7)}`,
        lakeId: prev.activeLakeId,
        typeId: "__reset__",
        fishName: "Reset all progress",
        rarity: "rare",
        timestamp: resetEpoch,
        prevLakeState: prev.lakeStates[prev.activeLakeId] ?? {
          remainingByTypeId: buildFullCounts(data, prev.activeLakeId),
          poolsCompleted: 0,
          legendaryCaught: 0,
          fishCaught: 0,
        },
        action: "reset_all",
        prevAllStates: prev.lakeStates,
        prevBrokenLines: prev.brokenLines,
        prevGuidedWeight: prev.guidedCurrentWeight ?? null,
        prevHistory: prev.history ?? [],
        prevResetEpoch: prev.resetHistoryEpoch ?? null,
      });
      return {
        ...prev,
        lakeStates: nextLakeStates,
        brokenLines: 0,
        history: nextHistory.slice(-100),
        guidedCurrentWeight: null,
        guidedStepIndex: 0,
        guidedAutoAdvance: true,
        resetHistoryEpoch: resetEpoch,
        activeLakeId: set.lakes[0]?.lakeId ?? prev.activeLakeId,
      };
    });
  }

  const outerCardStyle = showTitle ? { border: "1px solid var(--border)", borderRadius: 16, padding: 16, background: "var(--surface)" } : undefined;

  const guidedStepMeta = guidedStepData
    ? (() => {
        const hasGoals = Boolean(guidedStepData.step.goalAll?.length || guidedStepData.step.goalAny?.length || guidedStepData.step.goal);
        const isManualOnly = guidedStepData.step.goal?.type === "manual_confirm" && !guidedStepData.step.goalAll && !guidedStepData.step.goalAny;
        const shouldSkipClick = guidedStepData.shouldSkip || (hasGoals && !isManualOnly && !guidedStepData.completed);
        const isFinalStep = guidedStepData.stepIndex >= guidedStepData.steps.length - 1;
        return {
          shouldSkipClick,
          isFinalStep,
          buttonLabel: isFinalStep ? "Close Guide" : shouldSkipClick ? "Skip Step" : "Next Step",
        };
      })()
    : null;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {confirmResetOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(8, 12, 20, 0.72)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 20,
          }}
          onClick={() => setConfirmResetOpen(false)}
        >
          <div
            style={{
              width: "min(420px, 92vw)",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              padding: 16,
              boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Reset all progress?</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 14 }}>
              This clears all lake progress, broken lines, and guided route state. You can undo with Undo Last.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="ghost" onClick={() => setConfirmResetOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="negative"
                onClick={() => {
                  resetAllProgress();
                  setConfirmResetOpen(false);
                }}
              >
                Reset All
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showCompanion ? (
        <div style={outerCardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {showTitle ? <div style={{ fontSize: 18, fontWeight: 800 }}>{tool.title}</div> : null}
          </div>
          {tool.description ? <p style={{ marginTop: 6, fontSize: 14 }}>{tool.description}</p> : null}

          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            <details
              open={!toolState.guidedCollapsed}
              onToggle={(event) => {
                const isOpen = (event.currentTarget as HTMLDetailsElement).open;
                updateToolState((prev) => ({ ...prev, guidedCollapsed: !isOpen }));
              }}
              style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface-2)" }}
            >
              <summary className="detailsSummary" style={{ cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                <span aria-hidden="true" className="detailsChevron">
                  ▸
                </span>
                <span style={{ flex: 1 }}>Guided Route</span>
              </summary>
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
                      <div style={{ display: "grid", gap: 10 }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                          <label style={{ fontSize: 12, color: "var(--text-muted)" }}>Route</label>
                          <DropdownButton
                            valueLabel={guidedOption.title}
                            options={guidedState.data.options.map((option) => ({ value: option.optionId, label: option.title }))}
                            onSelect={setGuidedOption}
                            minWidth={120}
                            fontSize={12}
                          />
                          <div style={{ marginLeft: "auto" }} />
                          <button
                            type="button"
                            className="secondary"
                            onClick={resetGuidedRoute}
                            style={{ fontSize: 13, lineHeight: 1.1, padding: "8px 10px" }}
                          >
                            Reset
                          </button>
                        </div>
                        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          <label style={{ fontSize: 12, color: "var(--text-muted)" }}>Auto Progress</label>
                          <button
                            type="button"
                            className={toolState.guidedAutoAdvance ? "secondary" : "ghost"}
                            onClick={() => updateToolState((prev) => ({ ...prev, guidedAutoAdvance: !prev.guidedAutoAdvance }))}
                          >
                            {toolState.guidedAutoAdvance ? "On" : "Off"}
                          </button>
                          <label style={{ fontSize: 12, color: "var(--text-muted)" }}>Weight</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder="kg"
                            value={guidedWeightInput}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/[^\d]/g, "");
                              setGuidedWeightInput(raw);
                            }}
                            onFocus={() => {
                              guidedWeightEditingRef.current = true;
                            }}
                            onBlur={() => {
                              guidedWeightEditingRef.current = false;
                              setGuidedWeight(guidedWeightInput ? Number(guidedWeightInput) : null);
                            }}
                            style={{ maxWidth: 120 }}
                          />
                        </div>
                      </div>
                      {guidedOption.summary || guidedOption.disclaimer ? (
                        <div className="lakeInfoWrap" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                          {guidedOption.summary ? <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{guidedOption.summary}</div> : null}
                          {guidedOption.disclaimer ? (
                            <>
                              <button
                                type="button"
                                className="lakeInfoButton guidedInfoButton"
                                aria-label="Show option disclaimer"
                                onClick={() => setGuidedInfoOpen((prev) => !prev)}
                              >
                                ⓘ
                              </button>
                              {guidedInfoOpen ? <div className="lakeInfoPopover guidedInfoPopover">{guidedOption.disclaimer}</div> : null}
                            </>
                          ) : null}
                        </div>
                      ) : null}
                      {!toolState.guidedAutoAdvance ? <div style={{ fontSize: 12, color: "var(--warning)" }}>Auto Progress is OFF.</div> : null}
                      {guidedStepData ? (
                        <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10, background: "var(--surface)" }}>
                          <div style={{ fontWeight: 700 }}>{guidedStepData.step.action}</div>
                          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                            Lake: {set.lakes.find((entry) => entry.lakeId === guidedStepData.step.lakeId)?.label ?? guidedStepData.step.lakeId}
                          </div>
                          <div style={{ display: "grid", gap: 4, fontSize: 12, marginTop: 6 }}>
                            {(guidedStepData.progressEntries ?? []).map((entry, index) => (
                              <div
                                key={`${guidedStepData.step.stepId}-progress-${index}`}
                                style={{ color: entry.completed ? "var(--success)" : "var(--warning)" }}
                              >
                                {entry.label}
                              </div>
                            ))}
                          </div>
                          {guidedStepData.step.notes ? (
                            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>{guidedStepData.step.notes}</div>
                          ) : null}
                          <div className="lakeInfoWrap" style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                            <button
                              type="button"
                              className="lakeInfoButton guidedMediaButton"
                              onClick={() => {
                                if (!guidedStepData.step.media?.images?.length) return;
                                setGuidedMediaOpen((prev) => !prev);
                              }}
                              disabled={!guidedStepData.step.media?.images?.length}
                              style={{
                                opacity: guidedStepData.step.media?.images?.length ? 1 : 0.4,
                                cursor: guidedStepData.step.media?.images?.length ? "pointer" : "not-allowed",
                              }}
                            >
                              {guidedStepData.step.media?.label ?? "Media"}
                            </button>
                            {guidedMediaOpen && guidedStepData.step.media?.images?.length ? (
                              <div className="lakeInfoPopover guidedMediaPopover">
                                <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                                  {guidedStepData.step.media.images.map((image) => (
                                    <figure key={image.src} style={{ margin: 0, display: "grid", gap: 4, justifyItems: "center" }}>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setGuidedMediaLightbox({ images: guidedStepData.step.media?.images ?? [], index: guidedStepData.step.media?.images.indexOf(image) ?? 0 })
                                        }
                                        style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
                                      >
                                        <img
                                          src={resolvePath(image.src)}
                                          alt={image.alt ?? ""}
                                          style={{ width: 72, height: 72, objectFit: "contain" }}
                                        />
                                      </button>
                                      {image.caption ? (
                                        <figcaption style={{ fontSize: 11, color: "var(--text-subtle)" }}>{image.caption}</figcaption>
                                      ) : null}
                                    </figure>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                          {guidedStepData.wrongLakeId ? (
                            <div style={{ color: "var(--danger)", fontSize: 13, fontWeight: 600, marginTop: 6 }}>
                              You are on {set.lakes.find((entry) => entry.lakeId === guidedStepData.wrongLakeId)?.label ?? guidedStepData.wrongLakeId}
                              . Switch to{" "}
                              {set.lakes.find((entry) => entry.lakeId === guidedStepData.wrongLakeTargetId)?.label ??
                                guidedStepData.wrongLakeTargetId}
                              .
                            </div>
                          ) : guidedStepData.offPathWarning ? (
                            <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 6 }}>{guidedStepData.offPathWarning}</div>
                          ) : null}
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              marginTop: 10,
                              flexWrap: "nowrap",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => {
                                const prevIndex = Math.max(0, guidedStepData.stepIndex - 1);
                                setGuidedStepIndex(prevIndex);
                                updateToolState((prev) => ({ ...prev, guidedAutoAdvance: false }));
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
                              className={guidedStepMeta?.shouldSkipClick ? "negative" : "positive"}
                              onClick={() => {
                                if (guidedStepMeta?.isFinalStep) {
                                  updateToolState((prev) => (prev ? { ...prev, guidedCollapsed: true } : prev));
                                  return;
                                }
                                const nextIndex = Math.min(guidedStepData.steps.length - 1, guidedStepData.stepIndex + 1);
                                setGuidedStepIndex(nextIndex);
                                if (guidedStepMeta?.shouldSkipClick) {
                                  updateToolState((prev) => ({ ...prev, guidedAutoAdvance: false }));
                                }
                                const nextStep = guidedStepData.steps[nextIndex];
                                if (nextStep && nextStep.lakeId && nextStep.lakeId !== lake.lakeId) {
                                  setActiveLake(nextStep.lakeId);
                                }
                              }}
                            >
                              {guidedStepMeta?.buttonLabel ?? "Next Step"}
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
            </details>
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)" }}>Select a Lake</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {/* Set label removed */}
                  <DropdownButton
                    valueLabel={set.label}
                    options={data.sets.map((option) => ({ value: option.setId, label: option.label }))}
                    onSelect={setActiveSet}
                    minWidth={96}
                  />
                  <div ref={resetMenuRef} style={{ position: "relative" }}>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setResetMenuOpen((prev) => !prev)}
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <span>Reset Options</span>
                      <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>
                        {resetMenuOpen ? "▲" : "▼"}
                      </span>
                    </button>
                    {resetMenuOpen ? (
                      <div
                        style={{
                          position: "absolute",
                          right: 0,
                          top: "100%",
                          marginTop: 6,
                          display: "grid",
                          gap: 6,
                          padding: 8,
                          minWidth: 180,
                          background: "var(--surface)",
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          zIndex: 5,
                        }}
                      >
                        {set.lakes.map((entry) => (
                          <button
                            key={entry.lakeId}
                            type="button"
                            className="ghost"
                            onClick={() => {
                              resetLakeProgress(entry.lakeId);
                              closeResetMenu();
                            }}
                          >
                            Reset {entry.label}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => {
                            setConfirmResetOpen(true);
                            closeResetMenu();
                          }}
                        >
                          Reset All Progress
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="fishingLakeGrid">
                {set.lakes.map((entry) => {
                  const entryState = toolState.lakeStates[entry.lakeId];
                  const remaining = entryState ? Object.values(entryState.remainingByTypeId).reduce((sum, count) => sum + count, 0) : 0;
                  const legendaryLeft = entryState?.remainingByTypeId[legendaryTypeId] ?? 0;
                  const odds = remaining > 0 ? (legendaryLeft / remaining) * 100 : 0;
                  const active = entry.lakeId === lake.lakeId;
                  return (
                    <div
                      key={entry.lakeId}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setActiveLake(entry.lakeId);
                        setOpenLakeInfoId(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setActiveLake(entry.lakeId);
                          setOpenLakeInfoId(null);
                        }
                      }}
                      className="fishingLakeButton"
                      style={{
                        border: active ? "2px solid var(--accent)" : "1px solid var(--border)",
                        background: active ? "var(--highlight)" : "var(--surface-2)",
                        color: "var(--text)",
                      }}
                    >
                      <div className="lakeTitleRow">
                        <div className="lakeTitle" style={{ fontWeight: 700 }}>
                          {entry.label}
                        </div>
                      </div>
                      <div className="lakeMeta" style={{ color: "var(--text-muted)" }}>
                        {remaining} fish
                      </div>
                      <div className="lakeMeta" style={{ color: "var(--text-muted)" }}>
                        {odds.toFixed(1)}%
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <div className="fishingFishGrid">
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
                      className="fishingFishButton"
                      style={{
                        border: rarityStyle.border,
                        background: rarityStyle.background,
                      }}
                    >
                      {fish?.image ? (
                        <img src={resolvePath(fish.image)} alt={fish?.name ?? fishType.label} className="fishingFishImage" />
                      ) : (
                        <div style={{ fontSize: 18, marginBottom: 6 }}>{typeLabel}</div>
                      )}
                      <div className="fishLabel" style={{ color: "#0A0A0A" }}>
                        {displayName}
                      </div>
                      <div className="fishRemaining" style={{ color: "#0A0A0A" }}>
                        {remaining} left
                      </div>
                    </button>
                  );
                })}
              </div>

              <button type="button" className="secondary" onClick={catchWholePool}>
                Catch Whole Pool
              </button>

              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => resetLake(lake.lakeId)}
                  disabled={Object.entries(buildFullCounts(data, lake.lakeId)).every(
                    ([typeId, count]) => lakeState.remainingByTypeId[typeId] === count,
                  )}
                >
                  Refill Lake
                </button>
                <button type="button" className="secondary" onClick={undoLast} disabled={!history.length}>
                  Undo Last
                </button>
              </div>

              <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
                <div className="lakeInfoWrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <div style={{ fontWeight: 700 }}>Broken Lines</div>
                  <button
                    type="button"
                    className="lakeInfoButton"
                    aria-label="Show line break odds"
                    onClick={() => setShowBreakOdds((prev) => !prev)}
                  >
                    ⓘ
                  </button>
                </div>
                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div className="breakCount">
                    {toolState.brokenLines ?? 0}/{brokenLinesMax}
                  </div>
                  <DropdownButton
                    valueLabel={`+${breakStep}`}
                    options={[1, 2, 3, 5, 10].map((value) => ({ value: String(value), label: `+${value}` }))}
                    onSelect={(value) => setBreakStep(Number(value))}
                    minWidth={72}
                  />
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => updateBrokenLines(breakStep)}
                    disabled={(toolState.brokenLines ?? 0) >= brokenLinesMax}
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => updateBrokenLines(-breakStep)}
                    disabled={(toolState.brokenLines ?? 0) <= 0}
                  >
                    Remove
                  </button>
                </div>
                {showBreakOdds ? (
                  <div style={{ marginTop: 10, display: "flex", gap: 12, color: "var(--text-muted)" }}>
                    <div style={{ display: "grid", gap: 8, fontSize: 12, flex: 1 }}>
                      <div>Chance per break: {breakChance !== null ? `${(breakChance * 100).toFixed(1)}%` : "No legendary in pool"}</div>
                      <div>50% chance by: {breakLuresForChance(0.5) ?? "—"} breaks</div>
                      <div>90% chance by: {breakLuresForChance(0.9) ?? "—"} breaks</div>
                      <div>95% chance by: {breakLuresForChance(0.95) ?? "—"} breaks</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "flex-end" }}>
                      <button
                        type="button"
                        className="secondary"
                        style={{ padding: "6px 10px", fontSize: 11 }}
                        onClick={() => updateBrokenLines(-brokenLinesMax)}
                        disabled={(toolState.brokenLines ?? 0) <= 0}
                      >
                        Reset Broken Lines
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface-2)" }}>
                <div className="lakeInfoWrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <div style={{ fontWeight: 700 }}>Pool</div>
                  <button
                    type="button"
                    className="lakeInfoButton"
                    aria-label="Show pool details"
                    onClick={() => setOpenLakeInfoId((prev) => (prev === "pool" ? null : "pool"))}
                  >
                    ⓘ
                  </button>
                  {openLakeInfoId === "pool" ? (
                    <div className="lakeInfoPopover">
                      <div style={{ fontWeight: 700 }}>{lake.label}</div>
                      <div>Fish Caught: {lakeState.fishCaught}</div>
                      <div>Pools Cleared: {lakeState.poolsCompleted}</div>
                      <div>Legendaries: {lakeState.legendaryCaught}</div>
                    </div>
                  ) : null}
                </div>
                <div style={{ display: "grid", gap: 6, fontSize: 14 }}>
                  <div>Fish Remaining: {totalFishRemaining}</div>
                  <div>Chance Next Fish is Legendary: {legendaryChance.toFixed(1)}%</div>
                  <div>
                    Estimated Lures to Next Legendary:{" "}
                    {expectedLuresNextLegendary !== null ? formatNumber(expectedLuresNextLegendary, 1) : "None in pool"}
                  </div>
                  <div>Estimated Weight Remaining: {formatNumber(weightRemaining, 1)} kg</div>
                  <div>Estimated Silver Tickets Remaining: {ticketsPerKg ? formatNumber(ticketsRemaining, 0) : "Add ticket data"}</div>
                </div>
              </div>
              <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface-2)" }}>
                <div className="lakeInfoWrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <div style={{ fontWeight: 700 }}>Totals</div>
                  <button
                    type="button"
                    className="lakeInfoButton lakeInfoButtonGrid"
                    aria-label="Show lake totals"
                    onClick={() => setOpenLakeInfoId((prev) => (prev === "totals" ? null : "totals"))}
                  >
                    <span className="lakeInfoGridIcon" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                      <span />
                    </span>
                  </button>
                  {openLakeInfoId === "totals" ? (
                    <div className="lakeInfoPopover lakeInfoGridPopover">
                      {set.lakes.map((entry) => {
                        const entryState = toolState.lakeStates[entry.lakeId];
                        return (
                          <div key={entry.lakeId} className="lakeInfoGridCell">
                            <div style={{ fontWeight: 700 }}>{entry.label}</div>
                            <div>Fish Caught: {entryState?.fishCaught ?? 0}</div>
                            <div>Pools Cleared: {entryState?.poolsCompleted ?? 0}</div>
                            <div>Legendaries: {entryState?.legendaryCaught ?? 0}</div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
                <div style={{ display: "grid", gap: 6, fontSize: 14 }}>
                  <div>Total Fish Caught: {totalFishCaught}</div>
                  <div>Total Legendary Fish Caught: {totalLegendaryCaught}</div>
                  <div>Estimated Weight Caught: {formatNumber(totalWeightCaught, 1)} kg</div>
                  <div>Estimated Silver Tickets Gained: {totalTicketsGained !== null ? formatNumber(totalTicketsGained, 0) : "Add ticket data"}</div>
                  <div>
                    Estimated Gems Spent: {estimatedGemsSpent !== null ? formatNumber(estimatedGemsSpent, 0) : "Add current lures + task progress"}
                  </div>
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
                <summary style={{ cursor: "pointer" }}>History ({historyVisible.length})</summary>
                <div style={{ marginTop: 8, display: "grid", gap: 6, maxHeight: 180, overflow: "auto" }}>
                  {historyVisible
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
      ) : null}

      {showPurchase ? (
        <div style={outerCardStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            {showTitle ? <div style={{ fontSize: 18, fontWeight: 800 }}>{tool.title}</div> : null}
          </div>
          {tool.description ? <p style={{ marginTop: 6 }}>{tool.description}</p> : null}
          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            <div
              style={{
                display: "grid",
                gap: 10,
                padding: 10,
                borderRadius: 10,
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
              }}
            >
              <div style={{ fontWeight: 700 }}>Purchase Goals</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Set what you want to buy in the Event Shop. The selections drive these targets and recommendations.
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, fontSize: 12 }}>
                <span>
                  Computed silver target: <b>{suggestedSilverTarget ? formatNumber(suggestedSilverTarget) : "—"}</b>
                </span>
                {suggestedSilverTarget ? (
                  <button type="button" className="ghost" onClick={() => setTargetTicketValue("targetSilverTickets", suggestedSilverTarget)}>
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
            </div>

            <div
              style={{
                display: "grid",
                gap: 10,
                padding: 10,
                borderRadius: 10,
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
              }}
            >
              <div style={{ fontWeight: 700 }}>Recommendations</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                {goldRemaining === null
                  ? "Select gold purchases and enter your current golden tickets."
                  : goldRemaining === 0 && (silverRemaining === null || silverRemaining === 0)
                    ? "Goal reached."
                    : lakeRecommendations
                      ? (() => {
                          const stepLabels = lakeRecommendations.steps
                            .map((step) => {
                              const label = set?.lakes.find((entry) => entry.lakeId === step.lakeId)?.label ?? step.lakeId;
                              return `${label} (~${formatNumber(Math.ceil(step.lures))} lures)`;
                            })
                            .join(" → ");
                          const combinedLures = formatNumber(Math.ceil(lakeRecommendations.combinedLures));
                          const silverGain = formatNumber(lakeRecommendations.expectedSilverGain, 0);
                          return `Recommended path: ${stepLabels}. Total lures needed: ${combinedLures}. Estimated silver gain: ${silverGain}.`;
                        })()
                      : "Add a goal to see a recommended lake."}
              </div>
              {(goldRange || silverRemaining !== null) ? (
                <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
                  <div style={{ display: "grid", gap: 6, padding: 10, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)" }}>
                    <div style={{ fontWeight: 700 }}>Goal Requirements</div>
                    <div>
                      Silver tickets needed (goal):{" "}
                      <b style={{ color: silverRemaining !== null && silverRemaining > 0 ? "var(--danger)" : "var(--success)" }}>
                        {silverRemaining !== null ? formatNumber(silverRemaining) : "—"}
                      </b>
                    </div>
                    <div>
                      Golden tickets needed (goal):{" "}
                      <b style={{ color: goldRemaining !== null && goldRemaining > 0 ? "var(--danger)" : "var(--success)" }}>
                        {goldRemaining !== null ? formatNumber(goldRemaining) : "—"}
                      </b>
                    </div>
                    <div>
                      Estimated lures needed: <b>{combinedLuresNeeded !== null ? formatNumber(Math.ceil(combinedLuresNeeded)) : "—"}</b>
                    </div>
                    {silverRemaining !== null ? (
                      <div>
                        Estimated lures needed for silver goal: <b>{silverFishNeeded !== null ? formatNumber(silverFishNeeded) : "—"}</b>
                      </div>
                    ) : null}
                  </div>

                  <div style={{ display: "grid", gap: 6, padding: 10, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)" }}>
                    <div style={{ fontWeight: 700 }}>Costs</div>
                    <div>
                      Estimated gem cost: <b>{goldRange ? formatNumber(Math.ceil(goldRange.expected) * 150) : "—"}</b>
                    </div>
                    <div>
                      Expected Lure Cost: <b>{goldGemCost !== null ? formatNumber(goldGemCost) : "—"}</b>
                    </div>
                    {silverRemaining !== null ? (
                      <div>
                        Estimated gem cost (silver goal): <b>{silverGemCost !== null ? formatNumber(silverGemCost) : "—"}</b>
                      </div>
                    ) : null}
                    {currentGems !== null && goldGemCost !== null && currentGems < goldGemCost ? (
                      <div style={{ color: "var(--danger)" }}>Not enough gems to reach golden ticket goal with current lures.</div>
                    ) : null}
                    {currentGems !== null && silverGemCost !== null && currentGems < silverGemCost ? (
                      <div style={{ color: "var(--danger)" }}>Not enough gems to reach silver ticket goal with current lures.</div>
                    ) : null}
                  </div>

                  <div style={{ display: "grid", gap: 6, padding: 10, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)" }}>
                    <div style={{ fontWeight: 700 }}>Gains</div>
                    <div>
                      Lures available (now + tasks + bought): <b>{totalAvailableLures !== null ? formatNumber(totalAvailableLures) : "—"}</b>
                    </div>
                    <div>
                      Estimated silver tickets gained:{" "}
                      <b>
                        {lakeRecommendations ? formatNumber(lakeRecommendations.expectedSilverGain, 0) : "—"}
                      </b>
                    </div>
                    <div>
                      Estimated weight gained: <b>{formatNumber(totalWeightCaught, 1)} kg</b>
                    </div>
                    <div style={{ color: "var(--text-muted)" }}>
                      Weighted by silver value (baseline {formatNumber(silverGoalBaseline)}). Best-case assumes full pools between legendaries.
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {guidedMediaLightbox ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setGuidedMediaLightbox(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.72)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 20,
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              maxWidth: "90vw",
              maxHeight: "90vh",
            }}
          >
            <img
              src={resolvePath(guidedMediaLightbox.images[guidedMediaLightbox.index]?.src ?? "")}
              alt={guidedMediaLightbox.images[guidedMediaLightbox.index]?.alt ?? ""}
              style={{ maxWidth: "90vw", maxHeight: "70vh", objectFit: "contain" }}
            />
            {guidedMediaLightbox.images[guidedMediaLightbox.index]?.caption ? (
              <div style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center" }}>
                {guidedMediaLightbox.images[guidedMediaLightbox.index]?.caption}
              </div>
            ) : null}
            {guidedMediaLightbox.images.length > 1 ? (
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  className="ghost"
                  onClick={() =>
                    setGuidedMediaLightbox((prev) =>
                      prev
                        ? {
                            ...prev,
                            index: (prev.index - 1 + prev.images.length) % prev.images.length,
                          }
                        : prev,
                    )
                  }
                >
                  Prev
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() =>
                    setGuidedMediaLightbox((prev) =>
                      prev
                        ? {
                            ...prev,
                            index: (prev.index + 1) % prev.images.length,
                          }
                        : prev,
                    )
                  }
                >
                  Next
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
