// A bot on the Bedrock engine (prismarine-physics' fork, installed as prismarine-physics-bedrock beside the viewer this
// fork is tested from), ticked as a client ticks it: the plugin acts on 'physicsTick', then the engine steps the player
// with the keys and the look the plugin left. No server corrects it, so the player moves as the plugin's predictions
// say it will.
//
//   const { bot, world, tick } = bedrockBot((x, y, z) => y < 64 ? 'stone' : 'air')
//   bot.loadPlugin(pathfinder) ... tick()   // one tick; tick.seen counts what the ticks went through
const { EventEmitter } = require('events')
const { Vec3 } = require('vec3')

require('prismarine-physics-bedrock/lib/ts-hooks')
// mineflayer-pathfinder predicts with prismarine-physics' PlayerState: the fork's, as the viewer has it
const physicsFile = require.resolve('prismarine-physics')
require.cache[physicsFile] = { id: physicsFile, filename: physicsFile, loaded: true, exports: require('prismarine-physics-bedrock') }
for (const file of Object.keys(require.cache)) {
  if (/mineflayer-pathfinder[\\/](index|lib[\\/]\w+)\.js$/.test(file)) delete require.cache[file]
}
const { Physics, PlayerState } = require('prismarine-physics-bedrock')
const { cloneValue } = require('prismarine-physics-bedrock/lib/bedrock/network/rewind.ts')

const VERSION = 'bedrock_1.21.100'
const KEYS = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak']

// The blocks by name at each cell (the layout), set ones over it
function worldOf (registry, layout) {
  const Block = require('prismarine-block')(registry)
  const placed = new Map()
  const cache = new Map()
  const nameAt = (x, y, z) => placed.get(`${x},${y},${z}`) ?? layout(x, y, z)
  return {
    getBlock (pos) {
      const x = Math.floor(pos.x)
      const y = Math.floor(pos.y)
      const z = Math.floor(pos.z)
      const key = `${x},${y},${z}`
      let block = cache.get(key)
      if (!block) {
        block = Block.fromStateId(registry.blocksByName[nameAt(x, y, z)].defaultState, 0)
        block.position = new Vec3(x, y, z)
        cache.set(key, block)
      }
      return block
    },
    set (x, y, z, name) {
      placed.set(`${x},${y},${z}`, name)
      cache.delete(`${x},${y},${z}`)
    }
  }
}

// items: the hotbar ({ name, count }); elytra: worn
function bedrockBot (layout, { position = new Vec3(0.5, 64, 0.5), gameMode = 'survival', items = [], elytra = false } = {}) {
  const registry = require('prismarine-registry')(VERSION)
  const world = worldOf(registry, layout)
  const physics = Physics(registry, world)
  const bot = new EventEmitter()
  Object.assign(bot, {
    registry,
    version: VERSION,
    game: { minY: -64, gameMode },
    entity: { position, velocity: new Vec3(0, 0, 0), onGround: true, yaw: 0, pitch: 0, effects: {}, attributes: {}, metadata: { flags: {} } },
    entities: {},
    jumpTicks: 0,
    jumpQueued: false,
    fireworkRocketDuration: 0,
    abilities: { flags: { mayFly: gameMode === 'creative' } },
    food: 20,
    inventory: { items: () => items.filter(item => item.count > 0), slots: new Array(46).fill(null) },
    heldItem: null,
    equip: async item => { bot.heldItem = item },
    // the held item used: a firework rocket boosts the glide on the next tick, and goes
    activateItem () {
      if (bot.heldItem?.name !== 'firework_rocket' || !bot.heldItem.count) return
      bot.heldItem.count--
      bot.fireworkUsed = true
    },
    controlState: Object.fromEntries(KEYS.map(key => [key, false])),
    blockAt: pos => world.getBlock(pos),
    setControlState (control, pressed) { bot.controlState[control] = pressed },
    clearControlStates () { for (const key of KEYS) bot.controlState[key] = false },
    look: async (yaw, pitch) => { bot.entity.yaw = yaw; bot.entity.pitch = pitch },
    lookAt: async () => {},
    physics: { simulatePlayer: (state, w) => physics.simulatePlayer(state, w) },
    loadPlugin: plugin => plugin(bot)
  })

  if (elytra) bot.inventory.slots[6] = { name: 'elytra', count: 1 }
  // the engine's state of the player: a copy to each prediction, as a client gives it (a prediction changes its own)
  let engineState
  Object.defineProperty(bot, 'bedrockPhysicsState', {
    get: () => engineState === undefined ? undefined : cloneValue(engineState),
    set: value => { engineState = value }
  })

  // the ticks so far, and what they went through
  const seen = { ticks: 0, collided: 0, airborne: 0, gliding: 0, boosted: 0 }
  function tick () {
    bot.emit('physicsTick')
    const state = new PlayerState(bot, { ...bot.controlState })
    physics.simulatePlayer(state, world)
    state.apply(bot)
    seen.ticks++
    if (state.isCollidedHorizontally) seen.collided++
    if (!state.onGround) seen.airborne++
    if (state.elytraFlying) seen.gliding++
    if (state.fireworkRocketDuration > 0) seen.boosted++
  }
  tick.seen = seen
  return { bot, world, tick, physics }
}

// Walks the bot to a goal with the plugin, a tick at a time: the ticks it took, or Infinity
function walkTo (bot, tick, goal, maxTicks = 400) {
  const walk = { reached: false }
  bot.once('goal_reached', () => { walk.reached = true })
  bot.pathfinder.setGoal(goal)
  let ticks = 0
  while (ticks < maxTicks && !walk.reached) {
    tick()
    ticks++
  }
  return walk.reached ? ticks : Infinity
}

module.exports = { bedrockBot, walkTo, VERSION }
