// AutoWCAG-CI Phase 1, Step 3: Context Isolation.
// Extracts just the React component's source (via Babel AST) and pairs it
// with the axe-core violations relevant to that component, so a minimal,
// clean context can later be sent to the LLM for remediation.

const fs = require("fs");
const path = require("path");
const { parse } = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;

const COMPONENT_PATH = path.join(__dirname, "..", "target-app", "src", "CheckoutForm.jsx");
const SCAN_RESULTS_PATH = path.join(__dirname, "..", "scanner", "last_scan_results.json");
const OUTPUT_PATH = path.join(__dirname, "extracted_context.json");

// Page-level/landmark violations are a property of the surrounding HTML shell,
// not the component itself, so they're not useful context for remediating
// this specific component.
const STRUCTURAL_RULE_IDS = new Set(["landmark-one-main", "region"]);

function extractComponent(source) {
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["jsx"],
  });

  let componentNode = null;

  traverse(ast, {
    FunctionDeclaration(nodePath) {
      const { id } = nodePath.node;
      if (id && /^[A-Z]/.test(id.name) && componentNode === null) {
        componentNode = nodePath.node;
      }
    },
  });

  if (!componentNode) {
    throw new Error(`No React component declaration found in ${COMPONENT_PATH}`);
  }

  const { code } = generate(componentNode, { retainLines: false });
  return { name: componentNode.id.name, sourceCode: code };
}

function loadFilteredViolations() {
  const scanResults = JSON.parse(fs.readFileSync(SCAN_RESULTS_PATH, "utf-8"));
  const violations = scanResults.violations || [];
  return violations.filter((v) => !STRUCTURAL_RULE_IDS.has(v.id));
}

function main() {
  const source = fs.readFileSync(COMPONENT_PATH, "utf-8");
  const component = extractComponent(source);
  const violations = loadFilteredViolations();

  const output = {
    componentFile: path.relative(path.join(__dirname, ".."), COMPONENT_PATH).replace(/\\/g, "/"),
    component,
    violations,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf-8");

  console.log(`Extracted component "${component.name}" from ${COMPONENT_PATH}`);
  console.log(`Kept ${violations.length} component-level violation(s): ${violations.map((v) => v.id).join(", ")}`);
  console.log(`Written to ${OUTPUT_PATH}`);
}

main();
