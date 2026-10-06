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

  it('glides up onto high ground with firework rockets, coming down onto it from above', function () {
    // (flat ground, and a plateau 7 wide and 10 high 40 blocks east: no way up but flying)
    const plateau = (x, y, z) => y < 64 || (x >= 40 && x <= 46 && Math.abs(z) <= 3 && y < 74) ? 'stone' : 'air'
    const rockets = { name: 'firework_rocket', count: 16 }
    const { bot, tick } = setup(plateau, { elytra: true, items: [rockets] })
    const ticks = walkTo(bot, tick, new goals.GoalBlock(43, 74, 0), 800)
    const pos = bot.entity.position
    assert.ok(Number.isFinite(ticks), `arrived: at ${pos}`)
    assert.deepStrictEqual([Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)], [43, 74, 0])
    assert.ok(rockets.count < 16, 'rockets used')
    assert.strictEqual(tick.seen.collided, 0, 'ran into nothing')
    assert.deepStrictEqual(tick.seen.mismatches, [], 'every tick as predicted')
  })

  it('lands where it can when its goal changes in the air: a glide cannot turn back on a dime', function () {
    const { bot, tick } = setup(tower, { position: new Vec3(0.5, 84, 0.5), elytra: true })
    bot.pathfinder.setGoal(new goals.GoalBlock(40, 64, 0))
    for (let i = 0; i < 25; i++) tick()
    assert.ok(bot.entity.elytraFlying, 'gliding')
    // a goal just behind it: no glide from the ground could be that short, but this one must land
    const goal = new goals.GoalBlock(Math.floor(bot.entity.position.x) - 3, 64, 0)
    const ticks = walkTo(bot, tick, goal, 400)
    assert.ok(Number.isFinite(ticks), `arrived: at ${bot.entity.position}`)
    assert.deepStrictEqual(tick.seen.mismatches, [], 'every tick as predicted')
  })

  it('plans the rest of the way when its last step is reached and its goal is not (a glide landing beside it)', function () {
    // a goal the search takes at x 20 that then wants x 21: the walk ends a step short of it
    const { bot, tick } = setup(flat, {})
    const goal = new goals.GoalBlock(20, 64, 0)
    let moved = false
    goal.isEnd = node => node.x === (moved ? 21 : 20) && node.y === 64 && node.z === 0
    bot.once('path_update', () => { moved = true })
    const ticks = walkTo(bot, tick, goal, 400)
    assert.ok(Number.isFinite(ticks), `arrived: at ${bot.entity.position}`)
    assert.strictEqual(Math.floor(bot.entity.position.x), 21)
  })

  it('walks on flat ground without rockets', function () {
    const { bot, movements } = setup(flat, { elytra: true })
    const path = search(bot, movements, new goals.GoalBlock(40, 64, 0)).path
    assert.ok(!path.some(step => step.glide), 'no glide in the plan')
  })
})
