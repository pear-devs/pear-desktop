const isUnderscored = (name) => {
  const stripped = name.replace(/^_+|_+$/g, '');
  if (!stripped.includes('_')) return false;
  return stripped !== stripped.toUpperCase();
};

const camelcase = {
  meta: {
    type: 'suggestion',
    docs: { description: 'enforce camelcase naming convention' },
    schema: [
      {
        type: 'object',
        properties: {
          properties: { enum: ['always', 'never'] },
          ignoreDestructuring: { type: 'boolean' },
          ignoreImports: { type: 'boolean' },
          ignoreGlobals: { type: 'boolean' },
          allow: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      notCamelCase: "Identifier '{{name}}' is not in camel case.",
    },
  },
  create(context) {
    const options = context.options[0] || {};
    const checkProps = options.properties !== 'never';
    const ignoreDestructuring = options.ignoreDestructuring === true;
    const ignoreImports = options.ignoreImports === true;
    const allowPatterns = (options.allow || []).map((p) => new RegExp(p));
    const reported = new WeakSet();

    const isAllowed = (name) => allowPatterns.some((re) => re.test(name));

    const report = (node) => {
      if (!node || node.type !== 'Identifier') return;
      if (reported.has(node)) return;
      if (isAllowed(node.name)) return;
      if (!isUnderscored(node.name)) return;
      reported.add(node);
      context.report({ node, messageId: 'notCamelCase', data: { name: node.name } });
    };

    const reportPattern = (node) => {
      if (!node) return;
      switch (node.type) {
        case 'Identifier':
          if (ignoreDestructuring) return;
          report(node);
          break;
        case 'ArrayPattern':
          node.elements.forEach(reportPattern);
          break;
        case 'ObjectPattern':
          node.properties.forEach((prop) => {
            if (prop.type === 'RestElement') reportPattern(prop.argument);
            else reportPattern(prop.value);
          });
          break;
        case 'AssignmentPattern':
          reportPattern(node.left);
          break;
        case 'RestElement':
          reportPattern(node.argument);
          break;
      }
    };

    return {
      VariableDeclarator(node) {
        if (node.id.type === 'Identifier') report(node.id);
        else reportPattern(node.id);
      },
      AssignmentExpression(node) {
        if (node.left.type === 'ObjectPattern' || node.left.type === 'ArrayPattern') {
          reportPattern(node.left);
        }
        if (
          checkProps &&
          node.left.type === 'MemberExpression' &&
          !node.left.computed &&
          node.left.property.type === 'Identifier'
        ) {
          report(node.left.property);
        }
      },
      FunctionDeclaration(node) {
        if (node.id) report(node.id);
        node.params.forEach(reportPattern);
      },
      FunctionExpression(node) {
        if (node.id) report(node.id);
        node.params.forEach(reportPattern);
      },
      ArrowFunctionExpression(node) {
        node.params.forEach(reportPattern);
      },
      CatchClause(node) {
        if (node.param) reportPattern(node.param);
      },
      ClassDeclaration(node) {
        if (node.id) report(node.id);
      },
      ClassExpression(node) {
        if (node.id) report(node.id);
      },
      ImportSpecifier(node) {
        if (ignoreImports) return;
        report(node.local);
      },
      ImportDefaultSpecifier(node) {
        if (ignoreImports) return;
        report(node.local);
      },
      ImportNamespaceSpecifier(node) {
        if (ignoreImports) return;
        report(node.local);
      },
      Property(node) {
        if (!checkProps || node.computed) return;
        if (node.parent && node.parent.type === 'ObjectPattern') return;
        report(node.key);
      },
      MethodDefinition(node) {
        if (!checkProps || node.computed) return;
        report(node.key);
      },
      PropertyDefinition(node) {
        if (!checkProps || node.computed) return;
        report(node.key);
      },
    };
  },
};

export default {
  meta: { name: 'eslint-core-plugin', version: '1.0.0' },
  rules: { camelcase },
};
