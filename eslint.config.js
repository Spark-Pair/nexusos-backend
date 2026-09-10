import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'eslint.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { project: './tsconfig.eslint.json', tsconfigRootDir: import.meta.dirname }
    }
  },
  {
    files: ['**/*.{cjs,js,mjs}'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: globals.node, parserOptions: { project: null } }
  }
)
