import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWuwaPublicChallenges, translateScheduleNames, learnKoreanScheduleNames, attachHoyoNames, parseHoyoCalendar } from '../src/features/collection';
import { isCalendarEvent } from '../shared/calendar';

const source = 'https://example.com/events.json';
const servers = [{ id: 1, label: 'CN/Asia/HMT/SEA', utc: '+8' }, { id: 2, label: 'Europe', utc: '+1' }];
const row = (path: string, sourceId: number, time: string[], weeks?: number) => ({ id: sourceId + 1, sourceId, path,
  time: [time, ['2025-01-01T12:00:00+01:00']], ...(weeks ? { season: { cycle: { weeks } } } : {}) });
const publicData = { servers, list: [{ child: [
  row('events/matrix', 100770002, ['2026-10-07T05:00:00+09:00', '2026-11-12T04:59:59.999+09:00']),
  row('events/towerofadversity', 100300002, ['2025-02-03T05:00:00+09:00'], 4),
  row('events/whimperingwastes', 100390001, ['2025-03-17T05:00:00+09:00'], 4),
] }] };

test('공개 Asia JSON의 명시 기간·반복 주기를 한국어 엔드콘텐츠로 변환', () => {
  const result = parseWuwaPublicChallenges(publicData, source, {}, Date.parse('2026-10-09T00:00:00+09:00'));
  assert.equal(result.events.length, 3);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.events.map((event) => event.title), ['종말 매트릭스', '역경의 탑', '죽음의 노래와 바닷속 폐허']);
  assert.deepEqual(result.events.map((event) => event.endAt), ['2026-11-11T20:00:00.000Z', '2026-10-11T20:00:00.000Z', '2026-10-25T20:00:00.000Z']);
  assert.ok(result.events.every((event) => event.displayLanguage === 'ko-kr' && isCalendarEvent(event)));
  assert.equal(result.events[0]?.periodBasis, 'community-data');
  assert.equal(result.events[1]?.periodBasis, 'community-cycle');
});

test('탑의 종료 경계에서 다음 주기로 이동하며 이전 종료와 새 시작 일치', () => {
  const end = Date.parse('2026-10-12T05:00:00+09:00');
  const before = parseWuwaPublicChallenges(publicData, source, {}, end - 1).events.find((event) => event.title === '역경의 탑');
  const after = parseWuwaPublicChallenges(publicData, source, {}, end).events.find((event) => event.title === '역경의 탑');
  assert.ok(before && after);
  assert.equal(before.endAt, after.startAt);
  assert.equal(Date.parse(after.endAt) - Date.parse(after.startAt), 28 * 86400000);
});

test('매트릭스 공백 기간에는 이전 종료와 다음 시작을 억지로 연결하지 않음', () => {
  const result = parseWuwaPublicChallenges(publicData, source, {}, Date.parse('2026-10-01T00:00:00+09:00'));
  assert.ok(result.missing.includes('종말 매트릭스'));
  assert.equal(result.events.some((event) => event.title === '종말 매트릭스'), false);
});

test('Asia 식별이 없거나 시간대·주기 정보가 잘못된 자료는 거부', () => {
  assert.throws(() => parseWuwaPublicChallenges({ ...publicData, servers: [servers[1]] }, source));
  const invalid = { servers, list: [{ child: [row('events/towerofadversity', 100300002, ['2026-09-14T04:00:00'], 4),
    row('events/whimperingwastes', 100390001, ['2025-03-17T05:00:00+09:00'], -4)] }] };
  assert.equal(parseWuwaPublicChallenges(invalid, source).events.length, 0);
  assert.equal(parseWuwaPublicChallenges({ servers, list: [{ child: [row('events/towerofadversity', 100300002, ['2026-02-30T05:00:00+09:00'], 4)] }] }, source).events.length, 0);
});

test('알 수 없는 외국어 이름은 한국어 확인 항목으로 표시하고 관리자 보정을 다음 주기에 재사용', () => {
  const foreign = { id: 'test', game: 'wuwa' as const, kind: 'event' as const, title: 'Unknown Festival', localizationKey: 'wuwa:wiki:event:1',
    startAt: '2026-10-08T00:00:00.000Z', endAt: '2026-10-12T00:00:00.000Z', sourceUrl: source, sourceLanguage: 'en-us', description: '' };
  const unresolved = translateScheduleNames([foreign], {});
  assert.equal(unresolved.issues.length, 1);
  assert.ok(unresolved.issues[0]?.excerpt.includes('Unknown Festival'));
  assert.equal(unresolved.events[0]?.title.includes('Unknown'), false);
  const names = learnKoreanScheduleNames([{ ...foreign, title: '시험 축제', displayLanguage: 'ko-kr' }], {});
  const translated = translateScheduleNames([{ ...foreign, id: 'next-cycle' }], names);
  assert.equal(translated.events[0]?.title, '시험 축제');
  assert.equal(translated.events[0]?.sourceLanguage, 'en-us');
  assert.equal(translated.issues.length, 0);
});

test('한국어 캐시를 영문 구조화 API에 적용하고 픽업 슬롯 재사용 시 다른 캐릭터 이름을 잘못 적용하지 않음', () => {
  const payload = (id: number, name: string) => ({ events: [], challenges: [], banners: [{ id: 1, start_time: 1790740800, end_time: 1790900000,
    characters: [{ id, name, rarity: 5 }] }] });
  const native = parseHoyoCalendar('genshin', attachHoyoNames('genshin', payload(10, '시험 캐릭터'), {}, 'ko-kr'), source);
  const names = learnKoreanScheduleNames(native.events, {});
  const translated = parseHoyoCalendar('genshin', attachHoyoNames('genshin', payload(10, 'Test Character'), names, 'en-us'), source, 'en-us');
  assert.equal(translated.events[0]?.title, '시험 캐릭터');
  assert.equal(translated.events[0]?.displayLanguage, 'ko-kr');
  const replacement = parseHoyoCalendar('genshin', attachHoyoNames('genshin', payload(20, 'New Character'), names, 'en-us'), source, 'en-us');
  assert.ok(replacement.events[0]?.title.includes('한국어 이름 확인'));
  assert.equal(replacement.issues.length, 1);
});

test('한국어 확인용 제목과 외국어 원문은 이름 사전에 학습하지 않음', () => {
  const event = { id: 'test', game: 'wuwa' as const, kind: 'event' as const, title: '이벤트 · 한국어 이름 확인', localizationKey: 'wuwa:wiki:event:1',
    startAt: '2026-10-08T00:00:00.000Z', endAt: '2026-10-12T00:00:00.000Z', sourceUrl: source, sourceLanguage: 'ko-kr', description: '' };
  assert.deepEqual(learnKoreanScheduleNames([event], {}), {});
  assert.deepEqual(learnKoreanScheduleNames([{ ...event, title: 'Unknown Festival', sourceLanguage: 'en-us' }], {}), {});
});

test('원신의 ID 0 엔드콘텐츠 두 종류를 type_name으로 분리', () => {
  const data = (theater: string, abyss: string) => ({ events: [], banners: [], challenges: [
    { id: 0, name: theater, type_name: 'ActTypeRoleCombat', start_time: 1790740800, end_time: 1790900000 },
    { id: 0, name: abyss, type_name: 'ActTypeTower', start_time: 1790740000, end_time: 1790900000 },
  ] });
  const native = parseHoyoCalendar('genshin', attachHoyoNames('genshin', data('현실 속 환상극', '연월 나선'), {}, 'ko-kr'), source);
  const names = learnKoreanScheduleNames(native.events, {});
  const translated = parseHoyoCalendar('genshin', attachHoyoNames('genshin', data('Imaginarium Theater', 'Spiral Abyss'), names, 'en-us'), source, 'en-us');
  assert.deepEqual(translated.events.map((event) => event.title), ['현실 속 환상극', '연월 나선']);
});
