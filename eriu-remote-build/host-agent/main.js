const { app, BrowserWindow, ipcMain, desktopCapturer, screen } = require('electron');
const path = require('path');

// robotjs does OS-level mouse/keyboard injection. It requires native
// compilation — see README for per-OS build prerequisites.
let robot = null;
try {
  robot = require('robotjs');
} catch (e) {
  console.error('robotjs failed to load — input control will be disabled.', e.message);
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 560,
    resizable: false,
    title: 'Remote Access — Host',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile('index.html');
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- Screen capture source for renderer's getUserMedia() call ----
ipcMain.handle('get-screen-source', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'] });
  // Single-monitor MVP: grab the primary screen. Extend this to let the
  // host pick a monitor if you have more than one.
  return sources[0] ? { id: sources[0].id, name: sources[0].name } : null;
});

// ---- Remote input injection ----
// Coordinates arrive normalized (0..1) from the viewer; scale to this
// machine's actual screen size before injecting.
ipcMain.on('remote-input', (_evt, msg) => {
  if (!robot) return;
  const { width, height } = screen.getPrimaryDisplay().size;

  try {
    switch (msg.type) {
      case 'mousemove': {
        robot.moveMouse(Math.round(msg.x * width), Math.round(msg.y * height));
        break;
      }
      case 'mousedown': {
        robot.mouseToggle('down', mapButton(msg.button));
        break;
      }
      case 'mouseup': {
        robot.mouseToggle('up', mapButton(msg.button));
        break;
      }
      case 'scroll': {
        robot.scrollMouse(Math.round(-msg.dx / 10), Math.round(-msg.dy / 10));
        break;
      }
      case 'keydown': {
        const key = mapKey(msg.key, msg.code);
        if (key) robot.keyToggle(key, 'down');
        break;
      }
      case 'keyup': {
        const key = mapKey(msg.key, msg.code);
        if (key) robot.keyToggle(key, 'up');
        break;
      }
    }
  } catch (e) {
    console.warn('Input injection error:', e.message);
  }
});

function mapButton(btn) {
  // JS MouseEvent.button: 0=left, 1=middle, 2=right
  return { 0: 'left', 1: 'middle', 2: 'right' }[btn] || 'left';
}

// Minimal, extend as needed. robotjs key names: https://robotjs.io/docs/syntax#keytogglekey-down-modifier
const KEY_MAP = {
  Enter: 'enter', Escape: 'escape', Backspace: 'backspace', Tab: 'tab',
  ' ': 'space', ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  Shift: 'shift', Control: 'control', Alt: 'alt', Meta: 'command',
  Delete: 'delete', Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown',
};

function mapKey(key, code) {
  if (KEY_MAP[key]) return KEY_MAP[key];
  if (/^[a-zA-Z0-9]$/.test(key)) return key.toLowerCase();
  if (/^F\d{1,2}$/.test(key)) return key.toLowerCase();
  return null; // unmapped keys are dropped rather than guessed
}
