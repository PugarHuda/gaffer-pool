// Gaffer desktop app — a thin Electron shell that boots the local Gaffer server
// (all QVAC inference on-device) and opens it in a native window. No cloud.
//
//   npm run desktop
const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const http = require("node:http");

const ROOT = path.join(__dirname, "..");
const PORT = process.env.PORT || 8787;
let serverProc = null;
let win = null;

// Run the server in plain-HTTP mode and point the window at localhost. http://localhost
// is a secure context in Chromium/Electron, so the mic/voice loop still works — and we
// don't need to ship or trust a TLS cert inside the package.
const APP_URL = `http://localhost:${PORT}`;

function startServer() {
  // In a packaged app process.execPath is Gaffer.exe (Electron). ELECTRON_RUN_AS_NODE
  // makes it behave as plain Node so server.js runs as an ordinary script.
  serverProc = spawn(process.execPath, [path.join(ROOT, "src", "server.js")], {
    cwd: ROOT,
    env: { ...process.env, GAFFER_DESKTOP: "1", GAFFER_HTTP: "1", ELECTRON_RUN_AS_NODE: "1" },
    stdio: "inherit",
  });
  serverProc.on("exit", (code) => console.log(`[gaffer server exited ${code}]`));
}

function waitForServer(url, tries = 120) {
  return new Promise((resolve) => {
    const tick = () => {
      http.get(url, (r) => { r.destroy(); resolve(true); })
        .on("error", () => (--tries <= 0 ? resolve(false) : setTimeout(tick, 1000)));
    };
    tick();
  });
}

async function createWindow() {
  win = new BrowserWindow({
    width: 430, height: 880, // phone-like; the UI is responsive
    title: "Gaffer — Football Analyst (on-device)",
    backgroundColor: "#eef1ee",
    webPreferences: { contextIsolation: true },
  });
  // Auto-grant mic permission to the local app (voice loop).
  win.webContents.session.setPermissionRequestHandler((wc, perm, cb) => cb(perm === "media"));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  await win.loadURL(APP_URL);
}

app.whenReady().then(async () => {
  startServer();
  const ok = await waitForServer(APP_URL);
  if (!ok) console.error("Server did not start in time");
  await createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => {
  // On macOS the app stays resident and `activate` reopens a window — so keep the
  // server alive (before-quit kills it on real quit). Elsewhere, quit and free it.
  if (process.platform !== "darwin") { try { serverProc?.kill(); } catch {} app.quit(); }
});
app.on("before-quit", () => { try { serverProc?.kill(); } catch {} });
