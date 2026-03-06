import js from "@eslint/js";
import globals from "globals";

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: "script",
            globals: {
                ...globals.browser,
                AWS: "readonly",
                bootbox: "readonly",
                moment: "readonly",
                $: "readonly",
                angular: "writable",
            },
        },
        rules: {
            // Carry over from .eslintrc
            "indent": ["error", 4],

            // Carry over from inline overrides in explorer.js
            "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
            "no-console": "off",
            "no-plusplus": "off",

            // Airbnb-style rules that are reasonable to keep without
            // pulling in the full airbnb config (which doesn't yet
            // ship a flat config). Add or remove as desired.
            "curly": ["error", "multi-line"],
            "eqeqeq": ["error", "always", { "null": "ignore" }],
            "no-var": "error",
            "prefer-const": ["error", { "destructuring": "all" }],
            "no-throw-literal": "error",
            "no-param-reassign": ["error", { "props": false }],
            "no-shadow": "error",
            "no-use-before-define": ["error", { "functions": false, "classes": true, "variables": true }],
            "no-multi-spaces": "error",
            "no-trailing-spaces": "error",
            "semi": ["error", "always"],
            "quotes": ["error", "single", { "avoidEscape": true, "allowTemplateLiterals": true }],
            "comma-dangle": ["error", "always-multiline"],
            "space-before-blocks": "error",
            "keyword-spacing": "error",
            "arrow-spacing": "error",
            "no-multiple-empty-lines": ["error", { "max": 1, "maxEOF": 0 }],
        },
    },
];