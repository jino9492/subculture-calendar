import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_KINDS, isCalendarEvent, isImageUrl, type CalendarEvent } from '../shared/calendar';
import { parseHoyoCalendar, parseStructuredActivities, mergeScheduleSources, reconcileSchedules } from '../src/features/collection';
import { refreshCustomSchedules } from '../src/features/collection/custom-schedules';
import { CUSTOM_SCHEDULE_IMAGES } from '../shared/schedule-images';

const source = 'https://example.com/calendar';
const image = 'https://example.com/event.png';
const imageEvent = (overrides: Partial<CalendarEvent>): CalendarEvent => ({ id: 'test', game: 'genshin', kind: 'challenge',
  title: '시험', description: '', sourceLanguage: 'ko-kr', startAt: '2026-09-30T02:00:00.000Z', endAt: '2026-11-02T19:59:59.000Z', sourceUrl: source, ...overrides });
const payload = { events: [{ id: 1, name: '시험 이벤트', start_time: 1790740800, end_time: 1790900000, image_url: image }],
  challenges: [], banners: [{ id: 2, start_time: 1790740800, end_time: 1790900000,
    agents: [{ id: 10, name: '첫 캐릭터', rarity: 'S', icon: image }, { id: 11, name: '둘째 캐릭터', rarity: 'S', icon: 'https://example.com/second.png' },
      { id: 12, name: '보조 캐릭터', rarity: 'A', icon: 'https://example.com/extra.png' }] }] };

test('버전 분류를 가장 먼저 배치', () => { assert.equal(EVENT_KINDS[0], 'version'); });

test('원신 기본 표지와 지맥 제압전 두 버전 이미지 공유', () => {
  const events = [imageEvent({ title: '연월 나선' }), imageEvent({ title: '현실 속 환상극', imageUrls: [] }),
    imageEvent({ title: '현실 속 환상극', imageUrls: [image] }),
    imageEvent({ title: '지맥 제압전', kind: 'event', imageUrls: [image] }),
    imageEvent({ title: '「지맥 제압전」 이벤트: 혼돈의 지맥을 향한 도전 · 혼란 폭주', kind: 'event' }),
    imageEvent({ title: 'Stygian Onslaught: Dire', imageUrls: [] }),
    imageEvent({ title: '나선 비경', kind: 'event' }), imageEvent({ title: '다른 도전' }),
    imageEvent({ title: '연월 나선', game: 'starrail' })];
  const result = refreshCustomSchedules('genshin', events, 1790740800000);
  assert.deepEqual(result.map((event) => event.imageUrls), [[CUSTOM_SCHEDULE_IMAGES.genshinSpiralAbyss],
    [CUSTOM_SCHEDULE_IMAGES.genshinImaginariumTheater], [image], [image], [image], [image], undefined, undefined, undefined]);
  assert.ok(result.every(isCalendarEvent));
  assert.equal(events[4]?.imageUrls, undefined);
  assert.deepEqual(refreshCustomSchedules('genshin', [...events].reverse(), 1790740800000), [...result].reverse());
  assert.deepEqual(refreshCustomSchedules('genshin', result, 1790740800000), result);
  assert.equal(refreshCustomSchedules('genshin', [events[4]!], 1790740800000)[0]?.imageUrls, undefined);
});

test('엔드필 전쟁의 메아리 시즌만 기본 표지 적용하고 실제 이미지 유지', () => {
  const events = [imageEvent({ game: 'endfield', title: '전쟁의 메아리 · 허상의 회상' }),
    imageEvent({ game: 'endfield', title: '[Season of Illusion] (Echoes of War)', imageUrls: [] }),
    imageEvent({ game: 'endfield', title: '전쟁의 메아리 · 착시의 회상', imageUrls: [image] }),
    imageEvent({ game: 'endfield', title: '전쟁의 메아리', kind: 'event' }),
    imageEvent({ game: 'starrail', title: '전쟁의 메아리' }), imageEvent({ game: 'endfield', title: '다른 도전' })];
  const result = refreshCustomSchedules('endfield', events, 1790740800000);
  assert.deepEqual(result.map((event) => event.imageUrls), [[CUSTOM_SCHEDULE_IMAGES.endfieldEchoesOfWar],
    [CUSTOM_SCHEDULE_IMAGES.endfieldEchoesOfWar], [image], undefined, undefined, undefined]);
  assert.ok(result.every(isCalendarEvent));
  assert.equal(events[0]?.imageUrls, undefined);
  assert.deepEqual(refreshCustomSchedules('endfield', result, 1790740800000), result);
});

test('프로젝트에 등록한 custom 이미지 경로만 로컬 이미지로 허용', () => {
  assert.equal(isImageUrl('/images/custom/starrail-weekly.png'), true);
  assert.equal(isImageUrl('/images/custom/zenless-weekly.png'), true);
  for (const path of ['/images/custom/unknown.png', '/images/custom/../secret.png', '//example.com/image.png']) {
    assert.equal(isImageUrl(path), false);
  }
});

test('혼돈의 기억만 이미지 누락 시 기본 표지 적용하고 원본 표지 우선', () => {
  const parsed = parseHoyoCalendar('starrail', { events: [], banners: [], challenges: [
    { id: 1, type_name: 'ChallengeTypeChasm', name: '내세로의 도하', start_time: 1790740800, end_time: 1790900000 },
    { id: 2, type_name: 'ChallengeTypeChasm', name: '적자생존', start_time: 1790900000, end_time: 1791100000, image_url: image },
    { id: 3, type_name: 'ChallengeTypeStory', name: '입계의 서막', start_time: 1790740800, end_time: 1790900000 },
  ] }, source).events;
  assert.ok(parsed[0]);
  const english = { ...parsed[0], id: 'english', title: 'Memory of Chaos: Crossing the Afterlife', imageUrls: [] };
  const otherGame = { ...parsed[0], id: 'other-game', game: 'genshin' as const };
  const otherKind = { ...parsed[0], id: 'other-kind', kind: 'event' as const };
  const result = refreshCustomSchedules('starrail', [...parsed, english, otherGame, otherKind], 1790740800000);
  assert.deepEqual(result[0]?.imageUrls, [CUSTOM_SCHEDULE_IMAGES.starrailMemoryOfChaos]);
  assert.deepEqual(result[1]?.imageUrls, [image]);
  assert.equal(result[2]?.imageUrls, undefined);
  assert.deepEqual(result[3]?.imageUrls, [CUSTOM_SCHEDULE_IMAGES.starrailMemoryOfChaos]);
  assert.equal(result[4]?.imageUrls, undefined);
  assert.equal(result[5]?.imageUrls, undefined);
  assert.ok(result.every(isCalendarEvent));
  assert.equal(parsed[0]?.imageUrls, undefined);
  assert.deepEqual(refreshCustomSchedules('starrail', result, 1790740800000), result);
});

test('이벤트 대표 이미지와 픽업 최고 등급 캐릭터 이미지 수집', () => {
  const result = parseHoyoCalendar('zenless', payload, source);
  assert.deepEqual(result.events[0]?.imageUrls, [image]);
  assert.deepEqual(result.events[1]?.imageUrls, [image, 'https://example.com/second.png']);
  assert.ok(result.events.every(isCalendarEvent));
});

test('젠존제 세 엔드 콘텐츠에 각각 기본 표지 적용하고 원본 표지와 임계 시뮬레이션 유지', () => {
  const challenges = [
    { type_name: 'annihilation_simulacrum', name: '모의 세계 섬멸전' },
    { type_name: 'shiyu_defense', name: '시유 방어전' },
    { type_name: 'deadly_assault', name: '위험한 강습전' },
    { type_name: 'threshold_simulation', name: '임계 시뮬레이션' },
    { type_name: 'shiyu_defense', name: '시유 방어전', image_url: image },
  ].map((item, id) => ({ ...item, id, start_time: 1790740800, end_time: 1790900000 }));
  const parsed = parseHoyoCalendar('zenless', { events: [], banners: [], challenges }, source).events;
  assert.ok(parsed[0]);
  const english = { ...parsed[0], id: 'english', title: 'Deadly Assault', imageUrls: [] };
  const keyed = { ...parsed[0], id: 'keyed', title: '엔드콘텐츠 · 한국어 이름 확인',
    localizationKey: 'hoyo:zenless:challenges:shiyu_defense:3' };
  const otherGame = { ...parsed[0], id: 'other-game', game: 'starrail' as const };
  const otherKind = { ...parsed[0], id: 'other-kind', kind: 'event' as const };
  const now = 1790740800000;
  const result = refreshCustomSchedules('zenless', [...parsed, english, keyed, otherGame, otherKind], now);
  assert.deepEqual(result.slice(0, 9).map((event) => event.imageUrls), [
    [CUSTOM_SCHEDULE_IMAGES.zenlessAnnihilationSimulacrum],
    [CUSTOM_SCHEDULE_IMAGES.zenlessShiyuDefense],
    [CUSTOM_SCHEDULE_IMAGES.zenlessDeadlyAssault],
    undefined, [image], [CUSTOM_SCHEDULE_IMAGES.zenlessDeadlyAssault],
    [CUSTOM_SCHEDULE_IMAGES.zenlessShiyuDefense], undefined, undefined,
  ]);
  assert.ok(result.every(isCalendarEvent));
  assert.equal(parsed[0].imageUrls, undefined);
  assert.deepEqual(refreshCustomSchedules('zenless', result, now), result);
});

test('서로 다른 출처의 대표 이미지 URL을 합치지 않고 우선 출처의 목록 선택', () => {
  const native = parseHoyoCalendar('zenless', payload, source).events[0];
  assert.ok(native);
  const fallback = { ...native, id: 'supplementary', sourceLanguage: 'en-us', sourceUrl: 'https://example.com/original',
    imageUrls: ['https://another.example.com/copy.jpg'] };
  const result = reconcileSchedules([fallback, native]);
  assert.equal(result.events.length, 1);
  assert.deepEqual(result.events[0]?.imageUrls, [image]);
  assert.deepEqual(reconcileSchedules([native, fallback]), result);
  assert.deepEqual(reconcileSchedules(result.events), result);
});

test('픽업의 서로 다른 최고 등급 대상 이미지는 함께 유지', () => {
  const banner = parseHoyoCalendar('zenless', payload, source).events[1];
  assert.ok(banner);
  const fallback = { ...banner, id: 'supplementary', sourceLanguage: 'en-us',
    imageUrls: ['https://another.example.com/copy.jpg'] };
  assert.deepEqual(mergeScheduleSources([banner], [fallback])[0]?.imageUrls, [image, 'https://example.com/second.png']);
});

test('이미지는 선택 필드이며 잘못된 URL은 수집에서 제외하고 저장 검증에서도 거부', () => {
  const result = parseHoyoCalendar('zenless', { ...payload, events: [{ ...payload.events[0], image_url: 'javascript:alert(1)' }] }, source);
  const event = result.events[0];
  assert.ok(event);
  assert.equal(event.imageUrls, undefined);
  assert.equal(isCalendarEvent(event), true);
  for (const url of ['javascript:alert(1)', 'http://example.com/a.png', 'https://user:pass@example.com/a.png', '/relative.png']) {
    assert.equal(isImageUrl(url), false);
    assert.equal(isCalendarEvent({ ...event, imageUrls: [url] }), false);
  }
});

test('원본 피드의 cover와 시각 근거를 보존하고 한국어 이름과 누락 이미지 보완', () => {
  const fallback = parseStructuredActivities({ activities: [{ name: 'Angels Support Operation', startTime: '2026-09-09T11:00:00',
    endTime: '2026-11-30T03:59:59', cover: image }] }, source).events;
  const event = fallback[0];
  assert.ok(event);
  assert.deepEqual(event.imageUrls, [image]);
  const { imageUrls, ...native } = event;
  assert.ok(imageUrls);
  const primary = { ...native, id: 'native', sourceLanguage: 'ko-kr', endAt: '2026-11-29T19:59:00.000Z' };
  const merged = mergeScheduleSources([primary], fallback);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.endAt, event.endAt);
  assert.equal(merged[0]?.sourceLanguage, 'ko-kr');
  assert.deepEqual(merged[0]?.imageUrls, [image]);
});
