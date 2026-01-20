import type { TaskDefinition, ToolDefinition, ToolFishingCalculator, ToolPriorityList, ToolStaticText } from "../../catalog/types";
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
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface)" }}>
      <div style={{ fontWeight: 800 }}>{tool.title}</div>
      {tool.description ? <p style={{ marginTop: 6 }}>{tool.description}</p> : null}
      <ol style={{ paddingLeft: 18, marginTop: 10, marginBottom: 0 }}>
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
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface)" }}>
      <div style={{ fontWeight: 800 }}>{tool.title}</div>
      {tool.description ? <p style={{ marginTop: 6 }}>{tool.description}</p> : null}
      <div style={{ marginTop: 8 }}>{renderBodyText(tool.body)}</div>
    </div>
  );
}

export default function ToolsHost({
  tools,
  eventId,
  eventVersion,
  tasks,
  guidedRoutePath,
}: {
  tools: ToolDefinition[];
  eventId?: string;
  eventVersion?: number;
  tasks?: TaskDefinition[];
  guidedRoutePath?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {tools.map((tool) => {
        if (tool.toolType === "priority_list") {
          return <PriorityListToolView key={tool.toolId} tool={tool as ToolPriorityList} />;
        }
        if (tool.toolType === "static_text") {
          return <StaticTextToolView key={tool.toolId} tool={tool as ToolStaticText} />;
        }
        if (tool.toolType === "fishing_calculator") {
          return (
            <FishingToolView
              key={tool.toolId}
              tool={tool as ToolFishingCalculator}
              eventId={eventId}
              eventVersion={eventVersion}
              tasks={tasks}
              guidedRoutePath={guidedRoutePath}
            />
          );
        }

        return (
          <div key={tool.toolId} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface)" }}>
            <div style={{ fontWeight: 800 }}>{tool.title}</div>
            <p style={{ marginTop: 6 }}>Unsupported tool type: {tool.toolType}</p>
          </div>
        );
      })}
    </div>
  );
}
