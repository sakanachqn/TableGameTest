import { spectrumTopics } from '../../data/spectrumTopics'
import type { FirebaseList, SpectrumTopic } from '../../types/game'

export const GUESS_SCORE_ZONES = [
  { maxDistance: 3, score: 4 },
  { maxDistance: 7, score: 3 },
  { maxDistance: 15, score: 2 },
  { maxDistance: 25, score: 1 },
] as const

export const PSYCHIC_SCORE_ZONES = [
  { maxAverageDistance: 5, score: 3 },
  { maxAverageDistance: 10, score: 2 },
  { maxAverageDistance: 18, score: 1 },
] as const

export function clampSpectrumPosition(value: number): number {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 50))
}

export function calculateDistance(target: number, guess: number): number {
  return Math.abs(clampSpectrumPosition(target) - clampSpectrumPosition(guess))
}

export function calculateGuessScore(distance: number): number {
  return GUESS_SCORE_ZONES.find((zone) => distance <= zone.maxDistance)?.score ?? 0
}

export function calculateAverageDistance(distances: number[]): number {
  return distances.length ? distances.reduce((sum, distance) => sum + distance, 0) / distances.length : 0
}

export function calculatePsychicScore(averageDistance: number, guessCount: number): number {
  if (guessCount <= 0) return 0
  return PSYCHIC_SCORE_ZONES.find((zone) => averageDistance <= zone.maxAverageDistance)?.score ?? 0
}

export function listValues<T>(list: FirebaseList<T> | undefined): T[] {
  if (!list) return []
  if (Array.isArray(list)) return list.filter((value) => value != null)
  return Object.keys(list).sort((a, b) => Number(a) - Number(b)).map((key) => list[key])
}

export function nextPsychic(order: string[], currentUid: string, connectedIds: string[]): string | null {
  if (!order.length || !connectedIds.length) return null
  const connected = new Set(connectedIds)
  const start = Math.max(0, order.indexOf(currentUid))
  for (let offset = 1; offset <= order.length; offset += 1) {
    const uid = order[(start + offset) % order.length]
    if (connected.has(uid)) return uid
  }
  return null
}

export function randomTargetPosition(): number {
  const values = new Uint32Array(1)
  crypto.getRandomValues(values)
  return Math.round((values[0] / 0xffffffff) * 1000) / 10
}

export function pickSpectrumTopic(usedTopicIds: Record<string, boolean> = {}): SpectrumTopic {
  let candidates = spectrumTopics.filter((topic) => !usedTopicIds[topic.id])
  if (!candidates.length) candidates = spectrumTopics
  return candidates[Math.floor(Math.random() * candidates.length)]
}

export function rankSpectrumPlayers(
  playerIds: string[],
  scores: Record<string, number>,
  totalDistances: Record<string, number>,
): string[] {
  return [...playerIds].sort((a, b) => (
    (scores[b] ?? 0) - (scores[a] ?? 0)
    || (totalDistances[a] ?? 0) - (totalDistances[b] ?? 0)
  ))
}

export function validateClue(value: string): string {
  const clue = value.trim().replace(/\s+/g, ' ').slice(0, 40)
  if (!clue) throw new Error('ヒントを入力してください。')
  if (/^[\d０-９.,，．％%~〜\s]+$/.test(clue) || /\d|[０-９]/.test(clue)) {
    throw new Error('数字を直接伝えないヒントにしてください。')
  }
  return clue
}
