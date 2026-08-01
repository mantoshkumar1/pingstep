import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const emptyData = () => ({ events: {}, runs: {}, pending: {}, alerts: {} });

export class FileStore {
  constructor(path) {
    this.path = path;
    this.data = emptyData();
  }

  async load() {
    try {
      const contents = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(contents);
      this.data = {
        events: parsed.events ?? {},
        runs: parsed.runs ?? {},
        pending: parsed.pending ?? {},
        alerts: parsed.alerts ?? {}
      };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.persist();
    }
  }

  async persist() {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.path);
  }
}
