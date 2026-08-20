import { signInAnonymously, type User } from 'firebase/auth'
import {
  get, onDisconnect, onValue, ref, set, update, type Unsubscribe,
} from 'firebase/database'
import { auth, database } from '../firebase/config'
import { randomTopic } from '../data/topics'
import { activePlayerIds, orderedIds } from '../game/rules'
import type { GamePhase, GameType, Room } from '../types/game'

const ROOM_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const MAX_PLAYERS = 10

export async function ensureAnonymousUser(): Promise<User> {
  if (auth.currentUser) return auth.currentUser
  const credential = await signInAnonymously(auth)
  return credential.user
}

function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, 16)
}

export function normalizeRoomId(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6)
}

async function generateRoomId(): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const id = Array.from({ length: 4 }, () => ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)]).join('')
    if (!(await get(ref(database, `rooms/${id}/meta`))).exists()) return id
  }
  throw new Error('部屋コードを作れませんでした。もう一度お試しください。')
}

export async function createRoom(name: string, gameType: GameType = 'number-order', spectrumTurnsPerPlayer: 1 | 2 = 1): Promise<string> {
  const safeName = cleanName(name)
  if (!safeName) throw new Error('ニックネームを入力してください。')
  const user = await ensureAnonymousUser()
  const roomId = await generateRoomId()
  const now = Date.now()
  await update(ref(database), {
    [`rooms/${roomId}/meta`]: {
      hostUid: user.uid,
      phase: 'lobby',
      round: 0,
      theme: '',
      createdAt: now,
      maxPlayers: MAX_PLAYERS,
      gameType,
      spectrumTurnsPerPlayer,
    },
    [`rooms/${roomId}/players/${user.uid}/name`]: safeName,
    [`rooms/${roomId}/players/${user.uid}/joinedAt`]: now,
    [`rooms/${roomId}/players/${user.uid}/connected`]: true,
    [`rooms/${roomId}/players/${user.uid}/ready`]: false,
    [`rooms/${roomId}/players/${user.uid}/eligibleFromRound`]: 1,
  })
  sessionStorage.setItem(`kokoro-name-${roomId}`, safeName)
  return roomId
}

export async function joinRoom(roomIdInput: string, name: string): Promise<string> {
  const roomId = normalizeRoomId(roomIdInput)
  const safeName = cleanName(name)
  if (!roomId) throw new Error('Room IDを入力してください。')
  if (!safeName) throw new Error('ニックネームを入力してください。')
  const user = await ensureAnonymousUser()
  const metaSnapshot = await get(ref(database, `rooms/${roomId}/meta`))
  if (!metaSnapshot.exists()) throw new Error('その部屋は見つかりませんでした。')
  const playerSnapshot = await get(ref(database, `rooms/${roomId}/players/${user.uid}`))
  const meta = metaSnapshot.val() as Room['meta']
  const existing = playerSnapshot.exists() ? playerSnapshot.val() as Room['players'][string] : undefined
  try {
    await update(ref(database), {
      [`rooms/${roomId}/players/${user.uid}/name`]: safeName,
      [`rooms/${roomId}/players/${user.uid}/joinedAt`]: existing?.joinedAt ?? Date.now(),
      [`rooms/${roomId}/players/${user.uid}/connected`]: true,
      [`rooms/${roomId}/players/${user.uid}/ready`]: false,
      [`rooms/${roomId}/players/${user.uid}/eligibleFromRound`]: existing?.eligibleFromRound
        ?? (meta.phase === 'lobby' ? Math.max(1, meta.round) : meta.round + 1),
    })
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes('permission')) {
      throw new Error('この部屋は満員か、参加できない状態です。')
    }
    throw error
  }
  sessionStorage.setItem(`kokoro-name-${roomId}`, safeName)
  return roomId
}

export async function registerPresence(roomId: string, uid: string): Promise<void> {
  const connectedRef = ref(database, '.info/connected')
  onValue(connectedRef, async (snapshot) => {
    if (snapshot.val() !== true) return
    const playerConnectedRef = ref(database, `rooms/${roomId}/players/${uid}/connected`)
    await onDisconnect(playerConnectedRef).set(false)
    await set(playerConnectedRef, true)
  }, { onlyOnce: true })
}

export function subscribeRoom(roomId: string, onRoom: (room: Room | null) => void): Unsubscribe {
  return onValue(ref(database, `rooms/${roomId}`), (snapshot) => onRoom(snapshot.exists() ? snapshot.val() as Room : null))
}

export function subscribeSecret(roomId: string, uid: string, onSecret: (value: number | null) => void): Unsubscribe {
  return onValue(ref(database, `roomSecrets/${roomId}/${uid}/number`), (snapshot) => onSecret(snapshot.exists() ? snapshot.val() as number : null))
}

function uniqueNumbers(count: number): number[] {
  const pool = Array.from({ length: 100 }, (_, index) => index + 1)
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[pool[index], pool[swap]] = [pool[swap], pool[index]]
  }
  return pool.slice(0, count)
}

export async function startRound(roomId: string, room: Room, uid: string): Promise<void> {
  if (room.meta.hostUid !== uid) throw new Error('ホストだけが開始できます。')
  const nextRound = room.meta.round + 1
  const activeIds = Object.entries(room.players)
    .filter(([, player]) => player.connected && player.eligibleFromRound <= nextRound)
    .sort(([, a], [, b]) => a.joinedAt - b.joinedAt)
    .map(([playerUid]) => playerUid)
  if (activeIds.length < 3) throw new Error('ゲーム開始には3人以上必要です。')
  const numbers = uniqueNumbers(activeIds.length)
  const changes: Record<string, unknown> = {
    [`rooms/${roomId}/meta/phase`]: 'reveal',
    [`rooms/${roomId}/meta/round`]: nextRound,
    [`rooms/${roomId}/meta/theme`]: randomTopic(room.meta.theme),
    [`rooms/${roomId}/order`]: activeIds,
    [`rooms/${roomId}/reveals`]: null,
  }
  Object.keys(room.players).forEach((playerUid) => {
    changes[`roomSecrets/${roomId}/${playerUid}/number`] = null
  })
  activeIds.forEach((playerUid, index) => {
    changes[`rooms/${roomId}/players/${playerUid}/ready`] = false
    changes[`rooms/${roomId}/players/${playerUid}/hint`] = null
    changes[`roomSecrets/${roomId}/${playerUid}/number`] = numbers[index]
  })
  await update(ref(database), changes)
}

export async function markReady(roomId: string, uid: string): Promise<void> {
  await set(ref(database, `rooms/${roomId}/players/${uid}/ready`), true)
}

export async function setPhase(roomId: string, phase: GamePhase): Promise<void> {
  await set(ref(database, `rooms/${roomId}/meta/phase`), phase)
}

export async function syncOrder(roomId: string, ids: string[]): Promise<void> {
  await set(ref(database, `rooms/${roomId}/order`), ids)
}

export async function submitHint(roomId: string, uid: string, hint: string): Promise<void> {
  const safeHint = hint.trim().replace(/\s+/g, ' ').slice(0, 40)
  if (!safeHint) throw new Error('ヒントを入力してください。')
  await set(ref(database, `rooms/${roomId}/players/${uid}/hint`), safeHint)
}

export async function revealOwnNumber(roomId: string, uid: string, number: number): Promise<void> {
  await set(ref(database, `rooms/${roomId}/reveals/${uid}`), number)
}

export async function leaveRoom(roomId: string, uid: string): Promise<void> {
  await set(ref(database, `rooms/${roomId}/players/${uid}/connected`), false)
}

export function allActiveReady(room: Room): boolean {
  const ids = activePlayerIds(room)
  return ids.length > 0 && ids.every((uid) => room.players[uid]?.ready)
}

export function allOrderedPlayersRevealed(room: Room): boolean {
  const ids = orderedIds(room.order)
  return ids.length > 0 && ids.every((uid) => room.reveals?.[uid] != null)
}
