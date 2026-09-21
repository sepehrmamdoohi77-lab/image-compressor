// Menu screens: main, pause, settings, help, round-complete, end screens.
import { useState } from 'react';
import type { Game } from '../game/core/Game';
import type { SettingsData } from '../game/data/config';

// --- shared bits -------------------------------------------------------------------
function Btn({ label, onClick, primary, danger }: { label: string; onClick: () => void; primary?: boolean; danger?: boolean }): JSX.Element {
  return (
    <button className={`btn ${primary ? 'primary' : ''} ${danger ? 'danger' : ''}`} onClick={onClick}>
      {label}
    </button>
  );
}

// --- main menu ----------------------------------------------------------------------
export function MainMenu({ game, onSettings, onHelp }: { game: Game; onSettings: () => void; onHelp: () => void }): JSX.Element {
  return (
    <div className="screen menu-screen">
      <div className="menu-left">
        <div className="kicker">ISOMETRIC TACTICAL SHOOTER</div>
        <h1 className="title">
          BREACH<span>LINE</span>
        </h1>
        <p className="tagline">
          Five rounds. One compound. No backup.
          <br />
          Use cover, control recoil, and clear every hostile.
        </p>
        <div className="menu-buttons">
          <Btn label="▶&nbsp;&nbsp;DEPLOY" primary onClick={() => game.startRun()} />
          <Btn label="SETTINGS" onClick={onSettings} />
          <Btn label="HOW TO PLAY" onClick={onHelp} />
        </div>
        <div className="controls-strip">
          <span><b>WASD</b> move</span>
          <span><b>MOUSE</b> aim</span>
          <span><b>LMB</b> fire</span>
          <span><b>RMB</b> precision</span>
          <span><b>R</b> reload</span>
          <span><b>G</b> grenade</span>
          <span><b>C</b> crouch</span>
          <span><b>Q / E</b> rotate cam</span>
          <span><b>TAB</b> cycle weapon</span>
        </div>
      </div>
      <div className="menu-right">
        <div className="brief-card">
          <h3>OPERATION ORDER</h3>
          <ol>
            <li><b>ROUND 1–2</b> — Rifle squads probing the perimeter.</li>
            <li><b>ROUND 3</b> — Mixed force with marksman support.</li>
            <li><b>ROUND 4</b> — Heavy gunners hold the plaza.</li>
            <li><b>ROUND 5</b> — Final stand. Everything they have.</li>
          </ol>
          <p className="tip">Headshots pay bonus. Grenade kills pay more. Miss less — accuracy bonus each clean round.</p>
        </div>
      </div>
    </div>
  );
}

// --- pause ----------------------------------------------------------------------------
export function PauseMenu({ game, onSettings, onMenu }: { game: Game; onSettings: () => void; onMenu: () => void }): JSX.Element {
  return (
    <div className="screen overlay">
      <div className="panel">
        <h2>PAUSED</h2>
        <p className="dim">Combat is frozen. Enemies hold position.</p>
        <div className="menu-buttons col">
          <Btn label="RESUME" primary onClick={() => game.resume()} />
          <Btn label="RESTART MISSION" onClick={() => game.restart()} />
          <Btn label="SETTINGS" onClick={onSettings} />
          <Btn label="ABANDON — MAIN MENU" danger onClick={onMenu} />
        </div>
      </div>
    </div>
  );
}

// --- settings ----------------------------------------------------------------------------
export function SettingsPanel({ game, onClose }: { game: Game; onClose: () => void }): JSX.Element {
  const [s, setS] = useState<SettingsData>({ ...game.settings.data });
  const apply = (patch: Partial<SettingsData>): void => {
    const next = game.settings.update(patch);
    setS({ ...next });
    game.applySettingsToAudio();
    game.applyQuality();
    game.audio.playUI();
  };
  const slider = (key: keyof SettingsData, label: string, min: number, max: number, step: number): JSX.Element => (
    <label className="setting">
      <span>{label}<em>{(s[key] as number).toFixed(2)}</em></span>
      <input
        type="range" min={min} max={max} step={step}
        value={s[key] as number}
        onChange={(e) => apply({ [key]: parseFloat(e.target.value) } as Partial<SettingsData>)}
      />
    </label>
  );
  return (
    <div className="screen overlay">
      <div className="panel wide">
        <h2>SETTINGS</h2>
        <div className="settings-grid">
          <div className="settings-col">
            <h4>AUDIO</h4>
            {slider('master', 'Master volume', 0, 1, 0.01)}
            {slider('sfx', 'Effects volume', 0, 1, 0.01)}
            {slider('music', 'Ambient volume', 0, 1, 0.01)}
            {slider('ui', 'Interface volume', 0, 1, 0.01)}
          </div>
          <div className="settings-col">
            <h4>CONTROLS / CAMERA</h4>
            {slider('sensitivity', 'Zoom sensitivity', 0.2, 3, 0.05)}
            {slider('cameraDistance', 'Camera distance', 12, 30, 0.5)}
            <label className="setting row">
              <span>Graphics quality</span>
              <select value={s.quality} onChange={(e) => apply({ quality: e.target.value as SettingsData['quality'] })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>
        </div>
        <div className="menu-buttons row">
          <Btn label="RESET DEFAULTS" onClick={() => { game.settings.reset(); setS({ ...game.settings.data }); game.applySettingsToAudio(); game.applyQuality(); }} />
          <Btn label="DONE" primary onClick={onClose} />
        </div>
      </div>
    </div>
  );
}

// --- how to play ----------------------------------------------------------------------------
export function HowToPlay({ onClose }: { onClose: () => void }): JSX.Element {
  const rows: [string, string][] = [
    ['W A S D', 'Move (camera-relative). Diagonals are normalized.'],
    ['MOUSE', 'Aim — the soldier and weapon track your cursor in the world.'],
    ['LEFT CLICK', 'Fire. Automatic weapons keep firing while held.'],
    ['RIGHT CLICK (hold)', 'Precision aim: slower move, tighter spread, steadier recoil.'],
    ['R', 'Reload. Auto-reloads on empty trigger.'],
    ['G', 'Throw grenade at cursor (limited — +1 per round).'],
    ['C / CTRL (hold)', 'Crouch: hide behind low cover, steadier shots, slower move.'],
    ['1 – 5 / TAB', 'Swap weapon: Rifle · SMG · Shotgun · DMR · Pistol.'],
    ['MOUSE WHEEL', 'Camera zoom.'],
    ['Q / E', 'Rotate the camera around the soldier.'],
    ['ESC', 'Pause.'],
  ];
  return (
    <div className="screen overlay">
      <div className="panel wide">
        <h2>HOW TO PLAY</h2>
        <p className="dim">Objective: <b className="hl">eliminate all hostiles</b> in each of the 5 rounds. Survive.</p>
        <div className="help-rows">
          {rows.map(([k, v]) => (
            <div key={k} className="help-row"><code>{k}</code><span>{v}</span></div>
          ))}
        </div>
        <div className="help-tips">
          <div><b>COVER</b> — Concrete blocks sight and fire. Crouch behind crates and sandbags to break line of sight.</div>
          <div><b>ENEMIES</b> — They see, hear, remember, share intel, take cover, flank and retreat. Suppress, reposition, punish.</div>
          <div><b>WEAPONS</b> — Rifle: balanced. SMG: close shredder. Shotgun: delete things nearby. DMR: precise power. Pistol: fast backup.</div>
        </div>
        <div className="menu-buttons row">
          <Btn label="BACK" primary onClick={onClose} />
        </div>
      </div>
    </div>
  );
}

// --- round complete ----------------------------------------------------------------------------
export function RoundComplete({ label, bonus }: { label: string; bonus: number }): JSX.Element {
  return (
    <div className="screen overlay transparent">
      <div className="round-clear">
        <div className="rc-kicker">{label}</div>
        <div className="rc-title">AREA CLEAR</div>
        <div className="rc-bonus">+{bonus} BONUS</div>
        <div className="rc-sub">Next wave inbound…</div>
      </div>
    </div>
  );
}

// --- end screens ----------------------------------------------------------------------------
export function EndScreen({
  victory, game, onRetry, onMenu,
}: { victory: boolean; game: Game; onRetry: () => void; onMenu: () => void }): JSX.Element {
  const p = game.progressionData;
  const acc = p.shotsFired > 0 ? Math.round((p.shotsHit / p.shotsFired) * 100) : 0;
  return (
    <div className="screen overlay">
      <div className="panel wide end">
        <div className={`end-kicker ${victory ? 'win' : 'lose'}`}>{victory ? 'MISSION COMPLETE' : 'KIA — MISSION FAILED'}</div>
        <h2 className="end-title">{victory ? 'COMPOUND SECURED' : `FELL IN ROUND ${p.roundIndex + 1}`}</h2>
        <div className="end-score">{p.score.toLocaleString()} <span>PTS</span></div>
        <div className="stat-grid">
          <div><b>{p.kills}</b><span>eliminations</span></div>
          <div><b>{p.headshots}</b><span>headshots</span></div>
          <div><b>{p.grenadeKills}</b><span>grenade kills</span></div>
          <div><b>{acc}%</b><span>accuracy</span></div>
          <div><b>{p.roundIndex + (victory ? 1 : 0)} / {p.totalRounds}</b><span>rounds cleared</span></div>
          <div><b>{p.shotsFired}</b><span>rounds fired</span></div>
        </div>
        <div className="menu-buttons row">
          <Btn label={victory ? 'PLAY AGAIN' : 'RETRY'} primary onClick={onRetry} />
          <Btn label="MAIN MENU" onClick={onMenu} />
        </div>
      </div>
    </div>
  );
}

export function Loading(): JSX.Element {
  return (
    <div className="screen overlay">
      <div className="loading-box">
        <div className="spinner" />
        <div>DEPLOYING…</div>
      </div>
    </div>
  );
}
