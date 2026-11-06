# Lighting for the Omarchy bar

![Lighting panel](preview.png)

A lightbulb in the bar for your PC's RGB lights: switch everything (or one
device) on or off, set brightness, and pick a color, without opening an app.

It is the bar side of [Lighting](https://github.com/cylon58/lighting), which
does the work through [OpenRGB](https://openrgb.org). Install that first.

## Install

1. Install the Lighting app (it needs your password once: it pulls in OpenRGB,
   whose udev rules let your user reach the lights):

   ```sh
   git clone https://github.com/cylon58/lighting.git && lighting/bin/install
   ```

2. Add the widget:

   ```sh
   omarchy plugin add https://github.com/cylon58/omarchy-lighting.git --enable
   ```

Without the app, the panel says so and points here.

## Use

| On the bulb | Does |
| --- | --- |
| Click | Open the panel |
| Right-click | All lights on or off |
| Middle-click | Open the Lighting app |
| Scroll | Brighter or dimmer |

In the panel, the top switch is the master switch, each device has its own
switch, and the slider and colors apply to every device. Brightness reads
"Mixed" when devices differ; moving it sets them all. Per-device color and
brightness live in the app ("Open Lighting").

## What it runs

Only the `lighting` command: `lighting status --json` every 30 seconds (every
3 while the panel is open), and `lighting on|off|set` when you change
something. It writes no settings of its own; the app keeps the state in
`~/.config/lighting/state.json`.

## Remove

```sh
omarchy plugin remove cylon58.lighting
```

## Develop

```sh
MODEL_PATH=Model.js node --test tests/model.test.cjs
omarchy plugin validate .
```
