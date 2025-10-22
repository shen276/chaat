# Gemini Chat App Customization Guide

Welcome to the Gemini Chat App! This guide will help you customize the app's appearance, understand its features, and deploy it for your friends to use.

## How to Deploy to GitHub Pages

You can host this app for free on GitHub Pages. Since GitHub Pages doesn't compile TypeScript (`.tsx`) files, this project uses an in-browser compiler called Babel to handle it automatically.

### Step-by-Step Guide

1.  **Create a GitHub Repository**:
    *   Log in to GitHub and create a new **public** repository.

2.  **Upload Files**:
    *   In your new repository, click "uploading an existing file".
    *   Drag and drop all the project files (`index.html`, `index.css`, `index.tsx`, `manifest.json`, `sw.js`, `README.md`) into the browser.
    *   Click "Commit changes".

3.  **Enable GitHub Pages**:
    *   Go to your repository's **Settings** tab.
    *   Select **Pages** from the left sidebar.
    *   Under "Branch", select `main` and keep the folder as `/(root)`.
    *   Click **Save**.

4.  **Share Your App!**
    *   After saving, GitHub will provide you with a public URL (e.g., `https://<your-username>.github.io/<repository-name>/`).
    *   It may take a few minutes to go live. Once it does, you can share this link with anyone!

## How to Create Your Own Theme

The app uses a CSS variable-based theme system, making it easy to create your own look and feel.

### Step 1: Define Your New Theme in `index.css`

1.  Open the `index.css` file.
2.  At the top, you'll find theme blocks like `.theme-wechat`.
3.  Copy an existing theme block and paste it at the end of the theme definitions.
4.  Rename the class to a unique name for your theme, e.g., `.theme-my-awesome-theme`.
5.  Inside your new block, change the hex color codes for the CSS variables (e.g., `--bg-primary`, `--text-primary`) to your desired colors.

**Example:**
```css
.theme-my-awesome-theme {
  --bg-primary: #1a1a1a;
  --text-primary: #ffffff;
  --accent-primary: #00ffff;
  /* ...set colors for all other variables... */
}
```

### Step 2: Register Your Theme in `index.tsx`

1.  Open the `index.tsx` file.
2.  Near the top, find the `Theme` type definition.
3.  Add your new theme name (the same as the CSS class name, but without the leading dot) to the list.
    *   Change `type Theme = 'wechat' | ...;`
    *   To `type Theme = 'wechat' | ... | 'my-awesome-theme';`
4.  Scroll down to the `SettingsView` component.
5.  Find the `<select>` element for the theme dropdown.
6.  Add a new `<option>` for your theme, with its `value` and display name.
    *   `<option value="my-awesome-theme">My Awesome Theme</option>`

That's it! Your new theme will now appear in the theme selector on the "Me" tab.

## AI Multi-Message Feature

To make conversations feel more natural and less like a wall of text, the AI is instructed to sometimes split its reply into multiple shorter messages.

It does this by using a special separator in its response: `|||`.

When the app receives a response containing this separator, it automatically splits the text at each separator and displays each part as a separate chat bubble, sent in quick succession. This simulates the back-and-forth feeling of a real text message conversation.
