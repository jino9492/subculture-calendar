import { test } from 'node:test';
import assert from 'node:assert/strict';
import { learnStructuredActivityNames, parseStructuredActivities, parseWuwaBannerAliases, mergeWuwaSources, isPendingScheduleName,
  supplementHoyoCalendar } from '../src/features/collection';
import type { CalendarEvent } from '../shared/calendar';

const url = 'https://example.com/ann';
const period = '2099/01/01 11:00 ~ 2099/01/15 11:00';
const ann = (title: string, description: string) => ({ id: '10001', title, description, url });
const event = (id: string, title: string): CalendarEvent => ({ id, title, game: 'wuwa', kind: 'banner', startAt: '2099-01-01T03:00:00.000Z',
  endAt: '2099-01-15T03:00:00.000Z', sourceUrl: url, sourceLanguage: 'ko-kr', description: '', localizationKey: `wuwa:wiki:banner:${id}` });

test('업데이트 본문 제목·구획·기간을 대조하여 새 이벤트 이름과 하위 이벤트를 연결', () => {
  const ko = ann('업데이트', `■ 새 행사: 기념 선물\n이벤트 기간\n${period}\n■ 다음 행사\n이벤트 기간\n${period}`);
  const en = ann('Update', `■ Future Festival: Souvenir\nEvent Period\n${period}\n■ Next Festival\nEvent Period\n${period}`);
  const names = learnStructuredActivityNames('starrail', undefined, {}, [ko], [en]);
  const parsed = parseStructuredActivities({ activities: [{ name: 'Future Festival: Souvenir', startTime: '2099-01-01T11:00:00', endTime: '2099-01-15T11:00:00' }] }, url, 'starrail', names);
  assert.equal(parsed.events[0]?.title, '새 행사: 기념 선물');
  assert.equal(parsed.issues.length, 0);
  assert.equal(Object.keys(learnStructuredActivityNames('starrail', undefined, {}, [ko], [{ ...en, description: `■ Wrong\n${period}` }])).length, 0);
  assert.equal(Object.keys(learnStructuredActivityNames('starrail', undefined, {}, [{ ...ko, description: ko.description.replace('2099/01/15', '2099/01/16') }], [en])).length, 1);
});

test('공지 설명 대신 장식 헤더를 이벤트 이름으로 사용', () => {
  const article = ann('99.1 버전 업데이트', `■ 새 행사\n컴퍼니에서 「다른 이름」 이벤트를 기획했다\n이벤트 기간\n${period}`);
  const parsed = supplementHoyoCalendar('starrail', { events: [], issues: [], skipped: 0 }, [article], []);
  assert.equal(parsed.events[0]?.title, '새 행사');
});

test('상대 시작·수령 기간·종료 없는 개방 구획도 동일 버전으로 이름 연결', () => {
  const ko = ann('업데이트', '■ 새 행사\n개방 기간: 99.1 버전 업데이트 후 ~ 2099/02/01 11:00\n■ 상시 게임\n개방 시간: 99.1 버전 업데이트 후');
  const en = ann('Update', '■ New Event\nAvailability: After the Version 99.1 update – 2099/02/01 11:00\n■ Permanent Mode\nAvailability: After the Version 99.1 update');
  const names = learnStructuredActivityNames('starrail', undefined, {}, [ko], [en]);
  assert.equal(names['sra:starrail:event:New%20Event']?.title, '새 행사');
  assert.equal(names['sra:starrail:event:Permanent%20Mode']?.title, '상시 게임');
});

test('명조 5성 대상과 튜닝 이름 연결로 중복 제거하며 4성 캐릭터와 다른 주기는 유지', () => {
  const aliases = parseWuwaBannerAliases({ id: 'new', title: '[신규 튜닝] 캐릭터 이벤트 튜닝', content:
    '<p>이벤트 기간 동안 5성 캐릭터 「새 캐릭터」, 4성 캐릭터 「다른 캐릭터」의 튜닝 확률 UP!</p>' });
  const first = event('primary', '「새 캐릭터」 캐릭터 이벤트 튜닝');
  const fallback = { ...event('notice', '[신규 튜닝] 캐릭터 이벤트 튜닝'), endAt: '2099-01-15T02:59:00.000Z' };
  const merged = mergeWuwaSources([first], [fallback], aliases);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.id, first.id);
  assert.equal(merged[0]?.endAt, first.endAt);
  assert.deepEqual(merged[0]?.collectionSources?.map((source) => source.id).sort(), ['notice', 'primary']);
  assert.equal(mergeWuwaSources([event('other', '「다른 캐릭터」 캐릭터 이벤트 튜닝')], [fallback], aliases).length, 2);
  assert.equal(mergeWuwaSources([first], [{ ...fallback, startAt: '2099-02-01T03:00:00.000Z', endAt: '2099-02-15T03:00:00.000Z' }], aliases).length, 2);
  assert.equal(mergeWuwaSources([first], [fallback], [...aliases, { title: fallback.title, targetTitle: '「다른 캐릭터」 캐릭터 이벤트 튜닝' }]).length, 2);
  const previous = { ...first, id: 'previous', localizationKey: 'wuwa:wiki:banner:previous',
    startAt: '2098-12-01T03:00:00.000Z', endAt: '2098-12-15T03:00:00.000Z' };
  const repeated = mergeWuwaSources([previous, first], [fallback], aliases);
  assert.equal(repeated.length, 2);
  assert.equal(repeated.find((event) => event.id === first.id)?.collectionSources?.length, 2);
});

test('한 공지의 여러 픽업은 각 구획의 대상만 연결', () => {
  const aliases = parseWuwaBannerAliases({ id: 'new', title: '픽업 요약', content:
    '<p>[첫 튜닝] 캐릭터 이벤트 튜닝</p><p>5성 캐릭터 「캐릭터 A」, 4성 캐릭터 「캐릭터 B」</p>'
    + '<p>[둘째 튜닝] 캐릭터 이벤트 튜닝</p><p>5성 캐릭터 「캐릭터 B」</p>' });
  assert.equal(aliases[0]?.targetTitle, '「캐릭터 A」 캐릭터 이벤트 튜닝');
  assert.equal(aliases[1]?.targetTitle, '「캐릭터 B」 캐릭터 이벤트 튜닝');
});

test('미확인 이름은 공개 달력 대상에서만 제외하고 보정된 이름은 표시 대상', () => {
  const pending = { ...event('pending', '이벤트 · 한국어 이름 확인'), kind: 'event' as const, sourceLanguage: 'en-us' };
  assert.equal(isPendingScheduleName(pending), true);
  assert.equal(isPendingScheduleName({ ...pending, title: '확인한 이름', displayLanguage: 'ko-kr' }), false);
  assert.equal([pending].length, 1);
});
