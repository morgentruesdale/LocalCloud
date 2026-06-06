import { headers } from 'next/headers'
import { getPrimaryLanIp } from '@/lib/network'
import Dashboard from '@/components/Dashboard'

export const metadata = {
  title: 'LocalCloud',
  description: 'Local network file transfer',
}

export default async function Home() {
  const headersList = await headers()
  const host = headersList.get('host') ?? 'localhost:3000'
  const port = host.includes(':') ? host.split(':')[1] : '3000'
  const ip = getPrimaryLanIp()

  return <Dashboard serverIp={ip} port={port} />
}
