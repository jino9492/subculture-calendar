import { test } from 'node:test';
import assert from 'node:assert/strict';
import { learnStructuredActivityNames, parseStructuredActivities, restoreKnownScheduleNames, supplementHoyoCalendar, parseHoyoAnnouncements,
  attachHoyoNames, learnKoreanScheduleNames, parseHoyoCalendar, mergeScheduleSources } from '../src/features/collection';
import type { CalendarEvent } from '../shared/calendar';

const url = 'https://example.com/ann';
const period = { startAt: '2099-01-01T03:00:00.000Z', endAt: '2099-01-15T03:00:00.000Z' };
const activity = { name: 'Unseen Event', startTime: '2099-01-01T11:00:00', endTime: '2099-01-15T11:00:00' };
const article = (id: string, title: string) => ({ id, title, description: '', url });
const native = (title: string, kind: 'event' | 'banner' = 'event'): CalendarEvent => ({ ...period, id: title, game: 'genshin', kind, title, sourceUrl: url, sourceLanguage: 'ko-kr', description: '' });

test('공식 공지 동일 ID로 원본 이름을 한국어로 연결하며 새 원본 ID에도 적용', () => {
  const ko = [article('900', '「새 축제」 이벤트: 보상 획득'), article('901', '「잘못된 연결」 이벤트')];
  const en = [article('900', '"Unseen Event" Event: Rewards'), article('902', '"Other Event" Event')];
  const names = learnStructuredActivityNames('genshin', undefined, {}, ko, en);
  const parsed = parseStructuredActivities({ activities: [{ ...activity, id: 55000 }] }, url, 'genshin', names);
  assert.equal(parsed.events[0]?.title, '새 축제');
  assert.equal(parsed.issues.length, 0);
  assert.equal(parseStructuredActivities({ activities: [{ ...activity, name: 'Other Event' }] }, url, 'genshin', names).issues.length, 1);
});

test('동일 원본 이름의 공식 한국어 대응이 모호하면 자동 연결하지 않음', () => {
  const names = learnStructuredActivityNames('genshin', undefined, {}, [article('1', '「첫 행사」'), article('2', '「다른 행사」')],
    [article('1', '"Unseen Event"'), article('2', '"Unseen Event"')]);
  assert.equal(parseStructuredActivities({ activities: [activity] }, url, 'genshin', names).issues.length, 1);
});

test('영문 공지 조회는 요청 언어를 검증하며 기본 조회는 한국어 유지', () => {
  const raw = { retcode: 0, data: { list: [{ ann_id: 1, lang: 'en-us', title: '"Unseen Event"', content: '' }] } };
  assert.equal(parseHoyoAnnouncements(raw, url).length, 0);
  assert.equal(parseHoyoAnnouncements(raw, url, 'en-us').length, 1);
});

test('재수집의 이름 대응 누락은 같은 일정의 기존 한국어 제목을 유지하며 새 주기는 보호', () => {
  const known = { ...native('검증된 행사'), localizationKey: 'sra:genshin:event:known' };
  const unknown = { ...known, title: '이벤트 · 한국어 이름 확인', sourceLanguage: 'en-us' };
  assert.equal(restoreKnownScheduleNames([known], [unknown])[0]?.title, known.title);
  assert.equal(restoreKnownScheduleNames([known], [{ ...unknown, id: 'another-source' }])[0]?.title, known.title);
  assert.equal(restoreKnownScheduleNames([known], [{ ...unknown, id: 'next-cycle', startAt: '2099-02-01T03:00:00.000Z' }])[0]?.title, unknown.title);
  assert.equal(restoreKnownScheduleNames([known], [{ ...unknown, id: 'other', localizationKey: 'different' }])[0]?.title, unknown.title);
});

test('제목에서 일반 기원을 언급한 이벤트는 기간 헤더 기준으로 이벤트 분류', () => {
  const parsed = supplementHoyoCalendar('genshin', { events: [], issues: [], skipped: 0 }, [{ id: 'new', url,
    title: '「새로운 여행」 이벤트: 일반 기원 캐릭터 초대', description: '이벤트 기간: 2099/01/01 11:00 ~ 2099/01/15 11:00' }], []);
  assert.equal(parsed.events[0]?.kind, 'event');
});

test('공지 속 픽업 대상·기간으로 캐릭터 이름과 픽업 이름을 연결하고 다른 동시 픽업은 보존', () => {
  const first = native('새 캐릭터', 'banner');
  const weapon = native('첫 무기 · 둘째 무기', 'banner');
  const description = '기원 기간: 2099/01/01 11:00 ~ 2099/01/15 11:00';
  const announcements = [article('1', '「새 기원」 기원: 「빛의 검·새 캐릭터(바람)」 확률 UP!'),
    article('2', '「무기 기원」 기원: 「한손검·첫 무기」, 「법구·둘째 무기」 확률 UP!'),
    article('3', '「또 다른 기원」 기원: 「다른 캐릭터」 확률 UP!')].map((item) => ({ ...item, description }));
  const result = supplementHoyoCalendar('genshin', { events: [first, weapon], issues: [], skipped: 0 }, announcements, []);
  assert.equal(result.events.length, 3);
  assert.equal(result.events[0]?.title, first.title);
  assert.equal(result.events[1]?.title, weapon.title);
  assert.ok(result.events[2]?.title.includes('다른 캐릭터'));
});

test('원본 피드의 엔드콘텐츠는 동일 구조화 ID의 한국어 종류·부제로 연결하고 이벤트 중복 제외', () => {
  const data = (name: string) => ({ events: [], banners: [], challenges: [{ id: 55000, type_name: 'ChallengeTypeStory', name,
    start_time: Date.parse(period.startAt) / 1000, end_time: Date.parse(period.endAt) / 1000 }] });
  const native = parseHoyoCalendar('starrail', attachHoyoNames('starrail', data('새 부제'), {}, 'ko-kr'), url);
  const names = learnStructuredActivityNames('starrail', data('Future Chapter'), learnKoreanScheduleNames(native.events, {}));
  const parsed = parseStructuredActivities({ activities: [{ ...activity, name: 'Pure Fiction: Future Chapter' }] }, url, 'starrail', names);
  assert.equal(parsed.events[0]?.title, '허구 이야기 · 새 부제');
  assert.equal(parsed.events[0]?.kind, 'challenge');
  assert.equal(mergeScheduleSources(native.events, parsed.events).length, 1);
  const cached = learnKoreanScheduleNames(parsed.events, {});
  assert.equal(parseStructuredActivities({ activities: [{ ...activity, name: 'Pure Fiction: Future Chapter' }] }, url, 'starrail', cached).events[0]?.kind, 'challenge');
});
