/* eslint-env mocha */
// On Bedrock nothing stops the player but the engine's friction (the executor's fullStop writes velocity to a copy, as
// a client gives the bot's): the last step is reached once the player has slowed in it, not sliding through it, so the
// walk ends with the player in the goal's cell.
const assert = require('assert')
const { Vec3 } = require('vec3')
const { bedrockBot, walkTo } = require('./bedrockBot')
const { pathfinder, Movements, goals } = require('..')

const flat = (x, y) => y < 64 ? 'stone' : 'air'

describe('stopping on Bedrock', function () {
  this.timeout(20000)

  it('ends a walk in the goal\'s cell, sliding into it fast (a glide landing)', function () {
    const { bot, tick } = bedrockBot(flat)
    bot.loadPlugin(pathfinder)
    const movements = new Movements(bot)
    movements.canDig = false
    movements.scafoldingBlocks = []
    bot.pathfinder.setMovements(movements)
    // (sliding along +x as a glide lands)
    bot.entity.velocity = new Vec3(0.7, 0, 0)
    const ticks = walkTo(bot, tick, new goals.GoalBlock(1, 64, 0), 200)
    assert.ok(Number.isFinite(ticks), `arrived: at ${bot.entity.position}`)
    // (drifting to a stop as a prediction shows it: every tick but the first, the plan's, a prediction's)
    assert.ok(tick.seen.ticks - tick.seen.predicted <= 1, `${tick.seen.ticks - tick.seen.predicted} of ${tick.seen.ticks} ticks without a prediction`)
    assert.deepStrictEqual(tick.seen.mismatches, [], 'every tick as predicted')
    for (let i = 0; i < 20; i++) tick()
    assert.strictEqual(Math.floor(bot.entity.position.x), 1, `still in the goal's cell: at ${bot.entity.position}`)
  })
})
