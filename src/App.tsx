import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown, ArrowUp, Check, ChevronRight, CircleHelp, Copy, DoorOpen, Gauge, LogOut, Play, RotateCcw, Users,
} from 'lucide-react'
import { isFirebaseConfigured } from './firebase/config'
import { useGameRoom } from './hooks/useGameRoom'
import { activePlayerIds, calculateResults, orderedIds } from './game/rules'
import {
  allActiveReady, createRoom, joinRoom, leaveRoom, markReady, normalizeRoomId, revealOwnNumber,
  setPhase, startRound, submitHint, syncOrder,
} from './services/roomService'
import { PlayerList } from './components/PlayerList'
import { SortableOrder } from './components/SortableOrder'
import { AudioControls } from './components/AudioControls'
import type { Room } from './types/game'
import {
  installGlobalButtonSounds, playOrderingStartSound, playResultSound, playTopicSound, startBgm, stopBgm,
} from './services/soundService'

function roomIdFromPath(): string {
  const match = window.location.pathname.match(/^\/room\/([A-Za-z2-9]{4,6})\/?$/)
  return match ? normalizeRoomId(match[1]) : ''
}

function phaseLabel(phase: Room['meta']['phase']): string {
  return { lobby: 'ロビー', reveal: '数字確認', discussion: '相談タイム', ordering: '並べ替え', result: '答え合わせ' }[phase]
}

export default function App() {
  const [pathRoomId] = useState(roomIdFromPath)
  const [joinedRoomId, setJoinedRoomId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [roomInput, setRoomInput] = useState(pathRoomId)
  const [homeMode, setHomeMode] = useState<'choice' | 'create' | 'join'>(pathRoomId ? 'join' : 'choice')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [revealRetry, setRevealRetry] = useState(0)
  const { uid, room, secretNumber, error, setError } = useGameRoom(joinedRoomId)
  const latestRoom = useRef(room)
  const revealPublish = useRef({ key: '', inFlight: false, failures: 0 })
  latestRoom.current = room
  const debug = import.meta.env.DEV && new URLSearchParams(window.location.search).get('debug') === 'true'

  useEffect(() => installGlobalButtonSounds(), [])

  useEffect(() => {
    if (!joinedRoomId) {
      stopBgm()
      return
    }
    startBgm()
    return () => stopBgm()
  }, [joinedRoomId])

  useEffect(() => {
    if (room?.meta.phase === 'ordering') playOrderingStartSound()
  }, [room?.meta.phase, room?.meta.round])

  useEffect(() => {
    if (!joinedRoomId || !room || room.meta.phase !== 'result' || !calculateResults(room)) return
    playResultSound(`${joinedRoomId}:${room.meta.round}`)
  }, [joinedRoomId, room])

  const openRoom = (roomId: string) => {
    window.history.replaceState({}, '', `/room/${roomId}${window.location.search}`)
    setJoinedRoomId(roomId)
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try { await action() } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作に失敗しました。')
    } finally { setBusy(false) }
  }

  useEffect(() => {
    if (!pathRoomId || joinedRoomId || !isFirebaseConfigured) return
    const savedName = sessionStorage.getItem(`kokoro-name-${pathRoomId}`)
    if (!savedName) return
    setName(savedName)
    void run(async () => {
      await joinRoom(pathRoomId, savedName)
      openRoom(pathRoomId)
    })
    // Reconnect only once on the initial path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathRoomId])

  useEffect(() => {
    if (!joinedRoomId || !uid || !room || room.meta.hostUid !== uid || room.meta.phase !== 'reveal') return
    if (allActiveReady(room)) void setPhase(joinedRoomId, 'ordering').catch(() => setError('画面の進行に失敗しました。'))
  }, [joinedRoomId, room, setError, uid])

  useEffect(() => {
    if (!joinedRoomId || !uid || !room || room.meta.phase !== 'result' || secretNumber == null) return
    if (!orderedIds(room.order).includes(uid) || room.reveals?.[uid] === secretNumber) return
    const publishKey = `${joinedRoomId}:${room.meta.round}:${uid}:${secretNumber}`
    if (revealPublish.current.key !== publishKey) {
      revealPublish.current = { key: publishKey, inFlight: false, failures: 0 }
    }
    if (revealPublish.current.inFlight) return
    revealPublish.current.inFlight = true
    void revealOwnNumber(joinedRoomId, uid, secretNumber).catch(() => {
      const latest = latestRoom.current
      if (latest?.meta.phase !== 'result' || latest.reveals?.[uid] === secretNumber) return
      revealPublish.current.inFlight = false
      revealPublish.current.failures += 1
      if (revealPublish.current.failures >= 3) {
        setError('数字の公開に失敗しました。通信状態を確認してください。')
        return
      }
      window.setTimeout(() => setRevealRetry((count) => count + 1), 500)
    })
  }, [joinedRoomId, revealRetry, room, secretNumber, setError, uid])

  if (!joinedRoomId) {
    return (
      <main className="home-shell">
        <div className="home-audio-controls"><AudioControls /></div>
        <div className="brand-mark" aria-hidden="true"><Gauge size={38} /></div>
        <p className="eyebrow">ことばで合わせる、心の目盛り</p>
        <h1>ココロ<span>メーター</span></h1>
        <p className="lead">秘密の数字をことばに変えて。みんなの感覚を、低い順にぴたりと並べよう。</p>

        {!isFirebaseConfigured && (
          <div className="setup-notice" role="status">
            <CircleHelp size={20} /> Firebase設定がまだありません。READMEの手順で <code>.env</code> を用意すると遊べます。
          </div>
        )}
        {error && <div className="error-box" role="alert">{error}</div>}

        {homeMode === 'choice' ? (
          <div className="choice-grid">
            <button className="choice-card coral" onClick={() => setHomeMode('create')}>
              <span className="choice-icon"><DoorOpen /></span><strong>部屋を作る</strong><small>ホストになって友達を招待</small><ChevronRight />
            </button>
            <button className="choice-card yellow" onClick={() => setHomeMode('join')}>
              <span className="choice-icon"><Users /></span><strong>部屋に参加</strong><small>コードを入れて合流</small><ChevronRight />
            </button>
          </div>
        ) : (
          <form className="join-card" onSubmit={(event) => {
            event.preventDefault()
            void run(async () => {
              const id = homeMode === 'create' ? await createRoom(name) : await joinRoom(roomInput, name)
              openRoom(id)
            })
          }}>
            <button className="text-button" type="button" onClick={() => setHomeMode('choice')}>← 戻る</button>
            <h2>{homeMode === 'create' ? '新しい部屋を作る' : '部屋に参加する'}</h2>
            {homeMode === 'join' && (
              <label>Room ID<input value={roomInput} onChange={(event) => setRoomInput(normalizeRoomId(event.target.value))} placeholder="ABCD" autoCapitalize="characters" maxLength={6} /></label>
            )}
            <label>ニックネーム<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例：Alice" maxLength={16} autoFocus={!pathRoomId} /></label>
            <button className="primary-button" disabled={busy || !isFirebaseConfigured} type="submit">
              {busy ? '接続中…' : homeMode === 'create' ? '部屋を作成' : '参加する'}
            </button>
          </form>
        )}
        <section className="howto"><span>1</span> 数字を見る <ArrowDown /><span>2</span> ことばで表す <ArrowDown /><span>3</span> 順番を当てる</section>
        <footer className="sound-credit">効果音素材：OtoLogic</footer>
      </main>
    )
  }

  if (error && !room) return <main className="center-state"><div className="error-box">{error}</div><button className="secondary-button" onClick={() => window.location.assign('/')}>トップへ戻る</button></main>
  if (!uid || !room) return <main className="center-state"><div className="loader" /><p>部屋につないでいます…</p></main>

  const isHost = room.meta.hostUid === uid
  const me = room.players[uid]
  const isActive = Boolean(me && me.eligibleFromRound <= room.meta.round && orderedIds(room.order).includes(uid))
  const hostOffline = !room.players[room.meta.hostUid]?.connected

  return (
    <main className="game-shell">
      <header className="game-header">
        <a className="mini-brand" href="/" aria-label="トップへ"><Gauge /> ココロメーター</a>
        <div className="round-pill">ROUND {Math.max(1, room.meta.round)} · {phaseLabel(room.meta.phase)}</div>
        <div className="header-actions">
          <AudioControls compact />
          <button className="icon-button" aria-label="退出" onClick={() => void run(async () => { await leaveRoom(joinedRoomId, uid); window.location.assign('/') })}><LogOut /></button>
        </div>
      </header>
      {error && <div className="error-box" role="alert">{error}</div>}
      {hostOffline && <div className="warning-box">ホストが退出しました。再接続を待っています。</div>}
      {room.meta.phase !== 'lobby' && !isActive ? (
        <section className="panel waiting-panel"><div className="big-icon"><Users /></div><h2>次のラウンドから参加！</h2><p>いまのゲームを見守りながら、みんなの会話を楽しんでください。</p><PlayerList room={room} currentUid={uid} /></section>
      ) : (
        <GamePhaseView roomId={joinedRoomId} room={room} uid={uid} secretNumber={secretNumber} isHost={isHost} busy={busy} setNotice={setNotice} run={run} />
      )}
      {notice && <div className="toast" role="status" onAnimationEnd={() => setNotice(null)}>{notice}</div>}
      {debug && <aside className="debug-panel">phase: {room.meta.phase}<br />uid: {uid}<br />host: {room.meta.hostUid}<br />room: {joinedRoomId}<br />connected: {me?.connected ? 'yes' : 'no'}</aside>}
    </main>
  )
}

interface GamePhaseViewProps {
  roomId: string
  room: Room
  uid: string
  secretNumber: number | null
  isHost: boolean
  busy: boolean
  setNotice: (message: string) => void
  run: (action: () => Promise<void>) => Promise<void>
}

function GamePhaseView({ roomId, room, uid, secretNumber, isHost, busy, setNotice, run }: GamePhaseViewProps) {
  const activeCount = room.meta.phase === 'lobby'
    ? Object.values(room.players).filter(
      (player) => player.connected && player.eligibleFromRound <= room.meta.round + 1,
    ).length
    : activePlayerIds(room).length
  const ids = orderedIds(room.order)
  const results = useMemo(() => calculateResults(room), [room])
  const copyInvite = async () => {
    const inviteUrl = `${window.location.origin}/room/${roomId}`
    await navigator.clipboard.writeText(inviteUrl)
    setNotice('招待URLをコピーしました')
  }

  if (room.meta.phase === 'lobby') return (
    <section className="panel lobby-panel">
      <p className="eyebrow">YOUR ROOM</p><div className="room-code">{roomId}</div><p>友達にこのコードを教えてください</p>
      <button className="copy-button" onClick={() => void copyInvite()}><Copy size={18} /> 招待URLをコピー</button>
      <div className="section-heading"><h2>参加メンバー</h2><span>{activeCount} / {room.meta.maxPlayers}</span></div>
      <PlayerList room={room} currentUid={uid} />
      {isHost ? <button className="primary-button sticky-action" disabled={busy || activeCount < 3} onClick={() => void run(() => startRound(roomId, room, uid))}><Play size={20} /> {activeCount < 3 ? `あと${3 - activeCount}人でスタート` : 'ゲームスタート'}</button> : <p className="host-wait">ホストがゲームを始めるまでお待ちください</p>}
    </section>
  )

  if (room.meta.phase === 'reveal') {
    return <RoundIntro roomId={roomId} room={room} uid={uid} secretNumber={secretNumber} />
  }

  if (room.meta.phase === 'discussion') return (
    <section className="panel discussion-panel">
      <p className="eyebrow">今回のお題</p><div className="topic-card"><span>THEME</span><h2>{room.meta.theme}</h2></div>
      <div className="secret-reminder"><span>あなたの数字</span><strong>{secretNumber ?? '…'}</strong></div>
      <div className="talk-note"><strong>みんなで相談しよう</strong><p>数字そのものは言わず、お題に沿った言葉で表現してね。</p></div>
      {isHost ? <button className="primary-button sticky-action" disabled={busy} onClick={() => void run(() => setPhase(roomId, 'ordering'))}>並べ替えへ <ChevronRight /></button> : <p className="host-wait">相談できたら、ホストが次へ進めます</p>}
    </section>
  )

  if (room.meta.phase === 'ordering') return (
    <section className="panel order-panel">
      <div className="ordering-heading">
        <div className="ordering-own-number">
          <span>自分の数字</span>
          <strong>{secretNumber ?? '…'}</strong>
        </div>
        <h2>{room.meta.theme}</h2>
      </div>
      <HintComposer roomId={roomId} uid={uid} currentHint={room.players[uid].hint} busy={busy} run={run} />
      <div className="scale-marker scale-high"><span>100に近い</span><strong>高い</strong><ArrowUp /></div>
      <SortableOrder ids={ids} players={room.players} editable={isHost} onChange={(nextIds) => void run(() => syncOrder(roomId, nextIds))} />
      <div className="scale-marker scale-low"><ArrowDown /><strong>低い</strong><span>1に近い</span></div>
      {isHost ? <button className="primary-button sticky-action" disabled={busy} onClick={() => void run(() => setPhase(roomId, 'result'))}>この順番で答え合わせ</button> : <p className="host-wait">ホストが並べ替えています。順番はリアルタイムで変わります。</p>}
    </section>
  )

  return <section className="panel result-panel">
    {!results ? <div className="center-state compact"><div className="loader" /><h2>みんなの数字を集めています…</h2><p>各プレイヤーの画面から安全に答えを公開中です。</p></div> : <>
      <div className={`result-badge ${results.success ? 'success' : 'miss'}`}>{results.success ? 'PERFECT!' : '惜しい！'}</div>
      <h2>{results.success ? 'みんなの感覚がぴったり！' : 'みんなが決めた順番'}</h2><p className="score"><strong>{results.exact}</strong> / {ids.length} 人が正しい位置</p>
      <ol className="answer-list">{results.entries.map((entry, index) => <li key={entry.uid} className={entry.guessedIndex === entry.actualIndex ? 'correct' : ''}><span>{index + 1}</span><strong>{entry.name}</strong><b>{entry.number}</b>{entry.guessedIndex === entry.actualIndex && <Check size={18} />}</li>)}</ol>
      {isHost ? <button className="primary-button sticky-action" disabled={busy} onClick={() => void run(() => startRound(roomId, room, uid))}><RotateCcw /> 次のラウンド</button> : <p className="host-wait">ホストが次のラウンドへ進めます</p>}
    </>}
  </section>
}

function HintComposer({ roomId, uid, currentHint, busy, run }: {
  roomId: string
  uid: string
  currentHint?: string
  busy: boolean
  run: (action: () => Promise<void>) => Promise<void>
}) {
  const [hint, setHint] = useState(currentHint ?? '')

  return <form className="hint-composer" onSubmit={(event) => {
    event.preventDefault()
    void run(() => submitHint(roomId, uid, hint))
  }}>
    <label htmlFor="player-hint">お題に沿ったヒント</label>
    <div>
      <input
        id="player-hint"
        value={hint}
        onChange={(event) => setHint(event.target.value)}
        placeholder="例：百獣の王"
        maxLength={40}
        autoComplete="off"
      />
      <button type="submit" disabled={busy || !hint.trim()}>{currentHint ? '更新' : '送る'}</button>
    </div>
    <small>数字そのものは書かないでね</small>
  </form>
}

function RoundIntro({ roomId, room, uid, secretNumber }: { roomId: string; room: Room; uid: string; secretNumber: number | null }) {
  const ownReady = room.players[uid].ready
  const readyCount = activePlayerIds(room).filter((id) => room.players[id].ready).length
  const activeCount = activePlayerIds(room).length

  useEffect(() => {
    if (secretNumber == null || ownReady) return
    playTopicSound()
    const readyTimer = window.setTimeout(() => {
      void markReady(roomId, uid)
    }, 3200)
    return () => {
      window.clearTimeout(readyTimer)
    }
  }, [ownReady, roomId, secretNumber, uid])

  return <section className="panel reveal-panel round-intro">
    <div className="intro-progress" aria-hidden="true"><i /></div>
    <div className="intro-scene combined-intro">
      <p className="eyebrow">今回のお題</p>
      <h2 className="intro-theme">{room.meta.theme}</h2>
      <div className="combined-number">
        <span>あなたの数字</span>
        <strong>{secretNumber ?? '…'}</strong>
        <small>数字そのものは言わないでね</small>
      </div>
      <p className="intro-wait">{ownReady ? <><Check size={18} /> みんなの準備を待っています（{readyCount}/{activeCount}）</> : 'まもなく並び替えへ進みます'}</p>
    </div>
  </section>
}
