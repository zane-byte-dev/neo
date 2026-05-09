#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const inputPath = process.argv[2];
const raw = inputPath
  ? readFileSync(inputPath, 'utf8')
  : readFileSync(0, 'utf8');

function normalizeMarker(line) {
  return line.trim().replace(/\s+/g, '');
}

function isFenceLine(line) {
  return /^(```|~~~)/.test(line.trim());
}

function isCommentMarker(marker) {
  return /^(精选留言|全部评论|评论|留言[:：]?\d*|写留言)$/.test(marker);
}

function isFooterMarker(marker) {
  return [
    /^作者推荐[:：]?$/,
    /^历史文章[:：]?$/,
    /^往期(推荐|文章)[:：]?$/,
    /^推荐阅读[:：]?$/,
    /^相关阅读[:：]?$/,
    /^延伸阅读[:：]?$/,
    /^相关文章[:：]?$/,
    /^精选留言$/,
    /^全部评论$/,
    /^评论[:：]?$/,
    /^留言[:：]?\d*$/,
    /^写留言$/,
    /^喜欢此内容的人还喜欢$/,
    /^阅读原文$/,
    /^继续滑动看下一个$/,
    /^向上滑动看下一个$/,
  ].some((pattern) => pattern.test(marker));
}

function stripFooter(lines) {
  let charsBeforeLine = 0;
  let insideFence = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (isFenceLine(line)) insideFence = !insideFence;
    if (insideFence) {
      charsBeforeLine += line.trim().length;
      continue;
    }

    const marker = normalizeMarker(line);
    if (!marker) continue;
    if (!isFooterMarker(marker)) {
      charsBeforeLine += line.trim().length;
      continue;
    }

    const minimumBodyChars = isCommentMarker(marker) ? 300 : 120;
    const hasEnoughBody = charsBeforeLine >= minimumBodyChars && lineIndex >= 4;
    const isLateCommentSection = !isCommentMarker(marker)
      || lineIndex >= Math.floor(lines.length * 0.5)
      || charsBeforeLine >= 1200;

    if (hasEnoughBody && isLateCommentSection) return lines.slice(0, lineIndex);
    charsBeforeLine += line.trim().length;
  }

  return lines;
}

function collapseBlankLines(lines) {
  const result = [];
  let previousWasBlank = false;
  let insideFence = false;

  for (const line of lines) {
    const cleanLine = line.replace(/[ \t]+$/g, '');
    if (isFenceLine(cleanLine)) {
      insideFence = !insideFence;
      result.push(cleanLine);
      previousWasBlank = false;
      continue;
    }

    if (insideFence) {
      result.push(cleanLine);
      continue;
    }

    if (!cleanLine.trim()) {
      if (result.length > 0 && !previousWasBlank) result.push('');
      previousWasBlank = true;
      continue;
    }

    result.push(cleanLine);
    previousWasBlank = false;
  }

  while (result.length > 0 && !result[result.length - 1].trim()) result.pop();
  return result;
}

function cleanXifengArticle(text) {
  const lines = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n');
  return collapseBlankLines(stripFooter(lines)).join('\n').trim();
}

process.stdout.write(`${cleanXifengArticle(raw)}\n`);
