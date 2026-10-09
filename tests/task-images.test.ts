import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_KINDS, isCalendarEvent, isImageUrl } from '../shared/calendar';
import { parseHoyoCalendar, parseStructuredActivities, mergeScheduleSources, reconcileSchedules } from '../src/features/collection';

const source = 'https://example.com/calendar';
const image = 'https://example.com/event.png';
const payload = { events: [{ id: 1, name: '시험 이벤트', start_time: 1790740800, end_time: 1790900000, image_url: image }],
  challenges: [], banners: [{ id: 2, start_time: 1790740800, end_time: 1790900000,
    agents: [{ id: 10, name: '첫 캐릭터', rarity: 'S', icon: image }, { id: 11, name: '둘째 캐릭터', rarity: 'S', icon: 'https://example.com/second.png' },
      { id: 12, name: '보조 캐릭터', rarity: 'A', icon: 'https://example.com/extra.png' }] }] };

test('버전 분류를 가장 먼저 배치', () => { assert.equal(EVENT_KINDS[0], 'version'); });

test('이벤트 대표 이미지와 픽업 최고 등급 캐릭터 이미지 수집', () => {
  const result = parseHoyoCalendar('zenless', payload, source);
  assert.deepEqual(result.events[0]?.imageUrls, [image]);
  assert.deepEqual(result.events[1]?.imageUrls, [image, 'https://example.com/second.png']);
  assert.ok(result.events.every(isCalendarEvent));
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

test('원본 피드의 cover를 보존하고 기간과 이름 우선순위 유지하며 누락 이미지만 보완', () => {
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
  assert.equal(merged[0]?.endAt, primary.endAt);
  assert.equal(merged[0]?.sourceLanguage, 'ko-kr');
  assert.deepEqual(merged[0]?.imageUrls, [image]);
});
