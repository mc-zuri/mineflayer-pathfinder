/* eslint-env mocha */
// A search out of time still gives its best partial path: the bot walks it, then searches again from there, and gets
// to the goal in steps. goto keeps waiting meanwhile instead of rejecting on the first timeout.
const assert = require('assert')
const { Vec3 } = require('vec3')
const { bedrockBot, walkTo } = require('./bedrockBot')
const { pathfinder, Movements, goals } = require('..')

function setup () {
  const { bot, tick } = bedrockBot((x, y, z) => y < 64 ? 'stone' : 'air')
  bot.loadPlugin(pathfinder)
  const movements = new Movements(bot)
  movements.canDig = false
  movements.scafoldingBlocks = []
  bot.pathfinder.setMovements(movements)
  bot.pathfinder.thinkTimeout = 3 // every search runs out of time
  return { bot, tick }
}

describe('search out of time', function () {
  this.timeout(20000)

  it('walks the partial path and searches again until the goal', function () {
    const { bot, tick } = setup()
    const ticks = walkTo(bot, tick, new goals.GoalBlock(40, 64, 0), 600)
    assert.ok(Number.isFinite(ticks), `arrived: at ${bot.entity.position}`)
    assert.ok(bot.entity.position.distanceTo(new Vec3(40.5, 64, 0.5)) < 1)
  })

  it('goto does not reject while there is a partial path', async function () {
    const { bot, tick } = setup()
    const state = { result: null }
    bot.pathfinder.goto(new goals.GoalBlock(40, 64, 0)).then(() => { state.result = 'done' }, err => { state.result = err.name })
    for (let i = 0; i < 600 && state.result === null; i++) { tick(); await new Promise(resolve => setTimeout(resolve, 0)) }
    assert.strictEqual(state.result, 'done', `at ${bot.entity.position}`)
  })
})
