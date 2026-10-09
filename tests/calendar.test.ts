import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CalendarEvent } from '../shared/calendar';
import { calendarRange, DAY_MS, dayNumber, endingCountdown, eventEndDay, groupEndingEvents, monthRange, nearestEnding, packRange } from '../src/features/calendar/utils/calendar';
import { buildVersionEvents, parseHoyoCalendar, parseHoyoVersions, parseLocalDate, parseVersionEnd, parseWuwaBoundary, parseWuwaEvents } from '../src/features/collection';

const event = (id: string, startAt: string, endAt: string): CalendarEvent => ({ id, startAt, endAt,
  title: id, game: 'genshin', kind: 'event', sourceUrl: 'https://example.com', description: '', sourceLanguage: 'ko-kr' });
const packTestWeek = (events: CalendarEvent[], first: number) => packRange(events, first, first + 6);

test('전체 날짜 범위는 종료된 일정의 시작일을 제외하고 가장 늦은 종료일까지 포함', () => {
  const now = Date.parse('2026-10-08T00:00:00Z');
  const ended = event('ended', '2026-01-01T00:00:00Z', '2026-10-08T00:00:00Z');
  const active = event('active', '2026-09-15T00:00:00Z', '2026-10-09T00:00:00Z');
  const future = event('future', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00+09:00');
  const range = calendarRange([ended, active, future], now);
  assert.ok(range);
  assert.equal(range.first, dayNumber(active.startAt));
  assert.equal(range.last, dayNumber(future.endAt));
  assert.equal(range.days.length, range.last - range.first + 1);
  assert.equal(calendarRange([ended], now), null);
  assert.equal(calendarRange([], now), null);
  assert.ok(packRange([future], range.first, range.last)[0]?.[0]?.end && (packRange([future], range.first, range.last)[0]?.[0]?.end ?? 0) > 31);
});

test('남은 기간 색상의 7일·3일 경계와 24시간 이하의 HH:MM 표시', () => {
  const now = Date.parse('2026-10-08T00:00:00Z');
  const countdown = (remaining: number) => endingCountdown(new Date(now + remaining).toISOString(), now);
  assert.deepEqual(countdown(7 * DAY_MS), { tone: 'normal', label: '7일 남음' });
  assert.equal(countdown(7 * DAY_MS - 1).tone, 'soon');
  assert.equal(countdown(3 * DAY_MS + 1).tone, 'soon');
  assert.equal(countdown(3 * DAY_MS).tone, 'urgent');
  assert.equal(countdown(DAY_MS).label, '24:00 남음');
  assert.equal(countdown(65 * 60000).label, '01:05 남음');
  assert.equal(countdown(1).label, '00:01 남음');
  assert.deepEqual(countdown(0), { tone: 'expired', label: '종료' });
  assert.deepEqual(countdown(-DAY_MS), { tone: 'expired', label: '종료' });
});

test('종료 묶음의 남은 기간은 아직 끝나지 않은 가장 빠른 일정 기준', () => {
  const now = Date.parse('2026-10-08T00:00:00Z');
  const items = [event('past', '2026-01-01T00:00:00Z', new Date(now - 1).toISOString()),
    event('late', '2026-01-01T00:00:00Z', new Date(now + 3600000).toISOString()),
    event('early', '2026-01-01T00:00:00Z', new Date(now + 60000).toISOString())];
  assert.equal(nearestEnding(items, now)?.id, 'early');
  assert.equal(nearestEnding(items, now + DAY_MS)?.id, 'past');
  assert.equal(nearestEnding([], now), undefined);
});

test('종료 일정은 게임과 분류를 넘어서 한국 날짜별 집계 및 시각순 정렬', () => {
  const { first, last } = monthRange(2026, 9);
  const late = event('late', '2026-09-01T00:00:00Z', '2026-10-08T15:30:00Z');
  const early: CalendarEvent = { ...event('early', late.startAt, '2026-10-08T15:00:00Z'), game: 'starrail', kind: 'banner' };
  const groups = groupEndingEvents([late, early, event('outside', late.startAt, '2026-11-01T00:00:00+09:00')], first, last);
  assert.equal(groups.size, 1);
  assert.deepEqual(groups.get(dayNumber(early.endAt))?.map((item) => item.id), ['early', 'late']);
});

test('월 첫날 자정 종료는 이전 달의 기간 막대와 별도로 표시하고 미확정 버전은 제외', () => {
  const { first, last } = monthRange(2026, 9);
  const midnight = event('midnight', '2026-09-01T00:00:00+09:00', '2026-10-01T00:00:00+09:00');
  const unknown: CalendarEvent = { ...event('unknown', '2026-10-08T00:00:00Z', '2026-10-08T00:00:01Z'), kind: 'version' };
  const version: CalendarEvent = { ...event('version', midnight.startAt, '2026-10-09T10:00:00+09:00'), kind: 'version' };
  const groups = groupEndingEvents([midnight, unknown, version], first, last);
  assert.equal(packRange([midnight], first, last).length, 0);
  assert.equal(groups.get(first)?.[0]?.id, 'midnight');
  assert.equal(groups.size, 2);
  assert.equal(groups.get(dayNumber(unknown.endAt)), undefined);
});

test('서울 자정 경계와 종료 자정의 날짜 처리', () => {
  assert.equal(dayNumber('2026-10-08T14:59:59Z'), dayNumber('2026-10-08T00:00:00+09:00'));
  assert.equal(dayNumber('2026-10-08T15:00:00Z'), dayNumber('2026-10-09T00:00:00+09:00'));
  const item = event('midnight', '2026-10-08T10:00:00+09:00', '2026-10-09T00:00:00+09:00');
  assert.equal(eventEndDay(item), dayNumber(item.startAt));
});

test('월간 날짜 범위의 평년·윤년·연도 경계', () => {
  assert.equal(monthRange(2026, 1).days.length, 28);
  assert.equal(monthRange(2028, 1).days.length, 29);
  assert.equal(monthRange(2026, 7).days.length, 31);
  assert.equal(monthRange(2026, 12).first, monthRange(2027, 0).first);
});

test('겹치는 기간은 분리하고 겹치지 않는 기간은 같은 행에 배치', () => {
  const items = [event('a', '2026-10-04T10:00:00+09:00', '2026-10-06T20:00:00+09:00'),
    event('b', '2026-10-05T10:00:00+09:00', '2026-10-07T20:00:00+09:00'),
    event('c', '2026-10-07T21:00:00+09:00', '2026-10-08T20:00:00+09:00')];
  const lanes = packTestWeek(items, dayNumber('2026-10-04T00:00:00+09:00'));
  assert.equal(lanes.length, 2);
  assert.deepEqual(lanes[0]?.map((segment) => segment.event.id), ['a', 'c']);
  for (const lane of lanes) for (let index = 1; index < lane.length; index++) {
    const previous = lane[index - 1]; const current = lane[index];
    assert.ok(previous && current && previous.end < current.start);
  }
});

test('주를 넘는 일정은 양쪽 계속 표시와 칸 범위 유지', () => {
  const lanes = packTestWeek([event('long', '2026-09-20T10:00:00+09:00', '2026-11-01T00:00:00+09:00')], dayNumber('2026-10-04T00:00:00+09:00'));
  const segment = lanes[0]?.[0];
  assert.ok(segment);
  assert.equal(segment.start, 0); assert.equal(segment.end, 6);
  assert.ok(segment.continuesBefore && segment.continuesAfter);
});

test('월간 타임라인에서 주 경계 분할 없이 전체 기간 유지', () => {
  const { first, last } = monthRange(2026, 9);
  const lanes = packRange([
    event('outside', '2026-08-01T00:00:00+09:00', '2026-08-02T00:00:00+09:00'),
    event('long', '2026-10-03T00:00:00+09:00', '2026-10-24T00:00:00+09:00'),
    event('after', '2026-10-24T00:00:00+09:00', '2026-11-02T00:00:00+09:00'),
  ], first, last);
  assert.equal(lanes.length, 1);
  assert.deepEqual(lanes[0]?.map(({ event: item, start, end }) => [item.id, start, end]), [['long', 2, 22], ['after', 23, 30]]);
  assert.equal(lanes[0]?.[1]?.continuesAfter, true);
});

test('같은 날 종료·시작하는 버전은 한 줄이며 전환일은 새 버전이 점유', () => {
  const previous = { ...event('7.0', '2026-08-12T12:00:00+09:00', '2026-09-23T07:00:00+09:00'), kind: 'version' as const };
  const next = { ...event('7.1', '2026-09-23T12:00:00+09:00', '2026-11-04T12:00:00+09:00'), kind: 'version' as const };
  const transition = dayNumber(next.startAt);
  const lanes = packRange([next, previous], transition - 2, transition + 2);
  assert.equal(lanes.length, 1);
  assert.deepEqual(lanes[0]?.map((segment) => [segment.event.id, segment.start, segment.end]), [['7.0', 0, 1], ['7.1', 2, 4]]);
  assert.equal(previous.endAt, '2026-09-23T07:00:00+09:00');
  assert.equal(groupEndingEvents([previous, next], transition, transition).get(transition)?.[0]?.id, '7.0');
  assert.equal(packRange([previous, next], transition, transition).length, 1);
  assert.equal(packRange([previous, next], transition, transition)[0]?.[0]?.event.id, '7.1');
});

test('42일 기본값이 다음 버전과 겹쳐도 한 줄이며 다른 게임·일반 일정은 영향 없음', () => {
  const previous = { ...event('old', '2026-10-01T12:00:00+09:00', '2026-11-12T12:00:00+09:00'), kind: 'version' as const };
  const next = { ...event('new', '2026-11-01T12:00:00+09:00', '2026-12-01T12:00:00+09:00'), kind: 'version' as const };
  const first = dayNumber('2026-10-30T00:00:00+09:00');
  assert.equal(packRange([previous, next], first, first + 4).length, 1);
  const otherGame = { ...next, game: 'starrail' as const };
  assert.equal(packRange([previous, otherGame], first, first + 4)[0]?.[0]?.end, 4);
  assert.equal(packRange([event('a', previous.startAt, previous.endAt), event('b', next.startAt, next.endAt)], first, first + 4).length, 2);
  const sameDay = { ...next, startAt: '2026-10-01T18:00:00+09:00' };
  const sameFirst = dayNumber(previous.startAt);
  const sameLane = packRange([previous, sameDay], sameFirst, sameFirst + 1);
  assert.equal(sameLane.length, 1);
  assert.equal(sameLane[0]?.[0]?.event.id, sameDay.id);
});

test('불명확하거나 유효하지 않은 날짜 거부', () => {
  assert.equal(parseLocalDate('2026-02-30 10:00'), null);
  assert.equal(parseLocalDate('2026-10-08 24:00'), null);
  assert.equal(parseLocalDate('2026-10-08 10:00'), '2026-10-08T02:00:00.000Z');
});

test('HoYo 기간 누락 제외 및 젠존제 이름 없는 픽업 구성', () => {
  const parsed = parseHoyoCalendar('zenless', {
    events: [{ id: 1, name: '기간 없음', start_time: 0, end_time: 0 }],
    banners: [{ banner_type: 'character', agents: [{ name: '에이전트', rarity: 'S' }], start_time: 1790740800, end_time: 1792479599 }],
    challenges: [{ id: 2, name: '상시 도전', start_time: 1790740800, end_time: null }],
  }, 'https://example.com');
  assert.equal(parsed.skipped, 2); assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0]?.title, '에이전트');
  assert.throws(() => parseHoyoCalendar('genshin', { events: [] }, 'https://example.com'));
});

test('명조 버전 점검과 상대 시작 기간 연결', () => {
  const boundary = parseWuwaBoundary({ id: '1', title: 'Wuthering Waves Version 3.7 Update Maintenance Notice',
    content: '<div>Maintenance Time: 2026-09-30 04:00 - 2026-09-30 11:00 (UTC+8)</div>' });
  assert.ok(boundary);
  const parsed = parseWuwaEvents({ id: '2', title: '[Version 3.7 Featured Resonator/Weapon Convene: Phase I]', content:
    '<div>[Horizon of Dawnbreak] Featured Resonator Convene</div><div>✦Duration✦</div><div>Version 3.7 update - 2026-10-22 09:59 (server time)</div>' }, [boundary]);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0]?.startAt, '2026-09-30T03:00:00.000Z');
  assert.equal(parsed.events[0]?.endAt, '2026-10-22T01:59:00.000Z');
  assert.equal(parsed.events[0]?.kind, 'banner');
  assert.equal(parseWuwaEvents({ id: '3', title: 'Image Event', content: '<img src="https://example.com/calendar.png" />' }, []).skipped, 1);
});

test('버전 종료 수집 누락은 42일 기본값이며 다음 점검이 확인되면 자동 대체', () => {
  const versions = parseHoyoVersions([{ title: '「제목」 7.1 버전 업데이트 안내', description:
    '보상: 2026/09/23 06:00 (UTC+8). 〓업데이트 시간〓 2026/09/23 06:00 (UTC+8) 시작, 예상 소요 시간: 5시간', url: 'https://www.hoyolab.com/article/1' }]);
  assert.equal(versions[0]?.startAt, '2026-09-23T03:00:00.000Z');
  const single = buildVersionEvents('genshin', versions)[0];
  assert.ok(single); assert.equal(Date.parse(single.endAt) - Date.parse(single.startAt), 42 * 86400000);
  assert.equal(single.versionEndBasis, 'default-42-days');
  const all = buildVersionEvents('genshin', [...versions, { version: '7.2', maintenanceStart: '2026-11-04T22:00:00.000Z', startAt: '2026-11-05T03:00:00.000Z', sourceUrl: 'https://example.com' }]);
  assert.equal(all[0]?.endAt, '2026-11-04T22:00:00.000Z');
  assert.equal(all[0]?.versionEndBasis, 'next-maintenance');
});

test('명시된 단축 버전은 42일 기본값과 다음 점검보다 우선', () => {
  const versions = [{ version: '1.0', startAt: '2026-10-01T03:00:00.000Z', maintenanceStart: '2026-09-30T22:00:00.000Z',
    endAt: '2026-10-29T22:00:00.000Z', sourceUrl: 'https://example.com' },
  { version: '1.1', startAt: '2026-11-12T03:00:00.000Z', maintenanceStart: '2026-11-11T22:00:00.000Z', sourceUrl: 'https://example.com' }];
  assert.equal(buildVersionEvents('genshin', versions)[0]?.endAt, versions[0]?.endAt);
  assert.equal(buildVersionEvents('genshin', versions)[0]?.versionEndBasis, 'official');
});

test('공개된 다음 버전 날짜는 42일 기본값보다 우선하며 시각 미수집을 구분', () => {
  const boundary = { version: '시험', startAt: '2026-09-02T04:00:00.000Z', maintenanceStart: '2026-09-01T22:00:00.000Z',
    sourceUrl: 'https://example.com/old', announcedEndDate: '2026/10/15', endSourceUrl: 'https://example.com/new' };
  const result = buildVersionEvents('endfield', [boundary])[0];
  assert.equal(result?.versionEndBasis, 'announced-date');
  assert.equal(result?.endAt, '2026-10-14T15:00:00.000Z');
  assert.equal(result?.versionEndSourceUrl, boundary.endSourceUrl);
  const known = buildVersionEvents('endfield', [boundary, { version: '다음', startAt: '2026-10-15T04:00:00.000Z',
    maintenanceStart: '2026-10-14T22:00:00.000Z', sourceUrl: 'https://example.com/maintenance' }])[0];
  assert.equal(known?.versionEndBasis, 'next-maintenance');
  assert.equal(known?.versionEndSourceUrl, 'https://example.com/maintenance');
});

test('버전 전체 기간 문구만 읽고 개별 이벤트 기간·보상 종료는 제외', () => {
  assert.equal(parseVersionEnd('Version 3.7 Duration: Version 3.7 update - 2026/11/11 04:00 (UTC+8)', '3.7', 8), '2026-11-10T20:00:00.000Z');
  assert.equal(parseVersionEnd('3.7 버전 기간: 3.7 버전 업데이트 후 ~ 2026/11/11 05:00', '3.7', 9), '2026-11-10T20:00:00.000Z');
  assert.equal(parseVersionEnd('이벤트 기간: 3.7 버전 업데이트 후 ~ 2026/11/11 05:00', '3.7', 9), null);
  assert.equal(parseVersionEnd('「시험」 버전 기간: 2026/09/02 12:00 ~ 2026/10/15 06:00', '시험', 8), '2026-10-14T22:00:00.000Z');
});

test('보상 문구와 KST 버전 공지의 명시 종료 구분', () => {
  const versions = parseHoyoVersions([{ title: '3.2 버전 「제목」 업데이트 공지', url: 'https://www.hoyolab.com/article/1',
    description: '서버 점검 시간당 보상 지급. [업데이트 시작 시간] 2026/09/09 07:00(KST) 예상 소요 시간: 5시간. 3.2 버전 종료 시각은 2026/10/21 07:00(KST)입니다.' },
  { title: '4.6 버전 업데이트 안내', url: 'https://www.hoyolab.com/article/2',
    description: '■ 업데이트 시간 2026/09/28 07:00 (한국 시간)에 시작되며 예상 소요 시간은 5시간입니다.' }]);
  assert.equal(versions[0]?.startAt, '2026-09-09T03:00:00.000Z');
  assert.equal(versions[0]?.endAt, '2026-10-20T22:00:00.000Z');
  assert.equal(versions[1]?.startAt, '2026-09-28T03:00:00.000Z');
  assert.equal(buildVersionEvents('zenless', versions.slice(0, 1))[0]?.title, '버전 3.2');
});

test('스타레일 버전 기간 문구의 종료일을 읽고 보상 수령일과 구분', () => {
  const versions = parseHoyoVersions([{ title: '4.6 버전 「제목」 버전 업데이트 안내', url: 'https://www.hoyolab.com/article/2',
    description: '4.6 버전 기간은 4.6 버전 업데이트 후 ~ 2026/11/11 07:00 (한국 시간)입니다. ■ 업데이트 시간 2026/09/28 07:00 (한국 시간)에 시작되며 예상 소요 시간은 5시간입니다. ※ 보상 수령 기간: 2026/10/29 07:00 (한국 시간)까지.' }]);
  assert.equal(versions[0]?.endAt, '2026-11-10T22:00:00.000Z');
  const versionEvent = buildVersionEvents('starrail', versions)[0];
  assert.ok(versionEvent);
  assert.equal(versionEvent.title, '버전 4.6');
  const today = dayNumber('2026-10-08T12:00:00+09:00');
  assert.equal(packRange([versionEvent], today, today).length, 1);
  const unrelated = parseHoyoVersions([{ title: '4.6 버전 업데이트 안내', url: 'https://www.hoyolab.com/article/3',
    description: '4.5 버전 기간은 4.5 버전 업데이트 후 ~ 2026/11/11 07:00 (한국 시간)입니다. ■ 업데이트 시간 2026/09/28 07:00 (한국 시간)에 시작되며 예상 소요 시간은 5시간입니다.' }]);
  assert.equal(unrelated[0]?.endAt, undefined);
});
