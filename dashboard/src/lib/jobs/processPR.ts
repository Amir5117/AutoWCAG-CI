import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { db } from "@/db";
import { patches } from "@/db/schema";
import { getOctokitForRepo } from "@/lib/github";
import { fileExtension, generatePatch as callLLM } from "@/lib/generate-patch";
import { extractComponentContext, type ExtractedComponentContext } from "@/lib/context-extractor";

const RELEVANT_EXTENSIONS = new Set(["jsx", "tsx", "html", "vue"]);

const STRUCTURAL_RULE_IDS = new Set([
  "landmark-one-main",
  "region",
  "document-title",
  "html-has-lang",
  "nested-interactive",
  "page-has-heading-one",
]);

const ACCESSIBILITY_ATTR_NAMES = new Set(["alt", "title", "id", "htmlFor", "role"]);
const SANDBOX_MOCK_VALUE = "sandbox-mock-value";

function isAccessibilityAttrName(name: string): boolean {
  return ACCESSIBILITY_ATTR_NAMES.has(name) || name.startsWith("aria-");
}

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

interface PullRequestRef {
  repoOwner: string;
  repoName: string;
  pullNumber: number;
}

export async function processFile(
  filename: string,
  originalCode: string,
  userId: string,
  pr: PullRequestRef
) {
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
        repoOwner: pr.repoOwner,
        repoName: pr.repoName,
        pullNumber: pr.pullNumber,
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function processPR(payload: any, userId: string) {
  const pullNumber = payload.pull_request?.number;

  try {
    console.log(`Background job started for PR #${pullNumber}...`);

    const owner = payload.repository.owner.login;
    const repo = payload.repository.name;
    const headSha = payload.pull_request.head.sha;

    const octokit = await getOctokitForRepo(owner, repo);

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

      await processFile(changedFile.filename, originalCode, userId, {
        repoOwner: owner,
        repoName: repo,
        pullNumber,
      });
    }

    console.log(`Background job completed for PR #${pullNumber}.`);
  } catch (err) {
    console.error(`Background job failed for PR #${pullNumber}:`, err);
  }
}
