/** Docker/agent log helpers. Polls return a tail, so updates append instead of replacing. */

const ANSI = /\u001b(?:\[[0-9;?]*[A-Za-z]|\][^\u0007]*(?:\u0007|\u001b\\))/g;

const DOCKER_TS = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))\s+([\s\S]*)$/;

export type LogLine = {
  id: string;
  time: string | null;
  message: string;
};

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

export function splitLogLines(text: string): string[] {
  if (!text) return [];
  const lines = stripAnsi(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Keep the existing tail and append only lines the new poll added.
 * Cached snapshots must not replace a live tail they don't overlap.
 */
export function mergeLogText(
  previous: string,
  incoming: string,
  maxLines = 2500,
  replaceOnDisjoint = true,
): string {
  const prevLines = splitLogLines(previous);
  const nextLines = splitLogLines(incoming);
  if (nextLines.length === 0) return previous;
  if (prevLines.length === 0) return capLines(nextLines, maxLines);

  const overlap = findOverlap(prevLines, nextLines);
  if (overlap > 0) {
    const added = nextLines.slice(overlap);
    if (added.length === 0) return previous;
    return capLines([...prevLines, ...added], maxLines);
  }

  if (isContiguousSlice(prevLines, nextLines)) return previous;
  if (!replaceOnDisjoint) return previous;
  return capLines(nextLines, maxLines);
}

function capLines(lines: string[], maxLines: number): string {
  const sliced = lines.length > maxLines ? lines.slice(lines.length - maxLines) : lines;
  return sliced.join("\n");
}

function findOverlap(prevLines: string[], nextLines: string[]): number {
  const max = Math.min(prevLines.length, nextLines.length);
  const start = Math.max(1, max > 80 ? max - 400 : 1);
  for (let n = max; n >= start; n--) {
    if (linesEqual(prevLines, prevLines.length - n, nextLines, 0, n)) return n;
  }
  if (start > 1) {
    for (let n = start - 1; n >= 1; n--) {
      if (linesEqual(prevLines, prevLines.length - n, nextLines, 0, n)) return n;
    }
  }
  return 0;
}

function linesEqual(a: string[], aStart: number, b: string[], bStart: number, count: number): boolean {
  for (let i = 0; i < count; i++) {
    if (a[aStart + i] !== b[bStart + i]) return false;
  }
  return true;
}

function isContiguousSlice(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  const last = haystack.length - needle.length;
  for (let start = 0; start <= last; start++) {
    if (linesEqual(haystack, start, needle, 0, needle.length)) return true;
  }
  return false;
}

export function parseLogLines(text: string): LogLine[] {
  const seen = new Map<string, number>();
  const lines: LogLine[] = [];
  for (const line of splitLogLines(text)) {
    if (!line) continue;
    const match = DOCKER_TS.exec(line);
    const time = match ? match[1] : null;
    const message = match ? match[2] : line;
    const basis = `${time ?? ""}\0${message}`;
    const n = seen.get(basis) ?? 0;
    seen.set(basis, n + 1);
    lines.push({ id: `${n}:${basis}`, time, message });
  }
  return lines;
}

export function formatLogClock(iso: string): string {
  const match = /T(\d{2}:\d{2}:\d{2})/.exec(iso);
  if (match) return match[1];
  return iso.length >= 19 ? iso.slice(11, 19) : iso;
}
