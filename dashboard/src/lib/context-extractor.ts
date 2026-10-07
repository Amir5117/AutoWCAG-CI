import { parse } from "@babel/parser";
import traverse, { type NodePath } from "@babel/traverse";
import * as t from "@babel/types";

const DEFAULT_LINES_ABOVE = 15;
const DEFAULT_LINES_BELOW = 20;
// label/image-alt fixes usually need the parent <form>/wrapper element
// (to add a <label htmlFor> or check for a nearby caption), which sits
// further above the offending line than a typical fix needs.
const WRAPPER_RULE_EXTRA_ABOVE = 15;
const WRAPPER_RULES = new Set(["label", "image-alt"]);
const MAX_TOTAL_LINES = 80;

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Returns `source` with the contents of //-line and block comments blanked
 * out to spaces (newlines preserved, so line numbers and all character
 * offsets stay identical to the original). Used before any regex-based tag
 * scanning so a tag-shaped string sitting inside a comment -- e.g. a
 * descriptive comment like "// <input> with no label" -- can never be
 * mistaken for a real element. String/template literals are also skipped
 * over (not masked, just not scanned for comment starts) so a URL like
 * "http://example.com" isn't misread as a line comment.
 */
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

/**
 * Locates the source line that produced `violationNodeHtml`. axe-core
 * reports the *rendered* outerHTML, which routinely differs from the JSX
 * source it came from (self-closing "/>" collapses to ">", attribute
 * order/quoting can shift, etc.), so an exact substring match is tried
 * first but not relied on -- it falls back to progressively shorter
 * prefixes of the opening tag, then just the tag name.
 */
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

/**
 * Extracts a window of source lines around the violation so the LLM has
 * enough surrounding structure (parent form, sibling labels, etc.) to
 * produce a correct fix instead of hallucinating one from a single tag.
 * This is READ-ONLY context for the model -- see locateNodeFragment for
 * the actual splice target.
 */
export function extractContext(fileContent: string, violationNodeHtml: string, ruleId: string): string {
  const lines = fileContent.split("\n");
  // Search over comment-masked lines so a tag-shaped string inside a
  // comment can't be mistaken for the real offending line -- but slice the
  // returned context from the original, unmasked lines below.
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

// --- Precise node location for splicing -------------------------------

/**
 * Given the index of the "<" that starts a tag named `tagName`, finds the
 * index of the ">" that closes *that* opening tag, ignoring any ">" that
 * appears inside a quoted attribute value.
 */
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

// HTML void elements never have children or a closing tag, and axe/plain
// HTML routinely serializes them without a trailing "/" (e.g. "<img>", not
// "<img />"). JSX source always writes these with an explicit "/>", so this
// only matters for the line-window/.html fallback path.
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

/**
 * Given the index of the "<" that starts a tag named `tagName`, returns the
 * [start, end) span of the whole element -- through its self-closing "/>"
 * (or, for HTML void elements, its own bare ">") or its matching
 * "</tagName>", tracking nesting depth for elements that legitimately
 * nest inside themselves (e.g. nested <div>s).
 */
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

    if (!closeMatch) return null; // unterminated -- bail rather than guess

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

/**
 * Locates the exact source fragment in `fileContent` corresponding to
 * `violationNodeHtml`, so only that single node can be replaced -- never
 * the surrounding context. axe-core's serialized HTML frequently doesn't
 * match the JSX source verbatim (">" vs "/>", attribute order/spacing,
 * quote style), so this tries progressively looser strategies:
 *   1. Exact substring match of the reported HTML.
 *   2. Whitespace/self-closing-normalized match against every element in
 *      the file with the same tag name.
 *   3. Best-effort match by opening-tag attribute overlap (most matching
 *      name="value" pairs wins).
 *   4. If the tag name is unambiguous -- exactly one element with that tag
 *      name exists in the file -- use it. This matters because axe-core's
 *      reported `node.html` can be a bare tag with no attributes at all
 *      (confirmed live: axe reported literally "<img>" for an
 *      <img src="..." width="..." height="..." /> element), which gives
 *      strategies 2 and 3 nothing to work with even though there's no
 *      real ambiguity to resolve.
 * Returns null if no strategy finds a confident match -- callers must
 * treat that as a hard failure, not a reason to guess. Notably, this
 * stays null (correctly) when the tag name is ambiguous (e.g. two
 * <input> elements) and the needle carries no distinguishing attributes.
 */
export function locateNodeFragment(fileContent: string, violationNodeHtml: string): NodeFragmentMatch | null {
  const needle = violationNodeHtml.trim();
  const tagName = needle.match(/^<([a-zA-Z][a-zA-Z0-9]*)/)?.[1];
  if (!tagName) return null;

  // All scanning happens against a comment-masked view of the source, so a
  // tag-shaped string sitting inside a comment (e.g. a descriptive comment
  // that happens to say "<input>") can never be matched as if it were a
  // real element -- confirmed live: a bare axe "<input>" needle matched a
  // "// <input> with no label" comment before this masking was added,
  // because it was a perfect normalized match and nothing distinguished it
  // from the real elements. Positions are 1:1 with the original (masking
  // only blanks comment interiors to spaces, same length), so the actual
  // returned text is always sliced from the original, unmasked source.
  const masked = maskComments(fileContent);

  // Strategy 1: exact substring match.
  const exactIdx = masked.indexOf(needle);
  if (exactIdx !== -1) {
    const span = findTagSpan(masked, exactIdx, tagName);
    if (span) return { text: fileContent.slice(span.start, span.end), ...span };
  }

  // Strategies 2-4: walk every element with a matching tag name.
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

    // Strategy 2: normalized exact match.
    if (normalizeFragment(candidateText) === normalizedNeedle) {
      return { text: candidateText, ...span };
    }

    const score = countMatchingAttrs(needleAttrs, extractAttributes(candidateText));
    candidates.push({ text: candidateText, ...span, score });

    openPattern.lastIndex = span.end;
  }

  // Strategy 3: best attribute-overlap match, if any candidate has one.
  const scored = candidates.filter((c) => c.score > 0).sort((a, b) => b.score - a.score);
  if (scored.length > 0) {
    return { text: scored[0].text, start: scored[0].start, end: scored[0].end };
  }

  // Strategy 4: unambiguous by tag name alone.
  if (candidates.length === 1) {
    return { text: candidates[0].text, start: candidates[0].start, end: candidates[0].end };
  }

  return null;
}

// --- AST-based extraction (.jsx / .tsx) --------------------------------
//
// The line-window + regex-scanned approach above works, but a window is
// cut at arbitrary line boundaries that don't align with JSX structure,
// and locateNodeFragment's tag-matching is a hand-rolled approximation of
// what a real parser already knows for free. Parsing with @babel/parser
// and matching against actual JSXElement nodes means:
//   - the extracted "context" boundary is always a syntactically complete
//     subtree (a real AST node's source span, never a mid-node cut), and
//   - the splice target is an exact AST node span, so reconstruction can
//     never produce "Adjacent JSX elements must be wrapped" errors from
//     a boundary slicing through the middle of an element.

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

/**
 * Among all JSXElements in the AST with a tag name matching the violation,
 * picks the one that actually corresponds to it, using the same tiered
 * strategy as locateNodeFragment (exact match, normalized match, attribute
 * overlap, then "unambiguous by tag name alone" as a last resort) --
 * except operating on real AST node boundaries instead of regex-scanned
 * ones.
 */
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

/**
 * Walks up from the matched JSX element to the nearest meaningful,
 * syntactically complete boundary: the closest enclosing <form> or
 * semantic container (section/header/nav/main/footer/article/aside) that
 * still fits under maxLines, falling back to the largest complete JSX
 * ancestor that fits, and finally the target element itself if nothing
 * else qualifies. Never returns a boundary that cuts across a node.
 */
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

/**
 * Primary extraction entry point. Prefers real AST-based extraction for
 * .jsx/.tsx files (see extractViaAst) so the extracted context is always a
 * syntactically complete subtree and the splice target is an exact node
 * span. Falls back to the line-window extractor (extractContext +
 * locateNodeFragment) for .html files or if JSX parsing/matching fails.
 * Throws if neither strategy can confidently locate the violation --
 * callers must not silently guess a splice target.
 */
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
