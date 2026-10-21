import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isCalendarEvent, type CalendarEvent } from '../shared/calendar';
import { scheduleIdentifiers } from '../shared/schedule-reference';
import { parseHonkaiPublicTimeline } from '../src/features/collection/honkai/public';
import { collectHonkaiOfficialItems, mergeHonkaiScheduleSources, resolveHonkaiOfficialItems } from '../src/features/collection/honkai/official';
import { reconcileSchedules } from '../src/features/collection';
import { EventDetail } from '../src/features/calendar/components/EventDetail';
import { isEstimatedPeriod } from '../src/features/calendar/utils/calendar';
import { applyHonkaiTimeRules } from '../src/features/collection/honkai/custom/time-rules';
import { collectHonkaiArticleSchedules } from '../src/features/collection/honkai';

const source = 'https://www.arustats.com/en-us/hi3/timeline/';
const version = (number: string): CalendarEvent => ({ id: `honkai:version:${number}`, title: `${number} 버전`,
  game: 'honkai', kind: 'version', startAt: '2027-12-23T08:00:00.000Z', endAt: '2028-01-05T15:00:00.000Z',
  sourceUrl: 'https://cafe.naver.com/honkai3rd/9999999', sourceLanguage: 'ko-kr', description: '' });
const row = (name: string, title: string, startWeek = 1, endWeek = 3) => ({ row: name,
  content: [{ startWeek, endWeek, miniature: { titleTop: title } }] });
const raw = (number: string) => ({ version: number, scheduleDates: [
  { startDate: '2027-12-23 0:0:0', endDate: '2027-12-30 0:0:0' },
  { startDate: '2027-12-30 0:0:0', endDate: '2028-1-6 0:0:0' }],
  scheduleActivities: [row('EVENT 1', 'New Login: Unknown Reward'), row('SUPPLY A', 'Brand New Character'),
    row('MYSTERY MODE', 'Unseen Mode'), row('EVENT 2', '原文 행사 ♪ 🌟'),
    row('EVENT 3', 'Repeated Event', 1, 2), row('EVENT 4', 'Repeated Event', 2, 3)] });

test('사전·한국어 공지 없이 임의 버전의 모든 원본 일정과 새 분류를 표시', () => {
  for (const number of ['8.1', '10.7', '99.4']) {
    const input = raw(number);
    const timeline = parseHonkaiPublicTimeline(input, version(number), [], `${source}${number}`, false);
    assert.equal(timeline.events.length, input.scheduleActivities.length);
    assert.equal(timeline.skipped, 0);
    const merged = mergeHonkaiScheduleSources({ events: [], issues: [] }, timeline.events, []);
    const reconciled = reconcileSchedules(merged.events).events;
    assert.equal(reconciled.length, input.scheduleActivities.length);
    assert.equal(new Set(reconciled.map((event) => event.id)).size, reconciled.length);
    for (const original of timeline.events) {
      const event = reconciled.find((event) => scheduleIdentifiers(event).includes(original.id));
      assert.ok(event && isCalendarEvent(event));
      assert.equal(event.title, original.title);
      assert.ok(isEstimatedPeriod(event));
      assert.equal(event.crossChecked, false);
      assert.deepEqual(event.collectionSources, original.collectionSources);
    }
    assert.equal(timeline.events.find((event) => event.title === 'Unseen Mode')!.kind, 'event');
    assert.ok(timeline.issues.some((issue) => issue.id.endsWith(':category')));
  }
});

test('번역·공식 기간이 뒤늦게 생겨도 원본 ID·원문 제목·기간·출처 보존', () => {
  const v = version('10.7');
  const input = { ...raw('10.7'), scheduleActivities: [row('EVENT 1', 'Completely New Name')] };
  const original = parseHonkaiPublicTimeline(input, v, [], source, false).events[0]!;
  const notice = { id: 'future-notice', title: '10.7 버전 업데이트 공지', createdAt: Date.parse(v.startAt) / 1000,
    url: v.sourceUrl, description: '☆☆테마 이벤트 「완전히 새로운 이름」☆☆\n이벤트 기간: 12월 24일 10:00~1월 5일 04:00',
    englishDescription: '☆☆ Featured Event: Completely New Name ☆☆' };
  const timeline = parseHonkaiPublicTimeline(input, v, [notice], source, false);
  const enriched = timeline.events[0]!;
  assert.equal(enriched.id, original.id);
  assert.equal(enriched.title, '완전히 새로운 이름');
  assert.equal(enriched.crossChecked, true);
  const inventory = collectHonkaiOfficialItems([notice], [v]);
  const merged = mergeHonkaiScheduleSources(resolveHonkaiOfficialItems(inventory, timeline.events), timeline.events, inventory);
  assert.equal(merged.events.length, 1);
  const event = merged.events[0]!;
  assert.equal(event.startAt, '2027-12-24T01:00:00.000Z');
  assert.equal(event.endAt, '2028-01-04T19:00:00.000Z');
  assert.ok(scheduleIdentifiers(event).includes(original.id));
  assert.ok(event.collectionSources!.some((origin) => origin.id === original.id && origin.title === original.title
    && origin.startAt === original.startAt && origin.endAt === original.endAt && origin.sourceUrl === original.sourceUrl));
});

test('이미지나 이름이 없어도 기간과 원본이 있으면 표시하고 손상된 기간만 진단', () => {
  const input = { ...raw('10.7'), scheduleActivities: [{ row: 'NEW ACTIVITY', content: [
    { startWeek: 1, endWeek: 2, miniature: { titleMid: 'Only Subtitle' } },
    { startWeek: 2, endWeek: 3 }, { startWeek: 2, endWeek: 2 }, { startWeek: -1, endWeek: 99 }] }] };
  const timeline = parseHonkaiPublicTimeline(input, version('10.7'), [], source, false);
  assert.equal(timeline.events.length, 2);
  assert.equal(timeline.skipped, 2);
  assert.equal(timeline.events[0]!.title, 'Only Subtitle');
  assert.equal(timeline.events[1]!.title, 'NEW ACTIVITY #2');
  assert.ok(timeline.events.every(isCalendarEvent));
  assert.equal(timeline.issues.filter((issue) => issue.id.endsWith(':schema')).length, 2);
});

test('원문 일정의 상세에는 공식 대조 완료로 오인시키지 않는 예상 기간 표시', () => {
  const event = parseHonkaiPublicTimeline(raw('10.7'), version('10.7'), [], source, false).events[0]!;
  const html = renderToStaticMarkup(createElement(EventDetail, { event, isCompleted: false,
    onToggleCompletion: () => {}, onClose: () => {} }));
  assert.ok(html.includes('예상 기간'));
  assert.ok(html.includes('공식 종료 기간이 확인되지 않아'));
  assert.ok(!html.includes('대조한 날짜'));
  assert.ok(html.includes(event.title));
});

test('추정 버전 종료가 더 이르더라도 공식 개별 일정의 정확한 종료 보존', () => {
  const v = { ...version('10.7'), versionEndBasis: 'default-42-days' as const };
  const endAt = '2028-01-07T03:00:00.000Z';
  const event = { ...v, id: 'new-banner', kind: 'banner' as const, endAt, timeEvidence: {
    end: { at: endAt, basis: 'official' as const, precision: 'minute' as const, sourceUrl: source } } };
  assert.equal(applyHonkaiTimeRules([v, event])[1]!.endAt, endAt);
});

test('다른 분류의 손상과 한국 기간 불일치가 정상 원본 일정 표시를 막지 않음', () => {
  const input = { ...raw('10.7'), scheduleActivities: [null, ...raw('10.7').scheduleActivities] };
  const v = { ...version('10.7'), startAt: '2027-12-24T08:00:00.000Z' };
  const timeline = parseHonkaiPublicTimeline(input, v, [], source, false);
  assert.equal(timeline.events.length, 6);
  assert.equal(timeline.skipped, 1);
  assert.equal(timeline.version.startAt, v.startAt);
  assert.ok(timeline.events.every((event) => !event.versionStartId && !event.crossChecked));
  assert.equal(timeline.events[0]!.startAt, '2027-12-22T15:00:00.000Z');
  assert.ok(timeline.issues.some((issue) => issue.id.endsWith(':region')));
  assert.ok(timeline.issues.some((issue) => issue.id.endsWith(':row:0:schema')));
});

test('같은 이름·같은 시작일의 여러 원본과 원본 ID가 있는 일정의 순서 변경 보존', () => {
  const items = [
    { startWeek: 1, endWeek: 2, miniature: { titleTop: 'Same', titleMid: 'A' } },
    { startWeek: 1, endWeek: 3, miniature: { titleTop: 'Same', titleMid: 'B' } },
    { id: 'upstream-123', startWeek: 1, endWeek: 3, miniature: { titleTop: 'Same', titleMid: 'C' } }];
  const input = { ...raw('10.7'), scheduleActivities: [{ row: 'EVENT 1', content: items }] };
  const before = parseHonkaiPublicTimeline(input, version('10.7'), [], source, false).events;
  const after = parseHonkaiPublicTimeline({ ...input, scheduleActivities: [{ row: 'EVENT 1', content: [...items].reverse() }] },
    version('10.7'), [], source, false).events;
  assert.equal(new Set(before.map((event) => event.id)).size, 3);
  for (const event of before) assert.equal(after.find((candidate) => candidate.title === event.title)!.id, event.id);
});

test('공식 공지에 같은 이름의 여러 기간이 있어도 원본 회차를 모두 표시', async () => {
  const notice = { id: 'official-cycles', title: '10.7 버전 업데이트 공지', createdAt: Date.parse('2027-12-23T08:00:00Z') / 1000,
    url: 'https://cafe.naver.com/honkai3rd/9999999', description: '10.7 버전에 온 걸 환영해(12월 23일~1월 6일)!\n'
      + '☆☆테마 이벤트 「새 회차」☆☆\n이벤트 기간: 12월 24일 10:00~12월 30일 04:00\n'
      + '이벤트 기간: 12월 26일 10:00~1월 5일 04:00' };
  const result = await collectHonkaiArticleSchedules([notice], { now: notice.createdAt * 1000,
    fetchTimeline: async (version) => ({ version, events: [], issues: [], skipped: 0 }) });
  const events = reconcileSchedules(result.events).events.filter((event) => event.title === '새 회차');
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.startAt).sort(), ['2027-12-24T01:00:00.000Z', '2027-12-26T01:00:00.000Z']);
  assert.ok(result.issues.some((issue) => /충돌/.test(issue.reason)));
});

test('원본끼리 이름이 같고 기간이 겹쳐도 서로 다른 기간을 하나로 축소하지 않음', () => {
  const input = { ...raw('10.7'), scheduleActivities: [row('EVENT 1', 'Same Name', 1, 3), row('EVENT 2', 'Same Name', 2, 3)] };
  const timeline = parseHonkaiPublicTimeline(input, version('10.7'), [], source, false);
  const merged = mergeHonkaiScheduleSources({ events: [], issues: [] }, timeline.events, []);
  const events = reconcileSchedules(merged.events).events;
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.startAt).sort(), timeline.events.map((event) => event.startAt).sort());
});
