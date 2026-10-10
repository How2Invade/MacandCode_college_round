/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./src/**/*.{html,js,ts,jsx,tsx}",
    "./index.html"
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          900: '#312e81',
        },
        hf: {
          ivory: '#F7F3EC',
          card: '#FFFEFC',
          border: '#E5DED2',
          text: {
            primary: '#252724',
            secondary: '#777872',
          },
          teal: '#238F83',
          blue: '#6C8FC8',
          green: '#4B965D',
          red: '#C55B5B',
          dark: {
            bg: '#1A1B20',
            card: '#23252A',
            border: '#363940',
            text: {
              primary: '#F0F0F0',
              secondary: '#9BA0AA'
            }
          }
        }
      }
    },
  },
  plugins: [],
}
