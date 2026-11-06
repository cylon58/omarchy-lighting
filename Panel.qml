import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "Model.js" as Model

// The Lighting app's controls in the bar. Everything goes through the
// `lighting` command line (https://github.com/cylon58/lighting), which talks
// to OpenRGB; this widget only reads `lighting status --json` and runs
// `lighting on|off|set`. Without the app it says so instead of doing nothing.
Panel {
  id: root
  moduleName: "cylon58.lighting"
  ipcTarget: "cylon58.lighting"

  property bool loaded: false
  property var state: Model.parseStatus(0, "")

  readonly property bool installed: state.installed
  readonly property bool connected: state.connected
  readonly property var devices: state.devices
  readonly property bool anyLit: Model.anyLit(state)
  readonly property string commonColor: Model.commonColor(state)
  readonly property var brightnessInfo: Model.brightnessSummary(state)
  readonly property string statusText: Model.statusText(state, loaded)
  // What the slider shows while dragging, before the next status read.
  property int pendingBrightness: -1
  readonly property int brightness: pendingBrightness >= 0 ? pendingBrightness : brightnessInfo.value

  readonly property var presets: ["#ffffff", "#ffb36b", "#ff0000", "#ff6a00", "#ffd000",
                                  "#00ff3c", "#00e5ff", "#0040ff", "#8c00ff", "#ff2fa8"]
  readonly property color foreground: bar ? bar.foreground : Commons.Color.foreground
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  function dotColor(d) {
    var rgb = Model.dotRgb(state, d)
    return rgb ? Qt.rgba(rgb[0], rgb[1], rgb[2], 1) : dim
  }

  function refresh() {
    if (!statusProc.running) statusProc.running = true
  }

  function applyStatus(exitCode, text) {
    loaded = true
    state = Model.parseStatus(exitCode, text)
    // A status read that lands while a brightness change is still queued
    // would snap the slider back; keep the dragged value until it's sent.
    if (!brightnessDebounce.running && !actionProc.running) pendingBrightness = -1
  }

  // Commands run one at a time; while one runs, only the newest waiting
  // command is kept, so a dragged slider can't pile up dozens of them.
  property var pending: null
  function run(args) {
    if (!installed) return
    if (actionProc.running) { pending = args; return }
    actionProc.command = ["lighting"].concat(args)
    actionProc.running = true
  }

  function setMaster(on) {
    state = Object.assign({}, state, { masterOn: on })
    run([on ? "on" : "off"])
  }
  function setDevice(key, on) {
    run([on ? "on" : "off", "--device", key])
  }
  function setBrightness(level) {
    pendingBrightness = Model.clampBrightness(level)
    brightnessDebounce.restart()
  }
  function setColor(hex) {
    run(["set", "--color", hex])
  }
  function openApp() {
    close()
    if (bar) bar.run("setsid -f lighting open >/dev/null 2>&1")
  }

  onOpenedChanged: if (opened) refresh()

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  Process {
    id: statusProc
    // 127 means the app isn't on PATH; that's shown, not hidden.
    command: ["sh", "-c", "command -v lighting >/dev/null 2>&1 || exit 127; exec lighting status --json"]
    stdout: StdioCollector { id: statusOut }
    onExited: function(code) { root.applyStatus(code, statusOut.text) }
  }

  Process {
    id: actionProc
    onExited: {
      if (root.pending) {
        var next = root.pending
        root.pending = null
        actionProc.command = ["lighting"].concat(next)
        actionProc.running = true
        return
      }
      root.refresh()
    }
  }

  Timer {
    id: brightnessDebounce
    interval: 120
    onTriggered: root.run(["set", "--brightness", String(root.pendingBrightness)])
  }

  // Keeps the bulb honest when something else (the app, a keybinding)
  // changes the lights; faster while the panel is open.
  Timer {
    interval: root.opened ? 3000 : 30000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
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
      else if (b === Qt.MiddleButton) root.openApp()
      else root.toggle()
    }
    onWheelMoved: function(delta) {
      if (root.connected) root.setBrightness(root.brightness + (delta > 0 ? 10 : -10))
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
            busy: actionProc.running
            foreground: root.foreground
            onToggled: root.setMaster(!root.anyLit)
          }
        }

        // ---------- Missing app or server: say what to do ----------
        Text {
          visible: !root.installed || (root.loaded && !root.connected)
          width: parent.width
          wrapMode: Text.Wrap
          textFormat: Text.PlainText
          color: root.foreground
          opacity: 0.75
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
          text: !root.installed
            ? "This widget drives the Lighting app. Install it from github.com/cylon58/lighting, then reopen this panel."
            : (root.state.problem !== "" ? root.state.problem : "Start OpenRGB with: systemctl --user start lighting-server")
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
              text: root.brightnessInfo.mixed && root.pendingBrightness < 0 ? "Mixed" : root.brightness + "%"
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

        // ---------- Everything else lives in the app ----------
        Button {
          visible: root.installed
          width: parent.width
          text: "Open Lighting"
          iconText: "󰏘"
          foreground: root.foreground
          fontFamily: root.fontFamily
          fontSize: Style.font.bodySmall
          bordered: true
          onClicked: root.openApp()
        }
      }
    }
  }
}
