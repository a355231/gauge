'use strict';
const path = require('node:path');
const { app, BrowserWindow, Tray, Menu, ipcMain, shell, screen, nativeTheme, Notification } = require('electron');

const store = require('./store');
const { Poller } = require('./poller');
const { catalog, fetchProvider } = require('./providers');
const { trayImage, appIcon } = require('./icon');
const { getGoPlan, diffGoPlan } = require('./goPlan');

const PANEL_WIDTH = 384;
const PANEL_MIN_HEIGHT = 220;
const PANEL_MAX_HEIGHT = 820;
const GAP = 8;
const GO_PLAN_INTERVAL = 6 * 60 * 60 * 1000;

let tray = null;
let panel = null;
let settingsWin = null;
let poller = null;
let quitting = false;
let goPlanTimer = null;
let lastGoDiff = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => togglePanel(true));
  app.whenReady().then(init);
}

async function init() {
  app.setAppUserModelId('dev.mason.gauge');
  if (process.platform === 'darwin') app.dock?.hide();

  poller = new Poller();
  poller.on('update', (snap) => {
    updateTray(snap);
    send(panel, 'snapshot', snap);
  });
  poller.on('alert', (a) => notify(a));

  createTray();
  createPanel();
  registerIpc();

  applyTheme();
  nativeTheme.on('updated', () => {
    updateTray(poller.snapshot());
    send(panel, 'theme', themeInfo());
    send(settingsWin, 'theme', themeInfo());
  });

  // Only the installed build owns the startup entry. Electron keys it by appId,
  // so letting a dev run reconcile would repoint it at electron.exe and break
  // autostart for the installed copy. Explicit toggles still work either way.
  if (app.isPackaged) applyLoginItem(store.load().general.launchAtLogin);

  await poller.refresh({ reason: 'startup' });
  poller.start();

  // Model list: establish a baseline quietly, then watch for changes.
  checkGoPlan({ notify: false });
  goPlanTimer = setInterval(() => checkGoPlan({ notify: true }), GO_PLAN_INTERVAL);
  if (goPlanTimer.unref) goPlanTimer.unref();

  if (process.argv.includes('--screenshot')) await captureScreens();
}

/** Dev utility: render both windows to PNG and exit. `--screenshot <dir>` */
async function captureScreens() {
  const fs = require('node:fs');
  const idx = process.argv.indexOf('--screenshot');
  const dir = process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')
    ? process.argv[idx + 1]
    : app.getPath('temp');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  fs.mkdirSync(dir, { recursive: true });
  panel.setPosition(60, 60, false);
  panel.show();
  await wait(1200);
  fs.writeFileSync(path.join(dir, 'panel.png'), (await panel.webContents.capturePage()).toPNG());

  // drill into the Go plan and capture both of its views
  await panel.webContents.executeJavaScript('openGoPlan()');
  await wait(2500);
  fs.writeFileSync(path.join(dir, 'go-pricing.png'), (await panel.webContents.capturePage()).toPNG());
  await panel.webContents.executeJavaScript("goTab='requests'; render(lastSnapshot);");
  await wait(800);
  fs.writeFileSync(path.join(dir, 'go-requests.png'), (await panel.webContents.capturePage()).toPNG());
  await panel.webContents.executeJavaScript("view='main'; render(lastSnapshot);");
  await wait(400);

  openSettings();
  await wait(1500);
  fs.writeFileSync(path.join(dir, 'settings.png'), (await settingsWin.webContents.capturePage()).toPNG());

  console.log('screenshots written to ' + dir);
  quitting = true;
  app.quit();
}

/**
 * Re-scrape the Go model table and report what moved. Runs quietly at launch so
 * the first comparison against the bundled snapshot doesn't raise a false alarm.
 */
async function checkGoPlan({ notify: shouldNotify = true } = {}) {
  try {
    const before = await getGoPlan();
    const after = await getGoPlan({ force: true });
    if (!after) return null;

    const diff = diffGoPlan(before, after);
    if (diff.hasChanges) lastGoDiff = { ...diff, at: Date.now() };
    send(panel, 'goplan', { plan: after, diff, lastChange: lastGoDiff });

    // `before.stale` means we only had the bundled snapshot - not a real change.
    if (shouldNotify && diff.hasChanges && before && !before.stale && store.load().general.alerts) {
      const parts = [];
      if (diff.added.length) parts.push(`${diff.added.length} added`);
      if (diff.removed.length) parts.push(`${diff.removed.length} removed`);
      if (diff.repriced.length) parts.push(`${diff.repriced.length} repriced`);
      notify({
        title: 'OpenCode Go model list changed',
        body: parts.join(', ') + (diff.added.length ? ` - ${diff.added.slice(0, 3).join(', ')}` : '') + '.',
      });
    }
    return diff;
  } catch {
    return null;
  }
}

// ---- tray ----------------------------------------------------------------

function createTray() {
  tray = new Tray(trayImage(null, { dark: isDarkTray(), muted: true }));
  tray.setToolTip('Gauge - AI usage');
  tray.on('click', () => togglePanel());
  tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));
  updateTray(poller.snapshot());
}

function buildMenu() {
  const snap = poller.snapshot();
  const items = snap.providers.map((p) => ({
    label: summaryLine(p),
    enabled: false,
  }));
  return Menu.buildFromTemplate([
    { label: 'Gauge', enabled: false },
    { type: 'separator' },
    ...(items.length ? items : [{ label: 'No trackers enabled', enabled: false }]),
    { type: 'separator' },
    { label: 'Open panel', click: () => togglePanel(true) },
    { label: 'Refresh now', click: () => poller.refresh({ reason: 'manual' }) },
    { label: 'Settings...', click: openSettings },
    { type: 'separator' },
    {
      label: 'Quit Gauge',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
}

function summaryLine(p) {
  if (p.state === 'loading') return `${p.name || p.id}: loading...`;
  if (p.state !== 'ok') return `${p.name}: ${p.message || 'unavailable'}`;
  const pr = p.primary || {};
  if (pr.kind === 'currency') return `${p.name}: ${formatMoney(pr.amount)} left`;
  if (pr.kind === 'count') return `${p.name}: ${pr.amount} credits`;
  if (pr.kind === 'tally') return `${p.name}: ${pr.amount} ${pr.unit} (${pr.label.toLowerCase()})`;
  return `${p.name}: ${Math.round(100 - pr.used)}% left (${pr.label})`;
}

function updateTray(snap) {
  if (!tray) return;
  const worst = snap.worst || {};
  const general = store.load().general;
  tray.setImage(
    trayImage(worst.used ?? null, {
      dark: isDarkTray(),
      showPercent: general.trayStyle === 'ringPercent',
      muted: worst.used === null || worst.used === undefined,
    })
  );

  const lines = snap.providers.map(summaryLine);
  const head =
    worst.used === null || worst.used === undefined
      ? 'Gauge - no readings yet'
      : `Gauge - ${Math.round(100 - worst.used)}% left (${worst.name})`;
  tray.setToolTip([head, ...lines].join('\n').slice(0, 500));
}

function isDarkTray() {
  // Windows/macOS tray sit on a surface that follows the OS theme.
  return nativeTheme.shouldUseDarkColors;
}

function notify(alert) {
  if (!Notification.isSupported()) return;
  new Notification({ title: alert.title, body: alert.body, icon: appIcon(128), silent: false }).show();
}

// ---- panel window --------------------------------------------------------

function createPanel() {
  panel = new BrowserWindow({
    width: PANEL_WIDTH,
    height: 420,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    icon: appIcon(256),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  panel.setAlwaysOnTop(true, 'pop-up-menu');
  panel.loadFile(path.join(__dirname, '..', 'renderer', 'panel.html'));
  panel.on('blur', () => {
    if (!panel.webContents.isDevToolsOpened()) panel.hide();
  });
  panel.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      panel.hide();
    }
  });
  panel.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
}

function togglePanel(forceShow = false) {
  if (!panel) return;
  if (panel.isVisible() && !forceShow) {
    panel.hide();
    return;
  }
  send(panel, 'snapshot', poller.snapshot());
  positionPanel();
  panel.show();
  panel.focus();
  poller.refresh({ reason: 'open' });
}

function positionPanel() {
  const bounds = panel.getBounds();
  const trayBounds = tray?.getBounds?.() || null;
  const display = trayBounds && trayBounds.width
    ? screen.getDisplayMatching(trayBounds)
    : screen.getPrimaryDisplay();
  const area = display.workArea;

  let x;
  let y;
  if (trayBounds && trayBounds.width) {
    x = Math.round(trayBounds.x + trayBounds.width / 2 - bounds.width / 2);
    const trayIsBottom = trayBounds.y > area.y + area.height / 2;
    y = trayIsBottom ? area.y + area.height - bounds.height - GAP : area.y + GAP;
  } else {
    x = area.x + area.width - bounds.width - GAP;
    y = area.y + area.height - bounds.height - GAP;
  }

  x = Math.min(Math.max(x, area.x + GAP), area.x + area.width - bounds.width - GAP);
  y = Math.min(Math.max(y, area.y + GAP), area.y + area.height - bounds.height - GAP);
  panel.setPosition(Math.round(x), Math.round(y), false);
}

// ---- settings window -----------------------------------------------------

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 620,
    height: 720,
    minWidth: 520,
    minHeight: 520,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#0f1117',
    title: 'Gauge Settings',
    icon: appIcon(256),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  settingsWin.loadFile(path.join(__dirname, '..', 'renderer', 'settings.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
  settingsWin.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
}

// ---- ipc -----------------------------------------------------------------

function registerIpc() {
  ipcMain.handle('snapshot:get', () => poller.snapshot());
  ipcMain.handle('snapshot:refresh', () => poller.refresh({ reason: 'manual' }));

  ipcMain.handle('settings:get', () => ({
    ...store.getState(),
    catalog: catalog(),
    theme: themeInfo(),
    version: app.getVersion(),
  }));

  ipcMain.handle('settings:setGeneral', (_e, patch) => {
    const general = store.updateGeneral(sanitizeGeneral(patch));
    if ('refreshMinutes' in patch) poller.reschedule();
    if ('launchAtLogin' in patch) applyLoginItem(general.launchAtLogin);
    if ('theme' in patch) applyTheme();
    updateTray(poller.snapshot());
    send(panel, 'snapshot', poller.snapshot());
    send(panel, 'theme', themeInfo());
    send(settingsWin, 'theme', themeInfo());
    return general;
  });

  ipcMain.handle('settings:setProvider', async (_e, id, patch) => {
    store.updateProvider(id, patch);
    await poller.refresh({ reason: 'silent' });
    return store.getState();
  });

  ipcMain.handle('provider:test', async (_e, id, secret) => {
    const config = { ...store.providerConfig(id) };
    if (secret) {
      const field = store.getState().providers[id]?.secretField;
      if (field) config[field] = secret;
    }
    const result = await fetchProvider(id, config);
    return {
      state: result.state,
      message: result.message || null,
      plan: result.plan || null,
      account: result.account || null,
      source: result.source || null,
      summary: result.state === 'ok' ? summaryLine(result) : null,
    };
  });

  ipcMain.handle('panel:height', (_e, height) => {
    if (!panel) return;
    // Never grow past the screen the panel actually sits on.
    const area = screen.getDisplayMatching(panel.getBounds()).workArea;
    const ceiling = Math.min(PANEL_MAX_HEIGHT, area.height - 24);
    const h = Math.round(Math.min(ceiling, Math.max(PANEL_MIN_HEIGHT, height)));
    const b = panel.getBounds();
    if (Math.abs(b.height - h) < 2) return;
    panel.setBounds({ x: b.x, y: b.y, width: PANEL_WIDTH, height: h }, false);
    if (panel.isVisible()) positionPanel();
  });

  ipcMain.handle('goplan:get', async (_e, force) => {
    if (force) await checkGoPlan({ notify: false });
    const plan = await getGoPlan({ force: false });
    return plan ? { ...plan, lastChange: lastGoDiff } : null;
  });

  ipcMain.handle('panel:hide', () => panel?.hide());
  ipcMain.handle('app:openSettings', () => openSettings());
  ipcMain.handle('app:openExternal', (_e, url) => openExternal(url));
  ipcMain.handle('app:quit', () => {
    quitting = true;
    app.quit();
  });
  ipcMain.handle('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());
  ipcMain.handle('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
}

function sanitizeGeneral(patch) {
  const out = { ...patch };
  if ('refreshMinutes' in out) out.refreshMinutes = clamp(Number(out.refreshMinutes) || 5, 1, 240);
  if ('alertThreshold' in out) out.alertThreshold = clamp(Number(out.alertThreshold) || 85, 50, 99);
  if ('theme' in out && !['system', 'dark', 'light'].includes(out.theme)) delete out.theme;
  if ('trayStyle' in out && !['ring', 'ringPercent'].includes(out.trayStyle)) delete out.trayStyle;
  return out;
}

function applyTheme() {
  nativeTheme.themeSource = store.load().general.theme || 'system';
}

function applyLoginItem(enabled) {
  try {
    const opts = { openAtLogin: Boolean(enabled), openAsHidden: true, args: ['--hidden'] };
    if (!app.isPackaged) {
      // Running via `electron .` - the login entry needs the app directory too.
      opts.path = process.execPath;
      opts.args = [app.getAppPath(), '--hidden'];
    }
    app.setLoginItemSettings(opts);
  } catch {
    /* unsupported platform */
  }
}

function themeInfo() {
  return { dark: nativeTheme.shouldUseDarkColors, source: nativeTheme.themeSource };
}

function openExternal(url) {
  if (typeof url === 'string' && /^https:\/\//i.test(url)) shell.openExternal(url);
}

function send(win, channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function formatMoney(v) {
  return typeof v === 'number' ? `$${v.toFixed(2)}` : '--';
}

app.on('window-all-closed', (e) => {
  // Tray app: outliving its windows is the point.
  if (!quitting) e.preventDefault?.();
});
app.on('before-quit', () => {
  quitting = true;
  poller?.stop();
  if (goPlanTimer) clearInterval(goPlanTimer);
});
