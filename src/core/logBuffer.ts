import { type LogEntry, LOG_CAP } from './types';

export class LogBuffer {
  private cap: number;
  private buffer: LogEntry[] = [];

  constructor(cap: number = LOG_CAP) {
    this.cap = cap;
  }

  push(e: LogEntry): void {
    if (this.cap <= 0) return;
    this.buffer.push(e);
    if (this.buffer.length > this.cap) {
      this.buffer.shift();
    }
  }

  entries(): LogEntry[] {
    return [...this.buffer];
  }

  clear(): void {
    this.buffer = [];
  }
}
