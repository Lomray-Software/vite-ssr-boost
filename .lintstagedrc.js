export default {
  '(src|__tests__|__mocks__|__helpers__)/**/*.{ts,tsx,js}': [
    'eslint --max-warnings=0',
    'prettier --write',
  ]
};
