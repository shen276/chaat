# Gemini AI Chat App

Welcome! This is a feature-rich, PWA-ready AI chat application built with React, Vite, and TypeScript. It allows you to create unique AI characters and engage in dynamic, realistic conversations. You can install it on your phone for an app-like experience with full offline support.

For a user-friendly guide to all the fun features, check out the [**Features Overview (FEATURES.md)**](./FEATURES.md).

---

## ✨ Core Features

*   **Character Customization**: Create AI characters with unique names, avatars, and personalities using system instructions.
*   **Dynamic Conversations**: Experience realistic chats with multi-message replies and support for special content like stickers, transfers, and image/location descriptions.
*   **"Moments" Social Feed**: A shared social space where both you and your AI characters can post updates, with other AIs intelligently liking and commenting.
*   **Deep Personalization**: Set custom chat backgrounds, unique nicknames, and even configure auto-replies for each character.
*   **PWA & Offline First**: Install the app on your home screen and use it anytime, anywhere. All data is stored locally in your browser using IndexedDB.
*   **Data Portability**: Easily import and export all your app data (characters, chats, settings) as a single JSON file.

## 💻 Tech Stack

*   **Frontend**: React & TypeScript
*   **Build Tool**: Vite
*   **AI**: Google Gemini API (`@google/genai`)
*   **Database**: Dexie.js (A wrapper for IndexedDB)
*   **PWA**: `vite-plugin-pwa`
*   **Deployment**: GitHub Pages

---

## 🚀 Getting Started

Follow these steps to get the project running on your local machine.

### Prerequisites

*   [Node.js](https://nodejs.org/) (v18 or later recommended)
*   A [Google Gemini API Key](https://ai.google.dev/gemini-api/docs/api-key)

### Step 1: Set Up Your Project

First, clone the repository to your local machine:

```bash
git clone https://github.com/your-username/chaat.git
cd chaat
```

Next, install all the required dependencies:

```bash
npm install
```

### Step 2: Configure Your API Key

This is the most important step to make the AI work.

1.  Run the app for the first time: `npm run dev`
2.  Open the app in your browser (e.g., `http://localhost:5173`).
3.  Navigate to the **"Me"** tab at the bottom.
4.  Click on **"+ Add API Key"**.
5.  Give your key a name (e.g., "My Key") and paste the key value.
6.  Save it. The key will be securely stored in your browser's database.

### Step 3: Run the Development Server

Start the local development server with hot-reloading:

```bash
npm run dev
```

You can now start building and customizing your app!

---

##  Git & Version Control

If you're using this template to start your own project, here’s how to manage it with Git.

### Initializing Your Own Repository

After cloning or creating the project, you can initialize your own Git history.

```bash
# 1. Initialize a new git repository
git init -b main

# 2. Add all files to the staging area
git add .

# 3. Make your first commit
git commit -m "Initial commit: Setup project from template"
```

### Making and Committing Changes

As you work on the project, follow this simple workflow to save your changes.

```bash
# 1. Stage all your new changes for the next commit
git add .

# 2. Commit the staged changes with a descriptive message
git commit -m "feat: Add new character details page"

# Example commit message types:
# feat: A new feature
# fix: A bug fix
# docs: Changes to documentation
# style: Formatting, missing semi-colons, etc; no code change
# refactor: Refactoring production code
# test: Adding tests, refactoring test code
```

---

## 📦 Deployment to GitHub Pages

You can host this app for free on GitHub Pages.

### Step 1: Build the App

Create a production-ready build in the `dist` folder.

```bash
npm run build
```

### Step 2: Deploy

This command will automatically push the contents of the `dist` folder to a `gh-pages` branch in your repository.

```bash
npm run deploy
```

### Troubleshooting Deployment

If the `npm run deploy` command fails due to network issues, you may need to set a temporary proxy for your terminal session.

**For macOS / Linux:**
Open your terminal and run these commands before `npm run deploy`. Replace `7897` if your proxy port is different.
```bash
export http_proxy=http://127.0.0.1:7897
export https_proxy=http://127.0.0.1:7897
```

**For Windows (PowerShell):**


```powershell
set GIT_PROXY_COMMAND=http://127.0.0.1:7897
```

After setting the proxy, run the deployment command again. This proxy setting is temporary and only applies to the current terminal window.

### Step 3: Configure Repository Settings

1.  In your GitHub repository, go to **Settings > Pages**.
2.  Under "Build and deployment", set the **Source** to **Deploy from a branch**.
3.  Set the **Branch** to `gh-pages` with the `/(root)` folder.
4.  Save your changes. Your app will be live in a few minutes!