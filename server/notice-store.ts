import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../shared/calendar';
import { isNoticeInput, isNoticeList, type Notice, type NoticeInput } from '../shared/notices';

export const createNoticeStore = (url = new URL('../data/notices.json', import.meta.url)) => {
  let writes: Promise<void> = Promise.resolve();
  const read = async (): Promise<Notice[]> => {
    try {
      const value: unknown = JSON.parse(await readFile(url, 'utf8'));
      if (!isNoticeList(value)) throw new Error('Invalid notice store');
      return value;
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') return [];
      throw error;
    }
  };
  const update = (change: (notices: Notice[]) => Notice[]): Promise<void> => {
    const operation = writes.then(async () => {
      const notices = change(await read());
      await mkdir(dirname(fileURLToPath(url)), { recursive: true });
      const temporary = new URL(`${url.href}.tmp`);
      await writeFile(temporary, JSON.stringify(notices, null, 2));
      await rename(temporary, url);
    });
    writes = operation.catch((error: unknown) => { console.error('Notice store write failed', error); });
    return operation;
  };
  const publish = (input: NoticeInput): Promise<void> => update((notices) => {
    if (!isNoticeInput(input)) throw new Error('Invalid notice');
    return [{ id: randomUUID(), title: input.title.trim(), content: input.content.trim(), publishedAt: new Date().toISOString() }, ...notices];
  });
  const remove = (id: string): Promise<void> => update((notices) => notices.filter((notice) => notice.id !== id));
  return { read, publish, remove };
};
export const noticeStore = createNoticeStore();
