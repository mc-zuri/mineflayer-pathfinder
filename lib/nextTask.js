// Runs fn on the next turn of the event loop, after the I/O due: Node's setImmediate, and where there is none (a
// browser) a timeout of 0
const nextTask = typeof setImmediate === 'function' ? fn => setImmediate(fn) : fn => setTimeout(fn, 0)

module.exports = { nextTask }
