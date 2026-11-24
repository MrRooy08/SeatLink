import { mkdtemp, readFile, unlink, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const args=process.argv.slice(2)
const flag=name=>{const index=args.indexOf(name);return index<0?'':args[index+1]??''}
const project=/^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(process.env.VITE_SUPABASE_URL?.trim()??'')?.[1]
if(!project||flag('--development-project')!==project) throw Error('Explicit --development-project must match your existing .env.local project URL.')
const branch=flag('--branch'), owner=flag('--owner')
if(!/^[a-f0-9-]{36}$/i.test(branch)||!owner.includes('@')) throw Error('Supply --branch UUID and --owner email for the development/test owner.')
const quote=value=>"'"+value.replaceAll("'","''")+"'"
const sql=`begin;
select set_config('seatlink.fixture_branch',${quote(branch)},true);
select set_config('seatlink.fixture_owner',${quote(owner)},true);
select set_config('seatlink.fixture_cleanup',${quote(args.includes('--cleanup')?'on':'off')},true);
${await readFile(new URL('../supabase/dev/seat-scenarios.sql',import.meta.url),'utf8')}
commit;`
console.log(`Development fixture target: ${project}, branch ${branch}. ${args.includes('--cleanup')?'End only recorded fixtures; preserve history.':'Reuse A/B/C tables and stable seat IDs; refuse occupied tables or unrelated checkout.'}`)
if(args.includes('--dry-run')) console.log('Preview only. No connection or database changes.')
else {
 const npm=process.env.npm_execpath
 if(!npm) throw Error('Run through npm run seed:seats:dev.')
 const directory=await mkdtemp(join(tmpdir(),'seatlink-seat-fixtures-')), path=join(directory,'fixtures.sql')
 try {
  await writeFile(path,sql)
  const code=await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,[npm,'exec','--','supabase@3','db','query',`--remote=${project}`,'--file',path],{stdio:'inherit',windowsHide:true})
   child.once('error',reject);child.once('exit',resolve)
  })
  if(code!==0)process.exitCode=1
 }finally{await unlink(path).catch(()=>{});await rmdir(directory)}
}
