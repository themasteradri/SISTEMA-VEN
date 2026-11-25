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
  const db = await getDatabase()
  if (action === 'POST login') return login(db, request, response, body)
  if (action === 'POST logout') return logout(db, request, response)
  const user = await userFor(db, request)
  if (action === 'GET session') return { user }
  if (action === 'POST password') return changePassword(db, user, body)
  if (route === 'usuarios') {
    if (!user.is_superuser) fail(403, 'Se requiere acceso de superusuario.')
    if (action === 'POST usuarios') return saveUser(db, user, body)
    if (action === 'PATCH usuarios') return saveUser(db, user, body, id(body.id))
    if (action === 'DELETE usuarios') return removeUser(db, user, id(body.id))
  }
  const scoped = await scope(db, user, url.searchParams.get('empresa') || request.query?.empresa)
  if (action === 'GET datos') return snapshot(db, user, scoped)
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
    if (status === 500) console.error('Error de API', error.code || error.name)
    response.statusCode = status
    response.end(JSON.stringify({ error: status === 500 ? 'No se pudo completar la operación.' : error.message }))
  }
}
