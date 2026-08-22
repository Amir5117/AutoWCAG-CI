// AutoWCAG-CI Phase 1, Step 4: LLM Remediation via Groq.
// Sends the isolated component + violation context to Groq and writes the
// patched component back out for review.

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const Groq = require("groq-sdk");

const CONTEXT_PATH = path.join(__dirname, "extracted_context.json");
const OUTPUT_PATH = path.join(__dirname, "..", "target-app", "src", "CheckoutForm.patched.jsx");
// llama3-70b-8192 (originally specified) has been decommissioned by Groq.
// openai/gpt-oss-120b is the strongest general-purpose chat model currently
// available on this account and supports JSON mode.
const MODEL = "openai/gpt-oss-120b";

const SYSTEM_PROMPT =
  'You are an expert DevSecOps Accessibility Engineer. You will be given a React component and a list of axe-core violations. Your job is to fix the structural WCAG violations (e.g., add aria-labels, alt text, linked labels) WITHOUT altering any business logic, state hooks, or Tailwind/CSS classes. You must output ONLY a valid JSON object matching this schema: { "patchedCode": "<the entire fixed React component source code>" }. Do not include markdown code blocks or backticks in the output, just the raw JSON object.';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function main() {
  const context = JSON.parse(fs.readFileSync(CONTEXT_PATH, "utf-8"));

  const userPrompt = `React component source:\n\n${context.component.sourceCode}\n\naxe-core violations:\n\n${JSON.stringify(
    context.violations,
    null,
    2
  )}`;

  const completion = await groq.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = completion.choices[0].message.content;
  const parsed = JSON.parse(raw);

  if (!parsed.patchedCode) {
    throw new Error(`LLM response did not contain "patchedCode". Raw response: ${raw}`);
  }

  fs.writeFileSync(OUTPUT_PATH, parsed.patchedCode, "utf-8");
  console.log(`Patched component written to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("fix.js failed:", err);
  process.exit(1);
});
