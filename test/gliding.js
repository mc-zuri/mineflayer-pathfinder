/* eslint-env mocha */
// Bedrock's elytra (Movements.allowGliding): a glide is a move from where the player stands to where it lands, taken
// off with a jump and a jump pressed anew in the air, boosted by the firework rockets it carries; only with the elytra
// worn.
const assert = require('assert')
const { Vec3 } = require('vec3')
const { bedrockBot, walkTo } = require('./bedrockBot')
const { pathfinder, Movements, goals } = require('..')

// ground at y 63 and under, and a tower 3 wide from it up to y 83 at x -1..1 (its top: feet at 84)
const tower = (x, y, z) => y < 64 || (Math.abs(x) <= 1 && Math.abs(z) <= 1 && y < 84) ? 'stone' : 'air'
const flat = (x, y) => y < 64 ? 'stone' : 'air'

function setup (layout, options) {
  const { bot, tick } = bedrockBot(layout, options)
  bot.loadPlugin(pathfinder)
  const movements = new Movements(bot)
  movements.canDig = false
  movements.scafoldingBlocks = []
  movements.allowParkour = false
  movements.allowGliding = true
  bot.pathfinder.setMovements(movements)
  return { bot, tick, movements }
}

function search (bot, movements, goal) {
  let result
  for ({ result } of bot.pathfinder.getPathFromTo(movements, bot.entity.position, goal, { timeout: 2000 }));
  return result
}

describe('elytra gliding on Bedrock', function () {
  this.timeout(60000)

  it('glides down from a tower it cannot climb down, and lands', function () {
    const { bot, tick } = setup(tower, { position: new Vec3(0.5, 84, 0.5), elytra: true })
    const ticks = walkTo(bot, tick, new goals.GoalBlock(30, 64, 0), 600)
    const pos = bot.entity.position
    assert.ok(Number.isFinite(ticks), `arrived: at ${pos}`)
    assert.ok(tick.seen.gliding > 10, `glided ${tick.seen.gliding} ticks`)
    assert.deepStrictEqual([Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)], [30, 64, 0])
    assert.strictEqual(tick.seen.collided, 0, 'ran into nothing')
    assert.deepStrictEqual(tick.seen.mismatches, [], 'every tick as predicted')
  })

  it('finds no glide without the elytra worn', function () {
    const { bot, movements } = setup(tower, { position: new Vec3(0.5, 84, 0.5), items: [{ name: 'firework_rocket', count: 16 }] })
    assert.notStrictEqual(search(bot, movements, new goals.GoalBlock(30, 64, 0)).status, 'success')
  })

  it('takes off from flat ground with firework rockets, and glides further than it walks', function () {
    const rockets = { name: 'firework_rocket', count: 16 }
    const { bot, tick, movements } = setup(flat, { elytra: true, items: [rockets] })
    const goal = new goals.GoalBlock(80, 64, 0)
    const path = search(bot, movements, goal).path
    assert.ok(path.some(step => step.glide), 'a glide in the plan')
    const ticks = walkTo(bot, tick, goal, 1200)
    assert.ok(Number.isFinite(ticks), `arrived: at ${bot.entity.position}`)
    assert.ok(tick.seen.boosted > 0 && rockets.count < 16, `boosted ${tick.seen.boosted} ticks, ${16 - rockets.count} rockets`)
    // (sprinting there: some 290 ticks)
    assert.ok(ticks < 200, `${ticks} ticks`)
    assert.deepStrictEqual(tick.seen.mismatches, [], 'every tick as predicted')
  })

  it('walks on flat ground without rockets', function () {
    const { bot, movements } = setup(flat, { elytra: true })
    const path = search(bot, movements, new goals.GoalBlock(40, 64, 0)).path
    assert.ok(!path.some(step => step.glide), 'no glide in the plan')
  })
})
