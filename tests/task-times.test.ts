import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CalendarEvent } from '../shared/calendar';
import { isCalendarEvent } from '../shared/calendar';
import { parseHoyoAnnouncements, supplementHoyoCalendar, reconcileSchedules, parseStructuredActivities, supplementStructuredVersion } from '../src/features/collection';
import { parseHoyoTimeRange } from '../src/features/collection/time-evidence';
import { dayNumber, packTimeRange } from '../src/features/calendar/utils/calendar';
import { mergeManagedEvents } from '../server/admin-store';

const url = 'https://example.com/official';
const boundary = { version: '4.6', maintenanceStart: '2026-09-27T22:00:00.000Z', startAt: '2026-09-28T03:00:00.000Z', sourceUrl: url };
const event = (id: string, startAt: string, endAt: string): CalendarEvent => ({ id, title: id, game: 'starrail', kind: 'event',
  startAt, endAt, sourceUrl: 'https://example.com/calendar', sourceLanguage: 'ko-kr', collectionMethod: 'structured', description: '' });

test('서버 시간 시작과 한국 시간 종료를 독립 변환하고 정밀도 보존', () => {
  const evidence = parseHoyoTimeRange('2026/10/21 12:00 (서버 시간) ~ 2026/11/11 04:59 (한국 시간)', [], url);
  assert.equal(evidence?.start.at, '2026-10-21T04:00:00.000Z');
  assert.equal(evidence?.end.at, '2026-11-10T19:59:00.000Z');
  assert.equal(evidence?.end.precision, 'minute');
  const reverse = parseHoyoTimeRange('2026/10/21 13:00 (한국 시간) ~ 2026/11/11 03:59:59 (서버 시간)', [], url);
  assert.equal(reverse?.start.at, evidence?.start.at);
  assert.equal(reverse?.end.at, '2026-11-10T19:59:59.000Z');
  assert.equal(reverse?.end.precision, 'second');
});

test('업데이트 후 시작만 점검 종료에 연결하고 명시 종료는 독립 적용', () => {
  const evidence = parseHoyoTimeRange('4.6 버전 업데이트 후 ~ 2026/11/02 04:59 (KST)', [boundary], url);
  assert.equal(evidence?.start.at, boundary.startAt);
  assert.equal(evidence?.start.basis, 'version-update');
  assert.equal(evidence?.end.at, '2026-11-01T19:59:00.000Z');
  assert.equal(parseHoyoTimeRange('4.6 버전 업데이트 후 ~ 2026/11/02 04:59 (KST)', [], url), undefined);
});

test('콘텐츠 회차별 공지에서 초기화와 점검 후를 구분하고 이름·ID 유지', () => {
  const native = [
    { ...event('reset', '2026-11-02T03:00:00Z', '2026-12-14T03:00:00Z'), title: '혼돈의 기억 · 적자생존', kind: 'challenge' as const },
    { ...event('patch', '2026-09-28T05:00:00Z', '2026-11-02T03:00:00Z'), title: '혼돈의 기억 · 내세로의 도하', kind: 'challenge' as const },
    { ...event('version-cycle', '2026-09-27T23:00:00Z', '2026-11-10T22:00:00Z'), title: '이상 중재 · 낙엽귀근', kind: 'challenge' as const },
    event('same-date', '2026-09-27T20:00:00Z', '2026-10-01T00:00:00Z'),
  ];
  const announcements = [{ id: '1', title: '4.6 버전 업데이트 안내', url, description: [
    '혼돈의 기억•적자생존', '2026/11/02 05:00 (KST) ~ 2026/12/14 04:59 (KST)',
    '혼돈의 기억•내세로의 도하', '4.6 버전 업데이트 후 ~ 2026/11/02 04:59 (KST)',
    '「이상 중재」 고난도 도전 콘텐츠는 버전에 따라 업데이트됩니다.', '이번 회차 테마: 「이상 중재•낙엽귀근」',
  ].join('\n') }];
  const feed = parseStructuredActivities({ activities: [{ name: native[0]?.title, startTime: '2026-11-02T04:00:00', endTime: '2026-12-14T03:59:59' }] }, 'https://example.com/feed', 'starrail');
  const duplicate = feed.events.map((row) => ({ ...row, title: native[0]?.title ?? '', kind: 'challenge' as const }));
  const result = supplementHoyoCalendar('starrail', { events: [...native, ...duplicate], issues: [], skipped: 0 }, announcements, [boundary]);
  const reset = result.events.find((row) => row.id === 'reset');
  assert.equal(reset?.startAt, '2026-11-01T20:00:00.000Z');
  assert.equal(reset?.endAt, '2026-12-13T19:59:00.000Z');
  assert.equal(reset?.title, native[0]?.title);
  assert.equal(result.events.find((row) => row.id === 'patch')?.startAt, boundary.startAt);
  assert.equal(result.events.find((row) => row.id === 'version-cycle')?.startAt, boundary.startAt);
  assert.equal(result.events.find((row) => row.id === 'version-cycle')?.timeEvidence?.start?.basis, 'version-cycle');
  assert.equal(result.events.find((row) => row.id === 'same-date')?.startAt, native[3]?.startAt);
  assert.equal(result.events.filter((row) => row.title === native[0]?.title).length, 1);
  assert.ok(result.events.every(isCalendarEvent));
  assert.deepEqual(reconcileSchedules(result.events).events, result.events);
});

test('공식 기간은 공개 API보다 우선하며 한국어 이름과 원본 시각 보존', () => {
  const native = { ...event('native', '2026-10-21T11:00:00Z', '2026-11-10T19:59:59Z'), title: '스타피스 페스티벌: 원 테이크' };
  const announcements = parseHoyoAnnouncements({ retcode: 0, data: { list: [{ ann_id: 1, title: native.title,
    content: '<p>■ 이벤트 기간</p><p>2026/10/21 12:00 (서버 시간) ~ 2026/11/11 04:59 (한국 시간)</p>' }] } }, url);
  const result = supplementHoyoCalendar('starrail', { events: [native], issues: [], skipped: 0 }, announcements, []);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]?.id, native.id);
  assert.equal(result.events[0]?.startAt, '2026-10-21T04:00:00.000Z');
  assert.equal(result.events[0]?.endAt, '2026-11-10T19:59:00.000Z');
  assert.equal(result.events[0]?.collectionSources?.find((source) => source.id === native.id)?.startAt, native.startAt);
  assert.equal(result.events[0]?.timeEvidence?.start?.basis, 'official');
  assert.deepEqual(reconcileSchedules(result.events).events, result.events);
});

test('공식 근거가 없는 공개 피드 시각은 잠정 선택하고 수동 수정은 우선', () => {
  const native = event('fallback', '2026-09-27T03:00:00Z', '2026-11-10T02:59:59Z');
  const feed = parseStructuredActivities({ activities: [{ name: 'fallback', startTime: '2026-09-28T11:00:00', endTime: '2026-11-11T05:59:59' }] }, 'https://example.com/feed', 'starrail');
  const candidates = feed.events.map((row) => ({ ...row, title: native.title, identityKey: native.id }));
  const result = reconcileSchedules([{ ...native, identityKey: native.id }, ...candidates]);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]?.startAt, '2026-09-28T03:00:00.000Z');
  assert.equal(result.events[0]?.timeEvidence?.start?.basis, 'community-data');
  const manual = { ...native, startAt: '2026-09-28T04:00:00Z' };
  const managed = mergeManagedEvents(result.events, { reviews: {}, overrides: { [native.id]: { event: manual, hidden: false } } });
  assert.equal(managed[0]?.startAt, manual.startAt);
  assert.equal(managed[0]?.timeEvidence?.start?.basis, 'manual');
});

test('공식 버전 종료를 보완 API의 버전 기간으로 덮어쓰지 않음', () => {
  const version = { ...event('version', boundary.startAt, '2026-11-10T22:00:00Z'), title: '버전 4.6', kind: 'version' as const, versionEndBasis: 'official' as const };
  assert.deepEqual(supplementStructuredVersion([version], { version: '4.6', startTime: '2026-09-28T11:00:00', endTime: '2026-11-11T12:00:00', activities: [] }, url, 'starrail'), [version]);
});

test('같은 날 인접한 시간 구간은 같은 행이고 겹치는 구간은 별도 행', () => {
  const first = dayNumber('2026-10-10T00:00:00+09:00');
  const lanes = packTimeRange([
    event('morning', '2026-10-10T01:00:00+09:00', '2026-10-10T02:00:00+09:00'),
    event('next', '2026-10-10T02:00:00+09:00', '2026-10-10T03:00:00+09:00'),
    event('overlap', '2026-10-10T01:30:00+09:00', '2026-10-10T02:30:00+09:00'),
  ], first, first);
  assert.equal(lanes.length, 2);
  assert.deepEqual(lanes[0]?.map((segment) => segment.event.id), ['morning', 'next']);
  assert.equal(lanes[0]?.[0]?.start, 1 / 24);
  assert.equal(lanes[0]?.[0]?.end, 2 / 24);
});

test('버전 전환일에도 실제 종료와 점검 공백을 보존하고 범위 경계 절단', () => {
  const first = dayNumber('2026-10-10T00:00:00+09:00');
  const lanes = packTimeRange([
    { ...event('old', '2026-09-01T12:00:00+09:00', '2026-10-10T07:00:00+09:00'), kind: 'version' as const },
    { ...event('new', '2026-10-10T12:00:00+09:00', '2026-11-01T12:00:00+09:00'), kind: 'version' as const },
  ], first, first);
  assert.equal(lanes.length, 1);
  assert.equal(lanes[0]?.[0]?.start, 0);
  assert.equal(lanes[0]?.[0]?.end, 7 / 24);
  assert.equal(lanes[0]?.[1]?.start, 12 / 24);
  assert.equal(lanes[0]?.[1]?.end, 1);
  assert.equal(lanes[0]?.[0]?.continuesBefore, true);
  assert.equal(lanes[0]?.[1]?.continuesAfter, true);
  assert.equal(packTimeRange([event('midnight', '2026-10-09T12:00:00+09:00', '2026-10-10T00:00:00+09:00')], first, first).length, 0);
});
