export type TaskFlags = {
  isCompleted: boolean;
  isClaimed: boolean;
};

export type TaskState = {
  progressValue: number; // 0..target
  flags: TaskFlags;
};

export type EventProgressState = {
  eventId: string;
  eventVersion: number;
  tasks: Record<string, TaskState>; // taskId -> state
  shopQuantities?: Record<string, number>;
};

const STORAGE_KEY = "archero2_event_companion_user_state_v1";

type RootState = {
  schemaVersion: 1;
  events: Record<string, EventProgressState>; // eventKey -> state
};

type ExportPayloadV1 = {
  schemaVersion: 1;
  events: Record<string, EventProgressState>;
  preferences?: Record<string, unknown>;
};

function makeEventKey(eventId: string, eventVersion: number): string {
  return `${eventId}::v${eventVersion}`;
}

function loadRootState(): RootState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { schemaVersion: 1, events: {} };

  try {
    const parsed = JSON.parse(raw) as RootState;
    if (parsed.schemaVersion !== 1) return { schemaVersion: 1, events: {} };
    return parsed;
  } catch {
    return { schemaVersion: 1, events: {} };
  }
}

function saveRootState(state: RootState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("archero2_user_state"));
  }
}

function encodeBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(input: string): string {
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function parseEventKey(key: string): { eventId: string; eventVersion: number } | null {
  const match = key.match(/^(.*)::v(\d+)$/);
  if (!match) return null;
  return { eventId: match[1], eventVersion: Number(match[2]) };
}

function normalizeEventState(key: string, raw: unknown): EventProgressState | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<EventProgressState>;

  const parsedKey = parseEventKey(key);
  const eventId = typeof candidate.eventId === "string" ? candidate.eventId : parsedKey?.eventId;
  const eventVersion =
    typeof candidate.eventVersion === "number" && Number.isFinite(candidate.eventVersion) ? candidate.eventVersion : parsedKey?.eventVersion;

  if (!eventId || typeof eventVersion !== "number") return null;

  const tasks: Record<string, TaskState> = {};
  if (candidate.tasks && typeof candidate.tasks === "object") {
    for (const [taskId, taskRaw] of Object.entries(candidate.tasks)) {
      if (!taskRaw || typeof taskRaw !== "object") continue;
      const task = taskRaw as Partial<TaskState>;
      const progressValue =
        typeof task.progressValue === "number" && Number.isFinite(task.progressValue) ? Math.max(0, task.progressValue) : 0;
      const flagsRaw = task.flags ?? {};
      const flags = {
        isCompleted: Boolean((flagsRaw as TaskFlags).isCompleted),
        isClaimed: Boolean((flagsRaw as TaskFlags).isClaimed),
      };
      tasks[taskId] = { progressValue, flags };
    }
  }

  const shopQuantities: Record<string, number> = {};
  if ((candidate as EventProgressState).shopQuantities && typeof (candidate as EventProgressState).shopQuantities === "object") {
    for (const [shopItemId, qtyRaw] of Object.entries((candidate as EventProgressState).shopQuantities ?? {})) {
      if (typeof qtyRaw !== "number" || !Number.isFinite(qtyRaw)) continue;
      shopQuantities[shopItemId] = Math.max(0, Math.floor(qtyRaw));
    }
  }

  return { eventId, eventVersion, tasks, shopQuantities };
}

export function exportSaveCode(): string {
  const root = loadRootState();
  const payload: ExportPayloadV1 = {
    schemaVersion: 1,
    events: root.events,
    preferences: {},
  };
  const json = JSON.stringify(payload);
  return encodeBase64(json);
}

export function importSaveCode(code: string): { ok: true } | { ok: false; error: string } {
  let decoded = "";
  try {
    decoded = decodeBase64(code.trim());
  } catch {
    return { ok: false, error: "Invalid code (base64 decode failed)." };
  }

  let parsed: ExportPayloadV1;
  try {
    parsed = JSON.parse(decoded) as ExportPayloadV1;
  } catch {
    return { ok: false, error: "Invalid code (JSON parse failed)." };
  }

  if (!parsed || parsed.schemaVersion !== 1) {
    return { ok: false, error: "Unsupported schema version." };
  }

  const nextRoot: RootState = { schemaVersion: 1, events: {} };
  if (parsed.events && typeof parsed.events === "object") {
    for (const [key, value] of Object.entries(parsed.events)) {
      const normalized = normalizeEventState(key, value);
      if (!normalized) continue;
      nextRoot.events[makeEventKey(normalized.eventId, normalized.eventVersion)] = normalized;
    }
  }

  saveRootState(nextRoot);
  return { ok: true };
}

export function getEventProgressState(eventId: string, eventVersion: number): EventProgressState {
  const root = loadRootState();
  const key = makeEventKey(eventId, eventVersion);

  const existing = root.events[key];
  if (existing) return existing;

  const created: EventProgressState = {
    eventId,
    eventVersion,
    tasks: {},
    shopQuantities: {},
  };

  root.events[key] = created;
  saveRootState(root);
  return created;
}

export function upsertTaskState(eventId: string, eventVersion: number, taskId: string, updater: (prev: TaskState) => TaskState): TaskState {
  const root = loadRootState();
  const key = makeEventKey(eventId, eventVersion);

  const ev =
    root.events[key] ??
    ({
      eventId,
      eventVersion,
      tasks: {},
    } as EventProgressState);

  const prev: TaskState = ev.tasks[taskId] ?? { progressValue: 0, flags: { isCompleted: false, isClaimed: false } };

  const next = updater(prev);
  ev.tasks[taskId] = next;
  root.events[key] = ev;

  saveRootState(root);
  return next;
}

export function getEventShopQuantities(eventId: string, eventVersion: number): Record<string, number> {
  const root = loadRootState();
  const key = makeEventKey(eventId, eventVersion);
  return root.events[key]?.shopQuantities ?? {};
}

export function setEventShopQuantity(
  eventId: string,
  eventVersion: number,
  shopItemId: string,
  qty: number
): Record<string, number> {
  const root = loadRootState();
  const key = makeEventKey(eventId, eventVersion);

  const ev =
    root.events[key] ??
    ({
      eventId,
      eventVersion,
      tasks: {},
      shopQuantities: {},
    } as EventProgressState);

  const nextQty = Math.max(0, Math.floor(qty));
  ev.shopQuantities = { ...(ev.shopQuantities ?? {}) };
  if (nextQty === 0) {
    delete ev.shopQuantities[shopItemId];
  } else {
    ev.shopQuantities[shopItemId] = nextQty;
  }
  root.events[key] = ev;
  saveRootState(root);
  return ev.shopQuantities;
}
