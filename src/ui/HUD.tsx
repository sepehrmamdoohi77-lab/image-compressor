// Tactical HUD overlay: objective, bars, ammo, crosshair, feed, banners.
import { useEffect, useRef } from 'react';
import type { HudSnapshot } from '../game/core/GameStates';

interface Props {
  snap: HudSnapshot;
  banner: { label: string; briefing: string } | null;
  feed: { id: number; text: string; sub: string }[];
}

function Bar({ value, max, className }: { value: number; max: number; className: string }): JSX.Element {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return (
    <div className={`bar ${className}`}>
      <div className="bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function HUD({ snap, banner, feed }: Props): JSX.Element {
  const crossRef = useRef<HTMLDivElement>(null);
  const hitRef = useRef<HTMLDivElement>(null);

  // Crosshair follows the mouse via direct DOM updates (no re-renders).
  useEffect(() => {
    const el = crossRef.current;
    if (!el) return;
    const move = (e: MouseEvent): void => {
      el.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    };
    window.addEventListener('mousemove', move);
    return () => window.removeEventListener('mousemove', move);
  }, []);

  // Dynamic spread gap.
  useEffect(() => {
    crossRef.current?.style.setProperty('--gap', `${snap.spreadPx / 2}px`);
  }, [snap.spreadPx]);

  // Hitmarker flash.
  useEffect(() => {
    const el = hitRef.current;
    if (!el || !snap.hitmarker) return;
    el.classList.remove('show', 'headshot');
    void el.offsetWidth; // restart animation
    el.classList.add('show');
    if (snap.hitmarkerHeadshot) el.classList.add('headshot');
  }, [snap.hitmarker]);

  const hpLow = snap.health <= 30;
  const acc = snap.shotsFired > 0 ? Math.round((snap.shotsHit / snap.shotsFired) * 100) : 0;

  // Proximity danger: red edge glow + a chevron pointing at the nearest hostile.
  const danger = Math.max(0, Math.min(1, snap.threatLevel));
  const dangerOn = danger > 0.04 && snap.threatCount > 0;

  return (
    <div className="hud">
      {/* damage vignette */}
      <div className="vignette" style={{ opacity: snap.damageFlash }} />
      {hpLow && <div className="lowhp" />}

      {/* proximity danger: hostiles closing in */}
      <div className="danger-edge" style={{ opacity: danger * 0.85 }} />
      {dangerOn && (
        <div
          className="danger-arrow"
          style={{ transform: `translate(-50%, -50%) rotate(${snap.threatAngleDeg}deg)`, opacity: 0.35 + danger * 0.65 }}
        >
          <span className="da-tip" />
        </div>
      )}

      {/* crosshair + hitmarker (positioned at cursor) */}
      <div ref={crossRef} className="crosshair" style={{ transform: 'translate(-100px,-100px)' }}>
        <div className="ch-dot" />
        <div className="ch-line ch-t" />
        <div className="ch-line ch-b" />
        <div className="ch-line ch-l" />
        <div className="ch-line ch-r" />
        <div ref={hitRef} className="hitmarker">
          <span className="hm1" />
          <span className="hm2" />
          <span className="hm3" />
          <span className="hm4" />
        </div>
      </div>

      {/* objective */}
      <div className="hud-top-center">
        <div className="objective">
          <span className="obj-label">{snap.roundLabel}</span>
          <span className="obj-text">
            ELIMINATE ALL HOSTILES — <strong>{snap.enemiesRemaining}</strong> LEFT
          </span>
        </div>
        {snap.reloading && <div className="reloading-tag">RELOADING…</div>}
        {danger > 0.3 && snap.threatDistance >= 0 && (
          <div className="danger-tag">
            ⚠ CONTACT — {Math.round(snap.threatDistance)}m {snap.threatCount > 1 ? `×${snap.threatCount}` : ''}
          </div>
        )}
      </div>

      {/* score */}
      <div className="hud-top-right">
        <div className="score-box">
          <div className="score">{snap.score.toLocaleString()}</div>
          <div className="score-sub">
            K {snap.kills} · HS {snap.headshots} · {acc}% ACC
          </div>
        </div>
        <div className="feed">
          {feed.map((f) => (
            <div key={f.id} className="feed-item">
              <span>{f.text}</span>
              <em>{f.sub}</em>
            </div>
          ))}
        </div>
      </div>

      {/* health */}
      <div className="hud-bottom-left">
        <div className="vitals">
          <div className="vital-row">
            <span className="vital-tag">HP</span>
            <Bar value={snap.health} max={snap.maxHealth} className={hpLow ? 'hp low' : 'hp'} />
            <span className="vital-num">{Math.ceil(snap.health)}</span>
          </div>
          <div className="vital-row">
            <span className="vital-tag">AR</span>
            <Bar value={snap.armor} max={snap.maxArmor} className="armor" />
            <span className="vital-num">{Math.ceil(snap.armor)}</span>
          </div>
          <div className="status-row">
            <span className={`pill ${snap.grenades > 0 ? '' : 'empty'}`}>◉ G×{snap.grenades}</span>
            {snap.aiming && <span className="pill active">AIM</span>}
          </div>
        </div>
      </div>

      {/* weapon */}
      <div className="hud-bottom-right">
        <div className="weapon-box">
          <div className="weapon-name">{snap.weaponName}</div>
          <div className={`ammo ${snap.lowAmmo ? 'low' : ''}`}>
            <span className="mag">{snap.magAmmo}</span>
            <span className="reserve">/ {snap.reserveAmmo}</span>
          </div>
          <div className="slots">
            {snap.weaponSlots.map((s, i) => (
              <div key={s.id} className={`slot ${s.id === snap.weaponId ? 'active' : ''} ${s.mag === 0 && s.reserve === 0 ? 'empty' : ''}`}>
                <span className="slot-key">{i + 1}</span>
                <span className="slot-mag">{s.mag}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* round banner */}
      {banner && (
        <div className="round-banner">
          <div className="round-title">{banner.label}</div>
          <div className="round-brief">{banner.briefing}</div>
        </div>
      )}

      {/* hints */}
      <div className="hud-hint">
        {snap.magAmmo === 0 && !snap.reloading && snap.reserveAmmo > 0 && <span>Press R to reload</span>}
        {snap.magAmmo === 0 && snap.reserveAmmo === 0 && <span className="warn">WEAPON DRY — SWITCH [1-5]</span>}
      </div>

      <div className="fps">{snap.fps} FPS</div>
    </div>
  );
}
