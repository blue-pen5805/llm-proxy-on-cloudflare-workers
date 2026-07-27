import prettierRecommended from "eslint-plugin-prettier/recommended";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["node_modules/", ".wrangler/", "dist/"],
  },
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  ...tseslint.configs.recommended,
  prettierRecommended,
  {
    files: ["src/**/*.ts", "scripts/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Type-aware rules. The project service is already configured for these
      // paths, so these cost nothing extra to run and cover the mistakes this
      // codebase is most exposed to: unawaited work in the request pipeline and
      // checks that silently never fire.
      // Two rules are deliberately omitted. `require-await`: a provider hook
      // must match the Promise-returning ProviderDefinition signature even when
      // its implementation has nothing to await. `no-unnecessary-type-assertion`:
      // this program is type-checked with the Node globals while the Worker runs
      // with the Cloudflare ones, so assertions that are required at runtime
      // (Response.json(), the generated Env) look redundant to that rule.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
    },
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
];
