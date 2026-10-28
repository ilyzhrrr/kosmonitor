import { useCallback, useEffect, useRef, useState } from 'react'
import mqtt from 'mqtt'
import { BROKER_URL } from './config'

const today = () => new Date().toISOString().slice(0, 10)

function loadAcc(key) {
  try {
    const a = JSON.parse(localStorage.getItem(key))
    if (a) return a.date === today() ? a : { date: today(), today: 0, total: a.total }
  } catch { /* abaikan */ }
  return { date: today(), today: 0, total: 0 }
}

// Satu koneksi MQTT per penghuni login. Dashboard TIDAK membaca data mentah ESP32;
// semua lewat backend kos-monitor-be yang memvalidasi data dulu:
//   {base}/validated/telemetry   JSON {voltage_v, current_a, power_w, load_percent, led1, led2, status, warnings}
//   {base}/validated/ledN/state  "ON" | "OFF"  (status lampu yang lolos validasi)
//   {base}/validated/rejected    JSON {kind, errors, raw}  (data yang ditolak backend)
//   {base}/request/ledN/cmd      "ON" | "OFF"  (dikirim dashboard; backend cek lalu teruskan ke ESP32)
export function useRoom(user) {
  const [status, setStatus] = useState('connecting') // status broker: connecting | online | offline
  const [deviceOnline, setDeviceOnline] = useState(false) // true jika ada telemetry <5 detik terakhir
  const [tele, setTele] = useState(null)
  const [lamps, setLamps] = useState({ 1: null, 2: null })
  const [history, setHistory] = useState([])
  const [lastUpdate, setLastUpdate] = useState(null)
  const [logs, setLogs] = useState([])
  const accKey = `kos_acc_kamar${user.kamar}`
  const [acc, setAcc] = useState(() => loadAcc(accKey))
  const clientRef = useRef(null)
  const lastTs = useRef(null)
  const lastSeen = useRef(0)
  const lampsRef = useRef(lamps)
  lampsRef.current = lamps

  const base = user.mqttBase
  const topics = {
    telemetry: `${base}/validated/telemetry`,
    rejected: `${base}/validated/rejected`,
    cmd: (n) => `${base}/request/led${n}/cmd`,
    state: (n) => `${base}/validated/led${n}/state`,
  }
  const lastWarn = useRef('')

  const log = useCallback((m) => {
    setLogs((l) => [`[${new Date().toLocaleTimeString('id-ID')}] ${m}`, ...l].slice(0, 40))
  }, [])

  const onTele = useCallback((d) => {
    lastSeen.current = Date.now()
    setTele(d)
    setLastUpdate(new Date())
    if (d.led1 !== undefined) setLamps((l) => ({ ...l, 1: String(d.led1).toUpperCase() === 'ON' }))
    if (d.led2 !== undefined) setLamps((l) => ({ ...l, 2: String(d.led2).toUpperCase() === 'ON' }))
    if (d.power_w != null) {
      setHistory((h) => [...h, Number(d.power_w)].slice(-7))
      const now = Date.now()
      const dt = lastTs.current ? Math.min((now - lastTs.current) / 1000, 10) : 0
      lastTs.current = now
      const dk = (Number(d.power_w) * dt) / 3.6e6 // W·detik → kWh
      setAcc((a) => {
        const n = a.date === today() ? { ...a } : { date: today(), today: 0, total: a.total }
        n.today += dk
        n.total += dk
        localStorage.setItem(accKey, JSON.stringify(n))
        return n
      })
    }
  }, [accKey])

  // Perangkat dianggap hidup jika telemetry terakhir masuk kurang dari 5 detik lalu.
  useEffect(() => {
    const id = setInterval(() => setDeviceOnline(Date.now() - lastSeen.current < 15000), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    lastTs.current = null
    lastSeen.current = 0

    // Kamar simulasi: data dummy lokal, tanpa broker.
    if (user.simulate) {
      setStatus('online')
      setLamps({ 1: true, 2: false })
      log('Mode simulasi aktif (tanpa broker).')
      const id = setInterval(() => {
        const on = user.devices.filter((d) => lampsRef.current[d.id])
        const v = 218 + Math.random() * 4
        const p = on.reduce((s, d) => s + d.watt * (0.95 + Math.random() * 0.1), 2)
        const max = user.devices.reduce((s, d) => s + d.watt, 2)
        onTele({
          voltage_v: v, current_a: p / (v * 0.95), power_w: p, load_percent: (p / max) * 100,
          led1: lampsRef.current[1] ? 'ON' : 'OFF', led2: lampsRef.current[2] ? 'ON' : 'OFF',
        })
      }, 2000)
      return () => clearInterval(id)
    }

    // Kamar dengan perangkat (ESP32 / Wokwi): koneksi MQTT lewat WebSocket.
    setStatus('connecting')
    const c = mqtt.connect(BROKER_URL, {
      clientId: `kosmonitor_kamar${user.kamar}_${Math.random().toString(16).slice(2, 8)}`,
      clean: true, connectTimeout: 10000, reconnectPeriod: 3000, keepalive: 30,
    })
    clientRef.current = c
    c.on('connect', () => {
      setStatus('online')
      log(`Terhubung ke broker. Topik: ${base}/…`)
      c.subscribe([topics.telemetry, topics.rejected, topics.state(1), topics.state(2)], { qos: 0 }, (err) => {
        if (err) log('Subscribe gagal: ' + err.message)
      })
    })
    c.on('reconnect', () => setStatus('connecting'))
    c.on('offline', () => setStatus('offline'))
    c.on('close', () => setStatus('offline'))
    c.on('error', (e) => log('MQTT error: ' + e.message))
    c.on('message', (topic, msg) => {
      const payload = msg.toString()
      if (topic === topics.telemetry) {
        try {
          const d = JSON.parse(payload)
          onTele(d)
          // Catat peringatan validasi sekali saja, tidak tiap pesan.
          const w = (d.warnings || []).join('; ')
          if (w && w !== lastWarn.current) log('Peringatan validasi: ' + w)
          lastWarn.current = w
        } catch { log('Telemetry bukan JSON valid.') }
      } else if (topic === topics.rejected) {
        try {
          const r = JSON.parse(payload)
          log(`Data DITOLAK backend (${r.kind}): ${(r.errors || []).join('; ')}`)
        } catch { /* abaikan */ }
      } else if (topic === topics.state(1)) setLamps((l) => ({ ...l, 1: payload.trim().toUpperCase() === 'ON' }))
      else if (topic === topics.state(2)) setLamps((l) => ({ ...l, 2: payload.trim().toUpperCase() === 'ON' }))
    })
    return () => c.end(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.kamar])

  // Toggle langsung bergeser setelah perintah terkirim ke broker.
  // Status asli tetap dikoreksi otomatis dari balasan ESP32.
  const sendCmd = useCallback((n, on) => {
    const name = user.devices.find((d) => d.id === n)?.nama ?? `Channel ${n}`
    if (user.simulate) {
      setLamps((l) => ({ ...l, [n]: on }))
      log(`${name} ${on ? 'dinyalakan' : 'dimatikan'} (simulasi)`)
      return true
    }
    const c = clientRef.current
    if (!c || !c.connected) { log('Gagal: MQTT belum terhubung.'); return false }
    c.publish(topics.cmd(n), on ? 'ON' : 'OFF', { qos: 0, retain: false }, (err) => {
      if (err) return log(`Publish gagal: ${topics.cmd(n)}`)
      setLamps((l) => ({ ...l, [n]: on }))
      log(`${name} ← ${on ? 'ON' : 'OFF'}`)
    })
    return true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.kamar])

  return { status, deviceOnline, tele, lamps, history, acc, logs, lastUpdate, sendCmd, topics, log }
}