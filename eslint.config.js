import globals from 'globals';

export default [
  { ignores: ['dist/**', 'dist-demo/**', 'node_modules/**'] },
  {
    files: ['src/**/*.js', 'tests/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: {
      ...globals.browser, ...globals.node,
      // Funkce zavěšené na window v src/main.js, volané přímo jménem (původní kód; postupně odstraníme).
      vykresliKrcmu: 'readonly', zopakovatzapis: 'readonly', smazatZapis: 'readonly',
      toggleEditProfil: 'readonly', renderPivaSeznamu: 'readonly',
    } },
    rules: { 'no-undef': 'error', 'no-unused-vars': 'warn', 'no-dupe-keys': 'error', 'no-unreachable': 'error' },
  },
];
