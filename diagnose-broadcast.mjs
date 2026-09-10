import 'dotenv/config'
import pg from 'pg'
import jwt from 'jsonwebtoken'
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const result = await pool.query(`select u.username, count(c.id)::int accepted
  from users u left join conversations c on c.business_id=u.id and c.status='accepted'
  where u.account_kind='business' and u.deleted_at is null
  group by u.id,u.username order by accepted desc`)
console.log(JSON.stringify(result.rows))
const lists = await pool.query(
  `select u.username,count(l.id)::int lists from users u left join broadcast_lists l on l.business_id=u.id where u.account_kind='business' and u.deleted_at is null group by u.id,u.username`
)
console.log(JSON.stringify(lists.rows))
const pair = await pool.query(
  `select c.business_id,c.customer_id from conversations c where c.status='accepted' limit 1`
)
const selected = pair.rows[0]
if (selected) {
  const token = jwt.sign({}, process.env.JWT_SECRET, {
    subject: selected.business_id,
    issuer: process.env.JWT_ISSUER,
    expiresIn: '5m'
  })
  const response = await fetch('http://localhost:4000/api/broadcast-lists', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Diagnostic list', customer_ids: [selected.customer_id] })
  })
  const body = await response.json()
  console.log(JSON.stringify({ status: response.status, body }))
  if (response.ok)
    await fetch(`http://localhost:4000/api/broadcast-lists/${body.data.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    })
}
await pool.end()
