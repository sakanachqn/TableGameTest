import type { Player, ResultEntry, Room } from '../types/game'

export function orderedIds(order: Room['order']): string[] {
  if (!order) return []
  if (Array.isArray(order)) return order.filter(Boolean)
  return Object.keys(order).sort((a, b) => Number(a) - Number(b)).map((key) => order[key])
}

export function activePlayerIds(room: Room): string[] {
  return Object.entries(room.players ?? {})
    .filter(([, player]) => player.connected && player.eligibleFromRound <= room.meta.round)
    .sort(([, a], [, b]) => a.joinedAt - b.joinedAt)
    .map(([uid]) => uid)
}

export function calculateResults(room: Room): { entries: ResultEntry[]; exact: number; success: boolean } | null {
  const guess = orderedIds(room.order)
  const reveals = room.reveals ?? {}
  if (!guess.length || guess.some((uid) => reveals[uid] == null)) return null
  const actual = [...guess].sort((a, b) => reveals[b] - reveals[a])
  const entries = guess.map((uid, guessedIndex) => ({
    uid,
    name: room.players[uid]?.name ?? '退出したプレイヤー',
    number: reveals[uid],
    guessedIndex,
    actualIndex: actual.indexOf(uid),
  }))
  const exact = entries.filter((entry) => entry.guessedIndex === entry.actualIndex).length
  return { entries, exact, success: exact === guess.length }
}

export function displayPlayers(players: Record<string, Player>): Array<[string, Player]> {
  return Object.entries(players).sort(([, a], [, b]) => a.joinedAt - b.joinedAt)
}
