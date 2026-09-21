// Application shell: owns the canvas, polls HUD snapshots, routes screens.
import { useEffect, useRef, useState } from 'react';
import { GameState, type HudSnapshot } from '../game/core/GameStates';
import { bridge } from './GameBridge';
import { HUD } from './HUD';
import { EndScreen, HowToPlay, Loading, MainMenu, PauseMenu, RoundComplete, SettingsPanel } from './Menus';

interface FeedItem {
  id: number;
  text: string;
  sub: string;
}

let feedId = 1;

export function App(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [gs, setGs] = useState<GameState>(GameState.MENU);
  const [snap, setSnap] = useState<HudSnapshot | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [banner, setBanner] = useState<{ label: string; briefing: string } | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [roundInfo, setRoundInfo] = useState<{ label: string; bonus: number }>({ label: '', bonus: 0 });
  const game = bridge.create();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    game.init(container);
    setGs(game.state);

    const offs = [
      game.events.on('state-changed', (e) => {
        setGs(e.data.state as GameState);
        if ((e.data.state as GameState) === GameState.PLAYING) {
          setShowSettings(false);
          setShowHelp(false);
        }
      }),
      game.events.on('round-start', (e) => {
        setBanner({ label: e.data.label as string, briefing: e.data.briefing as string });
        window.setTimeout(() => setBanner(null), 3400);
      }),
      game.events.on('round-complete', (e) => {
        setRoundInfo({ label: game.currentRoundLabel, bonus: e.data.bonus as number });
      }),
      game.events.on('kill', (e) => {
        const d = e.data as { name: string; headshot: boolean; cause: string; score: number };
        const item: FeedItem = {
          id: feedId++,
          text: `${d.headshot ? '☠ HS ' : ''}${d.name}`,
          sub: `+${d.score}${d.cause === 'grenade' ? ' 💥' : ''}`,
        };
        setFeed((f) => [...f.slice(-4), item]);
        window.setTimeout(() => setFeed((f) => f.filter((x) => x.id !== item.id)), 4500);
      }),
    ];

    const poll = window.setInterval(() => {
      try {
        setSnap(game.getSnapshot());
      } catch (err) {
        console.error('[UI] snapshot failed:', err);
      }
    }, 100);

    return () => {
      offs.forEach((off) => off());
      window.clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inGame = gs === GameState.PLAYING || gs === GameState.ROUND_COMPLETE;

  return (
    <div className="app">
      <div ref={containerRef} className={`viewport ${gs === GameState.PLAYING ? 'playing' : ''}`} />
      {inGame && snap && <HUD snap={snap} banner={gs === GameState.PLAYING ? banner : null} feed={feed} />}
      {gs === GameState.MENU && !showSettings && !showHelp && (
        <MainMenu game={game} onSettings={() => setShowSettings(true)} onHelp={() => setShowHelp(true)} />
      )}
      {gs === GameState.LOADING && <Loading />}
      {gs === GameState.PAUSED && !showSettings && (
        <PauseMenu game={game} onSettings={() => setShowSettings(true)} onMenu={() => game.toMenu()} />
      )}
      {gs === GameState.ROUND_COMPLETE && <RoundComplete label={roundInfo.label} bonus={roundInfo.bonus} />}
      {(gs === GameState.VICTORY || gs === GameState.DEFEAT) && (
        <EndScreen victory={gs === GameState.VICTORY} game={game} onRetry={() => game.restart()} onMenu={() => game.toMenu()} />
      )}
      {showSettings && <SettingsPanel game={game} onClose={() => setShowSettings(false)} />}
      {showHelp && <HowToPlay onClose={() => setShowHelp(false)} />}
    </div>
  );
}
