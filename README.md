# Dota 2 Helper

[![Vercel Deployment](https://vercelbadge.vercel.app/api/samiamjidkhan/dota2-helper)](https://www.dota2helper.com/)

An AI-powered web application that provides gameplay tips, skill builds, and item recommendations for Dota 2 players based on their team composition and matchup.

**Live Site:** [https://www.dota2helper.com/](https://www.dota2helper.com/)

## Features

*   Select your hero, role, 4 allies, and 5 opponents from a filterable list with abbreviation support (e.g., "am" → "Anti-Mage").
*   **Current patch data** - Hero abilities and item stats pulled from `dotaconstants` (updated with each Dota 2 patch).
*   **Skill build recommendations** - Ability leveling order with reasoning.
*   **Lane matchup analysis** - Enemy abilities context for your specific lane opponents.
*   **Teammate synergies** - Combo suggestions with your allies.
*   Structured advice covering laning, mid game, late game, and item progression.
*   Responsive dark theme inspired by Dota 2 aesthetics.

## How it Works

1.  The frontend captures hero selections and roles.
2.  Data is sent to a Node.js backend API running as a serverless function on Vercel.
3.  The backend validates heroes and determines lane matchups based on roles.
4.  Current hero abilities and item data are loaded from `dotaconstants` (Dota 2 game data package).
5.  A structured prompt with ability stats, item references, and matchup context is sent to **Groq API** (GPT-OSS 120B).
6.  The AI response is rendered as formatted HTML with tables, lists, and styled sections.

## Running Locally

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/samiamjidkhan/dota2-helper.git
    cd dota2-helper
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Create Environment File:**
    Create a file named `.env` in the project root.
    Add your Groq API Key (obtainable from [Groq Console](https://console.groq.com/keys)) to this file:
    ```
    GROQ_API_KEY=YOUR_API_KEY_HERE
    ```
4.  **Run the development server:**
    ```bash
    npm run dev
    ```
    This will typically start the server on `http://localhost:3002`.

## Tech Stack

*   **Frontend:** Vanilla JavaScript, HTML, CSS
*   **Backend:** Node.js + Express (serverless on Vercel)
*   **AI:** Groq API (GPT-OSS 120B)
*   **Game Data:** [dotaconstants](https://github.com/odota/dotaconstants) - parsed Dota 2 game files

## Deployment

The application is deployed on [Vercel](https://vercel.com/). The `vercel.json` file configures the build and routing.

## Contributing

Suggestions and feedback are welcome! Please reach out via [X (formerly Twitter)](https://x.com/ibnAmjid) or open an issue/pull request on GitHub.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details. 