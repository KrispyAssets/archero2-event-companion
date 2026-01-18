import { useMemo, useState } from "react";
import type { TaskDefinition } from "../../catalog/types";
import { getEventProgressState, upsertTaskState } from "../../state/userStateStore";

type TaskGroup = {
  groupId: string;
  title: string;
  tiers: TaskDefinition[];
  minDisplayOrder: number;
};

const GROUP_LABELS: Record<string, string> = {
  "buy__silver_tickets__total": "Silver Tickets",
  "buy__pack__total": "Pack",
  "login__days__total": "Daily Login",
  "fight__gold_cave__total": "Gold Cave",
  "kill__minions__total": "Kill Minions",
  "fight__seal_battle__total": "Seal Battle",
  "kill__bosses__total": "Kill Bosses",
  "claim__afk_rewards__total": "Claim AFK Rewards",
  "fight__arena__total": "Arena",
  "use__keys__total": "Use Keys",
  "use__gems__total": "Use Gems",
  "use__shovels__total": "Use Shovels",
};

function formatGroupTitle(action: string, object: string, scope: string): string {
  const key = `${action}__${object}__${scope}`;
  const override = GROUP_LABELS[key];
  if (override) return override;
  const label = `${action} ${object}`.replace(/_/g, " ");
  const scopeLabel = scope.replace(/_/g, " ");
  return `${label} (${scopeLabel})`;
}

function getGroupPlaceholder(action: string, object: string): string {
  if (action === "buy") return "# Bought";
  if (action === "login" && object === "days") return "# Days";
  if (action === "fight") return "# Done";
  if (action === "kill") return "# Killed";
  if (action === "claim") return "# Collected";
  if (action === "use" && object === "gems") return "# Spent";
  if (action === "use") return "# Used";
  return "# Done";
}

function buildGroups(tasks: TaskDefinition[]): TaskGroup[] {
  const map = new Map<string, TaskGroup>();

  for (const task of tasks) {
    const groupKey = `${task.requirementAction}__${task.requirementObject}__${task.requirementScope}`;
    const existing = map.get(groupKey);
    if (!existing) {
      map.set(groupKey, {
        groupId: groupKey,
        title: formatGroupTitle(task.requirementAction, task.requirementObject, task.requirementScope),
        tiers: [task],
        minDisplayOrder: task.displayOrder,
      });
    } else {
      existing.tiers.push(task);
      existing.minDisplayOrder = Math.min(existing.minDisplayOrder, task.displayOrder);
    }
  }

  return Array.from(map.values())
    .map((group) => ({
      ...group,
      tiers: group.tiers.sort((a, b) => a.requirementTargetValue - b.requirementTargetValue),
    }))
    .sort((a, b) => a.minDisplayOrder - b.minDisplayOrder);
}

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

  const groups = useMemo(() => buildGroups(tasks), [tasks]);

  function setProgress(groupId: string, value: number, maxValue: number) {
    const clamped = Math.max(0, Math.min(value, maxValue));
    upsertTaskState(eventId, eventVersion, groupId, (prev) => ({
      progressValue: clamped,
      flags: { ...prev.flags, isCompleted: value >= maxValue },
    }));
    setInputValues((prev) => ({ ...prev, [groupId]: clamped === 0 ? "" : String(clamped) }));
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
                    onClick={() => setProgress(group.groupId, tier.requirementTargetValue, maxValue)}
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
