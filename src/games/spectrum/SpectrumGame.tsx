import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import {
  Check, Copy, Crown, Eye, LockKeyhole, Play, RotateCcw, Sparkles, Target, Users,
} from 'lucide-react'
import { PlayerList } from '../../components/PlayerList'
import { playOrderingStartSound, playResultSound, playTopicSound } from '../../services/soundService'
import type { Room, SpectrumTopic } from '../../types/game'
import {
  acknowledgeSpectrumTarget, advanceSpectrumRound, lockSpectrumGuess, restartSpectrumRound,
  revealSpectrumGuess, revealSpectrumTarget, setSpectrumPhase, settleSpectrumRound,
  spectrumGuessers, startSpectrumGame, submitSpectrumClue, subscribeOwnSpectrumGuess,
  subscribeSpectrumTarget, type OwnSpectrumGuess,
} from './spectrumService'
import { clampSpectrumPosition, listValues, rankSpectrumPlayers } from './gameLogic'

interface SpectrumGameProps {
  roomId: string
  room: Room
  uid: string
  isHost: boolean
  busy: boolean
  debug: boolean
  setNotice: (message: string) => void
  run: (action: () => Promise<void>) => Promise<void>
}

function TopicHeading({ topic }: { topic: SpectrumTopic }) {
  return <div className="spectrum-topic">
    <span>{topic.leftLabel}</span><i>↔</i><span>{topic.rightLabel}</span>
  </div>
}

function SpectrumBar({
  topic, value, interactive = false, locked = false, target, guesses, onChange,
}: {
  topic: SpectrumTopic
  value?: number
  interactive?: boolean
  locked?: boolean
  target?: number
  guesses?: Array<{ uid: string; name: string; position: number }>
  onChange?: (value: number) => void
}) {
  const barRef = useRef<HTMLDivElement>(null)
  const updateFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!interactive || locked || !barRef.current) return
    const bounds = barRef.current.getBoundingClientRect()
    onChange?.(clampSpectrumPosition(((event.clientX - bounds.left) / bounds.width) * 100))
  }
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!interactive || locked) return
    event.currentTarget.setPointerCapture(event.pointerId)
    updateFromPointer(event)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive || locked || value == null) return
    const step = event.shiftKey ? 5 : 1
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault()
      onChange?.(clampSpectrumPosition(value - step))
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault()
      onChange?.(clampSpectrumPosition(value + step))
    }
  }

  return <div className={`spectrum-meter ${interactive ? 'interactive' : ''} ${locked ? 'locked' : ''}`}>
    <div className="spectrum-end-labels"><strong>{topic.leftLabel}</strong><strong>{topic.rightLabel}</strong></div>
    <div className="spectrum-track-wrap">
      <div
        ref={barRef}
        className="spectrum-track"
        role={interactive ? 'slider' : undefined}
        aria-label={interactive ? '予想位置' : undefined}
        aria-valuemin={interactive ? 0 : undefined}
        aria-valuemax={interactive ? 100 : undefined}
        aria-valuenow={interactive ? Math.round(value ?? 50) : undefined}
        tabIndex={interactive && !locked ? 0 : -1}
        onPointerDown={onPointerDown}
        onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event) }}
        onKeyDown={onKeyDown}
      >
        <div className="spectrum-gradient" />
        {target != null && <div className="target-marker" style={{ left: `${target}%` }}><Target /><span>TARGET</span></div>}
        {value != null && <div className="guess-marker own" style={{ left: `${value}%` }}><i /><span>{locked ? 'LOCKED' : 'YOU'}</span></div>}
        {guesses?.map((guess, index) => <div
          className="guess-marker revealed"
          key={guess.uid}
          style={{ left: `${guess.position}%`, '--marker-row': index % 3 } as React.CSSProperties}
          title={`${guess.name}: ${Math.round(guess.position)}`}
        ><i>{guess.name.slice(0, 1).toUpperCase()}</i><span>{guess.name}</span></div>)}
      </div>
    </div>
  </div>
}

function AnswerStatus({ room }: { room: Room }) {
  const state = room.spectrum
  if (!state) return null
  return <div className="answer-status-list">
    {listValues(state.psychicOrder).filter((playerUid) => room.players[playerUid]?.connected).map((playerUid) => {
      const isPsychic = playerUid === state.psychicUid
      const answered = Boolean(state.guessStatus?.[playerUid])
      return <div key={playerUid} className={answered ? 'done' : ''}>
        <span className="avatar small">{room.players[playerUid]?.name.slice(0, 1).toUpperCase()}</span>
        <strong>{room.players[playerUid]?.name}</strong>
        <small>{isPsychic ? <><Crown size={14} /> 出題者</> : answered ? <><Check size={14} /> 回答済み</> : '考え中'}</small>
      </div>
    })}
  </div>
}

export function SpectrumGame({ roomId, room, uid, isHost, busy, debug, setNotice, run }: SpectrumGameProps) {
  const state = room.spectrum
  const [target, setTarget] = useState<number | null>(null)
  const [ownGuess, setOwnGuess] = useState<OwnSpectrumGuess | null>(null)
  const [guessPosition, setGuessPosition] = useState(50)
  const [clue, setClue] = useState('')
  const phase = room.meta.phase
  const isPsychic = state?.psychicUid === uid
  const psychicOffline = Boolean(state && !room.players[state.psychicUid]?.connected)

  useEffect(() => {
    if (!state || !isPsychic) {
      setTarget(null)
      return
    }
    return subscribeSpectrumTarget(roomId, uid, state.round, setTarget)
  }, [isPsychic, roomId, state, uid])

  useEffect(() => {
    if (!state || isPsychic) {
      setOwnGuess(null)
      setGuessPosition(50)
      return
    }
    return subscribeOwnSpectrumGuess(roomId, uid, state.round, (guess) => {
      setOwnGuess(guess)
      setGuessPosition(guess?.position ?? 50)
    })
  }, [isPsychic, roomId, state, uid])

  useEffect(() => {
    if (phase === 'psychicReveal') playTopicSound()
    if (phase === 'guessing') playOrderingStartSound()
    if (phase === 'result' && state && state.lastSettledRound === state.round) {
      playResultSound(`spectrum:${roomId}:${state.round}`)
    }
  }, [phase, roomId, state])

  useEffect(() => {
    if (!isHost || !state || psychicOffline) return
    if (phase === 'psychicReveal' && state.psychicReady) {
      void setSpectrumPhase(roomId, room, uid, 'clue')
    } else if (phase === 'clue' && state.clue) {
      void setSpectrumPhase(roomId, room, uid, 'guessing')
    } else if (phase === 'guessing') {
      const guessers = spectrumGuessers(room)
      if (guessers.length > 0 && guessers.every((playerUid) => state.guessStatus?.[playerUid])) {
        void setSpectrumPhase(roomId, room, uid, 'result')
      }
    } else if (phase === 'result' && state.revealedTargetPosition != null) {
      const guessers = spectrumGuessers(room)
      if (guessers.every((playerUid) => state.revealedGuesses?.[playerUid] != null)) {
        void settleSpectrumRound(roomId, room, uid)
      }
    }
  }, [isHost, phase, psychicOffline, room, roomId, state, uid])

  useEffect(() => {
    if (!state || phase !== 'result') return
    if (isPsychic && target != null && state.revealedTargetPosition !== target) {
      void revealSpectrumTarget(roomId, target)
    }
    if (!isPsychic && ownGuess?.locked && state.revealedGuesses?.[uid] !== ownGuess.position) {
      void revealSpectrumGuess(roomId, uid, ownGuess.position)
    }
  }, [isPsychic, ownGuess, phase, roomId, state, target, uid])

  if (phase === 'lobby') {
    const count = Object.values(room.players).filter((player) => player.connected && player.eligibleFromRound <= 1).length
    const copyInvite = async () => {
      await navigator.clipboard.writeText(`${window.location.origin}/room/${roomId}`)
      setNotice('招待URLをコピーしました')
    }
    return <section className="panel lobby-panel spectrum-panel">
      <p className="eyebrow">フィーリングレンジ · 個人戦</p>
      <div className="room-code">{roomId}</div><p>友達にこのコードを教えてください</p>
      <button className="copy-button" onClick={() => void copyInvite()}><Copy size={18} /> 招待URLをコピー</button>
      <div className="mode-summary"><Target /><span>両端のことばを手がかりに、秘密の位置を当てよう</span><b>1人{room.meta.spectrumTurnsPerPlayer === 2 ? 2 : 1}回出題</b></div>
      <div className="section-heading"><h2>参加メンバー</h2><span>{count} / {room.meta.maxPlayers}</span></div>
      <PlayerList room={room} currentUid={uid} />
      {isHost ? <button className="primary-button sticky-action" disabled={busy || count < 3} onClick={() => void run(() => startSpectrumGame(roomId, room, uid))}><Play size={20} /> {count < 3 ? `あと${3 - count}人でスタート` : 'ゲームスタート'}</button> : <p className="host-wait">ホストがゲームを始めるまでお待ちください</p>}
    </section>
  }

  if (!state) return <section className="panel spectrum-panel"><div className="loader" /><p>ゲーム情報を読み込んでいます…</p></section>

  const waitingPlayer = !listValues(state.psychicOrder).includes(uid)
  if (waitingPlayer) return <section className="panel waiting-panel"><div className="big-icon"><Users /></div><h2>次のゲームから参加</h2><p>このゲームは開始済みです。みんなのプレイを見守ってください。</p><PlayerList room={room} currentUid={uid} /></section>

  const psychicName = room.players[state.psychicUid]?.name ?? '出題者'
  const disconnectedNotice = psychicOffline && phase !== 'gameEnd'
    && !(phase === 'result' && state.revealedTargetPosition != null)

  if (disconnectedNotice) return <section className="panel spectrum-panel disconnected-round">
    <div className="big-icon"><Users /></div><h2>出題者が退出しました</h2><p>このラウンドは採点せず、接続中の次の人へ交代できます。</p>
    {isHost ? <button className="primary-button" disabled={busy} onClick={() => void run(() => restartSpectrumRound(roomId, room, uid))}><RotateCcw /> 出題者を交代してやり直す</button> : <p className="host-wait">ホストがラウンドを再開します</p>}
  </section>

  if (phase === 'psychicReveal') return <section className="panel spectrum-panel reveal-spectrum">
    <p className="eyebrow">ROUND {state.round} / {state.maxRounds}</p>
    {isPsychic ? <>
      <div className="psychic-badge"><Eye /> あなたが今回の出題者</div>
      <h2>秘密のターゲットを確認</h2>
      <SpectrumBar topic={state.topic} target={target ?? undefined} />
      <div className="target-number"><small>秘密の位置</small><strong>{target == null ? '…' : Math.round(target)}</strong><span>この位置をことばで伝えよう</span></div>
      <button className="primary-button sticky-action" disabled={busy || target == null || state.psychicReady} onClick={() => void run(() => acknowledgeSpectrumTarget(roomId))}>{state.psychicReady ? '確認しました' : 'ヒントを考える'} <Sparkles /></button>
    </> : <>
      <div className="psychic-badge neutral"><Crown /> 今回の出題者は {psychicName}</div>
      <h2>秘密の位置を確認中…</h2>
      <TopicHeading topic={state.topic} />
      <div className="hidden-target"><LockKeyhole /><p>ターゲットは出題者だけに見えています</p></div>
    </>}
  </section>

  if (phase === 'clue') return <section className="panel spectrum-panel clue-panel">
    <p className="eyebrow">{psychicName} のヒント</p><TopicHeading topic={state.topic} />
    {isPsychic ? <>
      <SpectrumBar topic={state.topic} target={target ?? undefined} />
      <form className="spectrum-clue-form" onSubmit={(event) => {
        event.preventDefault()
        void run(() => submitSpectrumClue(roomId, clue))
      }}>
        <label htmlFor="spectrum-clue">この位置を表すヒント</label>
        <input id="spectrum-clue" value={clue} onChange={(event) => setClue(event.target.value)} placeholder="例：夜中の学校" maxLength={40} autoFocus />
        <small>数字や「70くらい」のような表現は使わないでね</small>
        <button className="primary-button" disabled={busy || !clue.trim()} type="submit">ヒントを公開 <Sparkles /></button>
      </form>
    </> : <div className="hidden-target"><Sparkles /><h2>ヒントを考えています</h2><p>どんなことばが出てくるかな？</p></div>}
  </section>

  if (phase === 'guessing') return <section className="panel spectrum-panel guessing-panel">
    <p className="eyebrow">{psychicName} からのヒント</p>
    <h2 className="published-clue">「{state.clue}」</h2>
    {isPsychic ? <>
      <TopicHeading topic={state.topic} />
      <div className="psychic-wait"><Eye /><strong>みんなの予想を待っています</strong><p>予想位置は結果発表まで見えません。</p></div>
    </> : <>
      <SpectrumBar topic={state.topic} value={guessPosition} interactive locked={ownGuess?.locked} onChange={setGuessPosition} />
      <p className="meter-help">バーをタップまたはドラッグして、ヒントから連想する位置を決めよう</p>
      <button className="primary-button sticky-action" disabled={busy || ownGuess?.locked} onClick={() => void run(() => lockSpectrumGuess(roomId, state.round, uid, guessPosition))}>{ownGuess?.locked ? <><Check /> 回答済み</> : <><Target /> この位置で決定</>}</button>
    </>}
    <AnswerStatus room={room} />
  </section>

  if (phase === 'result') {
    const settled = state.lastSettledRound === state.round
    const resultIds = Object.keys(state.lastRoundDistances ?? {})
    const revealed = resultIds.map((playerUid) => ({
      uid: playerUid,
      name: room.players[playerUid]?.name ?? '退出したプレイヤー',
      position: state.revealedGuesses?.[playerUid] ?? 0,
    }))
    const roundRanking = [...resultIds].sort((a, b) => (
      (state.lastRoundScores?.[b] ?? 0) - (state.lastRoundScores?.[a] ?? 0)
      || (state.lastRoundDistances?.[a] ?? 0) - (state.lastRoundDistances?.[b] ?? 0)
    ))
    return <section className="panel spectrum-panel spectrum-result">
      <p className="eyebrow">ROUND {state.round} RESULT</p><h2>答えはここ！</h2>
      {state.revealedTargetPosition != null
        ? <SpectrumBar topic={state.topic} target={state.revealedTargetPosition} guesses={revealed} />
        : <div className="center-state compact"><div className="loader" /><p>秘密の位置を公開しています…</p></div>}
      {!settled ? <div className="settling"><div className="loader" /><p>みんなの回答を安全に集計しています…</p></div> : <>
        <div className="psychic-bonus"><Crown /><span><b>{psychicName}</b> 出題者ボーナス</span><strong>+{state.lastRoundScores?.[state.psychicUid] ?? 0} pt</strong><small>平均距離 {state.lastAverageDistance?.toFixed(1)}</small></div>
        <ol className="spectrum-round-ranking">{roundRanking.map((playerUid, index) => <li key={playerUid}>
          <span>{index + 1}</span><div><strong>{room.players[playerUid]?.name ?? '退出したプレイヤー'}</strong><small>予想 {Math.round(state.revealedGuesses?.[playerUid] ?? 0)} · 距離 {state.lastRoundDistances?.[playerUid]?.toFixed(1)}</small></div><b>+{state.lastRoundScores?.[playerUid] ?? 0} pt</b>
        </li>)}</ol>
        {isHost ? <button className="primary-button sticky-action" disabled={busy} onClick={() => void run(() => advanceSpectrumRound(roomId, room, uid))}>{state.round >= state.maxRounds ? '最終ランキングへ' : '次のラウンド'} <RotateCcw /></button> : <p className="host-wait">ホストが次へ進めます</p>}
      </>}
    </section>
  }

  const playerIds = listValues(state.psychicOrder)
  const ranking = rankSpectrumPlayers(playerIds, state.scores, state.totalGuessDistance)
  return <section className="panel spectrum-panel final-ranking">
    <div className="result-badge success">FINAL RESULT</div><h2>フィーリング王は誰だ？</h2>
    <ol>{ranking.map((playerUid, index) => <li key={playerUid} className={index === 0 ? 'winner' : ''}>
      <span>{index + 1}</span><div className="avatar">{room.players[playerUid]?.name.slice(0, 1).toUpperCase()}</div><strong>{room.players[playerUid]?.name ?? '退出したプレイヤー'}</strong><b>{state.scores[playerUid] ?? 0} pt</b>
    </li>)}</ol>
    {isHost ? <button className="primary-button sticky-action" disabled={busy} onClick={() => void run(() => startSpectrumGame(roomId, room, uid))}><RotateCcw /> もう一度遊ぶ</button> : <p className="host-wait">ホストが次のゲームを準備します</p>}
    {debug && <div className="spectrum-debug">round {state.round}/{state.maxRounds} · psychic {state.psychicUid} · own target {target ?? '-'} · own guess {ownGuess?.position ?? '-'} · settled {state.lastSettledRound}</div>}
  </section>
}
