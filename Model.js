// Pure logic for the Lighting widget, shared by Panel.qml and the Node tests
// (MODEL_PATH=Model.js node --test tests/model.test.cjs).
//
// Two things are kept apart: the saved settings (what the user asked for,
// stored as JSON) and the devices OpenRGB reports right now. The panel shows
// a view built from both, and applyArgs turns both into one `openrgb` call.

// ---------- Saved settings ----------

// The shared look ("All") plus any device that was given its own. Same
// format as the Lighting app's ~/.config/lighting/state.json, so its
// settings carry over.
function defaultSettings() {
  return { on: true, color: "#ffffff", brightness: 100, devices: {} }
}

function normalColor(value, fallback) {
  var s = String(value || "").trim().toLowerCase()
  if (s && s[0] !== "#") s = "#" + s
  return /^#[0-9a-f]{6}$/.test(s) ? s : fallback
}

function clampBrightness(level) {
  return Math.max(0, Math.min(100, Math.round(Number(level) || 0)))
}

function readLook(obj, fallback) {
  obj = obj && typeof obj === "object" ? obj : {}
  return {
    on: typeof obj.on === "boolean" ? obj.on : fallback.on,
    color: normalColor(obj.color, fallback.color),
    brightness: typeof obj.brightness === "number" ? clampBrightness(obj.brightness) : fallback.brightness
  }
}

// Saved JSON to settings; anything unreadable falls back to the defaults.
function parseSettings(text) {
  var data = null
  try { data = JSON.parse(String(text || "")) } catch (e) { data = null }
  var base = readLook(data, defaultSettings())
  var settings = { on: base.on, color: base.color, brightness: base.brightness, devices: {} }
  var list = data && data.devices && typeof data.devices === "object" ? data.devices : {}
  for (var key in list) settings.devices[key] = readLook(list[key], lookBase(settings))
  return settings
}

function settingsText(settings) {
  return JSON.stringify(settings, null, 2) + "\n"
}

function lookBase(settings) {
  return { on: true, color: settings.color, brightness: settings.brightness }
}

// A device's own look, or the shared one when it has none.
function lookFor(settings, key) {
  var own = settings.devices[key]
  return own ? { on: own.on, color: own.color, brightness: own.brightness } : lookBase(settings)
}

function copySettings(settings) {
  var next = { on: settings.on, color: settings.color, brightness: settings.brightness, devices: {} }
  for (var key in settings.devices) next.devices[key] = lookFor(settings, key)
  return next
}

// "All on" brings back devices switched off on their own too; "all off" only
// flips the master switch, so each device's setting is there when it returns.
function setMaster(settings, on) {
  var next = copySettings(settings)
  next.on = on
  if (on) for (var key in next.devices) next.devices[key].on = true
  // Turning on at 0% would change nothing you can see.
  if (on && next.brightness === 0) {
    var dark = true
    for (var k in next.devices) if (next.devices[k].brightness > 0) dark = false
    if (dark) return setBrightnessForAll(next, 100)
  }
  return next
}

// Switching one device on while everything is off brings the rest back too;
// otherwise the switch would do nothing you can see.
function setDevice(settings, key, on) {
  var next = copySettings(settings)
  var look = lookFor(next, key)
  look.on = on
  next.devices[key] = look
  if (on) next.on = true
  return next
}

function setColorForAll(settings, hex) {
  var next = copySettings(settings)
  next.color = normalColor(hex, next.color)
  for (var key in next.devices) next.devices[key].color = next.color
  return next
}

function setBrightnessForAll(settings, level) {
  var next = copySettings(settings)
  next.brightness = clampBrightness(level)
  for (var key in next.devices) next.devices[key].brightness = next.brightness
  return next
}

// ---------- OpenRGB's device list ----------

var TYPE_LABELS = {
  "motherboard": "Motherboard", "dram": "Memory", "gpu": "Graphics card",
  "cooler": "Cooler", "led strip": "LED strip", "keyboard": "Keyboard",
  "mouse": "Mouse", "mousemat": "Mousepad", "headset": "Headset",
  "headset stand": "Headset stand", "gamepad": "Controller", "light": "Light",
  "speaker": "Speaker", "storage": "Drive", "case": "Case",
  "microphone": "Microphone", "keypad": "Keypad"
}

// Reads `openrgb -ld`. Each device starts with "N: name" at the start of a
// line; its details are indented. A device with no LEDs set up (an empty
// motherboard header) has no "LEDs:" line and gets no switch.
//
// Keys are the device name, which survives reboots and reordering; a second
// identical device gets " 2". Labels are the short type name, numbered when
// a type repeats. Both match the Lighting app, so its settings carry over.
function parseDeviceList(text) {
  var found = []
  var lines = String(text || "").split("\n")
  var current = null
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i]
    var head = /^(\d+): (.*\S)\s*$/.exec(line)
    if (head) {
      current = { index: Number(head[1]), name: head[2], type: "", hasLeds: false }
      found.push(current)
      continue
    }
    if (!current) continue
    var type = /^\s+Type:\s+(.*\S)\s*$/.exec(line)
    if (type) current.type = type[1]
    else if (/^\s+LEDs:\s*\S/.test(line)) current.hasLeds = true
  }

  var used = {}, seen = {}, typeCount = {}, typeSeen = {}
  found.forEach(function(d) {
    used[d.name] = true
    var label = TYPE_LABELS[d.type.toLowerCase()] || ""
    if (label) typeCount[label] = (typeCount[label] || 0) + 1
  })
  found.forEach(function(d) {
    seen[d.name] = (seen[d.name] || 0) + 1
    if (seen[d.name] === 1) {
      d.key = d.name
    } else {
      var n = seen[d.name]
      while (used[d.name + " " + n]) n++
      d.key = d.name + " " + n
      used[d.key] = true
    }
    var label = TYPE_LABELS[d.type.toLowerCase()] || ""
    if (!label) d.label = d.name
    else if (typeCount[label] > 1) d.label = label + " " + (typeSeen[label] = (typeSeen[label] || 0) + 1)
    else d.label = label
  })
  return found
}

// What a device should show: its color scaled by brightness, or black.
function outputHex(settings, key) {
  var look = lookFor(settings, key)
  if (!settings.on || !look.on) return "000000"
  var hex = look.color.replace("#", "")
  var scale = look.brightness / 100
  var out = ""
  for (var i = 0; i < 6; i += 2) {
    var v = Math.round(parseInt(hex.slice(i, i + 2), 16) * scale)
    out += (v < 16 ? "0" : "") + v.toString(16)
  }
  return out
}

// The arguments for one `openrgb` call that sets every device with LEDs.
function applyArgs(settings, devices) {
  var args = []
  devices.forEach(function(d) {
    if (d.hasLeds) args.push("-d", String(d.index), "-c", outputHex(settings, d.key))
  })
  return args
}

// Changes when a device appears, goes or is renumbered: the moment the
// saved look has to be sent again (login, replug, OpenRGB restart).
function deviceSignature(devices) {
  return devices.filter(function(d) { return d.hasLeds })
    .map(function(d) { return d.index + "=" + d.key }).join("\n")
}

// ---------- What the panel shows ----------

// status: "missing" (OpenRGB isn't installed), "starting" (its server isn't
// answering yet), "ready", or "error" with a problem message.
function view(settings, devices, status, problem) {
  var state = {
    installed: status !== "missing",
    connected: status === "ready",
    status: status,
    problem: problem || "",
    masterOn: settings.on,
    brightness: settings.brightness,
    sharedColor: settings.color,
    devices: []
  }
  devices.forEach(function(d) {
    if (!d.hasLeds) return
    var look = lookFor(settings, d.key)
    state.devices.push({
      key: d.key,
      label: d.label,
      // A device reads as on only when the master switch is on too.
      on: settings.on && look.on,
      color: look.color,
      brightness: look.brightness
    })
  })
  return state
}

// Lit means OpenRGB is answering, the master switch is on and at least one
// device is on, so the bulb and the main switch match what the PC shows.
function anyLit(state) {
  if (!state.connected || !state.masterOn) return false
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

function statusText(state) {
  if (!state.installed) return "OpenRGB not installed"
  if (state.status === "starting") return "Starting OpenRGB…"
  if (!state.connected) return "OpenRGB not reachable"
  if (state.devices.length === 0) return "No lights found"
  if (!anyLit(state)) return "Off"
  var n = litCount(state)
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

if (typeof module !== "undefined") {
  module.exports = {
    defaultSettings: defaultSettings,
    parseSettings: parseSettings,
    settingsText: settingsText,
    lookFor: lookFor,
    setMaster: setMaster,
    setDevice: setDevice,
    setColorForAll: setColorForAll,
    setBrightnessForAll: setBrightnessForAll,
    clampBrightness: clampBrightness,
    parseDeviceList: parseDeviceList,
    outputHex: outputHex,
    applyArgs: applyArgs,
    deviceSignature: deviceSignature,
    view: view,
    anyLit: anyLit,
    litCount: litCount,
    commonColor: commonColor,
    brightnessSummary: brightnessSummary,
    statusText: statusText,
    dotRgb: dotRgb
  }
}
