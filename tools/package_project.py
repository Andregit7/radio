"""Package readable source, static distributions and a separate private course pack."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED = {'.git', 'node_modules', 'starter-pack', 'releases', 'test-results', '__pycache__'}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    entries = []
    for source in sorted(ROOT.rglob('*')):
        relative = source.relative_to(ROOT)
        if source.is_symlink():
            raise ValueError(f'Symlinks are not packaged: {relative}')
        if not source.is_file() or any(part in EXCLUDED for part in relative.parts):
            continue
        if relative.parts[:2] == ('dist', 'packs') or relative.as_posix() == 'dist/starter.json':
            continue
        entries.append((source, 'radioeasy/' + relative.as_posix()))
    for name in ('study-site', 'studio-site'):
        base = ROOT / 'releases' / name
        manifest = json.loads((base / 'release.json').read_text(encoding='utf-8'))
        expected = {'release.json', *(item['path'] for item in manifest['files'])}
        actual = {p.relative_to(base).as_posix() for p in base.rglob('*') if p.is_file()}
        assert actual == expected, f'Unexpected or missing deployment files: {name}'
        for item in manifest['files']:
            assert hashlib.sha256((base / item['path']).read_bytes()).hexdigest() == item['sha256']
        for relative in sorted(expected):
            entries.append((base / relative, 'public-' + name + '/' + relative))
    course = ROOT / 'starter-pack' / 'radiografii-explicate.study.zip'
    if course.exists():
        entries.append((course, 'course-pack/' + course.name))
    report = []
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=False) as archive:
        for source, target in entries:
            content = source.read_bytes()
            archive.writestr(target, content)
            report.append({'path': target, 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
        archive.writestr('SOURCE-CHECKSUMS.json', json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
        archive.writestr('START-HERE.md', f'''# RadioEasy v{version}

Study: https://andregit7.github.io/radio/
Pack Studio: https://andregit7.github.io/radio/studio/
Cod sursă: https://github.com/Andregit7/radio

Codul și instrucțiunile sunt în `radioeasy/README.md`.

1. Pentru dezvoltare locală: deschide `radioeasy/start-study.cmd` pe Windows sau rulează `node tools/serve.mjs` din directorul `radioeasy`.
2. Study: http://127.0.0.1:4173/
3. Importă `course-pack/radiografii-explicate.study.zip` din Bibliotecă.
4. Pentru contribuții: `radioeasy/start-studio.cmd` sau `node tools/serve.mjs --studio`; apoi http://127.0.0.1:4174/.

`public-study-site/` și `public-studio-site/` sunt distribuții statice separate pentru găzduire HTTPS/GitHub Pages. Nu conțin materialele de curs.

Starea verificării nu este înghețată în acest fișier: rulează `npm test`, `npm run check` și `npm run verify` în `radioeasy/`, iar `verification-results.json` conține numerele curente. Metodele cu repere rămân dezactivate până când adnotările sunt verificate în Studio. Instalarea pe dispozitive, modul avion și performanța pe un telefon modest rămân de verificat. Vezi `radioeasy/docs/verification.md`.

Nu publica întregul ZIP privat ca repository public: conține separat pachetul de curs. Codul aplicației poate fi publicat independent.
''')
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        assert all(not name.startswith('/') and '..' not in Path(name).parts for name in archive.namelist())
    print(json.dumps({'output': str(output), 'bytes': output.stat().st_size, 'files': len(report) + 2, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}))

if __name__ == '__main__':
    main()
