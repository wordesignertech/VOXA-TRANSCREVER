// Gera dist/Voxa Transcrever (pasta pronta para Windows x64) e o ZIP de release.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ResEdit = require('resedit');
const asar = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const version = require(path.join(root, 'app', 'package.json')).version;
const name = 'Voxa Transcrever';
const out = path.join(root, 'dist', name);
const need = (p) => { if (!fs.existsSync(path.join(root, p))) { console.error(`Falta ${p}. Rode antes: npm run deps`); process.exit(1); } };

(async () => {
  ['cache/electron-win.zip', 'vendor/motor-cpu/whisper-cli.exe', 'vendor/bin/ffmpeg.exe', 'app/node_modules/docx'].forEach(need);
  fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  console.log('Electron…');
  execSync(`unzip -q "${path.join(root, 'cache/electron-win.zip')}" -d "${out}"`);
  fs.renameSync(path.join(out, 'electron.exe'), path.join(out, `${name}.exe`));
  fs.rmSync(path.join(out, 'resources', 'default_app.asar'), { force: true });
  for (const f of fs.readdirSync(path.join(out, 'locales'))) if (!['pt-BR.pak', 'en-US.pak'].includes(f)) fs.rmSync(path.join(out, 'locales', f));

  console.log('App…');
  await asar.createPackage(path.join(root, 'app'), path.join(out, 'resources', 'app.asar'));

  console.log('Motor e FFmpeg…');
  fs.cpSync(path.join(root, 'vendor/motor-cpu'), path.join(out, 'resources/motor-cpu'), { recursive: true });
  fs.cpSync(path.join(root, 'vendor/bin'), path.join(out, 'resources/bin'), { recursive: true });

  console.log('Ícone e metadados…');
  const exePath = path.join(out, `${name}.exe`);
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(root, 'app/assets/icon.ico')));
  const g = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)[0];
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang, ico.icons.map((i) => i.data));
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
  const [a, b, c] = version.split('.').map(Number);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, { FileDescription: name, ProductName: name, CompanyName: 'Wordesigner', InternalName: name, OriginalFilename: `${name}.exe`, LegalCopyright: '© 2026 Wordesigner' });
  vi.setFileVersion(a, b, c, 0, 1033); vi.setProductVersion(a, b, c, 0, 1033);
  vi.outputToResourceEntries(res.entries); res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));

  for (const f of ['LICENSE', 'THIRD-PARTY-NOTICES.md']) fs.copyFileSync(path.join(root, f), path.join(out, f));
  if (fs.existsSync(path.join(root, 'docs/LEIA-ME.txt'))) fs.copyFileSync(path.join(root, 'docs/LEIA-ME.txt'), path.join(out, 'LEIA-ME.txt'));

  const zip = path.join(root, 'dist', `Voxa-Transcrever-${version}-win-x64.zip`);
  console.log('ZIP…');
  execSync(`cd "${path.join(root, 'dist')}" && zip -qr -9 "${zip}" "${name}"`);
  console.log('Pronto:', zip);
})().catch((e) => { console.error(e); process.exit(1); });
