/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                crBlue: "#1b5fa8",
                crDarkBlue: "#0f3768",
                crGold: "#ffd700",
                crGoldDark: "#cc9900",
                crDarkBg: "#12121e",
                crCardBg: "#1e1b2e",
            },
        },
    },
    plugins: [],
}