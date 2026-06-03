declare module 'archiver' {
  import type { Writable } from 'stream';

  export class ZipArchive {
    constructor(options?: { zlib?: { level?: number } });
    pipe<T extends Writable>(destination: T): T;
    file(filepath: string, data?: { name?: string }): void;
    finalize(): void;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'warning', listener: (error: Error) => void): this;
  }
}
