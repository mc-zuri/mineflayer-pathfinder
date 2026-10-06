const { PlayerState } = require('prismarine-physics')

// Bedrock swimming: the keys that take a swimmer to the next point: sprinting, looking at it (the engine's swim, which
// goes where the player looks), or rising (jump), sinking (sneak) or neither
const SWIMS = {
  sprint: { sprint: true, jump: false, sneak: false },
  rise: { sprint: false, jump: true, sneak: false },
  keep: { sprint: false, jump: false, sneak: false },
  sink: { sprint: false, jump: false, sneak: true }
}
// a swimmer this near the next point's middle (horizontally) swims straight up or down, facing as it does
const SWIM_ABOVE = 0.2
const SWIM_TICKS = 60
// Bedrock creative flight: the keys that fly to the next point (forward, sprinting or not, rising, sinking or neither)
// and the ticks a flight to it may take; the double tap that takes off or lands: let go, press, let go, press
const FLIES = [
  { sprint: true, jump: false, sneak: false },
  { sprint: true, jump: true, sneak: false },
  { sprint: true, jump: false, sneak: true },
  { sprint: false, jump: false, sneak: false },
  { sprint: false, jump: true, sneak: false },
  { sprint: false, jump: false, sneak: true }
]
const FLY_TICKS = 40
const FLY_TAP = [false, true, false, true]
// a flyer this near the next point's middle (horizontally) goes straight up or down to it
const FLY_ABOVE = 0.2
// a jump up a block is tried this many ticks ahead, and must get there within so many ticks
const JUMP_AHEAD_TICKS = 8
const JUMP_AHEAD_REACH = 30
// a jump lands on the block it goes up to, or on as many steps after it at its height
const JUMP_AHEAD_CELLS = 4

// a step walked to, with nothing to break or place on the way
const isWalk = node => node.toBreak.length === 0 && node.toPlace.length === 0

// The cell of these steps a player stands in on the ground, at their height: its index, or -1
function landedOn (cells, pos, onGround) {
  if (!onGround || Math.abs(pos.y - cells[0].y) >= 0.5) return -1
  return cells.findIndex(cell => Math.floor(cell.x) === Math.floor(pos.x) && Math.floor(cell.z) === Math.floor(pos.z))
}

class Physics {
  constructor (bot) {
    this.bot = bot
    this.world = { getBlock: (pos) => { return bot.blockAt(pos, false) } }
    // Bedrock's engine: the pitch moves a swimming player, so a prediction looks as the executor does
    this.bedrock = bot.registry?.type === 'bedrock'
  }

  /**
   *
   * @param {function} goal A function is the goal has been reached or not
   * @param {function} controller Controller that can change the current control State for the next tick
   * @param {number} ticks Number of ticks to simulate
   * @param {object} state Starting control state to begin the simulation with
   * @returns { import('prismarine-physics').PlayerState } A player state of the final simulation tick
   */
  simulateUntil (goal, controller = () => {}, ticks = 1, state = null) {
    if (!state) {
      const simulationControl = {
        forward: this.bot.controlState.forward,
        back: this.bot.controlState.back,
        left: this.bot.controlState.left,
        right: this.bot.controlState.right,
        jump: this.bot.controlState.jump,
        sprint: this.bot.controlState.sprint,
        sneak: this.bot.controlState.sneak
      }
      state = new PlayerState(this.bot, simulationControl)
    }

    for (let i = 0; i < ticks; i++) {
      controller(state, i)
      this.bot.physics.simulatePlayer(state, this.world)
      if (state.isInLava) return state
      if (goal(state)) return state
    }

    return state
  }

  simulateUntilNextTick () {
    return this.simulateUntil(() => false, () => {}, 1)
  }

  simulateUntilOnGround (ticks = 5) {
    return this.simulateUntil(state => state.onGround, () => {}, ticks)
  }

  canStraightLine (path, sprint = false) {
    const reached = this.getReached(path)
    const state = this.simulateUntil(reached, this.getController(path[0], false, sprint), 200)
    if (reached(state)) return true

    if (sprint) {
      if (this.canSprintJump(path, 0)) return false
    } else {
      if (this.canWalkJump(path, 0)) return false
    }

    for (let i = 1; i < 7; i++) {
      if (sprint) {
        if (this.canSprintJump(path, i)) return true
      } else {
        if (this.canWalkJump(path, i)) return true
      }
    }
    return false
  }

  canStraightLineBetween (n1, n2) {
    const reached = (state) => {
      const delta = n2.minus(state.pos)
      const r2 = 0.15 * 0.15
      return (delta.x * delta.x + delta.z * delta.z) <= r2 && Math.abs(delta.y) < 0.001 && (state.onGround || state.isInWater)
    }
    const simulationControl = {
      forward: this.bot.controlState.forward,
      back: this.bot.controlState.back,
      left: this.bot.controlState.left,
      right: this.bot.controlState.right,
      jump: this.bot.controlState.jump,
      sprint: this.bot.controlState.sprint,
      sneak: this.bot.controlState.sneak
    }
    const state = new PlayerState(this.bot, simulationControl)
    state.pos.update(n1)
    this.simulateUntil(reached, this.getController(n2, false, true), Math.floor(5 * n1.distanceTo(n2)), state)
    return reached(state)
  }

  canSprintJump (path, jumpAfter = 0) {
    const reached = this.getReached(path)
    const state = this.simulateUntil(reached, this.getController(path[0], true, true, jumpAfter), 20)
    return reached(state)
  }

  canWalkJump (path, jumpAfter = 0) {
    const reached = this.getReached(path)
    const state = this.simulateUntil(reached, this.getController(path[0], true, false, jumpAfter), 20)
    return reached(state)
  }

  // Bedrock: a jump up a block from far enough back to clear its edge. From the middle of the block before it (the
  // node the executor walks to first) a jump rises too late: the engine's player needs three ticks to get a block up,
  // and runs into the block's side meanwhile. When the step after the next one is a jump up from it (or the next one is
  // a jump up from the feet), this predicts the jump to it on each tick to come, and keeps the run that lands on it
  // soonest without touching a block's side or dropping below the walk: { controller, skip: whether it goes past the
  // next point }, its first tick the one to give now; null when no such run gets there. A sprint lands past the block's
  // middle: on its cell, or on the steps after it at its height. In the air, the jump goes on as it was predicted until
  // it lands (landedPast).
  jumpAhead (path, sprint = false) {
    if (!this.bedrock) return null
    const { leap } = this
    this.leap = null
    if (!this.bot.entity.onGround) {
      if (!leap || path[0] !== leap.target) return null
      const controller = this.getController(leap.target, true, sprint)
      if (this.jumpTicks(leap, controller) === null) return null
      this.leap = leap
      return { controller, skip: false }
    }
    const feet = this.bot.entity.position.y
    const isJumpUp = (from, to) => isWalk(to) && to.y - from > 0.5 && to.y - from <= 1.25
    let target, floor
    if (path.length > 1 && isWalk(path[0]) && Math.abs(path[0].y - feet) < 0.5 && isJumpUp(path[0].y, path[1])) {
      target = 1
      floor = Math.min(feet, path[0].y)
    } else if (path.length > 0 && isJumpUp(feet, path[0])) {
      target = 0
      floor = feet
    } else {
      return null
    }
    const cells = [path[target]]
    for (let i = target + 1; i < path.length && cells.length < JUMP_AHEAD_CELLS && isWalk(path[i]) && Math.abs(path[i].y - path[target].y) < 0.5; i++) cells.push(path[i])
    const jump = { target: path[target], cells, floor }
    let best = null
    for (let jumpAfter = 0; jumpAfter < JUMP_AHEAD_TICKS; jumpAfter++) {
      const controller = this.getController(jump.target, true, sprint, jumpAfter)
      const ticks = this.jumpTicks(jump, controller)
      if (ticks !== null && (!best || ticks < best.ticks)) best = { controller, skip: target === 1, ticks }
    }
    if (best) this.leap = jump
    return best
  }

  // The ticks a controller takes to land on a jump's cells (passing over them is not there: the sprint goes on, off a
  // pillar's top) never touching a block's side nor dropping below its floor; null when it does not get there so
  jumpTicks ({ cells, floor }, controller) {
    let clean = true
    let ticks = 0
    const state = this.simulateUntil(state => {
      ticks++
      if (state.isCollidedHorizontally || state.pos.y < floor - 0.001) clean = false
      return !clean || landedOn(cells, state.pos, state.onGround) >= 0
    }, controller, JUMP_AHEAD_REACH)
    return clean && landedOn(cells, state.pos, state.onGround) >= 0 ? ticks : null
  }

  // Bedrock: the steps a jump landed past (jumpAhead): on the cell of the path's k-th step, past its middle toward the
  // next one too; 0 until it lands
  landedPast (path) {
    const { leap } = this
    const entity = this.bot.entity
    if (!leap || !this.bedrock) return 0
    const landed = landedOn(leap.cells, entity.position, entity.onGround)
    if (landed < 0) return 0
    this.leap = null
    let k = path.indexOf(leap.cells[landed])
    if (k < 0) return 0
    const node = path[k]
    const next = leap.cells[landed + 1]
    if (next && path[k + 1] === next && (entity.position.x - node.x) * (next.x - node.x) + (entity.position.z - node.z) * (next.z - node.z) > 0) k++
    return k
  }

  // Bedrock: whether the player flies (creative flight: the engine's own toggle, which the double tap sets at once)
  flying () {
    const entity = this.bot.entity
    if (entity.flying !== undefined) return !!entity.flying
    return !!(this.bot.bedrockPhysicsState?.flying ?? this.bot.abilities?.flags?.flying)
  }

  // Bedrock creative flight: the controller to the next point, as a prediction shows, when the player flies or is to:
  // the double tap that takes off for a flown step, or that lands on a walked one from over it (landing, until on the
  // ground); else the flight to it, the keys tried in turn (FLIES). null when nothing gets there, or neither flying nor
  // to fly.
  flyController (path) {
    const target = path[0]
    const flying = this.flying()
    const entity = this.bot.entity
    const over = Math.hypot(target.x - entity.position.x, target.z - entity.position.z) <= 0.35
    if (!!target.fly !== flying && (target.fly || over)) {
      const from = this.tap ?? 0
      const controller = this.getTapController(target, from)
      this.tap = null
      const toggled = state => !!state.bedrock?.flying !== flying
      if (!toggled(this.simulateUntil(toggled, controller, FLY_TAP.length - from + 2))) return null
      this.tap = from + 1
      this.landing = !target.fly
      return controller
    }
    this.tap = null
    if (!flying) {
      // landed, or falling onto the ground after the tap that lands: straight down
      if (!this.landing || entity.onGround) {
        this.landing = false
        return null
      }
      const controller = this.getFlyController(target, FLIES[3])
      this.simulateUntil(state => state.onGround, controller, FLY_TICKS)
      return controller
    }
    const reached = this.getFlyReached(target)
    for (const keys of FLIES) {
      const controller = this.getFlyController(target, keys)
      if (reached(this.simulateUntil(reached, controller, FLY_TICKS))) return controller
    }
    return null
  }

  // Where a flight gets to a point: a flown one's cell (a sprinted flight goes some 0.9 blocks a tick, by the middle of
  // it), a walked one's middle from no more than a block over it
  getFlyReached (point) {
    if (!point.fly) return this.getReached([point])
    return state => Math.floor(state.pos.x) === Math.floor(point.x) && Math.floor(state.pos.z) === Math.floor(point.z) &&
      state.pos.y > point.y - 0.5 && state.pos.y < point.y + 1
  }

  // The double tap (FLY_TAP) from its from-th tick on, turned toward the point and going nowhere; the fly key tells the
  // client the jump presses are the tap (a client may keep a player that may fly from tapping by chance)
  getTapController (nextPoint, from) {
    return (state, tick) => {
      const k = from + tick
      const dx = nextPoint.x - state.pos.x
      const dz = nextPoint.z - state.pos.z
      if (Math.hypot(dx, dz) > FLY_ABOVE) state.yaw = Math.atan2(-dx, -dz)
      state.pitch = 0
      state.control.forward = false
      state.control.sprint = false
      state.control.sneak = false
      state.control.jump = !!FLY_TAP[k]
      state.control.fly = k < FLY_TAP.length
    }
  }

  getFlyController (nextPoint, { sprint, jump, sneak }) {
    return (state) => {
      const dx = nextPoint.x - state.pos.x
      const dz = nextPoint.z - state.pos.z
      const away = Math.hypot(dx, dz) > FLY_ABOVE
      if (away) state.yaw = Math.atan2(-dx, -dz)
      state.pitch = 0
      state.control.forward = away
      state.control.sprint = sprint && away
      state.control.jump = jump
      state.control.sneak = sneak
      state.control.fly = false
    }
  }

  // Bedrock: the controller that swims to the next point, as a prediction shows: the swims tried in the order its
  // height asks for; null when none gets there
  swimController (path, sprint = false) {
    const target = path[0]
    const feet = Math.floor(this.bot.entity.position.y)
    const order = target.y > feet ? ['rise', 'keep', 'sink'] : target.y < feet ? ['sink', 'keep', 'rise'] : ['keep', 'rise', 'sink']
    // sprinting first, the fastest, when the point is not straight above or below
    const ahead = Math.hypot(target.x - this.bot.entity.position.x, target.z - this.bot.entity.position.z) > SWIM_ABOVE
    if (ahead && sprint) order.unshift('sprint')
    const reached = this.getReached(path)
    for (const swim of order) {
      const controller = this.getSwimController(target, SWIMS[swim])
      if (reached(this.simulateUntil(reached, controller, SWIM_TICKS))) return controller
    }
    return null
  }

  getSwimController (nextPoint, { sprint, jump, sneak }) {
    return (state) => {
      const dx = nextPoint.x - state.pos.x
      const dz = nextPoint.z - state.pos.z
      const away = Math.hypot(dx, dz) > SWIM_ABOVE
      if (away) state.yaw = Math.atan2(-dx, -dz)
      // a sprint swims where the player looks: at the point (the feet's height to its floor)
      state.pitch = sprint && away ? Math.atan2(nextPoint.y - state.pos.y, Math.hypot(dx, dz)) : 0
      state.control.forward = away
      state.control.jump = jump
      state.control.sneak = sneak
      state.control.sprint = sprint && away
    }
  }

  // Drives the bot with a controller, as a prediction's first tick does: its look and keys
  control (controller) {
    const entity = this.bot.entity
    const state = { pos: entity.position, yaw: entity.yaw, pitch: entity.pitch, control: {} }
    controller(state, 0)
    this.bot.look(state.yaw, state.pitch, true)
    for (const [key, pressed] of Object.entries(state.control)) this.bot.setControlState(key, pressed)
  }

  getReached (path) {
    return (state) => {
      const delta = path[0].minus(state.pos)
      return Math.abs(delta.x) <= 0.35 && Math.abs(delta.z) <= 0.35 && Math.abs(delta.y) < 1
    }
  }

  getController (nextPoint, jump, sprint, jumpAfter = 0) {
    return (state, tick) => {
      const dx = nextPoint.x - state.pos.x
      const dz = nextPoint.z - state.pos.z
      state.yaw = Math.atan2(-dx, -dz)
      // the executor walks looking straight ahead (monitorMovement)
      if (this.bedrock) state.pitch = 0

      state.control.forward = true
      state.control.jump = jump && tick >= jumpAfter
      state.control.sprint = sprint
    }
  }
}

module.exports = Physics
