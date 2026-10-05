import type { GameConfig, Health, Profile } from '../multiplayer/protocol';
import { brand, escape, icon } from './icons';
import { mapMarkup } from './MapView';

export class MenuScreen {
  readonly element = document.createElement('div');
  constructor(config: GameConfig | null, profile: Profile | null) {
    this.element.className = 'operations-screen';
    this.element.innerHTML = `
      <div class="operations-art" aria-hidden="true"></div><div class="operations-shade" aria-hidden="true"></div>
      <header class="main-header">
        ${brand}<span class="header-divider"></span><span class="header-mode">OPERATIONS COMMAND</span>
        <div class="header-actions"><span class="build-tag">WEB PLAYTEST <b>0.2</b></span>
          <button class="callsign-button" data-action="callsign">${icon('user')}<span data-callsign>${escape(profile?.name ?? 'SET CALLSIGN')}</span><i>GUEST</i></button>
          ${document.fullscreenEnabled ? `<button class="icon-button desktop-only" data-action="fullscreen" aria-label="Toggle fullscreen">${icon('fullscreen')}</button>` : ''}
        </div>
      </header>
      <nav class="side-nav" aria-label="Main navigation">
        <button class="nav-item active" data-action="operations" aria-current="page">${icon('operations')}<span>OPS</span></button>
        <button class="nav-item" data-action="profile">${icon('user')}<span>PROFILE</span></button><button class="nav-item" data-action="loadout">${icon('shield')}<span>ARMORY</span></button><button class="nav-item" data-action="help">${icon('help')}<span>GUIDE</span></button>
        <button class="nav-item" data-action="settings">${icon('settings')}<span>SETTINGS</span></button>
        <span class="nav-spacer"></span><span class="vertical-label">TACTICAL / FIELD DIVISION</span><span class="nav-index">TA<span>01</span></span>
      </nav>
      <main class="operations-content">
        <div class="hero-eyebrow"><span class="tiny-cross">+</span> PRIVATE ROOMS. REAL OPERATORS.</div>
        <div class="hero-heading"><span class="outline-index" aria-hidden="true">01</span><h1>TACTICAL<br><span>ARENA</span><i>.</i></h1></div>
        <div class="hero-rule"></div>
        <h2>Every angle. Every advantage.</h2>
        <p class="hero-copy">Choose your map. Assemble your squad.<br>Server-validated tactical combat. Your aim. Your squad.</p>
        <div class="hero-actions">
          <button class="button primary large" data-action="quick-play">${icon('arrow')}<span>QUICK PLAY</span>${icon('arrow')}</button>
          <button class="button secondary large" data-action="join">${icon('squad')}<span>JOIN WITH CODE</span></button>
        </div>
        <div class="hero-sub-actions"><button class="text-button" data-action="create">${icon('plus')} CREATE PRIVATE ROOM</button><button class="text-button" data-action="loadout">${icon('shield')} CHOOSE LOADOUT</button></div>
        <p class="stage-disclosure"><span class="status-dot bronze"></span>TEAM DEATHMATCH · REAL MULTIPLAYER<span class="disclosure-divider">/</span>10 selectable maps. Five classes. Persistent guest stats.</p>
        <div class="operations-bottom">
          <div class="mission-card"><span class="small-label">YOUR SQUAD. YOUR ROOM.</span><div class="mission-stats"><span>${icon('squad')}<b>2–8</b><small>OPERATORS</small></span><span>${icon('shield')}<b>PRIVATE</b><small>SERVER AUTHORITY</small></span></div><p>Share a room code. Ready up. Move together.</p></div>
          <button class="sector-card" data-action="brief" aria-label="View Outpost field briefing">
            <span class="sector-visual">${config ? mapMarkup(config) : '<span class="map-loading">LOADING MAP DATA…</span>'}<span class="sector-number">07</span></span>
            <span class="sector-body"><span class="small-label">DEFAULT FIELD / 10 SELECTABLE MAPS</span><strong>OUTPOST</strong><span class="sector-description">URBAN YARD <i>·</i> THREE LANES <i>·</i> 44 × 44 M</span><span class="sector-link">FIELD BRIEFING ${icon('arrow')}</span></span>
          </button>
        </div>
      </main>
      <aside class="art-caption"><span class="caption-cross">+</span><span>URBAN OPERATIONS<br><b>OUTPOST // SECTOR 07</b></span></aside>
      <footer class="operations-footer"><span class="service-indicator" data-service>${icon('signal')}<span class="status-dot"></span>CHECKING ROOM SERVICE…</span><span class="footer-details">WEB PLAYTEST<span> / </span>HUMAN-ONLY QUICK PLAY. PRIVATE ROOMS.</span><button data-action="refresh-service" class="text-button">${icon('refresh')}RECHECK</button></footer>`;
  }
  setProfile(profile: Profile | null): void {
    this.element.querySelector('[data-callsign]')!.textContent = profile?.name ?? 'SET CALLSIGN';
  }
  setHealth(health: Health | null): void {
    const indicator = this.element.querySelector<HTMLElement>('[data-service]')!;
    indicator.classList.toggle('is-available', health?.status === 'available');
    indicator.classList.toggle('is-unavailable', !health || health.status === 'unavailable');
    indicator.innerHTML = `${icon('signal')}<span class="status-dot"></span>${health?.status === 'available' ? 'ROOM SERVICE AVAILABLE' : health?.status === 'starting' ? 'ROOM SERVICE STARTING' : 'ROOM SERVICE UNAVAILABLE'}`;
  }
}
