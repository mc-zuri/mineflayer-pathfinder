/* eslint-env mocha */
// A jump up a block on Bedrock goes from far enough back to clear the block's edge: the player never runs into its
// side (a jump from the middle of the block before it rises too late, the engine's player needing three ticks to get
// a block up while a sprint covers most of the way to the side).
const assert = require('assert')
const { Vec3 } = require('vec3')
const { bedrockBot, walkTo } = require('./bedrockBot')
const { pathfinder, Movements, goals } = require('..')

// ground at y 63 and under; from x 4 on, a block higher (a step up along +x), and another from x 8 on
const steps = (x, y) => y < 64 || (x >= 4 && y < 65) || (x >= 8 && y < 66) ? 'stone' : 'air'

function walk (sprint) {
  const { bot, tick } = bedrockBot((x, y, z) => steps(x, y))
  bot.loadPlugin(pathfinder)
  const movements = new Movements(bot)
  movements.canDig = false
  movements.allowSprinting = sprint
  movements.scafoldingBlocks = []
  bot.pathfinder.setMovements(movements)
  const ticks = walkTo(bot, tick, new goals.GoalBlock(11, 66, 0))
  return { ticks, seen: tick.seen, at: bot.entity.position }
}

describe('jumping up a block on Bedrock', function () {
  this.timeout(20000)

  for (const sprint of [true, false]) {
    it(`never runs into the block's side (${sprint ? 'sprinting' : 'walking'})`, function () {
      const { ticks, seen, at } = walk(sprint)
      assert.ok(Number.isFinite(ticks), `arrived: at ${at}`)
      assert.ok(at.distanceTo(new Vec3(11.5, 66, 0.5)) < 1, `at the goal: ${at}`)
      assert.strictEqual(seen.collided, 0, `ticks against a block's side, of ${ticks}`)
      assert.deepStrictEqual(seen.mismatches, [], 'every tick as predicted')
    })
  }

  it('sprints up sooner than it walks up', function () {
    // (running into the side, the sprint is lost: it took as long as the walk)
    const sprinted = walk(true).ticks
    const walked = walk(false).ticks
    assert.ok(sprinted < walked * 0.8, `sprinting ${sprinted} ticks, walking ${walked}`)
  })
})
