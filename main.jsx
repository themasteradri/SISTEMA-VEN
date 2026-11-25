import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity, ArrowDownUp, BarChart3, Building2, ChevronDown, CircleDollarSign,
  ClipboardList, Database, LayoutDashboard, Package, Search, ShoppingBag,
  TrendingUp, Upload, X,
} from 'lucide-react'
import { dateLabel, forecast, importSQLite, money, sevenDays, sum } from './data'
import './styles.css'

const navigation = [
  ['resumen', 'Resumen', LayoutDashboard, 'Indicadores de ventas e inventario.'],
  ['ventas', 'Ventas', ShoppingBag, 'Consulta el historial y el detalle de cada venta.'],
  ['inventario', 'Inventario', Package, 'Consulta el catálogo, los precios y las existencias.'],
  ['operaciones', 'Operaciones', ArrowDownUp, 'Consulta las entradas y salidas registradas en el Kardex.'],
  ['finanzas', 'Finanzas', CircleDollarSign, 'Revisa los ingresos, los gastos y el valor del inventario.'],
  ['pronostico', 'Pronóstico', TrendingUp, 'Estima la demanda y las unidades que conviene reponer.'],
]
const empty = { companies: [], products: [], sales: [], lines: [], movements: [], expenses: [] }
const labels = { EFECTIVO: 'Efectivo', TARJETA: 'Tarjeta', TRANSFERENCIA: 'Transferencia', ENTRADA_COMPRA: 'Entrada por compra', SALIDA_VENTA: 'Salida por venta', AJUSTE: 'Ajuste' }
const label = value => labels[value] || String(value || '—').toLowerCase().replaceAll('_', ' ')
const stockState = product => product.stock_actual <= 0 ? 'Agotado' : product.stock_actual <= product.stock_minimo ? 'Stock bajo' : 'Disponible'
const tableColumns = {
  ventas: [['Ticket', sale => sale.numero_ticket || `#${sale.id}`], ['Fecha', sale => dateLabel(sale.fecha)], ['Pago', sale => label(sale.metodo_pago)], ['Importe', sale => money(sale.total)]],
  inventario: [['Producto', row => row.nombre], ['Categoría', row => row.categoria || '—'], ['Stock', row => row.stock_actual], ['Precio', row => money(row.precio_venta)], ['Estado', row => <span className={`badge ${stockState(row) === 'Disponible' ? 'good' : 'warn'}`}>{stockState(row)}</span>]],
  operaciones: [['Producto', row => row.producto || '—'], ['Movimiento', row => label(row.tipo_movimiento)], ['Fecha', row => dateLabel(row.fecha)], ['Unidades', row => row.cantidad], ['Stock final', row => row.stock_resultante]],
  finanzas: [['Concepto', row => row.descripcion], ['Categoría', row => row.categoria], ['Fecha', row => dateLabel(row.fecha)], ['Importe', row => money(row.monto)]],
  pronostico: [['Producto', row => row.nombre], ['Stock', row => row.stock_actual], ['Demanda al día', row => row.daily.toFixed(2)], ['Plazo (días)', row => row.lead], ['Reposición', row => row.order]],
}

function Metrics({ cards }) {
  return <div className="metrics">{cards.map(([title, value, Icon, tone, note]) =>
    <article className="metric" key={title}>
      <span className={`metric-icon ${tone}`}><Icon size={19} /></span>
      <span className="metric-label">{title}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>,
  )}</div>
}

function Table({ rows, columns, onDetail, emptyText }) {
  return rows.length ? <div className="table-scroll"><table>
    <thead><tr>{columns.map(([name]) => <th scope="col" key={name}>{name}</th>)}{onDetail && <th scope="col">Acción</th>}</tr></thead>
    <tbody>{rows.map(row => <tr key={row.id}>
      {columns.map(([name, render]) => <td key={name}>{render(row)}</td>)}
      {onDetail && <td><button className="text-button" aria-label={`Ver detalle de ${row.nombre || row.producto || row.numero_ticket || row.descripcion || row.id}`} onClick={() => onDetail(row)}>Ver detalle</button></td>}
    </tr>)}</tbody>
  </table></div> : <div className="empty-table">{emptyText}</div>
}

function Records({ rows, section, title, onDetail, imported }) {
  const [query, setQuery] = useState('')
  const [pageSize, setPageSize] = useState(10)
  const [page, setPage] = useState(1)
  const filtered = rows.filter(row => [row.nombre, row.producto, row.categoria, row.numero_ticket, row.codigo_barras, row.descripcion, label(row.metodo_pago), label(row.tipo_movimiento)].some(value =>
    value != null && String(value).toLocaleLowerCase('es-PE').includes(query.trim().toLocaleLowerCase('es-PE')),
  ))
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const start = (currentPage - 1) * pageSize
  return <section className="panel">
    <div className="panel-header table-header">
      <div><h2>{title}</h2><p>{rows.length} registros</p></div>
      <label className="search"><Search size={17} /><input aria-label="Buscar registros" value={query} placeholder="Buscar registros" onChange={event => { setQuery(event.target.value); setPage(1) }} /></label>
    </div>
    <Table rows={filtered.slice(start, start + pageSize)} columns={tableColumns[section]} onDetail={onDetail}
      emptyText={imported ? 'No se encontraron registros.' : 'Importa tu archivo SQLite para ver los registros.'} />
    <div className="table-footer">
      <span aria-live="polite">{filtered.length ? `${start + 1}–${Math.min(start + pageSize, filtered.length)} de ${filtered.length}` : '0 registros'}</span>
      <div className="pagination">
        <label>Por página <select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1) }}><option>10</option><option>20</option><option>50</option></select></label>
        <button onClick={() => setPage(currentPage - 1)} disabled={currentPage === 1}>Anterior</button>
        <button onClick={() => setPage(currentPage + 1)} disabled={currentPage === totalPages}>Siguiente</button>
      </div>
    </div>
  </section>
}

function Dashboard({ sales, products, movements, imported, onSection, onDetail }) {
  const chart = sevenDays(sales)
  const max = Math.max(1, ...chart.map(point => point.value))
  const active = products.filter(product => product.activo)
  const low = active.filter(product => stockState(product) !== 'Disponible')
  return <>
    <Metrics cards={[
      ['Ingresos registrados', imported ? money(sum(sales, 'total')) : '—', CircleDollarSign, 'blue', 'Total del historial'],
      ['Ventas', imported ? sales.length : '—', ShoppingBag, 'violet', 'Transacciones registradas'],
      ['Productos activos', imported ? active.length : '—', Package, 'teal', `${low.length} requieren revisión`],
      ['Movimientos', imported ? movements.length : '—', Activity, 'amber', 'Entradas y salidas del Kardex'],
    ]} />
    <div className="dashboard-grid">
      <section className="panel">
        <div className="panel-header"><div><h2>Ingresos por día</h2><p>7 días hasta la última venta registrada</p></div><span className="legend">Ingresos</span></div>
        {sales.length ? <div className="chart" aria-label="Ingresos diarios">{chart.map(point => <div className="bar-group" key={point.key}>
          <div className="bar-track"><div className="bar" style={{ height: point.value ? `${Math.max(3, point.value / max * 100)}%` : '2px' }} title={money(point.value)} /></div>
          <div className="bar-label">{point.label}<span className="sr-only"> {money(point.value)}</span></div>
        </div>)}</div> : <div className="empty-chart"><BarChart3 size={31} /> Aún no hay ventas en esta vista.</div>}
      </section>
      <section className="panel">
        <div className="panel-header"><div><h2>Estado del inventario</h2><p>Productos activos por nivel de stock</p></div></div>
        <div className="stock-list">{['Disponible', 'Stock bajo', 'Agotado'].map((state, index) => {
          const count = active.filter(product => stockState(product) === state).length
          return <div key={state}><div className="stock-label"><span><i className={`stock-dot tone-${index}`} />{state}</span><strong>{count}</strong></div>
            <div className="progress"><div className={`tone-${index}`} style={{ width: `${active.length ? count / active.length * 100 : 0}%` }} /></div>
          </div>
        })}</div>
      </section>
    </div>
    <section className="panel"><div className="panel-header"><div><h2>Ventas recientes</h2><p>Últimas operaciones registradas</p></div>
      <button className="text-button" onClick={() => onSection('ventas')}>Ver todas las ventas</button></div>
      <Table rows={sales.slice(0, 5)} columns={tableColumns.ventas} onDetail={row => onDetail('ventas', row)} emptyText="No hay ventas para mostrar." />
    </section>
  </>
}

function Details({ detail, lines, onClose }) {
  const dialog = useRef(null)
  useEffect(() => { dialog.current.showModal() }, [])
  const { section, row } = detail
  const saleLines = section === 'ventas' ? lines.filter(line => line.venta_id === row.id) : []
  const facts = {
    ventas: [['Fecha', dateLabel(row.fecha)], ['Método de pago', label(row.metodo_pago)], ['Total', money(row.total)]],
    inventario: [['Código de barras', row.codigo_barras || '—'], ['Categoría', row.categoria || '—'], ['Stock disponible', row.stock_actual], ['Stock mínimo', row.stock_minimo], ['Precio de venta', money(row.precio_venta)], ['Costo promedio', money(row.costo_promedio)], ['Catálogo', row.activo ? 'Activo' : 'Inactivo']],
    operaciones: [['Fecha', dateLabel(row.fecha)], ['Movimiento', label(row.tipo_movimiento)], ['Cantidad', row.cantidad], ['Stock resultante', row.stock_resultante], ['Costo unitario', money(row.costo_unitario)], ['Ticket', row.numero_ticket || '—']],
    finanzas: [['Fecha', dateLabel(row.fecha)], ['Categoría', row.categoria], ['Importe', money(row.monto)]],
    pronostico: [['Stock actual', row.stock_actual], ['Demanda diaria', row.daily?.toFixed(2)], ['Plazo de entrega', `${row.lead} días`], ['Reposición sugerida', `${row.order} unidades`], ['Costo estimado', money(row.order * row.costo_promedio)]],
  }
  return <dialog ref={dialog} className="dialog" aria-labelledby="detail-title" onClose={onClose}>
    <div className="dialog-body">
      <div className="dialog-header"><div><p>Detalle del registro</p><h2 id="detail-title">{row.nombre || row.producto || row.numero_ticket || row.descripcion || `Registro #${row.id}`}</h2></div>
        <button className="icon-button" aria-label="Cerrar detalle" onClick={() => dialog.current.close()}><X size={22} /></button></div>
      <dl>{facts[section].map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
      {Boolean(row.es_simulado) && <span className="badge violet">Dato simulado</span>}
      {section === 'ventas' && <><h3>Productos vendidos</h3><Table rows={saleLines}
        columns={[[ 'Producto', line => line.producto || '—'], ['Cantidad', line => line.cantidad], ['Importe', line => money(line.precio_unitario * line.cantidad)]]} emptyText="Esta venta no tiene líneas registradas." /></>}
    </div>
  </dialog>
}

function readSection() {
  const section = window.location.hash.slice(1)
  return navigation.some(([key]) => key === section) ? section : 'resumen'
}

function App() {
  const [section, setSection] = useState(readSection)
  const [data, setData] = useState(empty)
  const [fileName, setFileName] = useState('')
  const [company, setCompany] = useState('')
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef(null)
  useEffect(() => {
    function syncSection() { setSection(readSection()); setDetail(null) }
    window.addEventListener('hashchange', syncSection)
    return () => window.removeEventListener('hashchange', syncSection)
  }, [])
  const filtered = useMemo(() => {
    if (!company) return data
    const scoped = rows => rows.filter(row => String(row.empresa_id) === company)
    const sales = scoped(data.sales)
    const saleIds = new Set(sales.map(sale => sale.id))
    return { ...data, sales, products: scoped(data.products), movements: scoped(data.movements), expenses: scoped(data.expenses), lines: data.lines.filter(line => saleIds.has(line.venta_id)) }
  }, [data, company])
  const forecasts = useMemo(() => forecast(filtered.products, filtered.sales, filtered.lines, filtered.movements), [filtered])
  const { sales, products, movements, expenses } = filtered
  const [, title, , description] = navigation.find(([key]) => key === section)
  const imported = Boolean(fileName)
  const pickFile = () => fileInput.current.click()
  const openDetail = (tab, row) => setDetail({ section: tab, row })
  const rows = { ventas: sales, inventario: products, operaciones: movements, finanzas: expenses, pronostico: forecasts }
  const tableTitles = { ventas: 'Historial de ventas', inventario: 'Catálogo de productos', operaciones: 'Movimientos de Kardex', finanzas: 'Gastos operativos', pronostico: 'Reposición por producto' }
  async function loadFile(event) {
    const file = event.currentTarget.files[0]
    event.currentTarget.value = ''
    if (!file) return
    setLoading(true)
    setError('')
    try {
      setData(await importSQLite(file))
      setFileName(file.name)
      setCompany('')
      setDetail(null)
    } catch {
      setError('No se pudo leer el archivo. Selecciona el db.sqlite3 de la versión actual del sistema Django.')
    } finally {
      setLoading(false)
    }
  }
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#resumen"><span className="brand-mark"><ClipboardList size={23} /></span><span><strong>Control</strong><small>Sistema de ventas</small></span></a>
      <nav aria-label="Módulos">{navigation.map(([key, name, Icon]) =>
        <a key={key} href={`#${key}`} aria-current={key === section ? 'page' : undefined}><Icon size={19} />{name}</a>,
      )}</nav>
      <div className="sidebar-status"><Database size={17} /><div><strong>Datos locales</strong><small>{imported ? fileName : 'Sin archivo importado'}</small></div></div>
    </aside>
    <main>
      <header className="topbar">
        <label className="company"><Building2 size={18} /><span className="sr-only">Empresa</span><select value={company} onChange={event => setCompany(event.target.value)}><option value="">Todas las empresas</option>{data.companies.map(row => <option value={row.id} key={row.id}>{row.nombre}</option>)}</select><ChevronDown size={15} /></label>
        <input type="file" accept=".sqlite,.sqlite3,.db" onChange={loadFile} hidden ref={fileInput} />
        <button className="primary" onClick={pickFile} disabled={loading}><Upload size={17} />{loading ? 'Importando…' : 'Importar SQLite'}</button>
      </header>
      <div className="content">
        <header className="page-header"><h1>{title}</h1><p>{description}</p></header>
        {error && <p role="alert" className="error">{error}</p>}
        {!imported && <div className="import-note"><span className="metric-icon blue"><Database size={19} /></span><div><strong>Consulta tu base de datos</strong><p>Selecciona el archivo db.sqlite3 de tu proyecto Django. Los datos se leen en este navegador.</p></div></div>}
        {section === 'resumen' ? <Dashboard {...{ sales, products, movements, imported }} onSection={key => { window.location.hash = key }} onDetail={openDetail} /> :
          <>
            {section === 'finanzas' && <Metrics cards={[
              ['Ingresos', money(sum(sales, 'total')), CircleDollarSign, 'blue', 'Total de ventas registradas'],
              ['Gastos operativos', money(sum(expenses, 'monto')), Activity, 'violet', 'Total de gastos registrados'],
              ['Valor de inventario', money(products.reduce((total, p) => total + p.stock_actual * p.costo_promedio, 0)), Package, 'teal', 'Existencias a costo promedio'],
            ]} />}
            <Records key={`${section}:${company}:${fileName}`} rows={rows[section]} section={section} title={tableTitles[section]} imported={imported} onDetail={row => openDetail(section, row)} />
          </>}
      </div>
    </main>
    {detail && <Details detail={detail} lines={filtered.lines} onClose={() => setDetail(null)} />}
  </div>
}

createRoot(document.getElementById('root')).render(<App />)
