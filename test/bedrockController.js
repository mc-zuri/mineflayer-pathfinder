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

  it('swims sprinting where it looks: at the next point', () => {
    const physics = new Physics({ registry: { type: 'bedrock' }, blockAt: () => null })
    const state = { pos: new Vec3(0.5, 60, 0.5), yaw: 0, pitch: 0, control: {} }
    physics.getSwimController(new Vec3(3.5, 63, 0.5), { sprint: true, jump: false, sneak: false })(state, 0)
    assert.strictEqual(state.pitch, Math.PI / 4)
    assert.strictEqual(state.yaw, Math.atan2(-3, -0))
    assert.deepStrictEqual(state.control, { forward: true, jump: false, sneak: false, sprint: true })
    // straight up: no sprint, no turn, rising
    const above = { pos: new Vec3(3.45, 60, 0.5), yaw: 1, pitch: 0, control: {} }
    physics.getSwimController(new Vec3(3.5, 63, 0.5), { sprint: true, jump: true, sneak: false })(above, 0)
    assert.deepStrictEqual([above.yaw, above.pitch], [1, 0])
    assert.deepStrictEqual(above.control, { forward: false, jump: true, sneak: false, sprint: false })
  })
})
