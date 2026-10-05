import type { GameConfig, Profile, RoomState } from '../multiplayer/protocol';
import type { Settings } from '../services/Settings';
import { escape, icon } from './icons';
import { mapMarkup } from './MapView';
import { profileMarkup, loadoutMarkup } from './ProfileView';

const nameInput = (profile: Profile | null) =>
  `<label class="form-label">OPERATOR CALLSIGN<input name="name" type="text" value="${escape(profile?.name ?? '')}" placeholder="Choose your callsign" minlength="3" maxlength="20" pattern="[A-Za-z0-9][A-Za-z0-9 _.\\-]{2,19}" required autocomplete="nickname" /><small>${profile ? 'Your server-stored guest identity.' : '3–20 characters. A guest identity is saved on this server.'}</small></label>`;

export class Dialogs {
  readonly element = document.createElement('dialog');
  private busy = false;
  private mapConfig: GameConfig | null = null;
  private submit: ((form: FormData) => void) | null = null;
  private settingsChange: ((next: Partial<Settings>) => boolean) | null = null;
  constructor(
    root: HTMLElement,
    private changed: () => void,
  ) {
    this.element.className = 'tactical-dialog';
    root.append(this.element);
    this.element.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-close]')) {
        e.stopPropagation();
        this.close();
      }
    });
    this.element.addEventListener('cancel', (e) => {
      if (this.busy) e.preventDefault();
    });
    this.element.addEventListener('close', () => {
      if (!this.element.open) {
        this.submit = null;
        this.settingsChange = null;
      }
      this.changed();
    });
    this.element.addEventListener('change', (e) => {
      const select = e.target;
      if (select instanceof HTMLSelectElement && select.name === 'mapId' && this.mapConfig) {
        const chosen = this.mapConfig.maps.find((m) => m.id === select.value) ?? this.mapConfig.map;
        const target = this.element.querySelector('[data-map-summary]');
        if (target)
          target.innerHTML = `${mapMarkup({ ...this.mapConfig, map: chosen })}<span><small>SELECTED FIELD / SECTOR ${escape(chosen.sector)}</small><strong>${escape(chosen.name)}</strong><i>${escape(chosen.description)}</i></span>${icon('map')}`;
      }
    });
    this.element.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.busy) return;
      if (e.target instanceof HTMLFormElement) this.submit?.(new FormData(e.target));
    });
    this.element.addEventListener('input', (e) => {
      const input = e.target;
      if (
        !(input instanceof HTMLInputElement || input instanceof HTMLSelectElement) ||
        !this.settingsChange
      )
        return;
      const key = input.name as keyof Settings;
      const value =
        input instanceof HTMLInputElement && input.type === 'checkbox'
          ? input.checked
          : ['quality', 'crosshair'].includes(input.name)
            ? input.value
            : Number(input.value);
      const saved = this.settingsChange({ [key]: value });
      const output = this.element.querySelector(`[data-output="${key}"]`);
      if (output) output.textContent = input.value;
      this.element.querySelector('[data-settings-save]')!.textContent = saved
        ? 'Preferences saved on this browser.'
        : 'Applied for this session. Browser storage is unavailable.';
    });
  }
  get isOpen(): boolean {
    return this.element.open;
  }
  get isBusy(): boolean {
    return this.busy;
  }
  private open(eyebrow: string, title: string, content: string): void {
    if (this.element.open) this.element.close();
    this.busy = false;
    this.mapConfig = null;
    this.submit = this.settingsChange = null;
    this.element.innerHTML = `<header class="dialog-header"><div><span class="small-label">${eyebrow}</span><h2>${title}</h2></div><button type="button" class="icon-button" data-close aria-label="Close dialog">${icon('close')}</button></header><div class="dialog-body">${content}<p class="dialog-error" data-error role="alert" hidden></p></div>`;
    this.element.showModal();
    this.changed();
  }
  create(profile: Profile | null, config: GameConfig, onSubmit: (form: FormData) => void): void {
    this.open(
      'PRIVATE MULTIPLAYER',
      'CREATE ROOM',
      `<p class="dialog-intro">Create a private match. Share its real code with your squad and ready up together.</p><form>
      ${nameInput(profile)}${this.mapSelect(config)}<div class="form-row"><label class="form-label">TEAM CAPACITY<select name="teamSize"><option value="1">1 vs 1 · 2 operators</option><option value="2">2 vs 2 · 4 operators</option><option value="3">3 vs 3 · 6 operators</option><option value="4" selected>4 vs 4 · 8 operators</option></select></label><label class="form-label">ROUND DURATION<select name="timeLimitSeconds"><option value="120">2 minutes</option><option value="300">5 minutes</option><option value="600" selected>10 minutes</option></select></label></div>
      <div class="form-row"><label class="form-label">MODE<select name="mode"><option value="TEAM_DEATHMATCH">Team Deathmatch</option><option value="NETWORK_DRILL">Movement network drill</option></select></label><label class="form-label">KILL LIMIT<select name="scoreLimit"><option value="1">1 kill · private duel</option><option value="5">5 kills</option><option value="10">10 kills</option><option value="25">25 kills</option><option value="50" selected>50 kills</option></select></label></div>${config.botsSupported ? `<div class="form-row"><label class="form-label">EXPLICIT PRACTICE BOTS<select name="bots"><option value="0">No bots · human match</option><option value="1">1 labelled practice bot</option><option value="3">3 labelled practice bots</option><option value="5">5 labelled practice bots</option><option value="7">7 labelled practice bots</option></select></label><label class="form-label">BOT DIFFICULTY<select name="difficulty"><option value="easy">Easy · slower reaction</option><option value="normal" selected>Normal · tactical</option><option value="hard">Hard · precise aim</option></select></label></div><p class="bot-practice-note">Bots occupy real team slots, are always labelled, and disable competitive XP/stat awards. Choose enough team capacity for all participants.</p>` : ''}<label class="setting-toggle"><input name="friendlyFire" type="checkbox"/><span>Friendly fire · private TDM only</span></label>
      <div class="form-map-summary" data-map-summary>${mapMarkup(config)}<span><small>SELECTED FIELD / SECTOR ${escape(config.map.sector)}</small><strong>${escape(config.map.name)}</strong><i>10 REAL MAPS · 44 × 44 M</i></span>${icon('map')}</div><div class="notice">${icon('shield')}<span>Real WebSocket rooms with server-validated weapons, damage and results. No clients can award their own kills or ammunition.</span></div><button class="button primary full" type="submit" data-submit>${icon('plus')}<span>ESTABLISH ROOM</span>${icon('arrow')}</button></form>`,
    );
    this.mapConfig = config;
    this.submit = onSubmit;
  }
  join(profile: Profile | null, code: string, onSubmit: (form: FormData) => void): void {
    this.open(
      'PRIVATE MULTIPLAYER',
      'JOIN YOUR SQUAD',
      `<p class="dialog-intro">Enter the six-character code shared by your room owner.</p><form>${nameInput(profile)}<label class="form-label">ROOM CODE<input class="code-input" name="code" type="text" value="${escape(code)}" placeholder="ABC123" maxlength="6" minlength="6" pattern="[A-HJ-NP-Za-hj-np-z2-9]{6}" autocomplete="off" autocapitalize="characters" spellcheck="false" required/><small>Codes use letters and 2–9; I and O are excluded.</small></label><div class="notice">${icon('squad')}<span>For two operators, use separate browsers or a private window. One guest identity can have one connection.</span></div><button class="button primary full" type="submit" data-submit>${icon('link')}<span>JOIN ROOM</span>${icon('arrow')}</button></form>`,
    );
    this.submit = onSubmit;
  }
  callsign(profile: Profile | null, onSubmit: (form: FormData) => void): void {
    this.open(
      'SERVER-STORED GUEST IDENTITY',
      'YOUR CALLSIGN',
      `<p class="dialog-intro">Your callsign and profile are stored on the server. A secure cookie or an expiring per-tab authorization grant connects this browser to your guest identity.</p><form><label class="form-label">CALLSIGN<input name="name" type="text" value="${escape(profile?.name ?? '')}" placeholder="Choose your callsign" minlength="3" maxlength="20" pattern="[A-Za-z0-9][A-Za-z0-9 _.\\-]{2,19}" required autocomplete="nickname"/></label>${profile ? `<div class="identity-info"><span>GUEST ID</span><code>${escape(profile.id)}</code><small>Created ${new Date(profile.createdAt * 1000).toLocaleDateString()} on this server.</small></div>` : ''}<div class="notice">${icon('shield')}<span>Clearing guest cookies and tab authorization storage can lose access to this identity. Completed human-match statistics and cosmetic-only XP are stored on the server. Guest identities are not portable accounts.</span></div><button type="submit" class="button primary full" data-submit><span>SAVE CALLSIGN</span>${icon('check')}</button></form>`,
    );
    this.submit = onSubmit;
  }
  settings(settings: Settings, onChange: (next: Partial<Settings>) => boolean): void {
    this.open(
      'BROWSER PREFERENCES',
      'FIELD SETTINGS',
      `<p class="dialog-intro">Changes apply immediately. Preferences are stored on this browser when storage is available.</p><div class="settings-section"><h3>GRAPHICS</h3><div class="form-row"><label class="form-label">RENDER QUALITY<select name="quality">${(['low', 'balanced', 'high'] as const).map((q) => `<option value="${q}" ${q === settings.quality ? 'selected' : ''}>${q === 'low' ? 'Low · no shadows' : q === 'balanced' ? 'Balanced · 1.5× resolution' : 'High · 2× resolution'}</option>`).join('')}</select></label><label class="form-label">FRAME LIMIT<select name="fpsTarget"><option value="30" ${settings.fpsTarget === 30 ? 'selected' : ''}>30 FPS</option><option value="60" ${settings.fpsTarget === 60 ? 'selected' : ''}>60 FPS</option></select></label></div></div><div class="settings-section"><h3>CAMERA & INPUT</h3>${this.slider('zoom', 'Camera distance', settings.zoom, 11, 22, 1, 'Scroll also adjusts camera distance.')}${this.slider('rotationSpeed', 'Camera rotation speed', settings.rotationSpeed, 0.4, 2, 0.1, 'Q / E rotate the camera on desktop.')}${this.slider('touchScale', 'Touch control scale', settings.touchScale, 0.85, 1.3, 0.05, 'Applied to movement and facing sticks.')}${this.slider('gamepadDeadzone', 'Gamepad deadzone', settings.gamepadDeadzone, 0.1, 0.3, 0.01, 'Left stick moves; right stick faces; RB sprints.')}</div><div class="settings-section"><h3>AUDIO</h3>${this.slider('masterVolume', 'Master volume', settings.masterVolume, 0, 1, 0.05, 'All game and UI sound respects this bus.')}${this.slider('sfxVolume', 'Combat & UI sound', settings.sfxVolume, 0, 1, 0.05, 'Different weapon classes have distinct positional sounds.')}${this.slider('musicVolume', 'Menu ambience', settings.musicVolume, 0, 1, 0.05, 'Subtle procedural ambience; muted during active combat.')}</div><div class="settings-section"><h3>FEEDBACK & TOUCH</h3>${this.slider('aimSensitivity', 'Stick aim response', settings.aimSensitivity, 0.4, 2, 0.1, 'Applies to touch and standard gamepad right-stick aiming.')}<label class="form-label">CROSSHAIR<select name="crosshair"><option value="classic" ${settings.crosshair === 'classic' ? 'selected' : ''}>Classic tactical</option><option value="dot" ${settings.crosshair === 'dot' ? 'selected' : ''}>Center dot</option></select></label>${this.toggle('cameraShake', 'Camera recoil shake', settings.cameraShake)}${this.toggle('hitMarkers', 'Server-confirmed hit markers', settings.hitMarkers)}${this.toggle('damageIndicators', 'Incoming damage direction', settings.damageIndicators)}${this.toggle('touchAutoFire', 'Fire while right touch stick is aimed', settings.touchAutoFire)}${typeof navigator.vibrate === 'function' ? this.toggle('haptics', 'Supported browser vibration', settings.haptics) : ''}</div><p class="settings-save" data-settings-save>Changes are saved to this browser when available.</p><button type="button" class="button secondary full" data-close>DONE ${icon('check')}</button>`,
    );
    this.settingsChange = onChange;
  }
  private mapSelect(config: GameConfig): string {
    return `<label class="form-label map-selection">SELECT COMBAT MAP<select name="mapId">${(config.maps.length ? config.maps : [config.map]).map((m) => `<option value="${m.id}">${escape(m.name)} · SECTOR ${escape(m.sector)}</option>`).join('')}</select><small>Each map has its own collision, cover, spawn routes and arena theme.</small></label>`;
  }
  quickPlay(profile: Profile | null, config: GameConfig, onSubmit: (form: FormData) => void): void {
    this.open(
      'REAL PUBLIC ROOM MATCHING',
      'QUICK PLAY',
      `<p class="dialog-intro">Join an available human-only Team Deathmatch room, or establish a new public room. The server starts when both teams contain ready humans. No bots are used in Quick Play. Public room matching respects your selected map.</p><form>${nameInput(profile)}${this.mapSelect(config)}<button class="button primary full" data-submit><span>FIND / JOIN REAL MATCH</span>${icon('arrow')}</button></form>`,
    );
    this.submit = onSubmit;
  }
  profile(profile: Profile, config: GameConfig | null): void {
    this.open('REAL RECORDED PROFILE', 'OPERATOR DOSSIER', profileMarkup(profile, config));
  }
  loadout(profile: Profile, config: GameConfig, onSubmit: (form: FormData) => void): void {
    this.open('FAIR COMPETITIVE LOADOUT', 'ARMORY', loadoutMarkup(profile, config));
    this.submit = onSubmit;
  }
  abort(): void {
    this.open(
      'ROOM OWNER CONFIRMATION',
      'ABORT CURRENT MATCH?',
      `<p class="dialog-intro">This ends the current round for your squad. Unfinished match statistics and XP will not be recorded.</p><div class="form-row"><button class="button secondary" data-close>CANCEL</button><button class="button primary" data-action="confirm-return-lobby">ABORT · RETURN TO LOBBY</button></div>`,
    );
  }
  private toggle(key: keyof Settings, label: string, value: boolean): string {
    return `<label class="setting-toggle"><span>${label}</span><input name="${key}" type="checkbox" ${value ? 'checked' : ''}/></label>`;
  }
  private slider(
    key: string,
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    hint: string,
  ): string {
    return `<label class="slider-label"><span>${label}<output data-output="${key}">${value}</output></span><input name="${key}" type="range" value="${value}" min="${min}" max="${max}" step="${step}"/><small>${hint}</small></label>`;
  }
  help(): void {
    this.open(
      'TACTICAL FIELD MANUAL',
      'HOW TO DEPLOY',
      `<ol class="guide-steps"><li><b>01</b><span><strong>Establish your squad</strong>Quick Play matches real humans. Private rooms use a shareable code; use separate browsers or private windows for distinct guests.</span></li><li><b>02</b><span><strong>Ready up together</strong>The server assigns balanced teams. At least one connected, ready operator is needed on each team. The owner starts the round. Quick Play starts automatically when both teams are occupied.</span></li><li><b>03</b><span><strong>Choose and learn your field</strong>Select one of ten physical maps in Create Room or Quick Play. Use its cover and flanking routes. The server validates hits, magazine state, armor, deaths, respawns and team kills. First team to the kill limit wins.</span></li></ol><div class="control-table"><h3>DESKTOP</h3><p><kbd>WASD</kbd><span>Move relative to camera</span></p><p><kbd>MOUSE</kbd><span>Aim directly at a soldier or ground direction</span></p><p><kbd>SHIFT</kbd><span>Sprint</span></p><p><kbd>Q / E</kbd><span>Rotate camera</span></p><p><kbd>SCROLL</kbd><span>Camera zoom</span></p><p><kbd>TAB</kbd><span>Hold for squad roster</span></p><p><kbd>ESC</kbd><span>Local field menu; session continues</span></p><p><kbd>LMB / RMB</kbd><span>Fire / aim down sights</span></p><p><kbd>R</kbd><span>Timed reload</span></p><p><kbd>1 / 2</kbd><span>Primary / pistol</span></p><p><kbd>G / 3</kbd><span>Throw to cursor ground target · 32m max · cover can block</span></p><p><kbd>C</kbd><span>Toggle crouch; steadier aim</span></p><h3>TOUCH & GAMEPAD</h3><p>Left stick moves. Right stick aims and optionally fires on touch. Use the fire, ADS, reload, frag, sprint and crouch controls. Standard gamepad: RT fire, LT aim, RB sprint, X reload, Y weapon switch, LB frag.</p></div><div class="notice">${icon('help')}<span>This is a browser game using the real FastAPI/WebSocket server, not a Rork/native build. Guest progression is server-stored and never increases combat strength. Leaving before a result disqualifies completion rewards.</span></div><button class="button primary full" data-close>UNDERSTOOD ${icon('check')}</button>`,
    );
  }
  brief(config: GameConfig): void {
    this.open(
      `COMBAT FIELD / SECTOR ${config.map.sector}`,
      config.map.name,
      `<div class="brief-map">${mapMarkup(config)}<span>N ↑</span></div><p class="dialog-intro">${escape(config.map.description)}</p><div class="lane-brief"><p><b>01 / LEFT</b><span>Close cover. Containers and narrow flanking routes.</span></p><p><b>02 / CENTER</b><span>The shortest connection through the open courtyard.</span></p><p><b>03 / RIGHT</b><span>A longer route with extended sightlines.</span></p></div><div class="notice">${icon('map')}<span>Full-height walls block shots and enemy visibility. Lower cover can be fired over while standing; crouch hides your body and steadies aim. Crates and sandbags absorb damage and can be destroyed. This map has no vertical traversal.</span></div><button class="button secondary full" data-close>BACK TO OPERATIONS ${icon('back')}</button>`,
    );
  }
  pause(room: RoomState, ownId: string): void {
    this.open(
      'LOCAL MENU / SESSION CONTINUES',
      'FIELD MENU',
      `<p class="dialog-intro">The online match continues for everyone. Your movement input is stopped while this menu is open.</p><div class="pause-actions"><button class="button primary full" data-close>RESUME ${icon('arrow')}</button><button class="button secondary full" data-action="settings">${icon('settings')}FIELD SETTINGS</button><button class="button secondary full" data-action="help">${icon('help')}HOW TO PLAY</button>${room.ownerId === ownId && room.phase !== 'LOBBY' ? `<button class="button secondary full" data-action="return-lobby">${icon('back')}${room.combatEnabled && room.phase === 'ACTIVE' ? 'ABORT MATCH · RETURN TO LOBBY' : 'RETURN SQUAD TO LOBBY'}</button>` : ''}<button class="text-button danger" data-action="leave">LEAVE ROOM</button></div>`,
    );
  }
  leave(): void {
    this.open(
      'SESSION MANAGEMENT',
      'LEAVE THIS ROOM?',
      `<p class="dialog-intro">Your team slot will be released immediately when connected. Your guest identity stays on this server.</p><div class="form-row"><button class="button secondary" data-close>CANCEL</button><button class="button primary" data-action="confirm-leave">LEAVE ROOM ${icon('back')}</button></div>`,
    );
  }
  setBusy(busy: boolean): void {
    this.busy = busy;
    this.element
      .querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>(
        'button, input, select',
      )
      .forEach((el) => (el.disabled = busy));
    const label = this.element.querySelector('[data-submit] span');
    if (label) {
      if (busy) {
        (label as HTMLElement).dataset.previous = label.textContent ?? '';
        label.textContent = 'CONNECTING…';
      } else label.textContent = (label as HTMLElement).dataset.previous ?? label.textContent;
    }
  }
  error(message: string): void {
    const error = this.element.querySelector<HTMLElement>('[data-error]');
    if (error) {
      error.textContent = message;
      error.hidden = false;
    }
  }
  close(): void {
    if (!this.busy) this.element.close();
  }
}
