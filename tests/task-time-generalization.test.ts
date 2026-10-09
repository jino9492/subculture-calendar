import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CalendarEvent } from '../shared/calendar';
import { parseEndfieldEvents, supplementHoyoCalendar, reconcileSchedules } from '../src/features/collection';
import { parseHoyoTimeRange } from '../src/features/collection/time-evidence';
import { dayNumber, packTimeRange } from '../src/features/calendar/utils/calendar';
import { mergeManagedEvents } from '../server/admin-store';

const url = 'https://example.com/official';
const event = (id: string, startAt: string, endAt: string): CalendarEvent => ({ id, title: id, game: 'starrail', kind: 'event',
  startAt, endAt, sourceUrl: url, sourceLanguage: 'ko-kr', description: '', collectionMethod: 'structured' });

test('미래 윤년·연말의 모든 시간대에서 서버와 한국 시각을 독립 변환', () => {
  for (const day of ['2032/02/29', '2033/12/31']) for (let hour = 0; hour < 24; hour++) {
    const time = `${day} ${String(hour).padStart(2, '0')}:17:43`;
    for (const [zone, offset] of [['서버 시간', 8], ['한국 시간', 9], ['UTC+8', 8], ['UTC+9', 9], ['KST', 9]] as const) {
      const parsed = parseHoyoTimeRange(`${time} (${zone}) ~ 2034/01/02 04:59 (한국 시간)`, [], url);
      assert.equal(parsed?.start.at, new Date(`${day.replaceAll('/', '-')}T${String(hour).padStart(2, '0')}:17:43+0${offset}:00`).toISOString());
      assert.equal(parsed?.end.at, '2034-01-01T19:59:00.000Z');
    }
  }
  assert.equal(parseHoyoTimeRange('2033/02/29 12:00 ~ 2033/03/03 04:59', [], url), undefined);
});

test('지원하지 않는 시간대는 서버 시간으로 오인하지 않고 보류', () => {
  for (const zone of ['UTC+7', 'UTC+10', 'PST']) for (const boundary of ['start', 'end']) {
    const start = `2032/03/01 12:00 (${boundary === 'start' ? zone : 'KST'})`;
    const end = `2032/03/02 04:59 (${boundary === 'end' ? zone : 'KST'})`;
    assert.equal(parseHoyoTimeRange(`${start} ~ ${end}`, [], url), undefined);
  }
});

test('미래 버전의 다른 점검 종료 시각은 12시로 고정하지 않고 명시 경계 사용', () => {
  for (const [version, hour] of [['9.8', '02'], ['10.1', '05'], ['11.2', '07']] as const) {
    const startAt = `2032-08-01T${hour}:30:00.000Z`;
    const boundary = { version, startAt, maintenanceStart: '2032-07-31T22:00:00Z', sourceUrl: url };
    const text = `${version} 버전 업데이트 후 ~ 2032/09/01 04:59 (KST)`;
    assert.equal(parseHoyoTimeRange(text, [boundary], url)?.start.at, startAt);
    assert.equal(parseHoyoTimeRange(text, [{ ...boundary, version: '다른 버전' }], url), undefined);
  }
});

test('새 이름의 원신·스타레일·젠레스 이벤트도 공식 시각을 따르고 입력을 유지', () => {
  for (const game of ['genshin', 'starrail', 'zenless'] as const) {
    const native = { ...event(`future-${game}`, '2032-08-01T11:00:00Z', '2032-08-20T19:59:59Z'), game, title: '새로운 행사', sourceUrl: 'https://example.com/calendar' };
    const input = structuredClone(native);
    const result = supplementHoyoCalendar(game, { events: [native], issues: [], skipped: 0 }, [{ id: `future-${game}`, title: '「새로운 행사」 이벤트', url,
      description: '이벤트 기간:\n2032/08/01 14:30 (서버 시간) ~ 2032/08/21 04:59 (한국 시간)' }], []);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0]?.id, native.id);
    assert.equal(result.events[0]?.startAt, '2032-08-01T06:30:00.000Z');
    assert.equal(result.events[0]?.endAt, '2032-08-20T19:59:00.000Z');
    assert.deepEqual(native, input);
  }
});

test('재사용된 원본 ID의 다음 회차에 이전 수동 시각·숨김을 적용하지 않음', () => {
  const old = event('reused-id', '2032-01-01T03:00:00Z', '2032-02-01T19:59:59Z');
  const next = { ...old, startAt: '2032-03-01T03:00:00Z', endAt: '2032-04-01T19:59:59Z' };
  for (const hidden of [false, true]) {
    const managed = mergeManagedEvents([next], { reviews: {}, overrides: { [old.id]: { event: old, hidden } } });
    assert.equal(managed.length, 1);
    assert.equal(managed[0]?.startAt, next.startAt);
    assert.equal(managed[0]?.endAt, next.endAt);
  }
});

test('새 버전 테마의 일반 갱신 규칙은 명시된 공식 시작을 덮어쓰지 않고 입력을 변경하지 않음', () => {
  const boundary = { version: '9.7', startAt: '2032-03-01T04:00:00Z', maintenanceStart: '2032-02-29T22:00:00Z', sourceUrl: url };
  const native = { ...event('new-theme', '2032-03-01T05:00:00Z', '2032-04-01T19:59:59Z'), kind: 'challenge' as const,
    title: '이상 중재 · 새로운 테마', timeEvidence: { start: { at: '2032-03-01T05:00:00Z', basis: 'official' as const, precision: 'minute' as const, sourceUrl: url } } };
  const input = structuredClone(native);
  const result = supplementHoyoCalendar('starrail', { events: [native], issues: [], skipped: 0 }, [{ id: 'future', title: '9.7 버전 업데이트', url,
    description: '「이상 중재」 고난도 도전 콘텐츠는 버전에 따라 업데이트됩니다.\n이번 회차 테마: 「이상 중재•새로운 테마」' }], [boundary]);
  assert.equal(result.events[0]?.startAt, input.startAt);
  assert.equal(result.events[0]?.timeEvidence?.start?.basis, 'official');
  assert.deepEqual(native, input);
  const provisional = { ...input, timeEvidence: undefined };
  const corrected = supplementHoyoCalendar('starrail', { events: [provisional], issues: [], skipped: 0 }, [{ id: 'future', title: '9.7 버전 업데이트', url,
    description: '「이상 중재」 고난도 도전 콘텐츠는 버전에 따라 업데이트됩니다.\n이번 회차 테마: 「이상 중재•새로운 테마」' }], [boundary]);
  assert.equal(corrected.events[0]?.startAt, boundary.startAt);
  assert.equal(provisional.startAt, input.startAt);
});

test('새로운 무기 이름·가변 회차 길이·비정규 종료에서도 세 번째 실제 헤드헌트와 일치', () => {
  const article = { id: 'future-weapon', title: '「새로운 무기」 기간 한정 판매 설명', content:
    '<p>「새로운 무기」 무기고 신청</p><p>· 개방 기간: 2032/02/20 12:00 개방, 「특별 허가 헤드헌팅」 3회 진행 후 종료(「새 첫 회차」부터 집계)</p>' };
  const cycles = [
    ['새 첫 회차', '2032-02-20T04:00:00Z', '2032-03-12T03:59:00Z'],
    ['새 둘째 회차', '2032-03-12T04:00:00Z', '2032-04-09T03:59:00Z'],
    ['새 셋째 회차', '2032-04-09T04:00:00Z', '2032-05-01T05:23:45Z'],
  ].map(([name, start, end]) => ({ ...event(name!, start!, end!), game: 'endfield' as const, kind: 'banner' as const, title: `「${name}」 특별 허가 헤드헌팅` }));
  for (const count of [1, 2, 3]) {
    const banners = cycles.slice(0, count);
    const result = parseEndfieldEvents(article, [], [...banners].reverse());
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0]?.endAt, count === 1 ? '2032-04-23T03:59:00.000Z' : count === 2 ? '2032-05-07T03:59:00.000Z' : cycles[2]?.endAt);
    assert.equal(result.events[0]?.periodBasis, count < 3 ? 'community-cycle' : undefined);
  }
});

test('같은 이름의 미래 회차와 공식 보정은 입력 순서에 무관하게 분리·재병합 유지', () => {
  const first = event('first', '2032-01-01T03:00:00Z', '2032-02-01T19:59:00Z');
  const next = { ...first, id: 'next', startAt: '2032-03-01T03:00:00Z', endAt: '2032-04-01T19:59:00Z' };
  const notice = { ...next, id: 'notice', collectionMethod: 'announcement' as const, startAt: '2032-03-01T04:00:00Z',
    sourceUrl: 'https://example.com/notice', timeEvidence: { start: { at: '2032-03-01T04:00:00Z', basis: 'official' as const, precision: 'minute' as const, sourceUrl: url } } };
  const expected = reconcileSchedules([first, next, notice]).events;
  assert.equal(expected.length, 2);
  for (const rows of [[notice, first, next], [next, notice, first], [first, notice, next]]) {
    assert.deepEqual(reconcileSchedules(rows).events, expected);
  }
  assert.deepEqual(reconcileSchedules(expected).events, expected);
});

test('다양한 미래 시간 구간의 위치·잘림·겹침이 실제 시각과 일치', () => {
  const midnight = Date.parse('2032-02-28T00:00:00+09:00');
  const day = dayNumber(new Date(midnight).toISOString());
  const rows = Array.from({ length: 200 }, (_, index) => {
    const start = midnight + ((index * 137 % 7200) - 1440) * 60000;
    const end = start + (1 + index * 71 % 1800) * 60000;
    return event(`generated-${index}`, new Date(start).toISOString(), new Date(end).toISOString());
  });
  const lanes = packTimeRange(rows, day, day + 2);
  const segments = lanes.flat();
  assert.equal(segments.length, rows.filter((row) => Date.parse(row.startAt) < midnight + 3 * 86400000 && Date.parse(row.endAt) > midnight).length);
  for (const lane of lanes) for (const [index, segment] of lane.entries()) {
    assert.equal(segment.start, (Math.max(midnight, Date.parse(segment.event.startAt)) - midnight) / 86400000);
    assert.equal(segment.end, (Math.min(midnight + 3 * 86400000, Date.parse(segment.event.endAt)) - midnight) / 86400000);
    assert.ok(segment.end > segment.start);
    if (index > 0) assert.ok(lane[index - 1]!.end <= segment.start);
  }
});
