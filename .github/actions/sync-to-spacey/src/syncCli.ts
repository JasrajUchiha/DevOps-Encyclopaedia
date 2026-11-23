import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  attributeSectionsLayer1,
  attributeSectionsLayer2,
  formatEpochToCalendarDate,
  runGitBlame,
  type ExistingSpaceySection,
} from './gitAttribution.ts';
import {
  deriveNoteTags,
  deriveNoteTitle,
  parseMarkdownDocument,
  rewriteRelativeImageUrls,
} from './markdownBlocks.ts';

export interface SyncCliOptions {
  repoDir: string;
  apiUrl: string;
  apiKey: string;
  repoSlug: string;
  branch: string;
  beforeSha?: string;
  afterSha: string;
  timeZone: string;
  mode: 'auto' | 'full' | 'incremental';
  syncAll: boolean;
  dryRun: boolean;
  pathsFilter?: string[];
  ignoreNames: string[];
  imageBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface SyncedFileResult {
  path: string;
  title: string;
  status: 'created' | 'updated' | 'dry-run' | 'skipped';
  modeUsed: 'layer1-full' | 'layer2-incremental' | 'none';
  sectionsCount: number;
  preservedSections?: number;
  createdSections?: number;
  noteId?: string;
}

const ZERO_SHA = '0000000000000000000000000000000000000000';

function isValidCommitSha(sha?: string): sha is string {
  return Boolean(sha && sha !== ZERO_SHA && /^[0-9a-f]{7,40}$/i.test(sha));
}

export function discoverMarkdownFiles(params: {
  repoDir: string;
  beforeSha?: string;
  afterSha: string;
  syncAll: boolean;
  pathsFilter?: string[];
  ignoreNames: string[];
}): string[] {
  const { repoDir, beforeSha, afterSha, syncAll, pathsFilter, ignoreNames } = params;
  let candidates: string[] = [];

  if (!syncAll && isValidCommitSha(beforeSha)) {
    const out = execFileSync(
      'git',
      ['-c', 'core.quotePath=false', 'diff', '-z', '--name-only', '--diff-filter=ACMR', beforeSha, afterSha],
      { cwd: repoDir, encoding: 'utf8' },
    );
    candidates = out
      .split('\0')
      .map((s) => s.trim().replace(/\\/g, '/'))
      .filter(Boolean);
  } else {
    const out = execFileSync(
      'git',
      ['-c', 'core.quotePath=false', 'ls-files', '-z'],
      { cwd: repoDir, encoding: 'utf8' },
    );
    candidates = out
      .split('\0')
      .map((s) => s.trim().replace(/\\/g, '/'))
      .filter((f) => f.toLowerCase().endsWith('.md'));
  }

  const ignoreSet = new Set(ignoreNames.map((n) => n.toLowerCase()));
  return Array.from(new Set(candidates)).filter((relPath) => {
    if (!relPath.toLowerCase().endsWith('.md')) return false;
    const baseName = path.posix.basename(relPath).toLowerCase();
    if (ignoreSet.has(baseName)) return false;
    if (relPath.startsWith('.github/')) return false;
    if (pathsFilter && pathsFilter.length > 0) {
      return pathsFilter.some((prefix) => {
        const cleanPrefix = prefix.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        return relPath === cleanPrefix || relPath.startsWith(`${cleanPrefix}/`);
      });
    }
    return true;
  });
}

async function fetchExistingSpaceyNote(
  fetchImpl: typeof fetch,
  apiUrl: string,
  apiKey: string,
  sourceKey: string,
): Promise<{ id: string; sections: ExistingSpaceySection[] } | null> {
  const url = `${apiUrl.replace(/\/+$/, '')}/v1/notes?source_key=${encodeURIComponent(sourceKey)}`;
  const resp = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!resp.ok) {
    return null;
  }
  const data = (await resp.json()) as {
    notes?: Array<{ id: string; sections?: ExistingSpaceySection[] }>;
  };
  const first = data.notes?.[0];
  if (!first) return null;
  return {
    id: first.id,
    sections: Array.isArray(first.sections) ? first.sections : [],
  };
}

export async function syncRepositoryToSpacey(
  options: SyncCliOptions,
): Promise<SyncedFileResult[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiUrl = options.apiUrl.replace(/\/+$/, '');
  const files = discoverMarkdownFiles({
    repoDir: options.repoDir,
    beforeSha: options.beforeSha,
    afterSha: options.afterSha,
    syncAll: options.syncAll,
    pathsFilter: options.pathsFilter,
    ignoreNames: options.ignoreNames,
  });

  const fallbackDate = formatEpochToCalendarDate(
    Math.floor(Date.now() / 1000),
    options.timeZone,
  );

  const imageBaseUrl =
    options.imageBaseUrl ||
    (options.repoSlug
      ? `https://raw.githubusercontent.com/${options.repoSlug}/${options.branch}`
      : undefined);

  const results: SyncedFileResult[] = [];

  for (const relPath of files) {
    const absPath = path.join(options.repoDir, relPath);
    if (!fs.existsSync(absPath)) continue;

    const rawContent = fs.readFileSync(absPath, 'utf8');
    const parsed = parseMarkdownDocument(rawContent);

    if (parsed.frontmatter.spaceyIgnore || parsed.blocks.length === 0) {
      results.push({
        path: relPath,
        title: deriveNoteTitle(relPath, parsed.frontmatter),
        status: 'skipped',
        modeUsed: 'none',
        sectionsCount: 0,
      });
      continue;
    }

    const title = deriveNoteTitle(relPath, parsed.frontmatter);
    const tags = deriveNoteTags(relPath, parsed.frontmatter);
    const sourceKey = `github:${options.repoSlug}:${relPath}`;
    const blameByLine = runGitBlame(
      options.repoDir,
      relPath,
      options.afterSha,
      options.timeZone,
    );

    const canTryIncremental =
      options.mode !== 'full' &&
      isValidCommitSha(options.beforeSha) &&
      !options.dryRun;

    let existingNote: { id: string; sections: ExistingSpaceySection[] } | null = null;
    if (options.mode !== 'full' && options.apiKey) {
      existingNote = await fetchExistingSpaceyNote(
        fetchImpl,
        apiUrl,
        options.apiKey,
        sourceKey,
      );
    }

    let modeUsed: 'layer1-full' | 'layer2-incremental';
    let attributedSections;

    if (
      (options.mode === 'incremental' || (options.mode === 'auto' && canTryIncremental)) &&
      existingNote &&
      existingNote.sections.length > 0
    ) {
      modeUsed = 'layer2-incremental';
      attributedSections = attributeSectionsLayer2({
        blocks: parsed.blocks,
        blameByLine,
        existingSections: existingNote.sections,
        fallbackDate,
      });
    } else {
      modeUsed = 'layer1-full';
      attributedSections = attributeSectionsLayer1(
        parsed.blocks,
        blameByLine,
        fallbackDate,
      );
    }

    const sectionsPayload = attributedSections.map((sec) => ({
      content: rewriteRelativeImageUrls(sec.content, relPath, imageBaseUrl),
      date_created: sec.date_created,
    }));

    if (options.dryRun) {
      results.push({
        path: relPath,
        title,
        status: 'dry-run',
        modeUsed,
        sectionsCount: sectionsPayload.length,
      });
      continue;
    }

    const payload = {
      ...(parsed.frontmatter.spaceyId ? { id: parsed.frontmatter.spaceyId } : {}),
      title,
      tags,
      sections: sectionsPayload,
      source: {
        provider: 'github',
        repo: options.repoSlug,
        path: relPath,
        branch: options.branch,
        url: options.repoSlug
          ? `https://github.com/${options.repoSlug}/blob/${encodeURIComponent(options.branch)}/${relPath.split('/').map(encodeURIComponent).join('/')}`
          : undefined,
        source_key: sourceKey,
        last_commit_sha: options.afterSha,
      },
    };

    const syncResp = await fetchImpl(`${apiUrl}/v1/notes/sync`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!syncResp.ok) {
      const errText = await syncResp.text();
      throw new Error(`Failed syncing ${relPath} (${syncResp.status}): ${errText}`);
    }

    const syncJson = (await syncResp.json()) as {
      created: boolean;
      note: { id: string };
      stats: { preserved_sections: number; created_sections: number };
    };

    results.push({
      path: relPath,
      title,
      status: syncJson.created ? 'created' : 'updated',
      modeUsed,
      sectionsCount: sectionsPayload.length,
      preservedSections: syncJson.stats.preserved_sections,
      createdSections: syncJson.stats.created_sections,
      noteId: syncJson.note.id,
    });
  }

  return results;
}

function parseArgs(argv: string[]): Partial<SyncCliOptions> {
  const out: Partial<SyncCliOptions> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--api-url' && next) {
      out.apiUrl = next;
      i++;
    } else if (arg === '--api-key' && next) {
      out.apiKey = next;
      i++;
    } else if (arg === '--repo' && next) {
      out.repoSlug = next;
      i++;
    } else if (arg === '--branch' && next) {
      out.branch = next;
      i++;
    } else if (arg === '--before' && next) {
      out.beforeSha = next;
      i++;
    } else if (arg === '--after' && next) {
      out.afterSha = next;
      i++;
    } else if (arg === '--timezone' && next) {
      out.timeZone = next;
      i++;
    } else if (arg === '--mode' && next) {
      if (next === 'auto' || next === 'full' || next === 'incremental') {
        out.mode = next;
      }
      i++;
    } else if (arg === '--paths' && next) {
      out.pathsFilter = next
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      i++;
    } else if (arg === '--ignore' && next) {
      out.ignoreNames = next
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      i++;
    } else if (arg === '--image-base-url' && next) {
      out.imageBaseUrl = next;
      i++;
    } else if (arg === '--all') {
      out.syncAll = true;
    } else if (arg === '--dry-run') {
      out.dryRun = true;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const dryRun = cli.dryRun ?? process.env.SPACEY_DRY_RUN === 'true';
  const apiUrl = cli.apiUrl ?? process.env.SPACEY_API_URL ?? '';
  const apiKey = cli.apiKey ?? process.env.SPACEY_API_KEY ?? '';

  if (!dryRun && (!apiUrl || !apiKey)) {
    console.error('Error: SPACEY_API_URL and SPACEY_API_KEY are required unless --dry-run is set.');
    process.exit(1);
  }

  const branchRef = process.env.GITHUB_REF_NAME || 'main';
  const results = await syncRepositoryToSpacey({
    repoDir: process.cwd(),
    apiUrl: apiUrl || 'https://spacey-api.spacey-api-worker.workers.dev',
    apiKey,
    repoSlug: cli.repoSlug ?? process.env.GITHUB_REPOSITORY ?? 'local/notes',
    branch: cli.branch ?? branchRef,
    beforeSha: cli.beforeSha ?? process.env.GITHUB_EVENT_BEFORE,
    afterSha: cli.afterSha ?? process.env.GITHUB_SHA ?? 'HEAD',
    timeZone: cli.timeZone ?? process.env.SPACEY_TIMEZONE ?? 'UTC',
    mode: cli.mode ?? 'auto',
    syncAll: cli.syncAll ?? process.env.SPACEY_SYNC_ALL === 'true',
    dryRun,
    pathsFilter: cli.pathsFilter,
    ignoreNames: cli.ignoreNames ?? ['readme.md', 'contributing.md', 'license.md'],
    imageBaseUrl: cli.imageBaseUrl,
  });

  console.log(`Spacey GitHub Sync finished (${results.length} files processed):`);
  for (const r of results) {
    console.log(
      `- [${r.status}] ${r.path} -> "${r.title}" (${r.sectionsCount} sections, mode=${r.modeUsed}` +
        (r.preservedSections !== undefined
          ? `, preserved=${r.preservedSections}, created=${r.createdSections}`
          : '') +
        ')',
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((err) => {
    console.error('Spacey GitHub Sync failed:', err);
    process.exit(1);
  });
}
