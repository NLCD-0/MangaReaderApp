# 📚 CloudReader — Web App for GitHub Pages

A modern, mobile-first web application designed to run on **GitHub Pages** that connects to your private GitHub repository (`https://github.com/NLCD-0/CLOUD`) using a Personal Access Token in **Password Mode**.

---

## 🚀 Key Features

### 🔒 Password Mode Authentication
- Enter your GitHub Personal Access Token (PAT) once in password-masked mode (`<input type="password">` with visibility toggle).
- The token is securely stored in your browser's local storage and retained until browser data/cache is cleared.
- Required GitHub Token Scope: Fine-grained token with **Contents: Read** permission, or classic PAT with **repo** scope.

---

## ⚡ The 4 Core Functions

| # | Function | Description | Supported Sections |
|---|---|---|---|
| **1** | **Webtoon PDF View** | Renders PDF pages into high-resolution descending continuous images (stacked vertically) for smooth vertical scrolling. | `Manga & Webtoon`, `Novela`, and `ao3` (when PDF is available) |
| **2** | **HTML Text Reader** | Reads and parses `.html` story files, rendering pure semantic DOM text formatted with comfortable margins and headers. | `ao3` |
| **3** | **PDF Text Extractor** | Extracts text from `.pdf` files and renders clean DOM text paragraphs (`<p>`). **Fully compatible with Google Chrome's built-in translation**! | `ao3` |
| **4** | **Downloader** | Download individual chapters/stories (PDF or HTML) or entire folders ("carpets") as a packaged `.zip` archive via JSZip with real-time progress. | All sections |

---

## 📁 Repository Structure & Rules

The app strictly reads the 3 designated root folders:

### 1. `Manga & Webtoon` (Functions 1 & 4)
- **Concept:** Every folder inside is an individual Story / Series; files inside are its chapters.
- **Reading:** Renders chapters as vertical Webtoon-style descending pages (Function 1).
- **Download:** Download single chapter PDFs or entire series folders as ZIP (Function 4).

### 2. `Novela` (Functions 1 & 4)
- **Concept:** Every folder inside is an individual Novel; files inside are its volumes/chapters.
- **Reading:** Continuous descending page view (Function 1).
- **Download:** Download chapter PDF or full novel folder as ZIP (Function 4).

### 3. `ao3` (Functions 2, 3 & 4)
- **Concept:** Supports arbitrary nested subfolders (Fandoms, Categories, Tags). Every file is its own Story!
- **Format Pairing & Internal Index Check:** Files can be `.pdf`, `.html`, or both formats sharing the same name.
  - In the internal sorted file index (not what is shown to the user), the algorithm compares adjacent entries (1 position up `i - 1` and 1 position down `i + 1`) to check if a corresponding `.html` or `.pdf` file with the exact same name exists.
  - If both `Story.pdf` and `Story.html` exist, they are displayed as **1 single story entry** with an `HTML + PDF` badge in the UI.
  - **Default reading mode:** Always opens as **Text by default**!
    - If `.html` is available, reads the HTML file (Function 2).
    - If only `.pdf` is available (no HTML), extracts text from the PDF (Function 3).
  - **Switch to PDF button:** When reading an AO3 story that has a PDF version available, a button (`📄 PDF`) in the header allows switching to original Webtoon PDF view (and back to text with `📝 Text`).
  - **Download preference:** If a story has both formats, clicking download will download the `.pdf` file as specified.

---

## 📖 Reader Features

- **Text Appearance:** Default **pure white background (`#ffffff`)** with **black text (`#000000`)** for maximum legibility and comfort.
- **Adjustable Text Size:** `A−` and `A+` buttons in the header toolbar allow adjusting text size from 13px to 32px with real-time persistence.
- **Font Toggle:** Switch between modern Sans-Serif and classic Serif typography.
- **Chrome Translation:** Text is rendered as standard semantic HTML (`<article>`, `<p>`, `<h1>`, `<hr>`) so Google Chrome's "Translate this page" translates the story paragraph by paragraph without issues.
- **Mobile First:** Designed with comfortable touch targets, safe-area support for notches, auto-hiding header, and bottom navigation.

---

## 🔖 Bookmark & Navigation Mechanics

- **Bookmark Button (`🔖`):** Click the bookmark button in the top header or bottom navigation bar to remember the exact scroll position where you left off.
- **Auto-Resume:** When opening a chapter or story that was bookmarked, the app smoothly jumps directly to your saved position.
- **Clear on Next Chapter:** Advancing to the next chapter (`Next ▶`) automatically clears the bookmark from the completed chapter as instructed.

---

## 📜 Reading History & Log Screen

- Accessible from the header `[📜 Log]` button or "See All History →".
- **Tracking:**
  - `Manga & Webtoon`: Tracks by series carpet + last chapter read.
  - `Novela`: Tracks by series carpet + last chapter read.
  - `ao3`: Tracks by individual story file + mode.
- **Features:**
  - Filter tabs: `All`, `📖 Manga`, `📕 Novela`, `AO3`.
  - Search box to filter in-progress stories.
  - Quick `[Read]` resume button.
  - Bookmark indicator (`🔖 Bookmarked`).
  - Option to remove individual stories or clear the entire log.

---

## 🌐 Deploying to GitHub Pages

1. Commit and push the files (`index.html`, `app.js`, `styles.css`, `manifest.json`, `sw.js`, `ao3_icon.png`) to your GitHub repository (e.g., `main` branch).
2. In your GitHub repository:
   - Go to **Settings** → **Pages**.
   - Under **Build and deployment** > **Source**, select **Deploy from a branch**.
   - Select branch **main** (and folder `/ (root)`), then click **Save**.
3. In a few moments, GitHub will publish your site at `https://<your-username>.github.io/<repo-name>/`.
4. Open the web app on your phone, enter your GitHub PAT token, and start reading!
