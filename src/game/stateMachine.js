// LOBBY -> ROLE_ASSIGN -> ROUND <-> MEETING -> GAME_OVER -> LOBBY
export const PHASES = ['LOBBY', 'ROLE_ASSIGN', 'ROUND', 'MEETING', 'GAME_OVER'];

const TRANSITIONS = {
  LOBBY: ['ROLE_ASSIGN'],
  ROLE_ASSIGN: ['ROUND', 'LOBBY', 'GAME_OVER'],
  ROUND: ['MEETING', 'GAME_OVER', 'LOBBY'],
  MEETING: ['ROUND', 'GAME_OVER', 'LOBBY'],
  GAME_OVER: ['LOBBY'],
};

export class StateMachine {
  constructor(initial = 'LOBBY') {
    this.phase = initial;
    this.listeners = new Set();
    this.enteredAt = Date.now();
  }
  can(next) { return (TRANSITIONS[this.phase] || []).includes(next); }
  transition(next, payload) {
    if (next === this.phase) return false;
    if (!this.can(next)) { console.warn(`Illegal transition ${this.phase} -> ${next}`); return false; }
    const prev = this.phase;
    this.phase = next;
    this.enteredAt = Date.now();
    for (const l of this.listeners) l(next, prev, payload);
    return true;
  }
  // used by clients mirroring the host: no legality check
  force(next, payload) {
    const prev = this.phase;
    this.phase = next;
    this.enteredAt = Date.now();
    for (const l of this.listeners) l(next, prev, payload);
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}
