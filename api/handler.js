import { getDatabase, fail, id } from '../db.js'
import { changePassword, login, logout, userFor, verifyCurrent } from '../auth.js'
import { adjustStock, bulkInventory, removeProduct, removeUser, resetCompany, saveCompany, saveExpense, saveProduct, saveUser, scope, sell, snapshot } from '../operations.js'

function checkOrigin(request) {
  const origin = request.headers.origin
  const host = request.headers.host
  if (!origin || !host || ![`https://${host}`, ...(!process.env.VERCEL ? [`http://${host}`] : [])].includes(origin)) {
    fail(403, 'La solicitud debe venir de este sitio.')
  }
}

async function jsonBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) fail(415, 'Se espera una solicitud JSON.')
  if (Number(request.headers['content-length']) > 16_384) fail(413, 'La solicitud es demasiado grande.')
  let body = request.body
  if (body == null) {
    let data = ''
    for await (const chunk of request) {
      data += chunk
      if (Buffer.byteLength(data) > 16_384) fail(413, 'La solicitud es demasiado grande.')
    }
    body = data
  }
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    try { body = JSON.parse(body.toString() || '{}') } catch { fail(400, 'La solicitud JSON no es válida.') }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'La solicitud JSON no es válida.')
  return body
}

async function inPhase(phase, operation) {
  try {
    return await operation()
  } catch (error) {
    if (typeof error === 'object' && error && !error.phase) error.phase = phase
    throw error
  }
}

async function dispatch(request, response) {
  const url = new URL(request.url, 'http://localhost')
  const route = url.pathname === '/api/handler'
    ? String(request.query?.route || url.searchParams.get('route') || '')
    : url.pathname.replace(/^\/api\//, '')
  const action = `${request.method} ${route}`
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(request.method)) fail(405, 'Método no permitido.')
  const mutation = request.method !== 'GET'
  if (mutation) checkOrigin(request)
  const body = mutation ? await jsonBody(request) : {}
  const db = await inPhase('database.connect', getDatabase)
  if (action === 'POST login') return inPhase('login', () => login(db, request, response, body))
  if (action === 'POST logout') return inPhase('logout', () => logout(db, request, response))
  const user = await inPhase('session.user', () => userFor(db, request))
  if (action === 'GET session') return { user }
  if (action === 'POST password') return inPhase('password.change', () => changePassword(db, user, body))
  if (route === 'usuarios') {
    if (!user.is_superuser) fail(403, 'Se requiere acceso de superusuario.')
    if (action === 'POST usuarios') return saveUser(db, user, body)
    if (action === 'PATCH usuarios') return saveUser(db, user, body, id(body.id))
    if (action === 'DELETE usuarios') return removeUser(db, user, id(body.id))
  }
  const scoped = await inPhase('company.scope', () => scope(db, user, url.searchParams.get('empresa') || request.query?.empresa))
  if (action === 'GET datos') return inPhase('datos.snapshot', () => snapshot(db, user, scoped))
  if (!scoped.active) fail(403, 'No tienes una empresa asignada.')
  const company = scoped.active.id
  switch (action) {
    case 'POST ventas': return sell(db, company, body)
    case 'POST inventario': return saveProduct(db, company, body)
    case 'PATCH inventario': return saveProduct(db, company, body, id(body.id))
    case 'PATCH inventario-lote': return bulkInventory(db, company, body)
    case 'DELETE inventario': return removeProduct(db, company, id(body.id))
    case 'POST ajuste': return adjustStock(db, company, id(body.id), body)
    case 'POST gastos': return saveExpense(db, company, body)
    case 'PATCH empresa': return saveCompany(db, company, body)
    case 'POST reiniciar': return resetCompany(db, scoped.active, user, await verifyCurrent(db, user, body.current), body.confirmation)
    default: fail(404, 'Ruta no encontrada.')
  }
}

function safeErrorDetails(error) {
  const details = { name: typeof error?.name === 'string' ? error.name : 'Error' }
  // libSQL exposes stable error codes that are useful for diagnosis. Do not log
  // error.message or stack: either can contain request data or connection URLs.
  for (const [key, value] of [['code', error?.code], ['causeCode', error?.cause?.code]]) {
    if (typeof value === 'string' && /^[A-Z0-9_-]{1,80}$/i.test(value)) details[key] = value
  }
  if (typeof error?.phase === 'string' && /^[a-z.]{1,80}$/.test(error.phase)) details.phase = error.phase
  // The health check has a fixed query and contains no request values. Turso
  // reports the useful SQLite cause in its message, while SQLITE_UNKNOWN alone
  // is too broad to diagnose. Keep all other database messages out of logs.
  const message = typeof error?.message === 'string' ? error.message : ''
  if (error?.phase === 'database.healthcheck' && /^SQLite error:/i.test(message) && message.length <= 240) {
    details.databaseError = message
  }
  return details
}

export default async function handler(request, response) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  try {
    const data = await dispatch(request, response)
    response.statusCode = 200
    response.end(JSON.stringify(data))
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500
    if (status === 500) {
      const route = String(request.query?.route || new URL(request.url, 'http://localhost').pathname.replace(/^\/api\//, ''))
      console.error('Error de API', JSON.stringify({ route, method: request.method, ...safeErrorDetails(error) }))
    }
    response.statusCode = status
    response.end(JSON.stringify({ error: status === 500 ? 'No se pudo completar la operación.' : error.message }))
  }
}
