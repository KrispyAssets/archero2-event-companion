import { useMemo, useState } from "react";
import type { TaskDefinition } from "../../catalog/types";
import { buildTaskGroups, computeEarned, computeRemaining, getGroupPlaceholder } from "../../catalog/taskGrouping";
import { getEventProgressState, upsertTaskState } from "../../state/userStateStore";

export default function TasksTracker(props: {
  eventId: string;
  eventVersion: number;
  tasks: TaskDefinition[];
  scrollContainerRef?: React.Ref<HTMLDivElement>;
}) {
  const { eventId, eventVersion, tasks } = props;
  const [tick, setTick] = useState(0);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});

  const progressState = useMemo(() => {
    void tick;
    return getEventProgressState(eventId, eventVersion);
  }, [eventId, eventVersion, tick]);

  const groups = useMemo(() => buildTaskGroups(tasks), [tasks]);

  function setProgress(groupId: string, value: number, maxValue: number) {
    const clamped = Math.max(0, Math.min(value, maxValue));
    upsertTaskState(eventId, eventVersion, groupId, (prev) => ({
      progressValue: clamped,
      flags: { ...prev.flags, isCompleted: clamped >= maxValue },
    }));
    setInputValues((prev) => ({ ...prev, [groupId]: clamped === 0 ? "" : String(clamped) }));
    setTick((x) => x + 1);
  }

  function clearAll() {
    for (const group of groups) {
      upsertTaskState(eventId, eventVersion, group.groupId, (prev) => ({
        progressValue: 0,
        flags: { ...prev.flags, isCompleted: false, isClaimed: false },
      }));
    }
    setInputValues({});
    setTick((x) => x + 1);
  }

  const totals = groups.reduce(
    (acc, group) => {
      const state = progressState.tasks[group.groupId] ?? { progressValue: 0, flags: { isCompleted: false, isClaimed: false } };
      acc.earned += computeEarned(group.tiers, state.progressValue);
      acc.remaining += computeRemaining(group.tiers, state.progressValue);
      return acc;
    },
    { earned: 0, remaining: 0 }
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontWeight: 700 }}>
            {totals.earned} Lures Earned | {totals.remaining} Lures Remaining
          </div>
          <button type="button" className="secondary" onClick={clearAll}>
            Clear
          </button>
        </div>
      </div>

      <div
        ref={props.scrollContainerRef}
        style={{
          flex: 1,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          paddingBottom: 12,
          overscrollBehavior: "contain",
          touchAction: "pan-y",
        }}
      >
        {groups.map((group) => {
          const state = progressState.tasks[group.groupId] ?? {
            progressValue: 0,
            flags: { isCompleted: false, isClaimed: false },
          };
          const maxValue = Math.max(...group.tiers.map((t) => t.requirementTargetValue));
          const earned = computeEarned(group.tiers, state.progressValue);
          const remaining = computeRemaining(group.tiers, state.progressValue);
          const inputValue =
            inputValues[group.groupId] ?? (state.progressValue === 0 ? "" : String(state.progressValue));
          const placeholder = getGroupPlaceholder(
            group.tiers[0]?.requirementAction ?? "",
            group.tiers[0]?.requirementObject ?? ""
          );

          return (
            <div
              key={group.groupId}
              id={`task-${group.groupId}`}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 12,
                background: "var(--surface)",
                scrollMarginTop: 90,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ fontWeight: 800 }}>{group.title}</div>
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  Earned: <b>{earned}</b> | Remaining: <b>{remaining}</b> lures
                </div>
              </div>

              <div style={{ marginTop: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, maxWidth: 260 }}>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={inputValue}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^\d]/g, "");
                      setInputValues((prev) => ({ ...prev, [group.groupId]: raw }));
                      if (raw === "") return;
                      setProgress(group.groupId, Number(raw || 0), maxValue);
                    }}
                    onBlur={() => {
                      const raw = inputValues[group.groupId];
                      if (raw === undefined || raw === "") {
                        upsertTaskState(eventId, eventVersion, group.groupId, (prev) => ({
                          progressValue: 0,
                          flags: { ...prev.flags, isCompleted: false },
                        }));
                        setInputValues((prev) => ({ ...prev, [group.groupId]: "" }));
                        setTick((x) => x + 1);
                        return;
                      }
                      setProgress(group.groupId, Number(raw || 0), maxValue);
                    }}
                    style={{ width: "100%", maxWidth: 200 }}
                    placeholder={placeholder}
                  />
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <button
                      type="button"
                      className="spinner-button"
                      onClick={() => setProgress(group.groupId, state.progressValue + 1, maxValue)}
                      aria-label="Increase"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      className="spinner-button"
                      onClick={() => setProgress(group.groupId, state.progressValue - 1, maxValue)}
                      aria-label="Decrease"
                    >
                      ▼
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
                {group.tiers.map((tier) => {
                  const completed = state.progressValue >= tier.requirementTargetValue;
                  return (
                    <button
                      key={tier.taskId}
                      type="button"
                      onClick={() => {
                        if (state.progressValue === tier.requirementTargetValue) {
                          const prevTier = group.tiers
                            .filter((t) => t.requirementTargetValue < tier.requirementTargetValue)
                            .sort((a, b) => b.requirementTargetValue - a.requirementTargetValue)[0];
                          setProgress(group.groupId, prevTier ? prevTier.requirementTargetValue : 0, maxValue);
                        } else {
                          setProgress(group.groupId, tier.requirementTargetValue, maxValue);
                        }
                      }}
                      style={{
                        border: completed ? "1px solid var(--success)" : "1px solid var(--border)",
                        background: completed ? "var(--success-contrast)" : "var(--surface-2)",
                        color: completed ? "var(--success)" : "var(--text)",
                        padding: "6px 10px",
                        borderRadius: 10,
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      <span>{tier.requirementTargetValue}</span>
                      <span style={{ marginLeft: 4, color: "var(--success)", fontSize: 12 }}>
                        +{tier.rewardAmount}L
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
