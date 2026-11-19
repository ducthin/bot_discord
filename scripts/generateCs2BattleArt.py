"""Native raster covers for the bot's Battle cases; no image generation service is used."""
from pathlib import Path
import argparse
import hashlib
import json
import math
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('root', type=Path)
parser.add_argument('--only-missing', action='store_true')
parser.add_argument('--ids', help='Comma-separated Battle case IDs to render')
parser.add_argument('--selected-sheet', default='contact-sheet-selected.jpg', help='JPEG filename for the newly rendered covers')
args = parser.parse_args()
if Path(args.selected_sheet).name != args.selected_sheet or not args.selected_sheet.endswith('.jpg'):
    parser.error('--selected-sheet must be a JPEG filename inside the artwork directory')
ROOT = args.root.resolve()
W, H = 1024, 640
FONT_DIR = Path('C:/Windows/Fonts')


def font(size, bold=True, display=False):
    names = ['bahnschrift.ttf', 'arialbd.ttf'] if display else ['segoeuib.ttf' if bold else 'segoeui.ttf', 'arialbd.ttf' if bold else 'arial.ttf']
    names += ['DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf']
    for name in names:
        try:
            return ImageFont.truetype(str(FONT_DIR / name) if (FONT_DIR / name).exists() else name, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


PROFILES = {
    'balance': ('EQUILIBRIUM', 'PRECISION SERIES', '#5baaff', 'target'),
    'rifles': ('CROSSFIRE', 'RIFLE ARSENAL', '#ff6d2f', 'cross'),
    'farm': ('GOLD RUSH', 'GOLD HUNT', '#ffcd45', 'diamond'),
    'starter': ('IGNITION', 'ENTRY SERIES', '#6cdda9', 'bolt'),
    'quick-hit': ('FLASHPOINT', 'FAST & VOLATILE', '#f9ff5a', 'bolt'),
    'mil-spec': ('MIL-SPEC', 'BLUE DIVISION', '#497cff', 'target'),
    'restricted': ('RESTRICTED', 'VIOLET DIVISION', '#a56aff', 'hex'),
    'classified': ('CLASSIFIED', 'MAGENTA DIVISION', '#f759d5', 'diamond'),
    'covert': ('COVERT', 'RED DIVISION', '#ff535f', 'cross'),
    'zeus': ('THUNDERBOLT', 'ZEUS X27', '#d5ff50', 'bolt'),
    'glock': ('SIDEARM', 'GLOCK-18', '#ebad59', 'hex'),
    'usp': ('SILENT STRIKE', 'USP-S', '#69e6cb', 'target'),
    'deagle': ('HAND CANNON', 'DESERT EAGLE', '#ffa06a', 'diamond'),
    'smg': ('CLOSE QUARTERS', 'SMG SQUAD', '#51d2ff', 'cross'),
    'scout': ('DEADEYE', 'SSG 08', '#8de7b4', 'target'),
    'ak': ('KALASH', 'AK-47', '#ff8d4b', 'cross'),
    'm4a4': ('FRONTLINE', 'M4A4', '#83a0ff', 'shield'),
    'm4a1': ('GHOST UNIT', 'M4A1-S', '#b3eeff', 'hex'),
    'awp': ('LONGSHOT', 'AWP', '#e7b5ff', 'target'),
    'printstream': ('PRINTSTREAM', 'MONOCHROME EDITION', '#e8faff', 'hex'),
    'neon': ('NEON DISTRICT', 'AFTER HOURS', '#fe58da', 'city'),
    'crimson': ('CRIMSON', 'REDLINE EDITION', '#ff315b', 'slash'),
    'vintage': ('LEGACY', 'FOUNDERS COLLECTION', '#dfbc83', 'crown'),
    'farm-knife': ('BLADE HUNT', 'KNIFE LOTTERY', '#ffba55', 'slash'),
    'farm-glove': ('GLOVE HUNT', 'GLOVE LOTTERY', '#d293ff', 'hex'),
    'knife': ('BLADES', 'KNIFE ARSENAL', '#f4cb6a', 'slash'),
    'glove': ('SECOND SKIN', 'GLOVE ARSENAL', '#e998c8', 'shield'),
    'fade': ('FADE', 'PRISMATIC BLADES', '#ff8da9', 'prism'),
    'doppler': ('DOPPLER', 'GEMSTONE EDITION', '#ae7dff', 'diamond'),
    'gamma': ('GAMMA', 'EMERALD EDITION', '#57ffb8', 'diamond'),
    'elite': ('APEX', 'PRESTIGE COLLECTION', '#f9d78c', 'crown'),
    'jackpot-1': ('ONE PERCENT', 'JACKPOT / 01', '#ffbf49', 'diamond'),
    'jackpot-5': ('FIVE PERCENT', 'JACKPOT / 05', '#ff7158', 'diamond'),
    'jackpot-10': ('TEN PERCENT', 'JACKPOT / 10', '#ec6dff', 'diamond'),
    'dragon': ('DRAGONFIRE', 'MYTHIC SERIES', '#ff683e', 'dragon'),
    'frost': ('ABSOLUTE ZERO', 'ARCTIC SERIES', '#73e3ff', 'snow'),
    'cosmos': ('DEEP SPACE', 'ORBITAL SERIES', '#a6a1ff', 'orbit'),
    'sakura': ('SAKURA', 'HANAMI SERIES', '#ff9bc1', 'flower'),
    'spectrum': ('SPECTRUM', 'CHROMATIC SERIES', '#7bffd9', 'prism'),
    'cyber': ('CIPHER', 'NEURAL SERIES', '#82ff71', 'circuit'),
    'desert': ('DUNE RELIC', 'ANUBIS SERIES', '#f9c576', 'pyramid'),
    'abyss': ('ABYSS', 'HADAL SERIES', '#4dcddd', 'wave'),
    'venom': ('VENOM', 'BIOHAZARD SERIES', '#b6ff54', 'serpent'),
    'royal': ('SOVEREIGN', 'DYNASTY SERIES', '#dd9dff', 'crown'),
    'pistol-lottery': ('TRIGGER LUCK', 'SIDEARM LOTTERY', '#ffc478', 'target'),
    'duel-storm': ('DUEL STORM', 'HEAD TO HEAD', '#7ca3ff', 'storm'),
    'treasure': ('LOST TREASURE', 'EXPEDITION SERIES', '#fce38b', 'compass'),
    'glove-vault': ('THE VAULT', 'PREMIUM GLOVES', '#e0a2cb', 'vault'),
    'p250': ('P250', 'TACTICAL SIDEARM', '#f2bd76', 'hex'),
    'five-seven': ('FIVE-SEVEN', 'ARMOR PIERCER', '#58e7ec', 'target'),
    'tec9': ('TEC-9', 'RAPID RESPONSE', '#ff8f52', 'bolt'),
    'cz75': ('CZ75-AUTO', 'AUTOMATIC SIDEARM', '#fb7cbb', 'storm'),
    'dual-berettas': ('DUAL BERETTAS', 'DUAL WIELD', '#af9dff', 'cross'),
    'ump45': ('UMP-45', 'HEAVY IMPACT', '#f4d167', 'shield'),
    'p90': ('P90', 'RUSH PROTOCOL', '#52e9b1', 'circuit'),
    'pp-bizon': ('PP-BIZON', 'HELICAL ARSENAL', '#e9a35d', 'orbit'),
    'mp7': ('MP7', 'COMPACT ASSAULT', '#ff727e', 'prism'),
    'mp5': ('MP5-SD', 'SUPPRESSED FORCE', '#75bdfb', 'wave'),
    'galil': ('GALIL AR', 'ASSAULT STANDARD', '#c5e977', 'cross'),
    'famas': ('FAMAS', 'BURST CONTROL', '#b58cff', 'shield'),
    'asiimov': ('ASIIMOV', 'FUTURE ENGINEERING', '#ffa85b', 'hex'),
    'mecha-industries': ('MECHA INDUSTRIES', 'WHITE ARMOR DIVISION', '#e9edff', 'circuit'),
    'bloodsport': ('BLOODSPORT', 'RACING HERITAGE', '#ff5564', 'storm'),
    'hyper-beast': ('HYPER BEAST', 'CREATURE FEATURE', '#b578ff', 'serpent'),
    'wasteland-rebel': ('WASTELAND REBEL', 'AFTER THE FALL', '#d7b073', 'crown'),
    'case-hardened': ('CASE HARDENED', 'HARDENED FINISHES', '#70adff', 'prism'),
    'karambit': ('KARAMBIT', 'CURVED EDGE', '#f4b96b', 'slash'),
    'butterfly': ('BUTTERFLY', 'BALISONG COLLECTION', '#e2a0ff', 'flower'),
    'm9-bayonet': ('M9 BAYONET', 'COMBAT HERITAGE', '#8bdde7', 'shield'),
    'bayonet': ('BAYONET', 'CLASSIC EDGE', '#efd18c', 'diamond'),
    'talon': ('TALON', 'PREDATOR SERIES', '#93e9be', 'dragon'),
    'sport-gloves': ('SPORT GLOVES', 'PERFORMANCE SERIES', '#ff9bbd', 'hex'),
}

# The expansion uses gallery compositions with a distinct layout for each series.
# Existing covers retain the original renderer and their checked-in bytes.
EXPANSION_PROFILES = {
    'p2000': ('P2000', 'PRECISION SIDEARM', '#ffb562', 'target', 'armory'),
    'sg553': ('SG 553', 'SCOPED ASSAULT', '#6ce8b7', 'cross', 'technical'),
    'aug': ('AUG', 'TACTICAL OPTICS', '#86b9ff', 'target', 'armory'),
    'g3sg1': ('G3SG1', 'AUTO SNIPER', '#ef8c80', 'compass', 'technical'),
    'scar20': ('SCAR-20', 'PRECISION SUPPORT', '#d3aeff', 'target', 'armory'),
    'nova': ('NOVA', 'PUMP ACTION', '#f3cf7b', 'shield', 'technical'),
    'xm1014': ('XM1014', 'BREACH SYSTEM', '#f69b64', 'cross', 'armory'),
    'negev': ('NEGEV', 'HEAVY ARSENAL', '#a3d970', 'shield', 'technical'),
    'huntsman': ('HUNTSMAN', 'HUNTER SERIES', '#e5b96e', 'compass', 'orbital'),
    'bowie': ('BOWIE', 'FRONTIER SERIES', '#f8a16a', 'slash', 'vault'),
    'falchion': ('FALCHION', 'CURVED PRECISION', '#b9a0ff', 'prism', 'orbital'),
    'shadow-daggers': ('SHADOW DAGGERS', 'TWIN EDGE SERIES', '#f584b1', 'cross', 'vault'),
    'paracord': ('PARACORD', 'FIELD EQUIPMENT', '#83dbbd', 'hex', 'orbital'),
    'survival': ('SURVIVAL', 'EXPEDITION SERIES', '#cfcc7a', 'compass', 'vault'),
    'nomad': ('NOMAD', 'WANDERER SERIES', '#ffa56f', 'diamond', 'orbital'),
    'skeleton': ('SKELETON', 'BARE METAL SERIES', '#89dce9', 'slash', 'vault'),
    'neo-noir': ('NEO-NOIR', 'ILLUSTRATED NIGHTS', '#d996ff', 'city', 'signal'),
    'neon-rider': ('NEON RIDER', 'MIDNIGHT CIRCUIT', '#ff73d5', 'storm', 'signal'),
    'fuel-injector': ('FUEL INJECTOR', 'INDUSTRIAL EDITION', '#ffd456', 'hex', 'technical'),
    'decimator': ('DECIMATOR', 'GEOMETRIC SERIES', '#81b4ff', 'prism', 'signal'),
    'pulse': ('PULSE', 'ELECTRIC FREQUENCY', '#e57fff', 'wave', 'signal'),
    'ember': ('INFERNO', 'FIRE AND FLAME', '#ff9862', 'dragon', 'signal'),
    'night-safari': ('NIGHT SAFARI', 'AFTER DARK', '#b4d378', 'compass', 'vault'),
    'arcade': ('ARCADE', 'PLAYFUL FINISHES', '#76edeb', 'circuit', 'signal'),
    'botanical': ('BOTANICAL', 'GARDEN COLLECTION', '#8fe4a9', 'flower', 'orbital'),
    'horror': ('NIGHTMARE', 'AFTER MIDNIGHT', '#b17dff', 'serpent', 'vault'),
    'street-art': ('STREET ART', 'URBAN CANVAS', '#ff9570', 'city', 'signal'),
    'engineering': ('ENGINEERING', 'WORKSHOP SERIES', '#80c6ea', 'circuit', 'technical'),
    'pistol-duel': ('PISTOL DUEL', 'SIDEARM PAIRING', '#ffd58b', 'cross', 'duet'),
    'eco-rush': ('ECO RUSH', 'LIGHT ARSENAL', '#86eba8', 'bolt', 'duet'),
    'rifle-arena': ('RIFLE ARENA', 'ASSAULT PAIRING', '#ff9974', 'shield', 'duet'),
    'sniper-showdown': ('SNIPER SHOWDOWN', 'LONG RANGE PAIRING', '#baa7ff', 'target', 'duet'),
    'shotgun-breach': ('BREACH', 'SHOTGUN PAIRING', '#f4c978', 'cross', 'duet'),
    'smg-overdrive': ('OVERDRIVE', 'SMG PAIRING', '#75e7ef', 'bolt', 'duet'),
    'covert-vault': ('COVERT VAULT', 'RED TIER COLLECTION', '#ff788b', 'vault', 'vault'),
    'arsenal-ascension': ('ASCENSION', 'MIXED ARSENAL', '#bda2ff', 'crown', 'orbital'),
    # Discovery expansion: a separate palette and featured catalogue reward per case.
    'mag7': ('MAG-7', 'CLOSE RANGE SYSTEM', '#f2b68c', 'shield', 'armory'),
    'sawed-off': ('SAWED-OFF', 'COMPACT BREACH', '#e0cf80', 'cross', 'technical'),
    'm249': ('M249', 'SUPPORT FIRE', '#a6c998', 'circuit', 'armory'),
    'r8': ('R8 REVOLVER', 'EIGHT CHAMBERS', '#cf9eeb', 'target', 'technical'),
    'flip': ('FLIP KNIFE', 'FOLDING EDGE', '#f5bd96', 'slash', 'orbital'),
    'gut': ('GUT KNIFE', 'HOOKED EDGE', '#d1d98c', 'compass', 'vault'),
    'navaja': ('NAVAJA', 'COMPACT EDGE', '#eda0be', 'diamond', 'orbital'),
    'ursus': ('URSUS', 'BEAR CLAW', '#b6b1f5', 'shield', 'vault'),
    'stiletto': ('STILETTO', 'SLENDER STEEL', '#86d9d1', 'slash', 'orbital'),
    'kukri': ('KUKRI', 'FORGED CURVE', '#f7ab65', 'dragon', 'vault'),
    'tiger-tooth': ('TIGER TOOTH', 'AMBER STRIPES', '#ffba47', 'serpent', 'signal'),
    'marble-fade': ('MARBLE FADE', 'THREE COLOR STEEL', '#ee8ed0', 'prism', 'orbital'),
    'lore': ('LORE', 'ENGRAVED LEGACY', '#dce596', 'crown', 'vault'),
    'autotronic': ('AUTOTRONIC', 'RED ENGINEERING', '#f27787', 'circuit', 'technical'),
    'slaughter': ('SLAUGHTER', 'CRIMSON PATTERNS', '#ef6977', 'slash', 'signal'),
    'freehand': ('FREEHAND', 'DRAWN IN VIOLET', '#c4a0ff', 'flower', 'signal'),
    'silent-strike': ('SILENT STRIKE', 'SUPPRESSED PAIRING', '#8de0d1', 'wave', 'duet'),
    'ct-loadout': ('CT LOADOUT', 'DEFENSE ARSENAL', '#7fbaff', 'shield', 'duet'),
    't-loadout': ('T LOADOUT', 'ATTACK ARSENAL', '#edb56d', 'cross', 'duet'),
    'orange-white': ('ORANGE / WHITE', 'CONTRAST COLLECTION', '#ffc08a', 'hex', 'technical'),
    'black-gold': ('BLACK / GOLD', 'GILDED COLLECTION', '#eac977', 'crown', 'vault'),
    'blue-purple': ('BLUE / PURPLE', 'COOL SPECTRUM', '#a3a2ff', 'prism', 'orbital'),
    'pistol-premium': ('PISTOL SELECT', 'PREMIUM SIDEARMS', '#e2a3d2', 'target', 'duet'),
    'heavy-assault': ('HEAVY ASSAULT', 'SUPPORT PAIRING', '#aac78d', 'bolt', 'duet'),
}

# Collection archives and headline finishes have their own gallery language.
# The palette and architecture follow the collection, using the real skin cutout.
ICONIC_PROFILES = {
    'archive-cobblestone': ('DRAGON LORE', 'COBBLESTONE ARCHIVE', '#d9b86f', 'dragon', 'relic'),
    'archive-norse': ('GUNGNIR', 'NORSE ARCHIVE', '#8edce8', 'snow', 'myth'),
    'archive-gods-and-monsters': ('MEDUSA', 'GODS & MONSTERS', '#76d8bb', 'serpent', 'myth'),
    'archive-stmarc': ('WILD LOTUS', 'ST. MARC ARCHIVE', '#f5a7c8', 'flower', 'botanical'),
    'archive-dust-2-2021': ('GOLD ARABESQUE', 'DUST II / 2021', '#f4cf73', 'pyramid', 'relic'),
    'archive-mirage-2021': ('DESERT HYDRA', 'MIRAGE / 2021', '#e3a67a', 'serpent', 'relic'),
    'archive-vertigo-2021': ('IMMINENT DANGER', 'VERTIGO / 2021', '#e4f373', 'bolt', 'gallery'),
    'archive-canals': ('THE PRINCE', 'CANALS ARCHIVE', '#d28f98', 'crown', 'relic'),
    'archive-kimono': ('AKIHABARA', 'RISING SUN ARCHIVE', '#d4a6ef', 'flower', 'metropolis'),
    'archive-op10-t': ('X-RAY', 'HAVOC ARCHIVE', '#e6a68c', 'target', 'gallery'),
    'archive-op10-ct': ('CONTROL', 'FADE / BLUE PHOSPHOR', '#a6d7ff', 'prism', 'prism'),
    'archive-op10-ancient': ('JUNGLE', 'ANCIENT ARCHIVE', '#9ad090', 'serpent', 'botanical'),
    'archive-chopshop': ('HOT ROD', 'CHOP SHOP ARCHIVE', '#fa7983', 'circuit', 'forge'),
    'archive-bank': ('EMERALD BANK', 'BANK ARCHIVE', '#8dd6ae', 'vault', 'metropolis'),
    'archive-assault': ('GLOCK FADE', 'ASSAULT ARCHIVE', '#f8b38c', 'prism', 'prism'),
    'archive-dust': ('BLAZE', 'DUST ARCHIVE', '#ffa45d', 'dragon', 'forge'),
    'archive-dust-2': ('AMBER FADE', 'DUST II / LEGACY', '#dfc482', 'diamond', 'prism'),
    'archive-italy': ('PIT VIPER', 'ITALY ARCHIVE', '#becf92', 'serpent', 'relic'),
    'archive-cache': ('CERBERUS', 'CACHE ARCHIVE', '#c7e86d', 'shield', 'gallery'),
    'archive-baggage': ('JET SET', 'BAGGAGE ARCHIVE', '#9fcae1', 'compass', 'metropolis'),
    'archive-overpass': ('MASTER PIECE', 'OVERPASS ARCHIVE', '#a4b5ef', 'city', 'gallery'),
    'archive-nuke': ('RADIATION', 'NUKE ARCHIVE', '#f3c176', 'target', 'forge'),
    'archive-inferno': ('ANODIZED NAVY', 'INFERNO / LEGACY', '#8eaada', 'shield', 'metropolis'),
    'archive-anubis': ('EYE OF HORUS', 'ANUBIS ARCHIVE', '#f0cb8f', 'pyramid', 'relic'),
    'archive-overpass-2024': ('B THE MONSTER', 'OVERPASS / 2024', '#c5b0f4', 'serpent', 'gallery'),
    'archive-train-2021': ('EMERALD TRAIN', 'TRAIN / 2021', '#86e3b1', 'diamond', 'myth'),
    'archive-realism-camo': ('M4 FADE', 'SPORT & FIELD', '#f4c1dc', 'prism', 'prism'),
    'archive-graphic-design': ('CMYK', 'GRAPHIC DESIGN', '#88dce9', 'prism', 'gallery'),
    'archive-inferno-2': ('INTEGRALE', 'INFERNO / 2018', '#f5ac8b', 'storm', 'forge'),
    'archive-mirage': ('HOT ROD', 'MIRAGE / LEGACY', '#e99b9c', 'compass', 'metropolis'),
    'howl': ('HOWL', 'CONTRABAND ARCHIVE', '#ff956b', 'dragon', 'myth'),
    'howl-hunt': ('WOLF TRACKS', 'HOWL / M4A4 EDITION', '#f67d84', 'dragon', 'duet'),
    'awp-legends': ('AWP LEGENDS', 'DRAGON LORE / GUNGNIR', '#c5d5fa', 'crown', 'duet'),
    'ak-collectors': ('AK MUSEUM', 'WILD LOTUS / X-RAY', '#e3a9d4', 'flower', 'duet'),
    'm4-collectors': ('M4 MUSEUM', 'HOWL / JUNGLE', '#e2b47d', 'vault', 'duet'),
    'pistol-relics': ('PISTOL RELICS', 'FADE / BLAZE', '#c5b2f6', 'crown', 'duet'),
}


def rgb(color):
    return tuple(bytes.fromhex(color.lstrip('#')))


def glyph(draw, kind, cx, cy, r, color, width=5):
    def line(points, closed=False, w=width):
        points = [(cx + x * r, cy + y * r) for x, y in points]
        if closed:
            points.append(points[0])
        draw.line(points, fill=color, width=w, joint='curve')
    def ellipse(x0, y0, x1, y1, w=width):
        draw.ellipse((cx+x0*r, cy+y0*r, cx+x1*r, cy+y1*r), outline=color, width=w)
    if kind in ('target', 'compass'):
        ellipse(-.7,-.7,.7,.7); ellipse(-.35,-.35,.35,.35,2)
        for a in range(0, 360, 90):
            x,y=math.cos(math.radians(a)),math.sin(math.radians(a)); line([(x*.5,y*.5),(x,y)])
        if kind == 'compass': line([(0,-.8),(.18,.18),(-.4,.5),(0,-.8)])
    elif kind in ('diamond', 'prism', 'pyramid'):
        line([(-1,-.3),(-.5,-.85),(.5,-.85),(1,-.3),(0,1)],True)
        line([(-1,-.3),(1,-.3)]); line([(-.5,-.85),(0,1),(.5,-.85)], w=2)
    elif kind in ('hex', 'shield', 'vault'):
        line([(math.cos(i*math.pi/3),math.sin(i*math.pi/3)) for i in range(6)],True)
        if kind=='vault': ellipse(-.55,-.55,.55,.55);line([(-.3,0),(.3,0)]);line([(0,-.3),(0,.3)])
        else: line([(-.35,-.3),(.35,-.3),(.35,.3),(0,.6),(-.35,.3)],True)
    elif kind in ('bolt', 'slash', 'storm'):
        line([(.25,-1),(-.45,.1),(.1,.1),(-.2,1),(.65,-.2),(.05,-.2)],True)
        if kind=='storm': ellipse(-1.1,-1.1,1.1,1.1,2)
    elif kind=='cross':
        line([(-.8,-.8),(.8,.8)],w=10);line([(.8,-.8),(-.8,.8)],w=10)
        ellipse(-.3,-.3,.3,.3,2)
    elif kind=='crown':
        line([(-1,-.5),(-.55,.7),(.55,.7),(1,-.5),(.4,0),(0,-1),(-.4,0)],True)
        line([(-.55,.9),(.55,.9)])
    elif kind=='flower':
        for a in range(0,360,72):
            x,y=math.cos(math.radians(a))*.55,math.sin(math.radians(a))*.55
            ellipse(x-.4,y-.4,x+.4,y+.4,3)
        ellipse(-.18,-.18,.18,.18,3)
    elif kind=='snow':
        for a in range(0,360,60):
            x,y=math.cos(math.radians(a)),math.sin(math.radians(a));line([(0,0),(x,y)])
            for sign in [-1,1]:
                line([(x*.65,y*.65),(x*.45-y*.2*sign,y*.45+x*.2*sign)],w=3)
    elif kind=='orbit':
        ellipse(-.7,-.7,.7,.7,3);draw.ellipse((cx-r*1.25,cy-r*.35,cx+r*1.25,cy+r*.35),outline=color,width=width)
        draw.ellipse((cx+r*.6,cy-r*.85,cx+r*.83,cy-r*.62),fill=color)
    elif kind=='wave':
        for y in [-.55,0,.55]: line([(x/20, y+math.sin(x/20*math.pi)*.18) for x in range(-22,23)],w=4)
    elif kind=='city':
        for x,h in [(-.9,.6),(-.4,1),(.1,.4),(.6,.8)]:line([(x,.9),(x,-h),(x+.25,-h),(x+.25,.9)],w=4)
    elif kind=='circuit':
        line([(-.8,-.8),(-.1,-.8),(-.1,.1),(.8,.1)]);line([(-.8,.6),(.3,.6),(.3,-.5),(.9,-.5)])
        for x,y in [(-.8,-.8),(.8,.1),(-.8,.6),(.9,-.5)]:ellipse(x-.13,y-.13,x+.13,y+.13,3)
    elif kind in ('dragon','serpent'):
        line([(-.8,.8),(-.8,.3),(-.2,.25),(.3,-.25),(.8,-.3),(.35,-.65),(.45,-1),(-.1,-.75),(-.55,-.9),(-.35,-.3),(-.75,-.1)],w=7)
        line([(.15,-.4),(.45,-.42)],w=3)


def background(color, seed):
    c = np.array(color,dtype=float)
    y,x=np.mgrid[0:H,0:W]; glow=np.exp(-(((x-650)/440)**2+((y-260)/310)**2))
    rim=np.exp(-(((x-150)/350)**2+((y-500)/220)**2))
    a=np.zeros((H,W,3),dtype=float)+np.array([7,11,21])
    a += glow[:,:,None]*c*.28 + rim[:,:,None]*c*.09
    rng=np.random.default_rng(seed);a += rng.normal(0,.15,(H,W,1))
    im=Image.fromarray(np.uint8(np.clip(a,0,255))).convert('RGBA')
    d=ImageDraw.Draw(im,'RGBA')
    for i in range(12):
        xx=380+i*90;d.line((xx,-40,xx-450,H+100),fill=(*color,12),width=1)
    for i in range(5):d.line((0,340+i*70,W,340+i*70),fill=(*color,10),width=1)
    return im


def skin_layer(im, source, color, center, bounds, angle=0):
    with Image.open(ROOT/source) as image:
        cut=image.convert('RGBA')
    bbox=cut.getbbox()
    if bbox:
        cut=cut.crop(bbox)
    cut.thumbnail(bounds,Image.Resampling.LANCZOS)
    cut=cut.rotate(angle,resample=Image.Resampling.BICUBIC,expand=True)
    x=int(center[0]-cut.width/2);y=int(center[1]-cut.height/2)
    alpha=cut.getchannel('A')
    glow=Image.new('RGBA',cut.size,(*color,0));glow.putalpha(alpha.point(lambda a:int(a*.45)))
    layer=Image.new('RGBA',(W,H));layer.alpha_composite(glow,(x,y+5))
    im=Image.alpha_composite(im,layer.filter(ImageFilter.GaussianBlur(23)))
    cast=Image.new('RGBA',cut.size,(0,0,0));cast.putalpha(alpha.point(lambda a:int(a*.8)))
    layer=Image.new('RGBA',(W,H));layer.alpha_composite(cast,(x+12,y+19))
    im=Image.alpha_composite(im,layer.filter(ImageFilter.GaussianBlur(8)))
    im.alpha_composite(cut,(x,y))
    return im


def wrap_text(draw, text, face, width):
    lines=[];line=''
    for word in text.split():
        probe=f'{line} {word}'.strip()
        if line and draw.textlength(probe,font=face)>width:
            lines.append(line);line=word
        else:
            line=probe
    if line:
        lines.append(line)
    return lines


def render_expansion(item):
    short=item['id'].removeprefix('battle-')
    title,series,hexcolor,kind,layout=EXPANSION_PROFILES[short]
    c=rgb(hexcolor);seed=int(hashlib.sha256(short.encode()).hexdigest()[:8],16)
    rng=random.Random(seed);im=background(c,seed)
    stage=Image.new('RGBA',(W,H));d=ImageDraw.Draw(stage,'RGBA')
    # Each series has its own stage, rather than putting every skin over a case.
    if layout=='armory':
        d.polygon([(477,115),(955,115),(982,145),(982,495),(955,525),(477,525),(451,496),(451,145)],fill=(13,23,34,230),outline=(*c,155),width=2)
        d.polygon([(468,155),(966,155),(966,485),(468,485)],fill=(*c,12))
        for x in range(485,960,34):
            d.line((x,510,x+12,510),fill=(*c,140),width=3)
        for x,y in [(472,136),(961,136),(472,503),(961,503)]:
            d.ellipse((x-4,y-4,x+4,y+4),fill=(147,169,185,210))
        glyph(d,kind,730,305,142,(*c,45),3)
        d.text((490,132),'ARMORY / DISPLAY',font=font(12),fill=(*c,170))
    elif layout=='technical':
        d.rounded_rectangle((462,126,978,527),radius=10,fill=(10,22,33,210),outline=(*c,155),width=2)
        for x in range(482,976,32):d.line((x,143,x,510),fill=(*c,22),width=1)
        for y in range(159,522,32):d.line((478,y,963,y),fill=(*c,22),width=1)
        d.line((478,114,960,114),fill=(*c,110),width=1)
        d.line((990,144,990,510),fill=(*c,110),width=1)
        for x in range(480,970,24):d.line((x,108,x,119),fill=(*c,150),width=1)
        for y in range(148,514,24):d.line((985,y,996,y),fill=(*c,150),width=1)
        glyph(d,kind,720,325,153,(*c,65),2)
        d.text((480,499),'FINISH STUDY / CS2',font=font(12),fill=(*c,180))
    elif layout=='orbital':
        d.ellipse((477,99,988,550),fill=(*c,10),outline=(*c,55),width=1)
        for radius,width,alpha in [(199,2,160),(216,1,75),(234,1,45)]:
            d.arc((721-radius,319-radius,721+radius,319+radius),18,320,fill=(*c,alpha),width=width)
        d.ellipse((494,478,953,550),fill=(2,6,14,200),outline=(*c,70),width=1)
        d.ellipse((541,487,916,523),fill=(*c,28),outline=(*c,95),width=2)
        for a in range(0,360,45):
            x=721+226*math.cos(math.radians(a));y=319+226*math.sin(math.radians(a))
            d.ellipse((x-4,y-4,x+4,y+4),fill=(*c,205))
        glyph(d,kind,721,319,144,(*c,75),3)
    elif layout=='vault':
        d.polygon([(531,70),(915,70),(1001,530),(445,530)],fill=(*c,13))
        d.arc((455,61,1000,608),180,360,fill=(*c,75),width=2)
        d.arc((479,87,976,582),180,360,fill=(*c,38),width=1)
        d.polygon([(495,484),(882,484),(966,535),(570,535)],fill=(31,43,57,255),outline=(*c,165),width=2)
        d.polygon([(570,535),(966,535),(966,565),(570,565)],fill=(9,17,29,255),outline=(*c,70),width=1)
        d.polygon([(495,484),(570,535),(570,565),(495,514)],fill=(17,26,40,255))
        glyph(d,kind,727,304,154,(*c,70),3)
        d.text((616,543),'CURATED COLLECTION',font=font(13),fill=(*c,175))
    elif layout=='signal':
        d.polygon([(623,60),(1024,60),(1024,575),(399,575)],fill=(*c,18))
        d.polygon([(744,60),(838,60),(621,575),(528,575)],fill=(*c,22))
        for x in [460,490,520,970,995]:
            d.line((x,94,x-130,549),fill=(*c,100 if x==490 else 38),width=3 if x==490 else 1)
        glyph(d,kind,752,309,173,(*c,100),5)
        for i in range(13):
            y=125+i*31;x=rng.randint(480,870)
            d.rectangle((x,y,min(x+rng.randint(18,75),1000),y+3),fill=(*c,90))
        d.text((674,541),'CUSTOM FINISHES',font=font(14),fill=(*c,150))
    elif layout=='duet':
        d.polygon([(492,94),(992,94),(992,323),(455,323)],fill=(*c,16),outline=(*c,75),width=1)
        d.polygon([(455,343),(992,343),(992,566),(492,566)],fill=(*c,8),outline=(*c,55),width=1)
        d.line((470,333,982,333),fill=(*c,190),width=2)
        glyph(d,kind,720,333,46,(*c,135),3)
        d.text((487,108),'FEATURED / 01',font=font(12),fill=(*c,160))
        d.text((487,544),'FEATURED / 02',font=font(12),fill=(*c,160))
    im=Image.alpha_composite(im,stage)
    if layout=='duet':
        im=skin_layer(im,item['source'],c,(727,228),(493,204),-7)
        im=skin_layer(im,item.get('secondarySource',item['source']),c,(727,442),(473,192),8)
    else:
        center=(720,316) if layout!='vault' else (721,300)
        bounds=(515,303) if layout in ('technical','armory') else (492,337)
        angle=0 if layout=='technical' else (-10 if item['index']%2 else 12)
        im=skin_layer(im,item['source'],c,center,bounds,angle)
    # A solid text rail keeps the title readable even with oversized hero cutouts.
    veil=Image.new('RGBA',(W,H));vd=ImageDraw.Draw(veil)
    for x in range(469):
        vd.line((x,0,x,H),fill=(5,10,19,220 if x<385 else int(220*(469-x)/84)))
    im=Image.alpha_composite(im,veil);d=ImageDraw.Draw(im)
    d.rounded_rectangle((42,34,224,65),radius=5,fill=tuple(int(v*.17) for v in c),outline=tuple(int(v*.5) for v in c))
    d.text((54,41),'CS2  /  CASE BATTLE',font=font(14),fill=(*c,255))
    d.text((44,103),series,font=font(16),fill=(*c,255))
    for size in [57,54,51,48,45]:
        face=font(size,display=True);lines=wrap_text(d,title,face,350)
        if len(lines)<=3 and all(d.textlength(line,font=face)<=350 for line in lines):break
    step=size+7
    for i,line in enumerate(lines):d.text((40,139+i*step),line,font=face,fill=(244,249,255))
    y=153+len(lines)*step
    d.line((45,y,129,y),fill=(*c,255),width=4)
    name_face=font(19)
    for i,line in enumerate(wrap_text(d,item['name'].upper(),name_face,350)):
        d.text((44,y+24+i*26),line,font=name_face,fill=(178,199,219))
    d.rounded_rectangle((44,500,277,552),radius=8,fill=(13,23,36),outline=tuple(int(v*.36) for v in c))
    d.text((59,510),f"COLLECTION / {item['index']+1:03d}",font=font(17),fill=(*c,235))
    d.line((44,590,980,590),fill=(*c,100),width=1)
    d.text((44,607),'CUSTOM ARSENAL',font=font(12),fill=(124,148,171))
    d.text((813,607),'BATTLE / CS2',font=font(12),fill=(*c,200))
    result=im.convert('RGB')
    result.quantize(colors=256,method=Image.Quantize.MEDIANCUT).save(ROOT/f"{item['id']}.png",optimize=True)
    return result


def render_iconic(item):
    short=item['id'].removeprefix('battle-')
    title,series,hexcolor,kind,layout=ICONIC_PROFILES[short]
    c=rgb(hexcolor);seed=int(hashlib.sha256(short.encode()).hexdigest()[:8],16)
    im=background(c,seed)
    stage=Image.new('RGBA',(W,H));d=ImageDraw.Draw(stage,'RGBA')
    # A different architectural stage belongs to each archive family.
    if layout=='relic':
        d.rounded_rectangle((487,79,970,555),radius=190,fill=(*c,11),outline=(*c,105),width=2)
        d.arc((505,97,952,520),181,359,fill=(*c,185),width=3)
        d.arc((522,115,935,503),181,359,fill=(*c,55),width=1)
        for x in (492,950):
            d.rectangle((x,281,x+14,524),fill=(*c,35),outline=(*c,75),width=1)
            d.rectangle((x-8,516,x+22,529),fill=(*c,95))
        for y in (539,548,556):
            d.line((476,y,981,y),fill=(*c,100 if y==548 else 40),width=2)
        glyph(d,kind,730,298,143,(*c,62),3)
    elif layout=='myth':
        for radius,alpha in ((231,40),(213,85),(196,40)):
            d.ellipse((733-radius,308-radius,733+radius,308+radius),outline=(*c,alpha),width=2)
        for i in range(24):
            a=i*math.pi/12
            points=[(733+radius*math.cos(a),308+radius*math.sin(a)) for radius in (216,228 if i%2 else 237)]
            d.line(points,fill=(*c,160),width=2)
        d.polygon([(733,90),(943,308),(733,526),(523,308)],outline=(*c,60),width=2)
        glyph(d,kind,733,308,157,(*c,80),3)
        for x,y in ((733,77),(967,308),(733,539),(500,308)):
            d.polygon([(x,y-6),(x+4,y),(x,y+6),(x-4,y)],fill=(*c,210))
    elif layout=='botanical':
        d.ellipse((481,72,989,557),fill=(*c,9),outline=(*c,45),width=1)
        for side in (-1,1):
            for i in range(7):
                x=733+side*(212-i*10);y=520-i*54
                d.arc((x-58,y-48,x+58,y+48),10 if side==1 else 135,225 if side==1 else 350,fill=(*c,55+i*6),width=2)
                d.line((x,y,x-side*33,y-26),fill=(*c,75),width=1)
        glyph(d,'flower',733,293,155,(*c,55),3)
        d.arc((516,85,950,544),0,180,fill=(*c,125),width=2)
        d.ellipse((557,505,913,550),fill=(*c,20),outline=(*c,110),width=1)
    elif layout=='forge':
        d.polygon([(545,100),(973,100),(973,538),(460,538)],fill=(16,23,32,235),outline=(*c,105),width=2)
        d.polygon([(570,113),(959,113),(959,524),(482,524)],fill=(*c,11))
        for i in range(7):
            y=141+i*57
            d.line((520,y,958,y),fill=(*c,27),width=1)
        d.line((551,81,978,81),fill=(*c,145),width=5)
        d.line((467,555,963,555),fill=(*c,100),width=2)
        for x in (538,943):
            for y in (127,507):
                d.ellipse((x-4,y-4,x+4,y+4),fill=(170,179,188,190))
        glyph(d,kind,730,310,149,(*c,65),3)
    elif layout=='metropolis':
        for i in range(5):
            inset=i*17
            d.line([(481+inset,551),(481+inset,164-inset*1.1),(733,71+inset),(985-inset,164-inset*1.1),(985-inset,551)],fill=(*c,55 if i%2 else 100),width=1 if i%2 else 2)
        d.rectangle((515,498,949,538),fill=(*c,13),outline=(*c,65),width=1)
        for x in range(532,950,34):
            d.line((x,510,x+13,525),fill=(*c,70),width=2)
        glyph(d,kind,733,293,143,(*c,55),3)
    elif layout=='prism':
        a=(154,133,238);b=(239,136,180)
        d.polygon([(505,82),(1003,113),(856,546),(455,516)],fill=(*a,18),outline=(*c,80),width=2)
        d.polygon([(732,86),(1003,113),(856,546),(653,529)],fill=(*b,17))
        for offset in (0,19,38):
            d.line((532+offset,96,941+offset,126,817+offset,520),fill=(*c,65),width=1)
        d.line((481,549,968,549),fill=(*c,140),width=2)
        glyph(d,'prism',733,299,162,(*c,60),3)
    elif layout=='gallery':
        d.rounded_rectangle((474,91,989,550),radius=12,fill=(12,19,31,235),outline=(*c,135),width=2)
        d.rectangle((493,110,970,529),outline=(*c,35),width=1)
        for x,y,size in ((494,111,21),(943,111,21),(494,502,21),(943,502,21)):
            d.rectangle((x,y,x+size,y+size),outline=(*c,105),width=2)
        for i in range(10):
            x=518+i*45
            d.line((x,523,x+13,523),fill=(*c,95),width=2)
        glyph(d,kind,733,306,157,(*c,55),3)
        if short=='archive-graphic-design':
            for i,color in enumerate(((94,213,234),(229,118,189),(239,212,111))):
                d.rectangle((519+i*38,135,545+i*38,143),fill=(*color,210))
    elif layout=='duet':
        d.polygon([(485,87),(984,87),(984,310),(457,310)],fill=(*c,14),outline=(*c,75),width=1)
        d.polygon([(457,334),(984,334),(984,557),(485,557)],fill=(*c,8),outline=(*c,55),width=1)
        d.line((478,322,967,322),fill=(*c,130),width=2)
        glyph(d,kind,733,322,38,(*c,110),2)
        for x,y in ((485,100),(957,100),(485,531),(957,531)):
            d.rectangle((x,y,x+9,y+9),fill=(*c,125))
    im=Image.alpha_composite(im,stage)
    if layout=='duet':
        im=skin_layer(im,item['source'],c,(731,205),(475,202),-6)
        im=skin_layer(im,item.get('secondarySource',item['source']),c,(731,443),(475,198),7)
    else:
        angle=-8 if layout in ('relic','botanical') else 7 if layout in ('myth','prism') else 0
        im=skin_layer(im,item['source'],c,(733,310),(503,307),angle)
    veil=Image.new('RGBA',(W,H));vd=ImageDraw.Draw(veil)
    for x in range(470):
        vd.line((x,0,x,H),fill=(5,10,19,232 if x<390 else int(232*(470-x)/80)))
    im=Image.alpha_composite(im,veil);d=ImageDraw.Draw(im)
    d.rounded_rectangle((42,34,224,65),radius=5,fill=tuple(int(v*.16) for v in c),outline=tuple(int(v*.45) for v in c))
    d.text((54,41),'CS2  /  CASE BATTLE',font=font(14),fill=(*c,255))
    d.text((44,106),series,font=font(15),fill=(*c,255))
    for size in (62,58,54,50,46):
        face=font(size,display=True);lines=wrap_text(d,title,face,354)
        if len(lines)<=3 and all(d.textlength(line,font=face)<=354 for line in lines):
            break
    step=size+8
    for i,line in enumerate(lines):
        d.text((40,145+i*step),line,font=face,fill=(244,249,255))
    text_y=161+len(lines)*step
    d.line((44,text_y,131,text_y),fill=(*c,245),width=4)
    for i,line in enumerate(wrap_text(d,item['name'].upper(),font(19),352)):
        d.text((44,text_y+24+i*27),line,font=font(19),fill=(182,204,224))
    label='CONTRABAND' if short=='howl' else 'COLLECTOR EDITION' if not short.startswith('archive-') else 'COLLECTION ARCHIVE'
    d.rounded_rectangle((44,500,341,551),radius=7,fill=(13,23,36),outline=tuple(int(v*.4) for v in c))
    d.text((58,516),label,font=font(16),fill=(*c,235))
    d.text((933,565),f"{item['index']+1:03d}",font=font(13),fill=(*c,180))
    d.line((44,590,980,590),fill=(*c,100),width=1)
    d.text((44,607),'CUSTOM ARSENAL',font=font(12),fill=(124,148,171))
    d.text((813,607),'BATTLE / CS2',font=font(12),fill=(*c,200))
    result=im.convert('RGB')
    result.quantize(colors=256,method=Image.Quantize.MEDIANCUT).save(ROOT/f"{item['id']}.png",optimize=True)
    return result


def render(item):
    short=item['id'].removeprefix('battle-')
    if short == 'blue-gem':
        return render_blue_gem(item)
    if short in ICONIC_PROFILES:
        return render_iconic(item)
    if short in EXPANSION_PROFILES:
        return render_expansion(item)
    title,series,hexcolor,kind=PROFILES[short]
    c=rgb(hexcolor);seed=int(hashlib.sha256(short.encode()).hexdigest()[:8],16);rng=random.Random(seed)
    im=background(c,seed)
    # A large lit emblem gives each themed cover its own silhouette behind the case.
    halo=Image.new('RGBA',(W,H));hd=ImageDraw.Draw(halo)
    glyph(hd,kind,760,240,158,(*c,120),7)
    im=Image.alpha_composite(im,halo.filter(ImageFilter.GaussianBlur(20)))
    hd=ImageDraw.Draw(halo);glyph(hd,kind,760,240,158,(*c,180),4)
    im=Image.alpha_composite(im,halo)
    for i in range(40):
        x=rng.randrange(360,1024);y=rng.randrange(40,550);rr=rng.choice([1,1,2])
        ImageDraw.Draw(im).ellipse((x,y,x+rr,y+rr),fill=(*c,rng.randrange(35,160)))
    # Perspective hard-case: top, side and inset front are individually shaded raster polygons.
    shadow=Image.new('RGBA',(W,H));sd=ImageDraw.Draw(shadow)
    sd.ellipse((360,505,945,592),fill=(0,0,0,220));im=Image.alpha_composite(im,shadow.filter(ImageFilter.GaussianBlur(19)))
    body=Image.new('RGBA',(W,H));d=ImageDraw.Draw(body,'RGBA')
    top=[(430,306),(817,265),(928,344),(533,393)]
    side=[(817,265),(928,344),(915,521),(805,449)]
    front=[(430,306),(817,265),(805,449),(423,506)]
    d.polygon(top,fill=(43,51,63),outline=(*c,170));d.polygon(side,fill=(13,20,30),outline=(*c,150))
    d.polygon(front,fill=(24,32,44),outline=(*c,210))
    d.polygon([(447,327),(795,290),(785,431),(442,480)],fill=(16,23,34),outline=(*c,70))
    d.line([(433,314),(815,273)],fill=(*c,255),width=5)
    d.line([(442,486),(799,433)],fill=(*c,150),width=3)
    for x,y in [(455,332),(786,296),(451,468),(780,422)]:
        d.ellipse((x-5,y-5,x+5,y+5),fill=(102,116,130),outline=(0,0,0))
    d.polygon([(561,285),(680,272),(694,286),(570,301)],fill=(7,12,20),outline=(*c,150))
    d.line([(565,286),(568,263),(677,251),(683,273)],fill=(99,113,129),width=10)
    for x,y in [(490,312),(737,285)]:
        d.rounded_rectangle((x,y,x+28,y+38),radius=4,fill=(105,113,122),outline=(188,205,219),width=2)
        d.line((x+5,y+18,x+23,y+18),fill=(10,17,25),width=4)
    glyph(d,kind,626,386,49,(*c,225),4)
    d.text((471,438),'BATTLE / CUSTOM',font=font(14),fill=(*c,200))
    im=Image.alpha_composite(im,body)
    # Existing catalogue skin cutout remains the hero; shadow and glow add separation.
    cut=Image.open(ROOT/item['source']).convert('RGBA')
    bbox=cut.getbbox()
    if bbox:cut=cut.crop(bbox)
    cut.thumbnail((600,295),Image.Resampling.LANCZOS)
    cut=cut.rotate(-13 if item['index']%2 else 11,resample=Image.Resampling.BICUBIC,expand=True)
    x=598-cut.width//2;y=253-cut.height//2
    alpha=cut.getchannel('A');glow=Image.new('RGBA',cut.size,(*c,0));glow.putalpha(alpha.point(lambda a:int(a*.45)))
    layer=Image.new('RGBA',(W,H));layer.alpha_composite(glow,(x,y+10));im=Image.alpha_composite(im,layer.filter(ImageFilter.GaussianBlur(16)))
    cast=Image.new('RGBA',cut.size,(0,0,0));cast.putalpha(alpha.point(lambda a:int(a*.7)))
    layer=Image.new('RGBA',(W,H));layer.alpha_composite(cast,(x+9,y+19));im=Image.alpha_composite(im,layer.filter(ImageFilter.GaussianBlur(7)))
    im.alpha_composite(cut,(x,y))
    # Typography stays in a calm left rail, with enough contrast at Discord embed scale.
    veil=Image.new('RGBA',(W,H));vd=ImageDraw.Draw(veil)
    for xx in range(460):vd.line((xx,0,xx,H),fill=(5,10,19,int(170*(1-xx/460))))
    im=Image.alpha_composite(im,veil);d=ImageDraw.Draw(im)
    d.rounded_rectangle((42,36,203,64),radius=5,fill=tuple(int(v*.19) for v in c),outline=tuple(int(v*.5) for v in c))
    d.text((54,41),'CS2  /  CASE BATTLE',font=font(13),fill=(*c,255))
    d.text((44,104),series,font=font(17),fill=(*c,255))
    # Deliberate two-line titles avoid squeezing long labels into a thin banner.
    words=title.split();lines=[];line=''
    for word in words:
        probe=(line+' '+word).strip()
        if d.textlength(probe,font=font(55,display=True))>350 and line:lines.append(line);line=word
        else:line=probe
    if line:lines.append(line)
    for i,line in enumerate(lines):d.text((40,133+i*61),line,font=font(55,display=True),fill=(241,247,252))
    d.line((45,145+len(lines)*61,127,145+len(lines)*61),fill=(*c,255),width=4)
    name=item['name'].upper()
    for size in [21,20,19,18,17]:
        f=font(size)
        if d.textlength(name,font=f)<350:break
    d.text((44,175+len(lines)*61),name,font=f,fill=(184,200,217))
    d.text((44,527),f"COLLECTION {item['index']+1:02d}",font=font(14),fill=(*c,225))
    d.text((44,550),'OPEN YOUR NEXT CHAPTER',font=font(13,False),fill=(132,153,175))
    d.line((44,594,980,594),fill=(*c,75),width=1)
    d.text((44,608),'CUSTOM ARSENAL',font=font(12),fill=(113,134,155))
    d.text((829,608),'CS2 / BATTLE',font=font(12),fill=(*c,190))
    im.convert('RGB').quantize(colors=256,method=Image.Quantize.MEDIANCUT).save(ROOT/f"{item['id']}.png",optimize=True)
    return im.convert('RGB')


def render_blue_gem(item):
    c=(93,204,255);im=background(c,661387);d=ImageDraw.Draw(im,'RGBA')
    d.polygon([(420,0),(1024,0),(1024,640),(640,640)],fill=(18,72,107,40))
    for radius in [180,213,245]:
        d.ellipse((740-radius,321-radius,740+radius,321+radius),outline=(*c,35),width=2)
    glyph(d,'diamond',740,322,223,(*c,80),3)
    d.rounded_rectangle((454,140,989,546),radius=12,fill=(9,13,20,255),outline=(*c,175),width=2)
    with Image.open(ROOT/item['source']) as source:
        reference=ImageOps.contain(source.convert('RGB'),(520,390),Image.Resampling.LANCZOS)
    im.paste(reference,(462+(520-reference.width)//2,148+(390-reference.height)//2))
    d=ImageDraw.Draw(im)
    d.rounded_rectangle((42,35,235,66),radius=5,fill=(17,47,66),outline=(57,120,153))
    d.text((54,42),'CS2  /  CASE BATTLE',font=font(15),fill=(*c,255))
    d.text((44,111),'SEED COLLECTION',font=font(18),fill=(*c,255))
    d.text((39,153),'BLUE',font=font(87,display=True),fill=(241,250,255))
    d.text((39,244),'GEM',font=font(87,display=True),fill=(124,215,255))
    d.line((44,350,136,350),fill=(*c,255),width=4)
    d.text((44,380),item['name'].upper(),font=font(22),fill=(189,215,237))
    d.text((44,426),'CASE HARDENED',font=font(17),fill=(*c,220))
    d.text((44,451),'PATTERN REFERENCE',font=font(15,False),fill=(136,166,190))
    d.text((464,559),f"FEATURED SEED / {item['paintSeed']}  ·  pattern.wiki",font=font(15),fill=(176,212,236))
    d.line((44,594,980,594),fill=(*c,85),width=1)
    d.text((44,608),'CUSTOM ARSENAL',font=font(12),fill=(120,147,171))
    d.text((813,608),'BATTLE / CS2',font=font(12),fill=(*c,200))
    result=im.convert('RGB')
    result.quantize(colors=256,method=Image.Quantize.MEDIANCUT).save(ROOT/f"{item['id']}.png",optimize=True)
    return result


def tie_art():
    c=(126,158,255);im=background(c,927);d=ImageDraw.Draw(im,'RGBA')
    d.polygon([(0,0),(570,0),(430,640),(0,640)],fill=(55,90,160,95))
    d.polygon([(570,0),(1024,0),(1024,640),(430,640)],fill=(168,48,60,95))
    d.line((570,0,430,640),fill=(240,235,255,200),width=3)
    for x,co in [(250,(122,183,255)),(775,(255,115,119))]:
        d.ellipse((x-140,220,x+140,500),outline=(*co,100),width=2)
        d.text((x-103,279),'50%',font=font(98,display=True),fill=(*co,255))
    d.text((42,40),'CASE BATTLE / HÒA ĐIỂM',font=font(20),fill=(218,227,255))
    d.text((42,94),'VÒNG PHỤ 50/50',font=font(56),fill=(245,248,255))
    footer='KHÔNG THU THÊM PHÍ';footer_font=font(20)
    footer_width=d.textlength(footer,font=footer_font)
    d.rounded_rectangle((512-footer_width/2-24,553,512+footer_width/2+24,605),radius=14,fill=(8,14,27,245))
    d.text((512-footer_width/2,566),footer,font=footer_font,fill=(221,232,249))
    im.convert('RGB').save(ROOT/'tie.png',optimize=True)


def tie_animation(side):
    width,height=768,480
    base=Image.open(ROOT/'tie.png').convert('RGB').resize((width,height),Image.Resampling.LANCZOS)
    frames=[];count=22
    color=(122,183,255) if side=='left' else (255,115,119)
    target=190 if side=='left' else 578
    for i in range(count):
        frame=base.copy();d=ImageDraw.Draw(frame,'RGBA')
        # The neutral coin slows into the persisted winning side. Drawing is deterministic.
        t=min(i/(count-6),1);progress=1-(1-t)**3
        center_x=int(384+(target-384)*progress)
        center_y=int(230-math.sin(t*math.pi)*50)
        spin=(1-t)*10*math.pi
        radius=54
        half=max(4,int(radius*abs(math.cos(spin))))
        glow=Image.new('RGBA',(width,height));gd=ImageDraw.Draw(glow)
        gd.ellipse((center_x-80,center_y-80,center_x+80,center_y+80),fill=(*color,65))
        frame=Image.alpha_composite(frame.convert('RGBA'),glow.filter(ImageFilter.GaussianBlur(18)))
        d=ImageDraw.Draw(frame,'RGBA')
        d.ellipse((center_x-half-4,center_y-radius,center_x+half+4,center_y+radius),fill=(76,65,31),outline=(255,217,115),width=3)
        d.ellipse((center_x-half,center_y-radius+4,center_x+half,center_y+radius-4),fill=(221,174,75),outline=(255,238,171),width=2)
        if half>22:
            glyph(d,'diamond',center_x,center_y,half*.55,(255,246,213),3)
        if i>=count-6:
            d.rounded_rectangle((target-157,344,target+157,396),radius=10,fill=(*color,65),outline=(*color,220),width=2)
            label='BÊN XANH THẮNG' if side=='left' else 'BÊN ĐỎ THẮNG'
            f=font(24);tw=d.textlength(label,font=f);d.text((target-tw/2,357),label,font=f,fill=(245,248,255))
        frames.append(frame.convert('RGB').quantize(colors=64,method=Image.Quantize.MEDIANCUT))
    durations=[80]*(count-1)+[920]
    frames[0].save(ROOT/f'tie-{side}.gif',save_all=True,append_images=frames[1:],duration=durations,loop=0,optimize=True,disposal=2)


def contact_sheet(items, filename):
    thumbw,thumbh=256,160
    sheet=Image.new('RGB',(thumbw*6,thumbh*math.ceil(len(items)/6)),(8,13,24))
    for i,item in enumerate(items):
        with Image.open(ROOT/f"{item['id']}.png") as cover:
            thumb=cover.convert('RGB').resize((thumbw,thumbh),Image.Resampling.LANCZOS)
        sheet.paste(thumb,((i%6)*thumbw,(i//6)*thumbh))
    sheet.save(ROOT/filename,quality=92)


items=json.loads((ROOT/'catalogue.json').read_text(encoding='utf8'))
ids=None if args.ids is None else {value.strip() for value in args.ids.split(',') if value.strip()}
if ids is not None and (not ids or ids-{item['id'] for item in items}):
    parser.error('Unknown or empty Battle case IDs')
selected=[item for item in items if (ids is None or item['id'] in ids)
          and (not args.only_missing or not (ROOT/f"{item['id']}.png").exists())]
for item in selected:
    render(item)
if ids is None:
    if not args.only_missing or not (ROOT/'tie.png').exists():
        tie_art()
    for side in ('left','right'):
        if not args.only_missing or not (ROOT/f'tie-{side}.gif').exists():
            tie_animation(side)
if all((ROOT/f"{item['id']}.png").exists() for item in items):
    contact_sheet(items,'contact-sheet.jpg')
if selected and (args.only_missing or ids is not None):
    contact_sheet(selected,args.selected_sheet)
print(f'Rendered {len(selected)} covers; catalogue: {len(items)}; contact sheet: {ROOT / "contact-sheet.jpg"}')
