// Pure logic for the Lighting widget, shared by Panel.qml and the Node tests
// (MODEL_PATH=Model.js node --test tests/model.test.cjs).

// Turns `lighting status --json` output into the widget's state. exitCode
// 127 means the `lighting` command isn't installed.
function parseStatus(exitCode, text) {
  var state = {
    installed: exitCode !== 127,
    connected: false,
    problem: "",
    masterOn: false,
    brightness: 100,
    sharedColor: "#ffffff",
    devices: []
  }
  if (!state.installed) return state
  var data = null
  try { data = JSON.parse(String(text || "")) } catch (e) { data = null }
  if (!data || typeof data !== "object") {
    state.problem = "Couldn't read lighting status"
    return state
  }
  state.connected = data.connected === true
  state.problem = data.error ? String(data.error) : ""
  state.masterOn = data.on === true
  if (typeof data.brightness === "number") state.brightness = data.brightness
  if (data.color) state.sharedColor = String(data.color).toLowerCase()
  var raw = data.devices instanceof Array ? data.devices : []
  for (var i = 0; i < raw.length; i++) {
    var d = raw[i] || {}
    // Devices with no LEDs set up in OpenRGB have nothing to switch.
    if (!((d.leds || 0) > 0)) continue
    state.devices.push({
      key: String(d.key || d.name || ""),
      label: String(d.label || d.name || ""),
      on: d.on === true,
      color: String(d.color || state.sharedColor).toLowerCase(),
      brightness: typeof d.brightness === "number" ? d.brightness : state.brightness
    })
  }
  return state
}

// Lit means the master switch is on and at least one device is on, so the
// bulb and the main switch match what the PC actually shows.
function anyLit(state) {
  if (!state.masterOn) return false
  if (state.devices.length === 0) return state.brightness > 0
  for (var i = 0; i < state.devices.length; i++)
    if (state.devices[i].on && state.devices[i].brightness > 0) return true
  return false
}

function litCount(state) {
  if (!state.masterOn) return 0
  var n = 0
  for (var i = 0; i < state.devices.length; i++)
    if (state.devices[i].on && state.devices[i].brightness > 0) n++
  return n
}

// What the panel shows right after the master switch is flipped, before the
// next status read: `lighting on` brings every device back too, and a
// device's `on` in the status already includes the master switch.
function withMaster(state, on) {
  var next = {}
  for (var k in state) next[k] = state[k]
  next.masterOn = on
  next.devices = state.devices.map(function(d) {
    var copy = {}
    for (var key in d) copy[key] = d[key]
    copy.on = on
    return copy
  })
  return next
}

// Adds a command to the waiting list. Brightness changes replace a waiting
// brightness change (only the newest level matters); everything else keeps
// its place, so a color or a device switch is never dropped.
function enqueue(queue, args) {
  var next = queue.slice()
  if (args[0] === "set" && args[1] === "--brightness") {
    for (var i = 0; i < next.length; i++) {
      if (next[i][0] === "set" && next[i][1] === "--brightness") {
        next[i] = args
        return next
      }
    }
  }
  next.push(args)
  return next
}

// The color every device shares, or "" when they differ.
function commonColor(state) {
  if (state.devices.length === 0) return state.sharedColor
  var c = state.devices[0].color
  for (var i = 1; i < state.devices.length; i++) if (state.devices[i].color !== c) return ""
  return c
}

// The slider's position and whether devices disagree. When they differ the
// slider sits at the brightest device; moving it sets every device.
function brightnessSummary(state) {
  if (state.devices.length === 0) return { value: state.brightness, mixed: false }
  var max = 0, first = state.devices[0].brightness, mixed = false
  for (var i = 0; i < state.devices.length; i++) {
    var b = state.devices[i].brightness
    if (b > max) max = b
    if (b !== first) mixed = true
  }
  return { value: max, mixed: mixed }
}

function statusText(state, loaded) {
  if (!state.installed) return "App not installed"
  if (!state.connected) return loaded ? "OpenRGB not reachable" : "…"
  if (!anyLit(state)) return "Off"
  var n = litCount(state)
  if (state.devices.length === 0) return "On"
  return n === 1 ? "On · 1 device" : "On · " + n + " devices"
}

// A device's dot: its color dimmed by its brightness (never below a quarter,
// so a dim device still reads as a color), or null when it's dark.
function dotRgb(state, device) {
  if (!state.masterOn || !device.on) return null
  var hex = device.color.replace("#", "")
  if (hex.length !== 6) return null
  var s = Math.max(0.25, device.brightness / 100)
  return [
    parseInt(hex.slice(0, 2), 16) / 255 * s,
    parseInt(hex.slice(2, 4), 16) / 255 * s,
    parseInt(hex.slice(4, 6), 16) / 255 * s
  ]
}

function clampBrightness(level) {
  return Math.max(0, Math.min(100, Math.round(Number(level) || 0)))
}

if (typeof module !== "undefined") {
  module.exports = {
    parseStatus: parseStatus,
    anyLit: anyLit,
    litCount: litCount,
    commonColor: commonColor,
    brightnessSummary: brightnessSummary,
    statusText: statusText,
    dotRgb: dotRgb,
    clampBrightness: clampBrightness,
    withMaster: withMaster,
    enqueue: enqueue
  }
}
