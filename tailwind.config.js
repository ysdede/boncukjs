/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        primary: "#3b82f6", // Electric Blue
        "background-light": "#f3f4f6", // Gray-100
        "background-dark": "#111827", // Gray-900
        "card-light": "#ffffff",
        "card-dark": "#1e293b", // Slate-800
        "panel-dark": "#0f172a", // Slate-900
      },
      borderRadius: {
        DEFAULT: "0.75rem", // 12px
        '3xl': "1.5rem",
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
  ],
  darkMode: 'class',
} 