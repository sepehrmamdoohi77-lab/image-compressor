// Singleton owner of the Game instance shared by all React components.
import { Game } from '../game/core/Game';

class GameBridge {
  game: Game | null = null;

  create(): Game {
    if (!this.game) this.game = new Game();
    return this.game;
  }

  destroy(): void {
    this.game?.dispose();
    this.game = null;
  }
}

export const bridge = new GameBridge();
