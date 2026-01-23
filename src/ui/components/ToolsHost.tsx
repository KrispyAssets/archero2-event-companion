import { useEffect, useState } from "react";
import type {
  RewardAsset,
  TaskDefinition,
  TaskGroupLabelMap,
  ToolDefinition,
  ToolFishingCalculator,
  ToolPurchaseGoals,
  ToolPriorityList,
  ToolStaticText,
} from "../../catalog/types";
import FishingToolView from "./FishingTool";

function renderBodyText(body: string) {
  if (!body) return null;
  return body.split(/\n{2,}/).map((paragraph, index) => (
    <p key={`${index}-${paragraph.slice(0, 12)}`} style={{ margin: "8px 0" }}>
      {paragraph}
    </p>
  ));
}

function PriorityListToolView({ tool }: { tool: ToolPriorityList }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {tool.description ? <p style={{ margin: 0 }}>{tool.description}</p> : null}
      <ol style={{ paddingLeft: 18, marginTop: 0, marginBottom: 0 }}>
        {tool.items.map((item, index) => (
          <li key={`${tool.toolId}-${index}`} style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 600 }}>{item.label}</div>
            {item.note ? <div style={{ fontSize: 13, color: "var(--text-soft)" }}>{item.note}</div> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function StaticTextToolView({ tool }: { tool: ToolStaticText }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {tool.description ? <p style={{ margin: 0 }}>{tool.description}</p> : null}
      <div>{renderBodyText(tool.body)}</div>
    </div>
  );
}

export default function ToolsHost({
  tools,
  eventId,
  eventVersion,
  tasks,
  taskGroupLabels,
  rewardAssets,
  guidedRoutePath,
}: {
  tools: ToolDefinition[];
  eventId?: string;
  eventVersion?: number;
  tasks?: TaskDefinition[];
  taskGroupLabels?: TaskGroupLabelMap;
  rewardAssets?: Record<string, RewardAsset>;
  guidedRoutePath?: string;
}) {
  const [openById, setOpenById] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setOpenById((prev) => {
      const next = { ...prev };
      for (const tool of tools) {
        if (next[tool.toolId] === undefined) {
          next[tool.toolId] = tool.toolType === "fishing_calculator";
        }
      }
      return next;
    });
  }, [tools]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {tools.map((tool) => {
        let content: React.ReactNode;
        if (tool.toolType === "priority_list") {
          content = <PriorityListToolView tool={tool as ToolPriorityList} />;
        } else if (tool.toolType === "static_text") {
          content = <StaticTextToolView tool={tool as ToolStaticText} />;
        } else if (tool.toolType === "fishing_calculator") {
          content = (
            <FishingToolView
              tool={tool as ToolFishingCalculator}
              eventId={eventId}
              eventVersion={eventVersion}
              tasks={tasks}
              taskGroupLabels={taskGroupLabels}
              rewardAssets={rewardAssets}
              guidedRoutePath={guidedRoutePath}
              variant="companion"
              showTitle={false}
            />
          );
        } else if (tool.toolType === "purchase_goals") {
          content = (
            <FishingToolView
              tool={tool as ToolPurchaseGoals}
              eventId={eventId}
              eventVersion={eventVersion}
              tasks={tasks}
              taskGroupLabels={taskGroupLabels}
              rewardAssets={rewardAssets}
              guidedRoutePath={guidedRoutePath}
              variant="purchase"
              showTitle={false}
            />
          );
        } else {
          content = <p>Unsupported tool type: {tool.toolType}</p>;
        }

        return (
          <details
            key={tool.toolId}
            open={openById[tool.toolId] ?? false}
            onToggle={(e) => {
              const isOpen = (e.currentTarget as HTMLDetailsElement).open;
              setOpenById((prev) => ({ ...prev, [tool.toolId]: isOpen }));
            }}
            style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px", background: "var(--surface)" }}
          >
            <summary className="detailsSummary" style={{ cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
              <span aria-hidden="true" className="detailsChevron">
                ▸
              </span>
              <span style={{ flex: 1 }}>{tool.title}</span>
            </summary>
            <div style={{ marginTop: 8 }}>{content}</div>
          </details>
        );
      })}
    </div>
  );
}
