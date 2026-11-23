import { execFileSync } from 'node:child_process';
import type { MarkdownBlock } from './markdownBlocks.ts';

export interface BlameLineInfo {
  lineNumber: number;
  commitSha: string;
  authorTimeSec: number;
  calendarDate: string; // YYYY-MM-DD in target timezone
}

export interface AttributedSection {
  content: string;
  date_created: string; // YYYY-MM-DD
}

export interface ExistingSpaceySection {
  id?: string;
  content: string;
  date_created: string;
}

export function formatEpochToCalendarDate(
  epochSec: number,
  timeZone = 'UTC',
): string {
  const date = new Date(epochSec * 1000);
  try {
    // en-CA produces YYYY-MM-DD deterministically
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function computeWordSimilarity(a: string, b: string): number {
  const s1 = a.trim();
  const s2 = b.trim();
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;

  const words1 = new Set(s1.toLowerCase().split(/\s+/));
  const words2 = new Set(s2.toLowerCase().split(/\s+/));

  let intersection = 0;
  for (const w of words1) {
    if (words2.has(w)) intersection++;
  }
  const union = words1.size + words2.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function parseGitBlamePorcelain(
  porcelainOutput: string,
  timeZone = 'UTC',
  fallbackEpochSec = Math.floor(Date.now() / 1000),
): Map<number, BlameLineInfo> {
  const result = new Map<number, BlameLineInfo>();
  const commitTimeBySha = new Map<string, number>();
  const lines = porcelainOutput.replace(/\r\n/g, '\n').split('\n');

  let currentSha = '';
  let currentFinalLine = 0;
  let currentAuthorTime = fallbackEpochSec;

  for (const line of lines) {
    const headerMatch = line.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)(?:\s+\d+)?$/);
    if (headerMatch) {
      currentSha = headerMatch[1];
      currentFinalLine = Number(headerMatch[2]);
      currentAuthorTime =
        commitTimeBySha.get(currentSha) ?? fallbackEpochSec;
      continue;
    }

    if (line.startsWith('author-time ')) {
      const ts = Number(line.slice('author-time '.length).trim());
      if (!Number.isNaN(ts) && ts > 0) {
        currentAuthorTime = ts;
        if (currentSha) {
          commitTimeBySha.set(currentSha, ts);
        }
      }
      continue;
    }

    if (line.startsWith('\t') && currentFinalLine > 0) {
      const effectiveTs =
        currentSha === '0000000000000000000000000000000000000000'
          ? fallbackEpochSec
          : currentAuthorTime;
      result.set(currentFinalLine, {
        lineNumber: currentFinalLine,
        commitSha: currentSha,
        authorTimeSec: effectiveTs,
        calendarDate: formatEpochToCalendarDate(effectiveTs, timeZone),
      });
    }
  }

  return result;
}

export function runGitBlame(
  repoDir: string,
  repoRelativePath: string,
  rev = 'HEAD',
  timeZone = 'UTC',
): Map<number, BlameLineInfo> {
  const normalizedPath = repoRelativePath.replace(/\\/g, '/');
  const output = execFileSync(
    'git',
    ['blame', '--line-porcelain', rev, '--', normalizedPath],
    { cwd: repoDir, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
  );
  return parseGitBlamePorcelain(output, timeZone);
}

/**
 * Picks a single calendar date for a Markdown block using majority/anti-fragmentation
 * rules so a 1-line typo fix inside an older paragraph does not split the block.
 */
export function resolveBlockCalendarDate(
  block: MarkdownBlock,
  blameByLine: Map<number, BlameLineInfo>,
  fallbackDate: string,
): string {
  const dateCounts = new Map<string, number>();
  let totalBlamedLines = 0;

  for (let lineNo = block.startLine; lineNo <= block.endLine; lineNo++) {
    const info = blameByLine.get(lineNo);
    if (!info) continue;
    totalBlamedLines++;
    dateCounts.set(
      info.calendarDate,
      (dateCounts.get(info.calendarDate) ?? 0) + 1,
    );
  }

  if (totalBlamedLines === 0 || dateCounts.size === 0) {
    return fallbackDate;
  }

  if (dateCounts.size === 1) {
    return Array.from(dateCounts.keys())[0];
  }

  // Sort dates by highest line count, breaking ties by earliest date so older
  // blocks keep their original schedule rather than resetting on small edits.
  const ranked = Array.from(dateCounts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });

  const [topDate, topCount] = ranked[0];
  // If top date represents >= 60% of the block, attribute the whole block to it
  if (topCount / totalBlamedLines >= 0.6) {
    return topDate;
  }

  // If no single date dominates >= 60%, prefer the earliest date among lines
  // that represent at least 30% of the block (protecting original study notes
  // when multiple lines are incrementally polished).
  const significant = ranked
    .filter(([, count]) => count / totalBlamedLines >= 0.3)
    .map(([date]) => date)
    .sort();

  return significant[0] ?? topDate;
}

/**
 * Merges consecutive blocks with the same calendar date into 1 section per day.
 */
export function groupBlocksIntoDaySections(
  blocks: Array<{ content: string; dateCreated: string }>,
): AttributedSection[] {
  const sections: AttributedSection[] = [];

  for (const block of blocks) {
    const trimmed = block.content.trim();
    if (!trimmed) continue;

    const last = sections[sections.length - 1];
    if (last && last.date_created === block.dateCreated) {
      last.content = `${last.content}\n\n${trimmed}`;
    } else {
      sections.push({
        content: trimmed,
        date_created: block.dateCreated,
      });
    }
  }

  return sections;
}

/**
 * Layer 1: Full-history attribution using `git blame` grouped into day-based sections.
 */
export function attributeSectionsLayer1(
  blocks: MarkdownBlock[],
  blameByLine: Map<number, BlameLineInfo>,
  fallbackDate: string,
): AttributedSection[] {
  const attributed = blocks.map((block) => ({
    content: block.content,
    dateCreated: resolveBlockCalendarDate(block, blameByLine, fallbackDate),
  }));
  return groupBlocksIntoDaySections(attributed);
}

/**
 * Layer 2: Incremental attribution using existing Spacey sections + `git blame` for new content.
 * Preserves existing sections' original calendar dates when blocks are unchanged or lightly edited
 * (word similarity > 0.6 or containment), while attributing newly added blocks via commit dates.
 */
export function attributeSectionsLayer2(params: {
  blocks: MarkdownBlock[];
  blameByLine: Map<number, BlameLineInfo>;
  existingSections: ExistingSpaceySection[];
  fallbackDate: string;
}): AttributedSection[] {
  const { blocks, blameByLine, existingSections, fallbackDate } = params;
  if (existingSections.length === 0) {
    return attributeSectionsLayer1(blocks, blameByLine, fallbackDate);
  }

  const existingEntries = existingSections.map((sec) => {
    const dateKey = sec.date_created.slice(0, 10);
    const trimmed = sec.content.trim();
    const paragraphs = trimmed
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    return { dateKey, full: trimmed, paragraphs };
  });

  const attributed = blocks.map((block) => {
    const trimmedBlock = block.content.trim();
    let matchedDate: string | null = null;
    let bestSim = 0.6;

    for (const ex of existingEntries) {
      if (
        ex.full === trimmedBlock ||
        ex.full.includes(trimmedBlock) ||
        ex.paragraphs.some(
          (p) =>
            p === trimmedBlock ||
            p.includes(trimmedBlock) ||
            trimmedBlock.includes(p),
        )
      ) {
        matchedDate = ex.dateKey;
        bestSim = 1.0;
        break;
      }

      const simFull = computeWordSimilarity(trimmedBlock, ex.full);
      if (simFull > bestSim) {
        bestSim = simFull;
        matchedDate = ex.dateKey;
      }

      for (const p of ex.paragraphs) {
        const simPara = computeWordSimilarity(trimmedBlock, p);
        if (simPara > bestSim) {
          bestSim = simPara;
          matchedDate = ex.dateKey;
        }
      }
    }

    const dateCreated =
      matchedDate ?? resolveBlockCalendarDate(block, blameByLine, fallbackDate);
    return {
      content: block.content,
      dateCreated,
    };
  });

  return groupBlocksIntoDaySections(attributed);
}
