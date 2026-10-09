import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CalendarEvent } from '../shared/calendar';
import { allEndingTasksCompleted, completedEventIds, restoreCompletionRecords, mergeCompletionRecords, reconcileCompletionRecords, toggleCompletion, useCompletionStore } from '../src/features/completion';
import { TimelineCalendar } from '../src/features/calendar/components/TimelineCalendar';
import { dayNumber } from '../src/features/calendar/utils/calendar';

const now = Date.parse('2099-01-02T03:00:00Z');
const task = (id = 'native'): CalendarEvent => ({ id, game: 'genshin', kind: 'event', title: '테스트 콘텐츠',
  startAt: '2099-01-01T03:00:00Z', endAt: '2099-01-08T03:00:00Z', sourceUrl: 'https://example.com',
  description: '', sourceLanguage: 'ko-kr', identityKey: 'content:unique' });

test('완료·취소와 JSON 저장 복원, 제목 변경으로 체크를 잃지 않음', () => {
  const event = task();
  const records = toggleCompletion([], event, [event], now);
  assert.ok(completedEventIds(records, [event]).has(event.id));
  const saved: unknown = JSON.parse(JSON.stringify({ records }));
  const restored = restoreCompletionRecords(saved, now);
  assert.ok(completedEventIds(restored, [{ ...event, title: '번역 보정된 이름' }]).has(event.id));
  const canceled = toggleCompletion(restored, event, [event], now);
  assert.equal(completedEventIds(canceled, [event]).size, 0);
  assert.equal(canceled[0]?.completedAt, null);
  assert.equal(completedEventIds(mergeCompletionRecords(records, canceled, now), [event]).size, 0);
});

test('대표 ID 변경은 출처 별칭·콘텐츠 ID와 주기가 유일할 때만 승계', () => {
  const old = { ...task('old-notice'), identityKey: undefined };
  const records = toggleCompletion([], old, [old], now);
  const changed = { ...task('new-primary'), identityKey: undefined, collectionSources: [{ id: old.id, title: old.title,
    startAt: old.startAt, endAt: old.endAt, sourceUrl: old.sourceUrl }] };
  assert.ok(completedEventIds(records, [changed]).has(changed.id));
  const byIdentity = toggleCompletion([], task('old-api'), [task('old-api')], now);
  assert.ok(completedEventIds(byIdentity, [task('new-api')]).has('new-api'));
  assert.equal(completedEventIds(byIdentity, [task('a'), task('b')]).size, 0);
  const explicit = toggleCompletion(byIdentity, task('a'), [task('a'), task('b')], now + 1);
  assert.deepEqual([...completedEventIds(explicit, [task('a'), task('b')])], ['a']);
  const corrected = { ...task('new-api'), endAt: '2099-01-08T02:59:00Z' };
  assert.ok(completedEventIds(byIdentity, [corrected]).has('new-api'));
});

test('새 엔드콘텐츠 회차·복각·다른 게임·종류·동명의 다른 콘텐츠는 승계하지 않음', () => {
  const event = task();
  const records = toggleCompletion([], event, [event], now);
  const next = { ...event, id: 'native:next-cycle', startAt: event.endAt, endAt: '2099-01-15T03:00:00Z' };
  assert.equal(completedEventIds(records, [next]).size, 0);
  assert.equal(completedEventIds(records, [{ ...event, game: 'wuwa' }]).size, 0);
  assert.equal(completedEventIds(records, [{ ...event, kind: 'challenge' }]).size, 0);
  assert.equal(completedEventIds(records, [{ ...event, id: 'other', identityKey: 'other' }]).size, 0);
  const completedNext = toggleCompletion(records, next, [event, next], Date.parse(next.startAt) + 1);
  assert.equal(completedNext.length, 2);
  assert.equal(completedEventIds(completedNext, [event, next]).size, 2);
  const reusedId = { ...next, id: event.id };
  assert.equal(completedEventIds(records, [reusedId]).size, 0);
  assert.equal(toggleCompletion(records, reusedId, [reusedId], Date.parse(next.startAt) + 1).length, 2);
});

test('버전 제외, 하위 활동과 전체 기간을 각각 체크', () => {
  const parent = task();
  const phase = { ...task('phase'), identityKey: undefined, endAt: '2099-01-03T03:00:00Z' };
  const records = toggleCompletion([], parent, [parent, phase], now);
  assert.equal(completedEventIds(records, [parent, phase]).has(phase.id), false);
  const version = { ...parent, kind: 'version' as const };
  assert.deepEqual(toggleCompletion([], version, [version], now), []);
});

test('종료 그룹은 전체 완료·일부 완료·빈 그룹·버전뿐인 그룹·만료 혼합을 구분', () => {
  const first = task('a');
  const second = { ...task('b'), identityKey: 'content:b', endAt: '2099-01-08T04:00:00Z' };
  const events = [first, second];
  assert.equal(allEndingTasksCompleted(events, (event) => event.id === first.id, now), false);
  assert.equal(allEndingTasksCompleted(events, () => true, now), true);
  assert.equal(allEndingTasksCompleted(events, () => true, Date.parse(first.endAt)), false);
  assert.equal(allEndingTasksCompleted(events, () => true, Date.parse(second.endAt)), false);
  assert.equal(allEndingTasksCompleted([], () => true, now), false);
  const version = { ...first, kind: 'version' as const };
  assert.equal(allEndingTasksCompleted([version], () => true, now), false);
  assert.equal(allEndingTasksCompleted([first, version], (event) => event.kind !== 'version', now), true);
});

test('180일 보관과 손상·잘못된 저장 데이터 검증', () => {
  const event = task();
  const records = toggleCompletion([], event, [event], now);
  const end = Date.parse(event.endAt);
  assert.equal(restoreCompletionRecords({ records }, end + 180 * 86400000).length, 1);
  assert.equal(restoreCompletionRecords({ records }, end + 180 * 86400000 + 1).length, 0);
  assert.deepEqual(restoreCompletionRecords(null, now), []);
  assert.deepEqual(restoreCompletionRecords({ records: [{ ...records[0], updatedAt: 'bad' }] }, now), []);
  assert.deepEqual(restoreCompletionRecords({ records: [{ ...records[0], ids: [1] }] }, now), []);
});

test('서로 다른 탭의 다른 기록과 취소를 병합하고 오래된 완료를 부활시키지 않음', () => {
  const a = task('a'), b = { ...task('b'), identityKey: 'content:b' };
  const tabA = toggleCompletion([], a, [a, b], now);
  const tabB = toggleCompletion([], b, [a, b], now + 1);
  const merged = mergeCompletionRecords(tabA, tabB, now);
  assert.equal(completedEventIds(merged, [a, b]).size, 2);
  const canceled = toggleCompletion(merged, a, [a, b], now + 2);
  const synced = mergeCompletionRecords(tabA, canceled, now);
  assert.deepEqual([...completedEventIds(synced, [a, b])], [b.id]);
  assert.deepEqual(mergeCompletionRecords(canceled, tabA, now), synced);
});

test('화면은 완료 바·초록 종료 표시·독립 상세 버튼 및 만료 회색 표시를 렌더링', () => {
  const event = task();
  const day = dayNumber(event.endAt);
  const props = { first: day, last: day, days: [day], now, selectedDay: day, focusRevision: 0, events: [event], endingEvents: [event],
    onSelectDay: () => {}, onSelectEvent: () => {}, onToggleCompletion: () => {}, isCompleted: () => true };
  const html = renderToStaticMarkup(createElement(TimelineCalendar, props));
  assert.match(html, /task-completed/);
  assert.match(html, /ending-completed/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /테스트 콘텐츠 상세 보기/);
  const endingButton = /class="ending-count[^\"]*"[^>]*>([\s\S]*?)<\/button>/.exec(html)?.[1];
  assert.ok(endingButton);
  assert.doesNotMatch(endingButton, /✓|완료|completion-count/);
  assert.equal(/<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/.test(html), false);
  const expired = renderToStaticMarkup(createElement(TimelineCalendar, { ...props, now: Date.parse(event.endAt) }));
  assert.match(expired, /ending-expired/);
  assert.doesNotMatch(expired, /ending-count ending-completed/);
  const unfinished = renderToStaticMarkup(createElement(TimelineCalendar, { ...props, isCompleted: () => false }));
  assert.doesNotMatch(unfinished, /task-completed/);
  assert.doesNotMatch(unfinished, /ending-completed/);
  const hidden = { ...task('hidden'), identityKey: 'content:hidden' };
  const searched = renderToStaticMarkup(createElement(TimelineCalendar, { ...props, endingEvents: [event, hidden], isCompleted: (row) => row.id === event.id }));
  assert.doesNotMatch(searched, /ending-completed/);
  assert.match(searched, /종료 2개/);
  assert.doesNotMatch(searched, /완료 1\/2|completion-count/);
});

test('브라우저 저장 복원·다른 탭 취소 및 저장 실패 시 메모리 체크 유지', async () => {
  const memory = new Map<string, string>();
  let failWrites = false;
  const storage: Storage = {
    get length() { return memory.size; }, clear: () => memory.clear(), key: (index) => [...memory.keys()][index] ?? null,
    getItem: (key) => memory.get(key) ?? null, removeItem: (key) => { memory.delete(key); },
    setItem: (key, value) => { if (failWrites) throw new Error('blocked'); memory.set(key, value); },
  };
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  const event = task();
  try {
    useCompletionStore.setState({ records: [] });
    useCompletionStore.getState().toggle(event, [event]);
    const saved = memory.get('subculture-calendar-completions');
    assert.ok(saved);
    useCompletionStore.setState({ records: [] });
    memory.set('subculture-calendar-completions', saved);
    await useCompletionStore.persist.rehydrate();
    assert.ok(completedEventIds(useCompletionStore.getState().records, [event]).has(event.id));
    const canceled = toggleCompletion(useCompletionStore.getState().records, event, [event], Date.now() + 1000);
    useCompletionStore.getState().synchronize({ records: canceled });
    assert.equal(completedEventIds(useCompletionStore.getState().records, [event]).size, 0);
    failWrites = true;
    useCompletionStore.getState().toggle(event, [event]);
    assert.ok(completedEventIds(useCompletionStore.getState().records, [event]).has(event.id));
  } finally {
    failWrites = false;
    useCompletionStore.setState({ records: [] });
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('대표 ID 연속 변경에서도 별칭을 저장하고 자동 보정이 취소 기록을 덮지 않음', () => {
  const first = { ...task('first'), identityKey: undefined };
  const initial = toggleCompletion([], first, [first], now);
  const second = { ...first, id: 'second', collectionSources: [{ id: first.id, title: first.title,
    startAt: first.startAt, endAt: first.endAt, sourceUrl: first.sourceUrl }] };
  const linked = reconcileCompletionRecords(initial, [second]);
  assert.equal(linked[0]?.updatedAt, initial[0]?.updatedAt);
  const third = { ...first, id: 'third', collectionSources: [{ id: second.id, title: first.title,
    startAt: first.startAt, endAt: first.endAt, sourceUrl: first.sourceUrl }] };
  const chained = reconcileCompletionRecords(linked, [third]);
  assert.ok(completedEventIds(chained, [third]).has(third.id));
  const canceled = toggleCompletion(initial, first, [first], now + 1);
  const merged = mergeCompletionRecords(chained, canceled, now);
  assert.equal(completedEventIds(merged, [third]).size, 0);
  assert.deepEqual(mergeCompletionRecords(canceled, chained, now), merged);
});
