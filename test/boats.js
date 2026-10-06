/* eslint-env mocha */
// Bedrock boats (Movements.allowBoats): a player with a boat puts it on the water beside the bank, gets in, paddles
// across and gets out onto the far bank, picking the boat up; as the engine paddles a boat. Without a boat it swims.
const assert = require('assert')
const { bedrockBot, walkTo } = require('./bedrockBot')
const { pathfinder, Movements, goals } = require('..')

// ground at y 63 and under, a lake from x 2 to x 21 (z -4 to 4) of water from y 58 up to its top at y 63
const lake = (x, y, z) => x >= 2 && x <= 21 && Math.abs(z) <= 4 && y >= 58 && y <= 63 ? 'water' : y < 64 ? 'stone' : 'air'

function setup (items, allowBoats = true) {
  const { bot, tick } = bedrockBot(lake, { items })
  bot.loadPlugin(pathfinder)
  const movements = new Movements(bot)
  movements.canDig = false
  movements.scafoldingBlocks = []
  movements.allowParkour = false
  movements.allowBoats = allowBoats
  bot.pathfinder.setMovements(movements)
  return { bot, tick, movements }
}

const goal = new goals.GoalBlock(23, 64, 0)

describe('boats on Bedrock', function () {
  this.timeout(60000)

  it('crosses a lake in a boat, and picks the boat up on the far bank', function () {
    const boat = { name: 'oak_boat', count: 1 }
    const items = [boat]
    const { bot, tick } = setup(items)
    const ticks = walkTo(bot, tick, goal, 800)
    const pos = bot.entity.position
    assert.ok(Number.isFinite(ticks), `arrived: at ${pos}`)
    assert.ok(tick.seen.riding > 20, `rode ${tick.seen.riding} ticks`)
    assert.deepStrictEqual([Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)], [23, 64, 0])
    assert.strictEqual(items.find(item => /boat$/.test(item.name)).count, 1, 'the boat back')
    assert.deepStrictEqual(Object.keys(bot.entities), [], 'no boat left on the water')
  })

  it('crosses quicker in a boat than swimming', function () {
    const byBoat = setup([{ name: 'oak_boat', count: 1 }])
    const swimming = setup([], true)
    const boated = walkTo(byBoat.bot, byBoat.tick, goal, 800)
    const swum = walkTo(swimming.bot, swimming.tick, goal, 1200)
    assert.strictEqual(swimming.tick.seen.riding, 0, 'no boat: it swims')
    assert.ok(boated < swum, `${boated} ticks by boat, ${swum} swimming`)
  })

  it('finds no boat moves without a boat, nor when boats are not allowed', function () {
    const node = { x: 1, y: 64, z: 0, remainingBlocks: 0 }
    assert.ok(!setup([]).movements.getNeighbors(node).some(move => move.boat))
    assert.ok(!setup([{ name: 'oak_boat', count: 1 }], false).movements.getNeighbors(node).some(move => move.boat))
    assert.ok(setup([{ name: 'oak_boat', count: 1 }]).movements.getNeighbors(node).some(move => move.boat && move.board))
  })
})
