import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type ForgeApi, type IpcResult } from './api'

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!res.ok) throw new Error(res.error)
  return res.data
}

const api: ForgeApi = {
  getTree: () => call(CHANNELS.getTree),
  getToday: (today) => call(CHANNELS.getToday, today),
  getAncestors: (id) => call(CHANNELS.getAncestors, id),
  createTask: (input) => call(CHANNELS.createTask, input),
  updateTask: (id, patch) => call(CHANNELS.updateTask, id, patch),
  moveTask: (id, newParentId, index) => call(CHANNELS.moveTask, id, newParentId, index),
  completeTask: (id, cascade) => call(CHANNELS.completeTask, id, cascade),
  deleteTask: (id) => call(CHANNELS.deleteTask, id),
  dbPath: () => call(CHANNELS.dbPath),
  onExternalChange: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on(CHANNELS.dbChanged, listener)
    return () => ipcRenderer.removeListener(CHANNELS.dbChanged, listener)
  }
}

contextBridge.exposeInMainWorld('forge', api)
