// Flat config. Conventions copied by hand from snackbyte-base per DECISIONS 004.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', 'site/**', 'specs/**', '.specify/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      // The seam is a network call, never a shortcut (Constitution I). Anything
      // reaching across packages by relative path is that shortcut in disguise.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/../agent/*', '**/../orchestrator/*'],
              message:
                'The orchestrator and agent talk over HTTP only (Constitution I). Import from `contract` instead.',
            },
          ],
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
