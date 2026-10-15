import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CalendarEvent } from '../shared/calendar';
import { applyEndfieldGuide, endfieldGuideScriptUrl, fetchEndfieldGuide, parseEndfieldGuide, ENDFIELD_GUIDE_URL } from '../src/features/collection/endfield/guide';
import { reconcileSchedules, resolveScheduleId } from '../src/features/collection/reconciliation';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/endfield-guide.json', import.meta.url), 'utf8')) as {
  raw: { meta: { version: string }; gameplay: unknown[]; story: unknown[] }; assets: Record<string, string>;
};
const scriptUrl = 'https://web-static.hg-cdn.com/endfield/webview/_version_briefing/v1d6/version-v1d6.d7cc5e.js';
const html = `<script src="https://web-static.hg-cdn.com/static/react.js"></script><script src="${scriptUrl}"></script>`;
const bundle = (raw = fixture.raw) => {
  const literal = `'${JSON.stringify(raw).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  return `const assets={${Object.entries(fixture.assets).map(([key, path]) => `${JSON.stringify(key)}:bundler.p+${JSON.stringify(path)}`).join(',')}};const data=JSON.parse(${literal});`;
};
const guide = () => parseEndfieldGuide(bundle(), scriptUrl);
const native = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'endfield:9560:61:0', game: 'endfield', kind: 'event', title: '「불꽃으로 맺은 인연」 흥미 이벤트',
  startAt: '2026-10-15T04:00:00.000Z', endAt: '2026-11-25T22:00:00.000Z', sourceUrl: 'https://endfield.gryphline.com/ko-kr/news/9560',
  sourceLanguage: 'ko-kr', description: '공식 기간', ...overrides,
});
const original = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => native({
  id: 'sra:endfield:inn', title: '이벤트 · 한국어 이름 확인', sourceLanguage: 'en-us', sourceUrl: 'https://example.com/original',
  localizationKey: `sra:endfield:event:${encodeURIComponent("[Yuanyuan's Blazing Stoves] Fun & Games Event")}`,
  collectionMethod: 'structured', endAt: '2026-11-25T21:59:59.000Z', imageUrls: ['https://example.com/version.jpg'], ...overrides,
});

test('실제 공식 가이드의 콘텐츠 ID·한국어 이름·개별 이미지 11개를 실행 없이 연결', () => {
  assert.equal(endfieldGuideScriptUrl(html), scriptUrl);
  const result = parseEndfieldGuide(`${bundle()};throw new Error('실행 금지');`, scriptUrl);
  assert.equal(result.entries.length, 11);
  assert.equal(new Set(result.entries.map((entry) => entry.imageUrl)).size, 11);
  assert.equal(result.entries.find((entry) => entry.id === 'activity_phototaking_carly_3')?.korean, '칼리의 꽃과 풀 동화');
  assert.equal(result.entries.find((entry) => entry.id === 'activity_timelimited_inn')?.imageUrl,
    'https://web-static.hg-cdn.com/endfield/webview/_version_briefing/v1d6/assets/imgs/visual.cea556.png');
  assert.deepEqual(parseEndfieldGuide(bundle().replace('Yuanyuan', '\\x59uanyuan'), scriptUrl), result);
});

test('다음 버전의 경로·해시 변경을 자동 발견하고 불명확한 스크립트는 거부', () => {
  const next = scriptUrl.replace('v1d6/version-v1d6.d7cc5e', 'v2d0/version-v2d0.abcdef');
  assert.equal(endfieldGuideScriptUrl(`<script src='${next}'></script>`), next);
  assert.ok(parseEndfieldGuide(bundle(), next).entries.every((entry) => entry.imageUrl.includes('/v2d0/')));
  assert.throws(() => endfieldGuideScriptUrl(html + `<script src="${next}"></script>`));
  assert.throws(() => endfieldGuideScriptUrl(`<script src="https://unrelated.example/version-v1.js"></script>`));
  assert.throws(() => parseEndfieldGuide('const unrelated = {}', scriptUrl));
  assert.throws(() => parseEndfieldGuide(bundle() + bundle(), scriptUrl));
  assert.throws(() => parseEndfieldGuide(bundle() + 'const conflict={"gameplay.0.visual":bundler.p+"assets/imgs/wrong.jpg"}', scriptUrl));
});

test('한국어 일정 ID·기간·근거를 보존하고 동일 회차의 SRA 보완 일정만 병합', () => {
  const primary = native({ imageUrls: ['https://example.com/old.jpg'], timeEvidence: {
    end: { at: '2026-11-25T22:00:00.000Z', sourceUrl: 'https://example.com/maintenance', basis: 'official', precision: 'second' },
  } });
  const foreign = original();
  const before = structuredClone([primary, foreign]);
  const result = applyEndfieldGuide([primary, foreign], guide());
  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, primary.id);
  assert.equal(result[0]?.title, primary.title);
  assert.equal(result[0]?.startAt, primary.startAt);
  assert.equal(result[0]?.endAt, primary.endAt);
  assert.deepEqual(result[0]?.timeEvidence, primary.timeEvidence);
  assert.equal(result[0]?.collectionSources?.length, 2);
  assert.equal(resolveScheduleId(result, foreign.id), primary.id);
  assert.ok(result[0]?.imageUrls?.[0]?.endsWith('visual.cea556.png'));
  assert.deepEqual([primary, foreign], before);
  assert.deepEqual(applyEndfieldGuide(result, guide()), result);
  const reconciled = reconcileSchedules(result).events;
  assert.equal(reconciled[0]?.id, primary.id);
  assert.equal(reconciled[0]?.endAt, primary.endAt);
  assert.deepEqual(reconcileSchedules(reconciled).events, reconciled);
});

test('다른 이벤트·게임·픽업·다음 회차는 잘못 연결하거나 삭제하지 않음', () => {
  const primary = native();
  const events = [primary, original({ startAt: '2026-12-01T04:00:00.000Z', endAt: '2026-12-20T04:00:00.000Z' }),
    native({ id: 'other', title: '「다른 이벤트」 흥미 이벤트' }), native({ id: 'banner', kind: 'banner' }),
    native({ id: 'another-game', game: 'genshin' })];
  const result = applyEndfieldGuide(events, guide());
  assert.equal(result.length, events.length);
  for (const id of ['other', 'banner', 'another-game']) assert.deepEqual(result.find((event) => event.id === id), events.find((event) => event.id === id));
  const ambiguous = applyEndfieldGuide([primary, native({ id: 'another-official' }), original()], guide());
  assert.equal(ambiguous.length, 3);
});

test('공식 이름이 없는 보완 일정만 한국어 이름으로 표시하고 시즌 이름은 보존', () => {
  const season = original({ id: 'season', kind: 'challenge', title: '전쟁의 메아리 · 이색의 회상', displayLanguage: 'ko-kr',
    localizationKey: 'sra:endfield:event:season', imageUrls: [] });
  const result = applyEndfieldGuide([original(), season], guide());
  assert.equal(result[0]?.title, '불꽃으로 맺은 인연');
  assert.equal(result[0]?.displayLanguage, 'ko-kr');
  assert.equal(result[1]?.title, season.title);
  assert.ok(result[1]?.imageUrls?.[0]?.endsWith('visual.feb939.png'));
});

test('공식 가이드 장애 시 마지막 성공 이미지를 재사용하고 캐시가 없으면 기존 경로 유지', async () => {
  const expected = guide();
  let saved: unknown;
  const requests: string[] = [];
  const success = await fetchEndfieldGuide({ loadHtml: async (url) => {
    requests.push(url.href); return url.href === ENDFIELD_GUIDE_URL ? html : bundle();
  }, write: async (value) => { saved = value; } });
  assert.deepEqual(requests, [ENDFIELD_GUIDE_URL, scriptUrl]);
  assert.deepEqual(success, { guide: expected, stale: false });
  assert.deepEqual(saved, expected);
  const failure = { loadHtml: async () => { throw new Error('원본 장애'); } };
  assert.deepEqual(await fetchEndfieldGuide({ ...failure, read: async () => saved }), { guide: expected, stale: true });
  assert.deepEqual(await fetchEndfieldGuide({ ...failure, read: async () => ({ entries: [] }) }), { guide: null, stale: true });
  const changed = await fetchEndfieldGuide({ loadHtml: async (url) => url.href === ENDFIELD_GUIDE_URL ? html : '변경된 번들 형식', read: async () => saved });
  assert.deepEqual(changed, { guide: expected, stale: true });
});
