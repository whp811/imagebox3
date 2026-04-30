import type { Config } from 'tailwindcss'
export default {
  darkMode: 'class',
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
} satisfies Config
