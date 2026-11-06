const assert = require("node:assert/strict")
const path = require("node:path")
const test = require("node:test")

const modelPath = process.env.MODEL_PATH
assert.ok(modelPath, "MODEL_PATH must name the Model.js implementation under test")
const Model = require(path.resolve(modelPath))

// Shaped like `lighting status --json` on a PC with a graphics card, an
// unconfigured motherboard header and a keyboard.
const status = JSON.stringify({
  on: true,
  color: "#00E5FF",
  brightness: 1,
  connected: true,
  devices: [
    { key: "GPU", label: "Graphics card", name: "GPU", leds: 4, on: true, color: "#00e5ff", brightness: 1 },
    { key: "Board", label: "Motherboard", name: "Board", leds: 0, on: true, color: "#00e5ff", brightness: 1 },
    { key: "Kbd", label: "Keyboard", name: "Kbd", leds: 132, on: true, color: "#ff0000", brightness: 57 }
  ]
})

test("a missing app is reported, not hidden", () => {
  const s = Model.parseStatus(127, "")
  assert.equal(s.installed, false)
  assert.equal(Model.statusText(s, true), "App not installed")
})

test("an unreachable server keeps its error", () => {
  const s = Model.parseStatus(1, JSON.stringify({ on: true, connected: false, error: "can't reach OpenRGB", devices: [] }))
  assert.equal(s.installed, true)
  assert.equal(s.connected, false)
  assert.equal(s.problem, "can't reach OpenRGB")
  assert.equal(Model.statusText(s, true), "OpenRGB not reachable")
})

test("garbage output is a readable problem", () => {
  const s = Model.parseStatus(0, "not json")
  assert.equal(s.connected, false)
  assert.equal(s.problem, "Couldn't read lighting status")
})

test("devices without LEDs get no switch", () => {
  const s = Model.parseStatus(0, status)
  assert.deepEqual(s.devices.map(d => d.label), ["Graphics card", "Keyboard"])
  assert.equal(Model.statusText(s, true), "On · 2 devices")
})

test("brightness reads as mixed and sits at the brightest device", () => {
  const s = Model.parseStatus(0, status)
  assert.deepEqual(Model.brightnessSummary(s), { value: 57, mixed: true })
  s.devices[0].brightness = 57
  assert.deepEqual(Model.brightnessSummary(s), { value: 57, mixed: false })
})

test("a shared color is picked only when every device has it", () => {
  const s = Model.parseStatus(0, status)
  assert.equal(Model.commonColor(s), "")
  s.devices[1].color = "#00e5ff"
  assert.equal(Model.commonColor(s), "#00e5ff")
})

test("the bulb is lit only when something is", () => {
  const s = Model.parseStatus(0, status)
  assert.equal(Model.anyLit(s), true)
  s.devices.forEach(d => { d.on = false })
  assert.equal(Model.anyLit(s), false)
  assert.equal(Model.statusText(s, true), "Off")
  s.devices[0].on = true
  s.masterOn = false
  assert.equal(Model.anyLit(s), false)
  assert.equal(Model.dotRgb(s, s.devices[0]), null)
})

test("a dim device's dot still shows its color", () => {
  const s = Model.parseStatus(0, status)
  const [r, g, b] = Model.dotRgb(s, s.devices[0])
  assert.equal(r, 0)
  assert.ok(g > 0.2 && b > 0.2)
})

test("brightness is clamped to 0-100", () => {
  assert.equal(Model.clampBrightness(140), 100)
  assert.equal(Model.clampBrightness(-5), 0)
  assert.equal(Model.clampBrightness("42.6"), 43)
})

test("switching the master on shows every device on straight away", () => {
  const s = Model.parseStatus(0, status)
  const off = Model.withMaster(s, false)
  assert.equal(Model.anyLit(off), false)
  const on = Model.withMaster(off, true)
  assert.equal(Model.anyLit(on), true)
  assert.ok(on.devices.every(d => d.on))
  assert.equal(s.masterOn, true, "the original state is not changed")
})

test("waiting commands keep their order; only brightness merges", () => {
  let q = []
  q = Model.enqueue(q, ["set", "--brightness", "40"])
  q = Model.enqueue(q, ["set", "--color", "#ff0000"])
  q = Model.enqueue(q, ["on", "--device", "Kbd"])
  q = Model.enqueue(q, ["set", "--brightness", "70"])
  assert.deepEqual(q, [["set", "--brightness", "70"], ["set", "--color", "#ff0000"], ["on", "--device", "Kbd"]])
})

test("lights at 0% brightness count as dark", () => {
  const s = Model.parseStatus(0, status)
  s.devices.forEach(d => { d.brightness = 0 })
  assert.equal(Model.anyLit(s), false)
  assert.equal(Model.statusText(s, true), "Off")
})
