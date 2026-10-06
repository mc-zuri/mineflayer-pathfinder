/* eslint-env mocha */
// The controller a prediction moves with turns the player as the executor does (monitorMovement: bot.look(yaw, 0)).
// On Bedrock the pitch moves a swimming player, so it is the executor's too.
const assert = require('assert')
const { Vec3 } = require('vec3')
const Physics = require('../lib/physics')

function controlled (type, pitch) {
  const physics = new Physics({ registry: { type }, blockAt: () => null })
  const state = { pos: new Vec3(0.5, 64, 0.5), yaw: 0, pitch, control: {} }
  physics.getController(new Vec3(3.5, 64, -2.5), false, true)(state, 0)
  return state
}

describe('prediction controller', () => {
  it('looks straight ahead toward the next point on Bedrock', () => {
    const state = controlled('bedrock', -0.6)
    assert.strictEqual(state.pitch, 0)
    assert.strictEqual(state.yaw, Math.atan2(-3, 3))
    assert.deepStrictEqual(state.control, { forward: true, jump: false, sprint: true })
  })

  it('keeps the pitch on Java', () => {
    assert.strictEqual(controlled('pc', -0.6).pitch, -0.6)
  })
})
