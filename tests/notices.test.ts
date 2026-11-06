import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createNoticeStore } from '../server/notice-store';
import { isNoticeInput, isNoticeList, type Notice } from '../shared/notices';
import { markNoticesRead, parseReadNotices, unreadNotices } from '../src/features/notices/records';

test('공지 입력은 빈 값, 잘못된 형식, 길이 초과를 거부', () => {
  assert.ok(isNoticeInput({ title: '안내', content: '내용\n두 번째 줄' }));
  for (const value of [null, {}, { title: ' ', content: '내용' }, { title: '제목', content: '\n' },
    { title: '가'.repeat(201), content: '내용' }, { title: '제목', content: '가'.repeat(10001) }]) assert.equal(isNoticeInput(value), false);
  assert.equal(isNoticeList([{ title: '제목', content: '내용' }]), false);
});

test('미확인 공지 전체 표시, 닫은 공지 재방문 제외, 이후 새 공지만 표시', () => {
  const notice = (id: string): Notice => ({ id, title: id, content: '내용', publishedAt: '2026-11-06T00:00:00Z' });
  const notices = [notice('new'), notice('old')];
  assert.deepEqual(unreadNotices(notices, []), notices);
  const saved = JSON.stringify(markNoticesRead(null, notices));
  assert.deepEqual(unreadNotices(notices, parseReadNotices(saved)), []);
  assert.deepEqual(unreadNotices([notice('latest'), ...notices], parseReadNotices(saved)), [notice('latest')]);
  assert.deepEqual(markNoticesRead('["other-tab", "old"]', notices), ['other-tab', 'old', 'new']);
  for (const value of [null, 'invalid', '{}']) assert.deepEqual(parseReadNotices(value), []);
  assert.deepEqual(parseReadNotices('["old", null, 3, "old"]'), ['old']);
});

test('서버 공지 저장은 동시 등록 유실 없이 유지되며 재시작 후에도 조회', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'subdays-notices-'));
  const url = pathToFileURL(join(directory, 'notices.json'));
  try {
    const store = createNoticeStore(url);
    assert.deepEqual(await store.read(), []);
    await Promise.all([store.publish({ title: ' 첫 공지 ', content: ' 첫 내용 ' }), store.publish({ title: '둘째', content: '내용\n줄바꿈' })]);
    const result = await createNoticeStore(url).read();
    assert.ok(isNoticeList(result));
    assert.equal(result.length, 2);
    assert.equal(new Set(result.map((notice) => notice.id)).size, 2);
    assert.deepEqual(result.map((notice) => notice.title), ['둘째', '첫 공지']);
    assert.equal(result[1]?.content, '첫 내용');
    await assert.rejects(store.publish({ title: '', content: '내용' }));
    await store.publish({ title: '셋째', content: '내용' });
    assert.equal((await store.read()).length, 3);
    await writeFile(url, 'corrupt');
    await assert.rejects(store.publish({ title: '덮어쓰기 금지', content: '내용' }));
    assert.equal(await readFile(url, 'utf8'), 'corrupt');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
