import { ref } from 'vue'
import type { Note } from '@devdesk/shared'
import { bus } from './events'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const buffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
const unlockedKeys = new Map<string, CryptoKey>()
export const unlockedKeyHashes = ref(new Set<string>())

type PrivateNote = Pick<Note, 'title' | 'body' | 'tags' | 'taskId' | 'notebookId'>

export function isProtectedNote(note: Pick<Note, 'isProtected' | 'encrypted'>): boolean {
  return note.isProtected || note.encrypted !== null
}
export function isNoteUnlocked(note: Pick<Note, 'isProtected' | 'encrypted'>): boolean {
  return !!note.encrypted && unlockedKeyHashes.value.has(note.encrypted.keyHash)
}
function base64(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += String.fromCharCode(byte)
  return btoa(out)
}
function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
}
function random(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  return bytes
}
async function derive(passphrase: string): Promise<{ hash: string; key: CryptoKey }> {
  if (passphrase.length < 12) throw new Error('Use an unlock key with at least 12 characters.')
  const material = await crypto.subtle.importKey('raw', buffer(encoder.encode(passphrase)), 'PBKDF2', false, ['deriveBits', 'deriveKey'])
  const params = { name: 'PBKDF2' as const, hash: 'SHA-256' as const, salt: buffer(encoder.encode('devdesk-note-key-v2')), iterations: 310_000 }
  const [bits, key] = await Promise.all([
    crypto.subtle.deriveBits(params, material, 256),
    crypto.subtle.deriveKey(params, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),
  ])
  return { hash: base64(new Uint8Array(bits)), key }
}
async function seal(value: string, key: CryptoKey) {
  const iv = random(12)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buffer(iv) }, key, buffer(encoder.encode(value)))
  return { iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)) }
}
async function open(value: { iv: string; ciphertext: string }, key: CryptoKey): Promise<string> {
  return decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buffer(fromBase64(value.iv)) }, key, buffer(fromBase64(value.ciphertext))))
}
function remember(hash: string, key: CryptoKey) {
  unlockedKeys.set(hash, key)
  unlockedKeyHashes.value = new Set(unlockedKeys.keys())
  bus.emit('vault:changed', { unlocked: true })
}
function keyFor(record: Note): CryptoKey {
  const key = record.encrypted && unlockedKeys.get(record.encrypted.keyHash)
  if (!key) throw new Error('Unlock this note to access its contents.')
  return key
}

export async function encryptNoteFields(note: PrivateNote, passphrase: string): Promise<Pick<Note, 'title' | 'body' | 'tags' | 'taskId' | 'notebookId' | 'isProtected' | 'encrypted'>> {
  const { hash, key } = await derive(passphrase)
  remember(hash, key)
  return { title: 'Protected note', body: '', tags: [], taskId: null, notebookId: null, isProtected: true, encrypted: { version: 2, keyHash: hash, ...await seal(JSON.stringify(note), key) } }
}
export async function encryptUnlockedNoteFields(record: Note, note: PrivateNote): Promise<Pick<Note, 'title' | 'body' | 'tags' | 'taskId' | 'notebookId' | 'isProtected' | 'encrypted'>> {
  if (!record.encrypted) throw new Error('Protected note is missing encrypted data.')
  return { title: 'Protected note', body: '', tags: [], taskId: null, notebookId: null, isProtected: true, encrypted: { ...record.encrypted, ...await seal(JSON.stringify(note), keyFor(record)) } }
}
export async function unlockNote(record: Note, passphrase: string): Promise<void> {
  if (!record.encrypted) throw new Error('Protected note is missing encrypted data.')
  const { hash, key } = await derive(passphrase)
  if (hash !== record.encrypted.keyHash) throw new Error('Invalid unlock key.')
  try { await open(record.encrypted, key) } catch { throw new Error('Invalid unlock key.') }
  remember(hash, key)
}
export function lockKey(note: Pick<Note, 'encrypted'>): void {
  if (!note.encrypted) return
  unlockedKeys.delete(note.encrypted.keyHash)
  unlockedKeyHashes.value = new Set(unlockedKeys.keys())
  bus.emit('vault:changed', { unlocked: unlockedKeys.size > 0 })
}
export function lockVault(): void {
  unlockedKeys.clear()
  unlockedKeyHashes.value = new Set()
  bus.emit('vault:changed', { unlocked: false })
}
export async function decryptNote(record: Note): Promise<Note> {
  if (!isProtectedNote(record)) return record
  if (!record.encrypted) throw new Error('Protected note is missing encrypted data.')
  const privateFields = JSON.parse(await open(record.encrypted, keyFor(record))) as PrivateNote
  return { ...record, ...privateFields }
}
export function protectedPlaceholder(record: Note): Note {
  return { ...record, title: 'Protected note', body: '', tags: [], taskId: null, notebookId: null }
}
