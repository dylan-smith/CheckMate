import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import vitest from '@vitest/eslint-plugin'
import testingLibrary from 'eslint-plugin-testing-library'
import playwright from 'eslint-plugin-playwright'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'playwright-report', 'test-results']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      // Type information for the type-checked rules, from the tsconfig that includes each file.
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-deprecated': 'error',
    },
  },
  {
    files: ['src/**/*.tsx'],
    extends: [jsxA11y.flatConfigs.strict],
  },
  {
    files: ['src/test/**/*.{ts,tsx}'],
    extends: [vitest.configs.recommended, testingLibrary.configs['flat/react']],
    rules: {
      // fetch mocks are async to return a Promise like fetch does, whether or not they await anything.
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['e2e/**/*.ts'],
    extends: [playwright.configs['flat/recommended']],
    rules: {
      // Helpers in checklists.spec.ts that assert what they did.
      'playwright/expect-expect': [
        'error',
        { assertFunctionNames: ['createChecklist', 'openChecklist'] },
      ],
    },
  },
  {
    // A load generator that runs as one long test per virtual user, not a test of the app, so it branches on
    // what happened in each visit.
    files: ['e2e/load.spec.ts'],
    rules: {
      'playwright/no-conditional-in-test': 'off',
    },
  },
  eslintConfigPrettier,
])
