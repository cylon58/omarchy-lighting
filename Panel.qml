import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "Model.js" as Model

// The PC's RGB lights in the bar, through OpenRGB (https://openrgb.org).
// The widget keeps its own settings, starts OpenRGB's server when nothing
// else has, and sends the saved look whenever the devices change (at login,
// after a replug, after OpenRGB restarts). Without OpenRGB it offers to
// install it.
Panel {
  id: root
  moduleName: "cylon58.lighting"
  ipcTarget: "cylon58.lighting"

  readonly property string home: Quickshell.env("HOME") || ""
  readonly property string stateDir: (Quickshell.env("XDG_STATE_HOME") || home + "/.local/state") + "/omarchy-lighting"
  readonly property string statePath: stateDir + "/state.json"
  // The Lighting app's settings, read once so its look carries over.
  readonly property string legacyPath: (Quickshell.env("XDG_CONFIG_HOME") || home + "/.config") + "/lighting/state.json"

  // What the user asked for, and what OpenRGB reports.
  property var saved: Model.defaultSettings()
  property bool savedReady: false
  property var deviceList: []
  // "unknown" until the first check, then missing / starting / ready / error.
  property string status: "unknown"
  property string problem: ""
  // The device list the saved look was last sent to; a new list re-sends it.
  property string appliedSignature: ""

  readonly property var lights: Model.view(saved, deviceList, status, problem)
  readonly property bool installed: lights.installed
  readonly property bool connected: lights.connected
  readonly property var devices: lights.devices
  readonly property bool anyLit: Model.anyLit(lights)
  readonly property string commonColor: Model.commonColor(lights)
  readonly property var brightnessInfo: Model.brightnessSummary(lights)
  readonly property string statusText: status === "unknown" ? "…" : Model.statusText(lights)
  readonly property int brightness: brightnessInfo.value

  readonly property var presets: ["#ffffff", "#ffb36b", "#ff0000", "#ff6a00", "#ffd000",
                                  "#00ff3c", "#00e5ff", "#0040ff", "#8c00ff", "#ff2fa8"]
  readonly property color foreground: bar ? bar.foreground : Commons.Color.foreground
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  function dotColor(d) {
    var rgb = Model.dotRgb(lights, d)
    return rgb ? Qt.rgba(rgb[0], rgb[1], rgb[2], 1) : dim
  }

  // ---------- Changes ----------

  // Every change saves the whole look and sends it to every device, so the
  // newest change always wins and nothing has to be queued.
  function change(next) {
    if (!savedReady || !connected) return
    saved = next
    stateFile.setText(Model.settingsText(next))
    sendSoon.restart()
  }
  function setMaster(on) { change(Model.setMaster(saved, on)) }
  function setDevice(key, on) { change(Model.setDevice(saved, key, on)) }
  function setBrightness(level) { change(Model.setBrightnessForAll(saved, level)) }
  function setColor(hex) { change(Model.setColorForAll(saved, hex)) }

  property bool sendAgain: false
  function send() {
    if (!savedReady || status !== "ready" || deviceList.length === 0) return
    if (applyProc.running) {
      sendAgain = true
      return
    }
    var args = Model.applyArgs(saved, deviceList)
    if (args.length === 0) return
    appliedSignature = Model.deviceSignature(deviceList)
    applyProc.command = ["bash", "-c",
      "ss -Hltn \"sport = :6742\" | grep -q . || exit 75; " +
      "QT_QPA_PLATFORM=offscreen exec openrgb \"$@\"", "openrgb"].concat(args)
    applyProc.running = true
  }

  function check() {
    if (!checkProc.running) checkProc.running = true
  }

  function installOpenRgb() {
    close()
    // Omarchy's own installer in a terminal, where the password is asked;
    // then the udev rules and i2c module OpenRGB ships, so most lights are
    // reachable without waiting for a restart.
    Quickshell.execDetached(["bash", "-lc", "omarchy-launch-floating-terminal-with-presentation " +
      "'omarchy-pkg-add openrgb && sudo udevadm control --reload && sudo udevadm trigger && sudo modprobe i2c-dev'"])
    installWatch.restart()
  }

  onOpenedChanged: if (opened) check()

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  FileView {
    id: stateFile
    path: root.statePath
    atomicWrites: true
    printErrors: false
    onLoaded: {
      root.saved = Model.parseSettings(text())
      root.savedReady = true
      root.send()
    }
    // No settings of our own yet: start from the Lighting app's, if any.
    onLoadFailed: legacyFile.path = root.legacyPath
  }

  FileView {
    id: legacyFile
    printErrors: false
    onLoaded: {
      root.saved = Model.parseSettings(text())
      root.savedReady = true
      root.send()
    }
    onLoadFailed: {
      root.savedReady = true
      root.send()
    }
  }

  // Finds OpenRGB, starts its server when nothing listens on its port, and
  // lists the devices. `openrgb` joins a running server on its own (it would
  // scan the hardware itself without one, hence the port check); --client
  // would join it a second time and list every device twice. Exit 127: not installed; 75: server not answering
  // yet (it takes a few seconds to find the hardware); 70: couldn't start.
  Process {
    id: checkProc
    command: ["bash", "-c",
      "mkdir -p \"$1\"; command -v openrgb >/dev/null 2>&1 || exit 127; " +
      "if ! ss -Hltn \"sport = :6742\" | grep -q .; then " +
      "  if ! systemctl --user -q is-active cylon58-lighting-openrgb.service; then " +
      "    systemctl --user reset-failed cylon58-lighting-openrgb.service 2>/dev/null; " +
      "    systemd-run --user --quiet --unit=cylon58-lighting-openrgb --setenv=QT_QPA_PLATFORM=offscreen " +
      "      openrgb --server --server-host 127.0.0.1 --noautoconnect || exit 70; " +
      "  fi; exit 75; " +
      "fi; " +
      "QT_QPA_PLATFORM=offscreen exec openrgb -ld",
      "check", root.stateDir]
    stdout: StdioCollector { id: checkOut }
    stderr: StdioCollector { id: checkErr }
    onExited: function(code) {
      // Whenever OpenRGB isn't answering, its devices will need the look
      // again once it is (it forgets colors when it restarts).
      if (code !== 0) root.appliedSignature = ""
      if (code === 127) {
        root.status = "missing"
        root.deviceList = []
      } else if (code === 75) {
        root.status = "starting"
        warm.restart()
      } else if (code === 70) {
        root.status = "error"
        root.problem = "Couldn't start OpenRGB's server"
      } else if (code !== 0) {
        root.status = "error"
        root.problem = String(checkErr.text).split("\n")[0] || "OpenRGB didn't answer"
      } else {
        if (root.status !== "ready") warm.restart()
        root.status = "ready"
        root.problem = ""
        root.deviceList = Model.parseDeviceList(checkOut.text)
        if (Model.deviceSignature(root.deviceList) !== root.appliedSignature) root.send()
      }
    }
  }

  Process {
    id: applyProc
    stderr: StdioCollector { id: applyErr }
    onExited: function(code) {
      if (code !== 0) {
        // Try again on the next check rather than giving up on this look.
        root.appliedSignature = ""
        root.problem = code === 75 ? "OpenRGB stopped answering"
          : (String(applyErr.text).split("\n")[0] || "Couldn't change the lights")
      } else if (root.status === "ready") {
        root.problem = ""
      }
      if (root.sendAgain) {
        root.sendAgain = false
        root.send()
      }
    }
  }

  // Groups a dragged slider's steps into a few sends.
  Timer {
    id: sendSoon
    interval: 60
    onTriggered: root.send()
  }

  // Checks often for a minute after OpenRGB starts, while it is still
  // finding devices, so each one lights up as soon as it appears.
  Timer {
    id: warm
    interval: 60000
    running: true
  }

  // After the install terminal opens, look for OpenRGB every few seconds.
  Timer {
    id: installWatch
    interval: 300000
  }

  Timer {
    interval: root.opened ? 3000 : (warm.running || installWatch.running || root.status === "starting" || root.status === "unknown") ? 2000 : 60000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.check()
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.anyLit ? "󰛨" : "󰌶"
    dimmed: !root.anyLit
    useActiveColor: false
    tooltipText: ""
    onPressed: function(b) {
      if (b === Qt.RightButton) root.setMaster(!root.anyLit)
      else root.toggle()
    }
    onWheelMoved: function(delta) {
      if (root.connected && root.anyLit) root.setBrightness(root.brightness + (delta > 0 ? 10 : -10))
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: panel.loadedContent
    contentWidth: panel.fittedContentWidth(Style.space(340))
    contentHeight: panel.fittedContentHeight(panel.loadedContentHeight)

    content: PanelKeyCatcher {
      anchors.fill: parent
      implicitHeight: column.implicitHeight
      onMoveRequested: function(dx, dy) {
        var step = dx !== 0 ? dx : -dy
        if (root.connected) root.setBrightness(root.brightness + step * 10)
      }
      onActivateRequested: if (root.connected) root.setMaster(!root.anyLit)
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

      Column {
        id: column
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        spacing: Style.space(14)

        // ---------- Hero: bulb · title/status · master switch ----------
        Item {
          width: parent.width
          implicitHeight: Math.max(heroIcon.implicitHeight, heroLabels.implicitHeight, masterSwitch.implicitHeight)

          Text {
            id: heroIcon
            textFormat: Text.PlainText
            text: root.anyLit ? "󰛨" : "󰌶"
            color: root.anyLit ? root.foreground : root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.display
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
          }

          Column {
            id: heroLabels
            anchors.left: heroIcon.right
            anchors.leftMargin: Style.space(14)
            anchors.right: masterSwitch.left
            anchors.rightMargin: Style.space(10)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(2)

            Text {
              text: "Lighting"
              textFormat: Text.PlainText
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.title
              font.bold: true
              elide: Text.ElideRight
              width: parent.width
            }
            Text {
              text: root.statusText.toUpperCase()
              textFormat: Text.PlainText
              color: Qt.darker(root.foreground, 1.4)
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
              font.letterSpacing: 1.2
              elide: Text.ElideRight
              width: parent.width
            }
          }

          ToggleSwitch {
            id: masterSwitch
            visible: root.installed && root.connected
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            checked: root.anyLit
            busy: applyProc.running
            foreground: root.foreground
            onToggled: root.setMaster(!root.anyLit)
          }
        }

        // ---------- Missing OpenRGB or no lights: say what to do ----------
        Text {
          visible: info !== ""
          readonly property string info: !root.installed
            ? "OpenRGB talks to the lights. Install it, then restart the PC once so it can reach every device."
            : root.problem !== "" ? root.problem
            : root.connected && root.devices.length === 0
            ? "OpenRGB found no RGB devices. A device that was just plugged in may need a restart."
            : ""
          width: parent.width
          wrapMode: Text.Wrap
          textFormat: Text.PlainText
          color: root.foreground
          opacity: 0.75
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
          text: info
        }

        Button {
          visible: root.status === "missing"
          width: parent.width
          text: "Install OpenRGB"
          iconText: "󰏔"
          foreground: root.foreground
          fontFamily: root.fontFamily
          fontSize: Style.font.bodySmall
          bordered: true
          onClicked: root.installOpenRgb()
        }

        // ---------- Devices ----------
        PanelSeparator { visible: root.connected && root.devices.length > 0; foreground: root.foreground }

        Column {
          visible: root.connected && root.devices.length > 0
          width: parent.width
          spacing: Style.space(8)

          PanelSectionHeader { text: "Devices"; foreground: root.foreground; fontFamily: root.fontFamily }

          Repeater {
            model: root.devices
            Item {
              required property var modelData
              width: parent.width
              implicitHeight: deviceSwitch.implicitHeight

              Rectangle {
                id: dot
                width: Style.space(10); height: width; radius: width / 2
                anchors.left: parent.left
                anchors.verticalCenter: parent.verticalCenter
                color: root.dotColor(modelData)
              }
              Text {
                anchors.left: dot.right
                anchors.leftMargin: Style.space(10)
                anchors.right: deviceSwitch.left
                anchors.rightMargin: Style.space(10)
                anchors.verticalCenter: parent.verticalCenter
                text: modelData.label
                textFormat: Text.PlainText
                elide: Text.ElideRight
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
              }
              ToggleSwitch {
                id: deviceSwitch
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                checked: modelData.on === true
                foreground: root.foreground
                onToggled: root.setDevice(modelData.key, !(modelData.on === true))
              }
            }
          }
        }

        // ---------- Brightness ----------
        Column {
          visible: root.connected && root.devices.length > 0
          width: parent.width
          spacing: Style.space(6)

          Item {
            width: parent.width
            implicitHeight: brightnessHeader.implicitHeight
            PanelSectionHeader {
              id: brightnessHeader
              anchors.left: parent.left
              text: "Brightness"
              foreground: root.foreground
              fontFamily: root.fontFamily
            }
            Text {
              anchors.right: parent.right
              anchors.verticalCenter: brightnessHeader.verticalCenter
              text: root.brightnessInfo.mixed ? "Mixed" : root.brightness + "%"
              textFormat: Text.PlainText
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
            }
          }

          PanelSlider {
            bar: root.bar
            width: parent.width
            minimum: 0
            maximum: 100
            step: 1
            integer: true
            value: root.brightness
            onMoved: function(v) { root.setBrightness(v) }
          }
        }

        // ---------- Color presets (every device) ----------
        Column {
          visible: root.connected && root.devices.length > 0
          width: parent.width
          spacing: Style.space(8)

          PanelSectionHeader { text: "Color"; foreground: root.foreground; fontFamily: root.fontFamily }

          Row {
            id: swatches
            width: parent.width
            spacing: Style.space(6)
            readonly property real cell: (width - spacing * (root.presets.length - 1)) / root.presets.length

            Repeater {
              model: root.presets
              Item {
                required property string modelData
                width: swatches.cell
                height: swatches.cell
                readonly property bool picked: root.commonColor === modelData

                Rectangle {
                  anchors.centerIn: parent
                  width: parent.width; height: width; radius: width / 2
                  color: "transparent"
                  border.width: parent.picked ? Math.max(2, Style.space(2)) : 0
                  border.color: root.foreground
                }
                Rectangle {
                  anchors.centerIn: parent
                  width: parent.width - Style.space(6); height: width; radius: width / 2
                  color: modelData
                }
                MouseArea {
                  anchors.fill: parent
                  cursorShape: Qt.PointingHandCursor
                  onClicked: root.setColor(parent.modelData)
                }
              }
            }
          }
        }

      }
    }
  }
}
