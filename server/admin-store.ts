import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { isRecord, type CalendarEvent } from '../shared/calendar';
import { isAdminState, type AdminAction, type AdminState, type EventOverride } from '../shared/admin';

const storeUrl = new URL('../data/admin.json', import.meta.url);
let writes: Promise<void> = Promise.resolve();

export const readAdminState = async (): Promise<AdminState> => {
  try {
    const value: unknown = JSON.parse(await readFile(storeUrl, 'utf8'));
    if (!isAdminState(value)) throw new Error('Invalid admin store');
    return value;
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return { reviews: {}, overrides: {} };
    console.error('Admin store read failed', error);
    throw new Error('관리 데이터 파일을 읽지 못했습니다.');
  }
};

export const applyAdminAction = (state: AdminState, action: AdminAction): AdminState => {
  const next: AdminState = { reviews: { ...state.reviews }, overrides: { ...state.overrides } };
  if (action.action === 'review') {
    if (action.status === 'pending') delete next.reviews[action.id];
    else Object.defineProperty(next.reviews, action.id, { value: { status: action.status, note: action.note,
      updatedAt: new Date().toISOString() }, enumerable: true, configurable: true, writable: true });
  } else if (action.action === 'reset') delete next.overrides[action.id];
  else {
    Object.defineProperty(next.overrides, action.event.id, { value: { event: action.event, hidden: action.hidden }, enumerable: true, configurable: true, writable: true });
    if (action.issueId) Object.defineProperty(next.reviews, action.issueId, { value: { status: 'resolved', note: action.note,
      updatedAt: new Date().toISOString() }, enumerable: true, configurable: true, writable: true });
  }
  return next;
};

export const mergeManagedEvents = (events: CalendarEvent[], state: AdminState): CalendarEvent[] => {
  const merged = new Map(events.map((event) => [event.id, event]));
  for (const { event, hidden } of Object.values(normalizeAdminState(state, events).overrides)) {
    if (hidden) merged.delete(event.id);
    else merged.set(event.id, event);
  }
  return [...merged.values()];
};

export const normalizeAdminState = (state: AdminState, events: CalendarEvent[]): AdminState => {
  const overrides = new Map<string, EventOverride>();
  const handled = new Set<string>();
  for (const collected of events) {
    const ids = [collected.id, ...(collected.collectionSources ?? []).map((source) => source.id)];
    const override = ids.flatMap((id) => state.overrides[id] ? [state.overrides[id]] : [])[0];
    ids.forEach((id) => handled.add(id));
    if (override) overrides.set(collected.id, { hidden: override.hidden, event: { ...collected, ...override.event, id: collected.id,
      ...(collected.collectionSources ? { collectionSources: collected.collectionSources } : {}) } });
  }
  for (const [id, override] of Object.entries(state.overrides)) if (!handled.has(id)) overrides.set(id, override);
  return { reviews: state.reviews, overrides: Object.fromEntries(overrides) };
};

export const saveAdminAction = async (action: AdminAction, collected: CalendarEvent[] = []): Promise<void> => {
  // 동시 저장의 덮어쓰기를 막기 위한 직렬 처리 및 원자적 파일 교체
  const operation = writes.then(async () => {
    const next = applyAdminAction(normalizeAdminState(await readAdminState(), collected), action);
    await mkdir(new URL('../data/', import.meta.url), { recursive: true });
    const temporary = new URL('../data/admin.json.tmp', import.meta.url);
    await writeFile(temporary, JSON.stringify(next, null, 2));
    await rename(temporary, storeUrl);
  });
  writes = operation.catch((error: unknown) => { console.error('Admin store write failed', error); });
  await operation;
};
