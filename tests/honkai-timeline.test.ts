import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isCalendarEvent, type CalendarEvent } from '../shared/calendar';
import { parseHonkaiTimelinePage, parseHonkaiPublicTimeline } from '../src/features/collection/honkai/public';
import { EventDetail } from '../src/features/calendar/components/EventDetail';
import type { HonkaiArticle } from '../src/features/collection/honkai/parsers';

const raw = JSON.parse(readFileSync(new URL('./fixtures/honkai-timeline.json', import.meta.url), 'utf8'));
const source = 'https://www.arustats.com/en-us/hi3/timeline/9.0';
const version: CalendarEvent = { id: 'honkai:version:9.0', game: 'honkai', kind: 'version', title: '9.0 버전',
  startAt: '2026-08-20T08:00:00.000Z', endAt: '2026-10-21T15:00:00.000Z', sourceUrl: 'https://www.hoyolab.com/article/46374643',
  sourceLanguage: 'ko-kr', description: '' };
const official: HonkaiArticle[] = [{ id: '123', title: '9.0 버전 내용', createdAt: Date.parse(version.startAt) / 1000,
  url: 'https://cafe.naver.com/honkai3rd/1784739', description: '부생·도진의 날개 기만·여명의 그림자 세나디아 향락·광란의 연회 파기·등불의 그림자 차원 무장·카오스\n'
    + '별들의 격투 | 10월 1일, 이벤트 개방\n별들의 텃밭 | 9월 21일, 이벤트 개방\n별의 소망 승휘의 별 꿈의 틈새로 비친 빛 비화: 함장과 소원 나무 서광의 희망 이제, 미래를 품어라 날아라, 옥시아를 향해!' }];

test('실제 공개 JSON 주차를 종료 주차 미포함으로 해석하고 한국 개방일 우선', () => {
  const result = parseHonkaiPublicTimeline(raw, version, official, source);
  assert.equal(result.events.filter((event) => event.kind === 'banner').length, 10);
  assert.equal(result.events.filter((event) => event.kind === 'event').length, 9);
  assert.ok(result.events.every(isCalendarEvent));
  const banner = result.events.find((event) => event.title === '차원 무장·카오스 · 랭크업 보급')!;
  assert.equal(banner.startAt, '2026-10-01T15:00:00.000Z'); assert.equal(banner.endAt, version.endAt);
  const event = result.events.find((item) => item.title === '별들의 격투')!;
  assert.equal(event.startAt, '2026-09-30T15:00:00.000Z'); assert.equal(event.timeEvidence?.start?.basis, 'official');
  assert.equal(event.timeEvidence?.end?.basis, 'community-data'); assert.equal(event.timeEvidence?.end?.precision, 'date');
  assert.equal(result.events.find((item) => item.title === '별들의 텃밭')?.startAt, '2026-09-20T15:00:00.000Z');
  assert.ok(!result.events.some((item) => /10th|Selector/.test(item.title)));
});

test('한국 공지에 없는 콘텐츠와 다른 버전·손상된 주차는 사용하지 않음', () => {
  assert.equal(parseHonkaiPublicTimeline(raw, version, [], source).events.length, 0);
  assert.throws(() => parseHonkaiPublicTimeline({ ...raw, version: '9.1' }, version, official, source));
  assert.throws(() => parseHonkaiPublicTimeline({ ...raw, scheduleDates: [{ startDate: '2026-2-30 0:0:0', endDate: '2026-3-7 0:0:0' }] }, version, official, source));
  const changed = structuredClone(raw); changed.scheduleDates[0].startDate = '2026-8-19 0:0:0';
  assert.throws(() => parseHonkaiPublicTimeline(changed, version, official, source));
  assert.throws(() => parseHonkaiTimelinePage('<html>upstream unavailable</html>'));
});

test('주차 범위 검증과 시작 보정 후 안정된 완료 식별자', () => {
  const baseline = parseHonkaiPublicTimeline(raw, version, official, source).events.find((event) => event.title === '별들의 격투')!;
  const changedArticles = official.map((article) => ({ ...article, description: article.description.replace('10월 1일', '10월 2일') }));
  const changed = parseHonkaiPublicTimeline(raw, version, changedArticles, source).events.find((event) => event.title === '별들의 격투')!;
  assert.equal(changed.id, baseline.id); assert.notEqual(changed.startAt, baseline.startAt);
  const invalid = structuredClone(raw); invalid.scheduleActivities[1].content[0].endWeek = 99;
  const result = parseHonkaiPublicTimeline(invalid, version, official, source);
  assert.ok(result.issues.some((issue) => /주차/.test(issue.reason)));
});

test('새 콘텐츠의 영문·한국어 공식 제목 연결과 예상 기간 표시', () => {
  const timeline = { ...raw, scheduleActivities: [{ row: 'EVENT 1', content: [{ startWeek: 1, endWeek: 10,
    miniature: { titleTop: 'Future Event', titleMid: null } }] }] };
  const articles = [{ ...official[0]!, description: '★ 테마 이벤트——「새로운 행사」', englishDescription: '★ Featured Event: Future Event' }];
  const event = parseHonkaiPublicTimeline(timeline, version, articles, source).events[0]!;
  assert.equal(event.title, '새로운 행사');
  const html = renderToStaticMarkup(createElement(EventDetail, { event, isCompleted: false, onToggleCompletion: () => {}, onClose: () => {} }));
  assert.ok(html.includes('예상 기간')); assert.ok(html.includes('날짜 기준')); assert.ok(!html.includes('00:00'));
  assert.deepEqual(parseHonkaiTimelinePage(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { timeline } } })}</script>`), timeline);
});
