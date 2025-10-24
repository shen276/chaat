# Gemini Chat App

This project is a feature-rich AI chat application built with React and Vite. It's configured as a Progressive Web App (PWA), so you can install it on your phone's home screen and use it offline.

## Project Setup

Before you begin, you need to have [Node.js](https://nodejs.org/) installed on your computer.

1.  **Install Dependencies**:
    Open your terminal, navigate to the project directory, and run:
    ```bash
    npm install
    ```

## Development

To run the app locally with a fast development server and hot-reloading, run:

```bash
npm run dev
```

This will start the development server, and you can view your app in the browser at the URL provided (usually `http://localhost:5173`).

## How to Deploy to GitHub Pages

You can host this app for free on GitHub Pages.

### Step 1: Build the App

First, you need to create a production-ready build of your app. This command will compile and optimize your code and assets into a `dist` folder.

```bash
npm run build
```

### Step 2: Deploy to GitHub Pages

After the build is complete, you can deploy the contents of the `dist` folder to GitHub with a single command:

```bash
npm run deploy
```

This command uses the `gh-pages` package to automatically push your build to a special `gh-pages` branch in your repository.

### Step 3: Configure GitHub Repository Settings

1.  Go to your repository's **Settings** tab on GitHub.
2.  Select **Pages** from the left sidebar.
3.  Under "Build and deployment", change the **Source** to **Deploy from a branch**.
4.  Under "Branch", select `gh-pages` and keep the folder as `/(root)`.
5.  Click **Save**.

Your app will be live at `https://<your-username>.github.io/chaat/` in a few minutes!

## Offline Support & PWA

This application is configured as a Progressive Web App (PWA). You can install it on your mobile device's home screen for an app-like experience with offline access. This is handled automatically by the `vite-plugin-pwa` configuration.

## Advanced AI Features

To create a more dynamic and engaging chat experience, the AI has been programmed with special capabilities beyond simple text replies.

### Multi-Message Replies

To simulate the natural flow of a real text conversation, the AI is instructed to split longer thoughts into multiple, short messages. It does this by using a special `|||` separator between sentences. The app recognizes this separator and displays each part as an individual chat bubble, creating a more realistic back-and-forth rhythm.

### Special Message Types

The AI can also send various types of rich content by using specific text formats in its response. This allows for more interactive and visually interesting conversations.

-   **Stickers**: The AI can send any of your custom stickers by name.
    -   **Format**: `[sticker:sticker_name]`
    -   **Example**: `[sticker:happy_cat]`

-   **Transfers**: The AI can simulate sending a "red packet" or money transfer.
    -   **Format**: `[transfer:AMOUNT:NOTES]`
    -   **Example**: `[transfer:8.88:Good luck!]`

-   **Images**: The AI can send a placeholder image bubble with a description of what the image would be.
    -   **Format**: `[image:A description of the image]`
    -   **Example**: `[image:A photo of a cute kitten sleeping in a sunbeam]`

-   **Locations**: The AI can share a location.
    -   **Format**: `[location:Name of the location]`
    -   **Example**: `[location:Eiffel Tower]`
