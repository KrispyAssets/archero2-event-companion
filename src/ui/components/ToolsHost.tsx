import type { ToolDefinition, ToolPriorityList } from "../../catalog/types";

function PriorityListToolView({ tool }: { tool: ToolPriorityList }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fff" }}>
      <div style={{ fontWeight: 800 }}>{tool.title}</div>
      {tool.description ? <p style={{ marginTop: 6 }}>{tool.description}</p> : null}
      <ol style={{ paddingLeft: 18, marginTop: 10, marginBottom: 0 }}>
        {tool.items.map((item, index) => (
          <li key={`${tool.toolId}-${index}`} style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 600 }}>{item.label}</div>
            {item.note ? <div style={{ fontSize: 13, color: "#4b5563" }}>{item.note}</div> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function ToolsHost({ tools }: { tools: ToolDefinition[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {tools.map((tool) => {
        if (tool.toolType === "priority_list") {
          return <PriorityListToolView key={tool.toolId} tool={tool} />;
        }

        return (
          <div key={tool.toolId} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fff" }}>
            <div style={{ fontWeight: 800 }}>{tool.title}</div>
            <p style={{ marginTop: 6 }}>Unsupported tool type: {tool.toolType}</p>
          </div>
        );
      })}
    </div>
  );
}
