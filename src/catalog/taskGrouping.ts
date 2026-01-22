import type { TaskDefinition } from "./types";

export type TaskGroup = {
  groupId: string;
  title: string;
  tiers: TaskDefinition[];
  minDisplayOrder: number;
};

const GROUP_LABELS: Record<string, string> = {
  "buy__silver_tickets__total": "Buy Silver Tickets",
  "buy__pack__total": "Buy Free Pack",
  "login__days__total": "Login",
  "fight__gold_cave__total": "Gold Cave",
  "kill__minions__total": "Kill Minions",
  "fight__seal_battle__total": "Seal Battle",
  "kill__bosses__total": "Kill Bosses",
  "claim__afk_rewards__total": "Claim AFK Rewards",
  "fight__arena__total": "Arena",
  "use__chromatic_keys__total": "Use Chromatic Keys",
  "use__obsidian_keys__total": "Use Obsidian Keys",
  "use__wish_tokens__total": "Use Wishes",
  "use__dice__total": "Roll Dice",
  "use__gems__total": "Use Gems",
  "use__shovels__total": "Use Shovels",
};

export function getGroupKey(action: string, object: string, scope: string): string {
  return `${action}__${object}__${scope}`;
}

export function getGroupTitle(action: string, object: string, scope: string): string {
  const key = getGroupKey(action, object, scope);
  const override = GROUP_LABELS[key];
  if (override) return override;
  const label = `${action} ${object}`.replace(/_/g, " ");
  const scopeLabel = scope.replace(/_/g, " ");
  return `${label} (${scopeLabel})`;
}

export function buildTaskGroups(tasks: TaskDefinition[]): TaskGroup[] {
  const map = new Map<string, TaskGroup>();

  for (const task of tasks) {
    const groupKey = getGroupKey(task.requirementAction, task.requirementObject, task.requirementScope);
    const existing = map.get(groupKey);
    if (!existing) {
      map.set(groupKey, {
        groupId: groupKey,
        title: getGroupTitle(task.requirementAction, task.requirementObject, task.requirementScope),
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

export function getGroupPlaceholder(action: string, object: string): string {
  if (action === "buy") return "# Bought";
  if (action === "login" && object === "days") return "# Days";
  if (action === "fight") return "# Done";
  if (action === "kill") return "# Killed";
  if (action === "claim") return "# Collected";
  if (action === "use" && object === "gems") return "# Spent";
  if (action === "use") return "# Used";
  return "# Done";
}

export function computeEarned(tiers: TaskDefinition[], progressValue: number): number {
  return tiers.reduce((sum, tier) => (progressValue >= tier.requirementTargetValue ? sum + tier.rewardAmount : sum), 0);
}

export function computeRemaining(tiers: TaskDefinition[], progressValue: number): number {
  return tiers.reduce((sum, tier) => (progressValue < tier.requirementTargetValue ? sum + tier.rewardAmount : sum), 0);
}
