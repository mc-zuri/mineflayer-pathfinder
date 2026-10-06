/* eslint-env mocha */
// Bedrock boats (Movements.allowBoats): a player with a boat puts it on the water beside the bank, gets in, paddles
// across and gets out onto the far bank, picking the boat up. The boat goes
// where the route goes, turning no more than it has to (it pursues a point ahead, minding the turn it is in), and every
// tick of it is the tick predicted. Without a boat it swims.
const assert = require('assert')
const { bedrockBot, walkTo } = require('./bedrockBot')
const { pathfinder, Movements, goals } = require('..')

// ground at y 63 and under, a lake from x 2 to x 21 (z -4 to 4) of water from y 58 up to its top at y 63
const lake = (x, y, z) => x >= 2 && x <= 21 && Math.abs(z) <= 4 && y >= 58 && y <= 63 ? 'water' : y < 64 ? 'stone' : 'air'
// the lake with an island in its middle (x 9 to 14, z -2 to 2), out of the water a block
const island = (x, y, z) => x >= 9 && x <= 14 && Math.abs(z) <= 2 && y <= 63 ? 'stone' : lake(x, y, z)
// a canal 3 wide east from x 2 to 12 (z -1 to 1), turning north along x 10 to 12 up to z -14, between walls 2 high;
// banks at its two ends
const canal = (x, y, z) => {
  const water = (x >= 2 && x <= 12 && Math.abs(z) <= 1) || (x >= 10 && x <= 12 && z >= -14 && z <= 1)
  if (water) return y >= 58 && y <= 63 ? 'water' : y < 58 ? 'stone' : 'air'
  const bank = (x >= -3 && x <= 1 && Math.abs(z) <= 1) || (x >= 9 && x <= 13 && z >= -17 && z <= -15)
  return y < 64 || (!bank && y < 66) ? 'stone' : 'air'
}

function setup (layout, items, allowBoats = true) {
  const { bot, tick, addBoat } = bedrockBot(layout, { items })
  bot.loadPlugin(pathfinder)
  const movements = new Movements(bot)
  movements.canDig = false
  movements.scafoldingBlocks = []
  movements.allowParkour = false
  movements.allowBoats = allowBoats
  bot.pathfinder.setMovements(movements)
  return { bot, tick, movements, addBoat }
}

const across = new goals.GoalBlock(23, 64, 0)
const boatItem = () => [{ name: 'oak_boat', count: 1 }]
const cell = pos => [Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)]

// a walk that must arrive, every tick as predicted: its ticks and what they went through
function crossing (layout, items, goal, maxTicks, before) {
  const trip = setup(layout, items)
  if (before) before(trip)
  const ticks = walkTo(trip.bot, trip.tick, goal, maxTicks)
  assert.ok(Number.isFinite(ticks), `arrived: at ${trip.bot.entity.position}`)
  assert.deepStrictEqual(cell(trip.bot.entity.position), [goal.x, goal.y, goal.z])
  assert.deepStrictEqual(trip.tick.seen.mismatches, [], 'every tick as predicted')
  return { ticks, seen: trip.tick.seen, bot: trip.bot, items }
}

describe('boats on Bedrock', function () {
  this.timeout(60000)

  it('crosses a lake in a boat, and picks the boat up on the far bank', function () {
    const { seen, bot, items } = crossing(lake, boatItem(), across, 800)
    assert.ok(seen.riding > 20, `rode ${seen.riding} ticks`)
    assert.strictEqual(items.find(item => /boat$/.test(item.name)).count, 1, 'the boat back')
    assert.deepStrictEqual(Object.keys(bot.entities), [], 'no boat left on the water')
    assert.ok(seen.turned < 30, `turned ${seen.turned.toFixed(0)}° going straight`)
  })

  it('crosses quicker in a boat than swimming', function () {
    const boated = crossing(lake, boatItem(), across, 800).ticks
    const swum = crossing(lake, [], across, 1200)
    assert.strictEqual(swum.seen.riding, 0, 'no boat: it swims')
    assert.ok(boated < swum.ticks, `${boated} ticks by boat, ${swum.ticks} swimming`)
  })

  it('follows a canal round its bend, turning no more than the bend', function () {
    const { ticks, seen } = crossing(canal, boatItem(), new goals.GoalBlock(11, 64, -16), 600)
    assert.ok(seen.riding > 20, `rode ${seen.riding} ticks`)
    // (a quarter turn, and the boat put on the water facing on)
    assert.ok(seen.turned < 180, `turned ${seen.turned.toFixed(0)}° for a bend of 90°`)
    assert.ok(ticks < 130, `${ticks} ticks`)
  })

  it('goes round an island in the lake', function () {
    const { seen } = crossing(island, boatItem(), across, 800)
    assert.ok(seen.riding > 20, `rode ${seen.riding} ticks`)
    assert.ok(seen.turned < 300, `turned ${seen.turned.toFixed(0)}°`)
  })

  it('finds no boat moves without a boat, nor when boats are not allowed', function () {
    const node = { x: 1, y: 64, z: 0, remainingBlocks: 0 }
    assert.ok(!setup(lake, []).movements.getNeighbors(node).some(move => move.boat))
    assert.ok(!setup(lake, boatItem(), false).movements.getNeighbors(node).some(move => move.boat))
    assert.ok(setup(lake, boatItem()).movements.getNeighbors(node).some(move => move.boat && move.board))
  })
})
