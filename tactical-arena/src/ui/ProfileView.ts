import type { GameConfig, Profile, WeaponId } from '../multiplayer/protocol';
import { escape, icon } from './icons';
export function weaponArt(id: string): string {
  const paths: Record<string, string> = {
    rifle: 'M7 23h40l13-4h9v6H51v7H32l-4 15h-9l5-15H7zm28-3v-7h12v7M10 23v-6H3v14h7',
    smg: 'M15 19h35v11H28v19h-8V30H8v-8H2v10h6M49 21h13v5H49M33 19v-6h12v6',
    shotgun: 'M10 21h53v5H32v7H22l-9 13-8-3 10-17M38 26v7h19v-7M19 21l5-6h23v6',
    dmr: 'M8 23h62v4H41v7H28l-4 16h-9l4-16H8zm23-1v-9h18v9M2 17h6v17H2M54 27v7h5v-7',
    pistol: 'M15 17h33v11H28l-4 20H12l7-20h-4zm26 11v7H29v-7',
  };
  return `<svg class="weapon-art" viewBox="0 0 76 60" aria-hidden="true"><path d="${paths[id] ?? paths.rifle}" fill="currentColor"/></svg>`;
}
export function profileMarkup(profile: Profile, config: GameConfig | null): string {
  const s = profile.stats,
    kd = s.kills / Math.max(1, s.deaths),
    accuracy = s.shots ? (s.hits / s.shots) * 100 : 0;
  const span =
    profile.nextLevelXp === null
      ? 1
      : (profile.xp - profile.levelStartXp) /
        Math.max(1, profile.nextLevelXp - profile.levelStartXp);
  const weapon = config?.weapons.find((w) => w.id === profile.favoriteWeapon);
  return `<div class="profile-identity"><span class="profile-emblem">${icon('shield')}</span><div><strong>${escape(profile.name)}</strong><small>SERVER-STORED GUEST · LEVEL ${profile.level}</small></div><b>${profile.level}</b></div><div class="xp-summary"><span>${profile.xp.toLocaleString()} TOTAL XP</span><i>${profile.nextLevelXp === null ? 'MAX LEVEL' : `${Math.max(0, profile.nextLevelXp - profile.xp)} TO LEVEL ${profile.level + 1}`}</i><div><b style="width:${Math.max(0, Math.min(1, span)) * 100}%"></b></div></div><div class="profile-stat-grid">${[
    ['KILLS', s.kills],
    ['DEATHS', s.deaths],
    ['K / D', kd.toFixed(2)],
    ['MATCHES', s.matches],
    ['WINS', s.wins],
    ['LOSSES', s.losses],
    ['HEADSHOTS', s.headshots],
    ['ACCURACY', `${accuracy.toFixed(1)}%`],
    ['ASSISTS', s.assists],
  ]
    .map(([label, value]) => `<span>${label}<b>${value}</b></span>`)
    .join(
      '',
    )}</div><div class="favorite-weapon"><span><small>FAVORITE WEAPON · RECORDED SHOTS</small><strong>${weapon?.label ?? profile.favoriteWeapon?.toUpperCase() ?? 'NO RECORDED WEAPON USE'}</strong></span>${profile.favoriteWeapon ? weaponArt(profile.favoriteWeapon) : icon('user')}</div><h3 class="history-title">RECENT COMPLETED HUMAN MATCHES</h3>${profile.history.length ? `<div class="match-history">${profile.history.map((h) => `<div><span class="history-${h.outcome}">${h.outcome.toUpperCase()}</span><b>${h.scores.blue} : ${h.scores.red}</b><small>${h.stats.kills} K · ${h.stats.deaths} D</small><i>+${h.xpEarned} XP</i></div>`).join('')}</div>` : '<p class="empty-history">No completed human matches recorded yet. Bot practice and abandoned matches do not award progression.</p>'}<div class="notice">${icon('shield')}<span>Stored statistics change only after verified, completed human matches. Level and cosmetics never boost damage, health or reload speed. Clearing guest cookies and tab authorization storage can lose access to this identity.</span></div><button class="button secondary full" data-close>CLOSE PROFILE</button>`;
}
export function loadoutMarkup(profile: Profile, config: GameConfig): string {
  return `<p class="dialog-intro">All four primary classes are available from level one. Choose before joining a room. Competitive statistics are fixed on the server.</p><form><div class="loadout-choices">${config.weapons
    .filter((w) => w.id !== 'pistol')
    .map(
      (w) =>
        `<label class="loadout-choice"><input type="radio" name="primary" value="${w.id}" ${w.id === profile.loadout.primary ? 'checked' : ''}/><span>${weaponArt(w.id)}<strong>${escape(w.label)}</strong><small>${escape(w.class)}</small><i>${w.damage} DMG · ${w.magazineSize} RDS · ${w.range} M</i></span></label>`,
    )
    .join(
      '',
    )}</div><div class="form-row"><label class="form-label">OPERATOR FINISH<select name="cosmetic">${(['olive', 'slate', 'sand'] as const).map((c) => `<option value="${c}" ${c === profile.loadout.cosmetic ? 'selected' : ''}>${c.toUpperCase()} · COSMETIC ONLY</option>`).join('')}</select></label><div class="fixed-loadout"><small>SECONDARY / EQUIPMENT</small><strong>P-9 SIDEARM</strong><span>2 × FRAG AT SPAWN</span></div></div><button class="button primary full" data-submit><span>SAVE SERVER LOADOUT</span>${icon('check')}</button></form>`;
}
export const weaponIds: WeaponId[] = ['rifle', 'smg', 'shotgun', 'dmr', 'pistol'];
