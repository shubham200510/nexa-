import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Bell, Check, ChevronRight, CircleHelp, Copy, Gamepad2,
  Headphones, Home, LogOut, Menu, Plus, Search, Settings, Shield, Sparkles,
  Swords, Trophy, UserRound, Users, Wifi, X, Zap
} from 'lucide-react';
import { isSupabaseConfigured, Room, supabase } from './lib/supabase';

type Tab = 'home' | 'games' | 'friends' | 'profile';
type User = { id: string; email?: string; user_metadata?: { username?: string } };
type LocalRoom = { id: string; code: string; board: (string | null)[]; turn: 'X' | 'O'; status: 'waiting' | 'playing' | 'finished'; winner: 'X' | 'O' | 'draw' | null };

const wins = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const emptyBoard = () => Array(9).fill(null) as (string | null)[];
const makeCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const getWinner = (b: (string | null)[]) => {
  for (const [a,c,d] of wins) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a]!;
  return b.every(Boolean) ? 'draw' : null;
};

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<Tab>('home');
  const [authMode, setAuthMode] = useState<'login'|'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [room, setRoom] = useState<Room | LocalRoom | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [localRooms, setLocalRooms] = useState<Record<string, LocalRoom>>(() => {
    try { return JSON.parse(localStorage.getItem('nexplay_rooms') || '{}'); } catch { return {}; }
  });
  const [localName, setLocalName] = useState(() => localStorage.getItem('nexplay_name') || 'Player One');

  const displayName = user?.user_metadata?.username || user?.email?.split('@')[0] || localName;
  const isLocalRoom = (r: Room | LocalRoom): r is LocalRoom => 'turn' in r;

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user as User || null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user as User || null));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!room || isLocalRoom(room) || !supabase) return;
    const channel = supabase.channel('room-' + room.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_rooms', filter: 'id=eq.' + room.id }, payload => {
        if (payload.new && Object.keys(payload.new).length) setRoom(payload.new as Room);
      }).subscribe();
    return () => { supabase?.removeChannel(channel); };
  }, [room?.id]);

  useEffect(() => {
    localStorage.setItem('nexplay_rooms', JSON.stringify(localRooms));
  }, [localRooms]);

  const stats = useMemo(() => ({ played: Object.keys(localRooms).length, level: 1 }), [localRooms]);

  async function authenticate(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) { setNotice('Add Supabase credentials to .env.local to enable real accounts. Demo mode is ready below.'); return; }
    setAuthBusy(true); setNotice('');
    const result = authMode === 'signup'
      ? await supabase.auth.signUp({ email, password, options: { data: { username: username.trim() || email.split('@')[0] } } })
      : await supabase.auth.signInWithPassword({ email, password });
    setAuthBusy(false);
    if (result.error) setNotice(result.error.message);
    else if (authMode === 'signup' && !result.data.session) setNotice('Check your email to confirm your account, then sign in.');
    else setNotice('You are signed in.');
  }

  async function createRoom() {
    setBusy(true); setNotice('');
    if (supabase && user) {
      const { data, error } = await supabase.rpc('create_room', { p_game: 'tic_tac_toe' }).single();
      if (error) setNotice(error.message); else setRoom(data as Room);
    } else {
      const code = makeCode();
      const next: LocalRoom = { id: crypto.randomUUID(), code, board: emptyBoard(), turn: 'X', status: 'waiting', winner: null };
      setLocalRooms(old => ({ ...old, [code]: next }));
      setRoom(next);
    }
    setBusy(false);
  }

  async function joinRoom() {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6) { setNotice('Enter a 6-character room code.'); return; }
    setBusy(true); setNotice('');
    if (supabase && user) {
      const { data, error } = await supabase.rpc('join_room', { p_code: code }).single();
      if (error) setNotice(error.message); else setRoom(data as Room);
    } else {
      const found = localRooms[code];
      if (!found) setNotice('Demo rooms only exist in this browser. Configure Supabase for cross-device rooms.');
      else {
        const next = { ...found, status: 'playing' as const };
        setLocalRooms(old => ({ ...old, [code]: next })); setRoom(next);
      }
    }
    setBusy(false);
  }

  async function playCell(index: number) {
    if (!room || room.status !== 'playing') return;
    if (isLocalRoom(room)) {
      if (room.board[index] || room.winner) return;
      const board = [...room.board]; board[index] = room.turn;
      const winner = getWinner(board) as LocalRoom['winner'];
      const next: LocalRoom = { ...room, board, turn: room.turn === 'X' ? 'O' : 'X', winner, status: winner ? 'finished' : 'playing' };
      setRoom(next); setLocalRooms(old => ({ ...old, [room.code]: next }));
    } else {
      if (!supabase) return;
      const { data, error } = await supabase.rpc('play_ttt_move', { p_room_id: room.id, p_cell: index }).single();
      if (error) setNotice(error.message); else setRoom(data as Room);
    }
  }

  async function rematch() {
    if (!room) return;
    if (isLocalRoom(room)) {
      const next = { ...room, board: emptyBoard(), turn: 'X' as const, winner: null, status: 'playing' as const };
      setRoom(next); setLocalRooms(old => ({ ...old, [room.code]: next }));
    } else setNotice('Create a new room to start another match.');
  }

  async function signOut() {
    await supabase?.auth.signOut(); setUser(null); setRoom(null); setTab('home');
  }

  const gameRoom = room;
  const roomBoard = gameRoom ? gameRoom.board : emptyBoard();
  const roomCode = gameRoom?.code || '';
  const roomTurn = gameRoom ? (isLocalRoom(gameRoom) ? gameRoom.turn : gameRoom.current_turn === gameRoom.host_id ? 'X' : 'O') : 'X';
  const roomWinner = gameRoom ? (isLocalRoom(gameRoom) ? gameRoom.winner : gameRoom.winner ? (gameRoom.winner === gameRoom.host_id ? 'X' : 'O') : null) : null;

  if (!user && isSupabaseConfigured && tab === 'profile') {
    return <AuthScreen email={email} setEmail={setEmail} password={password} setPassword={setPassword} username={username} setUsername={setUsername} mode={authMode} setMode={setAuthMode} busy={authBusy} notice={notice} onSubmit={authenticate} onBack={() => setTab('home')} />;
  }

  return (
    <div className="app-shell">
      <aside className={'sidebar ' + (mobileMenu ? 'sidebar-open' : '')}>
        <div className="brand"><div className="brand-mark"><Zap size={21} fill="currentColor" /></div><span>NEX<span className="brand-accent">PLAY</span></span><button className="icon-btn mobile-close" onClick={() => setMobileMenu(false)}><X size={18}/></button></div>
        <div className="sidebar-label">MENU</div>
        <nav className="nav-list">
          <NavButton active={tab==='home'} icon={<Home size={18}/>} label="Discover" onClick={() => {setTab('home');setMobileMenu(false);}} />
          <NavButton active={tab==='games'} icon={<Gamepad2 size={18}/>} label="Games" onClick={() => {setTab('games');setMobileMenu(false);}} />
          <NavButton active={tab==='friends'} icon={<Users size={18}/>} label="Friends" onClick={() => {setTab('friends');setMobileMenu(false);}} />
          <NavButton active={tab==='profile'} icon={<UserRound size={18}/>} label="My profile" onClick={() => {setTab('profile');setMobileMenu(false);}} />
        </nav>
        <div className="sidebar-spacer"/>
        <div className="sidebar-promo"><div className="promo-icon"><Sparkles size={18}/></div><strong>Play is better together.</strong><p>Bring your crew. Make a moment.</p><button onClick={createRoom}>Start a room <ArrowRight size={14}/></button></div>
        <div className="sidebar-user"><div className="avatar">{displayName.slice(0,1).toUpperCase()}</div><div className="user-meta"><strong>{displayName}</strong><span>{user ? 'Player account' : 'Guest player'}</span></div><button className="icon-btn" title={user?'Sign out':'Account'} onClick={() => user ? signOut() : setTab('profile')}>{user?<LogOut size={17}/>:<Settings size={17}/>}</button></div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="icon-btn menu-trigger" onClick={() => setMobileMenu(true)}><Menu size={20}/></button>
          <div className="breadcrumb"><span>Workspace</span><ChevronRight size={14}/><strong>{tab==='home'?'Discover':tab==='games'?'Game library':tab==='friends'?'Friends':'My profile'}</strong></div>
          <div className="top-actions"><div className="live-pill"><span className="live-dot"/> {isSupabaseConfigured?'CONNECTED':'DEMO MODE'}</div><button className="icon-btn notification-btn"><Bell size={18}/><i/></button><div className="avatar small">{displayName.slice(0,1).toUpperCase()}</div></div>
        </header>

        <div className="content">
          {gameRoom ? (
            <section className="game-view">
              <button className="back-link" onClick={() => setRoom(null)}><ArrowLeft size={16}/> Back to discover</button>
              <div className="game-heading"><div><div className="eyebrow">PRIVATE MATCH · TIC-TAC-TOE</div><h1>Make your move.</h1><p>Room <b>{roomCode}</b> · Share this code with a friend</p></div><button className="outline-btn" onClick={() => navigator.clipboard?.writeText(roomCode)}><Copy size={15}/> Copy code</button></div>
              <div className="game-layout">
                <div className="game-card">
                  <div className="game-card-top"><span className="game-status"><span className="live-dot"/>{gameRoom.status==='waiting'?'WAITING FOR PLAYER':gameRoom.status==='finished'?'MATCH COMPLETE':'LIVE MATCH'}</span><span className="round-tag">ROUND 01</span></div>
                  {gameRoom.status==='waiting' ? <div className="waiting-state"><div className="waiting-orbit"><Users size={34}/></div><h2>Your room is ready.</h2><p>Send the room code to a friend. The match starts when they join.</p><div className="room-code-large">{roomCode.split('').map((c,i)=><span key={i}>{c}</span>)}</div><button className="primary-btn" onClick={() => navigator.clipboard?.writeText(roomCode)}><Copy size={16}/> Copy invite code</button></div> : <>
                    <div className="score-strip"><div className={'player-chip '+(roomTurn==='X'&&!roomWinner?'active':'')}><div className="player-symbol x-symbol">×</div><div><strong>You / Player X</strong><span>{roomTurn==='X'&&!roomWinner?'YOUR TURN':'PLAYER ONE'}</span></div></div><div className="vs">VS</div><div className={'player-chip '+(roomTurn==='O'&&!roomWinner?'active':'')}><div className="player-symbol o-symbol">○</div><div><strong>Opponent / Player O</strong><span>{roomTurn==='O'&&!roomWinner?'THEIR TURN':'PLAYER TWO'}</span></div></div></div>
                    <div className="turn-label">{roomWinner ? (roomWinner==='draw'?'IT’S A DRAW':roomWinner==='X'?'PLAYER X WINS':'PLAYER O WINS') : 'CURRENT TURN · '+roomTurn}</div>
                    <div className="board">{roomBoard.map((cell,i)=><button key={i} className={'cell '+(cell==='X'?'cell-x':cell==='O'?'cell-o':'')} onClick={() => playCell(i)} disabled={Boolean(cell)||Boolean(roomWinner)}>{cell==='X'?'×':cell==='O'?'○':''}</button>)}</div>
                    {roomWinner && <button className="primary-btn rematch-btn" onClick={rematch}><Swords size={16}/> Play again</button>}
                    </>}
                </div>
                <div className="game-side"><div className="side-panel"><div className="panel-title"><Shield size={16}/> MATCH DETAILS</div><div className="detail-row"><span>Game</span><strong>Tic-Tac-Toe</strong></div><div className="detail-row"><span>Players</span><strong>{gameRoom.status==='waiting'?'1 / 2':'2 / 2'}</strong></div><div className="detail-row"><span>Room type</span><strong>Private</strong></div><div className="detail-row"><span>Network</span><strong>{isLocalRoom(gameRoom)?'Local demo':'Realtime'}</strong></div></div><div className="side-panel tip-panel"><div className="panel-title"><CircleHelp size={16}/> HOW TO PLAY</div><p>Take turns placing your mark. First to connect three symbols horizontally, vertically or diagonally wins.</p></div></div>
              </div>
            </section>
          ) : tab==='profile' ? (
            <section><div className="page-heading"><div><div className="eyebrow">PLAYER IDENTITY</div><h1>Your profile.</h1><p>Your games, your stats, your story.</p></div></div><div className="profile-card"><div className="profile-avatar">{displayName.slice(0,1).toUpperCase()}</div><h2>{displayName}</h2><p>{user?.email || 'Guest account · Local demo'}</p><div className="profile-stats"><div><strong>{stats.played}</strong><span>ROOMS CREATED</span></div><div><strong>01</strong><span>PLAYER LEVEL</span></div><div><strong>0</strong><span>WINS</span></div></div>{!user && isSupabaseConfigured && <button className="primary-btn" onClick={() => setTab('profile')}>Sign in / Create account</button>}{user && <button className="outline-btn" onClick={signOut}><LogOut size={15}/> Sign out</button>}</div></section>
          ) : tab==='friends' ? (
            <section><div className="page-heading"><div><div className="eyebrow">YOUR CREW</div><h1>Friends.</h1><p>Your next match is better with company.</p></div></div><div className="empty-card"><div className="empty-icon"><Users size={26}/></div><h2>Your crew starts here.</h2><p>Friend search and requests are the next social module. For now, invite someone into a private room using its six-character code.</p><button className="primary-btn" onClick={createRoom}><Plus size={16}/> Create an invite room</button></div></section>
          ) : (
            <section>
              <div className="hero">
                <div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line"/> THE SOCIAL PLAYGROUND</div><h1>Find your people.<br/><span>Start a game.</span></h1><p>Less scrolling. More playing. Bring your friends together for quick games, good energy and a little friendly competition.</p><div className="hero-actions"><button className="primary-btn" onClick={createRoom} disabled={busy}><Zap size={17} fill="currentColor"/>{busy?'Creating...':'Create a room'}</button><button className="outline-btn" onClick={() => setShowJoin(v=>!v)}><Users size={17}/> Join with code</button></div>{showJoin && <div className="join-box"><input value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase().slice(0,6))} placeholder="ENTER CODE" maxLength={6}/><button onClick={joinRoom} disabled={busy}><ArrowRight size={17}/></button></div>}{notice && <div className="notice">{notice}</div>}<div className="hero-foot"><div className="avatar-stack"><span>J</span><span>A</span><span>M</span><span>+</span></div><div><strong>Good games. Better company.</strong><small>Made for playing together.</small></div></div></div>
                <div className="hero-art"><div className="art-glow"/><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="float-card card-top"><span className="mini-icon purple"><Gamepad2 size={17}/></span><div><b>Quick match</b><small>Ready when you are</small></div><span className="green-dot"/></div><div className="game-emblem"><div className="emblem-grid"><span>×</span><span>○</span><span>×</span><span>○</span><span>✦</span><span>×</span><span>○</span><span>×</span><span>○</span></div></div><div className="float-card card-bottom"><span className="mini-icon blue"><Trophy size={17}/></span><div><b>Friendly rivalry</b><small>One more round?</small></div><span className="sparkle">✦</span></div><div className="art-caption">PLAY · CONNECT · REPEAT</div></div>
              </div>
              <div className="section-head"><div><div className="eyebrow">PICK YOUR PLAY</div><h2>Small games. Big energy.</h2></div><button className="text-btn" onClick={()=>setTab('games')}>Explore games <ArrowRight size={15}/></button></div>
              <div className="game-grid">
                <GameTile number="01" title="Tic-Tac-Toe" desc="A classic. A little more competitive." tag="2 PLAYERS" color="violet" icon={<Swords size={23}/>} onClick={createRoom}/>
                <GameTile number="02" title="Reaction Duel" desc="Fast hands. Faster bragging rights." tag="COMING NEXT" color="cyan" icon={<Zap size={23}/>} onClick={()=>setNotice('Reaction Duel is planned for the next game release.')}/>
                <GameTile number="03" title="Word Battle" desc="Think quick. Find the right words." tag="COMING NEXT" color="pink" icon={<Sparkles size={23}/>} onClick={()=>setNotice('Word Battle is planned for the next game release.')}/>
              </div>
              <div className="bottom-banner"><div className="banner-icon"><Headphones size={20}/></div><div><strong>Good games are better shared.</strong><span>Invite a friend and make your first room.</span></div><button className="outline-btn" onClick={createRoom}>Start playing <ArrowRight size={15}/></button></div>
            </section>
          )}
          <footer><span>© 2026 NEXPLAY</span><span>BUILT FOR THE IN-BETWEEN MOMENTS</span><span className="footer-status"><span className="live-dot"/> SYSTEM ONLINE</span></footer>
        </div>
      </main>
    </div>
  );
}

function NavButton({active,icon,label,onClick}:{active:boolean;icon:React.ReactNode;label:string;onClick:()=>void}) {
  return <button className={'nav-button '+(active?'active':'')} onClick={onClick}>{icon}<span>{label}</span>{active&&<i/>}</button>;
}
function GameTile({number,title,desc,tag,color,icon,onClick}:{number:string;title:string;desc:string;tag:string;color:string;icon:React.ReactNode;onClick:()=>void}) {
  return <button className={'game-tile '+color} onClick={onClick}><div className="tile-top"><span>{number} / GAME</span><span className="tile-arrow"><ArrowUpRightIcon/></span></div><div className="tile-icon">{icon}</div><div className="tile-copy"><h3>{title}</h3><p>{desc}</p></div><div className="tile-bottom"><span>{tag}</span><ChevronRight size={16}/></div></button>;
}
function ArrowUpRightIcon(){return <ArrowRight size={16}/>;}
function AuthScreen({email,setEmail,password,setPassword,username,setUsername,mode,setMode,busy,notice,onSubmit,onBack}:{email:string;setEmail:(s:string)=>void;password:string;setPassword:(s:string)=>void;username:string;setUsername:(s:string)=>void;mode:'login'|'signup';setMode:(s:'login'|'signup')=>void;busy:boolean;notice:string;onSubmit:(e:React.FormEvent)=>void;onBack:()=>void}) {
  return <div className="auth-shell"><button className="back-link" onClick={onBack}><ArrowLeft size={16}/> Back</button><div className="auth-card"><div className="brand auth-brand"><div className="brand-mark"><Zap size={21} fill="currentColor"/></div><span>NEX<span className="brand-accent">PLAY</span></span></div><div className="eyebrow">PLAYER ACCESS</div><h1>{mode==='login'?'Welcome back.':'Join the playground.'}</h1><p>One account. Every game. Your people.</p><form onSubmit={onSubmit}>{mode==='signup'&&<label>PLAYER NAME<input value={username} onChange={e=>setUsername(e.target.value)} placeholder="Your username" required/></label>}<label>EMAIL ADDRESS<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" required/></label><label>PASSWORD<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 6 characters" minLength={6} required/></label><button className="primary-btn full-btn" disabled={busy}>{busy?'Please wait...':mode==='login'?'Sign in':'Create account'} <ArrowRight size={16}/></button></form>{notice&&<div className="notice">{notice}</div>}<div className="auth-switch">{mode==='login'?'New to NEXPLAY?':'Already have an account?'} <button onClick={()=>setMode(mode==='login'?'signup':'login')}>{mode==='login'?'Create account':'Sign in'}</button></div><small className="auth-legal">By continuing, you agree to play fair and treat other players with respect.</small></div></div>;
}

export default App;