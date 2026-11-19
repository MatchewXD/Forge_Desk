import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import {
  TaskRepository,
  type CreateTaskInput,
  type TreeView,
  type UpdateTaskInput,
  dataVersion,
  defaultDbPath,
  openDatabase
} from '../shared/db/index.ts'
import { CHANNELS, type IpcResult } from '../preload/api'

let db: DatabaseSync
let repo: TaskRepository
let mainWindow: BrowserWindow | null = null

function handle<A extends unknown[], T>(channel: string, fn: (...args: A) => T): void {
  ipcMain.handle(channel, (_event, ...args): IpcResult<T> => {
    try {
      return { ok: true, data: fn(...(args as A)) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

function registerIpc(dbPath: string): void {
  handle(CHANNELS.getTree, (view?: TreeView) => repo.getTree(undefined, view))
  handle(CHANNELS.getToday, (today?: string) => repo.getToday(today))
  handle(CHANNELS.getAncestors, (id: number) => repo.getAncestors(id))
  handle(CHANNELS.createTask, (input: CreateTaskInput) => repo.createTask(input))
  handle(CHANNELS.updateTask, (id: number, patch: UpdateTaskInput) => repo.updateTask(id, patch))
  handle(CHANNELS.moveTask, (id: number, parentId: number | null, index?: number) =>
    repo.moveTask(id, parentId, index)
  )
  handle(CHANNELS.completeTask, (id: number, cascade?: boolean) =>
    repo.completeTask(id, { cascade })
  )
  handle(CHANNELS.reopenTask, (id: number) => repo.reopenTask(id))
  handle(CHANNELS.deleteTask, (id: number) => repo.deleteTask(id))
  handle(CHANNELS.dbPath, () => dbPath)
}

/**
 * PRAGMA data_version changes only when a *different* connection commits, so this
 * detects edits from the MCP server (Phase 1.5) and tells the renderer to reload.
 */
function watchExternalChanges(): void {
  let last = dataVersion(db)
  setInterval(() => {
    const v = dataVersion(db)
    if (v !== last) {
      last = v
      mainWindow?.webContents.send(CHANNELS.dbChanged)
    }
  }, 1500)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: 'Forge Desk',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => (mainWindow = null))
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.forgedesk.app')
  const dbPath = defaultDbPath()
  db = openDatabase(dbPath)
  repo = new TaskRepository(db)
  registerIpc(dbPath)
  watchExternalChanges()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  db?.close()
  if (process.platform !== 'darwin') app.quit()
})
