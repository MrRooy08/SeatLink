import { readFile } from 'node:fs/promises'
import { Client } from 'pg'

const target = new URL(process.env.SEATLINK_DEV_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres')
if (!['127.0.0.1', '[::1]', '::1'].includes(target.hostname)) {
  throw new Error('Development seeding requires a literal loopback database address.')
}
const branchId = process.env.SEATLINK_DEMO_BRANCH_ID ?? ''
const demoOwner = process.env.SEATLINK_DEMO_OWNER_UID ?? ''
if (branchId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(branchId)) {
  throw new Error('SEATLINK_DEMO_BRANCH_ID must be a branch UUID.')
}
const client = new Client({ connectionString: target.toString(), connectionTimeoutMillis: 5000 })
try {
  await client.connect()
  await client.query('begin')
  await client.query("select set_config('seatlink.development_seed', 'on', true)")
  await client.query("select set_config('seatlink.demo_branch_id', $1, true)", [branchId])
  // Seed files contain their own BEGIN/COMMIT for manual use. Strip only the
  // outer markers so this command applies the local fixtures as one transaction.
  for (const file of ['seed.sql', 'menu.sql']) {
    const sql = await readFile(new URL('../supabase/dev/' + file, import.meta.url), 'utf8')
    await client.query(sql.replace(/^begin;\s*$/gmi, '').replace(/^commit;\s*$/gmi, ''))
  }
  if (demoOwner) {
    const { rowCount } = await client.query('select id from auth.users where id = $1::uuid', [demoOwner])
    if (rowCount !== 1) throw new Error('Create the local test owner before enabling simulators.')
    await client.query('update public.development_settings set enabled = true where singleton')
    await client.query('insert into public.development_operators (user_id) values ($1) on conflict do nothing', [demoOwner])
  }
  await client.query('commit')
  console.log('Local demo menu and seats seeded. Existing rows were preserved.')
  console.log(demoOwner ? 'Local development simulators enabled for the selected test owner.' :
    'Mock payments remain disabled until an administrator enables development access and allowlists a test owner.')
} catch (error) {
  await client.query('rollback').catch(() => {})
  console.error(error instanceof Error && error.message.includes('connect') ?
    'Local database unavailable. Start local Supabase and apply migrations first.' :
    'Development seed failed. Verify the local database connection and applied migrations.')
  process.exitCode = 1
} finally {
  await client.end()
}
