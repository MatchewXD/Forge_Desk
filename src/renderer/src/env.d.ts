import type { ForgeApi } from '../../preload/api'

declare global {
  interface Window {
    forge: ForgeApi
  }
}

export {}
