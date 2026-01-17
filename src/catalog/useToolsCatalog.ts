import { useEffect, useMemo, useState } from "react";
import { loadCatalogIndex, loadToolsByIds } from "./loadCatalog";
import type { ToolDefinition } from "./types";

type ToolsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; tools: ToolDefinition[] };

export function useToolsCatalog(toolIds: string[] | null | undefined): ToolsState {
  const normalizedIds = useMemo(() => (toolIds ?? []).filter((id) => id.length > 0), [toolIds]);
  const idsKey = useMemo(() => normalizedIds.join("|"), [normalizedIds]);
  const [state, setState] = useState<ToolsState>({ status: "idle" });

  useEffect(() => {
    if (!normalizedIds.length) {
      setState({ status: "idle" });
      return;
    }

    let cancelled = false;

    async function run() {
      try {
        setState({ status: "loading" });
        const index = await loadCatalogIndex();
        const tools = await loadToolsByIds(index.toolPaths, normalizedIds);
        if (cancelled) return;
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
