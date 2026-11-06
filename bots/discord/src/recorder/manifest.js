// Манифест сессии: одна строка JSON на событие (JSONL). Запись построчная —
// при падении процесса сохраняются все события до последней полной строки.
import fs from 'node:fs';

export class Manifest {
  constructor(file, { append = fs.appendFileSync } = {}) {
    this.file = file;
    this.append = append;
  }

  write(event) {
    this.append(this.file, `${JSON.stringify(event)}\n`);
    return event;
  }
}

/** Прочитать манифест; оборванная последняя строка пропускается. */
export function readManifest(file) {
  const text = fs.readFileSync(file, 'utf8');
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { /* оборванная строка после сбоя */ }
  }
  return events;
}
