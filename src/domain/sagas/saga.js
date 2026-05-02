export class Saga {
  constructor(id, type, initialState = {}) {
    this.id = id;
    this.type = type;
    this.state = initialState;
    this.status = 'active'; // 'active' | 'completed' | 'cancelled'
    this.steps = [];
    this.createdAt = new Date().toISOString();
  }

  recordStep(stepName, data = {}) {
    this.steps.push({ stepName, data, timestamp: new Date().toISOString() });
  }

  complete() { this.status = 'completed'; }
  cancel() { this.status = 'cancelled'; }
  isActive() { return this.status === 'active'; }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      state: this.state,
      status: this.status,
      steps: this.steps,
      createdAt: this.createdAt,
    };
  }

  static fromJSON(json) {
    const saga = new Saga(json.id, json.type, json.state);
    saga.status = json.status;
    saga.steps = json.steps || [];
    saga.createdAt = json.createdAt;
    return saga;
  }
}
