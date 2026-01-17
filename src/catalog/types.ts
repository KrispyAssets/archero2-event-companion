export type CatalogIndex = {
  catalogSchemaVersion: number;
  eventPaths: string[];
  toolPaths: string[];
  progressionModelPaths: string[];
  sharedPaths: string[];
};

export type EventSectionSummary = {
  taskCount: number;
  guideSectionCount: number;
  faqCount: number;
  toolCount: number;
};

export type TaskDefinition = {
  taskId: string;
  displayOrder: number;

  requirementAction: string;
  requirementObject: string;
  requirementScope: string;
  requirementTargetValue: number;

  rewardType: string;
  rewardAmount: number;
};

export type GuideSection = {
  sectionId: string;
  title: string;
  body: string;
  subsections?: GuideSection[];
};

export type FaqItem = {
  faqId: string;
  question: string;
  answer: string;
  tags?: string[];
};

export type ToolRef = {
  toolId: string;
};

export type ToolDefinitionBase = {
  toolId: string;
  toolType: string;
  title: string;
  description?: string;
};

export type ToolPriorityListItem = {
  label: string;
  note?: string;
};

export type ToolPriorityList = ToolDefinitionBase & {
  toolType: "priority_list";
  items: ToolPriorityListItem[];
};

export type ToolDefinition = ToolPriorityList | ToolDefinitionBase;

/** Summary (used for Events list) */
export type EventCatalogItemFull = {
  eventId: string;
  eventVersion: number;
  title: string;
  subtitle?: string;
  lastVerifiedDate?: string;
  sections: EventSectionSummary;
};

/** Full (used for Event Detail) */
export type EventCatalogFull = EventCatalogItemFull & {
  tasks: TaskDefinition[];
  guideSections: GuideSection[];
  faqItems: FaqItem[];
  toolRefs: ToolRef[];
};
