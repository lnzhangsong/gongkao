import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '.npm-cache', '.vercel', 'design'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommended],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // 只启用对正确性要紧的 hooks 规则（rules-of-hooks + exhaustive-deps）。
      // eslint-plugin-react-hooks v7 的 recommended 会带入 set-state-in-effect /
      // immutability / compilation-skipped 等激进实验规则，把存量正常写法刷成 error，
      // 故不整包继承，仅显式开两条经典规则。
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // 允许导出非组件（store/常量），仅提示
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // 稳妥项：未用变量/常量判定，存量仅少量、可安全修
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // 存量容忍项
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs', 'scripts/**/*.js', '*.mjs', '*.js'],
    extends: [tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
)
