import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GAME_IDS, isCalendarEvent, type CalendarEvent } from '../shared/calendar';
import { reconcileSchedules, resolveScheduleId, supplementHoyoCalendar, learnStructuredActivityNames, parseStructuredActivities,
  parseHoyoCalendar, attachHoyoNames, learnKoreanScheduleNames } from '../src/features/collection';
import { mergeManagedEvents, normalizeAdminState, applyAdminAction } from '../server/admin-store';

const make = (id: string, title = '미래의 행사'): CalendarEvent => ({ id, title, game: 'genshin', kind: 'event',
  startAt: '2099-01-01T03:00:00.000Z', endAt: '2099-02-01T03:00:00.000Z', description: '',
  sourceUrl: 'https://example.com/structured', sourceLanguage: 'ko-kr', collectionMethod: 'structured', localizationKey: `hoyo:genshin:events:${id}` });
const notice = (id: string, title: string): CalendarEvent => ({ ...make(id, title), localizationKey: undefined,
  collectionMethod: 'announcement', sourceUrl: 'https://example.com/notice' });

test('다섯 게임의 신규 API·공지 제목을 공통 병합하고 다음 주기·동시 다른 일정을 보존', () => {
  for (const game of GAME_IDS) for (let i = 0; i < 10; i++) {
    const title = `처음 보는 축제 ${i}`;
    const primary = { ...make(`new-${i}`, title), game };
    const fallback = { ...notice(`notice-${i}`, `「${title}」 이벤트: 새 소식`), game,
      endAt: '2099-02-01T02:59:00.000Z', imageUrls: ['https://example.com/banner.png'] };
    const next = { ...primary, id: `next-${i}`, startAt: '2099-02-01T03:00:00.000Z', endAt: '2099-03-01T03:00:00.000Z' };
    const other = { ...make(`other-${i}`, `동시 축제 ${i}`), game };
    const result = reconcileSchedules([fallback, next, primary, other]);
    assert.equal(result.events.length, 3);
    const selected = result.events.find((row) => row.id === primary.id);
    assert.equal(selected?.title, title);
    assert.equal(selected?.endAt, primary.endAt);
    assert.deepEqual(selected?.imageUrls, fallback.imageUrls);
    assert.equal(resolveScheduleId(result.events, fallback.id), primary.id);
    assert.equal(result.issues.length, 0);
    assert.deepEqual(reconcileSchedules([other, primary, next, fallback]), result);
    assert.deepEqual(reconcileSchedules(result.events), result);
  }
});

test('확인된 콘텐츠 ID로 시차·종료 분 단위 차이를 병합하고 서로 다른 ID는 보존', () => {
  const primary = make('native');
  const foreign = { ...make('sra'), sourceLanguage: 'en-us', sourceUrl: 'https://example.com/original',
    identityKey: primary.localizationKey, localizationKey: 'sra:genshin:event:new',
    startAt: '2098-12-31T20:00:00.000Z', endAt: '2099-01-31T19:59:59.000Z' };
  const merged = reconcileSchedules([foreign, primary]);
  assert.equal(merged.events.length, 1);
  assert.equal(merged.events[0]?.id, primary.id);
  assert.equal(merged.events[0]?.collectionSources?.length, 2);
  assert.equal(reconcileSchedules([make('different-id'), primary]).events.length, 2);
});

test('같은 인용구의 별도 행사·미확인 이름·상위 기간 안의 별도 활동 기간을 보존', () => {
  const first = notice('first', '「공통 주제」 첫 행사');
  const second = notice('second', '「공통 주제」 둘째 행사');
  const unknown = ['a', 'b'].map((id) => ({ ...make(id, '이벤트 · 한국어 이름 확인'), sourceLanguage: 'en-us' }));
  const subperiod = { ...notice('phase', '미래의 행사 · 보너스 활동'), endAt: '2099-01-08T03:00:00.000Z' };
  assert.equal(reconcileSchedules([first, second, ...unknown, make('main'), subperiod]).events.length, 6);
});

test('동명 후보가 여러 개이면 임의 삭제하지 않고 관리자 확인 항목 생성', () => {
  const first = make('native-a');
  const second = make('native-b');
  const fallback = notice('notice', first.title);
  const result = reconcileSchedules([first, second, fallback]);
  assert.equal(result.events.length, 3);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]?.eventId, fallback.id);
  assert.deepEqual(reconcileSchedules([fallback, second, first]), result);
});

test('병합된 공지 ID로 저장한 관리자 수정·숨김이 중복을 다시 만들지 않음', () => {
  const primary = make('native');
  const fallback = notice('old-notice', primary.title);
  const collected = reconcileSchedules([primary, fallback]).events;
  const state = { reviews: {}, overrides: { [fallback.id]: { event: { ...fallback, title: '수정한 제목' }, hidden: false } } };
  const managed = mergeManagedEvents(collected, state);
  assert.equal(managed.length, 1);
  assert.equal(managed[0]?.id, primary.id);
  assert.equal(managed[0]?.title, '수정한 제목');
  assert.equal(managed[0]?.collectionSources?.length, 2);
  assert.equal(mergeManagedEvents(collected, { ...state, overrides: { [fallback.id]: { event: fallback, hidden: true } } }).length, 0);
  const normalized = normalizeAdminState(state, collected);
  assert.deepEqual(Object.keys(normalized.overrides), [primary.id]);
  assert.equal(Object.keys(applyAdminAction(normalized, { action: 'reset', id: primary.id }).overrides).length, 0);
});

test('공지 설명을 기간 헤더로 오인하지 않고 다음 구획의 날짜를 가져오지 않음', () => {
  const parsed = supplementHoyoCalendar('starrail', { events: [], issues: [], skipped: 0 }, [{ id: 'future', title: '99.1 버전 업데이트',
    url: 'https://example.com/notice', description: '■ 새 출석 행사\n이벤트 기간: 2099/01/01 11:00 ~ 2099/01/15 11:00 (KST)\n이벤트 기간 동안 매일 접속하세요\n■ 다음 콘텐츠\n2099/01/20 11:00 ~ 2099/02/15 11:00 (KST)' }], []);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0]?.title, '새 출석 행사');
  assert.equal(parsed.events[0]?.endAt, '2099-01-15T02:00:00.000Z');
});

test('공지의 전체 개방 기간과 별도 활동 기간을 다른 이름으로 보존', () => {
  const parsed = supplementHoyoCalendar('genshin', { events: [], issues: [], skipped: 0 }, [{ id: 'future', title: '「새 도전」 이벤트: 신규 안내',
    url: 'https://example.com/notice', description: '이벤트 기간\n콘텐츠 개방 기간: 2099/01/01 11:00 ~ 2099/02/01 11:00 (KST)\n특별 활동 기간: 2099/01/01 11:00 ~ 2099/01/08 11:00 (KST)' }], []);
  assert.equal(parsed.events.length, 2);
  assert.equal(new Set(parsed.events.map((row) => row.title)).size, 2);
  assert.ok(parsed.events.some((row) => row.title.endsWith(' · 특별 활동')));
});

test('신규 원본 이벤트 번역은 이름뿐 아니라 구조화 콘텐츠 ID도 연결', () => {
  const payload = (name: string) => ({ events: [{ id: 99999, name, start_time: 4070923200, end_time: 4072132800 }], banners: [], challenges: [] });
  const native = parseHoyoCalendar('genshin', attachHoyoNames('genshin', payload('새로운 콘텐츠'), {}, 'ko-kr'), 'https://example.com/native');
  const names = learnStructuredActivityNames('genshin', payload('Never Seen Content'), learnKoreanScheduleNames(native.events, {}));
  const parsed = parseStructuredActivities({ activities: [{ name: 'Never Seen Content', startTime: native.events[0]?.startAt.replace('.000Z', 'Z'),
    endTime: native.events[0]?.endAt.replace('.000Z', 'Z') }] }, 'https://example.com/original', 'genshin', names);
  assert.equal(parsed.events[0]?.identityKey, native.events[0]?.localizationKey);
  assert.equal(reconcileSchedules([...native.events, ...parsed.events]).events.length, 1);
});

test('실제 다섯 게임 수집 자료에서도 전체 병합 결과는 순서 독립·재실행 동일', () => {
  const raw: unknown = JSON.parse(readFileSync(new URL('./fixtures/collected-schedules.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(raw) && raw.every(isCalendarEvent));
  const result = reconcileSchedules(raw);
  assert.equal(new Set(result.events.map((row) => row.game)).size, 5);
  assert.deepEqual(reconcileSchedules([...raw].reverse()), result);
  assert.deepEqual(reconcileSchedules(result.events), result);
  const retained = new Set(result.events.flatMap((row) => [row.id, ...(row.collectionSources ?? []).map((source) => source.id)]));
  assert.ok(raw.every((row) => retained.has(row.id)));
  for (const title of ['허구 이야기 · 입계의 서막', '혼돈의 기억 · 내세로의 도하', '종말의 환영 · 지배와 망각'])
    assert.equal(result.events.filter((row) => row.title === title).length, 1);
  assert.equal(result.events.filter((row) => row.title.includes('꿈속에서 메아리가 울린다면')).length, 1);
});

test('중간 후보를 통한 연쇄 병합은 재실행해도 발생하지 않음', () => {
  const base = make('base');
  const same = (id: string, shift: number) => ({ ...base, id, identityKey: base.localizationKey,
    sourceUrl: `https://example.com/${id}`, startAt: new Date(Date.parse(base.startAt) + shift * 86400000).toISOString(),
    endAt: new Date(Date.parse(base.endAt) + shift * 86400000).toISOString() });
  const result = reconcileSchedules([same('a', 1), same('b', 0), same('c', 2)]);
  assert.equal(result.events.length, 2);
  assert.deepEqual(reconcileSchedules(result.events).events, result.events);
});

test('원본 ID가 다음 주기에 재사용되어도 두 일정을 보존', () => {
  const first = make('reused');
  const next = { ...first, startAt: first.endAt, endAt: '2099-03-01T03:00:00.000Z' };
  const result = reconcileSchedules([first, next]);
  assert.equal(result.events.length, 2);
  assert.equal(new Set(result.events.map((row) => row.id)).size, 2);
  assert.deepEqual(reconcileSchedules(result.events).events, result.events);
});

test('이름 안의 가운데점은 보존하고 공지 뒤에 붙은 별도 활동 이름만 분리', () => {
  const primary = make('native', '새로운 도전 · 전편');
  const fallback = notice('notice', '「새로운 도전 · 전편」 이벤트: 안내');
  const phase = notice('phase', '「새로운 도전 · 전편」 이벤트: 안내 · 특별 활동');
  const result = reconcileSchedules([primary, fallback, phase]);
  assert.equal(result.events.length, 2);
  assert.equal(result.events.find((event) => event.id === primary.id)?.collectionSources?.length, 2);
});

test('공지의 설명·보상 안내 제목도 구조화 콘텐츠의 전체 이름과 기간으로 병합', () => {
  for (const game of GAME_IDS) for (let i = 0; i < 10; i++) {
    const native = { ...make(`native-${i}`, `신규 콘텐츠 ${i}`), game };
    const notices = [': 노력에 따른 보상', ' 참여 시 선택형 세트 「새 보상」 획득 가능', ' 전투 이벤트'].map((suffix, index) =>
      ({ ...notice(`notice-${index}`, `「${native.title}」${suffix}`), game }));
    const result = reconcileSchedules([native, ...notices]);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0]?.collectionSources?.length, 4);
    assert.deepEqual(reconcileSchedules([...notices].reverse().concat(native)), result);
    assert.deepEqual(reconcileSchedules(result.events), result);
  }
});

test('부분 인용된 이름과 여러 구조화 ID는 안내 제목으로 임의 연결하지 않음', () => {
  const primary = make('native', '「새로운 테마」 랜드');
  const child = notice('child', '「새로운 테마」 랜드: 특별 선물');
  assert.equal(reconcileSchedules([primary, child]).events.length, 2);
  assert.equal(reconcileSchedules([make('a'), make('b'), notice('notice', '「미래의 행사」: 보상 안내')]).events.length, 3);
});

test('실제 전체 자료의 중복·하위 기간·날짜 충돌을 구분', () => {
  const raw: unknown = JSON.parse(readFileSync(new URL('./fixtures/audited-schedules.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(raw) && raw.every(isCalendarEvent));
  const result = reconcileSchedules(raw);
  for (const title of ['수행의 길', '코스튬 선물·맑음', '「점묘 신청」 재구축 신청#1']) {
    const matching = result.events.filter((event) => event.title === title);
    assert.equal(matching.length, 1);
    assert.ok((matching[0]?.collectionSources?.length ?? 0) >= 2);
  }
  const parent = result.events.find((event) => event.title === '지맥 제압전');
  const phase = result.events.find((event) => event.title === '지맥 제압전 · 혼란 폭주');
  assert.ok(parent && phase);
  assert.ok(Date.parse(phase.endAt) < Date.parse(parent.endAt));
  assert.equal(result.events.filter((event) => event.title.includes('군성 공진 시뮬레이션 영역')).length, 2);
  assert.ok(result.issues.some((issue) => issue.id.startsWith('reconciliation:period:') && issue.title.includes('군성 공진')));
  assert.deepEqual(reconcileSchedules([...raw].reverse()), result);
  assert.deepEqual(reconcileSchedules(result.events), result);
  const retained = new Set(result.events.flatMap((event) => [event.id, ...(event.collectionSources ?? []).map((source) => source.id)]));
  assert.ok(raw.every((event) => retained.has(event.id)));
});

test('새 이벤트의 하위 기간 이름을 정리해도 별도 종료 경계와 원본 제목을 보존', () => {
  for (const game of GAME_IDS) for (let i = 0; i < 10; i++) {
    const parent = { ...make(`parent-${i}`, `신규 도전 ${i}`), game };
    const phase = { ...notice(`phase-${i}`, `「${parent.title}」 이벤트: 소개 · 특별 도전`), game, endAt: '2099-01-08T03:00:00Z' };
    const result = reconcileSchedules([parent, phase]);
    assert.equal(result.events.length, 2);
    const child = result.events.find((event) => event.id === phase.id);
    assert.equal(child?.title, `${parent.title} · 특별 도전`);
    assert.equal(child?.endAt, phase.endAt);
    assert.equal(child?.collectionSources?.[0]?.title, phase.title);
    assert.deepEqual(reconcileSchedules(result.events), result);
  }
});
