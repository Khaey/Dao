import type { Config } from 'tailwindcss';
// Design target « Chantier net »: ink/sand/teal stay, clay is brand only, three radii, borders over shadows.
export default { content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'], theme: { extend: {
  colors: { ink:'#17202a', sand:'#f7f5ef', clay:'#d97745', teal:'#0f766e', night:'#141b22' },
  borderRadius: { control:'6px', card:'8px', panel:'12px' },
} }, plugins: [] } satisfies Config;
