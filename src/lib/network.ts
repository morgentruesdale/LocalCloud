import { networkInterfaces } from 'os'

export function getPrimaryLanIp(): string {
  const nets = networkInterfaces()

  for (const iface of Object.values(nets)) {
    if (!iface) continue
    for (const net of iface) {
      if (net.family === 'IPv4' && !net.internal && net.mac !== '00:00:00:00:00:00') {
        return net.address
      }
    }
  }

  return 'localhost'
}
