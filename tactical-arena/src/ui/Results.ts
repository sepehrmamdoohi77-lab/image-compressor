import type { RoomState } from '../multiplayer/protocol';
import { escape, icon } from './icons';
export function resultsMarkup(room: RoomState, ownId: string): string {
  const r = room.results,
    owner = room.ownerId === ownId;
  if (!r)
    return `<span class="panel-eyebrow">NETWORK DRILL CONCLUDED</span><h2>FIELD TEST<br>COMPLETE<span>.</span></h2><p>Movement session ended. No combat statistics or rewards were recorded.</p>${owner ? `<button class="button primary full" data-action="return-lobby" data-return>RETURN TO LOBBY</button>` : '<p>Waiting for the room owner.</p>'}<button class="text-button" data-action="leave">LEAVE ROOM</button>`;
  const self = r.players.find((p) => p.id === ownId),
    outcome = self?.outcome ?? 'draw';
  const title = outcome === 'win' ? 'VICTORY' : outcome === 'loss' ? 'DEFEAT' : 'DRAW';
  const stats = self?.stats;
  const accuracy = stats?.shots ? Math.round((stats.hits / stats.shots) * 100) : 0;
  const rewards = r.practice
    ? 'BOT PRACTICE · PROGRESSION OFF'
    : r.persistence === 'saving'
      ? 'SAVING VERIFIED MATCH RESULTS…'
      : r.persistence === 'error'
        ? 'RESULT SAVE FAILED'
        : `${self?.xpEarned ?? 0} XP RECORDED · LEVEL ${self?.levelAfter ?? 1}`;
  return `<span class="panel-eyebrow">${r.practice ? 'PRIVATE BOT PRACTICE' : 'TEAM DEATHMATCH'} · ${escape(r.reason.replaceAll('_', ' ').toUpperCase())}</span><h2 class="outcome-${outcome}">${title}<span>.</span></h2><div class="result-team-scores"><span class="blue">B <b>${r.scores.blue}</b></span><i>:</i><span class="red"><b>${r.scores.red}</b> R</span></div><div class="result-personal"><span>KILLS<b>${stats?.kills ?? 0}</b></span><span>DEATHS<b>${stats?.deaths ?? 0}</b></span><span>K/D<b>${((stats?.kills ?? 0) / Math.max(1, stats?.deaths ?? 0)).toFixed(2)}</b></span><span>ACCURACY<b>${accuracy}%</b></span><span>HEADSHOTS<b>${stats?.headshots ?? 0}</b></span><span>DAMAGE<b>${Math.round(stats?.damage ?? 0)}</b></span></div><div class="result-reward">${icon('shield')}<span>${rewards}</span></div>${r.error ? `<p class="dialog-error">${escape(r.error)}</p><button class="button secondary full" data-action="retry-results">RETRY SAFE SAVE</button>` : ''}<div class="result-board">${r.players.map((p) => `<div><span class="${p.team}">${p.team === 'blue' ? 'B' : 'R'}</span><strong>${escape(p.name)}${p.isBot ? ' <small>BOT</small>' : ''}</strong><b>${p.stats.kills}</b><i>${p.stats.deaths}</i><span>${p.stats.score}</span></div>`).join('')}</div>${owner ? `<button class="button primary full" data-action="return-lobby" data-return ${r.persistence === 'saving' || r.persistence === 'error' ? 'disabled' : ''}>${icon('back')}REMATCH · RETURN TO LOBBY</button>` : '<p class="result-waiting">Waiting for the room owner to rematch.</p>'}<button class="text-button" data-action="leave">LEAVE MATCH</button>`;
}
