import { useMemo, useState } from "react";
import type { TaskDefinition } from "../../catalog/types";
import { buildTaskGroups, getGroupPlaceholder } from "../../catalog/taskGrouping";
import { getEventProgressState, upsertTaskState } from "../../state/userStateStore";

function computeEarned(tiers: TaskDefinition[], progressValue: number): number {
  return tiers.reduce((sum, tier) => (progressValue >= tier.requirementTargetValue ? sum + tier.rewardAmount : sum), 0);
}

function computeRemaining(tiers: TaskDefinition[], progressValue: number): number {
  return tiers.reduce((sum, tier) => (progressValue < tier.requirementTargetValue ? sum + tier.rewardAmount : sum), 0);
}

export default function TasksTracker(props: { eventId: string; eventVersion: number; tasks: TaskDefinition[] }) {
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
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700 }}>
          {totals.earned} lures earned | {totals.remaining} lures remaining
        </div>
        <button type="button" onClick={clearAll}>
          Clear
        </button>
      </div>

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
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              padding: 12,
              background: "#fff",
              scrollMarginTop: 90,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 800 }}>{group.title}</div>
              <div style={{ fontSize: 13, color: "#374151" }}>
                Earned: <b>{earned}</b> | Remaining: <b>{remaining}</b> lures
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={maxValue}
                value={inputValue}
                onChange={(e) => {
                  const raw = e.target.value;
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
                style={{ width: "100%", maxWidth: 220 }}
                placeholder={placeholder}
              />
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
                      border: completed ? "1px solid #059669" : "1px solid #e5e7eb",
                      background: completed ? "#ecfdf5" : "#fff",
                      color: completed ? "#065f46" : "#111827",
                      padding: "6px 10px",
                      borderRadius: 10,
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    <span>{tier.requirementTargetValue}</span>
                    <span style={{ marginLeft: 4, color: "#059669", fontSize: 12 }}>+{tier.rewardAmount}L</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
