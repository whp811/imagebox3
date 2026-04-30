import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { execFile } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerWsiFileHandler, registerWsiSchemesEarly, toWsiUrl } from './wsi-protocol'
import { ensureSlidesDir, getApplicationRootDir, getSlidesRootPath } from './slides-root'
import { scanForSlides } from './scan-slides'
import { materializeZipEntrySourceForViewing } from './zip-source'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Flash drive / portable: keep caches and profile next to the app (same volume as WSI data).
 * Prevents writing under ~/.config or %APPDATA% when the bundle runs from removable media.
 */
if (app.isPackaged) {
  try {
    const root = getApplicationRootDir()
    const data = join(root, '.wsi-hive-data')
    mkdirSync(data, { recursive: true })
    if (process.platform === 'win32') {
      execFile('attrib', ['+h', data], { windowsHide: true }, () => undefined)
    }
    app.setPath('userData', data)
    app.setPath('cache', join(data, 'cache'))
  } catch (e) {
    console.warn('WSI Hive: could not set portable data paths', e)
  }
}

registerWsiSchemesEarly()

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: false,
      preload: join(__dirname, '../preload/index.mjs'),
    },
  })
  const rendererDevUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && rendererDevUrl) {
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`)
    })
    mainWindow.loadURL(rendererDevUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  mainWindow.webContents.setWindowOpenHandler((d) => {
    shell.openExternal(d.url)
    return { action: 'deny' }
  })
}

app.whenReady().then(() => {
  registerWsiFileHandler()
  ensureSlidesDir()
  createWindow()

  ipcMain.handle('slides:getInfo', () => {
    return {
      applicationRoot: getApplicationRootDir(),
      slidesRoot: getSlidesRootPath(),
    }
  })
  ipcMain.handle('slides:rescan', async () => {
    return scanForSlides(ensureSlidesDir())
  })
  ipcMain.handle('wsi:pathToUrl', async (_e, { absolutePath }: { absolutePath: string }) => {
    const source = await materializeZipEntrySourceForViewing(absolutePath, app.getPath('userData'))
    return toWsiUrl(source)
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

export {}
