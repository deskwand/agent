module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
    project: ['./tsconfig.json', './tsconfig.node.json'],
  },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  env: {
    browser: true,
    node: true,
    es2022: true,
  },
  rules: {
    // TypeScript
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],

    // React Hooks
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',

    // General
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'no-debugger': 'error',
    'prefer-const': 'error',
    'no-var': 'error',
  },
  ignorePatterns: ['dist', 'dist-electron', 'node_modules', 'release', 'publish'],
  overrides: [
    {
      // `public/` 下的文件由 vite 原样拷贝到 dist，不属于 TS 工程，
      // 所以这里关掉“需要 project”的类型检查，而不是把整个目录 ignore 掉。
      files: ['public/**/*.js'],
      parserOptions: { project: null },
      env: { browser: true },
    },
    {
      // `scripts/` 下的 .mjs（CI 打包脚本、一键自检）同样不在 tsconfig 的 include 里。
      // 与其把它们排除在 lint 之外，不如关掉类型化规则 —— 语法与常见错误仍然查得到。
      files: ['scripts/**/*.mjs'],
      parserOptions: { project: null },
      env: { node: true },
    },
  ],
};
