export type GamePhase = 'lobby' | 'reveal' | 'discussion' | 'ordering' | 'result'

export interface RoomMeta {
  hostUid: string
  phase: GamePhase
  round: number
  theme: string
  createdAt: number
  maxPlayers: number
}

export interface Player {
  name: string
  hint?: string
  joinedAt: number
  connected: boolean
  ready: boolean
  eligibleFromRound: number
}

export interface Room {
  meta: RoomMeta
  players: Record<string, Player>
  order?: string[] | Record<string, string>
  reveals?: Record<string, number>
}

export interface RoomSession {
  roomId: string
  uid: string
  room: Room
  secretNumber: number | null
  connected: boolean
}

export interface ResultEntry {
  uid: string
  name: string
  number: number
  guessedIndex: number
  actualIndex: number
}
