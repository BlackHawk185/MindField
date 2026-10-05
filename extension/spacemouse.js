import HID from 'node-hid'

const VENDOR_IDS = [0x046d, 0x256f]

function readInt16(buffer, offset) {
  const raw = buffer[offset] | (buffer[offset + 1] << 8)
  return raw >= 0x8000 ? raw - 0x10000 : raw
}

// Reads the SpaceMouse in the extension host (Node has full HID access, unlike the
// sandboxed webview) and streams merged 6-axis frames to the webview over postMessage.
export function createSpaceMouseBridge(log) {
  let device = null
  const axes = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 }

  const start = (post) => {
    if (device) return { ok: true, name: 'SpaceMouse already connected' }
    const devices = HID.devices()
    // Prefer the actual 6-axis puck by name; vendor 0x046d also covers unrelated Logitech receivers.
    const info = devices.find((entry) => /space/i.test(entry.product ?? ''))
      ?? devices.find((entry) => VENDOR_IDS.includes(entry.vendorId) && /3dconnexion/i.test(entry.manufacturer ?? entry.product ?? ''))
    if (!info || !info.path) return { ok: false, error: 'No SpaceMouse found on this machine.' }

    device = new HID.HID(info.path)
    device.on('data', (buffer) => {
      const reportId = buffer[0]
      const a = readInt16(buffer, 1)
      const b = readInt16(buffer, 3)
      const c = readInt16(buffer, 5)
      if (reportId === 1) { axes.tx = a; axes.ty = b; axes.tz = c }
      else if (reportId === 2) { axes.rx = a; axes.ry = b; axes.rz = c }
      else return
      post({ type: 'mindfield.spacemouse', axes: { ...axes } })
    })
    device.on('error', (error) => {
      log?.(`spacemouse error: ${error instanceof Error ? error.message : String(error)}`)
      stop()
      post({ type: 'mindfield.spacemouse-stopped' })
    })
    return { ok: true, name: info.product ?? 'SpaceMouse connected' }
  }

  const stop = () => {
    if (!device) return
    try { device.close() } catch { /* device already gone */ }
    device = null
  }

  return { start, stop }
}
