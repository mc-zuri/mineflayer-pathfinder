// A bot on the Bedrock engine (prismarine-physics' fork, installed as prismarine-physics-bedrock beside the viewer this
// fork is tested from), ticked as a client ticks it: the plugin acts on 'physicsTick', then the engine steps the player
// with the keys and the look the plugin left. No server corrects it, so the player moves as the plugin's predictions
// say it will: each tick is held to them (tick.seen.mismatches, as the viewer's audit.js), the tick that follows a
// prediction's first tick with the same keys and look being that tick, the boat and its turn included.
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
const { isDeepStrictEqual } = require('util')

// The inputs of a tick, and the player after it, to compare
const inputsOf = (control, yaw, pitch) => ({ ...Object.fromEntries(KEYS.map(key => [key, !!control[key]])), yaw, pitch })
function snapshot (state) {
  const v = state.vehicle
  return {
    pos: [state.pos.x, state.pos.y, state.pos.z],
    vel: [state.vel.x, state.vel.y, state.vel.z],
    onGround: !!state.onGround,
    elytraFlying: !!state.elytraFlying,
    fireworkRocketDuration: state.fireworkRocketDuration ?? 0,
    vehicle: v ? { pos: [v.pos.x, v.pos.y, v.pos.z], vel: [v.vel.x, v.vel.y, v.vel.z], yaw: v.yaw, turn: v.boat?.yRotD } : null
  }
}

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
  const { mt19937FromSeed } = require('prismarine-physics-bedrock/lib/bedrock/math/mt19937.ts')
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
    // (the first tick of each prediction since the last tick is kept, to hold the tick to)
    physics: {
      simulatePlayer: (state, w) => {
        // (a prediction from elsewhere than the player, a glide tried from a node of a search, is no prediction of it)
        if (!runs.has(state) && !elsewhere.has(state) && !state.pos.equals(bot.entity.position)) elsewhere.add(state)
        const inputs = inputsOf(state.control, state.yaw, state.pitch)
        physics.simulatePlayer(state, w)
        if (!runs.has(state) && !elsewhere.has(state)) runs.set(state, { inputs, after: snapshot(state) })
        return state
      }
    },
    loadPlugin: plugin => plugin(bot)
  })

  if (elytra) bot.inventory.slots[6] = { name: 'elytra', count: 1 }

  // boats, as a client has them: an entity put on the water (placeEntity), got in (mount: the engine's vehicle, as
  // bedrock-demo's riding keeps it), got out of (dismount: the engine's dismount spot) and broken (attack: the item back)
  let nextEntityId = 1
  let vehicle
  let randomState = mt19937FromSeed(1)
  Object.defineProperty(bot, 'bedrockVehicle', {
    get: () => vehicle === undefined ? undefined : cloneValue(vehicle),
    set: value => { vehicle = value }
  })
  Object.defineProperty(bot, 'bedrockRandomState', { get: () => new Uint8Array(randomState) })
  bot.vehicle = null
  bot.placeEntity = async (block, face) => {
    const item = bot.heldItem
    if (!/boat$/.test(item?.name ?? '') || !item.count) throw new Error('no boat in hand')
    item.count--
    const id = nextEntityId++
    const entity = { id, name: 'boat', position: new Vec3(block.position.x + 0.5, Math.fround(block.position.y + 0.95), block.position.z + 0.5), yaw: 180 - (bot.entity.yaw * 180) / Math.PI + 90 }
    bot.entities[id] = entity
    return entity
  }
  // a boat floating somewhere already (yaw: Bedrock degrees, 0 heading along +x)
  function addBoat (x, y, z, yaw = 0) {
    const id = nextEntityId++
    bot.entities[id] = { id, name: 'boat', position: new Vec3(x, y, z), yaw }
    return bot.entities[id]
  }
  bot.mount = entity => {
    bot.vehicle = entity
    vehicle = { id: BigInt(entity.id), kind: 'boat', pos: entity.position.clone(), vel: new Vec3(0, 0, 0), yaw: Math.fround(entity.yaw), pitch: 0, predicted: true, jumpControlled: false, seat: { x: 0, y: Math.fround(1.0200101), z: 0 } }
  }
  bot.dismount = () => {
    if (!bot.vehicle) return
    const state = new PlayerState(bot, { ...bot.controlState })
    bot.vehicle.position = state.vehicle.pos.clone()
    physics.dismount(state, world)
    state.apply(bot)
    bot.vehicle = null
    vehicle = undefined
  }
  bot.attack = entity => {
    delete bot.entities[entity.id]
    const boat = items.find(item => /boat$/.test(item.name))
    if (boat) boat.count++
    else items.push({ name: 'oak_boat', count: 1 })
  }
  // the engine's state of the player: a copy to each prediction, as a client gives it (a prediction changes its own)
  let engineState
  Object.defineProperty(bot, 'bedrockPhysicsState', {
    get: () => engineState === undefined ? undefined : cloneValue(engineState),
    set: value => { engineState = value }
  })

  // the ticks so far, and what they went through: with a prediction, and how many were not the prediction with their
  // inputs (none with them: the plugin gave inputs it predicted nothing with; one: the tick was not as predicted)
  const seen = { ticks: 0, collided: 0, airborne: 0, gliding: 0, boosted: 0, riding: 0, turned: 0, predicted: 0, mismatches: [] }
  let runs = new Map()
  const elsewhere = new WeakSet()
  function tick () {
    runs = new Map()
    bot.emit('physicsTick')
    const inputs = inputsOf(bot.controlState, bot.entity.yaw, bot.entity.pitch)
    const yawBefore = vehicle?.yaw
    const state = new PlayerState(bot, { ...bot.controlState })
    physics.simulatePlayer(state, world)
    state.apply(bot)
    if (runs.size) {
      seen.predicted++
      const run = [...runs.values()].find(r => isDeepStrictEqual(r.inputs, inputs))
      const actual = snapshot(state)
      if (!run) seen.mismatches.push({ tick: seen.ticks, kind: 'input', inputs, predicted: [...runs.values()].map(r => r.inputs) })
      else if (!isDeepStrictEqual(run.after, actual)) seen.mismatches.push({ tick: seen.ticks, kind: 'prediction', predicted: run.after, actual })
    }
    if (yawBefore !== undefined && state.vehicle) seen.turned += Math.abs(state.vehicle.yaw - yawBefore)
    // (the waves drew from the copy)
    if (state.randomState) randomState = state.randomState
    if (bot.vehicle && state.vehicle) bot.vehicle.position = state.vehicle.pos.clone()
    seen.ticks++
    if (state.isCollidedHorizontally) seen.collided++
    if (!state.onGround) seen.airborne++
    if (state.elytraFlying) seen.gliding++
    if (state.fireworkRocketDuration > 0) seen.boosted++
    if (state.vehicle) seen.riding++
  }
  tick.seen = seen
  return { bot, world, tick, physics, addBoat }
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
