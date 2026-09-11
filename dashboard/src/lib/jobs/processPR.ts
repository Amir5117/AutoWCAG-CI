import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { db } from "@/db";
import { patches } from "@/db/schema";
import { getOctokitForRepo } from "@/lib/github";
import { fileExtension, generatePatch as callLLM } from "@/lib/generate-patch";
import { extractComponentContext, type ExtractedComponentContext } from "@/lib/context-extractor";

const RELEVANT_EXTENSIONS = new Set(["jsx", "tsx", "html", "vue"]);

// Same rationale as ast-parser/extract.js's STRUCTURAL_RULE_IDS (landmark-one-main,
// region): mounting a bare component via page.setContent() has no
// <head>/<title>, <html lang>, or <main> landmark, so axe flags page-shell
// issues no component-only edit can legitimately fix. Left unfiltered, the
// sandbox can be satisfied by patches that are technically "valid" but
// actually broken -- confirmed live: asked to fix html-has-lang, the LLM
// wrapped the component's <form> in a literal <html lang="en">, which
// would nest a document element inside a React tree and break rendering
// if ever applied for real. document-title and nested-interactive are the
// same category of page-shell/DOM-structure rule, not a per-component one.
const STRUCTURAL_RULE_IDS = new Set([
  "landmark-one-main",
  "region",
  "document-title",
  "html-has-lang",
  "nested-interactive",
  "page-has-heading-one",
]);

// --- Pipeline stages -------------------------------------------------------

// Attribute names axe-core actually reads to compute accessible names/roles
// and label associations. A dynamic binding on one of these (e.g.
// `alt={user.name}`, `aria-label={item.label}`) is very often *the LLM's
// fix itself* -- stripping it the same way as `onChange={...}` would defeat
// the very patch the sandbox is supposed to validate.
const ACCESSIBILITY_ATTR_NAMES = new Set(["alt", "title", "id", "htmlFor", "role"]);
const SANDBOX_MOCK_VALUE = "sandbox-mock-value";

function isAccessibilityAttrName(name: string): boolean {
  return ACCESSIBILITY_ATTR_NAMES.has(name) || name.startsWith("aria-");
}

/**
 * The sandbox has no real JSX renderer -- it feeds component source
 * straight into page.setContent() so axe-core can scan the resulting DOM.
 * Browsers parse `attr={expr}` as an *unquoted* HTML attribute value, which
 * terminates at the first whitespace inside the expression. E.g.
 * `onChange={(e) => setEmail(e.target.value)}` breaks after `{(e)` (the
 * space before "=>"), and the stray `=>` and `)` that follow get parsed as
 * garbage attributes/text, corrupting every attribute and often the tag
 * boundary itself -- not just that one prop.
 *
 * Any attribute bound to a `{...}` JS expression gets handled one of two
 * ways before the browser ever sees it:
 *  - Accessibility/structural props (alt, title, id, htmlFor, role,
 *    aria-*) are kept, with the `{...}` replaced by a static
 *    SANDBOX_MOCK_VALUE string -- axe-core needs *some* concrete value
 *    there to validate the fix (e.g. that `alt` is non-empty), and it
 *    can't evaluate the real expression without a real render.
 *  - Everything else (event handlers, value={x}, src={x}, style={{...}},
 *    ...) is dropped entirely -- axe-core doesn't need it, and there's no
 *    single mock value that would be meaningful for arbitrary props.
 *
 * Brace-depth tracking (not a flat `[^}]+` regex) so nested braces --
 * arrow-function bodies, `style={{...}}` -- don't truncate the expression
 * at its first inner "}".
 */
function stripDynamicJsxBindings(source: string): string {
  let result = "";
  let i = 0;

  while (i < source.length) {
    const bindingStart = source.indexOf("={", i);
    if (bindingStart === -1) {
      result += source.slice(i);
      break;
    }

    let nameStart = bindingStart;
    while (nameStart > 0 && /[A-Za-z0-9_-]/.test(source[nameStart - 1])) {
      nameStart--;
    }

    const attrName = source.slice(nameStart, bindingStart);
    result += source.slice(i, nameStart);

    let depth = 0;
    let j = bindingStart + 1;
    for (; j < source.length; j++) {
      if (source[j] === "{") depth++;
      else if (source[j] === "}") {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
    }

    if (isAccessibilityAttrName(attrName)) {
      result += `${attrName}="${SANDBOX_MOCK_VALUE}"`;
    }

    i = j;
  }

  return result;
}

/**
 * Mounts raw HTML/JSX in a throwaway headless page and runs axe-core
 * against it, returning the violations found. Always closes the browser,
 * even if axe itself throws, to avoid leaking zombie Chromium processes.
 */
async function runAxeScan(rawHtml: string) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent(stripDynamicJsxBindings(rawHtml));
    const results = await new AxeBuilder({ page }).analyze();
    return results.violations;
  } finally {
    await browser.close();
  }
}

// Thin adapter into src/lib/generate-patch.ts's already-verified Groq call +
// 3-attempt retry/validation loop, rather than duplicating that logic here.
async function generatePatch(
  file: string,
  originalCode: string,
  extraction: ExtractedComponentContext,
  violation: { ruleId: string; help: string },
  feedbackMessage?: string
) {
  return callLLM(file, originalCode, extraction, violation, feedbackMessage);
}

interface SandboxValidationResult {
  passed: boolean;
  failureMessage?: string;
}

/**
 * Mounts the LLM's patched code and re-runs axe-core, checking specifically
 * whether the violation it was asked to fix (`ruleId`) is actually gone.
 * On failure, builds a concrete failure message (the still-failing rule's
 * help text plus the offending element as axe now sees it) so the caller
 * can feed it back to the LLM for a self-correcting second attempt,
 * instead of just discarding the patch. Returns passed: false rather than
 * throwing when the violation is still present -- that's an expected
 * outcome (a bad patch), not a pipeline error.
 */
async function validateInSandbox(patchedCode: string, ruleId: string): Promise<SandboxValidationResult> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent(stripDynamicJsxBindings(patchedCode));
    const results = await new AxeBuilder({ page }).analyze();
    const violation = results.violations.find((v) => v.id === ruleId);

    if (!violation) {
      return { passed: true };
    }

    const nodeHtml = violation.nodes[0]?.html;
    const failureMessage = `axe-core rule "${ruleId}" is still failing after this fix: ${violation.help}.${
      nodeHtml ? ` The element axe now flags: ${nodeHtml}` : ""
    }`;

    return { passed: false, failureMessage };
  } finally {
    await browser.close();
  }
}

/**
 * Scans one file, generates and sandbox-validates a targeted patch for each
 * violation found, and inserts only the ones that actually pass validation.
 * Isolated per-violation try/catch so one bad LLM response or a sandbox
 * mounting error doesn't stop the rest of this file's violations -- or the
 * rest of the PR's files -- from being processed.
 */
export async function processFile(filename: string, originalCode: string, userId: string) {
  let allViolations;
  try {
    allViolations = await runAxeScan(originalCode);
  } catch (err) {
    console.error(`Axe scan failed for ${filename}:`, err instanceof Error ? err.message : err);
    return;
  }

  const violations = allViolations.filter((v) => !STRUCTURAL_RULE_IDS.has(v.id));

  if (violations.length === 0) {
    console.log(`${filename}: clean scan, no component-level violations found.`);
    return;
  }

  for (const violation of violations) {
    const html = violation.nodes[0]?.html ?? "";

    try {
      const extraction = extractComponentContext({
        filePath: filename,
        fileContent: originalCode,
        violationHtml: html,
        ruleId: violation.id,
      });

      console.log(
        `${filename} / ${violation.id}: extracted context via "${extraction.method}" (${
          extraction.context.split("\n").length
        } lines).`
      );

      const violationInfo = { ruleId: violation.id, help: violation.help };

      let generated = await generatePatch(filename, originalCode, extraction, violationInfo);
      let validation = await validateInSandbox(generated.patchedCode, violation.id);
      let succeededOnRetry = false;

      if (!validation.passed) {
        console.warn(
          `Sandbox validation failed for ${filename} / ${violation.id} on attempt 1 (${generated.attemptsCount} LLM attempt(s)): ${validation.failureMessage}. Retrying with sandbox feedback...`
        );

        generated = await generatePatch(
          filename,
          originalCode,
          extraction,
          violationInfo,
          validation.failureMessage
        );
        validation = await validateInSandbox(generated.patchedCode, violation.id);
        succeededOnRetry = true;

        if (!validation.passed) {
          console.warn(
            `Sandbox validation failed again for ${filename} / ${violation.id} after feedback retry (${generated.attemptsCount} LLM attempt(s)): ${validation.failureMessage}. Discarding patch.`
          );
          continue;
        }
      }

      await db.insert(patches).values({
        userId,
        file: filename,
        ruleId: violation.id,
        status: "pending",
        originalCode,
        patchedCode: generated.patchedCode,
      });

      console.log(
        `Inserted validated patch for ${filename} / ${violation.id}${
          succeededOnRetry ? " (succeeded on retry 2 with sandbox feedback)" : ""
        } (${generated.attemptsCount} LLM attempt(s)).`
      );
    } catch (err) {
      console.error(
        `Failed to generate/validate a patch for ${filename} / ${violation.id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
}

/**
 * Background job entry point, invoked via `after()` from the webhook route
 * so the HTTP response isn't held open for Octokit + Playwright + LLM
 * work. Never throws -- failures are logged, not surfaced, since there's
 * no request left to report them to.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- webhook payload shape isn't modeled yet; typed properly once the stages above consume specific fields.
export async function processPR(payload: any, userId: string) {
  const pullNumber = payload.pull_request?.number;

  try {
    console.log(`Background job started for PR #${pullNumber}...`);

    const owner = payload.repository.owner.login;
    const repo = payload.repository.name;
    const headSha = payload.pull_request.head.sha;

    const octokit = await getOctokitForRepo(owner, repo);

    // listFiles defaults to 30 files/page -- a PR with more than that
    // silently drops everything past page 1. 100 is the API's per-page
    // ceiling; a PR bigger than that still needs real pagination.
    const { data: changedFiles } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    });

    const relevantFiles = changedFiles.filter((f) =>
      RELEVANT_EXTENSIONS.has(fileExtension(f.filename))
    );

    if (relevantFiles.length === 0) {
      console.log(`PR #${pullNumber} has no relevant frontend file changes; nothing to do.`);
      return;
    }

    for (const changedFile of relevantFiles) {
      const { data: contentData } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: changedFile.filename,
        ref: headSha,
      });

      if (Array.isArray(contentData) || contentData.type !== "file" || !contentData.content) {
        console.warn(`Skipping ${changedFile.filename}: not a readable file.`);
        continue;
      }

      const originalCode = Buffer.from(contentData.content, "base64").toString("utf-8");

      await processFile(changedFile.filename, originalCode, userId);
    }

    console.log(`Background job completed for PR #${pullNumber}.`);
  } catch (err) {
    console.error(`Background job failed for PR #${pullNumber}:`, err);
  }
}
