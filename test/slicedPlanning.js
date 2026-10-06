/* eslint-env mocha */
// A search planned a slice a tick (a page keeps each tick short), the player acting on the best path found so far
// meanwhile: it still gets there, every tick as predicted, planning on rather than starting over. (tickNodes 1: a node a
// tick, the same every time.)
const assert = require('assert')
const { Vec3 } = require('vec3')
const { bedrockBot, walkTo } = require('./bedrockBot')
const { pathfinder, Movements, goals } = require('..')

const plateau = (x, y, z) => y < 64 || (x >= 40 && x <= 46 && Math.abs(z) <= 3 && y < 74) ? 'stone' : 'air'
const tower = (x, y, z) => y < 64 || (Math.abs(x) <= 1 && Math.abs(z) <= 1 && y < 84) ? 'stone' : 'air'
const canal = (x, y, z) => {
  const water = (x >= 2 && x <= 12 && Math.abs(z) <= 1) || (x >= 10 && x <= 12 && z >= -14 && z <= 1)
  if (water) return y >= 58 && y <= 63 ? 'water' : y < 58 ? 'stone' : 'air'
  const bank = (x >= -3 && x <= 1 && Math.abs(z) <= 1) || (x >= 9 && x <= 13 && z >= -17 && z <= -15)
  return y < 64 || (!bank && y < 66) ? 'stone' : 'air'
}
// a wall 3 high along x 5 from z -12 to 12: a goal behind it is a long way round, the best path so far ending at it
const wall = (x, y, z) => y < 64 || (x === 5 && Math.abs(z) <= 12 && y < 67) ? 'stone' : 'air'
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

  it('glides up onto a plateau with rockets', function () {
    const seen = sliced(plateau, { elytra: true, items: [{ name: 'firework_rocket', count: 16 }] }, { allowGliding: true }, new goals.GoalBlock(43, 74, 0), 1200, ['glide'])
    assert.ok(seen.gliding > 0)
  })

  it('glides down from a tower, ending on its goal rather than sliding past it', function () {
    const seen = sliced(tower, { position: new Vec3(0.5, 84, 0.5), elytra: true }, { allowGliding: true }, new goals.GoalBlock(30, 64, 0), 1200, ['glide'])
    assert.ok(seen.gliding > 0)
  })

  it('takes a boat round a canal\'s bend', function () {
    const seen = sliced(canal, { items: [{ name: 'oak_boat', count: 1 }] }, { allowBoats: true }, new goals.GoalBlock(11, 64, -16), 1200)
    assert.ok(seen.riding > 0)
  })

  it('walks round a wall, planning on when the best path so far ends at it', function () {
    const { bot, tick } = bedrockBot(wall)
    bot.loadPlugin(pathfinder)
    bot.pathfinder.tickTimeout = Infinity
    bot.pathfinder.tickNodes = 1
    const movements = new Movements(bot)
    movements.canDig = false
    movements.scafoldingBlocks = []
    movements.allowParkour = false
    bot.pathfinder.setMovements(movements)
    const resets = []
    bot.on('path_reset', reason => resets.push(reason))
    const ticks = walkTo(bot, tick, new goals.GoalBlock(8, 64, 0), 1500)
    assert.ok(Number.isFinite(ticks), `arrived: at ${bot.entity.position}`)
    assert.ok(!resets.includes('goal_missed'), `planned over ${resets.filter(r => r === 'goal_missed').length} times`)
    assert.deepStrictEqual(tick.seen.mismatches, [], 'every tick as predicted')
  })

  it('sprints up steps', function () {
    sliced((x, y, z) => steps(x, y), {}, {}, new goals.GoalBlock(11, 66, 0), 1200)
  })
})
