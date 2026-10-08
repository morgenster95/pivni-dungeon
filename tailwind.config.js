/** @type {import('tailwindcss').Config} */
export default {
  // Třídy se skládají i v JS řetězcích, proto prohledáváme i src/**/*.js
  content: ['./index.html', './admin.html', './src/**/*.js'],
  theme: { extend: {} },
  plugins: [],
};
