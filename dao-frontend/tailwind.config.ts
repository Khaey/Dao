import type { Config } from 'tailwindcss';
export default { content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'], theme: { extend: { colors: { ink:'#17202a', sand:'#f7f5ef', clay:'#d97745', teal:'#0f766e' } } }, plugins: [] } satisfies Config;
