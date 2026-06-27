// Persistent (or in-memory) store of learned GUI skills.
// A skill is a small reusable note about how to accomplish a task family in a UI,
// distilled from a failed-then-fixed trajectory.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export class SkillStore {
  constructor({ path = null } = {}) {
    this.path = path;
    this.skills = [];
    if (this.path && existsSync(this.path)) {
      this.skills = JSON.parse(readFileSync(this.path, 'utf8'));
    }
  }
  _save() {
    if (this.path) writeFileSync(this.path, JSON.stringify(this.skills, null, 2));
  }
  match(goal) {
    const g = goal.toLowerCase();
    return this.skills.filter((s) => s.tag === '*' || g.includes(s.tag));
  }
  add(skill) {
    this.skills.push(skill);
    this._save();
    return skill;
  }
  remove(id) {
    this.skills = this.skills.filter((s) => s.id !== id);
    this._save();
  }
  all() {
    return this.skills;
  }
}
