import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'

// ponytail: one shared flat config for the whole workspace; split per-package only if rules diverge
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.wrangler/**', '**/bin/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },
  {
    // Nuxt UI auto-imports its composables via its Vite plugin (see
    // apps/desktop/auto-imports.d.ts); ESLint has no way to know they exist.
    files: ['apps/desktop/**/*.{vue,ts}', 'packages/ui/**/*.{vue,ts}'],
    languageOptions: {
      globals: Object.fromEntries(
        [
          'defineLocale',
          'defineShortcuts',
          'extendLocale',
          'extractShortcuts',
          'useAppConfig',
          'useContentSearch',
          'useFileUpload',
          'useFormField',
          'useKbd',
          'useOverlay',
          'useResizable',
          'useScrollShadow',
          'useScrollspy',
          'useToast',
          'useTour',
        ].map((name) => [name, 'readonly']),
      ),
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'vue/multi-word-component-names': 'off',
      // Prettier owns formatting; disable the Vue stylistic rules that fight it.
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/first-attribute-linebreak': 'off',
      'vue/html-indent': 'off',
      'vue/attributes-order': 'off',
    },
  },
)
