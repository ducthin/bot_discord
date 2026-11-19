"""Cache genuine seed reference renders from pattern.wiki without recoloring them.

Requires Pillow. Run: python scripts/generateCs2BlueGemArt.py
Existing source and PNG hashes are verified and reused, so repeat runs work offline.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import Request, urlopen
import hashlib
import io
import json
import re

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'assets' / 'cs2-blue-gems'
FAMILIES = {
    'skin-5fd3ee42a6c4': ('AK-47', 'weapon_ak47'),
    'skin-133e4c36778f': ('Five-SeveN', 'weapon_fiveseven'),
    'skin-c187005d5542': ('Karambit', 'weapon_knife_karambit'),
    'skin-d335b89fc7a5': ('M9 Bayonet', 'weapon_knife_m9_bayonet'),
    'skin-688d607e4dec': ('Butterfly Knife', 'weapon_knife_butterfly'),
}


def download(url):
    with urlopen(Request(url, headers={'User-Agent': 'CS2-pattern-reference-cache/1.0'}), timeout=20) as response:
        raw = response.read(4 * 1024 * 1024 + 1)
    if not raw or len(raw) > 4 * 1024 * 1024:
        raise ValueError('Pattern source exceeds the image limit')
    return raw


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    ART.mkdir(parents=True, exist_ok=True)
    (ART / 'sources').mkdir(exist_ok=True)
    previous = ART / 'manifest.json'
    cached = json.loads(previous.read_text(encoding='utf8'))['items'] if previous.exists() else []
    saved = {(item['skinId'], item['paintSeed']): item for item in cached}
    blue = json.loads((ROOT / 'assets' / 'cs2-patterns.json').read_text(encoding='utf8'))['blue']
    work = []
    for skin_id, (name, weapon) in FAMILIES.items():
        seeds = blue[skin_id]['gems']
        missing = any((skin_id, seed) not in saved for seed in seeds)
        data = None
        if missing:
            html = download(f'https://pattern.wiki/skin/aq_oiled/{weapon}/{seeds[0]}').decode('utf8')
            match = re.search(r'<script id="all-seeds-data" type="application/json">(.*?)</script>', html, re.S)
            if not match:
                raise ValueError(f'Missing seed image mapping for {name}')
            data = {int(item['s']): item for item in json.loads(match.group(1))}
        for seed in seeds:
            item = saved.get((skin_id, seed))
            if item is None:
                image_hash = data[seed]['url']
                if not re.fullmatch('[a-f0-9]{40}', image_hash):
                    raise ValueError('Unexpected pattern image identifier')
                item = {'skinId': skin_id, 'paintSeed': seed, 'name': name,
                        'filename': f'{skin_id}-seed-{seed}.png',
                        'sourceFile': f'sources/{skin_id}-seed-{seed}.webp',
                        'sourceUrl': f'https://static.pattern.wiki/img/{image_hash}',
                        'patternUrl': f'https://pattern.wiki/skin/aq_oiled/{weapon}/{seed}'}
            work.append(item)

    def prepare(item):
        item = dict(item)
        source = ART / item['sourceFile']
        png = ART / item['filename']
        if source.exists():
            raw = source.read_bytes()
            if item.get('sourceSha256') and sha(raw) != item['sourceSha256']:
                raise ValueError(f'Source checksum mismatch: {source.name}')
        else:
            raw = download(item['sourceUrl'])
            source.write_bytes(raw)
        with Image.open(io.BytesIO(raw)) as image:
            if image.format != 'WEBP' or image.width > 2048 or image.height > 2048:
                raise ValueError('Unexpected pattern reference image')
            item.update(width=image.width, height=image.height, sourceSha256=sha(raw))
            if not png.exists():
                image.convert('RGB').save(png, optimize=True)
        png_hash = sha(png.read_bytes())
        if item.get('pngSha256') and item['pngSha256'] != png_hash:
            raise ValueError(f'PNG checksum mismatch: {png.name}')
        item['pngSha256'] = png_hash
        return item

    with ThreadPoolExecutor(max_workers=4) as pool:
        items = list(pool.map(prepare, work))
    manifest = {'version': 1, 'provider': 'pattern.wiki', 'renderType': 'pattern-reference',
                'aboutUrl': 'https://pattern.wiki/wiki/faq/', 'items': items}
    previous.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    sheet = Image.new('RGB', (1200, 180 * ((len(items) + 5) // 6)), '#171b22')
    draw = ImageDraw.Draw(sheet)
    try:
        face = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 13)
    except OSError:
        face = ImageFont.load_default()
    for i, item in enumerate(items):
        with Image.open(ART / item['filename']) as image:
            image.thumbnail((196, 147))
            sheet.paste(image, (i % 6 * 200 + (200 - image.width) // 2, i // 6 * 180 + 22))
        draw.text((i % 6 * 200 + 5, i // 6 * 180 + 4), f"{item['name']} / {item['paintSeed']}", fill='white', font=face)
    sheet.save(ART / 'contact-sheet.jpg', quality=92)
    print(f'Cached {len(items)} exact seed reference images in {ART}')


if __name__ == '__main__':
    main()
