import type {
  CatalogIndex,
  EventCatalogItemFull,
  EventCatalogFull,
  FaqItem,
  GuideSection,
  TaskDefinition,
  ToolDefinition,
  ToolPriorityList,
  ToolRef,
  ToolStaticText,
} from "./types";
import { parseXmlString, getAttr, getAttrInt } from "./parseXml";

async function fetchText(path: string): Promise<string> {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${path}: ${res.status} ${res.statusText}`);
  }
  return await res.text();
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

function parseGuideSection(sectionEl: Element): GuideSection {
  const subsections = getDirectChildElements(sectionEl, "section").map((child) => parseGuideSection(child));
  const body = collectParagraphText(sectionEl);
  return {
    sectionId: getAttr(sectionEl, "section_id"),
    title: getAttr(sectionEl, "title"),
    body,
    subsections: subsections.length > 0 ? subsections : undefined,
  };
}

function parseFaqItem(itemEl: Element): FaqItem {
  const tagsAttr = itemEl.getAttribute("tags");
  const tags = tagsAttr ? tagsAttr.split(",").map((t) => t.trim()).filter((t) => t.length > 0) : undefined;
  const answerEl = itemEl.getElementsByTagName("answer")[0];
  const answer = answerEl ? collectParagraphText(answerEl) : "";

  return {
    faqId: getAttr(itemEl, "faq_id"),
    question: getAttr(itemEl, "question"),
    answer,
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
      body,
    };
    return tool;
  }

  return {
    toolId,
    toolType,
    title,
    description,
  };
}

function parseEventDocument(doc: Document, relPath?: string): EventCatalogFull {
  const eventEl = doc.getElementsByTagName("event")[0];
  if (!eventEl) {
    throw new Error(`Missing <event> root${relPath ? ` in ${relPath}` : ""}`);
  }

  const tasksEl = eventEl.getElementsByTagName("tasks")[0];
  const guideEl = eventEl.getElementsByTagName("guide")[0];
  const faqEl = eventEl.getElementsByTagName("faq")[0];
  const toolsEl = eventEl.getElementsByTagName("tools")[0];

  const taskNodes = tasksEl ? Array.from(tasksEl.getElementsByTagName("task")) : [];
  const tasks: TaskDefinition[] = taskNodes
    .map((t) => ({
      taskId: getAttr(t, "task_id"),
      displayOrder: getAttrInt(t, "display_order"),

      requirementAction: getAttr(t, "requirement_action"),
      requirementObject: getAttr(t, "requirement_object"),
      requirementScope: getAttr(t, "requirement_scope"),
      requirementTargetValue: getAttrInt(t, "requirement_target_value"),

      rewardType: getAttr(t, "reward_type"),
      rewardAmount: getAttrInt(t, "reward_amount"),
    }))
    .sort((a, b) => a.displayOrder - b.displayOrder);

  const guideSections = guideEl ? getDirectChildElements(guideEl, "section").map((section) => parseGuideSection(section)) : [];
  const faqItems = faqEl ? getDirectChildElements(faqEl, "item").map((item) => parseFaqItem(item)) : [];
  const toolRefs: ToolRef[] = toolsEl
    ? getDirectChildElements(toolsEl, "tool_ref").map((toolRef) => ({
        toolId: getAttr(toolRef, "tool_id"),
      }))
    : [];

  const guideSectionCount = guideEl ? guideEl.getElementsByTagName("section").length : 0;
  const faqCount = faqEl ? faqEl.getElementsByTagName("item").length : 0;
  const toolCount = toolRefs.length;

  return {
    eventId: getAttr(eventEl, "event_id"),
    eventVersion: getAttrInt(eventEl, "event_version"),
    title: getAttr(eventEl, "title"),
    subtitle: eventEl.getAttribute("subtitle") ?? undefined,
    lastVerifiedDate: eventEl.getAttribute("last_verified_date") ?? undefined,
    sections: {
      taskCount: tasks.length,
      guideSectionCount,
      faqCount,
      toolCount,
    },
    tasks,
    guideSections,
    faqItems,
    toolRefs,
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

export async function loadEventSummaries(eventPaths: string[]): Promise<EventCatalogItemFull[]> {
  const events: EventCatalogItemFull[] = [];

  for (const relPath of eventPaths) {
    const fullPath = `${import.meta.env.BASE_URL}${relPath}`;
    const xmlText = await fetchText(fullPath);
    const doc = parseXmlString(xmlText);

    const eventEl = doc.getElementsByTagName("event")[0];
    if (!eventEl) throw new Error(`Missing <event> root in ${relPath}`);

    const tasksEl = eventEl.getElementsByTagName("tasks")[0];
    const guideEl = eventEl.getElementsByTagName("guide")[0];
    const faqEl = eventEl.getElementsByTagName("faq")[0];
    const toolsEl = eventEl.getElementsByTagName("tools")[0];

    const taskCount = tasksEl ? tasksEl.getElementsByTagName("task").length : 0;
    const guideSectionCount = guideEl ? guideEl.getElementsByTagName("section").length : 0;
    const faqCount = faqEl ? faqEl.getElementsByTagName("item").length : 0;
    const toolCount = toolsEl ? toolsEl.getElementsByTagName("tool_ref").length : 0;

    events.push({
      eventId: getAttr(eventEl, "event_id"),
      eventVersion: getAttrInt(eventEl, "event_version"),
      title: getAttr(eventEl, "title"),
      subtitle: eventEl.getAttribute("subtitle") ?? undefined,
      lastVerifiedDate: eventEl.getAttribute("last_verified_date") ?? undefined,
      sections: { taskCount, guideSectionCount, faqCount, toolCount },
    });
  }

  return events;
}

export async function loadEventById(eventPaths: string[], eventId: string): Promise<EventCatalogFull | null> {
  for (const relPath of eventPaths) {
    const fullPath = `${import.meta.env.BASE_URL}${relPath}`;
    const xmlText = await fetchText(fullPath);
    const doc = parseXmlString(xmlText);

    const eventEl = doc.getElementsByTagName("event")[0];
    if (!eventEl) continue;

    const thisId = eventEl.getAttribute("event_id");
    if (thisId !== eventId) continue;

    return parseEventDocument(doc, relPath);
  }

  return null;
}

export async function loadAllEventsFull(eventPaths: string[]): Promise<EventCatalogFull[]> {
  const events: EventCatalogFull[] = [];
  for (const relPath of eventPaths) {
    const fullPath = `${import.meta.env.BASE_URL}${relPath}`;
    const xmlText = await fetchText(fullPath);
    const doc = parseXmlString(xmlText);
    events.push(parseEventDocument(doc, relPath));
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
