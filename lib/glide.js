// Bedrock elytra gliding (Movements.allowGliding, for a player wearing an elytra out of creative): a glide is one move,
// from where the player stands to where it lands. It takes off (a jump, then a jump pressed anew in the air starts the
// glide), glides toward a point looking at it, the firework rockets it has boosting it where it slows or sinks below
// the point, and lands where the ground meets it. The planner tries a few points toward the goal from a few nodes
// (glideMoves) and keeps the glides a prediction lands without running into anything; the executor glides with the
// same controller (glideController), checking each tick that a prediction from the player as it is lands there still.
// (The idea, sampled glides toward the goal checked by simulating them, is Minecraft-Pathfinding's feat/elytra.)
const { Vec3 } = require('vec3')
const { PlayerState } = require('prismarine-physics')
const Move = require('./move')

// the longest glide tried, in ticks, and the shortest worth a takeoff, in blocks
const MAX_TICKS = 300
const MIN_DISTANCE = 6
// what a glide costs: a sprinted block's ticks (3.6) are 1, and a firework rocket used besides
const TICK_COST = 1 / 3.6
const ROCKET_COST = 2
// the points tried from a node: toward the goal and off it (degrees), at its distance and half of it, within reach
const BEARINGS = [0, 30, -30]
const REACHES = [1, 0.5]
const MAX_REACH = 160
// the nodes a search tries glides from (the first ones it expands)
const MAX_STARTS = 6
// the pitch (mineflayer's radians, up positive) a glide looks at most down (far from the point: the glide goes further
// looking down less) and up, and the climb a rocket's glide adds while it is far from the point
const MAX_DIVE = 0.9
const FAR_DIVE = 0.3
const MAX_CLIMB = 0.6
const LIFT = 0.35
// nearer than this the glide looks straight at the point: it lands there; and further than this out it uses no more
// rockets, coming in no faster than it glides
const LANDING = 8
const APPROACH = 16
// while far, the glide makes for this high over the point (it comes down onto it from above, not into its side)
const CLEARANCE = 3
// a rocket goes when the boost is out and the glide is slower than this (blocks a tick), or below the height it makes
// for
const ROCKET_SPEED = 0.9

const isRocket = item => item?.name === 'firework_rocket'

// The rockets the bot carries
function rocketsOf (bot) {
  return (bot.inventory?.items?.() ?? []).filter(isRocket).reduce((sum, item) => sum + item.count, 0)
}

// Whether the bot wears an elytra (the chest slot)
function wearsElytra (bot) {
  return bot.inventory?.slots?.[6]?.name === 'elytra'
}

// The controller of a glide toward a point ({ aim, lift, rockets: how many it may use }): a takeoff while not gliding,
// then the look at the point and the rockets. It decides from the state alone (and the rockets it used), so the
// executor's controller does from the player what the planner's did.
function glideController ({ aim, lift = 0, rockets = 0 }) {
  let left = rockets
  return (state) => {
    const dx = aim.x - state.pos.x
    const dz = aim.z - state.pos.z
    const horizontal = Math.hypot(dx, dz)
    if (horizontal > 0.2) state.yaw = Math.atan2(-dx, -dz)
    state.control.sneak = false
    if (!state.elytraFlying) {
      // a sprinting jump toward the point, then the jump pressed anew in the air: the glide starts going (the fly key:
      // the press is meant)
      state.pitch = 0
      state.control.forward = true
      state.control.sprint = true
      state.control.jump = state.onGround ? true : !state.control.jump
      state.control.fly = !state.onGround
      return
    }
    // (the keys move no glider; a jump pressed anew stops a glide)
    state.control.forward = false
    state.control.sprint = false
    state.control.jump = false
    state.control.fly = false
    const far = horizontal > LANDING
    const height = far ? aim.y + CLEARANCE : aim.y
    const pitch = Math.atan2(height - state.pos.y, Math.max(horizontal, 1e-3)) + (far ? lift : 0)
    state.pitch = Math.max(far ? -FAR_DIVE : -MAX_DIVE, Math.min(MAX_CLIMB, pitch))
    const speed = Math.hypot(state.vel.x, state.vel.z)
    if (left > 0 && horizontal > APPROACH && !(state.fireworkRocketDuration > 0) && (speed < ROCKET_SPEED || state.pos.y < height + 1)) {
      state.fireworkUsed = true
      left--
    }
  }
}

// A glide simulated from a state: { landed: where it landed (the feet), or null when it did not (in the air still, in
// a liquid, or it ran into something), ticks, rockets used }
function simulateGlide (physics, state, recipe) {
  const controller = glideController(recipe)
  let ticks = 0
  let rockets = 0
  let glided = false
  let hit = false
  const counting = (s, tick) => {
    controller(s, tick)
    if (s.fireworkUsed) rockets++
  }
  const end = physics.simulateUntil(s => {
    ticks++
    if (s.elytraFlying) glided = true
    if (s.isCollidedHorizontally) hit = true
    return hit || s.isInWater || (glided && s.onGround)
  }, counting, MAX_TICKS, state)
  const landed = glided && !hit && end.onGround && !end.isInWater && !end.isInLava ? end.pos.clone() : null
  return { landed, ticks, rockets }
}

// The player standing at a node, still, as a prediction starts from it (the engine makes its box from the feet)
function stateAt (bot, node) {
  const state = new PlayerState(bot, { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false })
  state.pos = new Vec3(node.x + 0.5, node.y, node.z + 0.5)
  state.vel = new Vec3(0, 0, 0)
  state.onGround = true
  state.isInWater = false
  state.isInLava = false
  state.isCollidedHorizontally = false
  state.isCollidedVertically = true
  state.elytraFlying = false
  state.fireworkRocketDuration = 0
  state.fireworkUsed = false
  state.jumpTicks = 0
  state.jumpQueued = false
  state.bedrock = undefined
  return state
}

// The ground's top under a point, from a height down: the y the feet stand at there, or null within 64 blocks
function groundUnder (movements, x, z, fromY) {
  for (let y = Math.floor(fromY); y > fromY - 64; y--) {
    const block = movements.getBlock({ x, y, z }, 0, -1, 0)
    if (block.liquid) return null
    if (block.physical) return y
  }
  return null
}

// The points a glide from a node aims at: the goal's, and the ground toward it and off it
function aimsFrom (movements, node, goal) {
  const target = { x: (goal.x ?? node.x) + 0.5, y: goal.y, z: (goal.z ?? node.z) + 0.5 }
  const dx = target.x - (node.x + 0.5)
  const dz = target.z - (node.z + 0.5)
  const distance = Math.hypot(dx, dz)
  if (distance < MIN_DISTANCE) return []
  const bearing = Math.atan2(dz, dx)
  const aims = []
  if (target.y !== undefined && distance <= MAX_REACH) aims.push(target)
  for (const reach of REACHES) {
    const length = Math.min(distance * reach, MAX_REACH)
    if (length < MIN_DISTANCE) continue
    for (const offset of BEARINGS) {
      if (reach === 1 && offset === 0 && target.y !== undefined && distance <= MAX_REACH) continue
      const angle = bearing + (offset * Math.PI) / 180
      const x = Math.floor(node.x + 0.5 + Math.cos(angle) * length)
      const z = Math.floor(node.z + 0.5 + Math.sin(angle) * length)
      const y = groundUnder(movements, x, z, Math.max(node.y, target.y ?? node.y) + 8)
      if (y !== null) aims.push({ x: x + 0.5, y, z: z + 0.5 })
    }
  }
  return aims
}

// The glides from a node (a walked one, or the player gliding already): moves to where each lands
function glideMoves (movements, node, neighbors) {
  const { bot } = movements
  const goal = movements.searchGoal
  if (!goal || node.fly || !wearsElytra(bot)) return
  if (node.gliding ? !bot.entity.elytraFlying : movements.glideStarts >= MAX_STARTS) return
  if (!node.gliding) movements.glideStarts++
  const rockets = rocketsOf(bot)
  const lifts = rockets > 0 ? [0, LIFT] : [0]
  const start = () => node.live || node.gliding ? new PlayerState(bot, { ...bot.controlState }) : stateAt(bot, node)
  const from = new Vec3(node.x + 0.5, node.y, node.z + 0.5)
  for (const aim of aimsFrom(movements, node, goal)) {
    for (const lift of lifts) {
      const recipe = { aim, lift, rockets }
      const { landed, ticks, rockets: used } = simulateGlide(movements.physics, start(), recipe)
      if (!landed || Math.hypot(landed.x - from.x, landed.z - from.z) < MIN_DISTANCE) continue
      const cell = landed.floored()
      if (movements.getBlock(cell, 0, 0, 0).physical || !movements.getBlock(cell, 0, -1, 0).physical) continue
      const move = new Move(cell.x, cell.y, cell.z, node.remainingBlocks, ticks * TICK_COST + used * ROCKET_COST)
      move.glide = recipe
      neighbors.push(move)
    }
  }
}

module.exports = { glideMoves, glideController, simulateGlide, rocketsOf, wearsElytra, isRocket }
