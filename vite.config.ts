import { defineConfig, lazyPlugins } from 'vite-plus'
import react from '@vitejs/plugin-react'

export default defineConfig({
  staged: {
    '*': 'vp check --fix',
  },
  lint: {
    plugins: ['oxc', 'typescript', 'unicorn', 'react', 'jsx-a11y'],
    categories: {
      correctness: 'warn',
    },
    env: {
      builtin: true,
    },
    ignorePatterns: ['dist', 'node_modules', '.npm-cache', '.vercel', 'design'],
    overrides: [
      {
        files: ['**/*.{ts,tsx}'],
        rules: {
          'constructor-super': 'off',
          'getter-return': 'off',
          'no-class-assign': 'off',
          'no-const-assign': 'off',
          'no-dupe-class-members': 'off',
          'no-dupe-keys': 'off',
          'no-func-assign': 'off',
          'no-import-assign': 'off',
          'no-new-native-nonconstructor': 'off',
          'no-obj-calls': 'off',
          'no-redeclare': 'off',
          'no-setter-return': 'off',
          'no-this-before-super': 'off',
          'no-undef': 'off',
          'no-unreachable': 'off',
          'no-unsafe-negation': 'off',
          'no-var': 'error',
          'no-with': 'off',
          'prefer-const': 'error',
          'prefer-rest-params': 'error',
          'prefer-spread': 'error',
          'no-array-constructor': 'error',
          'no-unused-expressions': 'error',
          'no-unused-vars': [
            'warn',
            {
              argsIgnorePattern: '^_',
              varsIgnorePattern: '^_',
            },
          ],
          'typescript/ban-ts-comment': 'error',
          'typescript/no-duplicate-enum-values': 'error',
          'typescript/no-empty-object-type': 'off',
          'typescript/no-explicit-any': 'off',
          'typescript/no-extra-non-null-assertion': 'error',
          'typescript/no-misused-new': 'error',
          'typescript/no-namespace': 'error',
          'typescript/no-non-null-asserted-optional-chain': 'error',
          'typescript/no-require-imports': 'error',
          'typescript/no-this-alias': 'error',
          'typescript/no-unnecessary-type-constraint': 'error',
          'typescript/no-unsafe-declaration-merging': 'error',
          'typescript/no-unsafe-function-type': 'error',
          'typescript/no-wrapper-object-types': 'error',
          'typescript/prefer-as-const': 'error',
          'typescript/prefer-namespace-keyword': 'error',
          'typescript/triple-slash-reference': 'error',
          'react/rules-of-hooks': 'error',
          'react/exhaustive-deps': 'warn',
          /* jsx-a11y：保留语义/标签/aria 等真实可达性问题，关掉两条与本项目刻意设计冲突的规则：
           * - prefer-tag-over-role：自定义 dialog/listbox/combobox 是有意为之（原生 <dialog> 无法
           *   承载现有动效与受控逻辑），改为原生标签是大重构且非收益项
           * - no-autofocus：模态与搜索框自动聚焦是刻意 UX，且均已配合 Escape/焦点管理 */
          'jsx-a11y/prefer-tag-over-role': 'off',
          'jsx-a11y/no-autofocus': 'off',
          'react/only-export-components': [
            'warn',
            {
              allowConstantExport: true,
            },
          ],
        },
      },
      {
        files: ['scripts/**/*.mjs', 'scripts/**/*.js', '*.mjs', '*.js'],
        rules: {
          'constructor-super': 'off',
          'getter-return': 'off',
          'no-class-assign': 'off',
          'no-const-assign': 'off',
          'no-dupe-class-members': 'off',
          'no-dupe-keys': 'off',
          'no-func-assign': 'off',
          'no-import-assign': 'off',
          'no-new-native-nonconstructor': 'off',
          'no-obj-calls': 'off',
          'no-redeclare': 'off',
          'no-setter-return': 'off',
          'no-this-before-super': 'off',
          'no-undef': 'off',
          'no-unreachable': 'off',
          'no-unsafe-negation': 'off',
          'no-var': 'error',
          'no-with': 'off',
          'prefer-const': 'error',
          'prefer-rest-params': 'error',
          'prefer-spread': 'error',
          'no-array-constructor': 'error',
          'no-unused-expressions': 'error',
          'no-unused-vars': [
            'warn',
            {
              argsIgnorePattern: '^_',
              varsIgnorePattern: '^_',
            },
          ],
          'typescript/ban-ts-comment': 'error',
          'typescript/no-duplicate-enum-values': 'error',
          'typescript/no-empty-object-type': 'error',
          'typescript/no-explicit-any': 'error',
          'typescript/no-extra-non-null-assertion': 'error',
          'typescript/no-misused-new': 'error',
          'typescript/no-namespace': 'error',
          'typescript/no-non-null-asserted-optional-chain': 'error',
          'typescript/no-require-imports': 'error',
          'typescript/no-this-alias': 'error',
          'typescript/no-unnecessary-type-constraint': 'error',
          'typescript/no-unsafe-declaration-merging': 'error',
          'typescript/no-unsafe-function-type': 'error',
          'typescript/no-wrapper-object-types': 'error',
          'typescript/prefer-as-const': 'error',
          'typescript/prefer-namespace-keyword': 'error',
          'typescript/triple-slash-reference': 'error',
        },
      },
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    jsPlugins: [
      {
        name: 'vite-plus',
        specifier: 'vite-plus/oxlint-plugin',
      },
    ],
    rules: {
      'vite-plus/prefer-vite-plus-imports': 'error',
    },
  },
  fmt: {
    semi: false,
    singleQuote: true,
    printWidth: 120,
    trailingComma: 'all',
    tabWidth: 2,
    arrowParens: 'always',
    sortPackageJson: false,
    ignorePatterns: ['node_modules', 'dist', '.npm-cache', '.vercel', 'design', '*.md'],
  },
  plugins: lazyPlugins(() => [react()]),
  test: {
    // 测试环境一律禁用埋点：.env 里配了真实 VITE_POSTHOG_KEY 时，测试会真的初始化 SDK
    // 并往 PostHog 发合成事件——既污染分析数据，也拖慢用例（还会刷「已初始化」告警）。
    // 需要验证埋点自身行为的用例用 vi.stubEnv 临时打开（见 src/lib/analytics.test.ts）。
    env: {
      VITE_POSTHOG_KEY: '',
    },
    // data/articles.db 现在是构建产物（未进 git），大量用例要读它：跑测试前先确保存在
    globalSetup: ['./scripts/test-global-setup.mjs'],
  },
  server: {
    port: 5173,
    // 开发时把 /api 转发到本地 API server（node:sqlite）
    proxy: {
      // PostHog 反代（生产对应 vercel.json 的两条 rewrite）：SDK 的 api_host 是 /ingest，
      // 本地也走同源，避免开发时直连 us.i.posthog.com 失败或被广告插件拦截。
      // 更具体的 /ingest/static 必须排在 /ingest 前面，否则静态资源会被转发到错误的域
      '/ingest/static': {
        target: 'https://us-assets.i.posthog.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ingest\/static/, '/static'),
      },
      '/ingest': {
        target: 'https://us.i.posthog.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ingest/, ''),
      },
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    // 单位 KB（压缩后未 gzip 的 chunk 体积）。此前设 3000 等于关闭告警——
    // 当前最大 chunk 约 280KB（PostHog 的懒加载包），留 800 作为回归护栏：
    // 主包/懒加载包明显膨胀时会重新告警，而不是被静默吞掉。
    chunkSizeWarningLimit: 800,
  },
})
