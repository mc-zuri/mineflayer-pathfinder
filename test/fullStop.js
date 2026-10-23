/* eslint-env mocha */
// Stopping on Bedrock: the keys are let go and the player slows down by itself. Its velocity and position are the
// server's on Bedrock (authoritative movement): set by the plugin, they are a teleport the server corrects.
const assert = require('assert')
const { bedrockBot, walkTo } = require('./bedrockBot')
const { pathfinder, Movements, goals } = require('..')

describe('stopping on Bedrock', function () {
  this.timeout(20000)

  it('never moves or slows the player itself', function () {
    const { bot, tick } = bedrockBot((x, y, z) => y < 64 ? 'stone' : 'air')
    bot.loadPlugin(pathfinder)
    const movements = new Movements(bot)
    movements.canDig = false
    movements.scafoldingBlocks = []
    bot.pathfinder.setMovements(movements)
    // off the middle of a block, sprinting: the stop at the goal would recenter it and cancel the sprint
    const ticks = walkTo(bot, tick, new goals.GoalNear(10, 64, 3, 1))
    for (let i = 0; i < 20; i++) tick()
    assert.ok(Number.isFinite(ticks), `arrived: at ${bot.entity.position}`)
    assert.strictEqual(tick.seen.teleports, 0, 'ticks that started from where the engine had not left the player')
  })
})
