// Test-only timezone environment: set the real worker's timezone before the
// Jest VM and the production module's cached Intl formatter are created.
const { TestEnvironment } = require('jest-environment-node');

class WorkoutPacificEnvironment extends TestEnvironment {
  constructor(config, context) {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    super(config, context);
    this.previousTimezone = previousTimezone;
  }

  async teardown() {
    await super.teardown();
    if (this.previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = this.previousTimezone;
  }
}

module.exports = WorkoutPacificEnvironment;
