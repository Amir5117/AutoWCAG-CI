// AutoWCAG-CI Phase 1, Step 5 (Part 1): True AST Reintegration.
// Splices the LLM-patched component function back into the *original* file's
// AST, so the surrounding imports / export default are preserved exactly,
// instead of trusting the LLM to reproduce them verbatim.

const fs = require("fs");
const path = require("path");
const { parse } = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;

const ORIGINAL_PATH = path.join(__dirname, "..", "target-app", "src", "CheckoutForm.jsx");
const PATCHED_PATH = path.join(__dirname, "..", "target-app", "src", "CheckoutForm.patched.jsx");

function parseSource(source) {
  return parse(source, {
    sourceType: "module",
    plugins: ["jsx"],
  });
}

function extractPatchedFunctionNode(patchedSource) {
  const ast = parseSource(patchedSource);
  let functionNode = null;

  traverse(ast, {
    FunctionDeclaration(nodePath) {
      const { id } = nodePath.node;
      if (id && /^[A-Z]/.test(id.name) && functionNode === null) {
        functionNode = nodePath.node;
      }
    },
  });

  if (!functionNode) {
    throw new Error(`No component function declaration found in ${PATCHED_PATH}`);
  }

  return functionNode;
}

function main() {
  const originalSource = fs.readFileSync(ORIGINAL_PATH, "utf-8");
  const patchedSource = fs.readFileSync(PATCHED_PATH, "utf-8");

  const patchedFunctionNode = extractPatchedFunctionNode(patchedSource);
  const originalAst = parseSource(originalSource);

  let replaced = false;

  traverse(originalAst, {
    FunctionDeclaration(nodePath) {
      const { id } = nodePath.node;
      if (id && id.name === patchedFunctionNode.id.name && !replaced) {
        nodePath.replaceWith(patchedFunctionNode);
        replaced = true;
        nodePath.skip();
      }
    },
  });

  if (!replaced) {
    throw new Error(
      `Could not find a matching "${patchedFunctionNode.id.name}" FunctionDeclaration in ${ORIGINAL_PATH}`
    );
  }

  const { code } = generate(originalAst, { retainLines: false });
  fs.writeFileSync(PATCHED_PATH, code, "utf-8");

  console.log(`Reintegrated patched "${patchedFunctionNode.id.name}" into full file.`);
  console.log(`Written to ${PATCHED_PATH}`);
}

main();
