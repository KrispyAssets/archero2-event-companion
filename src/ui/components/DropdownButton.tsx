import { useEffect, useRef, useState } from "react";

export type DropdownOption = {
  value: string;
  label: string;
};

export default function DropdownButton({
  valueLabel,
  options,
  onSelect,
  minWidth,
  fontSize,
  align = "left",
}: {
  valueLabel: string;
  options: DropdownOption[];
  onSelect: (value: string) => void;
  minWidth?: number;
  fontSize?: number;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!ref.current || !target) return;
      if (!ref.current.contains(target)) {
        setOpen(false);
      }
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className="secondary"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          minWidth,
          fontSize: fontSize ? `${fontSize}px` : undefined,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "nowrap",
          textAlign: "left",
          whiteSpace: "nowrap",
        }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {valueLabel}
        </span>
        <span aria-hidden="true" style={{ fontSize: 11, lineHeight: 1 }}>
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open ? (
        <div
          style={{
            position: "absolute",
            right: align === "right" ? 0 : "auto",
            left: align === "left" ? 0 : "auto",
            top: "100%",
            marginTop: 6,
            display: "grid",
            gap: 6,
            padding: 8,
            minWidth: minWidth ?? 180,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            zIndex: 5,
          }}
        >
          {options.map((option) => {
            const isSelected = option.label === valueLabel || option.value === valueLabel;
            return (
              <button
                key={option.value}
                type="button"
                className="ghost"
                style={
                  isSelected
                    ? { fontWeight: 700, color: "var(--accent)", background: "var(--highlight)", fontSize: fontSize ? `${fontSize}px` : undefined }
                    : undefined
                }
                onClick={() => {
                  onSelect(option.value);
                  setOpen(false);
                }}
              >
                <span
                  style={{
                    display: "block",
                    fontSize: fontSize ? `${fontSize}px` : undefined,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
