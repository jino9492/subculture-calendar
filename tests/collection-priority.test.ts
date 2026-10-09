import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWuwaStructuredCalendar, mergeHoyoStructured, mergeScheduleSources, mergeWuwaSources, supplementStructuredVersion } from '../src/features/collection';
import type { CalendarEvent } from '../shared/calendar';

const url = 'https://example.com/calendar';
const now = Date.parse('2026-10-09T00:00:00+09:00');
const servers = [{ label: 'Europe', utc: '+1' }, { label: 'CN/Asia/HMT/SEA', utc: '+8' }];
const times = (start: string, end?: string) => [['2026-01-01T00:00:00+01:00'], [start, ...(end ? [end] : [])]];
const versions = [
  { devTitle: 'ver_3.7_1st_half', time: times('2026-09-30T11:00:00+08:00', '2026-10-22T09:59:59.999+08:00') },
  { devTitle: 'ver_3.7_2nd_half', time: times('2026-10-22T10:00:00+08:00', '2026-11-12T03:59:59.999+08:00') },
];
const data = { servers, list: [
  { id: 1, child: [{ id: 100087, title: '「쇄명」 캐릭터 이벤트 튜닝', time: times('2026-10-22T10:00:00+08:00', '2026-11-11T11:59:59.999+08:00') }] },
  { id: 2, child: [{ id: 100700043, title: '울림의 영역', time: times('2026-10-15T04:00:00+08:00', '2026-10-22T03:59:59.999+08:00') },
    { id: 100700044, title: '흩날리는 선율', time: times('2026-11-04T04:00:00+08:00', '2026-11-11T03:59:59.999+08:00') }] },
  { id: 4, child: [{ id: 111800001, title: '그림자에 피는 꽃', time: times('2026-09-30T11:00:00+08:00') }] },
] };

test('한국어 구조화 경로로 로드맵 누락 2개·예정 픽업·전체 버전 기간 수집', () => {
  const parsed = parseWuwaStructuredCalendar(data, { versions }, url, {}, 'ko-kr', now);
  assert.deepEqual(parsed.events.map((event) => event.title), ['「쇄명」 캐릭터 이벤트 튜닝', '울림의 영역', '흩날리는 선율', '버전 3.7']);
  assert.equal(parsed.events[1]?.startAt, '2026-10-14T20:00:00.000Z');
  assert.equal(parsed.events[1]?.endAt, '2026-10-21T20:00:00.000Z');
  assert.equal(parsed.events[2]?.endAt, '2026-11-10T20:00:00.000Z');
  assert.equal(parsed.events[3]?.endAt, '2026-11-11T20:00:00.000Z');
  assert.equal(parsed.skipped, 0);
  assert.ok(parsed.events.every((event) => event.sourceLanguage === 'ko-kr'));
});

test('원본 ID의 한국어 사전으로 이벤트·픽업에 같은 변환 적용', () => {
  const foreign = { ...data, list: data.list.map((group) => ({ ...group, child: group.child.map((row) => ({ ...row, title: undefined })) })) };
  const parsed = parseWuwaStructuredCalendar(foreign, { versions }, url,
    { 'wuwa:wiki:event:100700043': { title: '울림의 영역', sourceUrl: url }, 'wuwa:wiki:banner:100087': { title: '쇄명 픽업', sourceUrl: url } }, 'und', now);
  assert.equal(parsed.events[0]?.title, '쇄명 픽업');
  assert.equal(parsed.events[1]?.title, '울림의 영역');
  assert.ok(parsed.issues.some((issue) => issue.id.includes('100700044')));
});

test('한국어 common의 경로 없는 엔드콘텐츠도 sourceId로 식별해 현재 명시 기간 우선', () => {
  const commonData = { ...data, list: [...data.list, { id: 3, child: [{ id: 10030000210039, sourceId: 100300002,
    title: '심경의 귀환', time: times('2026-09-14T04:00:00+08:00', '2026-10-12T03:59:59.999+08:00') }] }] };
  const challenge = parseWuwaStructuredCalendar(commonData, { versions }, url, {}, 'ko-kr', now).events.find((event) => event.kind === 'challenge');
  assert.equal(challenge?.title, '역경의 탑');
  assert.equal(challenge?.sourceLanguage, 'ko-kr');
  assert.equal(challenge?.endAt, '2026-10-11T20:00:00.000Z');
  assert.equal(challenge?.periodBasis, 'community-data');
});

test('한쪽 버전 기간 누락·전후반 공백은 완전한 버전 기간으로 만들지 않음', () => {
  assert.equal(parseWuwaStructuredCalendar(data, { versions: [versions[0]] }, url, {}, 'ko-kr', now).events.some((event) => event.kind === 'version'), false);
  const broken = [versions[0], { ...versions[1], time: times('2026-10-23T10:00:00+08:00', '2026-11-12T03:59:59.999+08:00') }];
  assert.equal(parseWuwaStructuredCalendar(data, { versions: broken }, url, {}, 'ko-kr', now).events.some((event) => event.kind === 'version'), false);
});

const event = (title: string, id = title): CalendarEvent => ({ id, game: 'wuwa', kind: 'event', title,
  startAt: '2026-10-07T20:00:00Z', endAt: '2026-10-25T19:59:00Z', sourceUrl: url, sourceLanguage: 'ko-kr', description: '' });

test('요약·개별 공지의 괄호와 띄어쓰기 차이를 제거하고 다른 이벤트는 유지', () => {
  const primary = event('천공의 보물찾기');
  const merged = mergeScheduleSources([primary], [event('[천공의 보물 찾기] 기간 한정 전투 이벤트'), event('무음 제거')]);
  assert.equal(merged.length, 2);
  const selected = merged.find((event) => event.id === primary.id);
  assert.equal(selected?.title, primary.title);
  assert.equal(selected?.collectionSources?.length, 2);
  assert.equal(mergeScheduleSources([], [event('[새알심 용사들의 난투극] 미니 이벤트'), event('이벤트 예고 | 「새알심 용사들의 난투극」 미니 이벤트가 곧 시작됩니다!')]).length, 1);
});

test('동명 다음 주기와 다른 분류는 중복으로 제거하지 않음', () => {
  const first = { ...event('울림의 영역'), localizationKey: 'wuwa:wiki:event:1' };
  const next = { ...first, id: 'next', startAt: '2026-11-01T00:00:00Z', endAt: '2026-11-08T00:00:00Z' };
  assert.equal(mergeScheduleSources([first], [next, { ...first, id: 'banner', kind: 'banner' }]).length, 3);
});

test('같은 종류·기간의 픽업도 이름이 다르면 모두 유지', () => {
  const primary = [{ ...event('「쇄명」 캐릭터 이벤트 튜닝'), kind: 'banner' as const }];
  const notice = { ...event('[내 마음 닿는 곳] 캐릭터 이벤트 튜닝'), kind: 'banner' as const, endAt: '2026-10-25T19:59:59.999Z' };
  assert.equal(mergeWuwaSources(primary, [notice]).length, 2);
  assert.equal(mergeWuwaSources(primary, [notice, { ...notice, id: 'extra', title: '[린네] 캐릭터 이벤트 튜닝' }]).length, 3);
});

const payload = (name: string, start: number, end: number) => ({ banners: [], challenges: [], events: [{ id: 1, name, start_time: start, end_time: end }] });
test('한국어 응답이 성공해도 기간이 비어 있으면 원본 구조화 기간으로 보완', () => {
  const parsed = mergeHoyoStructured('genshin', payload('울림 축제', 0, 0), payload('Resonance Festival', 1791500000, 1791600000), url, `${url}?lang=en-us`, {});
  assert.equal(parsed.events[0]?.title, '울림 축제');
  assert.equal(parsed.events[0]?.sourceLanguage, 'en-us');
  assert.equal(parsed.events[0]?.displayLanguage, 'ko-kr');
  assert.equal(parsed.skipped, 0);
  assert.equal(parsed.repaired, 1);
});

test('한국어 구조화 기간은 원본의 다른 기간으로 덮어쓰지 않음', () => {
  const parsed = mergeHoyoStructured('genshin', payload('울림 축제', 1791500000, 1791600000), payload('Festival', 1791700000, 1791800000), url, `${url}?lang=en-us`, {});
  assert.equal(Date.parse(parsed.events[0]?.startAt ?? '') / 1000, 1791500000);
  assert.equal(parsed.repaired, 0);
});

test('원본에도 기간이 없으면 누락 진단을 유지하고 신규 이름은 확인 대상으로 처리', () => {
  const unresolved = mergeHoyoStructured('genshin', payload('울림 축제', 0, 0), payload('Festival', 0, 0), url, url, {});
  assert.equal(unresolved.skipped, 1);
  const added = mergeHoyoStructured('genshin', { events: [], banners: [], challenges: [] }, payload('Unmapped', 1791500000, 1791600000), url, url, {});
  assert.equal(added.events[0]?.title, '이벤트 · 한국어 이름 확인');
  assert.ok(added.issues.some((issue) => issue.reason.includes('한국어 이름')));
});

test('원본 구조화 버전 종료는 한국어 공식 시작과 대조한 뒤 42일 기본값 대체', () => {
  const initial: CalendarEvent = { ...event('버전 7.1'), game: 'genshin', kind: 'version', startAt: '2026-09-23T03:00:00Z', endAt: '2026-11-04T03:00:00Z', versionEndBasis: 'default-42-days' };
  const raw = { version: '7.1', startTime: '2026-09-23T06:00:00', endTime: '2026-11-04T06:00:00', activities: [] };
  const result = supplementStructuredVersion([initial], raw, url, 'genshin');
  assert.equal(result[0]?.startAt, initial.startAt);
  assert.equal(result[0]?.endAt, '2026-11-03T22:00:00.000Z');
  assert.equal(result[0]?.versionEndBasis, undefined);
  assert.equal(result[0]?.periodBasis, 'community-data');
  assert.equal(supplementStructuredVersion([initial], { ...raw, startTime: '2026-09-24T06:00:00' }, url, 'genshin')[0], initial);
  assert.throws(() => supplementStructuredVersion([initial], { ...raw, endTime: '2026-02-30T06:00:00' }, url, 'genshin'));
});
