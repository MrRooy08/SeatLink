import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const execute = promisify(execFile)

it('rejects a remote development seed target before opening a database connection', async () => {
  await expect(execute(process.execPath, ['scripts/seed-development.mjs'], {
    env: { ...process.env, SEATLINK_DEV_DATABASE_URL: 'postgresql://test:test@example.com:5432/test' },
  })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('literal loopback database address') })
})

it('previews the hosted menu target from the existing environment without connecting', async () => {
  const project = 'abcdefghijklmnopqrst'
  const result = await execute(process.execPath, [
    'scripts/seed-hosted-development.mjs', '--development-project', project, '--dry-run',
  ], { env: { ...process.env, SUPABASE_URL: `https://${project}.supabase.co` } })
  expect(result.stdout).toContain('Hosted development target: ' + project)
  expect(result.stdout).toContain('No database connection or changes were made.')
})

it('rejects a hosted seed when the declared project differs from the configured URL', async () => {
  await expect(execute(process.execPath, [
    'scripts/seed-hosted-development.mjs', '--development-project', 'different-project', '--dry-run',
  ], { env: { ...process.env, SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' } }))
    .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('intended demo/development target') })
})
