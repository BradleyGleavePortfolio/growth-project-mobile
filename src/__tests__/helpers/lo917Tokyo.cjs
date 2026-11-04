// Test-only timezone environment (Asia/Tokyo), same shape as lsWorkoutPacific187.cjs.
const { TestEnvironment } = require('jest-environment-node');

class Lo917TokyoEnvironment extends TestEnvironment {
  constructor(config, context) {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'Asia/Tokyo';
    super(config, context);
    this.previousTimezone = previousTimezone;
  }

  async teardown() {
    await super.teardown();
    if (this.previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = this.previousTimezone;
  }
}

module.exports = Lo917TokyoEnvironment;
