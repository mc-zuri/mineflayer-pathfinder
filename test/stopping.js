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

describe('the walk\'s clock', function () {
  this.timeout(20000)

  it('tells a step taking too long by the clock given, its ticks\' time', function () {
    const { bot, tick, world } = bedrockBot(flat)
    bot.loadPlugin(pathfinder)
    const movements = new Movements(bot)
    movements.canDig = false
    movements.scafoldingBlocks = []
    bot.pathfinder.setMovements(movements)
    // (50 ms a tick, as a client's ticks go; the machine runs them far faster)
    let ticks = 0
    bot.pathfinder.now = () => ticks * 50
    const resets = []
    bot.on('path_reset', reason => resets.push({ reason, ticks }))
    bot.pathfinder.setGoal(new goals.GoalBlock(10, 64, 0))
    tick()
    ticks++
    // a wall across the way, after the plan (no block update tells of it)
    for (let z = -3; z <= 3; z++) for (let y = 64; y <= 66; y++) world.set(3, y, z, 'stone')
    while (ticks < 120 && !resets.some(r => r.reason === 'stuck')) {
      tick()
      ticks++
    }
    const stuck = resets.find(r => r.reason === 'stuck')
    assert.ok(stuck, `no step taking too long told: ${JSON.stringify(resets)}`)
    // (3.5 seconds of ticks, 70, after the last step it reached: a few ticks into the walk)
    assert.ok(stuck.ticks >= 70 && stuck.ticks <= 90, `told after ${stuck.ticks} ticks`)
  })
})
