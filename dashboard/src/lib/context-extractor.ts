import { parse } from "@babel/parser";
import traverse, { type NodePath } from "@babel/traverse";
import * as t from "@babel/types";

const DEFAULT_LINES_ABOVE = 15;
const DEFAULT_LINES_BELOW = 20;
const WRAPPER_RULE_EXTRA_ABOVE = 15;
const WRAPPER_RULES = new Set(["label", "image-alt"]);
const MAX_TOTAL_LINES = 80;

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function maskComments(source: string): string {
  const result = source.split("");
  let i = 0;
  const n = source.length;

  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }

    if (ch === "/" && next === "/") {
      while (i < n && source[i] !== "\n") {
        result[i] = " ";
        i++;
      }
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n - 1 && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] !== "\n") result[i] = " ";
        i++;
      }
      if (i < n - 1) {
        result[i] = " ";
        result[i + 1] = " ";
        i += 2;
      }
      continue;
    }

    i++;
  }

  return result.join("");
}

function findOffendingLineIndex(lines: string[], violationNodeHtml: string): number {
  const needle = violationNodeHtml.trim();

  const exactIdx = lines.findIndex((line) => line.includes(needle));
  if (exactIdx !== -1) return exactIdx;

  const openingTag = needle.match(/^<[a-zA-Z][a-zA-Z0-9]*\b[^>]*/)?.[0]?.replace(/\/$/, "").trim();
  if (openingTag) {
    for (let len = openingTag.length; len > 10; len -= 5) {
      const probe = openingTag.slice(0, len);
      const idx = lines.findIndex((line) => line.includes(probe));
      if (idx !== -1) return idx;
    }
  }

  const tagName = needle.match(/^<([a-zA-Z][a-zA-Z0-9]*)/)?.[1];
  if (tagName) {
    const idx = lines.findIndex((line) => line.includes(`<${tagName}`));
    if (idx !== -1) return idx;
  }

  return 0;
}

export function extractContext(fileContent: string, violationNodeHtml: string, ruleId: string): string {
  const lines = fileContent.split("\n");
  const maskedLines = maskComments(fileContent).split("\n");
  const offendingLine = findOffendingLineIndex(maskedLines, violationNodeHtml);

  const linesAbove = DEFAULT_LINES_ABOVE + (WRAPPER_RULES.has(ruleId) ? WRAPPER_RULE_EXTRA_ABOVE : 0);

  const start = Math.max(0, offendingLine - linesAbove);
  let end = Math.min(lines.length, offendingLine + DEFAULT_LINES_BELOW + 1);

  if (end - start > MAX_TOTAL_LINES) {
    end = start + MAX_TOTAL_LINES;
  }

  return lines.slice(start, end).join("\n");
}

function findOpenTagEnd(source: string, tagStart: number): number | null {
  let i = tagStart + 1;
  let quote: '"' | "'" | null = null;

  while (i < source.length) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
    i++;
  }

  return null;
}

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

function findTagSpan(source: string, tagStart: number, tagName: string): { start: number; end: number } | null {
  const openEnd = findOpenTagEnd(source, tagStart);
  if (openEnd === null) return null;

  if (source[openEnd - 1] === "/" || VOID_ELEMENTS.has(tagName.toLowerCase())) {
    return { start: tagStart, end: openEnd + 1 };
  }

  const openPattern = new RegExp(`<${escapeRegExp(tagName)}(?=[\\s/>])`, "g");
  const closePattern = new RegExp(`</${escapeRegExp(tagName)}\\s*>`, "g");

  let depth = 1;
  let cursor = openEnd + 1;

  while (depth > 0) {
    openPattern.lastIndex = cursor;
    closePattern.lastIndex = cursor;
    const openMatch = openPattern.exec(source);
    const closeMatch = closePattern.exec(source);

    if (!closeMatch) return null;

    if (openMatch && openMatch.index < closeMatch.index) {
      const innerOpenEnd = findOpenTagEnd(source, openMatch.index);
      if (innerOpenEnd === null) return null;
      if (source[innerOpenEnd - 1] !== "/") depth++;
      cursor = innerOpenEnd + 1;
    } else {
      depth--;
      cursor = closeMatch.index + closeMatch[0].length;
      if (depth === 0) {
        return { start: tagStart, end: cursor };
      }
    }
  }

  return null;
}

function normalizeFragment(html: string): string {
  return html
    .replace(/\s+/g, " ")
    .replace(/\s*\/>/g, ">")
    .trim();
}

function extractAttributes(html: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const attrPattern = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(html))) {
    attrs.set(match[1], match[3] ?? match[4] ?? "");
  }
  return attrs;
}

function countMatchingAttrs(a: Map<string, string>, b: Map<string, string>): number {
  let score = 0;
  for (const [key, value] of a) {
    if (b.get(key) === value) score++;
  }
  return score;
}

export interface NodeFragmentMatch {
  text: string;
  start: number;
  end: number;
}

export function locateNodeFragment(fileContent: string, violationNodeHtml: string): NodeFragmentMatch | null {
  const needle = violationNodeHtml.trim();
  const tagName = needle.match(/^<([a-zA-Z][a-zA-Z0-9]*)/)?.[1];
  if (!tagName) return null;

  const masked = maskComments(fileContent);

  const exactIdx = masked.indexOf(needle);
  if (exactIdx !== -1) {
    const span = findTagSpan(masked, exactIdx, tagName);
    if (span) return { text: fileContent.slice(span.start, span.end), ...span };
  }

  const normalizedNeedle = normalizeFragment(needle);
  const needleAttrs = extractAttributes(needle);

  const openPattern = new RegExp(`<${escapeRegExp(tagName)}(?=[\\s/>])`, "g");
  const candidates: (NodeFragmentMatch & { score: number })[] = [];
  let match: RegExpExecArray | null;

  while ((match = openPattern.exec(masked))) {
    const span = findTagSpan(masked, match.index, tagName);
    if (!span) {
      openPattern.lastIndex = match.index + 1;
      continue;
    }

    const candidateText = fileContent.slice(span.start, span.end);

    if (normalizeFragment(candidateText) === normalizedNeedle) {
      return { text: candidateText, ...span };
    }

    const score = countMatchingAttrs(needleAttrs, extractAttributes(candidateText));
    candidates.push({ text: candidateText, ...span, score });

    openPattern.lastIndex = span.end;
  }

  const scored = candidates.filter((c) => c.score > 0).sort((a, b) => b.score - a.score);
  if (scored.length > 0) {
    return { text: scored[0].text, start: scored[0].start, end: scored[0].end };
  }

  if (candidates.length === 1) {
    return { text: candidates[0].text, start: candidates[0].start, end: candidates[0].end };
  }

  return null;
}

const AST_PARSE_PLUGINS = ["jsx", "typescript"] as const;

const SEMANTIC_CONTAINER_TAGS = new Set([
  "section",
  "header",
  "nav",
  "main",
  "footer",
  "article",
  "aside",
]);

function getJSXElementName(node: t.JSXElement): string {
  const name = node.openingElement.name;
  if (t.isJSXIdentifier(name)) return name.name;
  if (t.isJSXMemberExpression(name) && t.isJSXIdentifier(name.property)) {
    return name.property.name;
  }
  return "";
}

function countLines(text: string): number {
  return text.split("\n").length;
}

function pickBestJsxMatch(
  fileContent: string,
  jsxElements: NodePath<t.JSXElement>[],
  violationNodeHtml: string
): NodePath<t.JSXElement> | null {
  const needle = violationNodeHtml.trim();
  const tagName = needle.match(/^<([a-zA-Z][a-zA-Z0-9]*)/)?.[1];
  if (!tagName) return null;

  const sameTag = jsxElements.filter(
    (path) =>
      getJSXElementName(path.node) === tagName &&
      typeof path.node.start === "number" &&
      typeof path.node.end === "number"
  );
  if (sameTag.length === 0) return null;

  const normalizedNeedle = normalizeFragment(needle);
  const needleAttrs = extractAttributes(needle);

  for (const path of sameTag) {
    const text = fileContent.slice(path.node.start!, path.node.end!);
    if (text.trim() === needle || normalizeFragment(text) === normalizedNeedle) {
      return path;
    }
  }

  let best: { path: NodePath<t.JSXElement>; score: number } | null = null;
  for (const path of sameTag) {
    const text = fileContent.slice(path.node.start!, path.node.end!);
    const score = countMatchingAttrs(needleAttrs, extractAttributes(text));
    if (score > 0 && (!best || score > best.score)) {
      best = { path, score };
    }
  }
  if (best) return best.path;

  if (sameTag.length === 1) return sameTag[0];

  return null;
}

function findBoundary(
  targetPath: NodePath<t.JSXElement>,
  maxLines: number,
  fileContent: string
): NodePath<t.JSXElement> {
  let current: NodePath | null = targetPath;
  let lastFitting: NodePath<t.JSXElement> = targetPath;

  while (current && !t.isFunction(current.node) && !t.isProgram(current.node)) {
    if (
      t.isJSXElement(current.node) &&
      typeof current.node.start === "number" &&
      typeof current.node.end === "number"
    ) {
      const lines = countLines(fileContent.slice(current.node.start, current.node.end));
      if (lines > maxLines) break;

      lastFitting = current as NodePath<t.JSXElement>;
      const tagName = getJSXElementName(current.node);
      if (tagName === "form" || SEMANTIC_CONTAINER_TAGS.has(tagName)) {
        return lastFitting;
      }
    }

    if (!current.parentPath) break;
    current = current.parentPath;
  }

  return lastFitting;
}

export interface ExtractedComponentContext {
  context: string;
  start: number;
  end: number;
  matchedNodeSource: string;
  matchedNodeStart: number;
  matchedNodeEnd: number;
  method: "ast" | "line-window";
}

function extractViaAst(
  fileContent: string,
  violationNodeHtml: string,
  maxLines: number
): ExtractedComponentContext | null {
  let ast;
  try {
    ast = parse(fileContent, { sourceType: "module", plugins: [...AST_PARSE_PLUGINS] });
  } catch {
    return null;
  }

  const jsxElements: NodePath<t.JSXElement>[] = [];
  traverse(ast, {
    JSXElement(path) {
      jsxElements.push(path);
    },
  });

  const matched = pickBestJsxMatch(fileContent, jsxElements, violationNodeHtml);
  if (!matched || typeof matched.node.start !== "number" || typeof matched.node.end !== "number") {
    return null;
  }

  const matchedNodeStart = matched.node.start;
  const matchedNodeEnd = matched.node.end;

  const boundary = findBoundary(matched, maxLines, fileContent);
  if (typeof boundary.node.start !== "number" || typeof boundary.node.end !== "number") {
    return null;
  }

  return {
    context: fileContent.slice(boundary.node.start, boundary.node.end),
    start: boundary.node.start,
    end: boundary.node.end,
    matchedNodeSource: fileContent.slice(matchedNodeStart, matchedNodeEnd),
    matchedNodeStart,
    matchedNodeEnd,
    method: "ast",
  };
}

function extractViaLineWindow(
  fileContent: string,
  violationNodeHtml: string,
  ruleId: string
): ExtractedComponentContext {
  const context = extractContext(fileContent, violationNodeHtml, ruleId);
  const nodeMatch = locateNodeFragment(fileContent, violationNodeHtml);

  if (!nodeMatch) {
    throw new Error(
      `Could not confidently locate the offending node for rule "${ruleId}" via the line-window fallback -- refusing to guess a splice target`
    );
  }

  const contextStart = fileContent.indexOf(context);
  const contextEnd = contextStart === -1 ? -1 : contextStart + context.length;

  return {
    context,
    start: contextStart,
    end: contextEnd,
    matchedNodeSource: nodeMatch.text,
    matchedNodeStart: nodeMatch.start,
    matchedNodeEnd: nodeMatch.end,
    method: "line-window",
  };
}

export function extractComponentContext(params: {
  filePath: string;
  fileContent: string;
  violationHtml: string;
  ruleId?: string;
  preferredMaxLines?: number;
}): ExtractedComponentContext {
  const { filePath, fileContent, violationHtml, ruleId = "", preferredMaxLines = MAX_TOTAL_LINES } = params;
  const ext = filePath.split(".").pop()?.toLowerCase();

  if (ext === "jsx" || ext === "tsx") {
    const astResult = extractViaAst(fileContent, violationHtml, preferredMaxLines);
    if (astResult) return astResult;
  }

  return extractViaLineWindow(fileContent, violationHtml, ruleId);
}
