import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import tseslint from 'typescript-eslint'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...tseslint.configs.strictTypeChecked.map((c) => ({
    ...c,
    files: ['**/*.{ts,tsx}'],
  })),
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  // The service role key bypasses row-level security. Only src/server/ may
  // touch the admin client or the server env; pages and actions call the
  // higher-level modules there (e.g. delete-account) instead.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/server/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/server/supabase-admin',
                '@/server/env',
                '@/server/env-schema',
                '**/server/supabase-admin',
                '**/server/env',
                '**/server/env-schema',
              ],
              message:
                'The service role key and server env may only be used inside src/server/.',
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
])

export default eslintConfig
