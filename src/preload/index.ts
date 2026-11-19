import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type ForgeApi, type IpcResult } from './api'

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!res.ok) throw new Error(res.error)
  return res.data
}

const api: ForgeApi = {
  getTree: (opts) => call(CHANNELS.getTree, opts),
  getToday: (today) => call(CHANNELS.getToday, today),
  getAncestors: (id) => call(CHANNELS.getAncestors, id),
  createTask: (input) => call(CHANNELS.createTask, input),
  updateTask: (id, patch) => call(CHANNELS.updateTask, id, patch),
  moveTask: (id, newParentId, index) => call(CHANNELS.moveTask, id, newParentId, index),
  completeTask: (id, cascade) => call(CHANNELS.completeTask, id, cascade),
  reopenTask: (id) => call(CHANNELS.reopenTask, id),
  listNotes: (taskId) => call(CHANNELS.listNotes, taskId),
  addNote: (taskId, text, author) => call(CHANNELS.addNote, taskId, text, author),
  deleteTask: (id) => call(CHANNELS.deleteTask, id),
  dbPath: () => call(CHANNELS.dbPath),
  onExternalChange: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on(CHANNELS.dbChanged, listener)
    return () => ipcRenderer.removeListener(CHANNELS.dbChanged, listener)
  }
}

contextBridge.exposeInMainWorld('forge', api)
