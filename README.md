# Dota 2 Helper

[![Vercel Deployment](https://vercelbadge.vercel.app/api/samiamjidkhan/dota2-helper)](https://www.dota2helper.com/)

A simple web application that provides item build suggestions and gameplay tips for Dota 2 players based on their team and opponent hero selections.

**Live Site:** [https://www.dota2helper.com/](https://www.dota2helper.com/)

## Features

*   Select your hero, 4 allies, and 5 opponents from a filterable list.
*   Receive AI-generated tips tailored to the specific matchup and targeted towards beginner/intermediate players.
*   Structured advice covering different game stages (Early, Mid, Late), item builds, and key considerations.
*   Responsive design for usability on different screen sizes.
*   Dark theme inspired by Dota 2 aesthetics.

## How it Works

1.  The frontend (HTML, CSS, JavaScript) captures the selected hero names.
2.  On submission, the data is sent to a Node.js backend API running as a serverless function on Vercel.
3.  The backend validates the hero selections against a hardcoded list.
4.  A structured prompt, including the selected heroes and guidance for the target skill level, is sent to the Google Gemini API.
5.  The backend receives the text response from Gemini.
6.  The frontend formats the Markdown-like response into structured HTML and displays it to the user.

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
    Add your Google AI API Key (obtainable from [Google AI Studio](https://aistudio.google.com/app/apikey)) to this file:
    ```
    GOOGLE_API_KEY=YOUR_API_KEY_HERE
    ```
4.  **Run the development server:**
    ```bash
    npm run dev
    ```
    This will typically start the server on `http://localhost:3002`.

## Deployment

The application is deployed on [Vercel](https://vercel.com/). The `vercel.json` file configures the build and routing.

## Contributing

Suggestions and feedback are welcome! Please reach out via [X (formerly Twitter)](https://x.com/ibnAmjid) or open an issue/pull request on GitHub.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details. 