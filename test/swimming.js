/* eslint-env mocha */
// Swimming moves (Movements.allowSwimming, on for Bedrock): up and down through water, into the water ahead rather
// than over it, and out onto a bank; and none of it for Java, as before.
const assert = require('assert')
const { EventEmitter } = require('events')
const { Vec3 } = require('vec3')
const { Movements } = require('..')

function fixture (version) {
  const registry = require('minecraft-data')(version)
  const Block = require('prismarine-block')(registry)
  const blocks = new Map()
  const bot = new EventEmitter()
  bot.registry = registry
  bot.game = { minY: -64 }
  bot.entity = { position: new Vec3(0.5, 64, 0.5), effects: {}, onGround: false }
  bot.entities = {}
  bot.inventory = { items: () => [] }
  bot.pathfinder = { bestHarvestTool: () => null }
  bot.blockAt = p => {
    const position = p.floored()
    const b = Block.fromStateId(blocks.get(position.toString()) ?? registry.blocksByName.air.defaultState, 0)
    b.position = position
    return b
  }
  const put = (name, x, y, z) => blocks.set(new Vec3(x, y, z).toString(), registry.blocksByName[name].defaultState)
  // ground at y 63 and under, a pool x 1..3 from y 59 to 63 (its top is the ground's)
  for (let x = -2; x <= 5; x++) {
    for (let z = -2; z <= 2; z++) {
      for (let y = 55; y <= 63; y++) put(x >= 1 && x <= 3 && y >= 59 ? 'water' : 'stone', x, y, z)
    }
  }
  const movements = new Movements(bot)
  movements.canDig = false
  return { movements, put }
}

const node = (x, y, z, remainingBlocks = 0) => ({ x, y, z, remainingBlocks })
const at = moves => moves.map(m => `${m.x},${m.y},${m.z}`)

describe('swimming', function () {
  const versions = { bedrock: 'bedrock_1.21.100', java: '1.21.4' }

  it('is on for Bedrock only', function () {
    assert.strictEqual(fixture(versions.bedrock).movements.allowSwimming, true)
    assert.strictEqual(fixture(versions.java).movements.allowSwimming, false)
  })

  it('swims up and down through the water', function () {
    const { movements } = fixture(versions.bedrock)
    const moves = at(movements.getNeighbors(node(2, 61, 0)))
    assert.ok(moves.includes('2,62,0'), `up: ${moves}`)
    assert.ok(moves.includes('2,60,0'), `down: ${moves}`)
    assert.ok(!at(fixture(versions.java).movements.getNeighbors(node(2, 61, 0))).includes('2,62,0'))
  })

  it('swims up no higher than the water, nor down out of it', function () {
    const { movements } = fixture(versions.bedrock)
    assert.ok(!at(movements.getNeighbors(node(2, 63, 0))).includes('2,64,0'))
    assert.ok(!at(movements.getNeighbors(node(2, 59, 0))).includes('2,58,0'))
  })

  it('steps into the water ahead, building nothing', function () {
    const { movements } = fixture(versions.bedrock)
    const neighbors = []
    movements.getMoveForward(node(0, 64, 0, 64), { x: 1, z: 0 }, neighbors)
    assert.deepStrictEqual(at(neighbors), ['1,63,0'])
    assert.deepStrictEqual(neighbors[0].toPlace, [])
    // Java bridges over it
    const java = []
    fixture(versions.java).movements.getMoveForward(node(0, 64, 0, 64), { x: 1, z: 0 }, java)
    assert.deepStrictEqual(at(java), ['1,64,0'])
    assert.strictEqual(java[0].toPlace.length, 1)
  })

  it('climbs out onto the bank from the top of the water', function () {
    const { movements } = fixture(versions.bedrock)
    const neighbors = []
    movements.getMoveJumpUp(node(3, 63, 0, 64), { x: 1, z: 0 }, neighbors)
    assert.deepStrictEqual(at(neighbors), ['4,64,0'])
    const java = []
    fixture(versions.java).movements.getMoveJumpUp(node(3, 63, 0, 64), { x: 1, z: 0 }, java)
    assert.deepStrictEqual(java, [])
  })

  it('builds nothing to climb from the water', function () {
    const { movements, put } = fixture(versions.bedrock)
    // the bank gone: water, then air over the ground
    put('air', 4, 63, 0)
    const neighbors = []
    movements.getMoveJumpUp(node(3, 63, 0, 64), { x: 1, z: 0 }, neighbors)
    assert.deepStrictEqual(neighbors, [])
  })
})
