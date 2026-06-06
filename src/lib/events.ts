import { EventEmitter } from 'events'

declare global {
  var __fileEvents: EventEmitter | undefined
}

export const fileEvents: EventEmitter = (globalThis.__fileEvents ??= new EventEmitter())
fileEvents.setMaxListeners(200)
