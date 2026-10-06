/* eslint-env mocha */
// Bedrock's creative flight (Movements.allowFlying, set for a player that may fly): it takes off with a double jump,
// flies through the air and lands with another, as the engine moves a creative player; and none of it otherwise.
const assert = require('assert')
const { bedrockBot, walkTo } = require('./bedrockBot')
const { pathfinder, Movements, goals } = require('..')

// ground at y 63 and under, but for a chasm from x 3 to x 22 all the way down
const chasm = (x, y) => y < 64 && (x < 3 || x > 22) ? 'stone' : 'air'

function setup (allowFlying, gameMode = 'creative') {
  const { bot, tick } = bedrockBot((x, y, z) => chasm(x, y), { gameMode })
  bot.loadPlugin(pathfinder)
  const movements = new Movements(bot)
  movements.canDig = false
  movements.scafoldingBlocks = []
  movements.allowFlying = allowFlying
  bot.pathfinder.setMovements(movements)
  return { bot, tick, movements }
}

const at = moves => moves.map(m => m.hash)
const node = (x, y, z, fly) => {
  const n = { x, y, z, remainingBlocks: 0 }
  if (fly) n.fly = true
  return n
}

describe('creative flight on Bedrock', function () {
  this.timeout(20000)

  it('takes off only when it may fly', function () {
    const { movements } = setup(false)
    assert.ok(!at(movements.getNeighbors(node(0, 64, 0))).includes('0,65,0:fly'))
    movements.allowFlying = true
    assert.ok(at(movements.getNeighbors(node(0, 64, 0))).includes('0,65,0:fly'))
  })

  it('flies every way through the air, and lands on the ground under it', function () {
    const { movements } = setup(true)
    const moves = at(movements.getNeighbors(node(1, 64, 0, true)))
    for (const to of ['0,64,0:fly', '2,64,0:fly', '1,64,1:fly', '2,64,1:fly', '1,65,0:fly']) assert.ok(moves.includes(to), `${to} in ${moves}`)
    // the ground under it: no flying into it, landing on it (a walked step)
    assert.ok(!moves.includes('1,63,0:fly'))
    assert.ok(moves.includes('1,64,0'))
    // over the chasm, down and no landing
    const over = at(movements.getNeighbors(node(10, 64, 0, true)))
    assert.ok(over.includes('10,63,0:fly') && !over.includes('10,64,0'), `${over}`)
  })

  it('crosses a chasm flying, and lands at the goal', function () {
    const { bot, tick } = setup(true)
    let flew = 0
    const ticks = walkTo(bot, () => { tick(); if (bot.bedrockPhysicsState?.flying) flew++ }, new goals.GoalBlock(26, 64, 0), 600)
    const pos = bot.entity.position
    assert.ok(Number.isFinite(ticks), `arrived: at ${pos}`)
    assert.ok(flew > 0, 'it flew')
    assert.ok(!bot.bedrockPhysicsState.flying, 'it landed')
    assert.deepStrictEqual([Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)], [26, 64, 0])
    assert.ok(bot.entity.onGround)
    assert.deepStrictEqual(tick.seen.mismatches, [], 'every tick as predicted')
  })

  it('finds the way across only when it may fly', function () {
    const search = allowFlying => {
      const { bot, movements } = setup(allowFlying)
      let status
      for (const { result } of bot.pathfinder.getPathFromTo(movements, bot.entity.position, new goals.GoalBlock(26, 64, 0), { timeout: 300 })) status = result.status
      return status
    }
    assert.strictEqual(search(true), 'success')
    assert.notStrictEqual(search(false), 'success')
  })
})
