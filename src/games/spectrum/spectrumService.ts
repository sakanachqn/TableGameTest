import {
  onValue, ref, runTransaction, set, update, type Unsubscribe,
} from 'firebase/database'
import { database } from '../../firebase/config'
import type { Room, SpectrumGameState, SpectrumPhase } from '../../types/game'
import { spectrumTopics } from '../../data/spectrumTopics'
import {
  calculateAverageDistance, calculateDistance, calculateGuessScore, calculatePsychicScore,
  clampSpectrumPosition, listValues, nextPsychic, pickSpectrumTopic, randomTargetPosition, validateClue,
} from './gameLogic'

export interface OwnSpectrumGuess {
  position: number
  locked: boolean
}

function assertHost(room: Room, uid: string): void {
  if (room.meta.hostUid !== uid) throw new Error('ホストだけが進行できます。')
}

export function spectrumGuessers(room: Room): string[] {
  if (!room.spectrum) return []
  return listValues(room.spectrum.psychicOrder)
    .filter((playerUid) => room.players[playerUid]?.connected && playerUid !== room.spectrum?.psychicUid)
}

export async function startSpectrumGame(roomId: string, room: Room, uid: string): Promise<void> {
  assertHost(room, uid)
  const playerIds = Object.entries(room.players)
    .filter(([, player]) => player.connected)
    .sort(([, a], [, b]) => a.joinedAt - b.joinedAt)
    .map(([playerUid]) => playerUid)
  if (playerIds.length < 3) throw new Error('ゲーム開始には3人以上必要です。')
  const roundsPerPlayer = room.meta.spectrumTurnsPerPlayer === 2 ? 2 : 1
  const psychicUid = playerIds[0]
  const topic = pickSpectrumTopic()
  const zeros = Object.fromEntries(playerIds.map((playerUid) => [playerUid, 0]))
  const state: SpectrumGameState = {
    round: 1,
    maxRounds: playerIds.length * roundsPerPlayer,
    roundsPerPlayer,
    psychicUid,
    psychicOrder: playerIds,
    psychicReady: false,
    topic,
    usedTopicIds: { [topic.id]: true },
    scores: zeros,
    totalGuessDistance: zeros,
    guessCounts: zeros,
    lastSettledRound: 0,
  }
  await update(ref(database), {
    [`rooms/${roomId}/meta/phase`]: 'psychicReveal',
    [`rooms/${roomId}/meta/round`]: 1,
    [`rooms/${roomId}/meta/theme`]: '',
    [`rooms/${roomId}/spectrum`]: state,
    [`spectrumPrivate/${roomId}/targets/${psychicUid}/1`]: randomTargetPosition(),
  })
}

export async function acknowledgeSpectrumTarget(roomId: string): Promise<void> {
  await set(ref(database, `rooms/${roomId}/spectrum/psychicReady`), true)
}

export async function setSpectrumPhase(
  roomId: string, room: Room, uid: string, phase: SpectrumPhase,
): Promise<void> {
  assertHost(room, uid)
  await set(ref(database, `rooms/${roomId}/meta/phase`), phase)
}

export async function submitSpectrumClue(roomId: string, clueInput: string): Promise<void> {
  await set(ref(database, `rooms/${roomId}/spectrum/clue`), validateClue(clueInput))
}

export async function lockSpectrumGuess(roomId: string, round: number, uid: string, position: number): Promise<void> {
  const guess = { position: Math.round(clampSpectrumPosition(position) * 10) / 10, locked: true }
  await update(ref(database), {
    [`spectrumPrivate/${roomId}/guesses/${uid}/${round}`]: guess,
    [`rooms/${roomId}/spectrum/guessStatus/${uid}`]: true,
  })
}

export function subscribeSpectrumTarget(
  roomId: string, psychicUid: string, round: number, onTarget: (position: number | null) => void,
): Unsubscribe {
  return onValue(ref(database, `spectrumPrivate/${roomId}/targets/${psychicUid}/${round}`), (snapshot) => {
    onTarget(snapshot.exists() ? snapshot.val() as number : null)
  })
}

export function subscribeOwnSpectrumGuess(
  roomId: string, uid: string, round: number, onGuess: (guess: OwnSpectrumGuess | null) => void,
): Unsubscribe {
  return onValue(ref(database, `spectrumPrivate/${roomId}/guesses/${uid}/${round}`), (snapshot) => {
    onGuess(snapshot.exists() ? snapshot.val() as OwnSpectrumGuess : null)
  })
}

export async function revealSpectrumTarget(roomId: string, position: number): Promise<void> {
  await set(ref(database, `rooms/${roomId}/spectrum/revealedTargetPosition`), position)
}

export async function revealSpectrumGuess(roomId: string, uid: string, position: number): Promise<void> {
  await set(ref(database, `rooms/${roomId}/spectrum/revealedGuesses/${uid}`), position)
}

export async function settleSpectrumRound(roomId: string, room: Room, uid: string): Promise<void> {
  assertHost(room, uid)
  const expectedGuessers = spectrumGuessers(room)
  await runTransaction(ref(database, `rooms/${roomId}/spectrum`), (current: SpectrumGameState | null) => {
    if (!current || current.lastSettledRound >= current.round || current.revealedTargetPosition == null) return
    if (expectedGuessers.some((playerUid) => current.revealedGuesses?.[playerUid] == null)) return
    const target = current.revealedTargetPosition
    const lastRoundScores: Record<string, number> = {}
    const lastRoundDistances: Record<string, number> = {}
    const scores = { ...current.scores }
    const totalGuessDistance = { ...current.totalGuessDistance }
    const guessCounts = { ...current.guessCounts }
    const distances = expectedGuessers.map((playerUid) => {
      const distance = calculateDistance(target, current.revealedGuesses?.[playerUid] ?? target)
      const score = calculateGuessScore(distance)
      lastRoundDistances[playerUid] = distance
      lastRoundScores[playerUid] = score
      scores[playerUid] = (scores[playerUid] ?? 0) + score
      totalGuessDistance[playerUid] = (totalGuessDistance[playerUid] ?? 0) + distance
      guessCounts[playerUid] = (guessCounts[playerUid] ?? 0) + 1
      return distance
    })
    const averageDistance = calculateAverageDistance(distances)
    const psychicScore = calculatePsychicScore(averageDistance, distances.length)
    lastRoundScores[current.psychicUid] = psychicScore
    scores[current.psychicUid] = (scores[current.psychicUid] ?? 0) + psychicScore
    return {
      ...current,
      scores,
      totalGuessDistance,
      guessCounts,
      lastRoundScores,
      lastRoundDistances,
      lastAverageDistance: Math.round(averageDistance * 10) / 10,
      lastSettledRound: current.round,
    }
  }, { applyLocally: false })
}

function nextUsedTopics(state: SpectrumGameState): Record<string, boolean> {
  return Object.keys(state.usedTopicIds ?? {}).length >= spectrumTopics.length ? {} : { ...(state.usedTopicIds ?? {}) }
}

async function prepareSpectrumRound(
  roomId: string, room: Room, nextRound: number, psychicUid: string,
): Promise<void> {
  if (!room.spectrum) throw new Error('ゲーム情報を読み込めませんでした。')
  const usedTopicIds = nextUsedTopics(room.spectrum)
  const topic = pickSpectrumTopic(usedTopicIds)
  usedTopicIds[topic.id] = true
  await update(ref(database), {
    [`rooms/${roomId}/meta/phase`]: 'psychicReveal',
    [`rooms/${roomId}/meta/round`]: nextRound,
    [`rooms/${roomId}/spectrum/round`]: nextRound,
    [`rooms/${roomId}/spectrum/psychicUid`]: psychicUid,
    [`rooms/${roomId}/spectrum/psychicReady`]: false,
    [`rooms/${roomId}/spectrum/topic`]: topic,
    [`rooms/${roomId}/spectrum/usedTopicIds`]: usedTopicIds,
    [`rooms/${roomId}/spectrum/clue`]: null,
    [`rooms/${roomId}/spectrum/guessStatus`]: null,
    [`rooms/${roomId}/spectrum/revealedTargetPosition`]: null,
    [`rooms/${roomId}/spectrum/revealedGuesses`]: null,
    [`rooms/${roomId}/spectrum/lastRoundScores`]: null,
    [`rooms/${roomId}/spectrum/lastRoundDistances`]: null,
    [`rooms/${roomId}/spectrum/lastAverageDistance`]: null,
    [`spectrumPrivate/${roomId}/targets/${psychicUid}/${nextRound}`]: randomTargetPosition(),
  })
}

export async function advanceSpectrumRound(roomId: string, room: Room, uid: string): Promise<void> {
  assertHost(room, uid)
  const state = room.spectrum
  if (!state || state.lastSettledRound < state.round) throw new Error('結果の集計が完了していません。')
  if (state.round >= state.maxRounds) {
    await set(ref(database, `rooms/${roomId}/meta/phase`), 'gameEnd')
    return
  }
  const order = listValues(state.psychicOrder)
  const connectedIds = order.filter((playerUid) => room.players[playerUid]?.connected)
  const psychicUid = nextPsychic(order, state.psychicUid, connectedIds)
  if (!psychicUid) throw new Error('次の出題者が見つかりません。')
  await prepareSpectrumRound(roomId, room, state.round + 1, psychicUid)
}

export async function restartSpectrumRound(roomId: string, room: Room, uid: string): Promise<void> {
  assertHost(room, uid)
  const state = room.spectrum
  if (!state) throw new Error('ゲーム情報を読み込めませんでした。')
  const order = listValues(state.psychicOrder)
  const connectedIds = order.filter((playerUid) => room.players[playerUid]?.connected)
  const psychicUid = nextPsychic(order, state.psychicUid, connectedIds)
  if (!psychicUid) throw new Error('交代できる出題者がいません。')
  await prepareSpectrumRound(roomId, room, state.round, psychicUid)
}
