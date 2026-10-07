import Groq from "groq-sdk";
import { parse } from "@babel/parser";
import type { ExtractedComponentContext } from "@/lib/context-extractor";

// llama3-70b-8192 was decommissioned by Groq; openai/gpt-oss-120b is the
// strongest general-purpose chat model currently available on this account
// and supports JSON mode (see ast-parser/fix.js for the original finding).
const MODEL = "openai/gpt-oss-120b";
const MAX_ATTEMPTS = 3;

// Read-only context prompt: the LLM sees the extracted context (an AST
// subtree for .jsx/.tsx, or a line-window fallback) purely to understand
// IDs, parent elements, and structure -- it must return a replacement for
// only the offending node itself, never the surrounding context. Splicing
// back a whole context window (the original approach) cut across
// arbitrary boundaries and produced "Adjacent JSX elements must be
// wrapped" errors; replacing just the single located AST node span avoids
// that class of corruption entirely.
const SYSTEM_PROMPT =
  'You are an expert accessibility engineer making a surgical, minimal-risk fix. You will be given a window of surrounding source code and one specific axe-core violation to fix: the rule, why it fails, and the exact offending HTML element. The surrounding code is provided ONLY as read-only context so you understand IDs, parent elements, and structure. Do NOT rewrite or return the entire context window. Return ONLY the corrected version of the offending node (or the minimal self-contained fragment that must change) -- do not alter business logic, state, styling/class names, or any unrelated markup. CRITICAL: if you cannot produce a confident, correct, self-contained fix from the given context (for example, the offending element or its relevant parent/sibling structure isn\'t actually present), you MUST set "replacement" to null rather than guessing. You must output ONLY a valid JSON object matching this schema: { "replacement": "<the corrected version of the offending node/fragment, or null if you cannot confidently fix it>", "explanation": "<one sentence on what you changed, or why you returned null>" }. Do not include markdown code blocks or backticks in the output, just the raw JSON object.';

// Rule-specific hints for the two rules that have historically produced
// patches that looked plausible but didn't actually satisfy axe-core on
// re-scan (see Phase 5 steps 6-9). Injected into the prompt whenever the
// violation being fixed matches.
const RULE_HINTS: Record<string, string> = {
  "image-alt":
    'Rule-specific requirement for image-alt: the replacement <img> MUST include a non-empty "alt" attribute describing the image\'s actual visual content in a few concrete words (not the filename, not generic text like "image" or "photo"). If the image is truly decorative and conveys no information, use alt="" instead -- but only if that is genuinely appropriate here.',
  label:
    'Rule-specific requirement for label: the replacement form control MUST have a programmatically-associated accessible name. Do this by EITHER (a) adding an "id" to the control and a sibling <label htmlFor="that-exact-id"> with real visible text (the htmlFor value must exactly match the id), OR (b) wrapping the control inside a <label> element, OR (c) adding an "aria-label" with real descriptive text. Do not invent a new id if a suitable one already exists on the element or a nearby <label> in the context.',
};

// Babel can only meaningfully validate JS/JSX/TS syntax -- .html and .vue
// files (also in scope for this pipeline) aren't parseable as JavaScript,
// so they only get the structural (non-empty string) check below.
const BABEL_VALIDATABLE_EXTENSIONS = new Set(["js", "jsx", "ts", "tsx"]);

export class PatchGenerationError extends Error {
  attemptsCount: number;
  cause?: unknown;

  constructor(message: string, attemptsCount: number, cause?: unknown) {
    super(message);
    this.name = "PatchGenerationError";
    this.attemptsCount = attemptsCount;
    this.cause = cause;
  }
}

export interface GeneratedPatch {
  patchedCode: string;
  explanation?: string;
  attemptsCount: number;
}

export interface ViolationContext {
  ruleId: string;
  help: string;
}

export function fileExtension(file: string) {
  return file.split(".").pop()?.toLowerCase() ?? "";
}

function assertValidCode(file: string, code: string) {
  if (!code.trim()) {
    throw new Error("LLM returned empty patchedCode");
  }

  if (BABEL_VALIDATABLE_EXTENSIONS.has(fileExtension(file))) {
    parse(code, { sourceType: "module", plugins: ["jsx", "typescript"] });
  }
}

function buildUserPrompt(
  file: string,
  extraction: ExtractedComponentContext,
  violation: ViolationContext,
  feedbackMessage?: string
): string {
  const ruleHint = RULE_HINTS[violation.ruleId];

  let prompt = `File: ${file}\n\nRead-only surrounding context (for understanding structure only -- do not return this):\n\n${extraction.context}\n\nFix ONLY this specific axe-core violation:\nRule: ${violation.ruleId}\nWhy it fails: ${violation.help}`;

  if (ruleHint) {
    prompt += `\n${ruleHint}`;
  }

  prompt += `\nOffending element (this exact node is what you must replace):\n${extraction.matchedNodeSource}`;

  if (feedbackMessage) {
    prompt += `\n\nCRITICAL FEEDBACK FROM PREVIOUS ATTEMPT: ${feedbackMessage}. Fix this exact failure.`;
  }

  return prompt;
}

/**
 * Calls Groq to generate a surgical fix for one violation. `extraction`
 * (from context-extractor.ts's extractComponentContext) supplies both the
 * read-only context shown to the model and the exact node span to splice
 * -- located once, up front, by the caller, since it's a deterministic
 * function of the file and the violation. `feedbackMessage`, when
 * provided, is injected as explicit critical feedback from a prior sandbox
 * validation failure -- the caller (processPR.ts) is responsible for
 * calling this function a second time with that feedback when the first
 * patch fails re-validation; this function itself only knows about a
 * single call's worth of retries.
 *
 * Retries up to MAX_ATTEMPTS times within a single call on a request
 * error, malformed JSON, a null replacement (insufficient context), or
 * invalid reconstructed code, then throws PatchGenerationError.
 */
export async function generatePatch(
  file: string,
  originalCode: string,
  extraction: ExtractedComponentContext,
  violation: ViolationContext,
  feedbackMessage?: string
): Promise<GeneratedPatch> {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const userPrompt = buildUserPrompt(file, extraction, violation, feedbackMessage);

  let lastError: unknown = null;

  for (let attemptsCount = 1; attemptsCount <= MAX_ATTEMPTS; attemptsCount++) {
    try {
      const completion = await groq.chat.completions.create({
        model: MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      });

      const raw = completion.choices[0]?.message?.content;
      if (!raw) {
        throw new Error("Empty LLM response");
      }

      let parsed: { replacement: string | null; explanation?: string };
      try {
        parsed = JSON.parse(raw);
      } catch (parseErr) {
        throw new Error(
          `LLM response was not valid JSON: ${
            parseErr instanceof Error ? parseErr.message : String(parseErr)
          }`
        );
      }

      if (parsed.replacement === null) {
        throw new Error(
          `LLM reported insufficient context to fix ${violation.ruleId}${
            parsed.explanation ? `: ${parsed.explanation}` : ""
          }`
        );
      }

      if (typeof parsed.replacement !== "string") {
        throw new Error('LLM response did not contain a "replacement" string (or null)');
      }

      // Splice ONLY the located node -- the surrounding file (including the
      // read-only context window) stays byte-for-byte untouched.
      const patchedCode =
        originalCode.slice(0, extraction.matchedNodeStart) +
        parsed.replacement +
        originalCode.slice(extraction.matchedNodeEnd);

      assertValidCode(file, patchedCode);

      return { patchedCode, explanation: parsed.explanation, attemptsCount };
    } catch (err) {
      lastError = err;
      console.warn(
        `Attempt ${attemptsCount} failed to generate a valid patch for ${file} / ${violation.ruleId}: ${
          err instanceof Error ? err.message : String(err)
        }. Retrying...`
      );
    }
  }

  throw new PatchGenerationError(
    `All ${MAX_ATTEMPTS} attempts failed to produce a valid patch for ${file} / ${violation.ruleId}`,
    MAX_ATTEMPTS,
    lastError
  );
}
