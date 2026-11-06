const assert = require("node:assert/strict")
const path = require("node:path")
const test = require("node:test")

const modelPath = process.env.MODEL_PATH
assert.ok(modelPath, "MODEL_PATH must name the Model.js implementation under test")
const Model = require(path.resolve(modelPath))

// Shaped like `openrgb -ld` on a PC with a graphics card, a motherboard whose
// headers have no LEDs set up, a keyboard and two identical RAM sticks.
const listing = `0: EVGA GeForce RTX 3090 Ti FTW3 Gaming
  Type:           GPU
  Location:       I2C: NVIDIA i2c adapter 1 at 1:00.0
 (/dev/i2c-1), address 0x2D
  Modes: Off [Direct] Breathing
  Zones: 'Front Logo' 'Back Logo'
  LEDs: 'Front Logo' 'Back Logo'

1: ASUS TUF GAMING B850-E WIFI
  Type:           Motherboard
  Modes: [Direct] Off Static
  Zones: 'Addressable RGB Header 1'

2: Razer Cynosa Chroma
  Type:           Keyboard
  LEDs:  'Key: Escape'  'Key: F1'

3: Kingston Fury
  Type:           DRAM
  LEDs: 'LED 1'

4: Kingston Fury
  Type:           DRAM
  LEDs: 'LED 1'
`

// The Lighting app's saved settings on that PC.
const appState = JSON.stringify({
  on: true,
  color: "#00e5ff",
  brightness: 100,
  devices: { "Razer Cynosa Chroma": { on: true, color: "#ff0000", brightness: 57 } }
})

const devices = Model.parseDeviceList(listing)
const ready = s => Model.view(s, devices, "ready", "")

test("the device list reads names, kinds and which have LEDs", () => {
  assert.deepEqual(devices.map(d => [d.index, d.key, d.label, d.hasLeds]), [
    [0, "EVGA GeForce RTX 3090 Ti FTW3 Gaming", "Graphics card", true],
    [1, "ASUS TUF GAMING B850-E WIFI", "Motherboard", false],
    [2, "Razer Cynosa Chroma", "Keyboard", true],
    [3, "Kingston Fury", "Memory 1", true],
    [4, "Kingston Fury 2", "Memory 2", true]
  ])
})

test("an empty or broken listing is no devices", () => {
  assert.deepEqual(Model.parseDeviceList(""), [])
  assert.deepEqual(Model.parseDeviceList("Connection attempt failed"), [])
})

test("devices without LEDs get no switch and no color", () => {
  const s = ready(Model.parseSettings(appState))
  assert.deepEqual(s.devices.map(d => d.label), ["Graphics card", "Keyboard", "Memory 1", "Memory 2"])
  const args = Model.applyArgs(Model.parseSettings(appState), devices)
  assert.ok(!args.includes("1"), "the motherboard is left alone")
})

test("the Lighting app's settings carry over", () => {
  const settings = Model.parseSettings(appState)
  assert.deepEqual(Model.applyArgs(settings, devices), [
    "-d", "0", "-c", "00e5ff",
    "-d", "2", "-c", "910000",
    "-d", "3", "-c", "00e5ff",
    "-d", "4", "-c", "00e5ff"
  ])
})

test("unreadable settings fall back to white at full brightness", () => {
  const s = Model.parseSettings("not json")
  assert.deepEqual(s, Model.defaultSettings())
  assert.equal(Model.outputHex(s, "anything"), "ffffff")
})

test("off sends black but keeps each device's look for later", () => {
  const off = Model.setMaster(Model.parseSettings(appState), false)
  assert.ok(Model.applyArgs(off, devices).filter((_, i) => i % 4 === 3).every(c => c === "000000"))
  const on = Model.setMaster(off, true)
  assert.equal(Model.outputHex(on, "Razer Cynosa Chroma"), "910000")
})

test("all on brings back a device switched off on its own", () => {
  let s = Model.setDevice(Model.parseSettings(appState), "Razer Cynosa Chroma", false)
  assert.equal(Model.outputHex(s, "Razer Cynosa Chroma"), "000000")
  s = Model.setMaster(Model.setMaster(s, false), true)
  assert.equal(Model.outputHex(s, "Razer Cynosa Chroma"), "910000")
})

test("switching one device on while all are off lights the rest too", () => {
  let s = Model.setMaster(Model.parseSettings(appState), false)
  s = Model.setDevice(s, "Kingston Fury", true)
  assert.equal(s.on, true)
  assert.equal(Model.outputHex(s, "EVGA GeForce RTX 3090 Ti FTW3 Gaming"), "00e5ff")
})

test("color and brightness for all reach devices with their own look", () => {
  let s = Model.setColorForAll(Model.parseSettings(appState), "#FF6A00")
  assert.equal(Model.commonColor(ready(s)), "#ff6a00")
  s = Model.setBrightnessForAll(s, 50)
  assert.deepEqual(Model.brightnessSummary(ready(s)), { value: 50, mixed: false })
  assert.equal(Model.outputHex(s, "Razer Cynosa Chroma"), "803500")
})

test("settings survive a save and a read", () => {
  const s = Model.setDevice(Model.parseSettings(appState), "EVGA GeForce RTX 3090 Ti FTW3 Gaming", false)
  assert.deepEqual(Model.parseSettings(Model.settingsText(s)), s)
})

test("brightness reads as mixed and sits at the brightest device", () => {
  assert.deepEqual(Model.brightnessSummary(ready(Model.parseSettings(appState))), { value: 100, mixed: true })
})

test("a shared color is picked only when every device has it", () => {
  assert.equal(Model.commonColor(ready(Model.parseSettings(appState))), "")
})

test("the bulb is lit only when something is", () => {
  let s = Model.parseSettings(appState)
  assert.equal(Model.anyLit(ready(s)), true)
  assert.equal(Model.statusText(ready(s)), "On · 4 devices")
  s = Model.setMaster(s, false)
  assert.equal(Model.anyLit(ready(s)), false)
  assert.equal(Model.statusText(ready(s)), "Off")
  assert.equal(Model.dotRgb(ready(s), ready(s).devices[0]), null)
})

test("lights at 0% brightness count as dark", () => {
  const s = Model.setBrightnessForAll(Model.parseSettings(appState), 0)
  assert.equal(Model.anyLit(ready(s)), false)
})

test("a dim device's dot still shows its color", () => {
  const s = Model.setBrightnessForAll(Model.parseSettings(appState), 1)
  const [r, g, b] = Model.dotRgb(ready(s), ready(s).devices[0])
  assert.equal(r, 0)
  assert.ok(g > 0.2 && b > 0.2)
})

test("each OpenRGB state reads plainly", () => {
  const s = Model.defaultSettings()
  assert.equal(Model.statusText(Model.view(s, [], "missing", "")), "OpenRGB not installed")
  assert.equal(Model.anyLit(Model.view(s, [], "missing", "")), false, "the bulb is dark without OpenRGB")
  assert.equal(Model.view(s, [], "missing", "").installed, false)
  assert.equal(Model.statusText(Model.view(s, [], "starting", "")), "Starting OpenRGB…")
  assert.equal(Model.statusText(Model.view(s, [], "error", "x")), "OpenRGB not reachable")
  assert.equal(Model.statusText(Model.view(s, [], "ready", "")), "No lights found")
})

test("a new or renumbered device changes the signature, so the look is sent again", () => {
  const before = Model.deviceSignature(devices.slice(0, 3))
  assert.notEqual(Model.deviceSignature(devices), before)
  assert.equal(Model.deviceSignature(Model.parseDeviceList(listing)), Model.deviceSignature(devices))
})

test("brightness is clamped to 0-100", () => {
  assert.equal(Model.clampBrightness(140), 100)
  assert.equal(Model.clampBrightness(-5), 0)
  assert.equal(Model.clampBrightness("42.6"), 43)
})
