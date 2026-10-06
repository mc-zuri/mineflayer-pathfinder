/* eslint-env mocha */
// A search planned a slice a tick (a page keeps each tick short), the player acting on the best path found so far
// meanwhile: it still gets there, every tick as predicted, planning on rather than starting over. (tickNodes 1: a node a
// tick, the same every time.)
const assert = require('assert')
const { bedrockBot, walkTo } = require('./bedrockBot')
const { pathfinder, Movements, goals } = require('..')

const steps = (x, y) => y < 64 || (x >= 4 && y < 65) || (x >= 8 && y < 66) ? 'stone' : 'air'

// (replans: those a walk may make, a glide's: a glide is planned from where it takes off, and the player may have gone
// on from there along the best path so far)
function sliced (layout, options, allow, goal, maxTicks, replans = []) {
  const { bot, tick } = bedrockBot(layout, options)
  bot.loadPlugin(pathfinder)
  bot.pathfinder.tickTimeout = Infinity
  bot.pathfinder.tickNodes = 1
  const movements = new Movements(bot)
  movements.canDig = false
  movements.scafoldingBlocks = []
  movements.allowParkour = false
  Object.assign(movements, allow)
  bot.pathfinder.setMovements(movements)
  const resets = []
  bot.on('path_reset', reason => resets.push(reason))
  const ticks = walkTo(bot, tick, goal, maxTicks)
  const pos = bot.entity.position
  assert.ok(Number.isFinite(ticks), `arrived: at ${pos}, the search reset ${resets.join(', ') || 'never'}`)
  assert.deepStrictEqual([Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)], [goal.x, goal.y, goal.z])
  assert.deepStrictEqual(tick.seen.mismatches, [], 'every tick as predicted')
  assert.deepStrictEqual(resets.filter(reason => !replans.includes(reason)), [], 'planned on, never over')
  return tick.seen
}

describe('planning a slice a tick on Bedrock', function () {
  this.timeout(120000)

  it('expands no more nodes a tick than tickNodes', function () {
    const { bot } = bedrockBot((x, y, z) => steps(x, y))
    bot.loadPlugin(pathfinder)
    const movements = new Movements(bot)
    const searches = bot.pathfinder.getPathFromTo(movements, bot.entity.position, new goals.GoalBlock(11, 66, 0), { tickTimeout: Infinity, tickNodes: 1 })
    const { result } = searches.next().value
    assert.strictEqual(result.status, 'partial')
    assert.strictEqual(result.visitedNodes, 1)
  })

  it('sprints up steps', function () {
    sliced((x, y, z) => steps(x, y), {}, {}, new goals.GoalBlock(11, 66, 0), 1200)
  })
})
