import type {
  CatalogIndex,
  EventCatalogItemFull,
  EventCatalogFull,
  DataSection,
  FaqItem,
  GuideContentBlock,
  GuideSection,
  TaskDefinition,
  ToolDefinition,
  ToolFishingCalculator,
  ToolPurchaseGoals,
  ToolPriorityList,
  ToolRef,
  ToolStaticText,
  TaskCostItem,
  RewardAsset,
  SharedItem,
  EventShop,
  EventShopSection,
  EventShopItem,
} from "./types";
import { parseXmlString, getAttr, getAttrInt } from "./parseXml";

async function fetchText(path: string): Promise<string> {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${path}: ${res.status} ${res.statusText}`);
  }
  return await res.text();
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${path}: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

type EventScheduleEntry = {
  eventId: string;
  start: string;
  end: string;
  label?: string;
};

type EventScheduleFile = {
  timeZone?: string;
  events: EventScheduleEntry[];
};

type ScheduleCache = {
  entries: EventScheduleEntry[];
} | null;

let scheduleCache: ScheduleCache = null;

async function loadEventSchedule(): Promise<ScheduleCache> {
  if (scheduleCache) return scheduleCache;
  const path = `${import.meta.env.BASE_URL}catalog/shared/event_schedule.json`;
  try {
    const data = await fetchJson<EventScheduleFile>(path);
    const entries = Array.isArray(data.events) ? data.events : [];
    scheduleCache = { entries };
  } catch {
    scheduleCache = { entries: [] };
  }
  return scheduleCache;
}

function parseUtcDate(dateStr: string): { year: number; month: number; day: number } | null {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || !month || !day) return null;
  return { year, month, day };
}

function formatDateRangeLabel(start: string, end: string): string | undefined {
  const startParts = parseUtcDate(start);
  const endParts = parseUtcDate(end);
  if (!startParts || !endParts) return undefined;
  return `${startParts.month}/${startParts.day} - ${endParts.month}/${endParts.day}`;
}

function getUtcNowMs(): number {
  const now = new Date();
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours(),
    now.getUTCMinutes(),
    now.getUTCSeconds(),
    now.getUTCMilliseconds()
  );
}

function isActiveForUtcRange(start: string, end: string, nowUtcMs: number): boolean | undefined {
  const startParts = parseUtcDate(start);
  const endParts = parseUtcDate(end);
  if (!startParts || !endParts) return undefined;
  const startMs = Date.UTC(startParts.year, startParts.month - 1, startParts.day, 0, 0, 0, 0);
  const endMs = Date.UTC(endParts.year, endParts.month - 1, endParts.day, 23, 59, 59, 999);
  return nowUtcMs >= startMs && nowUtcMs <= endMs;
}

function selectScheduleEntry(entries: EventScheduleEntry[], nowUtcMs: number): EventScheduleEntry | undefined {
  const current: { entry: EventScheduleEntry; endMs: number }[] = [];
  const upcoming: { entry: EventScheduleEntry; startMs: number }[] = [];

  for (const entry of entries) {
    const startParts = parseUtcDate(entry.start);
    const endParts = parseUtcDate(entry.end);
    if (!startParts || !endParts) continue;
    const startMs = Date.UTC(startParts.year, startParts.month - 1, startParts.day, 0, 0, 0, 0);
    const endMs = Date.UTC(endParts.year, endParts.month - 1, endParts.day, 23, 59, 59, 999);
    if (nowUtcMs >= startMs && nowUtcMs <= endMs) {
      current.push({ entry, endMs });
    } else if (nowUtcMs < startMs) {
      upcoming.push({ entry, startMs });
    }
  }

  if (current.length) {
    current.sort((a, b) => a.endMs - b.endMs);
    return current[0].entry;
  }
  if (upcoming.length) {
    upcoming.sort((a, b) => a.startMs - b.startMs);
    return upcoming[0].entry;
  }
  return undefined;
}

function applyScheduleToEvent<T extends EventCatalogItemFull>(event: T, schedule?: EventScheduleEntry): T {
  const label = schedule ? schedule.label ?? formatDateRangeLabel(schedule.start, schedule.end) : undefined;
  const nowUtcMs = getUtcNowMs();
  const isActive = schedule ? isActiveForUtcRange(schedule.start, schedule.end, nowUtcMs) : undefined;
  return {
    ...event,
    scheduleStart: schedule?.start,
    scheduleEnd: schedule?.end,
    dateRangeLabel: label,
    isActive: isActive ?? event.isActive,
  };
}

function getDirectChildElements(el: Element, tagName: string): Element[] {
  return Array.from(el.childNodes)
    .filter((node) => node.nodeType === 1)
    .map((node) => node as Element)
    .filter((child) => child.tagName === tagName);
}

function collectParagraphText(el: Element): string {
  const paragraphs = getDirectChildElements(el, "p").map((p) => p.textContent?.trim() ?? "").filter((p) => p.length > 0);
  if (paragraphs.length > 0) return paragraphs.join("\n\n");
  const directText = Array.from(el.childNodes)
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent?.trim() ?? "")
    .filter((text) => text.length > 0);
  return directText.join("\n\n");
}

function parseContentBlocks(containerEl: Element): { blocks: GuideContentBlock[]; text: string } {
  const blocks: GuideContentBlock[] = [];
  const paragraphs: string[] = [];

  for (const node of Array.from(containerEl.childNodes)) {
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    if (el.tagName === "section") continue;
    if (el.tagName === "p") {
      const text = (el.textContent ?? "").trim();
      if (text) {
        blocks.push({ type: "paragraph", text });
        paragraphs.push(text);
      }
      continue;
    }
    if (el.tagName === "image") {
      const src = getAttr(el, "src");
      const alt = el.getAttribute("alt") ?? undefined;
      const caption = el.getAttribute("caption") ?? undefined;
      blocks.push({ type: "image", src, alt, caption });
      continue;
    }
    if (el.tagName === "image_row") {
      const imageEls = getDirectChildElements(el, "image");
      const images = imageEls.map((imageEl) => ({
        src: getAttr(imageEl, "src"),
        alt: imageEl.getAttribute("alt") ?? undefined,
        caption: imageEl.getAttribute("caption") ?? undefined,
      }));
      blocks.push({ type: "image_row", images });
      continue;
    }
  }

  if (blocks.length === 0) {
    const text = collectParagraphText(containerEl);
    if (text) {
      blocks.push({ type: "paragraph", text });
      paragraphs.push(text);
    }
  }

  return { blocks, text: paragraphs.join("\n\n") };
}

function parseGuideSection(sectionEl: Element): GuideSection {
  const subsections = getDirectChildElements(sectionEl, "section").map((child) => parseGuideSection(child));
  const { blocks, text } = parseContentBlocks(sectionEl);
  const body = text;
  return {
    sectionId: getAttr(sectionEl, "section_id"),
    title: getAttr(sectionEl, "title"),
    body,
    blocks,
    subsections: subsections.length > 0 ? subsections : undefined,
  };
}

function parseFaqItem(itemEl: Element): FaqItem {
  const tagsAttr = itemEl.getAttribute("tags");
  const tags = tagsAttr ? tagsAttr.split(",").map((t) => t.trim()).filter((t) => t.length > 0) : undefined;
  const answerEl = itemEl.getElementsByTagName("answer")[0];
  const answerBlocks = answerEl ? parseContentBlocks(answerEl) : null;
  const answer = answerBlocks ? answerBlocks.text : "";

  return {
    faqId: getAttr(itemEl, "faq_id"),
    question: getAttr(itemEl, "question"),
    answer,
    answerBlocks: answerBlocks?.blocks ?? undefined,
    tags,
  };
}

function parseToolDefinition(doc: Document): ToolDefinition | null {
  const toolEl = doc.getElementsByTagName("tool")[0];
  if (!toolEl) return null;

  const toolId = getAttr(toolEl, "tool_id");
  const toolType = getAttr(toolEl, "tool_type");
  const title = getAttr(toolEl, "title");
  const descriptionEl = toolEl.getElementsByTagName("description")[0];
  const description = descriptionEl ? collectParagraphText(descriptionEl) : undefined;
  const stateKey = toolEl.getAttribute("state_key") ?? undefined;

  if (toolType === "priority_list") {
    const itemsEl = toolEl.getElementsByTagName("items")[0];
    const itemEls = itemsEl ? getDirectChildElements(itemsEl, "item") : [];
    const items = itemEls.map((item) => ({
      label: getAttr(item, "label"),
      note: item.getAttribute("note") ?? undefined,
    }));

    const tool: ToolPriorityList = {
      toolId,
      toolType: "priority_list",
      title,
      description,
      stateKey,
      items,
    };

    return tool;
  }

  if (toolType === "static_text") {
    const bodyEl = toolEl.getElementsByTagName("body")[0];
    const body = bodyEl ? collectParagraphText(bodyEl) : "";
    const tool: ToolStaticText = {
      toolId,
      toolType: "static_text",
      title,
      description,
      stateKey,
      body,
    };
    return tool;
  }

  if (toolType === "fishing_calculator") {
    const dataRefEl = toolEl.getElementsByTagName("data_ref")[0];
    const settingsEl = toolEl.getElementsByTagName("settings")[0];
    const tool: ToolFishingCalculator = {
      toolId,
      toolType: "fishing_calculator",
      title,
      description,
      stateKey,
      dataPath: dataRefEl ? getAttr(dataRefEl, "path") : "",
      defaultSetId: settingsEl?.getAttribute("default_set_id") ?? undefined,
    };
    return tool;
  }

  if (toolType === "purchase_goals") {
    const dataRefEl = toolEl.getElementsByTagName("data_ref")[0];
    const settingsEl = toolEl.getElementsByTagName("settings")[0];
    const tool: ToolPurchaseGoals = {
      toolId,
      toolType: "purchase_goals",
      title,
      description,
      stateKey,
      dataPath: dataRefEl ? getAttr(dataRefEl, "path") : "",
      defaultSetId: settingsEl?.getAttribute("default_set_id") ?? undefined,
    };
    return tool;
  }

  return {
    toolId,
    toolType,
    title,
    description,
    stateKey,
  };
}

const COST_LABELS: Record<string, string> = {
  gems: "Gems",
  chromatic_keys: "Chromatic Keys",
  obsidian_keys: "Obsidian Keys",
  wish_tokens: "Wish Tokens",
  shovels: "Shovels",
};
const COST_ORDER = ["gems", "chromatic_keys", "obsidian_keys", "wish_tokens", "shovels"];
const COST_ACTIONS = new Set(["use", "buy", "spend"]);

function formatLabel(value: string): string {
  return value
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function computeTaskCosts(tasks: TaskDefinition[]): TaskCostItem[] {
  const totals = new Map<string, number>();
  for (const task of tasks) {
    if (!COST_ACTIONS.has(task.requirementAction)) continue;
    if (task.requirementScope !== "total") continue;
    const key = task.requirementObject;
    if (!COST_LABELS[key]) continue;
    const current = totals.get(key) ?? 0;
    if (task.requirementTargetValue > current) {
      totals.set(key, task.requirementTargetValue);
    }
  }

  const orderedKeys = [...COST_ORDER.filter((key) => totals.has(key))];
  const extraKeys = [...totals.keys()].filter((key) => !COST_ORDER.includes(key)).sort();
  return [...orderedKeys, ...extraKeys].map((key) => ({
    key,
    label: COST_LABELS[key] ?? formatLabel(key),
    amount: totals.get(key) ?? 0,
  }));
}

function parseTaskDefinition(el: Element): TaskDefinition {
  return {
    taskId: getAttr(el, "task_id"),
    displayOrder: getAttrInt(el, "display_order"),

    requirementAction: getAttr(el, "requirement_action"),
    requirementObject: getAttr(el, "requirement_object"),
    requirementScope: getAttr(el, "requirement_scope"),
    requirementTargetValue: getAttrInt(el, "requirement_target_value"),

    rewardType: getAttr(el, "reward_type"),
    rewardAmount: getAttrInt(el, "reward_amount"),
  };
}

function parseTaskGroupLabels(eventEl: Element): Record<string, string> | undefined {
  const labelsEl = eventEl.getElementsByTagName("task_group_labels")[0];
  if (!labelsEl) return undefined;
  const labelEls = getDirectChildElements(labelsEl, "label");
  const labels: Record<string, string> = {};
  for (const labelEl of labelEls) {
    const key = getAttr(labelEl, "group_key");
    const title = getAttr(labelEl, "title");
    labels[key] = title;
  }
  return Object.keys(labels).length > 0 ? labels : undefined;
}

function parseRewardAssets(eventEl: Element): Record<string, RewardAsset> | undefined {
  const assetsEl = eventEl.getElementsByTagName("reward_assets")[0];
  if (!assetsEl) return undefined;
  const rewardEls = getDirectChildElements(assetsEl, "reward");
  const assets: Record<string, RewardAsset> = {};
  for (const rewardEl of rewardEls) {
    const key = getAttr(rewardEl, "key");
    const label = getAttr(rewardEl, "label");
    const icon = rewardEl.getAttribute("icon") ?? undefined;
    assets[key] = { label, icon };
  }
  return Object.keys(assets).length > 0 ? assets : undefined;
}

function parseShop(eventEl: Element): EventShop | undefined {
  const shopEl = eventEl.getElementsByTagName("shop")[0];
  if (!shopEl) return undefined;
  const sectionEls = getDirectChildElements(shopEl, "section");
  const sections: EventShopSection[] = sectionEls.map((sectionEl) => {
    const itemEls = getDirectChildElements(sectionEl, "item");
    const items: EventShopItem[] = itemEls.map((itemEl, index) => ({
      shopItemId: itemEl.getAttribute("shop_item_id") ?? `${getAttr(itemEl, "item_id")}_${index + 1}`,
      itemId: itemEl.getAttribute("item_id") ?? undefined,
      label: itemEl.getAttribute("label") ?? getAttr(itemEl, "item_id"),
      description: itemEl.getAttribute("description") ?? undefined,
      cost: getAttrInt(itemEl, "cost"),
      costItemId: getAttr(itemEl, "cost_item"),
      bundleSize: itemEl.getAttribute("bundle") ? getAttrInt(itemEl, "bundle") : undefined,
      maxQty: itemEl.getAttribute("max_qty") ? getAttrInt(itemEl, "max_qty") : undefined,
      goalGroup: (itemEl.getAttribute("goal_group") as "silver" | "gold" | null) ?? undefined,
      goalKey: itemEl.getAttribute("goal_key") ?? undefined,
    }));
    return {
      sectionId: getAttr(sectionEl, "section_id"),
      title: sectionEl.getAttribute("title") ?? undefined,
      items,
    };
  });
  if (!sections.length) return undefined;
  return { sections };
}

function parseEventDocument(doc: Document, relPath?: string): EventCatalogFull {
  const eventEl = doc.getElementsByTagName("event")[0];
  if (!eventEl) {
    throw new Error(`Missing <event> root${relPath ? ` in ${relPath}` : ""}`);
  }

  const tasksEl = eventEl.getElementsByTagName("tasks")[0];
  const guideEl = eventEl.getElementsByTagName("guide")[0];
  const dataEl = eventEl.getElementsByTagName("data")[0];
  const faqEl = eventEl.getElementsByTagName("faq")[0];
  const toolsEl = eventEl.getElementsByTagName("tools")[0];
  const guidedRouteRefEl = eventEl.getElementsByTagName("guided_route_ref")[0];

  const taskNodes = tasksEl ? Array.from(tasksEl.getElementsByTagName("task")) : [];
  const tasks: TaskDefinition[] = taskNodes.map((t) => parseTaskDefinition(t)).sort((a, b) => a.displayOrder - b.displayOrder);
  const taskCosts = computeTaskCosts(tasks);
  const taskGroupLabels = parseTaskGroupLabels(eventEl);
  const rewardAssets = parseRewardAssets(eventEl);
  const shop = parseShop(eventEl);

  const guideSections = guideEl ? getDirectChildElements(guideEl, "section").map((section) => parseGuideSection(section)) : [];
  const dataSections: DataSection[] = dataEl ? getDirectChildElements(dataEl, "section").map((section) => parseGuideSection(section)) : [];
  const faqItems = faqEl ? getDirectChildElements(faqEl, "item").map((item) => parseFaqItem(item)) : [];
  const toolRefs: ToolRef[] = toolsEl
    ? getDirectChildElements(toolsEl, "tool_ref").map((toolRef) => ({
        toolId: getAttr(toolRef, "tool_id"),
      }))
    : [];

  const guideSectionCount = guideEl ? getDirectChildElements(guideEl, "section").length : 0;
  const dataSectionCount = dataEl ? getDirectChildElements(dataEl, "section").length : 0;
  const faqCount = faqEl ? faqEl.getElementsByTagName("item").length : 0;
  const toolCount = toolRefs.length;

  return {
    eventId: getAttr(eventEl, "event_id"),
    eventVersion: getAttrInt(eventEl, "event_version"),
    title: getAttr(eventEl, "title"),
    subtitle: eventEl.getAttribute("subtitle") ?? undefined,
    lastVerifiedDate: eventEl.getAttribute("last_verified_date") ?? undefined,
    isActive: eventEl.getAttribute("active") === "true" ? true : undefined,
    status: eventEl.getAttribute("status") ?? undefined,
    tier: (eventEl.getAttribute("tier") as "primary" | "secondary" | null) ?? undefined,
    guidedRoutePath: guidedRouteRefEl ? getAttr(guidedRouteRefEl, "path") : undefined,
    taskGroupLabels,
    rewardAssets,
    sections: {
      taskCount: tasks.length,
      guideSectionCount,
      dataSectionCount,
      faqCount,
      toolCount,
    },
    taskCosts,
    tasks,
    guideSections,
    dataSections,
    faqItems,
    toolRefs,
    shop,
  };
}

export async function loadCatalogIndex(): Promise<CatalogIndex> {
  const indexPath = `${import.meta.env.BASE_URL}catalog/catalog_index.xml`;
  const xmlText = await fetchText(indexPath);
  const doc = parseXmlString(xmlText);

  const root = doc.documentElement;
  const schemaVersion = Number(root.getAttribute("catalog_schema_version") ?? "1");

  const eventPaths = Array.from(doc.getElementsByTagName("event_ref")).map((el) => getAttr(el, "path"));

  const toolPaths = Array.from(doc.getElementsByTagName("tool_ref")).map((el) => getAttr(el, "path"));

  const progressionModelPaths = Array.from(doc.getElementsByTagName("progression_model_ref")).map((el) => getAttr(el, "path"));

  const sharedPaths = Array.from(doc.getElementsByTagName("shared_ref")).map((el) => getAttr(el, "path"));

  return {
    catalogSchemaVersion: schemaVersion,
    eventPaths,
    toolPaths,
    progressionModelPaths,
    sharedPaths,
  };
}

export async function loadSharedItems(sharedPaths: string[]): Promise<Record<string, SharedItem>> {
  const items: Record<string, SharedItem> = {};

  for (const relPath of sharedPaths) {
    const fullPath = `${import.meta.env.BASE_URL}${relPath}`;
    const xmlText = await fetchText(fullPath);
    const doc = parseXmlString(xmlText);
    const root = doc.documentElement;
    if (root.tagName !== "items") continue;

    const itemEls = Array.from(root.getElementsByTagName("item"));
    for (const itemEl of itemEls) {
      const itemId = getAttr(itemEl, "item_id");
      const label = getAttr(itemEl, "label");
      const icon = itemEl.getAttribute("icon") ?? undefined;
      const aliasesAttr = itemEl.getAttribute("aliases");
      const fallbackLabel = itemEl.getAttribute("fallback_label") ?? undefined;
      const shortLabel = itemEl.getAttribute("short_label") ?? undefined;
      const link = itemEl.getAttribute("link") ?? undefined;
      const linkEnabledAttr = itemEl.getAttribute("link_enabled");
      const linkEnabled = linkEnabledAttr === null ? undefined : linkEnabledAttr !== "false";
      const aliases = aliasesAttr
        ? aliasesAttr
            .split(",")
            .map((alias) => alias.trim())
            .filter((alias) => alias.length > 0)
        : undefined;

      const item: SharedItem = { itemId, label, icon, fallbackLabel, shortLabel, aliases, link, linkEnabled };
      items[itemId] = item;
      if (aliases) {
        for (const alias of aliases) {
          if (!items[alias]) items[alias] = item;
        }
      }
    }
  }

  return items;
}

export async function loadEventSummaries(eventPaths: string[]): Promise<EventCatalogItemFull[]> {
  const events: EventCatalogItemFull[] = [];
  const schedule = await loadEventSchedule();
  const scheduleEntries = schedule?.entries ?? [];
  const scheduleByEvent = new Map<string, EventScheduleEntry[]>();
  for (const entry of scheduleEntries) {
    const list = scheduleByEvent.get(entry.eventId) ?? [];
    list.push(entry);
    scheduleByEvent.set(entry.eventId, list);
  }
  const nowUtcMs = getUtcNowMs();

  for (const relPath of eventPaths) {
    const fullPath = `${import.meta.env.BASE_URL}${relPath}`;
    const xmlText = await fetchText(fullPath);
    const doc = parseXmlString(xmlText);

    const eventEl = doc.getElementsByTagName("event")[0];
    if (!eventEl) throw new Error(`Missing <event> root in ${relPath}`);

    const tasksEl = eventEl.getElementsByTagName("tasks")[0];
    const guideEl = eventEl.getElementsByTagName("guide")[0];
    const dataEl = eventEl.getElementsByTagName("data")[0];
    const faqEl = eventEl.getElementsByTagName("faq")[0];
    const toolsEl = eventEl.getElementsByTagName("tools")[0];

    const taskNodes = tasksEl ? Array.from(tasksEl.getElementsByTagName("task")) : [];
    const taskCount = taskNodes.length;
    const taskCosts = taskNodes.length
      ? computeTaskCosts(taskNodes.map((node) => parseTaskDefinition(node)))
      : [];
    const guideSectionCount = guideEl ? getDirectChildElements(guideEl, "section").length : 0;
    const dataSectionCount = dataEl ? getDirectChildElements(dataEl, "section").length : 0;
    const faqCount = faqEl ? faqEl.getElementsByTagName("item").length : 0;
    const toolCount = toolsEl ? toolsEl.getElementsByTagName("tool_ref").length : 0;

    const summary: EventCatalogItemFull = {
      eventId: getAttr(eventEl, "event_id"),
      eventVersion: getAttrInt(eventEl, "event_version"),
      title: getAttr(eventEl, "title"),
      subtitle: eventEl.getAttribute("subtitle") ?? undefined,
      lastVerifiedDate: eventEl.getAttribute("last_verified_date") ?? undefined,
      isActive: eventEl.getAttribute("active") === "true" ? true : undefined,
      status: eventEl.getAttribute("status") ?? undefined,
      tier: (eventEl.getAttribute("tier") as "primary" | "secondary" | null) ?? undefined,
      sections: { taskCount, guideSectionCount, dataSectionCount, faqCount, toolCount },
      taskCosts,
    };
    const scheduleEntriesForEvent = scheduleByEvent.get(summary.eventId) ?? [];
    const selected = selectScheduleEntry(scheduleEntriesForEvent, nowUtcMs);
    events.push(applyScheduleToEvent(summary, selected));
  }

  return events;
}

export async function loadEventById(eventPaths: string[], eventId: string): Promise<EventCatalogFull | null> {
  const schedule = await loadEventSchedule();
  const scheduleEntries = schedule?.entries ?? [];
  const scheduleByEvent = new Map<string, EventScheduleEntry[]>();
  for (const entry of scheduleEntries) {
    const list = scheduleByEvent.get(entry.eventId) ?? [];
    list.push(entry);
    scheduleByEvent.set(entry.eventId, list);
  }
  const nowUtcMs = getUtcNowMs();
  for (const relPath of eventPaths) {
    const fullPath = `${import.meta.env.BASE_URL}${relPath}`;
    const xmlText = await fetchText(fullPath);
    const doc = parseXmlString(xmlText);

    const eventEl = doc.getElementsByTagName("event")[0];
    if (!eventEl) continue;

    const thisId = eventEl.getAttribute("event_id");
    if (thisId !== eventId) continue;

    const full = parseEventDocument(doc, relPath);
    const scheduleEntriesForEvent = scheduleByEvent.get(full.eventId) ?? [];
    const selected = selectScheduleEntry(scheduleEntriesForEvent, nowUtcMs);
    return applyScheduleToEvent(full, selected);
  }

  return null;
}

export async function loadAllEventsFull(eventPaths: string[]): Promise<EventCatalogFull[]> {
  const events: EventCatalogFull[] = [];
  const schedule = await loadEventSchedule();
  const scheduleEntries = schedule?.entries ?? [];
  const scheduleByEvent = new Map<string, EventScheduleEntry[]>();
  for (const entry of scheduleEntries) {
    const list = scheduleByEvent.get(entry.eventId) ?? [];
    list.push(entry);
    scheduleByEvent.set(entry.eventId, list);
  }
  const nowUtcMs = getUtcNowMs();
  for (const relPath of eventPaths) {
    const fullPath = `${import.meta.env.BASE_URL}${relPath}`;
    const xmlText = await fetchText(fullPath);
    const doc = parseXmlString(xmlText);
    const full = parseEventDocument(doc, relPath);
    const scheduleEntriesForEvent = scheduleByEvent.get(full.eventId) ?? [];
    const selected = selectScheduleEntry(scheduleEntriesForEvent, nowUtcMs);
    events.push(applyScheduleToEvent(full, selected));
  }
  return events;
}

export async function loadToolsByIds(toolPaths: string[], toolIds: string[]): Promise<ToolDefinition[]> {
  if (!toolIds.length) return [];
  const wanted = new Set(toolIds);
  const tools: ToolDefinition[] = [];

  for (const relPath of toolPaths) {
    if (!wanted.size) break;
    const fullPath = `${import.meta.env.BASE_URL}${relPath}`;
    const xmlText = await fetchText(fullPath);
    const doc = parseXmlString(xmlText);
    const tool = parseToolDefinition(doc);
    if (!tool) continue;
    if (!wanted.has(tool.toolId)) continue;
    tools.push(tool);
    wanted.delete(tool.toolId);
  }

  return tools;
}
