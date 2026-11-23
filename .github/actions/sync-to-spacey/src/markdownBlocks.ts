import path from 'node:path';

export interface ParsedFrontmatter {
  title?: string;
  tags: string[];
  spaceyIgnore: boolean;
  spaceyId?: string;
}

export interface MarkdownBlock {
  startLine: number; // 1-based line number in original file
  endLine: number; // 1-based inclusive line number in original file
  content: string;
}

export interface ParsedMarkdownFile {
  frontmatter: ParsedFrontmatter;
  bodyMarkdown: string;
  bodyStartLine: number; // 1-based
  blocks: MarkdownBlock[];
}

export function parseMarkdownDocument(rawContent: string): ParsedMarkdownFile {
  const normalized = rawContent.replace(/\r\n/g, '\n');
  const allLines = normalized.split('\n');

  let bodyStartIdx = 0;
  const frontmatter: ParsedFrontmatter = {
    tags: [],
    spaceyIgnore: false,
  };

  if (allLines.length >= 3 && allLines[0].trim() === '---') {
    let closeIdx = -1;
    for (let i = 1; i < allLines.length; i++) {
      if (allLines[i].trim() === '---') {
        closeIdx = i;
        break;
      }
    }

    if (closeIdx !== -1) {
      const fmLines = allLines.slice(1, closeIdx);
      parseYamlFrontmatterLines(fmLines, frontmatter);
      bodyStartIdx = closeIdx + 1;
    }
  }

  const bodyLines = allLines.slice(bodyStartIdx);
  const bodyMarkdown = bodyLines.join('\n');
  const blocks = splitLinesIntoBlocks(bodyLines, bodyStartIdx + 1);

  return {
    frontmatter,
    bodyMarkdown,
    bodyStartLine: bodyStartIdx + 1,
    blocks,
  };
}

function parseYamlFrontmatterLines(lines: string[], out: ParsedFrontmatter): void {
  let inTagsList = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (inTagsList && trimmed.startsWith('- ')) {
      const item = stripQuotes(trimmed.slice(2).trim());
      if (item) out.tags.push(item);
      continue;
    }
    inTagsList = false;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim().toLowerCase();
    const val = trimmed.slice(colonIdx + 1).trim();

    if (key === 'title' && val) {
      out.title = stripQuotes(val);
    } else if (key === 'spacey_id' && val) {
      out.spaceyId = stripQuotes(val);
    } else if (key === 'spacey_ignore') {
      out.spaceyIgnore = val.toLowerCase() === 'true';
    } else if (key === 'tags') {
      if (!val) {
        inTagsList = true;
      } else if (val.startsWith('[') && val.endsWith(']')) {
        const inner = val.slice(1, -1);
        for (const part of inner.split(',')) {
          const clean = stripQuotes(part.trim());
          if (clean) out.tags.push(clean);
        }
      } else {
        for (const part of val.split(',')) {
          const clean = stripQuotes(part.trim());
          if (clean) out.tags.push(clean);
        }
      }
    }
  }
}

function stripQuotes(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1).trim();
  }
  return s;
}

/**
 * Splits Markdown lines into structural blocks (preserving fenced code blocks as atomic).
 */
export function splitLinesIntoBlocks(
  lines: string[],
  firstLineNumber = 1,
): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let currentLines: string[] = [];
  let blockStartLine = firstLineNumber;
  let fenceMarker: string | null = null;

  const flushBlock = (endLineNumber: number) => {
    const content = currentLines.join('\n').trim();
    if (content.length > 0) {
      blocks.push({
        startLine: blockStartLine,
        endLine: endLineNumber,
        content,
      });
    }
    currentLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = firstLineNumber + i;
    const trimmed = line.trim();

    // Handle fenced code blocks (``` or ~~~)
    const fenceMatch = trimmed.match(/^(```+|~~~+)/);
    if (fenceMatch) {
      const markerChar = fenceMatch[1][0];
      if (!fenceMarker) {
        if (currentLines.length === 0) {
          blockStartLine = lineNo;
        }
        fenceMarker = markerChar;
        currentLines.push(line);
        continue;
      } else if (fenceMarker === markerChar && trimmed.replace(new RegExp(`^${markerChar}+`), '').trim() === '') {
        currentLines.push(line);
        fenceMarker = null;
        continue;
      }
    }

    if (fenceMarker) {
      currentLines.push(line);
      continue;
    }

    if (trimmed === '') {
      if (currentLines.length > 0) {
        flushBlock(lineNo - 1);
      }
      continue;
    }

    // Start a fresh block on headings so heading additions/changes group cleanly
    if (/^#{1,6}\s+/.test(trimmed) && currentLines.length > 0) {
      flushBlock(lineNo - 1);
    }

    if (currentLines.length === 0) {
      blockStartLine = lineNo;
    }
    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    flushBlock(firstLineNumber + lines.length - 1);
  }

  return blocks;
}

export function deriveNoteTitle(
  repoRelativePath: string,
  frontmatter: ParsedFrontmatter,
): string {
  if (frontmatter.title && frontmatter.title.trim()) {
    return frontmatter.title.trim();
  }
  const baseName = path.posix.basename(
    repoRelativePath.replace(/\\/g, '/'),
    path.posix.extname(repoRelativePath),
  );
  const words = baseName
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  if (words.length === 0) return 'Untitled Note';
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function deriveNoteTags(
  repoRelativePath: string,
  frontmatter: ParsedFrontmatter,
): string[] {
  const normalized = repoRelativePath.replace(/\\/g, '/');
  const dir = path.posix.dirname(normalized);
  const folderTags =
    dir && dir !== '.'
      ? dir
          .split('/')
          .map((s) => s.trim().toLowerCase())
          .filter((s) => s.length > 0 && s !== '.' && !s.startsWith('.'))
      : [];

  return Array.from(
    new Set([...frontmatter.tags.map((t) => t.trim()), ...folderTags].filter(Boolean)),
  );
}

/**
 * Rewrites relative Markdown image paths `![alt](./img.png)` to an absolute base URL.
 */
export function rewriteRelativeImageUrls(
  markdown: string,
  repoRelativeFilePath: string,
  imageBaseUrl?: string,
): string {
  if (!imageBaseUrl || !imageBaseUrl.trim()) return markdown;
  const cleanBase = imageBaseUrl.trim().replace(/\/+$/, '');
  const fileDir = path.posix.dirname(repoRelativeFilePath.replace(/\\/g, '/'));

  return markdown.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g,
    (fullMatch, alt: string, rawUrl: string, titlePart = '') => {
      if (
        /^(https?:\/\/|data:|mailto:|#)/i.test(rawUrl)
      ) {
        return fullMatch;
      }
      const cleanRel = rawUrl.replace(/^<|>$/g, '');
      const joined =
        cleanRel.startsWith('/')
          ? cleanRel.slice(1)
          : fileDir === '.'
            ? cleanRel
            : path.posix.normalize(path.posix.join(fileDir, cleanRel));
      if (joined.startsWith('..')) {
        return fullMatch;
      }
      return `![${alt}](${cleanBase}/${joined}${titlePart})`;
    },
  );
}
