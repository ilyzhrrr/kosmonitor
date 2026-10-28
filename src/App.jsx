import { useEffect, useRef, useState } from 'react'
import { USERS } from './config'
import { useRoom } from './useRoom'

const fmt = (n, d = 1) =>
  n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d })
const rupiah = (n) => 'Rp ' + Math.round(n).toLocaleString('id-ID')

function Switch({ on, onChange, label, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={!!on} aria-label={label}
      className={'switch' + (on ? ' on' : '')} disabled={disabled} onClick={() => onChange(!on)} />
  )
}

/* ---------- Login ---------- */
function Login({ onLogin }) {
  const [error, setError] = useState('')

  const submit = (e) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const name = String(f.get('kos-username') || '').trim()
    const pass = String(f.get('kos-password') || '').trim()
    const u = USERS.find(
      (x) => x.username.toLowerCase() === name.toLowerCase() && x.password === pass
    )
    if (!u) return setError(`Username atau password salah. Terbaca: "${name}" / "${pass}"`)
    onLogin(u.username)
  }

  return (
    <main className="login">
      <div className="logo" aria-hidden="true">⚡</div>
      <h1>KosMonitor</h1>
      <p className="sub">Masuk untuk memantau dan mengontrol listrik kamarmu.</p>

      <form onSubmit={submit} className="card form" autoComplete="off">
        <label htmlFor="u">Username</label>
        <input id="u" name="kos-username" autoComplete="off" required />
        <label htmlFor="p">Password</label>
        <input id="p" name="kos-password" type="password" autoComplete="off" required />
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn" type="submit">Masuk</button>
      </form>

      <div className="card demo">
        <b>Akun demo (ketuk untuk masuk):</b>
        {USERS.map((u) => (
          <button
            key={u.username}
            type="button"
            className="demo-row"
            onClick={() => onLogin(u.username)}
          >
            <b>Kamar {u.kamar}</b>
            <span>Username: {u.username}</span>
            <span>Password: {u.password}</span>
          </button>
        ))}
      </div>
    </main>
  )
}

/* ---------- Beranda ---------- */
function Beranda({ user, room }) {
  const { status, deviceOnline, tele, lamps, history, acc, lastUpdate } = room
  const kwhBulan = user.kwhBulanIni + acc.total
  const biaya = kwhBulan * user.tarif
  const persen = Math.min(100, (biaya / user.targetBulanan) * 100)
  const max = Math.max(1, ...history)
  const bars = Array.from({ length: 7 }, (_, i) => history[history.length - 7 + i] ?? 0)
  const aktif = user.devices.filter((d) => lamps[d.id])

  const chipLabel =
    status === 'connecting' ? 'Menghubungkan broker'
    : status !== 'online' ? 'Broker terputus'
    : deviceOnline ? 'Perangkat terhubung'
    : 'Perangkat offline'
  const chipClass = status === 'online' ? (deviceOnline ? 'online' : 'connecting') : status

  return (
    <>
      <div className="row">
        <div>
          <div className="sub">Kamar {user.kamar} · {user.nama}</div>
          <h1>Listrik Kost</h1>
        </div>
        <span className={'chip ' + chipClass}>● {chipLabel}</span>
      </div>

      <section className="hero">
        <div className="hero-label">Daya saat ini</div>
        <div className="hero-value">{fmt(tele?.power_w, 0)} <span>Watt</span></div>
        <div className="bars" aria-hidden="true">
          {bars.map((v, i) => (
            <i key={i} className={i === 6 ? 'now' : ''} style={{ height: Math.max(6, (v / max) * 100) + '%' }} />
          ))}
        </div>
        <div className="hero-label">
          {lastUpdate ? 'Diperbarui ' + lastUpdate.toLocaleTimeString('id-ID') : 'Menunggu data…'}
          {tele?.status && ` · ${tele.status === 'warning' ? 'lolos validasi (ada peringatan)' : 'tervalidasi backend'}`}
        </div>
      </section>

      <div className="metrics">
        {[
          ['Tegangan', fmt(tele?.voltage_v, 1), 'V', 'Tegangan simulasi'],
          ['Arus', fmt(tele?.current_a, 3), 'A', 'Arus simulasi'],
          ['Daya estimasi', fmt(tele?.power_w, 2), 'W', 'V × I × faktor daya'],
          ['Beban', fmt(tele?.load_percent, 1), '%', 'Posisi potensiometer'],
        ].map(([label, val, unit, note]) => (
          <div key={label} className="card">
            <div className="sub">{label}</div>
            <div className="stat">{val} <span className="unit">{unit}</span></div>
            <div className="sub">{note}</div>
          </div>
        ))}
      </div>

      <div className="two">
        <div className="card"><div className="sub">Hari ini</div><div className="stat">{fmt(acc.today, 3)} kWh</div></div>
        <div className="card"><div className="sub">Biaya bulan ini</div><div className="stat">{rupiah(biaya)}</div></div>
      </div>

      <div className="card">
        <div className="row"><b>Target bulan ini</b><span className="sub">{Math.round(persen)}%</span></div>
        <div className="track"><div style={{ width: persen + '%' }} /></div>
        <div className="sub">{rupiah(biaya)} dari {rupiah(user.targetBulanan)} · {fmt(kwhBulan, 1)} kWh</div>
      </div>

      <div className="card">
        <b>Beban aktif</b>
        {aktif.length === 0 && <p className="sub">Tidak ada perangkat yang menyala.</p>}
        {aktif.map((d) => (
          <div key={d.id} className="row item"><span>{d.nama}</span><b>{d.watt} W</b></div>
        ))}
      </div>
    </>
  )
}

/* ---------- Kontrol ---------- */
function Kontrol({ user, room }) {
  const online = room.status === 'online'
  return (
    <>
      <div>
        <h1>Kontrol Beban</h1>
        <div className="sub">Nyalakan atau matikan manual lewat MQTT</div>
      </div>
      {user.devices.map((d) => {
        const on = room.lamps[d.id]
        return (
          <div key={d.id} className="card row">
            <div>
              <div className="name">{d.nama}</div>
              <div className="sub">{on == null ? 'Status belum diketahui' : on ? 'Menyala' : 'Mati'} · Relay {d.gpio}</div>
            </div>
            <Switch on={on} label={d.nama} disabled={!online} onChange={(v) => room.sendCmd(d.id, v)} />
          </div>
        )
      })}
      <div className="card note">
        <b>Override manual</b>
        <div className="sub">Tombol di sini mengalahkan jadwal sampai jadwal berikutnya berjalan.</div>
      </div>
    </>
  )
}

/* ---------- Jadwal ---------- */
// Perangkat tambahan di luar Lampu 1 & 2. Perintah dikirim ke {base}/led{channel}/cmd.
const EXTRA_DEVICES = [
  { channel: 3, nama: 'Lampu 3' },
  { channel: 4, nama: 'AC' },
]
const extraName = (ch) => EXTRA_DEVICES.find((d) => d.channel === ch)?.nama ?? `Channel ${ch}`

function useSchedules(user, room) {
  const keyFixed = `kos_sched_kamar${user.kamar}`
  const keyExtra = `kos_sched_extra_kamar${user.kamar}`
  const read = (k, fallback) => {
    try { return JSON.parse(localStorage.getItem(k)) ?? fallback } catch { return fallback }
  }
  const [fixed, setFixed] = useState(() => read(keyFixed, {}))
  const [extra, setExtra] = useState(() => read(keyExtra, []))
  const fired = useRef({})

  // Jadwal Lampu 1 & 2: tersimpan otomatis setiap ada perubahan.
  const saveFixed = (id, s) => {
    const next = { ...fixed, [id]: s }
    setFixed(next)
    localStorage.setItem(keyFixed, JSON.stringify(next))
  }
  const removeFixed = (id) => {
    const next = { ...fixed }
    delete next[id]
    setFixed(next)
    localStorage.setItem(keyFixed, JSON.stringify(next))
    room.log(`Jadwal ${user.devices.find((d) => d.id === id).nama} dihapus`)
  }

  // Jadwal tambahan (Lampu 3, AC): tersimpan setelah menekan "Simpan jadwal",
  // lalu setiap perubahan di kartunya tersimpan otomatis.
  const persistExtra = (next) => {
    setExtra(next)
    localStorage.setItem(keyExtra, JSON.stringify(next))
  }
  const addExtra = (s) => {
    persistExtra([...extra, { ...s, id: Date.now(), enabled: true }])
    room.log(`Jadwal ditambah: ${extraName(s.channel)} ${s.action} ${s.time}`)
  }
  const updateExtra = (id, s) => persistExtra(extra.map((x) => (x.id === id ? { ...x, ...s } : x)))
  const removeExtra = (id) => {
    persistExtra(extra.filter((x) => x.id !== id))
    room.log('Jadwal dihapus')
  }

  // Pengecek jadwal: jalan tiap 5 detik, memicu sekali per hari per jadwal.
  useEffect(() => {
    const tick = setInterval(() => {
      const now = new Date()
      const hhmm = now.toTimeString().slice(0, 5)
      const date = now.toDateString()
      const jobs = [
        ...Object.entries(fixed).map(([id, s]) => ({
          key: `f${id}`, channel: Number(id), name: user.devices.find((d) => d.id === Number(id))?.nama, ...s,
        })),
        ...extra.map((s) => ({ key: `x${s.id}`, name: extraName(s.channel), ...s })),
      ]
      jobs.forEach((j) => {
        const k = `${j.key}-${date}`
        if (j.enabled && j.time === hhmm && !fired.current[k] && room.sendCmd(j.channel, j.action === 'ON')) {
          fired.current[k] = true
          room.log(`Jadwal memicu ${j.name}: ${j.action}`)
        }
      })
    }, 5000)
    return () => clearInterval(tick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixed, extra, room.sendCmd])

  return { fixed, extra, saveFixed, removeFixed, addExtra, updateExtra, removeExtra }
}

// Kartu jadwal: dipakai untuk Lampu 1, Lampu 2, dan perangkat tambahan.
function ScheduleCard({ device, value, onChange, onRemove }) {
  const s = { time: '18:00', action: 'ON', enabled: false, ...value }
  const set = (patch) => onChange(device.id, { ...s, ...patch })
  return (
    <div className="card form">
      <div className="name">{device.nama}</div>
      <div className="two">
        <div>
          <label htmlFor={`t${device.id}`}>Waktu</label>
          <input id={`t${device.id}`} type="time" value={s.time} onChange={(e) => set({ time: e.target.value })} />
        </div>
        <div>
          <label htmlFor={`a${device.id}`}>Aksi</label>
          <select id={`a${device.id}`} value={s.action} onChange={(e) => set({ action: e.target.value })}>
            <option value="ON">Nyalakan</option>
            <option value="OFF">Matikan</option>
          </select>
        </div>
      </div>
      <div className="row">
        <span>Aktifkan setiap hari</span>
        <Switch on={s.enabled} label={`Jadwal ${device.nama}`} onChange={(v) => set({ enabled: v })} />
      </div>
      <button className="btn small" type="button" onClick={() => onRemove(device.id)}>Hapus jadwal</button>
    </div>
  )
}

function Jadwal({ user, room }) {
  const { fixed, extra, saveFixed, removeFixed, addExtra, updateExtra, removeExtra } = useSchedules(user, room)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ channel: EXTRA_DEVICES[0].channel, time: '18:00', action: 'ON' })

  return (
    <>
      <div>
        <h1>Penjadwalan</h1>
        <div className="sub">Otomatis hemat tanpa perlu ingat</div>
      </div>

      {user.devices.map((d) => (
        <ScheduleCard key={d.id} device={d} value={fixed[d.id]} onChange={saveFixed} onRemove={removeFixed} />
      ))}

      {extra.map((s) => (
        <ScheduleCard
          key={s.id}
          device={{ id: s.id, nama: extraName(s.channel) }}
          value={s}
          onChange={updateExtra}
          onRemove={removeExtra}
        />
      ))}

      {open ? (
        <div className="card form">
          <div className="name">Tambah jadwal</div>
          <div>
            <label htmlFor="xd">Perangkat</label>
            <select id="xd" value={form.channel} onChange={(e) => setForm({ ...form, channel: Number(e.target.value) })}>
              {EXTRA_DEVICES.map((d) => (
                <option key={d.channel} value={d.channel}>{d.nama} (channel {d.channel})</option>
              ))}
            </select>
          </div>
          <div className="two">
            <div>
              <label htmlFor="xt">Waktu</label>
              <input id="xt" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
            </div>
            <div>
              <label htmlFor="xa">Aksi</label>
              <select id="xa" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })}>
                <option value="ON">Nyalakan</option>
                <option value="OFF">Matikan</option>
              </select>
            </div>
          </div>
          <div className="sub">Relay channel ini harus sudah ada di ESP32 agar perintahnya dijalankan.</div>
          <button className="btn" type="button" disabled={!form.time}
            onClick={() => { addExtra(form); setOpen(false) }}>Simpan jadwal</button>
          <button className="btn ghost" type="button" onClick={() => setOpen(false)}>Batal</button>
        </div>
      ) : (
        <button className="btn ghost" type="button" onClick={() => setOpen(true)}>Tambah jadwal</button>
      )}

      <div className="card note">
        <b>Halaman harus tetap terbuka</b>
        <div className="sub">Jadwal berjalan di browser. Agar tetap jalan saat aplikasi ditutup, pindahkan logika jadwal ke ESP32.</div>
      </div>
    </>
  )
}

/* ---------- Akun ---------- */
function Akun({ user, room, onLogout }) {
  const rows = [
    ['Nama penghuni', user.nama], ['Nomor kamar', `Kamar ${user.kamar} (lantai ${user.lantai})`],
    ['No. HP', user.hp], ['Mulai huni', user.mulaiHuni], ['Jatuh tempo sewa', user.jatuhTempo],
    ['Tarif listrik', `${rupiah(user.tarif)} / kWh`], ['Target bulanan', rupiah(user.targetBulanan)],
    ['Topik MQTT', user.simulate ? 'Simulasi (tanpa broker)' : user.mqttBase + '/…'],
  ]
  return (
    <>
      <h1>Akun</h1>
      <div className="card">
        {rows.map(([k, v]) => <div key={k} className="row item"><span className="sub">{k}</span><b className="right">{v}</b></div>)}
      </div>
      <div className="card">
        <b>Aktivitas koneksi</b>
        <pre className="log">{room.logs.join('\n') || 'Belum ada aktivitas.'}</pre>
      </div>
      <button className="btn ghost" type="button" onClick={onLogout}>Keluar</button>
    </>
  )
}

/* ---------- Shell ---------- */
function Dashboard({ user, onLogout }) {
  const [tab, setTab] = useState('beranda')
  const room = useRoom(user)
  const tabs = [['beranda', 'Beranda'], ['kontrol', 'Kontrol'], ['jadwal', 'Jadwal'], ['akun', 'Akun']]
  return (
    <>
      <main className="main">
        {tab === 'beranda' && <Beranda user={user} room={room} />}
        {tab === 'kontrol' && <Kontrol user={user} room={room} />}
        {tab === 'jadwal' && <Jadwal user={user} room={room} />}
        {tab === 'akun' && <Akun user={user} room={room} onLogout={onLogout} />}
      </main>
      <nav aria-label="Menu utama">
        {tabs.map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>
    </>
  )
}

export default function App() {
  const [username, setUsername] = useState(() => sessionStorage.getItem('kos_user'))
  const user = USERS.find((u) => u.username === username)
  const login = (name) => { sessionStorage.setItem('kos_user', name); setUsername(name) }
  const logout = () => { sessionStorage.removeItem('kos_user'); setUsername(null) }
  return (
    <div className="app">
      {user ? <Dashboard key={user.kamar} user={user} onLogout={logout} /> : <Login onLogin={login} />}
    </div>
  )
}
