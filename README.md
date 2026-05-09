# StarMark AI

**StarMark AI: Bookmark manager, AI organizer, smart search**

StarMark AI is a Chrome extension designed to help users save, organize, and search bookmarks more intelligently. It combines a clean bookmark-saving experience with AI-inspired organization features.

The extension is built to be simple, readable, and easy for other developers to understand, customize, and extend.

---

## ✨ Features

- Save bookmarks quickly from the browser
- Manage saved links in a clean interface
- Organize bookmarks with smart categories
- Search bookmarks faster
- Lightweight Chrome extension architecture
- Modern AI-inspired icon and branding
- Easy-to-modify code structure

---

## 🧠 Project Idea

Most users save bookmarks but later struggle to find them. StarMark AI is designed to make bookmarks easier to manage by combining:

- Bookmark saving
- Smart organization
- Search
- AI-assisted categorization
- Clean UI design

The goal is to turn browser bookmarks into a useful personal knowledge library.

---

## 🧩 Chrome Extension Overview

This project follows the standard Chrome Extension structure.

The main parts are:

- `manifest.json` — extension configuration
- `popup.html` — popup layout shown when the extension icon is clicked
- `popup.css` — popup design and styling
- `popup.js` — popup logic and user interactions
- `background.js` — background extension logic
- `icons/` — extension icons used by Chrome
- `README.md` — documentation for users and developers
- `LICENSE` — project license

---

## 📁 Project Structure

```text
starmark-ai/
├── manifest.json
├── popup.html
├── popup.css
├── popup.js
├── background.js
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── LICENSE
└── README.md
```

---

## 📄 File Explanation

### `manifest.json`

This file tells Chrome how the extension works.

It includes:

- Extension name
- Extension version
- Description
- Required permissions
- Popup file location
- Background script
- Icon paths

Example:

```json
{
  "manifest_version": 3,
  "name": "StarMark AI",
  "version": "1.0.0",
  "description": "Bookmark manager, AI organizer, smart search",
  "permissions": ["bookmarks", "storage", "tabs"],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "background": {
    "service_worker": "background.js"
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

Modify this file when you want to:

- Change the extension name
- Change the description
- Add permissions
- Change icons
- Add content scripts
- Update the version number

---

### `popup.html`

This file contains the popup layout.

The popup is what users see when they click the extension icon in Chrome.

It usually includes:

- App title
- Input fields
- Save button
- Bookmark list
- Search bar
- Empty state message

Example:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>StarMark AI</title>
    <link rel="stylesheet" href="popup.css" />
  </head>
  <body>
    <div class="app">
      <header class="app-header">
        <div class="logo">⭐</div>
        <div>
          <h1>StarMark AI</h1>
          <p>Smart bookmark manager</p>
        </div>
      </header>

      <section class="actions">
        <button id="saveCurrentPage">Save Current Page</button>
      </section>

      <section class="search-section">
        <input type="text" id="searchInput" placeholder="Search bookmarks..." />
      </section>

      <section class="bookmark-list" id="bookmarkList">
        <p class="empty-state">No bookmarks saved yet.</p>
      </section>
    </div>

    <script src="popup.js"></script>
  </body>
</html>
```

Modify this file when you want to:

- Add new buttons
- Change popup layout
- Add filters
- Add categories
- Add bookmark cards
- Add settings options

---

### `popup.css`

This file controls the design of the popup.

It includes:

- Layout
- Colors
- Spacing
- Buttons
- Cards
- Typography
- Hover effects
- Responsive design

Example:

```css
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  width: 360px;
  min-height: 480px;
  font-family: Arial, sans-serif;
  background: linear-gradient(135deg, #0f172a, #312e81);
  color: #ffffff;
}

.app {
  padding: 18px;
}

.app-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.logo {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 14px;
  background: linear-gradient(135deg, #facc15, #f97316);
  box-shadow: 0 0 18px rgba(250, 204, 21, 0.4);
}

h1 {
  margin: 0;
  font-size: 20px;
}

p {
  margin: 4px 0 0;
  color: #cbd5e1;
}

button {
  width: 100%;
  padding: 12px;
  border: none;
  border-radius: 12px;
  background: linear-gradient(135deg, #facc15, #f97316);
  color: #111827;
  font-weight: 700;
  cursor: pointer;
}

button:hover {
  opacity: 0.9;
}

.search-section {
  margin: 16px 0;
}

input {
  width: 100%;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #ffffff;
  background: rgba(255, 255, 255, 0.08);
  outline: none;
}

input::placeholder {
  color: #94a3b8;
}

.bookmark-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.bookmark-card {
  padding: 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.08);
}

.bookmark-card h3 {
  margin: 0 0 6px;
  font-size: 14px;
}

.bookmark-card a {
  color: #facc15;
  font-size: 12px;
  text-decoration: none;
  word-break: break-all;
}

.empty-state {
  text-align: center;
  color: #94a3b8;
}
```

Modify this file when you want to:

- Change colors
- Change the popup size
- Update button style
- Add dark/light themes
- Improve card layout
- Match your branding

---

### `popup.js`

This file controls the main popup behavior.

It handles:

- Getting the current browser tab
- Saving the current page as a bookmark
- Loading saved bookmarks
- Searching bookmarks
- Displaying bookmarks in the popup

Example:

```js
const saveCurrentPageButton = document.getElementById("saveCurrentPage");
const bookmarkList = document.getElementById("bookmarkList");
const searchInput = document.getElementById("searchInput");

/**
 * Load bookmarks from Chrome storage.
 */
async function getStoredBookmarks() {
  const data = await chrome.storage.local.get(["bookmarks"]);
  return data.bookmarks || [];
}

/**
 * Save bookmarks to Chrome storage.
 */
async function saveBookmarks(bookmarks) {
  await chrome.storage.local.set({ bookmarks });
}

/**
 * Get the currently active browser tab.
 */
async function getCurrentTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  return tabs[0];
}

/**
 * Save the current page as a bookmark.
 */
async function saveCurrentPage() {
  const tab = await getCurrentTab();

  if (!tab || !tab.url) {
    return;
  }

  const bookmarks = await getStoredBookmarks();

  const bookmarkExists = bookmarks.some((bookmark) => bookmark.url === tab.url);

  if (bookmarkExists) {
    alert("This page is already saved.");
    return;
  }

  const newBookmark = {
    id: Date.now(),
    title: tab.title || "Untitled Bookmark",
    url: tab.url,
    createdAt: new Date().toISOString(),
    category: "Uncategorized",
  };

  bookmarks.unshift(newBookmark);

  await saveBookmarks(bookmarks);
  renderBookmarks(bookmarks);
}

/**
 * Render bookmarks in the popup.
 */
function renderBookmarks(bookmarks) {
  bookmarkList.innerHTML = "";

  if (bookmarks.length === 0) {
    bookmarkList.innerHTML = `
      <p class="empty-state">No bookmarks saved yet.</p>
    `;
    return;
  }

  bookmarks.forEach((bookmark) => {
    const card = document.createElement("div");
    card.className = "bookmark-card";

    card.innerHTML = `
      <h3>${bookmark.title}</h3>
      <a href="${bookmark.url}" target="_blank">${bookmark.url}</a>
    `;

    bookmarkList.appendChild(card);
  });
}

/**
 * Search bookmarks by title or URL.
 */
async function searchBookmarks(event) {
  const query = event.target.value.toLowerCase();
  const bookmarks = await getStoredBookmarks();

  const filteredBookmarks = bookmarks.filter((bookmark) => {
    return (
      bookmark.title.toLowerCase().includes(query) ||
      bookmark.url.toLowerCase().includes(query)
    );
  });

  renderBookmarks(filteredBookmarks);
}

/**
 * Initialize popup when opened.
 */
async function init() {
  const bookmarks = await getStoredBookmarks();
  renderBookmarks(bookmarks);
}

saveCurrentPageButton.addEventListener("click", saveCurrentPage);
searchInput.addEventListener("input", searchBookmarks);

init();
```

Modify this file when you want to:

- Add delete bookmark functionality
- Add categories
- Add AI summaries
- Add bookmark tags
- Add sorting
- Add import/export
- Add duplicate detection
- Connect an AI API

---

### `background.js`

This file runs in the background as a Chrome service worker.

It can be used for:

- Listening to browser events
- Managing extension lifecycle
- Running background tasks
- Communicating between popup and content scripts
- Handling future AI processing

Example:

```js
chrome.runtime.onInstalled.addListener(() => {
  console.log("StarMark AI extension installed.");
});
```

Modify this file when you want to:

- Run background tasks
- Add context menu support
- Listen for bookmark changes
- Add keyboard shortcuts
- Handle notifications
- Sync data in the background

---

## 🎨 Design System

StarMark AI uses a modern AI-inspired visual style.

### Color Palette

```text
Dark Navy: #0f172a
Deep Indigo: #312e81
Star Yellow: #facc15
Orange Gold: #f97316
Soft White: #ffffff
Muted Text: #cbd5e1
Secondary Text: #94a3b8
```

### Design Style

The design is inspired by:

- AI tools
- Browser productivity apps
- Futuristic dashboard interfaces
- Neon star/circuit visuals
- Clean Chrome extension popups

### UI Principles

- Keep the interface simple
- Make actions easy to find
- Use readable text
- Avoid clutter
- Use strong visual contrast
- Keep the bookmark list scannable
- Make the save action obvious

---

## 🖼️ Icon Design

The extension icon uses:

- A yellow gradient star
- AI circuit lines
- A glowing central node
- A dark blue futuristic background
- Rounded-square app icon shape

The star represents saved or favorite content.

The circuit design represents AI-powered organization and smart search.

---

## ⚙️ How the Extension Works

### Basic Flow

```text
User opens a webpage
        ↓
User clicks StarMark AI extension
        ↓
Popup opens
        ↓
User clicks "Save Current Page"
        ↓
Extension reads current tab title and URL
        ↓
Bookmark is saved to Chrome local storage
        ↓
Saved bookmark appears in the popup list
```

---

## 🧠 Bookmark Data Structure

Each saved bookmark is stored as an object.

Example:

```js
{
  id: 1710000000000,
  title: "Example Website",
  url: "https://example.com",
  createdAt: "2026-05-09T12:00:00.000Z",
  category: "Uncategorized"
}
```

### Field Explanation

| Field       | Description                               |
| ----------- | ----------------------------------------- |
| `id`        | Unique bookmark ID                        |
| `title`     | Page title                                |
| `url`       | Page URL                                  |
| `createdAt` | Date and time when the bookmark was saved |
| `category`  | Bookmark category                         |

---

## 💾 Storage

The extension uses:

```js
chrome.storage.local;
```

This stores bookmark data locally in the user's browser.

### Why local storage?

- Simple to use
- Fast
- Works offline
- Good for early versions
- Does not require a backend

Future versions can add:

- Cloud sync
- Firebase
- Supabase
- User accounts
- Chrome sync storage

---

## 🔍 Search Logic

Search currently checks:

- Bookmark title
- Bookmark URL

Example:

```js
const filteredBookmarks = bookmarks.filter((bookmark) => {
  return (
    bookmark.title.toLowerCase().includes(query) ||
    bookmark.url.toLowerCase().includes(query)
  );
});
```

Future improvements can include:

- Search by category
- Search by tag
- Search by AI summary
- Fuzzy search
- Semantic search
- Recent bookmarks first

---

## 🤖 AI Feature Ideas

This project can be extended with real AI features.

Possible AI-powered features:

- Auto-generate bookmark summaries
- Suggest bookmark categories
- Detect duplicate bookmarks
- Recommend related bookmarks
- Generate tags automatically
- Create smart folders
- Search bookmarks using natural language
- Explain why a bookmark was categorized a certain way

Example future AI flow:

```text
User saves a page
        ↓
Extension sends title and URL to AI service
        ↓
AI generates category, tags, and summary
        ↓
Bookmark is saved with AI metadata
        ↓
User can search and organize faster
```

---

## 🛠️ Installation

### Local Development

1. Clone the repository:

```bash
git clone https://github.com/abhigyakoirala/StarMarkAI
```

2. Open the project folder:

```bash
cd starmark-ai
```

3. Open Chrome.

4. Go to:

```text
chrome://extensions/
```

5. Enable **Developer mode**.

6. Click **Load unpacked**.

7. Select the project folder.

8. Pin the extension to your Chrome toolbar.

---

## 🧪 Testing

After loading the extension:

1. Open any website.
2. Click the StarMark AI icon.
3. Click **Save Current Page**.
4. Confirm the page appears in the bookmark list.
5. Search for the saved page using the search box.
6. Reload the popup and confirm the bookmark is still saved.

---

## 🧑‍💻 How to Modify the Project

### Change the Extension Name

Edit `manifest.json`:

```json
"name": "Your Extension Name"
```

Also update the title in `popup.html`:

```html
<h1>Your Extension Name</h1>
```

---

### Change the Extension Description

Edit `manifest.json`:

```json
"description": "Your new extension description"
```

---

### Change the Icon

Replace the files inside the `icons/` folder:

```text
icons/icon16.png
icons/icon48.png
icons/icon128.png
```

Then reload the extension from:

```text
chrome://extensions/
```

---

### Change the Colors

Edit `popup.css`.

For example, update the main background:

```css
body {
  background: linear-gradient(135deg, #0f172a, #312e81);
}
```

Update the star button color:

```css
button {
  background: linear-gradient(135deg, #facc15, #f97316);
}
```

---

### Add Delete Bookmark Feature

Add this button inside each bookmark card in `popup.js`:

```js
card.innerHTML = `
  <h3>${bookmark.title}</h3>
  <a href="${bookmark.url}" target="_blank">${bookmark.url}</a>
  <button class="delete-button" data-id="${bookmark.id}">
    Delete
  </button>
`;
```

Then add this function:

```js
async function deleteBookmark(id) {
  const bookmarks = await getStoredBookmarks();

  const updatedBookmarks = bookmarks.filter(
    (bookmark) => bookmark.id !== Number(id),
  );

  await saveBookmarks(updatedBookmarks);
  renderBookmarks(updatedBookmarks);
}
```

Then attach the event listener:

```js
bookmarkList.addEventListener("click", (event) => {
  if (event.target.classList.contains("delete-button")) {
    const bookmarkId = event.target.dataset.id;
    deleteBookmark(bookmarkId);
  }
});
```

---

### Add Categories

Update the bookmark object:

```js
const newBookmark = {
  id: Date.now(),
  title: tab.title || "Untitled Bookmark",
  url: tab.url,
  createdAt: new Date().toISOString(),
  category: "General",
};
```

Then show category in the card:

```js
card.innerHTML = `
  <h3>${bookmark.title}</h3>
  <span>${bookmark.category}</span>
  <a href="${bookmark.url}" target="_blank">${bookmark.url}</a>
`;
```

---

## 🚀 Future Improvements

Planned or possible improvements:

- Delete bookmarks
- Edit bookmark titles
- Add tags
- Add categories
- Add AI summaries
- Add AI folder suggestions
- Add duplicate detection
- Add import/export
- Add Chrome sync support
- Add dark/light mode toggle
- Add right-click save option
- Add keyboard shortcut
- Add full bookmark dashboard page
- Add natural language search

---

## 🤝 Contributing

Contributions are welcome.

To contribute:

1. Fork this repository.

2. Create a new branch:

```bash
git checkout -b feature/your-feature-name
```

3. Make your changes.

4. Commit your changes:

```bash
git commit -m "Add your feature"
```

5. Push to your branch:

```bash
git push origin feature/your-feature-name
```

6. Open a pull request.

---

## 📄 License

This project is licensed under the MIT License.

You are free to use, modify, and distribute this project according to the terms of the MIT License.

```text
MIT License

Copyright (c) 2026 Abhigya Koirala

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files, to deal in the Software
without restriction, including without limitation the rights to use, copy,
modify, merge, publish, distribute, sublicense, and/or sell copies of the
Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 👤 Author

Created by **Abhigya Koirala**

GitHub: [abhigyakoirala](https://github.com/abhigyakoirala)

---

## ⭐ Support

If you find this project helpful, please support it by:

- Giving the repository a star on GitHub
- Sharing it with other developers
- Reporting bugs
- Suggesting new features
- Contributing improvements

Your support helps improve **StarMark AI** and keeps the project growing.

---

## 📌 Project Status

StarMark AI is currently in early development.

The project is ready for local testing and can be extended with more advanced AI bookmark features.

---

## 🙌 Final Note

This project is built to be beginner-friendly and easy to modify. Developers can use it as a starting point for building their own bookmark manager, AI productivity extension, or smart browser tool.
