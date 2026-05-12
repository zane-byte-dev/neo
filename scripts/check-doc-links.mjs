#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

const ignoredDirs = new Set([
    '.git',
    'coverage',
    'dist',
    'node_modules',
]);

const markdownExts = new Set(['.md', '.markdown']);
const externalSchemeRe = /^[a-z][a-z0-9+.-]*:/i;
const lineAnchorRe = /^L\d+(?:C\d+)?(?:-L\d+(?:C\d+)?)?$/i;

const headingCache = new Map();
const errors = [];

main();

function main() {
    const markdownFiles = collectMarkdownFiles(repoRoot).sort();
    for (const filePath of markdownFiles) validateMarkdownFile(filePath);

    if (errors.length === 0) {
        console.log(`OK: checked ${markdownFiles.length} Markdown files.`);
        process.exit(0);
    }

    for (const error of errors) console.error(error);
    console.error(`\nFound ${errors.length} broken Markdown link${errors.length === 1 ? '' : 's'}.`);
    process.exit(1);
}

function collectMarkdownFiles(dirPath, out = []) {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (ignoredDirs.has(entry.name)) continue;
            collectMarkdownFiles(resolve(dirPath, entry.name), out);
            continue;
        }

        if (!entry.isFile()) continue;
        if (!markdownExts.has(extname(entry.name).toLowerCase())) continue;
        out.push(resolve(dirPath, entry.name));
    }
    return out;
}

function validateMarkdownFile(filePath) {
    const raw = readFileSync(filePath, 'utf8');
    const source = stripIgnoredBlocks(raw);
    const linkRe = /!?\[[^\]]*\]\(([^)\n]+)\)/g;
    for (const match of source.matchAll(linkRe)) {
        const target = parseLinkTarget(match[1]);
        if (!target) continue;
        if (shouldIgnoreTarget(target)) continue;

        const [pathPart, fragmentPart] = splitTarget(target);
        const line = lineNumberAt(raw, match.index ?? 0);

        if (!pathPart) {
            if (!fragmentPart) continue;
            validateFragment(filePath, filePath, fragmentPart, line, target);
            continue;
        }

        const resolvedPath = resolveLinkPath(filePath, pathPart);
        if (!existsSync(resolvedPath)) {
            pushError(filePath, line, `missing target: ${target}`);
            continue;
        }

        if (!fragmentPart) continue;
        validateFragment(filePath, resolvedPath, fragmentPart, line, target);
    }
}

function stripIgnoredBlocks(source) {
    const lines = source.split('\n');
    const out = [];
    let fence = null;

    for (const line of lines) {
        const trimmed = line.trimStart();
        const fenceMatch = trimmed.match(/^(```+|~~~+)/);

        if (!fence && fenceMatch) {
            fence = fenceMatch[1][0];
            out.push('');
            continue;
        }

        if (fence) {
            if (trimmed.startsWith(fence.repeat(3))) fence = null;
            out.push('');
            continue;
        }

        out.push(line.replace(/<!--.*?-->/g, ''));
    }

    return out.join('\n');
}

function parseLinkTarget(rawTarget) {
    let target = rawTarget.trim();
    if (!target) return null;

    if (target.startsWith('<') && target.endsWith('>')) {
        target = target.slice(1, -1).trim();
    }

    const titleMatch = target.match(/^(\S+)(?:\s+["'].*["'])$/);
    if (titleMatch) target = titleMatch[1];
    return target || null;
}

function shouldIgnoreTarget(target) {
    return (
        target.startsWith('mailto:') ||
        target.startsWith('tel:') ||
        target.startsWith('data:') ||
        target.startsWith('javascript:') ||
        externalSchemeRe.test(target)
    );
}

function splitTarget(target) {
    const hashIndex = target.indexOf('#');
    if (hashIndex === -1) return [stripQuery(target), ''];
    const pathPart = stripQuery(target.slice(0, hashIndex));
    const fragmentPart = decodeURIComponent(target.slice(hashIndex + 1));
    return [pathPart, fragmentPart];
}

function stripQuery(target) {
    const queryIndex = target.indexOf('?');
    return decodeURIComponent(queryIndex === -1 ? target : target.slice(0, queryIndex));
}

function resolveLinkPath(fromFile, linkPath) {
    if (linkPath.startsWith('/')) return resolve(repoRoot, `.${linkPath}`);
    return resolve(dirname(fromFile), linkPath);
}

function validateFragment(originFile, targetPath, fragment, line, rawTarget) {
    if (!fragment || lineAnchorRe.test(fragment)) return;
    if (!markdownExts.has(extname(targetPath).toLowerCase())) return;

    const headings = getHeadingSlugs(targetPath);
    if (!headings.has(fragment)) {
        pushError(originFile, line, `missing anchor: ${rawTarget}`);
    }
}

function getHeadingSlugs(filePath) {
    const cached = headingCache.get(filePath);
    if (cached) return cached;

    const source = readFileSync(filePath, 'utf8');
    const slugs = new Set();
    const seen = new Map();
    const lines = stripIgnoredBlocks(source).split('\n');

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const atx = line.match(/^(#{1,6})\s+(.*?)(?:\s+#+\s*)?$/);
        if (atx) {
            addSlug(atx[2], slugs, seen);
            continue;
        }

        const nextLine = lines[index + 1] ?? '';
        if (!line.trim()) continue;
        if (/^==+\s*$/.test(nextLine) || /^--+\s*$/.test(nextLine)) {
            addSlug(line.trim(), slugs, seen);
            index += 1;
        }
    }

    headingCache.set(filePath, slugs);
    return slugs;
}

function addSlug(headingText, slugs, seen) {
    const base = slugifyHeading(headingText);
    if (!base) return;
    const count = seen.get(base) ?? 0;
    const slug = count === 0 ? base : `${base}-${count}`;
    seen.set(base, count + 1);
    slugs.add(slug);
}

function slugifyHeading(text) {
    return text
        .trim()
        .toLowerCase()
        .replace(/<[^>]+>/g, '')
        .replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}

function lineNumberAt(source, index) {
    let line = 1;
    for (let cursor = 0; cursor < index; cursor += 1) {
        if (source[cursor] === '\n') line += 1;
    }
    return line;
}

function pushError(filePath, line, message) {
    const displayPath = relative(repoRoot, filePath) || filePath;
    errors.push(`${displayPath}:${line} ${message}`);
}