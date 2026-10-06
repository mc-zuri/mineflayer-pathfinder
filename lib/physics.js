const { PlayerState } = require('prismarine-physics')

// Bedrock swimming: the keys that take a swimmer to the next point, rising (jump), sinking (sneak) or neither
const SWIMS = { rise: { jump: true, sneak: false }, keep: { jump: false, sneak: false }, sink: { jump: false, sneak: true } }
// a swimmer this near the next point's middle (horizontally) swims straight up or down, facing as it does
const SWIM_ABOVE = 0.2
const SWIM_TICKS = 60

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

  // Bedrock: the controller that swims to the next point, as a prediction shows: the swims tried in the order its
  // height asks for; null when none gets there
  swimController (path) {
    const target = path[0]
    const feet = Math.floor(this.bot.entity.position.y)
    const order = target.y > feet ? ['rise', 'keep', 'sink'] : target.y < feet ? ['sink', 'keep', 'rise'] : ['keep', 'rise', 'sink']
    const reached = this.getReached(path)
    for (const swim of order) {
      const controller = this.getSwimController(target, SWIMS[swim])
      if (reached(this.simulateUntil(reached, controller, SWIM_TICKS))) return controller
    }
    return null
  }

  getSwimController (nextPoint, { jump, sneak }) {
    return (state) => {
      const dx = nextPoint.x - state.pos.x
      const dz = nextPoint.z - state.pos.z
      const away = Math.hypot(dx, dz) > SWIM_ABOVE
      if (away) state.yaw = Math.atan2(-dx, -dz)
      state.pitch = 0
      state.control.forward = away
      state.control.jump = jump
      state.control.sneak = sneak
      state.control.sprint = false
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
