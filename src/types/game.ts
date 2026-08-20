export type GameType = 'number-order' | 'spectrum'
export type NumberOrderPhase = 'lobby' | 'reveal' | 'discussion' | 'ordering' | 'result'
export type SpectrumPhase = 'psychicReveal' | 'clue' | 'guessing' | 'result' | 'gameEnd'
export type GamePhase = NumberOrderPhase | SpectrumPhase

export interface SpectrumTopic {
  id: string
  leftLabel: string
  rightLabel: string
}

export type FirebaseList<T> = T[] | Record<string, T>

export interface SpectrumGameState {
  round: number
  maxRounds: number
  roundsPerPlayer: 1 | 2
  psychicUid: string
  psychicOrder: FirebaseList<string>
  psychicReady: boolean
  topic: SpectrumTopic
  usedTopicIds: Record<string, boolean>
  clue?: string
  guessStatus?: Record<string, boolean>
  revealedTargetPosition?: number
  revealedGuesses?: Record<string, number>
  scores: Record<string, number>
  totalGuessDistance: Record<string, number>
  guessCounts: Record<string, number>
  lastRoundScores?: Record<string, number>
  lastRoundDistances?: Record<string, number>
  lastAverageDistance?: number
  lastSettledRound: number
}

export interface RoomMeta {
  hostUid: string
  phase: GamePhase
  round: number
  theme: string
  createdAt: number
  maxPlayers: number
  gameType?: GameType
  spectrumTurnsPerPlayer?: 1 | 2
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
  spectrum?: SpectrumGameState
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
