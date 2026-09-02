import { beforeEach, describe, expect, it } from 'vitest'
import { decryptNote, encryptNoteFields, isNoteUnlocked, lockVault, unlockNote } from './vault'

const record = { id: 'n1', workspaceId: 'default', userId: null, revision: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, title: 'Private', body: 'secret body', tags: ['secret'], taskId: null, notebookId: 'folder', isProtected: false, encrypted: null }

beforeEach(() => lockVault())

describe('note keys', () => {
  it('stores a derived key hash, keeps the key only in memory, and rejects a wrong key', async () => {
    const encrypted = await encryptNoteFields(record, 'a passphrase long enough')
    const protectedRecord = { ...record, ...encrypted }
    const secondRecord = { ...record, id: 'n2', ...await encryptNoteFields({ ...record, body: 'second secret' }, 'a passphrase long enough') }
    expect(JSON.stringify(encrypted)).not.toContain('a passphrase long enough')
    expect(encrypted.encrypted?.keyHash).toBeTruthy()

    lockVault()
    expect(isNoteUnlocked(protectedRecord)).toBe(false)
    await expect(decryptNote(protectedRecord)).rejects.toThrow('Unlock this note')
    await expect(unlockNote(protectedRecord, 'wrong key that is long enough')).rejects.toThrow('Invalid unlock key')
    await unlockNote(protectedRecord, 'a passphrase long enough')
    expect(isNoteUnlocked(protectedRecord)).toBe(true)
    expect(isNoteUnlocked(secondRecord)).toBe(true)
    await expect(decryptNote(protectedRecord)).resolves.toMatchObject({ body: 'secret body' })
  })
})
