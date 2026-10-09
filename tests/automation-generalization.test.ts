import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStructuredActivities, learnKoreanScheduleNames, parseHoyoCalendar, parseWuwaStructuredCalendar,
  mergeScheduleSources, mergeWuwaSources, supplementHoyoCalendar, learnStructuredActivityNames, attachHoyoNames } from '../src/features/collection';
import type { CalendarEvent } from '../shared/calendar';

const url = 'https://example.com/calendar';
const startAt = '2099-01-01T03:00:00.000Z';
const endAt = '2099-01-15T03:00:00.000Z';
const item = (name: string, id?: number) => ({ name, id, startTime: '2099-01-01T11:00:00+08:00', endTime: '2099-01-15T11:00:00+08:00' });
const event = (id: string, title: string): CalendarEvent => ({ id, title, game: 'wuwa', kind: 'event', startAt, endAt, sourceUrl: url, sourceLanguage: 'ko-kr', description: '' });

test('원본 피드의 신규 이름을 네 게임 모두 수집하고 보정 이름을 다음 주기에 재사용', () => {
  for (const game of ['genshin', 'starrail', 'zenless', 'endfield'] as const) {
    const first = parseStructuredActivities({ activities: [item('Never Seen Event', 90001)] }, url, game);
    assert.equal(first.events.length, 1);
    assert.equal(first.events[0]?.title, '이벤트 · 한국어 이름 확인');
    assert.equal(first.issues[0]?.eventId, first.events[0]?.id);
    const initial = first.events[0];
    assert.ok(initial);
    const names = learnKoreanScheduleNames([{ ...initial, title: '새로운 축제', displayLanguage: 'ko-kr' }], {});
    const next = parseStructuredActivities({ activities: [{ ...item('Renamed Original Event', 90001), startTime: '2099-02-01T11:00:00+08:00', endTime: '2099-02-15T11:00:00+08:00' }] }, url, game, names);
    assert.equal(next.events[0]?.title, '새로운 축제');
    assert.equal(next.issues.length, 0);
    assert.notEqual(next.events[0]?.id, initial.id);
  }
});

test('원본 시각의 UTC·명시 시차·Asia 기본값을 동일하게 처리하고 잘못된 기간은 진단', () => {
  const variants = [item('New'), { ...item('New'), startTime: startAt.replace('.000Z', 'Z'), endTime: endAt.replace('.000Z', 'Z') },
    { ...item('New'), startTime: '2099-01-01T11:00:00', endTime: '2099-01-15T11:00:00' }];
  for (const value of variants) assert.equal(parseStructuredActivities({ activities: [value] }, url).events[0]?.startAt, startAt);
  for (const startTime of ['2099-02-30T11:00:00+08:00', 'unreadable']) {
    const parsed = parseStructuredActivities({ activities: [{ ...item('New'), startTime }] }, url);
    assert.equal(parsed.events.length, 0);
    assert.equal(parsed.issues.length, 1);
  }
});

test('한국어·원본 구조화 API의 동일 ID 대응으로 새 이름을 사전 하드코딩 없이 연결', () => {
  const payload = (name: string) => ({ events: [{ id: 90009, name, start_time: Date.parse(startAt) / 1000, end_time: Date.parse(endAt) / 1000 }], banners: [], challenges: [] });
  const ko = parseHoyoCalendar('genshin', attachHoyoNames('genshin', payload('처음 보는 행사'), {}, 'ko-kr'), url);
  const names = learnStructuredActivityNames('genshin', payload('Future Festival'), learnKoreanScheduleNames(ko.events, {}));
  const translated = parseStructuredActivities({ activities: [item('Future Festival')] }, url, 'genshin', names);
  assert.equal(translated.events[0]?.title, '처음 보는 행사');
  assert.equal(translated.issues.length, 0);
});

test('같은 기간의 서로 다른 픽업과 같은 인용구의 다른 행사를 보존', () => {
  assert.equal(mergeWuwaSources([{ ...event('a', '「공통」 캐릭터 A 픽업'), kind: 'banner' }], [{ ...event('b', '「공통」 캐릭터 B 픽업'), kind: 'banner' }]).length, 2);
  assert.equal(mergeScheduleSources([event('a', '「공통」 첫 행사')], [event('b', '「공통」 둘째 행사')]).length, 2);
  const placeholders = ['a', 'b'].map((id) => ({ ...event(id, '이벤트 · 한국어 이름 확인'), localizationKey: `sra:wuwa:${id}` }));
  assert.equal(mergeScheduleSources([], placeholders).length, 2);
  assert.equal(mergeScheduleSources([event('a', '반복 행사')], [{ ...event('b', '반복 행사'), endAt: '2099-01-15T15:00:00.000Z' }]).length, 2);
});

test('ID 없는 병렬 픽업에 서로 다른 안정 ID를 부여하고 응답 순서 변경에도 유지', () => {
  const banners = [900, 901].map((id) => ({ banner_type: 'CHARACTER_UP', agents: [{ id, name: `캐릭터 ${id}`, rarity: 'S' }],
    start_time: Date.parse(startAt) / 1000, end_time: Date.parse(endAt) / 1000 }));
  const parse = (rows: typeof banners) => parseHoyoCalendar('zenless', { events: [], challenges: [], banners: rows }, url).events;
  const first = parse(banners);
  assert.equal(new Set(first.map((row) => row.id)).size, 2);
  assert.deepEqual(parse([...banners].reverse()).map((row) => row.id).sort(), first.map((row) => row.id).sort());
});

test('공지의 한 줄 기간·출석체크·업데이트 내 여러 이벤트를 수집', () => {
  const empty = { events: [], issues: [], skipped: 0 };
  const period = '이벤트 기간: 2099/01/01 11:00 ~ 2099/01/15 11:00 (KST)';
  for (const title of ['새 이벤트', '새 출석체크']) {
    assert.equal(supplementHoyoCalendar('zenless', empty, [{ id: title, title, description: period, url }], []).events.length, 1);
  }
  const result = supplementHoyoCalendar('genshin', empty, [{ id: 'update', title: '99.1 버전 업데이트 안내', url,
    description: `「새 축제」 이벤트\n${period}\n「다음 축제」 이벤트\n${period}` }], []);
  assert.deepEqual(result.events.map((row) => row.title), ['「새 축제」 이벤트', '「다음 축제」 이벤트']);
  assert.equal(new Set(result.events.map((row) => row.id)).size, 2);
  const unreadable = supplementHoyoCalendar('genshin', empty, [{ id: 'future', title: '새 축제 이벤트', url, description: '새 일정 표기 형식' }], []);
  assert.equal(unreadable.issues.length, 1);
});

test('명조의 신규 엔드콘텐츠 ID도 명시 기간·반복 규칙으로 수집하고 불명확한 주기는 진단', () => {
  const parse = (row: Record<string, unknown>) => parseWuwaStructuredCalendar({ servers: [{ label: 'Asia', utc: '+8' }], list: [{ id: 3, child: [row] }] },
    { versions: [] }, url, {}, 'ko-kr', Date.parse(startAt) + 1);
  const base = { id: 999, sourceId: 999999, title: '새로운 엔드콘텐츠', time: [['2099-01-01T11:00:00+08:00', '2099-01-15T11:00:00+08:00']] };
  assert.equal(parse(base).events[0]?.title, '새로운 엔드콘텐츠');
  const recurring = { ...base, time: [['2099-01-01T11:00:00+08:00']], season: { cycle: { weeks: 2 } } };
  assert.equal(parse(recurring).events[0]?.endAt, endAt);
  assert.equal(parse({ ...recurring, season: {} }).issues.length, 1);
  assert.equal(parse({ ...base, title: 'Unknown Challenge' }).issues[0]?.eventId, parse({ ...base, title: 'Unknown Challenge' }).events[0]?.id);
});

test('같은 공지의 여러 기간을 보존하고 이미지 일정 뒤의 보상 기간을 오인하지 않음', () => {
  const empty = { events: [], issues: [], skipped: 0 };
  const parsed = supplementHoyoCalendar('genshin', empty, [{ id: 'phases', title: '새 축제 이벤트', url,
    description: '이벤트 기간\n2099/01/01 11:00 ~ 2099/01/03 11:00 (KST)\n2099/01/05 11:00 ~ 2099/01/07 11:00 (KST)' }], []);
  assert.equal(parsed.events.length, 2);
  const image = supplementHoyoCalendar('genshin', empty, [{ id: 'image', title: '새 축제 이벤트', url,
    description: '이벤트 기간\n이미지에서 확인\n이벤트 보상\n2099/01/01 11:00 ~ 2099/01/03 11:00 (KST)' }], []);
  assert.equal(image.events.length, 0);
  assert.equal(image.issues.length, 1);
});

test('처음 보는 구조화 분류는 조용히 제외하지 않고 관리자 확인 항목으로 제공', () => {
  const parsed = parseWuwaStructuredCalendar({ servers: [{ label: 'Asia', utc: '+8' }], list: [{ id: 999, child: [{ id: 1001 }] }] },
    { versions: [] }, url);
  assert.equal(parsed.skipped, 1);
  assert.equal(parsed.issues.length, 1);
});
