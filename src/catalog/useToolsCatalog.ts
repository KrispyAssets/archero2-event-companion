import { useEffect, useMemo, useState } from "react";
import { loadCatalogIndex, loadToolsByIds } from "./loadCatalog";
import type { ToolDefinition } from "./types";

type ToolsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; tools: ToolDefinition[] };

const toolsCache = new Map<string, ToolDefinition[]>();
let catalogIndexCache: Awaited<ReturnType<typeof loadCatalogIndex>> | null = null;

export function useToolsCatalog(toolIds: string[] | null | undefined): ToolsState {
  const normalizedIds = useMemo(() => (toolIds ?? []).filter((id) => id.length > 0), [toolIds]);
  const idsKey = useMemo(() => normalizedIds.join("|"), [normalizedIds]);
  const [state, setState] = useState<ToolsState>(() => {
    if (idsKey && toolsCache.has(idsKey)) {
      return { status: "ready", tools: toolsCache.get(idsKey)! };
    }
    return { status: "idle" };
  });

  useEffect(() => {
    if (!normalizedIds.length) {
      setState({ status: "idle" });
      return;
    }

    let cancelled = false;

    async function run() {
      try {
        const cached = toolsCache.get(idsKey);
        if (cached) {
          setState({ status: "ready", tools: cached });
          return;
        }
        setState((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
        const index = catalogIndexCache ?? (catalogIndexCache = await loadCatalogIndex());
        const tools = await loadToolsByIds(index.toolPaths, normalizedIds);
        if (cancelled) return;
        toolsCache.set(idsKey, tools);
        setState({ status: "ready", tools });
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setState({ status: "error", error: msg });
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  return state;
}
