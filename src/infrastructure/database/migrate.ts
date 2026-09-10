import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { loadConfig } from '../../config.js'

const config = loadConfig()
const pool = new pg.Pool({ connectionString: config.DATABASE_URL })
await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
await pool.end()
console.log('NexusOS database schema is ready.')
