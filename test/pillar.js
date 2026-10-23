/* eslint-env mocha */
// Pillaring up: the block under the feet is placed once the feet are above it. Placed any sooner, the server refuses
// it (it would be inside the player), and under a low ceiling the jump is too short to try again in time.
const assert = require('assert')
const { Vec3 } = require('vec3')
const { bedrockBot } = require('./bedrockBot')
const { pathfinder, Movements, goals } = require('..')

async function pillar (ceiling) {
  const registry = require('prismarine-registry')('bedrock_1.21.100')
  const items = [{ name: 'dirt', type: registry.itemsByName.dirt.id, count: 16 }]
  // ground at y 63; with a ceiling, leaves 3 blocks over the top of the pillar (the jump capped there)
  const layout = (x, y, z) => y < 64 ? 'stone' : ceiling && y === 70 ? 'oak_leaves' : 'air'
  const { bot, tick } = bedrockBot(layout, { items })
  bot.loadPlugin(pathfinder)
  const movements = new Movements(bot)
  movements.canDig = false
  movements.allowParkour = false
  movements.scafoldingBlocks = [registry.itemsByName.dirt.id]
  bot.pathfinder.setMovements(movements)
  // (a tick at a time, the placements' promises settling in between, as between two ticks of a client)
  const walk = { reached: false }
  bot.once('goal_reached', () => { walk.reached = true })
  bot.pathfinder.setGoal(new goals.GoalBlock(0, 67, 0))
  let ticks = 0
  for (; ticks < 600 && !walk.reached; ticks++) {
    tick()
    await new Promise(resolve => setImmediate(resolve))
  }
  return { ticks: walk.reached ? ticks : Infinity, at: bot.entity.position, refused: bot.refused }
}

describe('pillaring up on Bedrock', function () {
  this.timeout(20000)

  for (const ceiling of [false, true]) {
    it(`places each block once the feet are above it (${ceiling ? 'under a low ceiling' : 'in the open'})`, async function () {
      const { ticks, at, refused } = await pillar(ceiling)
      assert.ok(Number.isFinite(ticks), `arrived: at ${at}`)
      assert.ok(at.distanceTo(new Vec3(0.5, 67, 0.5)) < 1, `at the top: ${at}`)
      assert.strictEqual(refused, 0, 'placements refused')
    })
  }
})
