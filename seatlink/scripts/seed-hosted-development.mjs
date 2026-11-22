import { mkdtemp, readFile, unlink, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const args = process.argv.slice(2)
const confirmation = args.indexOf('--development-project')
const declaredProject = confirmation >= 0 ? args[confirmation + 1] : ''
const match = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(process.env.VITE_SUPABASE_URL?.trim() ?? '')
if (!match) throw new Error('Use the hosted Supabase Project URL in your existing .env.local.')
const projectRef = match[1]
if (declaredProject !== projectRef) {
  throw new Error('Pass --development-project followed by the project reference from .env.local to identify your intended demo/development target.')
}
const dryRun = args.includes('--dry-run')
const menu = await readFile(new URL('../supabase/dev/menu.sql', import.meta.url), 'utf8')
const statements = menu.replace(/^begin;\s*$/gmi, '').replace(/^commit;\s*$/gmi, '')
const sql = `begin;
set local seatlink.development_seed = 'on';
do $$
begin
  if not exists (select 1 from public.branches where id in (
    '9ab8e80c-7bf4-4cf0-a437-133318c32b01', '9ab8e80c-7bf4-4cf0-a437-133318c32b02'
  )) then raise exception 'The demo branches are missing. Apply the SeatLink setup first.'; end if;
end;
$$;
${statements}
select b.name, count(m.id) as sample_items
from public.branches b join public.menu_items m on m.branch_id = b.id
where m.is_demo group by b.id, b.name order by b.name;
commit;`
console.log('Hosted development target: ' + projectRef)
console.log('Seed inserts five labelled sample menu items per existing demo branch, preserving existing rows.')
if (dryRun) {
  console.log('Preview complete. No database connection or changes were made.')
} else {
  const npmCli = process.env.npm_execpath
  if (!npmCli) throw new Error('Run this command through npm run seed:hosted:dev.')
  const directory = await mkdtemp(join(tmpdir(), 'seatlink-hosted-menu-'))
  const sqlPath = join(directory, 'menu.sql')
  try {
    await writeFile(sqlPath, sql, 'utf8')
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        npmCli, 'exec', '--', 'supabase@3', 'db', 'query', '--remote=' + projectRef, '--file', sqlPath,
      ], { stdio: 'inherit', windowsHide: true })
      child.once('error', reject)
      child.once('exit', resolve)
    })
    if (code !== 0) process.exitCode = 1
  } finally {
    await unlink(sqlPath).catch(() => {})
    await rmdir(directory)
  }
}
