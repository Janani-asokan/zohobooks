// Puts the CorpusLite icon and version details into CorpusLite.exe (done in JavaScript, so no Wine is needed).
import fs from 'node:fs';
import * as ResEdit from 'resedit';
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
const exePath = new URL('../dist/win-unpacked/CorpusLite.exe', import.meta.url);
const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(exe);
const ico = ResEdit.Data.IconFile.from(fs.readFileSync(new URL('../build/icon.ico', import.meta.url)));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const id = groups.length ? groups[0].id : 1; const lang = groups.length ? groups[0].lang : 1033;
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, id, lang, ico.icons.map((i) => i.data));
const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
const [a, b, c] = pkg.version.split('.').map(Number);
vi.setFileVersion(a, b, c, 0, 1033); vi.setProductVersion(a, b, c, 0, 1033);
vi.setStringValues({ lang: 1033, codepage: 1200 }, {
  FileDescription: 'CorpusLite', ProductName: 'CorpusLite', CompanyName: 'Corpus360', LegalCopyright: 'Corpus360',
  InternalName: 'CorpusLite', OriginalFilename: 'CorpusLite.exe', FileVersion: pkg.version, ProductVersion: pkg.version,
});
vi.outputToResourceEntries(res.entries);
res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
console.log('CorpusLite.exe: icon and version', pkg.version);
