import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

const queries = {
  companies: 'SELECT id, nombre FROM empresas_empresa ORDER BY nombre',
  products: `SELECT p.id, p.nombre, p.codigo_barras, p.stock_actual, p.stock_minimo,
    p.precio_venta, p.costo_promedio, p.lead_time_dias, p.empresa_id, p.es_simulado,
    p.activo, c.nombre AS categoria FROM inventario_producto p
    LEFT JOIN inventario_categoria c ON c.id = p.categoria_id ORDER BY p.nombre`,
  sales: `SELECT id, numero_ticket, fecha, total, metodo_pago, empresa_id, es_simulado
    FROM operaciones_venta ORDER BY fecha DESC, id DESC`,
  lines: `SELECT d.id, d.venta_id, d.producto_id, d.cantidad, d.precio_unitario,
    p.nombre AS producto FROM operaciones_detalleventa d
    LEFT JOIN inventario_producto p ON p.id = d.producto_id ORDER BY d.id`,
  movements: `SELECT k.id, k.producto_id, k.venta_id, k.fecha, k.tipo_movimiento, k.cantidad,
    k.costo_unitario, k.stock_resultante, k.empresa_id, k.es_simulado,
    p.nombre AS producto, v.numero_ticket FROM operaciones_kardex k
    LEFT JOIN inventario_producto p ON p.id = k.producto_id
    LEFT JOIN operaciones_venta v ON v.id = k.venta_id ORDER BY k.fecha DESC, k.id DESC`,
  expenses: 'SELECT id, descripcion, categoria, monto, fecha, empresa_id FROM finanzas_gastooperativo ORDER BY fecha DESC',
}

export async function importSQLite(file) {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl })
  const db = new SQL.Database(new Uint8Array(await file.arrayBuffer()))
  try {
    return Object.fromEntries(Object.entries(queries).map(([key, query]) => {
      const result = db.exec(query)[0]
      return [key, result?.values.map(values =>
        Object.fromEntries(result.columns.map((column, index) => [column, values[index]]))) ?? []]
    }))
  } finally {
    db.close()
  }
}

const currency = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' })
const reportingDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Lima' })
const displayDate = new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeZone: 'America/Lima' })
const chartDate = new Intl.DateTimeFormat('es-PE', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
const dayMs = 86_400_000

function fromSQLite(value) {
  return new Date(value.length === 10 ? value + 'T12:00:00Z' : value.replace(' ', 'T') + 'Z')
}

export const money = value => currency.format(Number(value || 0))
export const dayKey = value => value ? reportingDate.format(fromSQLite(value)) : ''
export const dateLabel = value => value ? displayDate.format(fromSQLite(value)) : '—'
export const sum = (rows, field) => rows.reduce((total, row) => total + Number(row[field] || 0), 0)

export function sevenDays(sales) {
  const end = dayKey(sales[0]?.fecha) || reportingDate.format()
  const lastDate = new Date(end + 'T00:00:00Z')
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(lastDate.getTime() - (6 - index) * dayMs)
    const key = date.toISOString().slice(0, 10)
    return { key, label: chartDate.format(date), value: sum(sales.filter(sale => dayKey(sale.fecha) === key), 'total') }
  })
}

export function forecast(products, sales, lines, movements) {
  const datesBySale = new Map(sales.map(sale => [sale.id, dayKey(sale.fecha)]))
  const end = Date.parse(dayKey(sales[0]?.fecha || movements[0]?.fecha) || reportingDate.format())
  const totalsByProduct = new Map()
  const recordedSales = new Set()
  function add(productId, date, quantity) {
    const daysAgo = (end - Date.parse(date)) / dayMs
    if (!Number.isFinite(daysAgo) || daysAgo < 0 || daysAgo >= 78) return
    const totals = totalsByProduct.get(productId) || { long: 0, recent: 0 }
    totals.long += quantity
    if (daysAgo < 14) totals.recent += quantity
    totalsByProduct.set(productId, totals)
  }
  for (const line of lines) {
    recordedSales.add(`${line.venta_id}:${line.producto_id}`)
    add(line.producto_id, datesBySale.get(line.venta_id), Number(line.cantidad))
  }
  for (const movement of movements) {
    if (movement.tipo_movimiento === 'SALIDA_VENTA' && !recordedSales.has(`${movement.venta_id}:${movement.producto_id}`)) {
      add(movement.producto_id, dayKey(movement.fecha), Math.abs(Number(movement.cantidad)))
    }
  }
  return products.filter(product => product.activo).map(product => {
    const { long = 0, recent = 0 } = totalsByProduct.get(product.id) || {}
    const daily = long / 78 * 0.4 + recent / 14 * 0.6
    const lead = Math.max(1, Number(product.lead_time_dias || 0))
    const target = Math.max(1, Number(product.stock_minimo)) + Math.ceil(daily * lead)
    return { ...product, daily, lead, order: Math.max(0, target - product.stock_actual) }
  }).sort((first, second) => second.order - first.order || second.daily - first.daily)
}
