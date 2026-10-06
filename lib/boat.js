// Bedrock boats (Movements.allowBoats): a player with a boat item puts it on the water beside the bank it stands on and
// gets in, or gets in a boat floating there already (a board move: the boat node there), paddles from one cell of the
// top of the water to the next (boat nodes, apart from the nodes swum or walked in the same cells) and gets out onto a
// bank beside it (a leave move: the walk node there), picking the boat up again when Movements.pickUpBoat says so. The
// engine paddles the boat as the game's client predicts it: forward paddles both, left and right turn it; the
// controller that gets the boat on along its steps is the one a prediction shows getting there (boatController in
// physics.js).
const Move = require('./move')

const cardinal = [{ x: -1, z: 0 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: 0, z: 1 }]
const diagonal = [{ x: -1, z: -1 }, { x: -1, z: 1 }, { x: 1, z: -1 }, { x: 1, z: 1 }]

// What boating costs, in a sprinted block's ticks (3.6): a boat goes some 0.38 blocks a tick; putting it on the water
// and getting in takes some 10 ticks, getting out and picking it up as many
const PADDLE_COST = 0.75
const BOARD_COST = 3
const LEAVE_COST = 3

const isBoatItem = item => /(^|_)boat$/.test(item?.name ?? '')

// Whether the bot has a boat to put on the water
function hasBoat (bot) {
  return (bot.inventory?.items?.() ?? []).some(isBoatItem)
}

// Whether a boat floats in a cell already (bot.entities)
function boatIn (bot, x, y, z) {
  for (const entity of Object.values(bot.entities ?? {})) {
    if (!/(^|_)boat$/.test(entity.name ?? '')) continue
    if (Math.floor(entity.position.x) === x && Math.floor(entity.position.z) === z && Math.abs(entity.position.y - y) < 2) return true
  }
  return false
}

// Whether a cell is the top of water a boat floats on: water, air over it, and room for the rider
function isSurface (movements, node, dx, dy, dz) {
  const water = movements.getBlock(node, dx, dy, dz)
  if (!water.liquid || movements.blocksToAvoid.has(water.type) || water.physical) return false
  const above = movements.getBlock(node, dx, dy + 1, dz)
  return !above.liquid && above.boundingBox === 'empty' && movements.getBlock(node, dx, dy + 2, dz).boundingBox === 'empty'
}

// A boat node: in a cell of the top of the water
function boatMove (x, y, z, node, cost, fields = {}) {
  const move = new Move(x, y, z, node.remainingBlocks, cost)
  move.boat = true
  move.hash += ':boat'
  return Object.assign(move, fields)
}

// The boat moves from a node: paddling and getting out from a boat node; getting in from a walked one
function boatMoves (movements, node, neighbors) {
  if (node.boat) {
    for (const dir of cardinal) {
      if (isSurface(movements, node, dir.x, 0, dir.z)) neighbors.push(boatMove(node.x + dir.x, node.y, node.z + dir.z, node, PADDLE_COST))
      // out onto the bank beside: its ground the water's level (or a block over it), room to stand on it
      for (const dy of [1, 2]) {
        const ground = movements.getBlock(node, dir.x, dy - 1, dir.z)
        if (!ground.physical || !movements.getBlock(node, dir.x, dy, dir.z).safe || !movements.getBlock(node, dir.x, dy + 1, dir.z).safe) continue
        const out = new Move(node.x + dir.x, node.y + dy, node.z + dir.z, node.remainingBlocks, LEAVE_COST)
        out.leave = true
        neighbors.push(out)
        break
      }
    }
    for (const dir of diagonal) {
      if (isSurface(movements, node, dir.x, 0, dir.z) && isSurface(movements, node, dir.x, 0, 0) && isSurface(movements, node, 0, 0, dir.z)) {
        neighbors.push(boatMove(node.x + dir.x, node.y, node.z + dir.z, node, PADDLE_COST * Math.SQRT2))
      }
    }
    return
  }
  if (movements.getBlock(node, 0, 0, 0).liquid) return
  const carried = hasBoat(movements.bot)
  // onto the water beside the bank: its top at the ground's level (or a block under it); a boat of the bot's put there,
  // or one floating there
  for (const dir of cardinal) {
    for (const dy of [-1, -2]) {
      if (!isSurface(movements, node, dir.x, dy, dir.z)) continue
      if (!carried && !boatIn(movements.bot, node.x + dir.x, node.y + dy, node.z + dir.z)) continue
      neighbors.push(boatMove(node.x + dir.x, node.y + dy, node.z + dir.z, node, BOARD_COST, { board: true }))
      break
    }
  }
}

module.exports = { boatMoves, boatMove, isBoatItem, hasBoat, boatIn, isSurface }
