const manualMemoizationApis = new Set(["memo", "useCallback", "useMemo"]);

const noManualMemoization = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Let React Compiler own routine render memoization.",
    },
    schema: [],
    messages: {
      manualMemoization:
        "{{name}} is manual React memoization. Use a targeted lint exception only when identity is semantic or profiling proves it is needed.",
    },
  },
  create(context) {
    const reactNamespaces = new Set();

    return {
      ImportDeclaration(node) {
        if (node.source.value !== "react") return;

        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportSpecifier") {
            const importedName = specifier.imported.name ?? specifier.imported.value;
            if (manualMemoizationApis.has(importedName)) {
              context.report({
                node: specifier,
                messageId: "manualMemoization",
                data: { name: importedName },
              });
            }
          } else {
            reactNamespaces.add(specifier.local.name);
          }
        }
      },
      MemberExpression(node) {
        if (node.object.type !== "Identifier" || !reactNamespaces.has(node.object.name)) return;

        const propertyName = node.computed
          ? node.property.type === "Literal"
            ? node.property.value
            : null
          : node.property.type === "Identifier"
            ? node.property.name
            : null;

        if (typeof propertyName !== "string" || !manualMemoizationApis.has(propertyName)) return;

        context.report({
          node,
          messageId: "manualMemoization",
          data: { name: propertyName },
        });
      },
    };
  },
};

export default {
  meta: { name: "toy-box-react" },
  rules: {
    "no-manual-memoization": noManualMemoization,
  },
};
