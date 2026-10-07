import { definePlugin, defineRule, type ESTree } from "@oxlint/plugins";

const noLet = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow `let`; bind with `const` and derive new values instead of reassigning.",
    },
    messages: {
      noLet:
        "Use `const`. Derive a new binding, return early or extract a helper instead of reassigning.",
    },
  },
  create(context) {
    return {
      VariableDeclaration(node) {
        if (node.kind === "let") context.report({ node, messageId: "noLet" });
      },
    };
  },
});

const COMPLEX_NODE_TYPES = new Set([
  "ConditionalExpression",
  "TemplateLiteral",
  "ArrowFunctionExpression",
  "FunctionExpression",
]);

const isChainedCall = (node: ESTree.Node) =>
  node.type === "CallExpression" &&
  node.callee.type === "MemberExpression" &&
  node.callee.object.type === "CallExpression";

const findComplexity = (node: ESTree.Node): ESTree.Node | null => {
  if (COMPLEX_NODE_TYPES.has(node.type) || isChainedCall(node)) return node;
  const children = Object.entries(node)
    .filter(([key]) => key !== "parent")
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
    .filter((value): value is ESTree.Node => typeof value?.type === "string");
  return children.map(findComplexity).find((found) => found !== null) ?? null;
};

const simpleTemplateExpressions = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Keep template literal interpolations to plain values and single calls." },
    messages: {
      complex: "Move this logic out of the template literal into a named helper or constant.",
    },
  },
  create(context) {
    return {
      TemplateLiteral(node) {
        for (const expression of node.expressions) {
          const complexNode = findComplexity(expression);
          if (complexNode) context.report({ node: complexNode, messageId: "complex" });
        }
      },
    };
  },
});

export default definePlugin({
  meta: { name: "autopilot" },
  rules: { "no-let": noLet, "simple-template-expressions": simpleTemplateExpressions },
});
